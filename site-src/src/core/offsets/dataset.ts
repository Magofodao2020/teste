// Modelo do dataset de offsets de FFlags + parsers/validação de cada formato.
// Nenhum parser devolve dados parciais: ou o payload inteiro é válido, ou lança
// DatasetError e o dataset atual continua em uso.

import { FLAG_NAME_RX, cleanFlagName } from '../flags';

export const VERSION_RX = /^version-[0-9a-f]{16}$/;
// Mesmo intervalo de RVA aceito pelo Helper (626.js: RVA_MIN/RVA_MAX).
export const RVA_MIN = 0x100000;
export const RVA_MAX = 0x10000000;
export const MIN_FLAGS = 500;
export const MAX_PAYLOAD_CHARS = 32 * 1024 * 1024;

export type DatasetOrigin = 'site' | 'imtheo';

export interface FlagDataset {
  version: string;
  origin: DatasetOrigin;
  fetchedAt: number;
  dumpedAt?: string;
  dumperVersion?: string;
  /** Nomes como aparecem no dump (normalmente sem prefixo). */
  names: string[];
  /** RVA de cada nome, em hex ("0x83e7808"). Mesma ordem de `names`. */
  addresses: string[];
}

export class DatasetError extends Error {}

export function normalizeVersion(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return VERSION_RX.test(s) ? s : null;
}

function toRva(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^0x[0-9a-f]{1,8}$/i.test(v.trim())) n = parseInt(v.trim().slice(2), 16);
  else if (typeof v === 'string' && /^\d{1,10}$/.test(v.trim())) n = Number(v.trim());
  else return null;
  return Number.isInteger(n) && n >= RVA_MIN && n <= RVA_MAX ? n : null;
}

/** Junta pares nome→endereço, descarta inválidos/duplicados e exige um mínimo. */
function buildEntries(pairs: Iterable<[unknown, unknown]>): { names: string[]; addresses: string[] } {
  const seen = new Set<string>();
  const names: string[] = [];
  const addresses: string[] = [];
  for (const [rawName, rawAddr] of pairs) {
    if (typeof rawName !== 'string' || !FLAG_NAME_RX.test(rawName) || seen.has(rawName)) continue;
    const rva = toRva(rawAddr);
    if (rva == null) continue;
    seen.add(rawName);
    names.push(rawName);
    addresses.push('0x' + rva.toString(16));
  }
  if (names.length < MIN_FLAGS) {
    throw new DatasetError(`Dataset com poucos offsets de flags válidos (${names.length}).`);
  }
  return { names, addresses };
}

function parseJsonObject(text: string): Record<string, unknown> {
  if (typeof text !== 'string' || !text.trim()) throw new DatasetError('Resposta vazia.');
  if (text.length > MAX_PAYLOAD_CHARS) throw new DatasetError('Resposta grande demais.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new DatasetError('JSON inválido ou incompleto.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new DatasetError('O JSON não é um objeto.');
  return data as Record<string, unknown>;
}

/** data/dumps/<versão>.json publicado junto com o site. */
export function parseSiteDataset(text: string, expectedVersion?: string): FlagDataset {
  const data = parseJsonObject(text);
  const version = normalizeVersion(data.robloxVersion);
  if (!version) throw new DatasetError('"robloxVersion" ausente ou inválido.');
  if (expectedVersion && version !== expectedVersion) {
    throw new DatasetError(`O arquivo é de ${version}, esperado ${expectedVersion}.`);
  }
  if (!Array.isArray(data.flags)) throw new DatasetError('"flags" precisa ser uma lista.');
  const entries = buildEntries(
    (data.flags as unknown[]).map((f) => {
      const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
      return [o.name, o.address] as [unknown, unknown];
    }),
  );
  return {
    version,
    origin: 'site',
    fetchedAt: Date.now(),
    dumpedAt: typeof data.dumpDate === 'string' ? data.dumpDate : undefined,
    dumperVersion: typeof data.dumperVersion === 'string' ? data.dumperVersion : undefined,
    ...entries,
  };
}

export interface OffsetsJson {
  version: string;
  dumpedAt?: string;
  dumperVersion?: string;
  /** Offsets de FFlags, se o offsets.json trouxer um grupo de flags. */
  flags: { names: string[]; addresses: string[] } | null;
}

const FLAG_GROUP_RX = /^(fflags?|fflagoffsets|fflaglist|fastflags?|flags)$/i;

/**
 * offsets.json do serviço de offsets:
 *   { "Roblox Version": "version-…", "Dumper Version", "Dumped At", "Total Offsets",
 *     "Offsets": { Grupo: { Nome: número | "0x…" } } }
 */
export function parseOffsetsJson(text: string, expectedVersion: string): OffsetsJson {
  const data = parseJsonObject(text);
  const version = normalizeVersion(data['Roblox Version']);
  if (!version) throw new DatasetError('"Roblox Version" ausente ou inválido.');
  if (version !== expectedVersion) {
    throw new DatasetError(`offsets.json é de ${version}, mas a versão LIVE é ${expectedVersion}.`);
  }
  const offsets = data['Offsets'];
  if (!offsets || typeof offsets !== 'object' || Array.isArray(offsets)) throw new DatasetError('"Offsets" ausente ou inválido.');
  const groups = Object.entries(offsets as Record<string, unknown>);
  if (!groups.length) throw new DatasetError('"Offsets" está vazio.');
  let flags: OffsetsJson['flags'] = null;
  for (const [group, entries] of groups) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      throw new DatasetError(`Grupo "${group}" com estrutura inesperada.`);
    }
    for (const [k, v] of Object.entries(entries as Record<string, unknown>)) {
      const ok = typeof v === 'number' ? Number.isFinite(v) && v >= 0 : typeof v === 'string' && /^(0x[0-9a-f]+|\d+)$/i.test(v.trim());
      if (!ok) throw new DatasetError(`Valor inválido em "${group}.${k}".`);
    }
    if (FLAG_GROUP_RX.test(group)) flags = buildEntries(Object.entries(entries as Record<string, unknown>));
  }
  return {
    version,
    dumpedAt: typeof data['Dumped At'] === 'string' ? (data['Dumped At'] as string) : undefined,
    dumperVersion: typeof data['Dumper Version'] === 'string' ? (data['Dumper Version'] as string) : undefined,
    flags,
  };
}

