// Estado central do site. As páginas só leem daqui e chamam as ações abaixo;
// nenhuma página busca offsets ou fala com o Helper por conta própria.

import { useSyncExternalStore } from 'react';
import {
  type BatchPatch, type CategoryRemoval, type Macro, type MacrosState, type ImportedPack, type TimingPreset, TEMPLATES, addCategory,
  applyImport, applyTiming, defaultMacrosState, duplicateCategory, duplicateMacro, duplicateMany, fromTemplate, moveCategory,
  moveCategoryTo, moveMacroTo, moveMany, newMacroId, patchMany, removeCategory, removeMacro, removeMany, removeTimingPreset,
  renameCategory, reorderMacro, restoreDefaults, restoreMacrosState, savePresetFromMacro, setAllEnabled, setCategoryEnabled,
  setEnabled, setMacroCategory, setManyEnabled, toHelperMacro, upsertMacro, upsertTimingPreset,
} from '../core/macros';
import { type HistoryEntry, type MacroLive, mergeHistory } from '../core/helper/live';
import { type FlagValue, cleanFlagName, toHelperValue } from '../core/flags';
import { HelperClient, type HelperResult, type HelperStatus } from '../core/helper/client';
import { OriginalsMemory } from '../core/helper/originals';
import { buildIndex, type DatasetIndex } from '../core/offsets/dataset';
import { OffsetService, type OffsetState } from '../core/offsets/service';
import {
  type FlagHotkey, type HotkeyMap, type InvalidReport, type Preset, createPreset, needsRewrite,
  normalizePreset, removeInvalidFlags, sanitizeHotkeys, uniqueName,
} from '../core/presets';
import { type KV, openStorage } from '../core/storage/db';
import { KEYS, loadPrefs, migrateLegacyLocalStorage, readJson, removeKey, savePrefs, writeJson } from '../core/storage/local';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast { id: number; kind: ToastKind; text: string }

export interface AppState {
  ready: boolean;
  bootError: string | null;
  storagePersistent: boolean;
  offsets: OffsetState;
  index: DatasetIndex | null;
  helper: HelperStatus | null;
  helperChecked: boolean;
  presets: Preset[];
  activePresetId: string | null;
  hotkeys: HotkeyMap;
  macros: MacrosState;
  sidebarCollapsed: boolean;
  toasts: Toast[];
  busy: Partial<Record<'apply' | 'pause' | 'resume', boolean>>;
  /** Estado ao vivo do executor (só enquanto alguma tela que mostra execução está aberta). */
  live: MacroLive | null;
  /** Histórico recebido do Helper (memória da aba). */
  history: HistoryEntry[];
}

const POLL_VISIBLE_MS = 5_000;
const POLL_HIDDEN_MS = 20_000;
const RETRY_BEFORE_DISCONNECT_MS = 1_000;
const OFFSETS_RETRY_MS = 30_000;
const TOAST_MS = 4_500;
/** Ritmo da leitura do estado ao vivo — só com uma tela de execução aberta e a aba visível. */
const LIVE_MS = 400;

export class AppStore {
  private state: AppState;
  private listeners = new Set<() => void>();
  private storage: KV | null = null;
  private prefixes: Record<string, string> = {};
  private builtinCache: Promise<BuiltinGroup[]> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private syncChain: Promise<unknown> = Promise.resolve();
  private offsetsPush: { version: string; startedAt: number | null; failedAt: number } | null = null;
  private toastSeq = 1;
  /** Originais das flags por processo do Roblox — só em memória (ver core/helper/originals). */
  private originals = new OriginalsMemory();
  private disposed = false;
  readonly helper: HelperClient;
  private offsetService: OffsetService | null = null;
  get offsets(): OffsetService | null { return this.offsetService; }

