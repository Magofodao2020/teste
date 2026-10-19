// "Helper desconecta do nada": um erro inesperado (timer, requisição) não pode
// fechar o Helper, e o /status tem que responder rápido mesmo com o PC ocupado.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fakewin.cjs');
const PORT = 7995; process.argv[2] = String(PORT);
const logs = []; const realLog = console.log; console.log = (...a) => logs.push(a.join(' '));
require(process.env.HELPER_DIR + '/626.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = async () => (await fetch(`http://127.0.0.1:${PORT}/status`)).json();
const post = async (p, body) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

test.before(async () => { for (let i = 0; i < 50; i++) { try { await status(); break; } catch { await sleep(50); } } });
test.after(() => { console.log = realLog; setTimeout(() => process.exit(0), 50); });

test('erro inesperado num timer não fecha o Helper (processo separado)', async () => {
  // Fora do executor de testes (que captura erros soltos por conta própria).
  const { spawn } = require('node:child_process');
  const code = `require(${JSON.stringify(__dirname + '/fakewin.cjs')}); process.argv[2] = '7994';
    require(${JSON.stringify(process.env.HELPER_DIR + '/626.js')});
    setTimeout(() => { throw new Error('falha simulada'); }, 300);
    setTimeout(() => { Promise.reject(new Error('rejeição simulada')); }, 350);`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => { out += d; });
  try {
    await sleep(1200);
    const st = await (await fetch('http://127.0.0.1:7994/status')).json();
    assert.equal(st.ok, true, 'continua respondendo');
    assert.equal(child.exitCode, null, 'processo vivo');
    assert.match(out, /o Helper continua rodando/);
  } finally { child.kill(); }
});

test('requisição que quebra responde erro e o Helper segue no ar', async () => {
  const r = await post('/set-macros', JSON.stringify({ macros: 'não é lista', settings: 42 }));
  assert.ok(r.status === 200 || r.status === 500);
  await r.json();
  const bad = await post('/apply', '{json quebrado');
  assert.equal(bad.status, 400);
  assert.equal((await status()).ok, true);
});

test('/status responde rápido em sequência (cache curto)', async () => {
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) await status();
  assert.ok(Date.now() - t0 < 2000);
});
