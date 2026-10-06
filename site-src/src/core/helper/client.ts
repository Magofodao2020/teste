// Cliente do Helper local (Node.js em 127.0.0.1). Só conversa com a máquina do
// usuário; o Helper não tem internet e só usa o que o site envia.

export const HELPER_PORTS = [7962, 7963, 7964, 7965, 7966];
const PROBE_TIMEOUT_MS = 800;
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
        const res = await this.request(`http://127.0.0.1:${port}/status`, { method: 'GET' }, PROBE_TIMEOUT_MS);
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
  setHotkeys(hotkeys: unknown, flags: Record<string, string>) { return this.post('/set-hotkeys', { hotkeys, flags }); }
  apply(flags: Record<string, string>, dumpVersion: string) { return this.post('/apply', { flags, dumpVersion }); }
  pause(flags: Record<string, string>, dumpVersion: string) { return this.post('/pause', { flags, dumpVersion }); }
  resume(flags: Record<string, string>, dumpVersion: string) { return this.post('/resume', { flags, dumpVersion }); }
  runMacro(macro: unknown, countdown: number) { return this.post('/macro/run', { macro, countdown }); }
  stopMacros() { return this.post('/macro/stop', {}); }
}
