// Helper simulado para os testes e2e: mesma API HTTP do 626.js, registra o que
// o site envia e responde como o Helper real (inclusive o bloqueio de versão).
import http from 'node:http';

export function startMockHelper({ port = 7962, running = 'version-cec3ad5889b447cf' } = {}) {
  const state = {
    running, startedAt: Date.now(), offsets: null, macros: null, settings: null, hotkeys: null, posts: [],
    rec: { state: 'idle', events: 0, startedAt: 0, timer: null, result: null },
    capture: { id: 0, active: false, code: null, opts: null },
    turbo: { enabled: false, intervalMs: 1000, reapplied: 0 },
  };
  const status = () => ({
    ok: true, helper: 'gerenciador-helper', helperVersion: '2.3.0', platform: 'win32', ffiReady: true,
    startedAt: state.startedAt, robloxFound: !!state.running, robloxPid: state.running ? 4242 : null,
    runningBuild: state.running,
    detection: state.running
      ? { state: 'running', version: state.running, pid: 4242, reason: `Versão em execução: ${state.running}`, instances: [] }
      : { state: 'not-running', version: null, pid: null, reason: 'Roblox não está em execução.', instances: [] },
    siteOffsetsBuild: state.offsets?.version ?? null, offsetsBuild: state.offsets?.version ?? null, canApply: true,
    turbo: state.turbo,
  });
  const server = http.createServer((req, res) => {
    const send = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'OPTIONS') return send({});
    const path = req.url.split('?')[0];
    if (req.method === 'GET') {
      if (path === '/status') return send(status());
      if (path === '/capture/status') return send({ ok: true, id: state.capture.id, active: state.capture.active, code: state.capture.code });
      if (path === '/macro/record/status') {
        const r = state.rec;
        if (r.state === 'recording') r.events += 3;
        return send({ ok: true, state: r.state, events: r.events, elapsedMs: r.state === 'recording' ? Date.now() - r.startedAt : 0, stopKey: state.settings?.stopKey ?? 'F8', result: r.state === 'done' ? r.result : null });
      }
      return send({ ok: false });
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const data = JSON.parse(body || '{}');
      state.posts.push({ path, data });
      switch (path) {
        case '/set-offsets':
          state.offsets = { version: data.version, count: data.names.length, names: data.names, addresses: data.addresses };
          return send({ ok: true, message: 'ok' });
        case '/set-macros': state.macros = data.macros; state.settings = data.settings; return send({ ok: true, count: data.macros.length, active: 0, message: 'ok' });
        case '/set-hotkeys': state.hotkeys = data; return send({ ok: true, message: 'ok' });
        case '/turbo': state.turbo = { enabled: !!data.enabled, intervalMs: data.intervalMs, reapplied: 0 }; return send({ ok: true, enabled: !!data.enabled, intervalMs: data.intervalMs, message: 'ok' });
        case '/apply': {
          if (!state.offsets) return send({ ok: false, blocked: true, message: 'O Helper ainda não recebeu os offsets do site.' });
          if (state.running !== state.offsets.version || (data.dumpVersion && data.dumpVersion !== state.running)) {
            return send({ ok: false, blocked: true, buildMismatch: true, message: `Versão incompatível. offsets → ${state.offsets.version} · processo em execução → ${state.running}.` });
          }
          const n = Object.keys(data.flags).length;
          return send({ ok: true, applied: n, message: `Todas as ${n} configurações aplicadas na memória.` });
        }
        case '/macro/run': return send({ ok: true, message: 'rodando' });
        case '/macro/record/start': {
          const r = state.rec;
          Object.assign(r, { state: 'countdown', events: 0, result: null, opts: data });
          r.timer = setTimeout(() => { r.state = 'recording'; r.startedAt = Date.now(); }, 300);
          return send({ ok: true, message: 'Gravação agendada.', stopKey: state.settings?.stopKey ?? 'F8' });
        }
        case '/macro/record/stop': {
          const r = state.rec;
          clearTimeout(r.timer);
          if (r.state === 'countdown') { r.state = 'idle'; return send({ ok: true, cancelled: true, message: 'Gravação cancelada.' }); }
          if (r.state !== 'recording') return send({ ok: false, message: 'Não há gravação em andamento.' });
          r.result = { steps: [{ t: 'key', code: 'KeyE', hold: 55 }, { t: 'click', btn: 'left', hold: 32, delay: 140 }, { t: 'scroll', amount: -2, delay: 80 }], events: r.events, durationMs: 900 };
          r.state = 'done';
          return send({ ok: true, ...r.result });
        }
        case '/capture/start':
          Object.assign(state.capture, { id: state.capture.id + 1, active: true, code: null, opts: data });
          return send({ ok: true, id: state.capture.id, hookReady: true, message: 'Pressione um botão ou tecla.' });
        case '/capture/stop': state.capture.active = false; return send({ ok: true, message: 'Captura encerrada.' });
        case '/macro/cursor': return send({ ok: true, x: 640, y: 360 });
        case '/macro/stop': return send({ ok: true, stopped: 0, message: 'Nenhum macro rodando.' });
        case '/pause': return send({ ok: true, message: 'Configurações despausadas.' });
        case '/resume': return send({ ok: true, message: 'Aplicado.' });
        default: return send({ ok: false, message: 'rota desconhecida' });
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ state, close: () => new Promise((r) => server.close(r)), restart() { state.startedAt = Date.now(); state.offsets = null; state.macros = null; state.hotkeys = null; },
    // Simula o hook do Windows vendo um botão/tecla durante a captura.
    press(code) { const c = state.capture; if (!c.active) return false; c.code = code; c.active = false; return true; } })));
}
