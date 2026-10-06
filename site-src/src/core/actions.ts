// As cinco ações do Painel. DEFAULT_PACK é a configuração fornecida, copiada
// sem alterar nenhum valor (steps, delays, hold, dx, dy, repeat, speed…).
// O site só acrescenta o que não faz parte do pack: id estável, grupo e "ativa".

export type MacroStep = Record<string, unknown> & { t: string };

export interface PackMacro {
  bope: 'macro';
  v: 1;
  name: string;
  mode: 'once' | 'loop' | 'hold';
  repeat: number;
  loopDelay: number;
  speed: number;
  robloxOnly: boolean;
  steps: MacroStep[];
  trigger: string;
}

export const DEFAULT_PACK: { bope: 'macro-pack'; v: 1; macros: PackMacro[] } = {
  bope: 'macro-pack',
  v: 1,
  macros: [
    {
      bope: 'macro', v: 1, name: 'Bug Indi', mode: 'once', repeat: 1, loopDelay: 0, speed: 1, robloxOnly: true,
      steps: [{ t: 'flick', btn: 'left', pre: 20, hold: 400, afterUp: 15, dx: 0, dy: 20001, moveDur: 0, afterMove: 0, cooldown: 0 }],
      trigger: 'MouseBack',
    },
    {
      bope: 'macro', v: 1, name: 'Bug indi ESQUERDA', mode: 'once', repeat: 1, loopDelay: 0, speed: 1, robloxOnly: true,
      steps: [{ t: 'flick', btn: 'left', pre: 20, hold: 400, afterUp: 15, dx: -150, dy: 0, moveDur: 0, afterMove: 0, cooldown: 0 }],
      trigger: 'MouseForward',
    },
    {
      bope: 'macro', v: 1, name: 'Bug indi DIREITA', mode: 'once', repeat: 1, loopDelay: 0, speed: 1, robloxOnly: true,
      steps: [{ t: 'flick', btn: 'left', pre: 20, hold: 400, afterUp: 15, dx: 150, dy: 0, moveDur: 0, afterMove: 0, cooldown: 0 }],
      trigger: 'MouseBack',
    },
    {
      bope: 'macro', v: 1, name: 'Perfect Dive', mode: 'once', repeat: 1, loopDelay: 0, speed: 1, robloxOnly: true,
      steps: [
        { t: 'key', code: 'Space', n: 1, hold: 30, gap: 60 },
        { t: 'wait', ms: 8 },
        { t: 'key', code: 'KeyQ', n: 1, hold: 30, gap: 60 },
      ],
      trigger: 'MouseRight',
    },
    {
      bope: 'macro', v: 1, name: 'Gagatech', mode: 'once', repeat: 1, loopDelay: 0, speed: 1, robloxOnly: true,
      steps: [
        { t: 'key', code: 'Space', n: 1, hold: 0, gap: 60 },
        { t: 'key', code: 'KeyC', n: 1, hold: 0, gap: 60 },
        { t: 'key', code: 'KeyQ', n: 1, hold: 0, gap: 60 },
      ],
      trigger: 'MouseForward',
    },
  ],
};

export type ActionGroup = 'Bug Indi' | 'GK';

interface ActionMeta { id: string; group: ActionGroup }
// Mesma ordem do pack.
const META: ActionMeta[] = [
  { id: 'bug-indi', group: 'Bug Indi' },
  { id: 'bug-indi-esquerda', group: 'Bug Indi' },
  { id: 'bug-indi-direita', group: 'Bug Indi' },
  { id: 'perfect-dive', group: 'GK' },
  { id: 'gagatech', group: 'GK' },
];
export const ACTION_GROUPS: ActionGroup[] = ['Bug Indi', 'GK'];

export interface Action {
  id: string;
  group: ActionGroup;
  enabled: boolean;
  trigger: string | null;
  macro: PackMacro;
}

export interface ActionsState {
  v: 2;
  actions: Action[];
  stopKey: string;
}

/**
 * Ativas por padrão: a primeira ação de cada botão. Duas ações ativas no mesmo
 * botão rodariam juntas (o Helper dispara todas as ações daquele gatilho), por
 * isso ativar uma desativa as outras do mesmo botão — ver setEnabled().
 */
export function defaultActionsState(): ActionsState {
  const used = new Set<string>();
  const actions = DEFAULT_PACK.macros.map((macro, i) => {
    const enabled = !used.has(macro.trigger);
    used.add(macro.trigger);
    return { ...META[i], enabled, trigger: macro.trigger, macro: structuredClone(macro) };
  });
  return { v: 2, actions, stopKey: 'F8' };
}

