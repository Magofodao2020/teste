// Preferências pequenas do site no localStorage (só no navegador).
// Toda leitura/escrita é protegida: com o armazenamento bloqueado o site
// continua funcionando, apenas sem lembrar as preferências.

export const KEYS = {
  prefs: 'bope:prefs:v2',
  macros: 'bope:acoes:v3',
  macrosV2: 'bope:acoes:v2',
  macrosV1: 'gerenciador:macros:v1',
  hotkeys: 'gerenciador:hotkeys:v1',
} as const;

// Chaves do site antigo. 'gerenciador:prefs:v1' guardava a versão escolhida
// manualmente (activeDumpId/clientVersion) — removida junto com o seletor.
const LEGACY = {
  prefs: ['gerenciador:prefs:v1', 'fflag-manager:prefs:v1'],
  hotkeys: ['fflag-manager:hotkeys:v1'],
};

export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string) {
  try { localStorage.removeItem(key); } catch { /* bloqueado */ }
}

export interface TurboPrefs { enabled: boolean; intervalMs: number }
export const TURBO_INTERVALS = [250, 500, 1000, 2000, 5000];

export interface Prefs {
  activePresetId: string | null;
  sidebarCollapsed: boolean;
  /** Modo turbo (reaplicar flags que o Roblox voltar). Desligado por padrão. */
  turbo: TurboPrefs;
}

export function loadPrefs(): Prefs {
  const p = readJson<Partial<Prefs>>(KEYS.prefs) ?? {};
  return {
    activePresetId: typeof p.activePresetId === 'string' ? p.activePresetId : null,
    sidebarCollapsed: p.sidebarCollapsed === true,
    turbo: {
      enabled: p.turbo?.enabled === true,
      intervalMs: TURBO_INTERVALS.includes(Number(p.turbo?.intervalMs)) ? Number(p.turbo?.intervalMs) : 1000,
    },
  };
}

export function savePrefs(p: Prefs) {
  writeJson(KEYS.prefs, p);
}

/**
 * Migra as chaves do site antigo (uma vez, idempotente):
 *  - preset ativo → bope:prefs:v2 (sem a versão selecionada manualmente)
 *  - hotkeys de flags antigas (fflag-manager) → gerenciador:hotkeys:v1
 *  - macros antigos: migrados pelo store (core/macros.ts: restoreMacrosState),
 *    sem o AHK Flick e todos desativados
 */
export function migrateLegacyLocalStorage() {
  if (readJson(KEYS.prefs) == null) {
    for (const key of LEGACY.prefs) {
      const old = readJson<{ activePresetId?: unknown }>(key);
      if (old && typeof old.activePresetId === 'string') {
        savePrefs({ activePresetId: old.activePresetId, sidebarCollapsed: false, turbo: { enabled: false, intervalMs: 1000 } });
        break;
      }
    }
  }
  if (readJson(KEYS.hotkeys) == null) {
    for (const key of LEGACY.hotkeys) {
      const old = readJson(key);
      if (old && typeof old === 'object') { writeJson(KEYS.hotkeys, old); break; }
    }
  }
  for (const key of [...LEGACY.prefs, ...LEGACY.hotkeys]) removeKey(key);
}
