// Servidor HTTPS que se passa por offsets.imtheo.lol nos testes (o Chromium é
// iniciado com --host-resolver-rules). Diferente do page.route do Playwright,
// aqui o navegador aplica CORS DE VERDADE, então dá para testar o bloqueio real.
import https from 'node:https';
import { readFileSync } from 'node:fs';

export const FAKE_PORT = 8443;
export const CHROMIUM_ARGS = [`--host-resolver-rules=MAP offsets.imtheo.lol:443 127.0.0.1:${FAKE_PORT}`, '--ignore-certificate-errors', '--no-proxy-server'];

/** routes: { '/roblox/version': { status, body, cors: true|false, delayMs } } */
export function startFakeImtheo() {
  const state = { routes: {}, hits: [] };
  const server = https.createServer({
    key: readFileSync(new URL('./certs/key.pem', import.meta.url)),
    cert: readFileSync(new URL('./certs/cert.pem', import.meta.url)),
  }, (req, res) => {
    const path = req.url.split('?')[0];
    state.hits.push({ path, origin: req.headers.origin ?? null, mode: req.headers['sec-fetch-mode'] ?? null });
    const r = state.routes[path];
    if (!r) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not Found'); }
    const send = () => {
      const headers = { 'Content-Type': r.type ?? 'text/plain; charset=utf-8' };
      if (r.cors) headers['Access-Control-Allow-Origin'] = '*';
      res.writeHead(r.status ?? 200, headers);
      res.end(r.body ?? '');
    };
    if (r.delayMs) setTimeout(send, r.delayMs); else send();
  });
  return new Promise((resolve) => server.listen(FAKE_PORT, '127.0.0.1', () => resolve({ state, close: () => new Promise((r) => server.close(r)) })));
}
