// Presets de flags e limpeza de flags que não existem mais no dump atual.

import { FLAG_NAME_RX, cleanFlagName, type FlagValue } from './flags';
import { type DatasetIndex, flagExists } from './offsets/dataset';

export interface Preset {
  id: string;
  name: string;
  flags: Record<string, FlagValue>;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface FlagHotkey {
  toggleKey?: string;
  cycleKey?: string;
  cycleValues?: string[];
}
export type HotkeyMap = Record<string, FlagHotkey>;

export const PRESET_COLORS = ['#E5141B', '#E5C400', '#F97316', '#22C55E', '#38BDF8', '#A78BFA', '#F472B6', '#94A3B8'];
const MAX_FLAGS = 20_000;

export function newId(): string {
  try {
    return 'p-' + crypto.randomUUID().slice(0, 13);
  } catch {
    return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}

function isPrimitive(v: unknown): v is FlagValue {
  return typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}

export function sanitizeFlags(raw: unknown): Record<string, FlagValue> {
  const out: Record<string, FlagValue> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_FLAGS) break;
    if (!FLAG_NAME_RX.test(k) || !isPrimitive(v)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 512) : v;
    n++;
  }
  return out;
}

/**
 * Normaliza um preset salvo (inclusive os do site antigo, que tinham `draft` e
 * `robloxVersion`). O rascunho não aplicado vira o conteúdo do preset; a versão
 * escolhida manualmente é descartada.
 */
export function normalizePreset(raw: unknown, index = 0): Preset | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  const now = new Date().toISOString();
  const flags = sanitizeFlags(o.draft && typeof o.draft === 'object' ? o.draft : o.flags);
  return {
    id: o.id.slice(0, 80),
    name: (typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Preset').slice(0, 60),
    flags,
    color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : PRESET_COLORS[index % PRESET_COLORS.length],
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now,
  };
}

export function needsRewrite(raw: unknown): boolean {
  const o = (raw ?? {}) as Record<string, unknown>;
  return 'draft' in o || 'robloxVersion' in o;
}

export function createPreset(name: string, flags: Record<string, FlagValue>, existing: Preset[]): Preset {
  const now = new Date().toISOString();
  return { id: newId(), name: uniqueName(name, existing), flags: sanitizeFlags(flags), color: PRESET_COLORS[existing.length % PRESET_COLORS.length], createdAt: now, updatedAt: now };
}

