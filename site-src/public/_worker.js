// Cloudflare Pages (modo avançado) / Worker: proxy do PRÓPRIO site para o serviço
// de offsets. Só é usado pelo navegador quando o CORS do serviço bloqueia a leitura
// direta. Lista fechada de caminhos, só GET, sem cookies/credenciais, com cache
// na borda. Todo o resto é servido como arquivo estático (env.ASSETS).
// O Helper local não tem nada a ver com isto e continua sem internet.
//
// Toda resposta do proxy leva X-Bope-Proxy: 1 e X-Bope-Upstream-Status, para o
// site distinguir "proxy ausente" de "o serviço respondeu erro".
const UPSTREAM = 'https://offsets.imtheo.lol';
const ALLOWED = { 'roblox/version': 60, 'offsets.json': 300, 'FFlags.hpp': 300 };
const MAX_BYTES = 32 * 1024 * 1024;

function reply(body, status, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Bope-Proxy': '1', 'Cache-Control': 'no-store', ...extra },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/imtheo/')) return env.ASSETS.fetch(request);
    const path = url.pathname.slice('/api/imtheo/'.length);
    if (path === '_status') {
      return reply(JSON.stringify({ ok: true, proxy: 'painel-bope', upstream: UPSTREAM }), 200, { 'Content-Type': 'application/json' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply('Método não permitido.', 405, { Allow: 'GET, HEAD' });
    const ttl = Object.prototype.hasOwnProperty.call(ALLOWED, path) ? ALLOWED[path] : null;
    if (ttl == null) return reply('Não encontrado.', 404);
    let upstream;
    try {
      upstream = await fetch(`${UPSTREAM}/${path}`, {
        headers: { Accept: 'text/plain, application/json, */*' },
        cf: { cacheTtl: ttl, cacheEverything: true },
      });
    } catch (e) {
      return reply(`Falha ao contatar o serviço de offsets: ${e.message}`, 502, { 'X-Bope-Upstream-Status': 'erro de rede' });
    }
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return reply('Resposta grande demais.', 502, { 'X-Bope-Upstream-Status': String(upstream.status) });
    return new Response(request.method === 'HEAD' ? null : body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
        'Cache-Control': upstream.ok ? `public, max-age=${ttl}` : 'no-store',
        'X-Bope-Proxy': '1',
        'X-Bope-Upstream-Status': String(upstream.status),
      },
    });
  },
};