  constructor(private deps: { fetch: typeof fetch; base: string; idb?: IDBFactory }) {
    this.helper = new HelperClient(deps.fetch);
    const prefs = typeof localStorage !== 'undefined' ? loadPrefs() : { activePresetId: null, sidebarCollapsed: false };
    this.state = {
      ready: false, bootError: null, storagePersistent: true,
      offsets: { status: 'loading', liveVersion: null, liveCheckedAt: null, dataset: null, source: null, lastSyncAt: null, error: null, diagnostic: null },
      index: null, helper: null, helperChecked: false,
      presets: [], activePresetId: prefs.activePresetId, hotkeys: {}, macros: defaultMacrosState(),
      sidebarCollapsed: prefs.sidebarCollapsed, toasts: [], busy: {}, live: null, history: [],
    };
  }

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  // ───────── inicialização ─────────

  async init() {
    try {
      migrateLegacyLocalStorage();
      const [storage, prefixes] = await Promise.all([openStorage(this.deps.idb), this.loadPrefixes()]);
      this.storage = storage;
      this.prefixes = prefixes;
      const presets = await this.loadPresets(storage);
      const activePresetId = presets.some((p) => p.id === this.state.activePresetId) ? this.state.activePresetId : presets[0]?.id ?? null;
      this.set({
        ready: true, storagePersistent: storage.persistent, presets, activePresetId,
        hotkeys: sanitizeHotkeys(readJson(KEYS.hotkeys)),
        macros: this.loadMacros(),
      });
      this.savePrefs();
      const service = new OffsetService({ fetch: this.deps.fetch, siteBase: this.deps.base });
      this.offsetService = service;
      service.subscribe(() => this.onOffsets(service.getState()));
      void service.start();
      this.startPolling();
    } catch (e) {
      this.set({ ready: true, bootError: (e as Error).message || 'Falha ao iniciar.' });
    }
  }

  dispose() {
    this.disposed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.offsets?.dispose();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private async loadPrefixes(): Promise<Record<string, string>> {
    try {
      const res = await this.deps.fetch(`${this.deps.base}data/flag-prefixes.json`);
      const data = res.ok ? await res.json() : null;
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  private async loadPresets(storage: KV): Promise<Preset[]> {
    const raw = await storage.getAll<unknown>('presets').catch(() => [] as unknown[]);
    const presets: Preset[] = [];
    for (const [i, r] of raw.entries()) {
      const p = normalizePreset(r, i);
      if (!p) continue;
      presets.push(p);
      if (needsRewrite(r)) await storage.put('presets', p).catch(() => undefined);
    }
    presets.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (!presets.length) {
      const p = createPreset('Padrão', {}, []);
      await storage.put('presets', p).catch(() => undefined);
      presets.push(p);
    }
    return presets;
  }

  private onOffsets(off: OffsetState) {
    const prev = this.state.offsets.dataset;
    const index = off.dataset && off.dataset !== prev ? buildIndex(off.dataset, this.prefixes) : this.state.index;
    this.set({ offsets: off, index });
    if (off.dataset && off.dataset !== prev) this.queue(() => this.pushOffsets(true));
  }

  // ───────── Helper: monitoramento + sincronização ─────────

  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.schedulePoll(0);
  };

  private startPolling() {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    this.schedulePoll(0);
  }

  private schedulePoll(ms: number) {
    if (this.disposed) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      await this.pollHelper();
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (!this.pollTimer) this.schedulePoll(hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    }, ms);
  }

  /** Lê o status do Helper agora (também usado antes de cada operação). */
  async pollHelper(): Promise<HelperStatus | null> {
    let probed = await this.helper.probe();
    // Uma resposta perdida não é queda: com o Helper conectado, só marca como
    // desconectado se falhar de novo logo em seguida.
    if (!probed && this.state.helper) {
      await new Promise((r) => setTimeout(r, RETRY_BEFORE_DISCONNECT_MS));
      probed = await this.helper.probe();
    }
    let st: HelperStatus | null = null;
    if (probed) {
      const { originals, ...rest } = probed;
      this.originals.record(probed.flagSession, originals ?? []);
      st = rest;
    }
    const prev = this.state.helper;
    // Só notifica a interface quando algo mudou (evita re-render a cada 5 s).
    if (!this.state.helperChecked || JSON.stringify(prev) !== JSON.stringify(st)) this.set({ helper: st, helperChecked: true });
    if (!st) return null;
    const restarted = !prev || prev.port !== st.port || prev.startedAt !== st.startedAt;
    if (restarted) {
      // Helper reaberto: devolve os valores padrão que o anterior tinha capturado
      // neste mesmo Roblox, para pausar/desligar voltar ao padrão de verdade.
      const sessions = this.originals.payload();
      if (sessions.length) this.queue(() => this.helper.setOriginals(sessions));
      this.queue(() => this.pushMacros());
      this.queue(() => this.pushHotkeys());
    }
    const ds = this.state.offsets.dataset;
    if (ds && st.siteOffsetsBuild !== ds.version) this.queue(() => this.pushOffsets(false));
    return st;
  }

  /** Serializa os envios ao Helper (evita corrida entre config antiga e nova). */
  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.syncChain.then(fn, fn);
    this.syncChain = run.catch(() => undefined);
    return run;
  }

