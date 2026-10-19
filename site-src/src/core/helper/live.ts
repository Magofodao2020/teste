// Estado AO VIVO do executor (Helper): o que está rodando, fila, Gagatech direta
// e o histórico com latências. O site só lê e mostra; nada daqui executa ações.

export interface LiveRun { id: string; name: string; since: number }
export interface DirectInfo { slot: number; presses: number; fails: number; held: boolean; last: number }
export interface MacroLive {
  running: LiveRun[];
  queued: Array<{ id: string; name: string; group: string }>;
  hookReady: boolean;
  workers: { total: number; busy: number; max: number };
  sides: Record<string, string>;
  direct: Record<string, DirectInfo>;
  /** Por que uma ação "segurar junto" NÃO roda direto no hook (null = roda direto). */
  directWhy: Record<string, string | null>;
  historySeq: number;
  simulated: boolean;
}

export interface HistoryEntry {
  seq: number; id: string; name: string; at: number;
  result: 'concluída' | 'parada' | 'solta' | 'erro' | 'bloqueada' | 'direto' | string;
  error: string | null;
  iterations: number;
  /** duração real (ms) */
  ms: number | null;
  /** gatilho → primeira entrada enviada (ms) */
  latency: number | null;
  steps: number;
  /** duração planejada (ms) */
  planned: number | null;
  lateMax: number | null;
  lateAvg: number | null;
  stalls: number;
}

const numOr = (v: unknown, d: number | null = null) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function parseLive(d: unknown): MacroLive | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const running = arr(o.running).flatMap((r) => {
    const x = r as Record<string, unknown>;
    return typeof x.id === 'string' ? [{ id: x.id, name: String(x.name ?? ''), since: Number(x.since) || 0 }] : [];
  });
  const queued = arr(o.queued).flatMap((r) => {
    const x = r as Record<string, unknown>;
    return typeof x.id === 'string' ? [{ id: x.id, name: String(x.name ?? ''), group: String(x.group ?? '') }] : [];
  });
  const direct: Record<string, DirectInfo> = {};
  if (o.direct && typeof o.direct === 'object') {
    for (const [id, v] of Object.entries(o.direct as Record<string, Record<string, unknown>>)) {
      direct[id] = { slot: Number(v.slot) || 0, presses: Number(v.presses) || 0, fails: Number(v.fails) || 0, held: !!v.held, last: Number(v.last) || 0 };
    }
  }
  const directWhy: Record<string, string | null> = {};
  if (o.directWhy && typeof o.directWhy === 'object') {
    for (const [id, v] of Object.entries(o.directWhy as Record<string, unknown>)) directWhy[id] = typeof v === 'string' ? v : null;
  }
  const w = (o.workers && typeof o.workers === 'object' ? o.workers : {}) as Record<string, unknown>;
  return {
    running, queued, hookReady: !!o.hookReady,
    workers: { total: Number(w.total) || 0, busy: Number(w.busy) || 0, max: Number(w.max) || 0 },
    sides: o.sides && typeof o.sides === 'object' ? (o.sides as Record<string, string>) : {},
    direct, directWhy, historySeq: Number(o.historySeq) || 0, simulated: !!o.simulated,
  };
}

export function parseHistory(d: unknown): { seq: number; items: HistoryEntry[] } {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  const items = (Array.isArray(o.items) ? o.items : []).flatMap((r) => {
    const x = r as Record<string, unknown>;
    if (typeof x.id !== 'string' || typeof x.seq !== 'number') return [];
    return [{
      seq: x.seq, id: x.id, name: String(x.name ?? ''), at: Number(x.at) || 0, result: String(x.result ?? ''),
      error: typeof x.error === 'string' ? x.error : null, iterations: Number(x.iterations) || 0,
      ms: numOr(x.ms), latency: numOr(x.latency), steps: Number(x.steps) || 0, planned: numOr(x.planned),
      lateMax: numOr(x.lateMax), lateAvg: numOr(x.lateAvg), stalls: Number(x.stalls) || 0,
    } as HistoryEntry];
  });
  return { seq: Number(o.seq) || 0, items };
}

export const HISTORY_KEEP = 500;

/** Junta o histórico novo ao que já temos (sem duplicar, mais novo por último, limitado). */
export function mergeHistory(cur: HistoryEntry[], add: HistoryEntry[]): HistoryEntry[] {
  if (!add.length) return cur;
  const last = cur.length ? cur[cur.length - 1].seq : 0;
  const fresh = add.filter((h) => h.seq > last);
  // o Helper reiniciou (seq voltou): começa de novo
  if (add.length && add[0].seq <= last && !fresh.length && add[add.length - 1].seq < last) return add.slice(-HISTORY_KEEP);
  const out = [...cur, ...fresh];
  return out.length > HISTORY_KEEP ? out.slice(-HISTORY_KEEP) : out;
}

export interface MacroStats {
  id: string; name: string; runs: number; errors: number; blocked: number;
  latAvg: number | null; latMin: number | null; latMax: number | null; latJitter: number | null;
  msAvg: number | null; plannedAvg: number | null; lateMax: number | null; stalls: number; stepsAvg: number;
}

/** Estatísticas por ação a partir do histórico (latência média, variação, atrasos). */
export function statsByMacro(hist: HistoryEntry[]): MacroStats[] {
  const by = new Map<string, HistoryEntry[]>();
  for (const h of hist) by.set(h.id, [...(by.get(h.id) ?? []), h]);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const out: MacroStats[] = [];
  for (const [id, list] of by) {
    const lat = list.map((h) => h.latency).filter((v): v is number => v != null);
    const la = avg(lat);
    const jitter = la != null && lat.length > 1 ? Math.sqrt(lat.reduce((s, v) => s + (v - la) ** 2, 0) / lat.length) : null;
    const lm = list.map((h) => h.lateMax).filter((v): v is number => v != null);
    out.push({
      id, name: list[list.length - 1].name, runs: list.length,
      errors: list.filter((h) => h.result === 'erro').length, blocked: list.filter((h) => h.result === 'bloqueada').length,
      latAvg: la, latMin: lat.length ? Math.min(...lat) : null, latMax: lat.length ? Math.max(...lat) : null, latJitter: jitter,
      msAvg: avg(list.map((h) => h.ms).filter((v): v is number => v != null)),
      plannedAvg: avg(list.map((h) => h.planned).filter((v): v is number => v != null)),
      lateMax: lm.length ? Math.max(...lm) : null, stalls: list.reduce((s, h) => s + h.stalls, 0),
      stepsAvg: avg(list.map((h) => h.steps)) ?? 0,
    });
  }
  return out.sort((a, b) => b.runs - a.runs);
}
