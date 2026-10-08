// Acesso ao serviço de offsets a partir do NAVEGADOR, com diagnóstico preciso.
//
// Por que existe: quando um fetch falha por CORS, DNS, certificado ou falta de
// internet, o navegador entrega ao JavaScript sempre o mesmo `TypeError: Failed to
// fetch` — por segurança ele não diz o motivo. Para não "chutar", este módulo:
//   1. tenta o pedido normal (mode: 'cors');
//   2. se falhar com TypeError, faz uma sonda `mode: 'no-cors'` na mesma URL:
//        - a sonda RESPONDE  → o servidor está acessível e respondeu, mas o
//          navegador não deixou o site ler a resposta = CORS confirmado;
//        - a sonda TAMBÉM FALHA → não houve conexão (DNS, certificado, firewall,
//          antivírus/extensão ou sem internet);
//   3. só com CORS confirmado usa o proxy do PRÓPRIO site (mesma origem:
//      /api/imtheo/...), se o hosting tiver um. O Helper nunca participa.

export const UPSTREAM_ORIGIN = 'https://offsets.imtheo.lol';
export type UpstreamPath = 'roblox/version' | 'offsets.json' | 'FFlags.hpp';

export type FailKind = 'offline' | 'network' | 'cors' | 'timeout' | 'http' | 'empty' | 'invalid';
export type Via = 'direto' | 'proxy do site';

export interface RequestInfo {
  url: string;
  /** Origem que o navegador envia no cabeçalho Origin. */
  origin: string;
  via: Via;
  status?: number;
  contentType?: string;
  redirectedTo?: string;
  durationMs?: number;
  sample?: string;
  /** Resposta veio do proxy do site (cabeçalho X-Bope-Proxy). */
  proxyActive?: boolean;
}

export class RemoteError extends Error {
  constructor(readonly kind: FailKind, message: string, readonly info: RequestInfo) {
    super(message);
  }
}

export interface RemoteText { text: string; info: RequestInfo }

const PROXY_PREFIX = 'api/imtheo/';

function pageOrigin(): string {
  try { return globalThis.location?.origin && globalThis.location.origin !== 'null' ? globalThis.location.origin : 'null (arquivo local)'; } catch { return 'desconhecida'; }
}