  private async pushOffsets(force: boolean): Promise<boolean> {
    const st = this.state.helper;
    const ds = this.state.offsets.dataset;
    const idx = this.state.index;
    if (!st || !ds || !idx || idx.version !== ds.version) return false;
    if (!force && st.siteOffsetsBuild === ds.version) return true;
    const last = this.offsetsPush;
    if (!force && last && last.version === ds.version && last.startedAt === st.startedAt && Date.now() - last.failedAt < OFFSETS_RETRY_MS) return false;
    const r = await this.helper.setOffsets(ds.version, idx.fullNames, ds.addresses);
    if (r.ok) {
      this.offsetsPush = null;
      const cur = this.state.helper; // pode ter mudado durante o envio
      if (cur && cur.startedAt === st.startedAt) this.set({ helper: { ...cur, siteOffsetsBuild: ds.version } });
    } else {
      this.offsetsPush = { version: ds.version, startedAt: st.startedAt, failedAt: Date.now() };
    }
    return r.ok;
  }

  private async pushMacros() {
    if (!this.state.helper) return;
    const a = this.state.macros;
    await this.helper.setMacros(a.macros.map(toHelperMacro), { stopKey: a.stopKey, history: a.history });
  }

  private async pushHotkeys() {
    if (!this.state.helper) return;
    await this.helper.setHotkeys(this.state.hotkeys, helperFlags(this.activePreset()?.flags ?? {}));
  }

  // ───────── operações no Roblox (via Helper) ─────────

  /** Re-identifica Helper/Roblox e garante os offsets antes de qualquer escrita. */
  private async prepareLive(): Promise<{ ok: true; version: string } | { ok: false; message: string }> {
    const st = await this.pollHelper();
    if (!st) return { ok: false, message: 'Helper local não está rodando. Abra o help.bat e tente de novo.' };
    const ds = this.state.offsets.dataset;
    if (!ds) return { ok: false, message: 'Não foi possível carregar os offsets. As funções que dependem deles estão indisponíveis.' };
    if (st.siteOffsetsBuild !== ds.version) {
      const ok = await this.queue(() => this.pushOffsets(true));
      if (!ok) return { ok: false, message: 'Não foi possível enviar os offsets ao Helper.' };
    }
    return { ok: true, version: ds.version };
  }

  private async live(kind: 'apply' | 'pause' | 'resume') {
    if (this.state.busy[kind]) return;
    this.set({ busy: { ...this.state.busy, [kind]: true } });
    try {
      const prep = await this.prepareLive();
      if (!prep.ok) { this.toast('error', prep.message); return; }
      const flags = helperFlags(this.activePreset()?.flags ?? {});
      let r: HelperResult;
      if (kind === 'apply') r = await this.helper.apply(flags, prep.version);
      else if (kind === 'pause') r = await this.helper.pause(flags, prep.version);
      else r = await this.helper.resume(flags, prep.version);
      this.toast(r.ok ? 'success' : 'error', r.message);
      void this.pollHelper();
    } finally {
      this.set({ busy: { ...this.state.busy, [kind]: false } });
    }
  }
  applyActive() { return this.live('apply'); }
  pauseAll() { return this.live('pause'); }
  resumeAll() { return this.live('resume'); }

