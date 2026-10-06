// Serviço de offsets — ÚNICO lugar do site que busca versão/offsets na internet.
// O Helper não participa: ele só recebe do site o dataset já validado.
//
//   abrir site → dataset do cache (rápido) → GET versão LIVE
//     ├─ mesma versão do dataset → reutiliza (nenhum download)
//     └─ versão nova → cache do navegador → dataset publicado com o site
//                     → offsets.json (+ FFlags.hpp se o JSON não trouxer flags)
//                     → valida → só então substitui o dataset atual
// Falha em qualquer etapa mantém o dataset atual. Nunca existe dataset parcial.

import type { KV } from '../storage/db';
import {
  DatasetError, type FlagDataset, isValidDataset, normalizeVersion,
  parseFFlagsHpp, parseOffsetsJson, parseSiteDataset,
} from './dataset';

export const LIVE_VERSION_URL = 'https://offsets.imtheo.lol/roblox/version';
export const OFFSETS_JSON_URL = 'https://offsets.imtheo.lol/offsets.json';
export const FFLAGS_HPP_URL = 'https://offsets.imtheo.lol/FFlags.hpp';

export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const LIVE_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_CACHED_DATASETS = 3;

export type OffsetStatus =
  | 'loading'      // ainda sem nada (primeiro instante)
  | 'checking'     // verificando a versão LIVE
  | 'updating'     // baixando offsets da versão nova
  | 'ready'        // dataset = versão LIVE
  | 'outdated'     // versão LIVE nova, mas a atualização falhou → dataset anterior mantido
  | 'offline'      // não deu para verificar a versão LIVE → usando o último dataset válido
  | 'unavailable'; // nenhum dataset válido

export type DatasetSource = 'cache' | 'site' | 'remote';

export interface OffsetState {
  status: OffsetStatus;
  liveVersion: string | null;
  liveCheckedAt: number | null;
  dataset: FlagDataset | null;
  source: DatasetSource | null;
  lastSyncAt: number | null;
  error: string | null;
}

export interface OffsetServiceDeps {
  fetch: typeof fetch;
  storage: KV;
  /** Base dos arquivos publicados com o site (data/dumps/…). */
  siteBase: string;
  now?: () => number;
}

export class OffsetService {
  private state: OffsetState = {
    status: 'loading', liveVersion: null, liveCheckedAt: null,
    dataset: null, source: null, lastSyncAt: null, error: null,
  };
  private listeners = new Set<() => void>();
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.isDue()) void this.refresh();
  };
  private readonly now: () => number;

  constructor(private deps: OffsetServiceDeps) {
    this.now = deps.now ?? Date.now;
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
    this.set({ status: 'checking' });
    if (typeof document !== 'undefined') {
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
      await this.useFallback(`Não foi possível verificar a versão LIVE (${errMsg(e)}).`);
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
      const error = `Não foi possível atualizar os offsets para ${live} (${errMsg(e)}).`;
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

  private async fetchText(url: string, timeoutMs: number): Promise<string> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await this.deps.fetch(url, { signal: ctl.signal, cache: 'no-store', credentials: 'omit' });
      if (!res.ok) throw new DatasetError(`HTTP ${res.status}`);
      // text() só resolve com o corpo COMPLETO; conexão caída = exceção (nada parcial).
      return await res.text();
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw new DatasetError('tempo esgotado');
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  private async fetchLiveVersion(): Promise<string> {
    const text = await this.fetchText(LIVE_VERSION_URL, LIVE_TIMEOUT_MS);
    const v = normalizeVersion(text);
    if (!v) throw new DatasetError('resposta da versão LIVE inválida');
    return v;
  }

  /** Dataset publicado junto com o site (mesma origem). version=null → o mais recente. */
  private async siteDataset(version: string | null): Promise<FlagDataset | null> {
    let manifest: { latest?: unknown; versions?: Array<{ id?: unknown; file?: unknown }> };
    try {
      manifest = JSON.parse(await this.fetchText(`${this.deps.siteBase}data/dumps/manifest.json`, LIVE_TIMEOUT_MS));
    } catch {
      return null;
    }
    const versions = Array.isArray(manifest.versions) ? manifest.versions : [];
    const wanted = version ?? normalizeVersion(manifest.latest);
    const entry = versions.find((v) => normalizeVersion(v.id) === wanted);
    if (!wanted || !entry || typeof entry.file !== 'string' || !/^[\w.-]+\.json$/.test(entry.file)) return null;
    const text = await this.fetchText(`${this.deps.siteBase}data/dumps/${entry.file}`, DOWNLOAD_TIMEOUT_MS);
    return parseSiteDataset(text, wanted);
  }

  private async remoteDataset(live: string): Promise<FlagDataset> {
    const offsets = parseOffsetsJson(await this.fetchText(OFFSETS_JSON_URL, DOWNLOAD_TIMEOUT_MS), live);
    // offsets.json traz offsets de estruturas; se não trouxer as FFlags, elas vêm do
    // FFlags.hpp do mesmo serviço (mesma versão exigida).
    const flags = offsets.flags ?? parseFFlagsHpp(await this.fetchText(FFLAGS_HPP_URL, DOWNLOAD_TIMEOUT_MS), live);
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

function errMsg(e: unknown): string {
  if (e instanceof DatasetError) return e.message;
  if (e instanceof TypeError) return 'sem conexão ou bloqueado pelo navegador';
  return (e as Error)?.message || 'erro desconhecido';
}
