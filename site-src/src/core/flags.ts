// Regras de nome/tipo de flag — ESPELHO EXATO do Helper (626.js: PREFIX_TYPE,
// cleanFlagName, inferTypeFromName). O Helper procura cada flag por
// cleanFlagName(nome) nos offsets; o site usa a mesma chave para decidir se uma
// flag existe no dump atual. Se mudar aqui, mude lá também.

export type FlagType = 'bool' | 'int' | 'float' | 'string';
export type FlagValue = string | number | boolean;

const PREFIX_TYPE: ReadonlyArray<readonly [string, FlagType]> = [
  ['DFFlag', 'bool'], ['SFFlag', 'bool'], ['FFlag', 'bool'], ['GFFlag', 'bool'],
  ['DFInt', 'int'], ['SFInt', 'int'], ['FInt', 'int'],
  ['DFLog', 'int'], ['FLog', 'int'],
  ['DFFloat', 'float'], ['SFFloat', 'float'], ['FFloat', 'float'],
  ['DFString', 'string'], ['SFString', 'string'], ['FString', 'string'],
];
const SORTED_PREFIXES = PREFIX_TYPE.map((p) => p[0]).sort((a, b) => b.length - a.length);

export const FLAG_NAME_RX = /^(?!__proto__$)[A-Za-z_]\w{0,127}$/;

/** Nome sem o prefixo de tipo (FFlag, DFInt…). Mesma regra do Helper. */
export function cleanFlagName(name: string): string {
  for (const pre of SORTED_PREFIXES) if (name.startsWith(pre)) return name.slice(pre.length);
  return name;
}

export function inferTypeFromName(name: string): FlagType | null {
  for (const [pre, t] of PREFIX_TYPE) if (name.startsWith(pre)) return t;
  return null;
}

export function inferTypeFromValue(value: FlagValue): FlagType {
  if (typeof value === 'boolean') return 'bool';
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === 'false') return 'bool';
  if (s !== '' && !Number.isNaN(Number(s))) return s.includes('.') ? 'float' : 'int';
  return 'string';
}

export function flagType(name: string, value: FlagValue): FlagType {
  return inferTypeFromName(name) ?? inferTypeFromValue(value);
}

/** Converte o valor digitado para o tipo da flag (para salvar/exportar tipado). */
export function coerceValue(type: FlagType, raw: FlagValue): FlagValue {
  if (type === 'bool') return typeof raw === 'boolean' ? raw : /^(true|1|yes)$/i.test(String(raw).trim());
  if (type === 'int') {
    const n = Math.trunc(Number(raw));
    return Number.isFinite(n) ? n : 0;
  }
  if (type === 'float') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return String(raw);
}

/** O Helper recebe tudo como texto ("true", "240", "0.5"). */
export function toHelperValue(value: FlagValue): string {
  return typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
}