/** Trecho legível do corpo para mensagens de erro (nunca HTML inteiro). */
export function sampleOf(text: string): string {
  const s = text.replace(/^﻿/, '').replace(/\s+/g, ' ').trim();
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export class RemoteClient {
  /** 'proxy' depois que CORS for confirmado e o proxy do site funcionar. */
  private route: 'direct' | 'proxy' = 'direct';
  constructor(private fetchFn: typeof fetch, private siteBase: string, private now: () => number = Date.now) {}

  get usingProxy() { return this.route === 'proxy'; }

  async get(path: UpstreamPath, timeoutMs: number): Promise<RemoteText> {
    if (this.route === 'proxy') return this.viaProxy(path, timeoutMs, null);
    const url = `${UPSTREAM_ORIGIN}/${path}`;
    const info: RequestInfo = { url, origin: pageOrigin(), via: 'direto' };
    const t0 = this.now();
    try {
      return await this.request(url, timeoutMs, info);
    } catch (e) {
      if (e instanceof RemoteError) throw e;
      info.durationMs = this.now() - t0;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new RemoteError('offline', 'O navegador está sem conexão com a internet.', info);
      }
      const reachable = await this.probeNoCors(url, timeoutMs);
      if (!reachable) {
        throw new RemoteError('network', `Não foi possível conectar a ${new URL(url).host} (DNS, certificado, firewall/antivírus, extensão do navegador ou sem internet — o navegador não informa qual).`, info);
      }
      const cors = new RemoteError('cors', `CORS bloqueou a leitura da resposta: ${new URL(url).host} respondeu, mas não autoriza a origem ${info.origin}.`, info);
      return this.viaProxy(path, timeoutMs, cors);
    }
  }

  /** Pedido normal; erros HTTP/timeout viram RemoteError, falhas de rede sobem como TypeError. */
  private async request(url: string, timeoutMs: number, info: RequestInfo): Promise<RemoteText> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const t0 = this.now();
    try {
      const res = await this.fetchFn(url, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: ctl.signal });
      info.status = res.status;
      info.contentType = res.headers?.get?.('content-type') ?? undefined;
      if (res.headers?.get?.('x-bope-proxy') === '1') info.proxyActive = true;
      if (res.redirected && res.url && res.url !== url) info.redirectedTo = res.url;
      // text() só resolve com o corpo completo: queda no meio = exceção, nunca dado parcial.
      const text = await res.text();
      info.durationMs = this.now() - t0;
      if (!res.ok) {
        info.sample = sampleOf(text);
        throw new RemoteError('http', `O serviço respondeu HTTP ${res.status}${res.statusText ? ` (${res.statusText})` : ''}.`, info);
      }
      return { text, info };
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        info.durationMs = this.now() - t0;
        throw new RemoteError('timeout', `Sem resposta em ${Math.round(timeoutMs / 1000)} s (tempo esgotado).`, info);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Sonda sem CORS: resolve (resposta opaca) se o servidor respondeu de fato. */
  private async probeNoCors(url: string, timeoutMs: number): Promise<boolean> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      await this.fetchFn(url, { method: 'GET', mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal: ctl.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Proxy do próprio site (mesma origem). Só é usado com CORS confirmado. */
  private async viaProxy(path: UpstreamPath, timeoutMs: number, corsError: RemoteError | null): Promise<RemoteText> {
    const url = `${this.siteBase}${PROXY_PREFIX}${path}`;
    const info: RequestInfo = { url, origin: pageOrigin(), via: 'proxy do site' };
    const host = new URL(`${UPSTREAM_ORIGIN}/`).host;
    let r: RemoteText | null = null;
    let err: unknown = null;
    try {
      r = await this.request(url, timeoutMs, info);
    } catch (e) {
      err = e;
    }
    // "Página do site" é decidido pelo CORPO: o serviço de offsets responde a versão
    // com Content-Type text/html, então o cabeçalho sozinho não prova nada.
    const html = r ? /^\s*<(!doctype|html|head|body)/i.test(r.text) : /text\/html/i.test(info.contentType ?? '');
    // Proxy ausente: a rota não existe (404/405) ou o hosting devolveu a página do
    // site (fallback de SPA), sem o cabeçalho de identificação do proxy.
    const absent = !info.proxyActive && (html || info.status === 404 || info.status === 405 || (err != null && !(err instanceof RemoteError)));
    // Com o proxy ativo, qualquer 2xx é aceito aqui, mesmo com Content-Type text/html
    // (o serviço de offsets envia a versão assim). O conteúdo é validado depois por
    // parseLiveVersion/parseOffsetsJson/parseFFlagsHpp, que recusam HTML de verdade.
    if (r && (info.proxyActive || (!absent && !html))) {
      this.route = 'proxy';
      return r;
    }
    const prefix = corsError ? `${corsError.message} ` : '';
    if (absent) {
      throw new RemoteError(corsError ? 'cors' : 'network', `${prefix}O proxy do site (/api/imtheo/) não está ativo neste hosting: a rota ${info.status === 404 ? 'não existe (HTTP 404)' : html ? 'devolveu a página do site em vez do serviço' : 'não respondeu'}. No Cloudflare Pages isso significa que o _worker.js não foi publicado (veja o README).`, corsError?.info ?? info);
    }
    // Proxy ativo: o erro é do próprio serviço de offsets.
    const st = info.status != null ? `HTTP ${info.status}` : 'erro';
    const sample = info.sample ? ` (início da resposta: "${info.sample}")` : '';
    throw new RemoteError('http', `${prefix}O proxy do site está ativo, mas ${host} respondeu ${st} para /${path}${sample}.`, info);
  }
}

/**
 * Lê a versão LIVE da resposta. Aceita somente:
 *   - texto puro `version-<16 hex>` (espaços/quebras de linha nas pontas são ignorados);
 *   - JSON string "version-…" ou objeto com o campo de versão (version, robloxVersion…).
 * Qualquer outra coisa (HTML, mensagem de erro, versão malformada) é recusada.
 */
export function parseLiveVersion(text: string): { version: string } | { error: 'empty' | 'invalid' } {
  const body = text.replace(/^﻿/, '').trim();
  if (!body) return { error: 'empty' };
  const check = (v: unknown) => (typeof v === 'string' && /^version-[0-9a-f]{16}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
  const direct = check(body);
  if (direct) return { version: direct };
  if (body.startsWith('{') || body.startsWith('"')) {
    try {
      const data: unknown = JSON.parse(body);
      const fromString = check(data);
      if (fromString) return { version: fromString };
      if (data && typeof data === 'object') {
        const o = data as Record<string, unknown>;
        for (const k of ['version', 'Version', 'robloxVersion', 'RobloxVersion', 'Roblox Version', 'clientVersion', 'ClientVersion']) {
          const v = check(o[k]);
          if (v) return { version: v };
        }
      }
    } catch { /* não é JSON */ }
  }
  return { error: 'invalid' };
}
