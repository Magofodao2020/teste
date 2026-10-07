// "Definir botão" pelo Helper: rotas /capture/*, com o hook do Windows (609.js)
// substituído por um worker simulado que envia os eventos que o hook enviaria.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const wt = require('node:worker_threads');
require('./fakewin.cjs');

let hook = null;
const RealWorker = wt.Worker;
wt.Worker = class extends EventEmitter {
  constructor(file, opts) {
    if (!String(file).endsWith('609.js')) return new RealWorker(file, opts);
    super();
    this.shared = new Int32Array(opts.workerData.shared);
    hook = this;
    setTimeout(() => this.emit('message', { type: 'ready' }), 5);
  }
  postMessage() {}
  terminate() { return Promise.resolve(0); }
};

const PORT = 7993;
process.argv[2] = String(PORT);
const log = console.log; console.log = () => {};
require(process.env.HELPER_DIR + '/626.js');

const url = (p) => `http://127.0.0.1:${PORT}${p}`;
const post = async (p, body = {}) => (await fetch(url(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const status = async () => (await fetch(url('/capture/status'))).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (m) => hook.emit('message', { type: 'cap', ...m });

test.before(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(url('/status')); break; } catch { await sleep(50); } }
});
test.after(() => { console.log = log; setTimeout(() => process.exit(0), 50); });

test('lateral capturado pelo hook vira MouseForward e a captura termina', async () => {
  const r = await post('/capture/start', { mouse: true, scroll: true, keyboard: true });
  assert.equal(r.ok, true, r.message);
  assert.equal(hook.shared[3], 1, 'hook em modo captura');
  await sleep(150);
  send({ code: 'MouseForward' });
  const st = await status();
  assert.deepEqual([st.active, st.code, st.id], [false, 'MouseForward', r.id]);
  assert.equal(hook.shared[3], 0, 'hook sai do modo captura');
});

test('o próprio clique que abriu a captura é ignorado (primeiros 120 ms)', async () => {
  await post('/capture/start', {});
  send({ code: 'MouseLeft' });
  assert.equal((await status()).code, null);
  await sleep(150);
  send({ code: 'MouseBack' });
  assert.equal((await status()).code, 'MouseBack');
});

test('tecla do hook (vk/scancode) vira o mesmo código do navegador', async () => {
  await post('/capture/start', {});
  await sleep(150);
  send({ vk: 0x41, scan: 0x1e, ext: 0 });
  assert.equal((await status()).code, 'KeyA');
});

test('só teclado: ignora botões e scroll, aceita a tecla', async () => {
  await post('/capture/start', { mouse: false, scroll: false, keyboard: true });
  assert.equal(hook.shared[3], 2, 'hook em modo só teclado (não engole os botões)');
  await sleep(150);
  send({ code: 'MouseBack' });
  send({ code: 'ScrollUp' });
  assert.equal((await status()).active, true);
  send({ vk: 0x51, scan: 0x10, ext: 0 });
  assert.equal((await status()).code, 'KeyQ');
});

test('sem scroll: ignora a roda, aceita botão', async () => {
  await post('/capture/start', { mouse: true, scroll: false, keyboard: true });
  await sleep(150);
  send({ code: 'ScrollDown' });
  assert.equal((await status()).active, true);
  send({ code: 'MouseMiddle' });
  assert.equal((await status()).code, 'MouseMiddle');
});

test('/capture/stop encerra sem código', async () => {
  await post('/capture/start', {});
  await post('/capture/stop');
  await sleep(150);
  send({ code: 'MouseBack' });
  const st = await status();
  assert.deepEqual([st.active, st.code], [false, null]);
  assert.equal(hook.shared[3], 0);
});