const HPP_VERSION_RX = /ClientVersion\s*=\s*"([^"]+)"|Roblox Version\s*:\s*(version-[0-9a-fA-F]+)/;
const HPP_ENTRY_RX = /uintptr_t\s+([A-Za-z_]\w{0,127})\s*=\s*0x([0-9a-fA-F]{1,8})/g;
const HPP_STRUCT_NS_RX = /namespace\s+FFlagList\s*\{[^}]*\}/g;

/** FFlags.hpp (saída do RbxDumperV2): `inline constexpr uintptr_t Nome = 0x…;` */
export function parseFFlagsHpp(text: string, expectedVersion: string): { names: string[]; addresses: string[] } {
  if (typeof text !== 'string' || !text.includes('uintptr_t')) throw new DatasetError('FFlags.hpp vazio ou inválido.');
  if (text.length > MAX_PAYLOAD_CHARS) throw new DatasetError('FFlags.hpp grande demais.');
  const vm = HPP_VERSION_RX.exec(text);
  const version = normalizeVersion(vm ? vm[1] ?? vm[2] : null);
  if (!version) throw new DatasetError('FFlags.hpp sem versão do Roblox.');
  if (version !== expectedVersion) throw new DatasetError(`FFlags.hpp é de ${version}, mas a versão LIVE é ${expectedVersion}.`);
  const body = text.replace(HPP_STRUCT_NS_RX, '');
  const pairs: Array<[string, string]> = [];
  for (const m of body.matchAll(HPP_ENTRY_RX)) pairs.push([m[1], '0x' + m[2]]);
  return buildEntries(pairs);
}

/** Valida um dataset vindo do cache do navegador antes de usá-lo. */
export function isValidDataset(d: unknown): d is FlagDataset {
  if (!d || typeof d !== 'object') return false;
  const o = d as FlagDataset;
  return (
    typeof o.version === 'string' && VERSION_RX.test(o.version) &&
    Array.isArray(o.names) && Array.isArray(o.addresses) &&
    o.names.length === o.addresses.length && o.names.length >= MIN_FLAGS &&
    typeof o.fetchedAt === 'number'
  );
}

// ───────── índice em memória (busca + validação de flags) ─────────

export interface DatasetIndex {
  version: string;
  /** Nome completo (com prefixo quando conhecido) de cada flag do dump. */
  fullNames: string[];
  /** Chaves exatamente como o Helper indexa: cleanFlagName(nome enviado). */
  keys: Set<string>;
  size: number;
}

/** Nome enviado ao Helper: prefixo conhecido + nome do dump (dá o tipo certo). */
export function fullFlagName(dumpName: string, prefixes: Record<string, string>): string {
  const pre = prefixes[dumpName];
  return pre ? pre + dumpName : dumpName;
}

export function buildIndex(ds: FlagDataset, prefixes: Record<string, string>): DatasetIndex {
  const fullNames = ds.names.map((n) => fullFlagName(n, prefixes));
  return { version: ds.version, fullNames, keys: new Set(fullNames.map(cleanFlagName)), size: fullNames.length };
}

/** A flag existe no dump atual? Mesma busca do Helper: offsets[clean(nome)] || offsets[nome]. */
export function flagExists(index: DatasetIndex, name: string): boolean {
  return index.keys.has(cleanFlagName(name)) || index.keys.has(name);
}
