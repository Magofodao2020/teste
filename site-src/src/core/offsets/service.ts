// Serviço de offsets — ÚNICO lugar do site que busca versão/offsets na internet.
// O Helper não participa: ele só recebe do site o dataset já validado.
//
//   abrir site → dataset do cache (rápido) → GET /roblox/version
//     ├─ mesma versão do dataset → reutiliza (nenhum download)
//     └─ versão nova → cache do navegador → dataset publicado com o site
//                     → GET /offsets.json (+ FFlags.hpp se o JSON não trouxer flags)
//                     → valida → só então substitui o dataset atual
// Falha em qualquer etapa mantém o dataset atual e registra a CAUSA exata
// (CORS, rede, timeout, HTTP, resposta vazia/inválida) para a interface.

import type { KV } from '../storage/db';
import {
  DatasetError, type FlagDataset, isValidDataset, normalizeVersion,
  parseFFlagsHpp, parseOffsetsJson, parseSiteDataset,
} from './dataset';
import {
  type FailKind, RemoteClient, RemoteError, type RequestInfo, UPSTREAM_ORIGIN, parseLiveVersion, sampleOf,
} from './remote';

export const LIVE_VERSION_URL = `${UPSTREAM_ORIGIN}/roblox/version`;
export const OFFSETS_JSON_URL = `${UPSTREAM_ORIGIN}/offsets.json`;
export const FFLAGS_HPP_URL = `${UPSTREAM_ORIGIN}/FFlags.hpp`;

export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const LIVE_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_CACHED_DATASETS = 3;

export type OffsetStatus =
  | 'loading'      // ainda sem nada (primeiro instante)
  | 'checking'     // verificando a versão LIVE
  | 'updating'     // baixando offsets da versão nova
  | 'ready'        // versão LIVE verificada e dataset = versão LIVE
  | 'outdated'     // versão LIVE verificada, mas a atualização falhou → dataset anterior mantido
  | 'offline'      // versão LIVE NÃO verificada → usando o último dataset válido
  | 'unavailable'; // nenhum dataset válido

export type DatasetSource = 'cache' | 'site' | 'remote';

/** Resultado da última consulta ao serviço (o que aconteceu de verdade). */
export interface Diagnostic {
  at: number;
  step: 'versão LIVE' | 'offsets.json' | 'FFlags.hpp';
  ok: boolean;
  kind?: FailKind | 'validation';
  message: string;
  info?: RequestInfo;
}

export interface OffsetState {
  status: OffsetStatus;
  liveVersion: string | null;
  liveCheckedAt: number | null;
  dataset: FlagDataset | null;
  source: DatasetSource | null;
  lastSyncAt: number | null;
  error: string | null;
  diagnostic: Diagnostic | null;
}

export interface OffsetServiceDeps {
  fetch: typeof fetch;
  storage: KV;
  /** Base dos arquivos publicados com o site (data/dumps/…, api/…). */
  siteBase: string;
  now?: () => number;
}

class StepError extends Error {
  constructor(readonly diagnostic: Diagnostic) { super(diagnostic.message); }
}

