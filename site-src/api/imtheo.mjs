// Vercel Function: proxy do PRÓPRIO site para o serviço de offsets (mesma
// lógica do _worker.js do Cloudflare). O navegador só usa este caminho quando o
// CORS do serviço bloqueia a leitura direta. Lista fechada, só GET, sem
// credenciais. Roda no servidor do Vercel — nada no PC do usuário, nada no Helper.
// Rotas (via rewrite do vercel.json): /api/imtheo/<caminho> → /api/imtheo?path=<caminho>
const UPSTREAM = 'https://offsets.imtheo.lol';
const ALLOWED = { 'roblox/version': 60, 'offsets.json': 300, 'FFlags.hpp': 300 };
const MAX_BYTES = 32 * 1024 * 1024;

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('X-Bope-Proxy', '1');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

export default async function handler(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = (url.searchParams.get('path') ?? '').replace(/^\/+/, '');
  if (path === '_status') {
    return send(res, 200, JSON.stringify({ ok: true, proxy: 'painel-bope', host: 'vercel', upstream: UPSTREAM }), { 'Content-Type': 'application/json' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido.', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
  const ttl = Object.prototype.hasOwnProperty.call(ALLOWED, path) ? ALLOWED[path] : null;
  if (ttl == null) return send(res, 404, 'Não encontrado.', { 'Content-Type': 'text/plain; charset=utf-8' });
  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}/${path}`, { headers: { Accept: 'text/plain, application/json, */*' } });
  } catch (e) {
    return send(res, 502, `Falha ao contatar o serviço de offsets: ${e.message}`, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Bope-Upstream-Status': 'erro de rede' });
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.byteLength > MAX_BYTES) return send(res, 502, 'Resposta grande demais.', { 'X-Bope-Upstream-Status': String(upstream.status) });
  send(res, upstream.status, req.method === 'HEAD' ? undefined : body, {
    'Content-Type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
    'Cache-Control': upstream.ok ? `public, s-maxage=${ttl}, max-age=${ttl}` : 'no-store',
    'X-Bope-Upstream-Status': String(upstream.status),
  });
}