  /** Roda a macro uma vez em 3 s (também macros ainda não salvas, do editor). */
  async testMacro(m: Macro) {
    if (!m.steps.length) { this.toast('error', 'A ação não tem etapas.'); return; }
    if (!(await this.pollHelper())) { this.toast('error', 'Helper local não está rodando.'); return; }
    const r = await this.helper.runMacro({ ...toHelperMacro(m), id: '__test__', robloxOnly: false, enabled: true }, 3000);
    this.toast(r.ok ? 'info' : 'error', r.ok ? `"${m.name}" roda em 3 s — vá para o jogo.` : r.message);
  }

  async stopActions() {
    const r = await this.helper.stopMacros();
    this.toast(r.ok ? 'info' : 'error', r.message);
  }

  // ───────── execução ao vivo (leitura) ─────────
  // A execução acontece SÓ no Helper. O site lê o estado num ritmo leve e apenas
  // enquanto há uma tela que mostra execução (Ações, Diagnóstico, Painel).

  private liveUsers = 0;
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  private liveBusy = false;

  /** Uma tela que mostra execução abriu; devolve a função para quando ela fechar. */
  watchLive(): () => void {
    this.liveUsers++;
    if (this.liveUsers === 1) this.scheduleLive(0);
    return () => {
      this.liveUsers = Math.max(0, this.liveUsers - 1);
      if (!this.liveUsers && this.liveTimer) { clearTimeout(this.liveTimer); this.liveTimer = null; }
    };
  }

