// Cloudflare Pages (modo avançado): proxy do PRÓPRIO site para o serviço de
// offsets. Só é usado pelo navegador quando o CORS do serviço bloqueia a leitura
// direta. Lista fechada de caminhos, só GET, sem cookies/credenciais, com cache
// na borda. Todo o resto é servido como arquivo estático (env.ASSETS).
// O Helper local não tem nada a ver com isto e continua sem internet.
const UPSTREAM = 'https://offsets.imtheo.lol';
const ALLOWED = { 'roblox/version': 60, 'offsets.json': 300, 'FFlags.hpp': 300 };
const MAX_BYTES = 32 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/imtheo/')) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Método não permitido.', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const path = url.pathname.slice('/api/imtheo/'.length);
    const ttl = Object.prototype.hasOwnProperty.call(ALLOWED, path) ? ALLOWED[path] : null;
    if (ttl == null) return new Response('Não encontrado.', { status: 404 });
    let upstream;
    try {
      upstream = await fetch(`${UPSTREAM}/${path}`, {
        headers: { Accept: 'text/plain, application/json, */*' },
        cf: { cacheTtl: ttl, cacheEverything: true },
      });
    } catch (e) {
      return new Response(`Falha ao contatar o serviço de offsets: ${e.message}`, { status: 502 });
    }
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return new Response('Resposta grande demais.', { status: 502 });
    return new Response(request.method === 'HEAD' ? null : body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
        'Cache-Control': `public, max-age=${ttl}`,
        'X-Bope-Proxy': '1',
      },
    });
  },
};