export function uniqueName(name: string, existing: Preset[], ignoreId?: string): string {
  const base = (name.trim() || 'Preset').slice(0, 60);
  const taken = new Set(existing.filter((p) => p.id !== ignoreId).map((p) => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const n = `${base} (${i})`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}

// ───────── importação / exportação ─────────

export interface ImportResult {
  name: string | null;
  flags: Record<string, FlagValue>;
  ignored: number;
}

/** Aceita {"name": …, "flags": {…}} ou um objeto simples {"FFlagX": true, …}. */
export function parseImport(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON inválido: ${(e as Error).message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('O JSON precisa ser um objeto de flags.');
  const o = data as Record<string, unknown>;
  const wrapped = !!o.flags && typeof o.flags === 'object' && !Array.isArray(o.flags);
  const source: Record<string, unknown> = wrapped ? { ...(o.flags as Record<string, unknown>) } : { ...o };
  if (!wrapped) delete source.name;
  const flags = sanitizeFlags(source);
  const count = Object.keys(flags).length;
  if (!count) throw new Error('Nenhuma flag válida encontrada no JSON.');
  return { name: wrapped && typeof o.name === 'string' ? o.name : null, flags, ignored: Object.keys(source).length - count };
}

export function exportPreset(p: Preset): string {
  return JSON.stringify({ name: p.name, flags: p.flags }, null, 2);
}

// ───────── flags inexistentes no dump atual ─────────

export interface InvalidReport {
  version: string;
  total: number;
  presets: Array<{ id: string; name: string; flags: string[] }>;
  /** Hotkeys de flags que não existem mais (removidas junto). */
  hotkeys: string[];
}

/** Compara cada flag salva com o dump atual usando a MESMA chave do Helper. */
export function scanInvalidFlags(presets: Preset[], hotkeys: HotkeyMap, index: DatasetIndex): InvalidReport {
  const out: InvalidReport = { version: index.version, total: 0, presets: [], hotkeys: [] };
  for (const p of presets) {
    const bad = Object.keys(p.flags).filter((name) => !flagExists(index, name));
    if (bad.length) {
      out.presets.push({ id: p.id, name: p.name, flags: bad });
      out.total += bad.length;
    }
  }
  out.hotkeys = Object.keys(hotkeys).filter((name) => !flagExists(index, name));
  return out;
}

/** Remove SOMENTE as flags listadas no relatório; todo o resto fica intacto. */
export function removeInvalidFlags(presets: Preset[], hotkeys: HotkeyMap, report: InvalidReport) {
  const byPreset = new Map(report.presets.map((r) => [r.id, new Set(r.flags)]));
  const now = new Date().toISOString();
  const changed: Preset[] = [];
  const nextPresets = presets.map((p) => {
    const bad = byPreset.get(p.id);
    if (!bad) return p;
    const flags: Record<string, FlagValue> = {};
    for (const [k, v] of Object.entries(p.flags)) if (!bad.has(k)) flags[k] = v;
    const np = { ...p, flags, updatedAt: now };
    changed.push(np);
    return np;
  });
  const badHk = new Set(report.hotkeys);
  const nextHotkeys: HotkeyMap = {};
  for (const [k, v] of Object.entries(hotkeys)) if (!badHk.has(k)) nextHotkeys[k] = v;
  return { presets: nextPresets, changed, hotkeys: nextHotkeys };
}

export function sanitizeHotkeys(raw: unknown): HotkeyMap {
  const out: HotkeyMap = {};
  if (!raw || typeof raw !== 'object') return out;
  // Nomes com e sem prefixo (DFIntX / X) são a MESMA flag: junta num registro só,
  // preferindo o nome com prefixo; campos que faltam vêm do outro registro.
  const byClean = new Map<string, string>();
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!FLAG_NAME_RX.test(name) || !v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const hk: FlagHotkey = {};
    if (typeof o.toggleKey === 'string' && o.toggleKey) hk.toggleKey = o.toggleKey.slice(0, 40);
    if (typeof o.cycleKey === 'string' && o.cycleKey) hk.cycleKey = o.cycleKey.slice(0, 40);
    if (Array.isArray(o.cycleValues)) hk.cycleValues = o.cycleValues.map(String).slice(0, 20);
    if (!hk.toggleKey && !hk.cycleKey) continue;
    const key = cleanFlagName(name);
    const prev = byClean.get(key);
    if (!prev) { byClean.set(key, name); out[name] = hk; continue; }
    const prefixed = name !== key;
    const [winName, win, lose] = prefixed && prev === key ? [name, hk, out[prev]] : [prev, out[prev], hk];
    const merged: FlagHotkey = { ...win };
    if (!merged.toggleKey && lose.toggleKey) merged.toggleKey = lose.toggleKey;
    if (!merged.cycleKey && lose.cycleKey) { merged.cycleKey = lose.cycleKey; merged.cycleValues = lose.cycleValues; }
    delete out[prev];
    out[winName] = merged;
    byClean.set(key, winName);
  }
  // Toggle e cycle no mesmo botão se anulam (o cycle muda e o toggle desliga): fica o toggle.
  for (const hk of Object.values(out)) {
    if (hk.toggleKey && hk.toggleKey === hk.cycleKey) { delete hk.cycleKey; delete hk.cycleValues; }
  }
  return out;
}

/** Atalho de uma flag, aceitando o registro salvo com ou sem prefixo. */
export function findHotkey(hotkeys: HotkeyMap, name: string): FlagHotkey | undefined {
  if (hotkeys[name]) return hotkeys[name];
  const key = cleanFlagName(name);
  const alt = Object.keys(hotkeys).find((k) => cleanFlagName(k) === key);
  return alt ? hotkeys[alt] : undefined;
}
