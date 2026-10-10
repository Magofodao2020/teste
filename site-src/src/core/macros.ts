// Sistema de ações/macros do Painel. O usuário cria, edita, grava, importa e
// exporta macros livremente; as cinco ações do BOPE vêm como MODELOS.
//
// Regras:
//  - NENHUMA macro começa ativa (nem os modelos, nem as importadas/gravadas).
//  - Só existem os tipos de etapa que o Helper executa (521.js: STEP_TYPES).
//  - A sanitização espelha a do Helper (521.js: sanitizeStep/sanitizeMacro).

export type StepType = 'flick' | 'move' | 'path' | 'click' | 'down' | 'up' | 'scroll' | 'key' | 'keydown' | 'keyup' | 'text' | 'wait';
export type MacroStep = { t: StepType; delay?: number } & Record<string, unknown>;
export type MacroMode = 'once' | 'loop' | 'hold';

export interface Macro {
  id: string;
  name: string;
  /** Categoria (pasta) a que pertence, ou null = sem categoria. Referencia Category.id. */
  categoryId: string | null;
  enabled: boolean;
  trigger: string | null;
  mode: MacroMode;
  repeat: number;
  loopDelay: number;
  speed: number;
  robloxOnly: boolean;
  /**
   * Botão/tecla que ALTERNA o lado do flick (espelha o movimento horizontal dos
   * passos de flick). null = sem alternância. O lado atual fica só no Helper.
   */
  sideKey: string | null;
  /** Bipe ao trocar de lado (agudo = direita, grave = esquerda). */
  sideSound: boolean;
  steps: MacroStep[];
  createdAt: number;
  updatedAt: number;
}

/** Categoria = pasta de ações, totalmente controlada pelo usuário (criar/renomear/excluir). */
export interface Category { id: string; name: string }

export interface MacrosState {
  v: 4;
  categories: Category[];
  macros: Macro[];
  stopKey: string;
}

export const STEP_TYPES: ReadonlyArray<readonly [StepType, string]> = [
  ['key', 'Tecla'],
  ['keydown', 'Segurar tecla'],
  ['keyup', 'Soltar tecla'],
  ['click', 'Clique'],
  ['down', 'Segurar botão do mouse'],
  ['up', 'Soltar botão do mouse'],
  ['move', 'Mover mouse'],
  ['flick', 'Flick (câmera)'],
  ['scroll', 'Scroll'],
  ['text', 'Digitar texto'],
  ['wait', 'Esperar'],
];
export const STEP_LABEL: Record<StepType, string> = { ...Object.fromEntries(STEP_TYPES), path: 'Trajetória gravada' } as Record<StepType, string>;
const TYPESET = new Set<string>([...STEP_TYPES.map((s) => s[0]), 'path']);
export const MOUSE_BUTTONS: ReadonlyArray<readonly [string, string]> = [
  ['left', 'Esquerdo'], ['right', 'Direito'], ['middle', 'Meio'], ['back', 'Lateral ◄'], ['forward', 'Lateral ►'],
];
const BTNSET = new Set(MOUSE_BUTTONS.map((b) => b[0]));
export const MODES: ReadonlyArray<readonly [MacroMode, string]> = [
  ['once', 'Uma vez'], ['loop', 'Loop (liga/desliga)'], ['hold', 'Enquanto segurar'],
];

// ───────── modelos (pack fornecido, valores exatos) ─────────

