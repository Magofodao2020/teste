// Cliente do Helper local (Node.js em 127.0.0.1). Só conversa com a máquina do
// usuário; o Helper não tem internet e só usa o que o site envia.

import { type FlagOriginal, parseOriginals } from './originals';

export const HELPER_PORTS = [7962, 7963, 7964, 7965, 7966];
const PROBE_TIMEOUT_MS = 800;
/** Porta onde o Helper já estava: espera mais (PC ocupado / jogo pesado não é queda). */
const KNOWN_PORT_TIMEOUT_MS = 3000;
const POST_TIMEOUT_MS = 8_000;
const BIG_POST_TIMEOUT_MS = 20_000;

export interface HelperDetection {
  state: 'running' | 'not-running' | 'unknown';
  version: string | null;
  reason: string;
}

export interface HelperStatus {
  port: number;
  helperVersion: string;
  platform: string;
  startedAt: number | null;
  ffiReady: boolean;
  robloxFound: boolean;
  robloxPid: number | null;
  /** Versão do Roblox em execução, identificada pelo Helper no processo. */
  runningBuild: string | null;
  detection: HelperDetection | null;
  /** Versão dos offsets que o Helper recebeu do site (em memória). */
  siteOffsetsBuild: string | null;
  canApply: boolean;
  /** Processo do Roblox (PID + horário de criação) e originais que o Helper capturou nele. */
  flagSession?: string | null;
  /** Turbo do Helper (reaplica o que o Roblox desfizer); null = Helper antigo. */
  turbo: { active: boolean; reapplied: number } | null;
  originals?: FlagOriginal[];
}

export interface RecordStatus {
  state: 'idle' | 'countdown' | 'recording' | 'done';
  events: number;
  elapsedMs: number;
  stopKey: string;
  steps: unknown[] | null;
}

export interface HelperResult {
  ok: boolean;
  message: string;
  blocked?: boolean;
  [k: string]: unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);

export function parseStatus(port: number, s: Record<string, unknown>): HelperStatus | null {
  if (!s || s.helper !== 'gerenciador-helper') return null;
  const det = s.detection && typeof s.detection === 'object' ? (s.detection as Record<string, unknown>) : null;
  const state = det && ['running', 'not-running', 'unknown'].includes(String(det.state)) ? (det.state as HelperDetection['state']) : 'unknown';
  return {
    port,
    helperVersion: String(s.helperVersion ?? '?'),
    platform: String(s.platform ?? ''),
    startedAt: typeof s.startedAt === 'number' ? s.startedAt : null,
    ffiReady: !!s.ffiReady,
    robloxFound: !!s.robloxFound,
    robloxPid: typeof s.robloxPid === 'number' ? s.robloxPid : null,
    runningBuild: str(s.runningBuild),
    detection: det ? { state, version: str(det.version), reason: String(det.reason ?? '') } : null,
    siteOffsetsBuild: str(s.siteOffsetsBuild),
    canApply: !!s.canApply,
    flagSession: str(s.flagSession),
    turbo: s.turbo && typeof s.turbo === 'object'
      ? { active: !!(s.turbo as Record<string, unknown>).active, reapplied: Number((s.turbo as Record<string, unknown>).reapplied) || 0 }
      : null,
    originals: parseOriginals(s.originals),
  };
}