/** Restaura um estado salvo, aceitando só os campos que o usuário pode mudar. */
export function restoreActionsState(saved: unknown): ActionsState {
  const base = defaultActionsState();
  if (!saved || typeof saved !== 'object' || (saved as ActionsState).v !== 2) return base;
  const s = saved as Partial<ActionsState>;
  const byId = new Map((Array.isArray(s.actions) ? s.actions : []).map((a) => [a?.id, a]));
  for (const a of base.actions) {
    const o = byId.get(a.id);
    if (!o) continue;
    if (typeof o.enabled === 'boolean') a.enabled = o.enabled;
    if (o.trigger === null || (typeof o.trigger === 'string' && isValidTrigger(o.trigger))) a.trigger = o.trigger;
  }
  if (typeof s.stopKey === 'string' && isValidTrigger(s.stopKey)) base.stopKey = s.stopKey;
  return enforceExclusive(base);
}

export function isValidTrigger(code: string) {
  return /^[A-Za-z0-9_]{1,40}$/.test(code);
}

/** Garante no máximo uma ação ativa por botão (mantém a primeira). */
function enforceExclusive(st: ActionsState): ActionsState {
  const used = new Set<string>();
  for (const a of st.actions) {
    if (!a.enabled || !a.trigger) continue;
    if (used.has(a.trigger)) a.enabled = false;
    else used.add(a.trigger);
  }
  return st;
}

export function setEnabled(st: ActionsState, id: string, enabled: boolean): ActionsState {
  const target = st.actions.find((a) => a.id === id);
  return {
    ...st,
    actions: st.actions.map((a) => {
      if (a.id === id) return { ...a, enabled };
      if (enabled && target?.trigger && a.trigger === target.trigger && a.enabled) return { ...a, enabled: false };
      return a;
    }),
  };
}

export function setTrigger(st: ActionsState, id: string, trigger: string | null): ActionsState {
  const next: ActionsState = { ...st, actions: st.actions.map((a) => (a.id === id ? { ...a, trigger } : a)) };
  const me = next.actions.find((a) => a.id === id);
  if (me?.enabled && trigger) {
    next.actions = next.actions.map((a) => (a.id !== id && a.enabled && a.trigger === trigger ? { ...a, enabled: false } : a));
  }
  return next;
}

/** Ações que dividem o mesmo botão com esta (ativas ou não). */
export function sharedTrigger(st: ActionsState, id: string): Action[] {
  const me = st.actions.find((a) => a.id === id);
  if (!me?.trigger) return [];
  return st.actions.filter((a) => a.id !== id && a.trigger === me.trigger);
}

/** Formato que o Helper espera em /set-macros e /macro/run (521.js: sanitizeMacro). */
export function toHelperMacro(a: Action) {
  const m = a.macro;
  return {
    id: a.id, name: m.name, enabled: a.enabled, trigger: a.trigger,
    mode: m.mode, repeat: m.repeat, loopDelay: m.loopDelay, speed: m.speed,
    robloxOnly: m.robloxOnly, steps: structuredClone(m.steps),
  };
}

// ───────── textos para a interface ─────────

const TRIGGER_LABELS: Record<string, string> = {
  MouseLeft: 'Botão esquerdo',
  MouseRight: 'Botão direito',
  MouseMiddle: 'Botão do meio',
  MouseBack: 'Lateral ◄ (voltar)',
  MouseForward: 'Lateral ► (avançar)',
  ScrollUp: 'Scroll ↑',
  ScrollDown: 'Scroll ↓',
  Space: 'Espaço',
};

export function triggerLabel(code: string | null): string {
  if (!code) return 'Sem botão';
  if (TRIGGER_LABELS[code]) return TRIGGER_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
  return code;
}

const KEY_NAMES: Record<string, string> = { Space: 'Espaço' };
const keyName = (c: unknown) => {
  const s = String(c ?? '');
  return KEY_NAMES[s] ?? (/^Key[A-Z]$/.test(s) ? s.slice(3) : s);
};
const BTN_NAMES: Record<string, string> = { left: 'esquerdo', right: 'direito', middle: 'meio', back: 'lateral ◄', forward: 'lateral ►', none: 'nenhum' };

export function describeStep(s: MacroStep): string {
  const n = (v: unknown) => Number(v ?? 0);
  switch (s.t) {
    case 'flick': {
      const dir = [n(s.dx) ? `X ${n(s.dx) > 0 ? '+' : ''}${n(s.dx)}` : '', n(s.dy) ? `Y ${n(s.dy) > 0 ? '+' : ''}${n(s.dy)}` : ''].filter(Boolean).join(' · ') || 'sem movimento';
      return `Flick: espera ${n(s.pre)} ms → segura botão ${BTN_NAMES[String(s.btn)] ?? s.btn} ${n(s.hold)} ms → espera ${n(s.afterUp)} ms → move ${dir}`;
    }
    case 'key':
      return `Tecla ${keyName(s.code)}${n(s.n) > 1 ? ` ×${n(s.n)}` : ''} (segura ${n(s.hold)} ms)`;
    case 'wait':
      return `Espera ${n(s.ms)} ms`;
    default:
      return s.t;
  }
}
