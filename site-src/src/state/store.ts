// Estado central do site. As páginas só leem daqui e chamam as ações abaixo;
// nenhuma página busca offsets ou fala com o Helper por conta própria.

import { useSyncExternalStore } from 'react';
import {
  type ActionsState, defaultActionsState, restoreActionsState, setEnabled, setTrigger, toHelperMacro,
} from '../core/actions';
import { type FlagValue, toHelperValue } from '../core/flags';
import { HelperClient, type HelperResult, type HelperStatus } from '../core/helper/client';
import { buildIndex, type DatasetIndex } from '../core/offsets/dataset';
import { OffsetService, type OffsetState } from '../core/offsets/service';
import {
  type FlagHotkey, type HotkeyMap, type InvalidReport, type Preset, createPreset, needsRewrite,
  normalizePreset, removeInvalidFlags, sanitizeHotkeys, uniqueName,
} from '../core/presets';
import { type KV, openStorage } from '../core/storage/db';
import { KEYS, loadPrefs, migrateLegacyLocalStorage, readJson, savePrefs, writeJson } from '../core/storage/local';

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
  actions: ActionsState;
  sidebarCollapsed: boolean;
  toasts: Toast[];
  busy: Partial<Record<'apply' | 'pause' | 'resume', boolean>>;
}

const POLL_VISIBLE_MS = 5_000;
const POLL_HIDDEN_MS = 20_000;
const OFFSETS_RETRY_MS = 30_000;
const TOAST_MS = 4_500;

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
  private disposed = false;
  readonly helper: HelperClient;
  private offsetService: OffsetService | null = null;
  get offsets(): OffsetService | null { return this.offsetService; }

  constructor(private deps: { fetch: typeof fetch; base: string; idb?: IDBFactory }) {
    this.helper = new HelperClient(deps.fetch);
    const prefs = typeof localStorage !== 'undefined' ? loadPrefs() : { activePresetId: null, sidebarCollapsed: false };
    this.state = {
      ready: false, bootError: null, storagePersistent: true,
      offsets: { status: 'loading', liveVersion: null, liveCheckedAt: null, dataset: null, source: null, lastSyncAt: null, error: null },
      index: null, helper: null, helperChecked: false,
      presets: [], activePresetId: prefs.activePresetId, hotkeys: {}, actions: defaultActionsState(),
      sidebarCollapsed: prefs.sidebarCollapsed, toasts: [], busy: {},
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
        actions: restoreActionsState(readJson(KEYS.actions)),
      });
      this.savePrefs();
      const service = new OffsetService({ fetch: this.deps.fetch, storage, siteBase: this.deps.base });
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
    const st = await this.helper.probe();
    const prev = this.state.helper;
    // Só notifica a interface quando algo mudou (evita re-render a cada 5 s).
    if (!this.state.helperChecked || JSON.stringify(prev) !== JSON.stringify(st)) this.set({ helper: st, helperChecked: true });
    if (!st) return null;
    const restarted = !prev || prev.port !== st.port || prev.startedAt !== st.startedAt;
    if (restarted) {
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
    const a = this.state.actions;
    await this.helper.setMacros(a.actions.map(toHelperMacro), { stopKey: a.stopKey });
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

  async testAction(id: string) {
    const a = this.state.actions.actions.find((x) => x.id === id);
    if (!a) return;
    if (!(await this.pollHelper())) { this.toast('error', 'Helper local não está rodando.'); return; }
    const r = await this.helper.runMacro({ ...toHelperMacro(a), id: '__test__', robloxOnly: false }, 3000);
    this.toast(r.ok ? 'info' : 'error', r.ok ? `"${a.macro.name}" roda em 3 s — vá para o jogo.` : r.message);
  }

  async stopActions() {
    const r = await this.helper.stopMacros();
    this.toast(r.ok ? 'info' : 'error', r.message);
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
    if (hk && (hk.toggleKey || hk.cycleKey)) hotkeys[name] = hk;
    else delete hotkeys[name];
    this.set({ hotkeys });
    writeJson(KEYS.hotkeys, hotkeys);
    this.queue(() => this.pushHotkeys());
  }

  // ───────── ações ─────────

  private saveActions(actions: ActionsState) {
    this.set({ actions });
    writeJson(KEYS.actions, actions);
    this.queue(() => this.pushMacros());
  }
  setActionEnabled(id: string, enabled: boolean) { this.saveActions(setEnabled(this.state.actions, id, enabled)); }
  setActionTrigger(id: string, trigger: string | null) { this.saveActions(setTrigger(this.state.actions, id, trigger)); }
  setStopKey(code: string) { this.saveActions({ ...this.state.actions, stopKey: code }); }
  resetActions() {
    this.saveActions(defaultActionsState());
    this.toast('success', 'Ações restauradas para a configuração padrão.');
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