  private scheduleLive(ms: number) {
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => void this.pollLive(), ms);
  }

  private async pollLive() {
    this.liveTimer = null;
    if (!this.liveUsers || this.disposed) return;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (!hidden && this.state.helper && !this.liveBusy) {
      this.liveBusy = true;
      try {
        const live = await this.helper.macroState();
        if (JSON.stringify(live) !== JSON.stringify(this.state.live)) this.set({ live });
        const lastSeq = this.state.history.length ? this.state.history[this.state.history.length - 1].seq : 0;
        if (live && live.historySeq !== lastSeq) {
          const since = live.historySeq < lastSeq ? 0 : lastSeq; // Helper reiniciou
          const h = await this.helper.macroHistory(since);
          if (h) this.set({ history: since === 0 && lastSeq ? h.items : mergeHistory(this.state.history, h.items) });
        }
      } finally {
        this.liveBusy = false;
      }
    } else if (!this.state.helper && this.state.live) {
      this.set({ live: null });
    }
    if (this.liveUsers) this.scheduleLive(hidden ? 2000 : LIVE_MS);
  }

  async clearHistory() {
    const r = await this.helper.clearMacroHistory();
    if (r.ok) this.set({ history: [] });
    else this.toast('error', r.message);
  }

  setHistoryEnabled(on: boolean) { this.saveMacros({ ...this.state.macros, history: on }); }

  async stopMacro(id: string) {
    const r = await this.helper.stopMacros(id);
    if (!r.ok) this.toast('error', r.message);
  }

  // ───────── presets ─────────

  activePreset(): Preset | null {
    return this.state.presets.find((p) => p.id === this.state.activePresetId) ?? null;
  }

  private savePrefs() {
    savePrefs({ activePresetId: this.state.activePresetId, sidebarCollapsed: this.state.sidebarCollapsed });
  }

  private async persistPreset(p: Preset) {
    try { await this.storage?.put('presets', p); } catch { this.toast('error', 'Não foi possível salvar o preset neste navegador.'); }
  }

  private replacePreset(p: Preset) {
    const presets = this.state.presets.map((x) => (x.id === p.id ? p : x));
    this.set({ presets });
    void this.persistPreset(p);
    if (p.id === this.state.activePresetId) this.queue(() => this.pushHotkeys());
  }

  setActivePreset(id: string) {
    if (!this.state.presets.some((p) => p.id === id)) return;
    this.set({ activePresetId: id });
    this.savePrefs();
    this.queue(() => this.pushHotkeys());
  }

  addPreset(name: string, flags: Record<string, FlagValue> = {}): Preset {
    const p = createPreset(name, flags, this.state.presets);
    this.set({ presets: [...this.state.presets, p].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) });
    void this.persistPreset(p);
    this.setActivePreset(p.id);
    return p;
  }

  renamePreset(id: string, name: string) {
    const p = this.state.presets.find((x) => x.id === id);
    if (!p) return;
    this.replacePreset({ ...p, name: uniqueName(name, this.state.presets, id), updatedAt: new Date().toISOString() });
  }

  duplicatePreset(id: string) {
    const p = this.state.presets.find((x) => x.id === id);
    if (p) this.addPreset(`${p.name} (cópia)`, { ...p.flags });
  }

  async deletePreset(id: string) {
    const presets = this.state.presets.filter((p) => p.id !== id);
    try { await this.storage?.delete('presets', id); } catch { /* removido da sessão mesmo assim */ }
    const activePresetId = this.state.activePresetId === id ? presets[0]?.id ?? null : this.state.activePresetId;
    this.set({ presets, activePresetId });
    this.savePrefs();
    this.queue(() => this.pushHotkeys());
  }

  setFlag(presetId: string, name: string, value: FlagValue) {
    const p = this.state.presets.find((x) => x.id === presetId);
    if (!p) return;
    this.replacePreset({ ...p, flags: { ...p.flags, [name]: value }, updatedAt: new Date().toISOString() });
  }

  removeFlag(presetId: string, name: string) {
    const p = this.state.presets.find((x) => x.id === presetId);
    if (!p || !hasFlag(p.flags, name)) return;
    const flags = { ...p.flags };
    delete flags[name];
    this.replacePreset({ ...p, flags, updatedAt: new Date().toISOString() });
  }

  mergeFlags(presetId: string, flags: Record<string, FlagValue>) {
    const p = this.state.presets.find((x) => x.id === presetId);
    if (p) this.replacePreset({ ...p, flags: { ...p.flags, ...flags }, updatedAt: new Date().toISOString() });
  }

  removeInvalid(report: InvalidReport) {
    const r = removeInvalidFlags(this.state.presets, this.state.hotkeys, report);
    this.set({ presets: r.presets, hotkeys: r.hotkeys });
    for (const p of r.changed) void this.persistPreset(p);
    writeJson(KEYS.hotkeys, r.hotkeys);
    this.queue(() => this.pushHotkeys());
    this.toast('success', `${report.total} ${report.total === 1 ? 'configuração inválida removida' : 'configurações inválidas removidas'}.`);
  }

  builtinPresets(): Promise<BuiltinGroup[]> {
    if (!this.builtinCache) {
      this.builtinCache = this.deps.fetch(`${this.deps.base}data/builtin-presets.json`)
        .then((r) => (r.ok ? r.json() : { groups: [] }))
        .then((d) => parseBuiltin(d))
        .catch(() => { this.builtinCache = null; return []; });
    }
    return this.builtinCache;
  }

  // ───────── hotkeys de flags ─────────

  setHotkey(name: string, hk: FlagHotkey | null) {
    const hotkeys = { ...this.state.hotkeys };
    // Some com registros antigos da mesma flag salvos com/sem prefixo (DFIntX / X).
    const key = cleanFlagName(name);
    for (const k of Object.keys(hotkeys)) if (cleanFlagName(k) === key) delete hotkeys[k];
    if (hk && (hk.toggleKey || hk.cycleKey)) hotkeys[name] = hk;
    this.set({ hotkeys });
    writeJson(KEYS.hotkeys, hotkeys);
    this.queue(() => this.pushHotkeys());
  }

  // ───────── ações ─────────

  /** Estado salvo (v3) ou migrado da versão anterior/site antigo — nunca com ações ativadas sozinhas. */
  private loadMacros(): MacrosState {
    const st = restoreMacrosState(readJson(KEYS.macros), readJson(KEYS.macrosV2), readJson(KEYS.macrosV1));
    writeJson(KEYS.macros, st);
    removeKey(KEYS.macrosV2);
    removeKey(KEYS.macrosV1);
    return st;
  }

  private saveMacros(macros: MacrosState) {
    this.set({ macros });
    writeJson(KEYS.macros, macros);
    this.queue(() => this.pushMacros());
  }
  setMacroEnabled(id: string, enabled: boolean) {
    const m = this.state.macros.macros.find((x) => x.id === id);
    if (enabled && m && (!m.trigger || !m.steps.length)) {
      this.toast('error', !m.trigger ? `Defina um botão para "${m.name}" antes de ativar.` : `"${m.name}" não tem etapas.`);
      return;
    }
    this.saveMacros(setEnabled(this.state.macros, id, enabled));
  }
  setAllMacrosEnabled(enabled: boolean) {
    const next = setAllEnabled(this.state.macros, enabled);
    this.saveMacros(next);
    if (enabled) {
      const skipped = next.macros.filter((m) => !m.enabled).length;
      if (skipped) this.toast('info', `${skipped} ${skipped === 1 ? 'ação sem botão ou sem etapas não foi ativada' : 'ações sem botão ou sem etapas não foram ativadas'}.`);
    }
  }
  setMacroTrigger(id: string, trigger: string | null) {
    const m = this.state.macros.macros.find((x) => x.id === id);
    if (m) this.saveMacros(upsertMacro(this.state.macros, { ...m, trigger }));
  }
  // ───── categorias (pastas) ─────
  /** Move uma ação para outra categoria (null = sem categoria). */
  setMacroCategory(id: string, categoryId: string | null) {
    this.saveMacros(setMacroCategory(this.state.macros, id, categoryId));
  }
  /** Reordena uma ação dentro da própria categoria. */
  reorderMacro(id: string, dir: -1 | 1) {
    this.saveMacros(reorderMacro(this.state.macros, id, dir));
  }
  /** Ativa/desativa todas as ações de uma categoria (null = sem categoria). */
  setCategoryEnabled(categoryId: string | null, enabled: boolean) {
    const next = setCategoryEnabled(this.state.macros, categoryId, enabled);
    this.saveMacros(next);
    if (enabled) {
      const valid = new Set(next.categories.map((c) => c.id));
      const inCat = next.macros.filter((m) => (m.categoryId && valid.has(m.categoryId) ? m.categoryId : null) === categoryId);
      const skipped = inCat.filter((m) => !m.enabled).length;
      if (skipped) this.toast('info', `${skipped} ${skipped === 1 ? 'ação sem botão ou sem etapas não foi ativada' : 'ações sem botão ou sem etapas não foram ativadas'}.`);
    }
  }
  /** Cria uma categoria nova (pasta vazia). */
  addCategory(name: string): string {
    const r = addCategory(this.state.macros, name);
    this.saveMacros(r.state);
    const created = r.state.categories.find((c) => c.id === r.id);
    this.toast('success', `Categoria "${created?.name ?? name}" criada.`);
    return r.id;
  }
  renameCategory(id: string, name: string) {
    if (!name.trim()) return;
    this.saveMacros(renameCategory(this.state.macros, id, name));
  }
  /** Exclui a categoria; o usuário escolhe o destino das ações (padrão: ficam sem categoria). */
  removeCategory(id: string, what: CategoryRemoval = 'uncat') {
    const st = this.state.macros;
    const cat = st.categories.find((c) => c.id === id);
    const count = st.macros.filter((m) => m.categoryId === id).length;
    this.saveMacros(removeCategory(st, id, what));
    const dest = typeof what === 'object' ? st.categories.find((c) => c.id === what.moveTo)?.name : null;
    const n = `${count} ${count === 1 ? 'ação' : 'ações'}`;
    this.toast('success', !count ? `Categoria "${cat?.name ?? ''}" excluída.`
      : what === 'delete' ? `Categoria "${cat?.name ?? ''}" excluída com ${n}.`
        : dest ? `Categoria "${cat?.name ?? ''}" excluída · ${n} movida(s) para "${dest}".`
          : `Categoria "${cat?.name ?? ''}" excluída · ${n} sem categoria.`);
  }
  duplicateCategory(id: string) {
    const r = duplicateCategory(this.state.macros, id);
    if (!r.id) return;
    this.saveMacros(r.state);
    this.toast('success', `Categoria "${r.state.categories.find((c) => c.id === r.id)?.name}" criada · cópias desativadas.`);
  }
  moveMacroTo(id: string, categoryId: string | null, beforeId: string | null) { this.saveMacros(moveMacroTo(this.state.macros, id, categoryId, beforeId)); }
  moveCategoryTo(id: string, beforeId: string | null) { this.saveMacros(moveCategoryTo(this.state.macros, id, beforeId)); }

  // ───── edição em lote ─────
  setManyEnabled(ids: string[], enabled: boolean) {
    const next = setManyEnabled(this.state.macros, ids, enabled);
    this.saveMacros(next);
    if (enabled) {
      const skipped = next.macros.filter((m) => ids.includes(m.id) && !m.enabled).length;
      if (skipped) this.toast('info', `${skipped} sem botão ou sem etapas não ${skipped === 1 ? 'foi ativada' : 'foram ativadas'}.`);
    }
  }
  moveMany(ids: string[], categoryId: string | null) { this.saveMacros(moveMany(this.state.macros, ids, categoryId)); this.toast('success', `${ids.length} ${ids.length === 1 ? 'ação movida' : 'ações movidas'}.`); }
  removeMany(ids: string[]) { this.saveMacros(removeMany(this.state.macros, ids)); this.toast('success', `${ids.length} ${ids.length === 1 ? 'ação excluída' : 'ações excluídas'}.`); }
  duplicateMany(ids: string[]) { this.saveMacros(duplicateMany(this.state.macros, ids)); this.toast('success', `${ids.length} ${ids.length === 1 ? 'cópia criada' : 'cópias criadas'} · desativadas.`); }
  patchMany(ids: string[], patch: BatchPatch) { this.saveMacros(patchMany(this.state.macros, ids, patch)); this.toast('success', `${ids.length} ${ids.length === 1 ? 'ação alterada' : 'ações alteradas'}.`); }

  // ───── presets de temporização ─────
  applyTimingPreset(ids: string[], presetId: string) {
    const p = this.state.macros.timingPresets.find((x) => x.id === presetId);
    if (!p) return;
    const set = new Set(ids);
    this.saveMacros({ ...this.state.macros, macros: this.state.macros.macros.map((m) => (set.has(m.id) ? applyTiming(m, p.values) : m)) });
    this.toast('success', `Preset "${p.name}" aplicado em ${ids.length} ${ids.length === 1 ? 'ação' : 'ações'}.`);
  }
  saveTimingPreset(p: TimingPreset) { this.saveMacros(upsertTimingPreset(this.state.macros, p)); }
  presetFromMacro(name: string, m: Macro) {
    const r = savePresetFromMacro(this.state.macros, name, m);
    this.saveMacros(r.state);
    this.toast('success', `Preset "${r.state.timingPresets.find((x) => x.id === r.id)?.name}" salvo.`);
    return r.id;
  }
  removeTimingPreset(id: string) { this.saveMacros(removeTimingPreset(this.state.macros, id)); }

  /** Volta a ação ao modelo (ou a temporização/comportamento aos padrões). */
  restoreMacroDefaults(id: string) {
    const m = this.state.macros.macros.find((x) => x.id === id);
    if (!m) return;
    this.saveMacros(upsertMacro(this.state.macros, restoreDefaults(m)));
    this.toast('success', m.templateId ? `"${m.name}" voltou ao modelo original.` : `Temporização e comportamento de "${m.name}" voltaram ao padrão.`);
  }
  moveCategory(id: string, dir: -1 | 1) {
    this.saveMacros(moveCategory(this.state.macros, id, dir));
  }
  /** Salva (cria ou atualiza). Macros novas entram desativadas. */
  saveMacro(m: Macro) {
    const exists = this.state.macros.macros.some((x) => x.id === m.id);
    this.saveMacros(upsertMacro(this.state.macros, exists ? m : { ...m, enabled: false, createdAt: Date.now() }));
    this.toast('success', exists ? `"${m.name}" salva.` : `Ação "${m.name}" criada · Status: desativada.`);
  }
  deleteMacro(id: string) { this.saveMacros(removeMacro(this.state.macros, id)); }
  duplicateMacro(id: string) {
    const r = duplicateMacro(this.state.macros, id);
    if (r.copy) { this.saveMacros(r.state); this.toast('success', `"${r.copy.name}" criada · Status: desativada.`); }
  }
  addTemplate(templateId: string) {
    const t = TEMPLATES.find((x) => x.id === templateId);
    if (!t) return;
    let st = this.state.macros;
    // garante a categoria do modelo (Bug Indi / GK), criando se o usuário a tiver apagado
    let catId = st.categories.find((c) => c.name.toLowerCase() === t.group.toLowerCase())?.id ?? null;
    if (!catId) { const r = addCategory(st, t.group); st = r.state; catId = r.id; }
    const id = st.macros.some((m) => m.id === t.id) ? newMacroId() : t.id;
    this.saveMacros(upsertMacro(st, fromTemplate(t, catId, id)));
    this.toast('success', `Modelo "${t.pack.name}" adicionado · Status: desativada.`);
  }
  /** Importa um pacote (ações + categorias), sem apagar nada. mode: 'merge' | 'new'. */
  importPack(pack: ImportedPack, mode: 'merge' | 'new') {
    const r = applyImport(this.state.macros, pack, mode);
    this.saveMacros(r.state);
    const parts = [`${r.addedMacros} ${r.addedMacros === 1 ? 'ação importada' : 'ações importadas'} · desativadas`];
    if (r.addedCategories) parts.push(`${r.addedCategories} ${r.addedCategories === 1 ? 'categoria criada' : 'categorias criadas'}`);
    if (r.addedPresets) parts.push(`${r.addedPresets} ${r.addedPresets === 1 ? 'preset de tempo' : 'presets de tempo'}`);
    this.toast('success', parts.join(' · ') + '.');
  }
  setStopKey(code: string) { this.saveMacros({ ...this.state.macros, stopKey: code }); }

  async pickCursor(delayMs: number) {
    const r = await this.helper.pickCursor(delayMs);
    if (!r.ok) this.toast('error', r.message);
    return r.ok ? { x: Number(r.x), y: Number(r.y) } : null;
  }

  // ───────── interface ─────────

  toggleSidebar() {
    this.set({ sidebarCollapsed: !this.state.sidebarCollapsed });
    this.savePrefs();
  }

  toast(kind: ToastKind, text: string) {
    const t = { id: this.toastSeq++, kind, text };
    this.set({ toasts: [...this.state.toasts.slice(-3), t] });
    setTimeout(() => this.dismissToast(t.id), TOAST_MS);
  }
  dismissToast(id: number) {
    if (this.state.toasts.some((t) => t.id === id)) this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }
}

export interface BuiltinGroup { person: string; presets: Array<{ name: string; flags: Record<string, FlagValue> }> }

function parseBuiltin(d: unknown): BuiltinGroup[] {
  const groups = (d as { groups?: unknown })?.groups;
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((g) => {
    const o = g as Record<string, unknown>;
    if (typeof o.person !== 'string' || !Array.isArray(o.presets)) return [];
    const presets = o.presets.flatMap((p) => {
      const q = p as Record<string, unknown>;
      return typeof q.name === 'string' && q.flags && typeof q.flags === 'object' ? [{ name: q.name, flags: q.flags as Record<string, FlagValue> }] : [];
    });
    return presets.length ? [{ person: o.person, presets }] : [];
  });
}

export function hasFlag(flags: Record<string, FlagValue>, name: string) {
  return Object.prototype.hasOwnProperty.call(flags, name);
}

export function helperFlags(flags: Record<string, FlagValue>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(flags)) out[k] = toHelperValue(v);
  return out;
}

// ───────── React ─────────

export const store = new AppStore({
  fetch: (...args) => globalThis.fetch(...args),
  base: (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './',
});

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