export class OffsetService {
  private state: OffsetState = {
    status: 'loading', liveVersion: null, liveCheckedAt: null,
    dataset: null, source: null, lastSyncAt: null, error: null, diagnostic: null,
  };
  private listeners = new Set<() => void>();
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.isDue()) void this.refresh();
  };
  private readonly now: () => number;
  private readonly remote: RemoteClient;

  constructor(private deps: OffsetServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.remote = new RemoteClient(deps.fetch, deps.siteBase, this.now);
  }

  getState = (): OffsetState => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private set(patch: Partial<OffsetState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Inicia: carrega o último dataset do cache e verifica a versão LIVE uma vez. */
  async start(): Promise<void> {
    const cached = await this.latestCached();
    if (cached) this.set({ dataset: cached, source: 'cache' });
    if (typeof document !== 'undefined' && !this.timer) {
      document.addEventListener('visibilitychange', this.onVisible);
      this.timer = setInterval(() => {
        if (document.visibilityState === 'visible') void this.refresh();
      }, CHECK_INTERVAL_MS);
    }
    await this.refresh();
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
  }

  private isDue() {
    const t = this.state.liveCheckedAt;
    return t == null || this.now() - t >= CHECK_INTERVAL_MS;
  }

  /** Verifica a versão LIVE (chamadas simultâneas compartilham a mesma execução). */
  refresh(): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.doRefresh().finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  private async doRefresh() {
    this.set({ status: 'checking' });
    let live: string;
    try {
      live = await this.fetchLiveVersion();
    } catch (e) {
      const d = toDiagnostic(e, 'versão LIVE', this.now());
      // A versão LIVE fica desconhecida: nunca reaproveitar uma verificação antiga.
      this.set({ liveVersion: null, diagnostic: d });
      await this.useFallback(`Não foi possível consultar a versão LIVE: ${d.message}`);
      return;
    }
    this.set({ liveVersion: live, liveCheckedAt: this.now() });

    if (this.state.dataset?.version === live) {
      this.set({ status: 'ready', lastSyncAt: this.now(), error: null });
      return;
    }

    const cached = await this.cachedFor(live);
    if (cached) {
      this.set({ status: 'ready', dataset: cached, source: 'cache', lastSyncAt: this.now(), error: null });
      return;
    }

    this.set({ status: 'updating' });
    try {
      const fromSite = await this.siteDataset(live).catch(() => null);
      const next = fromSite ?? (await this.remoteDataset(live));
      await this.store(next);
      this.set({ status: 'ready', dataset: next, source: fromSite ? 'site' : 'remote', lastSyncAt: this.now(), error: null });
    } catch (e) {
      const d = toDiagnostic(e, 'offsets.json', this.now());
      const error = `Não foi possível atualizar os offsets para ${live}: ${d.message}`;
      this.set({ diagnostic: d });
      if (this.state.dataset) this.set({ status: 'outdated', error });
      else await this.useFallback(error, 'outdated');
    }
  }

  /** Sem versão LIVE (ou sem como atualizar): mantém/obtém o último dataset válido. */
  private async useFallback(error: string, statusWithData: OffsetStatus = 'offline') {
    if (this.state.dataset) { this.set({ status: statusWithData, error }); return; }
    const cached = await this.latestCached();
    if (cached) { this.set({ status: statusWithData, dataset: cached, source: 'cache', error }); return; }
    try {
      const site = await this.siteDataset(null);
      if (site) {
        await this.store(site);
        this.set({ status: statusWithData, dataset: site, source: 'site', error });
        return;
      }
    } catch { /* sem dataset publicado utilizável */ }
    this.set({ status: 'unavailable', error });
  }

  // ───────── fontes ─────────

  private async fetchLiveVersion(): Promise<string> {
    const r = await this.remote.get('roblox/version', LIVE_TIMEOUT_MS);
    const parsed = parseLiveVersion(r.text);
    if ('error' in parsed) {
      const info = { ...r.info, sample: sampleOf(r.text) };
      throw new StepError({
        at: this.now(), step: 'versão LIVE', ok: false, kind: parsed.error, info,
        message: parsed.error === 'empty'
          ? 'o serviço respondeu, mas a resposta veio vazia.'
          : `a resposta não é uma versão válida (esperado "version-" + 16 hex; recebido: "${info.sample}").`,
      });
    }
    this.set({ diagnostic: { at: this.now(), step: 'versão LIVE', ok: true, message: `Versão LIVE ${parsed.version} (${r.info.via}).`, info: r.info } });
    return parsed.version;
  }

  /** Texto do site (mesma origem). */
  private async siteText(path: string, timeoutMs: number): Promise<string> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await this.deps.fetch(`${this.deps.siteBase}${path}`, { signal: ctl.signal, cache: 'no-cache' });
      if (!res.ok) throw new DatasetError(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  }

  /** Dataset publicado junto com o site. version=null → o mais recente. */
  private async siteDataset(version: string | null): Promise<FlagDataset | null> {
    let manifest: { latest?: unknown; versions?: Array<{ id?: unknown; file?: unknown }> };
    try {
      manifest = JSON.parse(await this.siteText('data/dumps/manifest.json', LIVE_TIMEOUT_MS));
    } catch {
      return null;
    }
    const versions = Array.isArray(manifest.versions) ? manifest.versions : [];
    const wanted = version ?? normalizeVersion(manifest.latest);
    const entry = versions.find((v) => normalizeVersion(v.id) === wanted);
    if (!wanted || !entry || typeof entry.file !== 'string' || !/^[\w.-]+\.json$/.test(entry.file)) return null;
    return parseSiteDataset(await this.siteText(`data/dumps/${entry.file}`, DOWNLOAD_TIMEOUT_MS), wanted);
  }

  private async remoteDataset(live: string): Promise<FlagDataset> {
    const offText = await this.remote.get('offsets.json', DOWNLOAD_TIMEOUT_MS);
    let offsets;
    try {
      offsets = parseOffsetsJson(offText.text, live);
    } catch (e) {
      throw new StepError({ at: this.now(), step: 'offsets.json', ok: false, kind: 'validation', message: `offsets.json recusado: ${(e as Error).message}`, info: offText.info });
    }
    // offsets.json traz offsets de estruturas; se não trouxer as FFlags, elas vêm do
    // FFlags.hpp do mesmo serviço (mesma versão exigida).
    let flags = offsets.flags;
    if (!flags) {
      let hpp;
      try {
        hpp = await this.remote.get('FFlags.hpp', DOWNLOAD_TIMEOUT_MS);
      } catch (e) {
        throw new StepError({ ...toDiagnostic(e, 'FFlags.hpp', this.now()), message: `offsets.json não traz FFlags e o FFlags.hpp falhou: ${(e as Error).message}` });
      }
      try {
        flags = parseFFlagsHpp(hpp.text, live);
      } catch (e) {
        throw new StepError({ at: this.now(), step: 'FFlags.hpp', ok: false, kind: 'validation', message: `FFlags.hpp recusado: ${(e as Error).message}`, info: hpp.info });
      }
    }
    this.set({ diagnostic: { at: this.now(), step: 'offsets.json', ok: true, message: `Offsets de ${live} baixados e validados (${flags.names.length} flags, ${offText.info.via}).`, info: offText.info } });
    return {
      version: live, origin: 'imtheo', fetchedAt: this.now(),
      dumpedAt: offsets.dumpedAt, dumperVersion: offsets.dumperVersion, ...flags,
    };
  }

  // ───────── cache (IndexedDB do site) ─────────

  private async cachedFor(version: string): Promise<FlagDataset | null> {
    try {
      const d = await this.deps.storage.get<FlagDataset>('datasets', version);
      return isValidDataset(d) && d.version === version ? d : null;
    } catch {
      return null;
    }
  }

  private async latestCached(): Promise<FlagDataset | null> {
    try {
      const all = (await this.deps.storage.getAll<FlagDataset>('datasets')).filter(isValidDataset);
      all.sort((a, b) => b.fetchedAt - a.fetchedAt);
      return all[0] ?? null;
    } catch {
      return null;
    }
  }

  private async store(ds: FlagDataset) {
    try {
      await this.deps.storage.put('datasets', ds);
      const all = await this.deps.storage.getAll<FlagDataset>('datasets');
      all.sort((a, b) => (b.fetchedAt ?? 0) - (a.fetchedAt ?? 0));
      for (const old of all.slice(MAX_CACHED_DATASETS)) await this.deps.storage.delete('datasets', old.version);
    } catch {
      // Cache indisponível: o dataset continua válido em memória nesta sessão.
    }
  }
}

function toDiagnostic(e: unknown, step: Diagnostic['step'], at: number): Diagnostic {
  if (e instanceof StepError) return e.diagnostic;
  if (e instanceof RemoteError) return { at, step, ok: false, kind: e.kind, message: e.message, info: e.info };
  if (e instanceof DatasetError) return { at, step, ok: false, kind: 'validation', message: e.message };
  return { at, step, ok: false, kind: 'network', message: (e as Error)?.message || 'erro desconhecido' };
}
