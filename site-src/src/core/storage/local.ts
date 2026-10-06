// Preferências pequenas do site no localStorage (só no navegador).
// Toda leitura/escrita é protegida: com o armazenamento bloqueado o site
// continua funcionando, apenas sem lembrar as preferências.

export const KEYS = {
  prefs: 'bope:prefs:v2',
  actions: 'bope:acoes:v2',
  hotkeys: 'gerenciador:hotkeys:v1',
} as const;

// Chaves do site antigo. 'gerenciador:prefs:v1' guardava a versão escolhida
// manualmente (activeDumpId/clientVersion) — removida junto com o seletor.
const LEGACY = {
  prefs: ['gerenciador:prefs:v1', 'fflag-manager:prefs:v1'],
  macros: ['gerenciador:macros:v1'],
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

function remove(key: string) {
  try { localStorage.removeItem(key); } catch { /* bloqueado */ }
}

export interface Prefs {
  activePresetId: string | null;
  sidebarCollapsed: boolean;
}

export function loadPrefs(): Prefs {
  const p = readJson<Partial<Prefs>>(KEYS.prefs) ?? {};
  return {
    activePresetId: typeof p.activePresetId === 'string' ? p.activePresetId : null,
    sidebarCollapsed: p.sidebarCollapsed === true,
  };
}

export function savePrefs(p: Prefs) {
  writeJson(KEYS.prefs, p);
}

/**
 * Migra as chaves do site antigo (uma vez, idempotente):
 *  - preset ativo → bope:prefs:v2 (sem a versão selecionada manualmente)
 *  - hotkeys de flags antigas (fflag-manager) → gerenciador:hotkeys:v1
 *  - macros antigos (incluindo o AHK Flick) são descartados: as ações agora
 *    são as cinco definidas em core/actions/defaults.ts
 */
export function migrateLegacyLocalStorage() {
  if (readJson(KEYS.prefs) == null) {
    for (const key of LEGACY.prefs) {
      const old = readJson<{ activePresetId?: unknown }>(key);
      if (old && typeof old.activePresetId === 'string') {
        savePrefs({ activePresetId: old.activePresetId, sidebarCollapsed: false });
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
  for (const key of [...LEGACY.prefs, ...LEGACY.macros, ...LEGACY.hotkeys]) remove(key);
}