export interface PackMacro {
  bope: 'macro'; v: 1; name: string; mode: MacroMode; repeat: number; loopDelay: number; speed: number;
  robloxOnly: boolean; steps: MacroStep[]; trigger: string;
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

export interface Template { id: string; group: string; pack: PackMacro }
export const TEMPLATES: Template[] = [
  { id: 'bug-indi', group: 'Bug Indi', pack: DEFAULT_PACK.macros[0] },
  { id: 'bug-indi-esquerda', group: 'Bug Indi', pack: DEFAULT_PACK.macros[1] },
  { id: 'bug-indi-direita', group: 'Bug Indi', pack: DEFAULT_PACK.macros[2] },
  { id: 'perfect-dive', group: 'GK', pack: DEFAULT_PACK.macros[3] },
  { id: 'gagatech', group: 'GK', pack: DEFAULT_PACK.macros[4] },
];

/** Macro a partir de um modelo — SEMPRE desativada. */
export function fromTemplate(t: Template, categoryId: string | null = null, id = t.id, now = Date.now()): Macro {
  const p = t.pack;
  return {
    id, name: p.name, categoryId, enabled: false, trigger: p.trigger, mode: p.mode, repeat: p.repeat,
    loopDelay: p.loopDelay, speed: p.speed, robloxOnly: p.robloxOnly, sideKey: null, sideSound: true, steps: structuredClone(p.steps), createdAt: now, updatedAt: now,
  };
}

/** Primeira abertura: os cinco modelos, em categorias (Bug Indi, GK), todos desativados. */
export function defaultMacrosState(): MacrosState {
  const categories: Category[] = [];
  const idByName = new Map<string, string>();
  for (const t of TEMPLATES) {
    if (!idByName.has(t.group)) { const id = newCategoryId(); idByName.set(t.group, id); categories.push({ id, name: t.group }); }
  }
  const macros = TEMPLATES.map((t) => fromTemplate(t, idByName.get(t.group)!));
  return { v: 4, categories, macros, stopKey: 'F8' };
}

// ───────── ids / validação ─────────

export function newMacroId(): string {
  try {
    return 'm-' + crypto.randomUUID().slice(0, 13);
  } catch {
    return 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}

export function newCategoryId(): string {
  try {
    return 'c-' + crypto.randomUUID().slice(0, 13);
  } catch {
    return 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}

export function sanitizeCategoryName(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function isValidTrigger(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code);
}

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const pos = (v: unknown, d = 0) => Math.max(0, num(v, d));

/** Mesmas regras do Helper (521.js: sanitizeStep), com padrões para o editor. */
export function sanitizeStep(s: unknown): MacroStep | null {
  if (!s || typeof s !== 'object') return null;
  const i = s as Record<string, unknown>;
  if (typeof i.t !== 'string' || !TYPESET.has(i.t)) return null;
  const t = i.t as StepType;
  const o: MacroStep = { t };
  if (t !== 'wait' && i.delay != null && pos(i.delay) > 0) o.delay = pos(i.delay);
  const btn = (v: unknown) => (typeof v === 'string' && BTNSET.has(v) ? v : 'left');
  const code = (v: unknown, d: string) => (typeof v === 'string' && v ? v.slice(0, 40) : d);
  switch (t) {
    case 'flick': {
      o.btn = i.btn === 'none' ? 'none' : btn(i.btn);
      o.pre = pos(i.pre, 0); o.hold = pos(i.hold, 500); o.afterUp = pos(i.afterUp, 0);
      const lim = (v: unknown) => Math.min(100000, Math.max(-100000, Math.round(num(v, 0))));
      o.dx = lim(i.dx); o.dy = lim(i.dy);
      o.moveDur = pos(i.moveDur, 0); o.afterMove = pos(i.afterMove, 0); o.cooldown = pos(i.cooldown, 0);
      break;
    }
    case 'move':
      o.x = Math.round(num(i.x)); o.y = Math.round(num(i.y)); o.dur = pos(i.dur, 0);
      if (i.rel) o.rel = true;
      if (i.ease) o.ease = true;
      break;
    case 'path':
      o.pts = (Array.isArray(i.pts) ? i.pts : []).slice(0, 600000).map((v) => num(v));
      if (i.rel) o.rel = true;
      break;
    case 'click':
      o.btn = btn(i.btn); o.n = Math.max(1, Math.round(num(i.n, 1))); o.hold = pos(i.hold, 40); o.gap = pos(i.gap, 60);
      break;
    case 'down': case 'up':
      o.btn = btn(i.btn);
      break;
    case 'scroll':
      o.amount = Math.round(num(i.amount, 1)) || 1; o.gap = pos(i.gap, 20);
      break;
    case 'key':
      o.code = code(i.code, 'KeyE'); o.n = Math.max(1, Math.round(num(i.n, 1))); o.hold = pos(i.hold, 40); o.gap = pos(i.gap, 60);
      break;
    case 'keydown': case 'keyup':
      o.code = code(i.code, 'KeyW');
      break;
    case 'text':
      o.text = String(i.text ?? '').slice(0, 5000); o.gap = pos(i.gap, 15);
      break;
    case 'wait':
      o.ms = pos(i.ms, 0);
      break;
  }
  return o;
}

export function defaultStep(t: StepType): MacroStep {
  return sanitizeStep(
    t === 'flick' ? { t, btn: 'left', pre: 0, hold: 500, afterUp: 0, dx: 0, dy: 0 }
      : t === 'scroll' ? { t, amount: -1, gap: 20 }
        : t === 'wait' ? { t, ms: 100 }
          : { t },
  )!;
}

/** Tem flick com movimento para a esquerda/direita (o único que dá para alternar o lado). */
export function hasSideFlick(steps: MacroStep[]): boolean {
  return steps.some((s) => s.t === 'flick' && Number(s.dx) !== 0);
}

/** Normaliza uma macro vinda do armazenamento, de importação ou do editor. */
export function sanitizeMacro(m: unknown, opts: { forceDisabled?: boolean; keepId?: boolean } = {}): Macro | null {
  if (!m || typeof m !== 'object') return null;
  const i = m as Record<string, unknown>;
  const now = Date.now();
  const steps = (Array.isArray(i.steps) ? i.steps : []).slice(0, 20000).map(sanitizeStep).filter((s): s is MacroStep => !!s);
  return {
    id: opts.keepId !== false && typeof i.id === 'string' && i.id ? i.id.slice(0, 80) : newMacroId(),
    name: (typeof i.name === 'string' && i.name.trim() ? i.name.trim() : 'Ação').slice(0, 80),
    categoryId: typeof i.categoryId === 'string' && i.categoryId ? i.categoryId.slice(0, 80) : null,
    enabled: opts.forceDisabled ? false : i.enabled === true,
    trigger: isValidTrigger(i.trigger) ? i.trigger : null,
    mode: (['once', 'loop', 'hold'] as const).includes(i.mode as MacroMode) ? (i.mode as MacroMode) : 'once',
    repeat: Math.max(1, Math.round(num(i.repeat, 1))),
    loopDelay: pos(i.loopDelay, 0),
    speed: Math.min(50, Math.max(0.05, num(i.speed, 1))),
    robloxOnly: !!i.robloxOnly,
    // Só para flick que vai para a esquerda/direita (X ≠ 0); flick só para baixo não alterna.
    sideKey: isValidTrigger(i.sideKey) && i.sideKey !== i.trigger && hasSideFlick(steps) ? i.sideKey : null,
    sideSound: i.sideSound !== false,
    steps,
    createdAt: num(i.createdAt, now) || now,
    updatedAt: num(i.updatedAt, now) || now,
  };
}

/** Problemas que impedem ativar/salvar uma macro. */
export function macroProblems(m: Macro): string[] {
  const p: string[] = [];
  if (!m.name.trim()) p.push('Dê um nome à ação.');
  if (!m.steps.length) p.push('Adicione pelo menos uma etapa.');
  if (!m.trigger) p.push('Defina o botão ou tecla que ativa a ação.');
  if (m.sideKey && m.sideKey === m.trigger) p.push('O botão de alternar o lado tem que ser diferente do botão da ação.');
  return p;
}

export function canActivate(m: Macro) {
  return !!m.trigger && m.steps.length > 0;
}

// ───────── estado salvo + migrações ─────────

const isAhk = (o: Record<string, unknown>) => /ahk/i.test(String(o.category ?? '')) || /\(AHK\)/i.test(String(o.name ?? ''));

/** Garante que exista uma categoria com este nome; devolve o id (cria se faltar). */
function ensureCategory(cats: Category[], name: string): string {
  const clean = sanitizeCategoryName(name);
  if (!clean) return '';
  const found = cats.find((c) => c.name.toLowerCase() === clean.toLowerCase());
  if (found) return found.id;
  const id = newCategoryId();
  cats.push({ id, name: clean });
  return id;
}

/**
 * Restaura o estado salvo no navegador.
 *  - v4 (atual): categorias como entidades + ações com categoryId.
 *  - v3 (anterior): ações tinham a categoria como texto (`group`); viram categorias.
 *  - v2 (site que ativava sozinho): mantém botões, tudo DESATIVADO.
 *  - v1 (site antigo): importa as macros do usuário (sem AHK Flick), desativadas.
 */
export function restoreMacrosState(v4: unknown, v2?: unknown, v1?: unknown): MacrosState {
  if (v4 && typeof v4 === 'object' && (v4 as MacrosState).v === 4) {
    const s = v4 as MacrosState;
    const categories = (Array.isArray(s.categories) ? s.categories : [])
      .map((c) => (c && typeof c === 'object' && typeof (c as Category).id === 'string' ? { id: (c as Category).id.slice(0, 80), name: sanitizeCategoryName((c as Category).name) } : null))
      .filter((c): c is Category => !!c && !!c.name);
    const valid = new Set(categories.map((c) => c.id));
    const seen = new Set<string>();
    const macros = (Array.isArray(s.macros) ? s.macros : []).map((m) => sanitizeMacro(m)).filter((m): m is Macro => {
      if (!m || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    for (const m of macros) {
      if (m.categoryId && !valid.has(m.categoryId)) m.categoryId = null; // categoria sumiu → sem categoria
      if (m.enabled && !canActivate(m)) m.enabled = false;
    }
    return { v: 4, categories, macros, stopKey: isValidTrigger(s.stopKey) ? s.stopKey : 'F8' };
  }
  // v3: ações com `group` (texto) → vira categorias-entidade, na ordem de aparição.
  if (v4 && typeof v4 === 'object' && (v4 as { v?: number }).v === 3) {
    const s = v4 as { macros?: unknown[]; stopKey?: unknown };
    const categories: Category[] = [];
    const seen = new Set<string>();
    const macros: Macro[] = [];
    for (const raw of Array.isArray(s.macros) ? s.macros : []) {
      const m = sanitizeMacro(raw);
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      const g = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).group : undefined;
      m.categoryId = typeof g === 'string' && g.trim() ? ensureCategory(categories, g) : null;
      if (m.enabled && !canActivate(m)) m.enabled = false;
      macros.push(m);
    }
    return { v: 4, categories, macros, stopKey: isValidTrigger(s.stopKey) ? s.stopKey : 'F8' };
  }
  if (v2 && typeof v2 === 'object' && (v2 as { v?: number }).v === 2) {
    const s = v2 as { actions?: Array<{ id?: string; group?: string; trigger?: unknown; macro?: Record<string, unknown> }>; stopKey?: unknown };
    const base = defaultMacrosState();
    const byId = new Map((s.actions ?? []).map((a) => [a?.id, a]));
    for (const m of base.macros) {
      const old = byId.get(m.id);
      if (old && (old.trigger === null || isValidTrigger(old.trigger))) m.trigger = (old.trigger as string | null) ?? null;
    }
    if (isValidTrigger(s.stopKey)) base.stopKey = s.stopKey;
    return base;
  }
  if (v1 && typeof v1 === 'object' && Array.isArray((v1 as { macros?: unknown }).macros)) {
    const base = defaultMacrosState();
    const templateNames = new Set(base.macros.map((m) => m.name.toLowerCase()));
    for (const raw of (v1 as { macros: unknown[] }).macros) {
      if (!raw || typeof raw !== 'object' || isAhk(raw as Record<string, unknown>)) continue;
      const m = sanitizeMacro(raw, { forceDisabled: true });
      if (!m || templateNames.has(m.name.toLowerCase())) continue; // o modelo já existe
      if (base.macros.some((x) => x.id === m.id)) m.id = newMacroId();
      const cat = (raw as Record<string, unknown>).category ?? (raw as Record<string, unknown>).group;
      m.categoryId = typeof cat === 'string' && cat.trim() ? ensureCategory(base.categories, cat) : null;
      base.macros.push(m);
    }
    const sk = (v1 as { settings?: { stopKey?: unknown } }).settings?.stopKey;
    if (isValidTrigger(sk)) base.stopKey = sk;
    return base;
  }
  return defaultMacrosState();
}

// ───────── operações (puras) ─────────

export function setEnabled(st: MacrosState, id: string, enabled: boolean): MacrosState {
  return { ...st, macros: st.macros.map((m) => (m.id === id ? { ...m, enabled: enabled && canActivate(m) } : m)) };
}

/** Ativa/desativa todas. Ao ativar, só as que podem rodar (com botão e etapas). */
export function setAllEnabled(st: MacrosState, enabled: boolean): MacrosState {
  return { ...st, macros: st.macros.map((m) => ({ ...m, enabled: enabled && canActivate(m) })) };
}

// ───────── categorias (pastas = entidades) ─────────

/** categoryId efetivo (null se a categoria não existe mais). */
function effCat(st: MacrosState, m: Macro): string | null {
  return m.categoryId && st.categories.some((c) => c.id === m.categoryId) ? m.categoryId : null;
}

export interface MacroGroup { category: Category | null; macros: Macro[] }

/**
 * Agrupa em pastas: cada categoria na sua ordem (inclusive vazias), e por fim o
 * grupo "Sem categoria". Dentro de cada pasta, a ordem é a do array de ações.
 */
export function groupMacros(st: MacrosState): MacroGroup[] {
  const by = new Map<string, Macro[]>();
  const uncat: Macro[] = [];
  for (const m of st.macros) {
    const cid = effCat(st, m);
    if (cid) { if (!by.has(cid)) by.set(cid, []); by.get(cid)!.push(m); }
    else uncat.push(m);
  }
  const groups: MacroGroup[] = st.categories.map((c) => ({ category: c, macros: by.get(c.id) ?? [] }));
  groups.push({ category: null, macros: uncat });
  return groups;
}

/** Cria uma categoria nova (nome único). Devolve o estado e o id criado. */
export function addCategory(st: MacrosState, name: string): { state: MacrosState; id: string } {
  const clean = sanitizeCategoryName(name) || 'Nova categoria';
  const unique = uniqueCategoryName(st.categories, clean);
  const id = newCategoryId();
  return { state: { ...st, categories: [...st.categories, { id, name: unique }] }, id };
}

function uniqueCategoryName(cats: Category[], name: string, ignoreId?: string): string {
  const taken = new Set(cats.filter((c) => c.id !== ignoreId).map((c) => c.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) { const cand = `${name} (${n})`.slice(0, 40); if (!taken.has(cand.toLowerCase())) return cand; }
}

export function renameCategory(st: MacrosState, id: string, name: string): MacrosState {
  const clean = sanitizeCategoryName(name);
  if (!clean) return st;
  const unique = uniqueCategoryName(st.categories, clean, id);
  return { ...st, categories: st.categories.map((c) => (c.id === id ? { ...c, name: unique } : c)) };
}

/** Exclui a categoria: as ações dentro dela voltam a ficar SEM categoria (não são apagadas). */
export function removeCategory(st: MacrosState, id: string): MacrosState {
  return {
    ...st,
    categories: st.categories.filter((c) => c.id !== id),
    macros: st.macros.map((m) => (m.categoryId === id ? { ...m, categoryId: null } : m)),
  };
}

/** Reordena a própria categoria (move a pasta para cima/baixo). */
export function moveCategory(st: MacrosState, id: string, dir: -1 | 1): MacrosState {
  const i = st.categories.findIndex((c) => c.id === id);
  if (i < 0) return st;
  return { ...st, categories: moveItem(st.categories, i, i + dir) };
}

/** Move uma ação para outra categoria (null = sem categoria). */
export function setMacroCategory(st: MacrosState, macroId: string, categoryId: string | null): MacrosState {
  const cid = categoryId && st.categories.some((c) => c.id === categoryId) ? categoryId : null;
  return { ...st, macros: st.macros.map((m) => (m.id === macroId ? { ...m, categoryId: cid, updatedAt: Date.now() } : m)) };
}

/** Reordena uma ação dentro da própria categoria (troca com o vizinho do mesmo grupo). */
export function reorderMacro(st: MacrosState, macroId: string, dir: -1 | 1): MacrosState {
  const idx = st.macros.findIndex((m) => m.id === macroId);
  if (idx < 0) return st;
  const cid = effCat(st, st.macros[idx]);
  for (let j = idx + dir; j >= 0 && j < st.macros.length; j += dir) {
    if (effCat(st, st.macros[j]) === cid) return { ...st, macros: moveItem(st.macros, idx, j) };
  }
  return st;
}

/** Ativa/desativa todas as ações de uma categoria (null = sem categoria). */
export function setCategoryEnabled(st: MacrosState, categoryId: string | null, enabled: boolean): MacrosState {
  return { ...st, macros: st.macros.map((m) => (effCat(st, m) === categoryId ? { ...m, enabled: enabled && canActivate(m) } : m)) };
}

export function upsertMacro(st: MacrosState, m: Macro): MacrosState {
  const exists = st.macros.some((x) => x.id === m.id);
  const fixed = { ...m, enabled: m.enabled && canActivate(m), updatedAt: Date.now() };
  return { ...st, macros: exists ? st.macros.map((x) => (x.id === m.id ? fixed : x)) : [...st.macros, fixed] };
}

export function removeMacro(st: MacrosState, id: string): MacrosState {
  return { ...st, macros: st.macros.filter((m) => m.id !== id) };
}

export function duplicateMacro(st: MacrosState, id: string): { state: MacrosState; copy: Macro | null } {
  const m = st.macros.find((x) => x.id === id);
  if (!m) return { state: st, copy: null };
  const now = Date.now();
  const copy: Macro = { ...structuredClone(m), id: newMacroId(), name: `${m.name} (cópia)`.slice(0, 80), enabled: false, createdAt: now, updatedAt: now };
  const idx = st.macros.indexOf(m);
  const macros = [...st.macros.slice(0, idx + 1), copy, ...st.macros.slice(idx + 1)];
  return { state: { ...st, macros }, copy };
}

/** Outras macros ATIVAS no mesmo botão (rodariam juntas). */
export function activeConflicts(st: MacrosState, m: Macro): Macro[] {
  if (!m.trigger) return [];
  return st.macros.filter((x) => x.id !== m.id && x.enabled && x.trigger === m.trigger);
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

/** Formato do Helper em /set-macros e /macro/run (521.js: sanitizeMacro). */
export function toHelperMacro(m: Macro) {
  return {
    id: m.id, name: m.name, enabled: m.enabled, trigger: m.trigger,
    mode: m.mode, repeat: m.repeat, loopDelay: m.loopDelay, speed: m.speed,
    robloxOnly: m.robloxOnly, sideKey: m.sideKey, sideSound: m.sideSound, steps: structuredClone(m.steps),
  };
}

// ───────── importação / exportação ─────────

export function toExport(m: Macro, categoryName?: string | null) {
  return {
    bope: 'macro', v: 1, name: m.name, ...(categoryName ? { category: categoryName } : {}), mode: m.mode, repeat: m.repeat, loopDelay: m.loopDelay,
    speed: m.speed, robloxOnly: m.robloxOnly, steps: m.steps, ...(m.trigger ? { trigger: m.trigger } : {}),
    ...(m.sideKey ? { sideKey: m.sideKey, sideSound: m.sideSound } : {}),
  };
}

const catNameById = (st: MacrosState, id: string | null) => (id ? st.categories.find((c) => c.id === id)?.name ?? null : null);

/**
 * Exporta TUDO preservando a estrutura: a lista de categorias (inclusive vazias,
 * na ordem) e cada ação com o nome da categoria dela. Importar reconstrói as pastas.
 */
export function exportAll(st: MacrosState): string {
  return JSON.stringify({
    bope: 'macro-pack', v: 2,
    categories: st.categories.map((c) => ({ name: c.name })),
    macros: st.macros.map((m) => toExport(m, catNameById(st, effCat(st, m)))),
  }, null, 2);
}

/** Exporta uma categoria (ou o grupo "Sem categoria", com categoryId null) com suas ações. */
export function exportCategory(st: MacrosState, categoryId: string | null): string {
  const cat = categoryId ? st.categories.find((c) => c.id === categoryId) ?? null : null;
  const macros = st.macros.filter((m) => effCat(st, m) === (cat ? cat.id : null));
  return JSON.stringify({
    bope: 'macro-pack', v: 2,
    categories: cat ? [{ name: cat.name }] : [],
    macros: macros.map((m) => toExport(m, cat ? cat.name : null)),
  }, null, 2);
}

/** Exporta uma única ação (sem categoria, para compartilhar só a macro). */
export function exportMacro(m: Macro): string {
  return JSON.stringify({ bope: 'macro-pack', v: 2, categories: [], macros: [toExport(m, null)] }, null, 2);
}

const CODE_PREFIXES = { plain: ['BOPE-SEQ1:', 'BOPE-MACRO1:'], deflate: ['BOPE-SEQ1Z:', 'BOPE-MACRO1Z:'] };

function unB64(str: string): Uint8Array {
  const b = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '==='.slice((b.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return out;
}

/** Decodifica JSON ou os códigos de compartilhamento do site antigo (BOPE-SEQ1/BOPE-MACRO1). */
export async function decodeShare(text: string): Promise<unknown> {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('Cole um JSON ou um código BOPE-SEQ1.');
  const compact = t.replace(/\s+/g, '');
  const z = CODE_PREFIXES.deflate.find((p) => compact.startsWith(p));
  if (z) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não descomprime o código (atualize o navegador).');
    const stream = new Blob([unB64(compact.slice(z.length)) as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(stream).text());
  }
  const p = CODE_PREFIXES.plain.find((x) => compact.startsWith(x));
  return JSON.parse(p ? new TextDecoder().decode(unB64(compact.slice(p.length))) : t);
}

/** Uma ação importada, com o nome da categoria a que pertencia (string ou null). */
export interface ImportedItem { macro: Macro; categoryName: string | null }
/** Pacote importado: categorias (nomes, inclusive vazias, na ordem) + ações. */
export interface ImportedPack { categories: string[]; items: ImportedItem[] }

const catNameOf = (o: Record<string, unknown>): string | null => {
  const raw = o.category ?? o.group;
  return typeof raw === 'string' && raw.trim() ? sanitizeCategoryName(raw) : null;
};

/**
 * Lê um JSON/código e devolve a estrutura (categorias + ações). As ações entram
 * SEMPRE desativadas e com ids novos; as categorias preservam nome e ordem.
 */
export async function parseMacroImport(text: string): Promise<ImportedPack> {
  let data: unknown;
  try {
    data = await decodeShare(text);
  } catch (e) {
    throw new Error(`Não foi possível ler: ${(e as Error).message}`);
  }
  const obj = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
  const list = Array.isArray(data) ? data
    : obj && Array.isArray(obj.macros) ? obj.macros
      : [data];

  // Categorias declaradas no topo (preserva vazias e ordem).
  const order: string[] = [];
  const seenCat = new Set<string>();
  const addCat = (name: string | null) => {
    if (!name) return;
    const key = name.toLowerCase();
    if (!seenCat.has(key)) { seenCat.add(key); order.push(name); }
  };
  if (obj && Array.isArray(obj.categories)) {
    for (const c of obj.categories) {
      const name = typeof c === 'string' ? sanitizeCategoryName(c) : c && typeof c === 'object' ? sanitizeCategoryName((c as { name?: unknown }).name) : '';
      if (name) addCat(name);
    }
  }

  const items: ImportedItem[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || isAhk(raw as Record<string, unknown>)) continue;
    const macro = sanitizeMacro(raw, { forceDisabled: true, keepId: false });
    if (!macro || macro.steps.length === 0) continue;
    const categoryName = catNameOf(raw as Record<string, unknown>);
    macro.categoryId = null; // o id real é atribuído na hora de importar
    addCat(categoryName);
    items.push({ macro, categoryName });
  }
  if (!items.length && !order.length) throw new Error('Nenhuma ação válida encontrada.');
  return { categories: order, items };
}

/** Nomes de categoria do pacote que já existem no estado (para avisar o usuário). */
export function importCollisions(st: MacrosState, pack: ImportedPack): string[] {
  const existing = new Set(st.categories.map((c) => c.name.toLowerCase()));
  return pack.categories.filter((n) => existing.has(n.toLowerCase()));
}

/**
 * Aplica um pacote importado, SEM apagar nada do que já existe.
 *  - 'merge': categorias com o mesmo nome recebem as ações importadas.
 *  - 'new':  cria categorias novas (renomeadas se o nome colidir).
 * As ações entram desativadas e com ids novos; nenhuma ação existente é sobrescrita.
 */
export function applyImport(st: MacrosState, pack: ImportedPack, mode: 'merge' | 'new'): { state: MacrosState; addedCategories: number; addedMacros: number } {
  const categories = [...st.categories];
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const target = new Map<string, string>(); // nome importado (lower) → id de destino
  for (const name of pack.categories) {
    const lower = name.toLowerCase();
    if (mode === 'merge' && byName.has(lower)) { target.set(lower, byName.get(lower)!); continue; }
    const unique = uniqueCategoryName(categories, name);
    const id = newCategoryId();
    categories.push({ id, name: unique });
    byName.set(unique.toLowerCase(), id);
    target.set(lower, id);
  }
  const macros = [...st.macros];
  const ids = new Set(macros.map((m) => m.id));
  let added = 0;
  for (const it of pack.items) {
    const cid = it.categoryName ? target.get(it.categoryName.toLowerCase()) ?? null : null;
    let m: Macro = { ...it.macro, categoryId: cid, enabled: false };
    if (ids.has(m.id)) m = { ...m, id: newMacroId() };
    ids.add(m.id);
    macros.push(m);
    added++;
  }
  return { state: { ...st, categories, macros }, addedCategories: categories.length - st.categories.length, addedMacros: added };
}

// ───────── textos para a interface ─────────

const TRIGGER_LABELS: Record<string, string> = {
  MouseLeft: 'Botão esquerdo', MouseRight: 'Botão direito', MouseMiddle: 'Botão do meio',
  MouseBack: 'Lateral ◄ (voltar)', MouseForward: 'Lateral ► (avançar)',
  VK_A6: 'Voltar (lateral via software)', VK_A7: 'Avançar (lateral via software)',
  ScrollUp: 'Scroll ↑', ScrollDown: 'Scroll ↓', Space: 'Espaço', Enter: 'Enter', Escape: 'Esc',
  ShiftLeft: 'Shift', ShiftRight: 'Shift dir.', ControlLeft: 'Ctrl', ControlRight: 'Ctrl dir.', AltLeft: 'Alt', AltRight: 'AltGr',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'Backspace', Tab: 'Tab',
};

export function triggerLabel(code: string | null | undefined): string {
  if (!code) return 'Sem botão';
  if (TRIGGER_LABELS[code]) return TRIGGER_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
  return code;
}

const BTN_NAMES: Record<string, string> = { left: 'esquerdo', right: 'direito', middle: 'meio', back: 'lateral ◄', forward: 'lateral ►', none: 'nenhum' };

export function describeStep(s: MacroStep): string {
  const n = (k: string) => Number(s[k] ?? 0);
  const pre = s.delay ? `após ${s.delay} ms: ` : '';
  switch (s.t) {
    case 'flick': {
      const dir = [n('dx') ? `X ${n('dx') > 0 ? '+' : ''}${n('dx')}` : '', n('dy') ? `Y ${n('dy') > 0 ? '+' : ''}${n('dy')}` : ''].filter(Boolean).join(' · ') || 'sem movimento';
      const press = s.btn === 'none' ? '' : `segura botão ${BTN_NAMES[String(s.btn)] ?? s.btn} ${n('hold')} ms → espera ${n('afterUp')} ms → `;
      return `${pre}Flick: espera ${n('pre')} ms → ${press}move ${dir}`;
    }
    case 'key': return `${pre}Tecla ${triggerLabel(String(s.code))}${n('n') > 1 ? ` ×${n('n')}` : ''} (segura ${n('hold')} ms)`;
    case 'keydown': return `${pre}Segura a tecla ${triggerLabel(String(s.code))}`;
    case 'keyup': return `${pre}Solta a tecla ${triggerLabel(String(s.code))}`;
    case 'click': return `${pre}Clique ${BTN_NAMES[String(s.btn)] ?? s.btn}${n('n') > 1 ? ` ×${n('n')}` : ''} (segura ${n('hold')} ms)`;
    case 'down': return `${pre}Segura o botão ${BTN_NAMES[String(s.btn)] ?? s.btn}`;
    case 'up': return `${pre}Solta o botão ${BTN_NAMES[String(s.btn)] ?? s.btn}`;
    case 'move': return `${pre}Move o mouse ${s.rel ? `${n('x')}, ${n('y')} (relativo)` : `para ${n('x')}, ${n('y')}`}${n('dur') ? ` em ${n('dur')} ms` : ''}`;
    case 'path': return `${pre}Trajetória gravada (${Math.floor(((s.pts as unknown[]) ?? []).length / 3)} pontos${s.rel ? ', relativa' : ''})`;
    case 'scroll': return `${pre}Scroll ${n('amount') > 0 ? '↑' : '↓'} ${Math.abs(n('amount'))}×`;
    case 'text': return `${pre}Digita “${String(s.text ?? '').slice(0, 30)}${String(s.text ?? '').length > 30 ? '…' : ''}”`;
    case 'wait': return `Espera ${n('ms')} ms`;
    default: return s.t;
  }
}

/** Duração aproximada de uma execução (mesma conta do Helper, 592.js). */
export function stepMs(s: MacroStep): number {
  const n = (k: string, d = 0) => (Number.isFinite(Number(s[k])) ? Number(s[k]) : d);
  let ms = s.t === 'wait' ? 0 : n('delay');
  switch (s.t) {
    case 'wait': ms += n('ms'); break;
    case 'flick': ms += n('pre') + (s.btn === 'none' ? 0 : n('hold', 500)) + n('afterUp') + n('moveDur') + n('afterMove') + n('cooldown'); break;
    case 'move': ms += n('dur'); break;
    case 'path': { const p = (s.pts as number[]) ?? []; for (let k = 0; k < p.length; k += 3) ms += Number(p[k]) || 0; break; }
    case 'click': case 'key': { const c = Math.max(1, n('n', 1)); ms += c * n('hold', 40) + (c - 1) * n('gap', 60); break; }
    case 'scroll': ms += Math.max(0, Math.abs(n('amount', 1)) - 1) * n('gap', 20); break;
    case 'text': ms += Math.max(0, String(s.text ?? '').length - 1) * n('gap', 15); break;
  }
  return ms;
}

export function macroMs(m: Macro): number {
  return Math.round(m.steps.reduce((a, s) => a + stepMs(s), 0) / (m.speed || 1));
}