export class HelperClient {
  private port: number | null = null;
  constructor(private fetchFn: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  private async request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: ctl.signal, cache: 'no-store' });
    } finally {
      clearTimeout(t);
    }
  }

  /** Procura o Helper (porta conhecida primeiro). null = não está rodando. */
  async probe(): Promise<HelperStatus | null> {
    const order = this.port ? [this.port, ...HELPER_PORTS.filter((p) => p !== this.port)] : HELPER_PORTS;
    for (const port of order) {
      try {
        const res = await this.request(`http://127.0.0.1:${port}/status`, { method: 'GET' }, port === this.port ? KNOWN_PORT_TIMEOUT_MS : PROBE_TIMEOUT_MS);
        if (!res.ok) continue;
        const st = parseStatus(port, await res.json());
        if (!st) continue;
        this.port = port;
        return st;
      } catch { /* porta fechada */ }
    }
    this.port = null;
    return null;
  }

  async post(path: string, body: unknown, timeoutMs = POST_TIMEOUT_MS): Promise<HelperResult> {
    if (!this.port) return { ok: false, message: 'Helper local não está rodando.' };
    try {
      const res = await this.request(`http://127.0.0.1:${this.port}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }, timeoutMs);
      const data = (await res.json()) as Record<string, unknown>;
      return { ...data, ok: !!data.ok, message: String(data.message ?? (data.ok ? 'OK.' : 'Falha.')) };
    } catch (e) {
      return { ok: false, message: `Não foi possível falar com o Helper local (${(e as Error).message}).` };
    }
  }

  setOffsets(version: string, names: string[], addresses: string[]) {
    return this.post('/set-offsets', { version, names, addresses }, BIG_POST_TIMEOUT_MS);
  }
  setMacros(macros: unknown[], settings: unknown) { return this.post('/set-macros', { macros, settings }); }
  setOriginals(sessions: unknown[]) { return this.post('/set-originals', { sessions }); }
  setHotkeys(hotkeys: unknown, flags: Record<string, string>) { return this.post('/set-hotkeys', { hotkeys, flags }); }
  apply(flags: Record<string, string>, dumpVersion: string) { return this.post('/apply', { flags, dumpVersion }); }
  pause(flags: Record<string, string>, dumpVersion: string) { return this.post('/pause', { flags, dumpVersion }); }
  resume(flags: Record<string, string>, dumpVersion: string) { return this.post('/resume', { flags, dumpVersion }); }
  runMacro(macro: unknown, countdown: number) { return this.post('/macro/run', { macro, countdown }); }
  recordStart(opts: { moves: 'path' | 'clicks' | 'none'; coords: 'abs' | 'rel'; countdown: number; sampleMs?: number }) {
    return this.post('/macro/record/start', opts);
  }
  recordStop() { return this.post('/macro/record/stop', {}); }
  pickCursor(delay: number) { return this.post('/macro/cursor', { delay }, delay + POST_TIMEOUT_MS); }

  async recordStatus(): Promise<RecordStatus | null> {
    if (!this.port) return null;
    try {
      const res = await this.request(`http://127.0.0.1:${this.port}/macro/record/status`, { method: 'GET' }, PROBE_TIMEOUT_MS * 2);
      const d = (await res.json()) as Record<string, unknown>;
      const state = String(d.state ?? 'idle') as RecordStatus['state'];
      const result = d.result && typeof d.result === 'object' ? (d.result as { steps?: unknown[] }) : null;
      return { state, events: Number(d.events) || 0, elapsedMs: Number(d.elapsedMs) || 0, stopKey: String(d.stopKey ?? 'F8'), steps: Array.isArray(result?.steps) ? result!.steps : null };
    } catch {
      return null;
    }
  }
  stopMacros() { return this.post('/macro/stop', {}); }

  /** "Definir botão" pelo hook do Windows (qualquer navegador, inclusive laterais). */
  captureStart(opts: { mouse: boolean; scroll: boolean; keyboard: boolean }) { return this.post('/capture/start', opts, PROBE_TIMEOUT_MS * 2); }
  captureStop() { return this.post('/capture/stop', {}, PROBE_TIMEOUT_MS * 2); }
  async captureStatus(): Promise<{ active: boolean; code: string | null; id: number } | null> {
    if (!this.port) return null;
    try {
      const res = await this.request(`http://127.0.0.1:${this.port}/capture/status`, { method: 'GET' }, PROBE_TIMEOUT_MS);
      const d = (await res.json()) as Record<string, unknown>;
      return { active: !!d.active, code: typeof d.code === 'string' ? d.code : null, id: Number(d.id) || 0 };
    } catch {
      return null;
    }
  }
}
