// Modo turbo: o Roblox volta uma flag aplicada → o Helper reaplica sozinho.
// Flag desligada (toggle) ou pausada não é reaplicada. Desligado por padrão.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fakewin.cjs');
const W = globalThis.__fakeWin;
const PORT = 7996; process.argv[2] = String(PORT);
const logs = []; const realLog = console.log; console.log = (...a) => logs.push(a.join(' '));
require(process.env.HELPER_DIR + '/626.js');
const V = W.VERSION; const at = (rva) => W.BASE + rva;
const names = [], addresses = [];
for (let i = 0; i < 600; i++) { names.push('FIntFill' + i); addresses.push('0x' + (0x103000 + i * 8).toString(16)); }
names.push('DFIntSimX'); addresses.push('0x101200');
names.push('FFlagY'); addresses.push('0x101300');
const int = () => W.read(at(0x101200), 4).readInt32LE(0);
const setInt = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); W.poke(at(0x101200), b); };
setInt(60); W.poke(at(0x101300), Buffer.from([0]));
const post = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const status = async () => (await fetch(`http://127.0.0.1:${PORT}/status`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  for (let i = 0; i < 50; i++) { try { await status(); break; } catch { await sleep(50); } }
  await post('/set-offsets', { version: V, names, addresses });
});
test.after(async () => { await post('/turbo', { enabled: false }); console.log = realLog; setTimeout(() => process.exit(0), 50); });

test('começa desligado: o Roblox desfaz e ninguém reaplica', async () => {
  assert.deepEqual((await status()).turbo, { enabled: false, intervalMs: 1000, reapplied: 0 });
  assert.equal((await post('/apply', { flags: { DFIntSimX: '30', FFlagY: 'true' }, dumpVersion: V })).ok, true);
  setInt(60);
  await sleep(400);
  assert.equal(int(), 60);
});

test('ligado: reaplica a flag que o Roblox desfez', async () => {
  const r = await post('/turbo', { enabled: true, intervalMs: 250 });
  assert.equal(r.enabled, true); assert.equal(r.intervalMs, 250);
  await sleep(400);
  assert.equal(int(), 30, 'voltou ao valor aplicado');
  assert.equal(W.read(at(0x101300), 1)[0], 1, 'a outra flag continua aplicada');
  setInt(77); W.poke(at(0x101300), Buffer.from([0]));
  await sleep(400);
  assert.equal(int(), 30);
  assert.equal(W.read(at(0x101300), 1)[0], 1);
  assert.ok((await status()).turbo.reapplied >= 3);
});

test('pausado não é reaplicado; intervalo inválido vira 1 s', async () => {
  await post('/pause', { dumpVersion: V });
  assert.equal(int(), 60);
  await sleep(400);
  assert.equal(int(), 60, 'pausa vence o turbo');
  assert.equal((await post('/turbo', { enabled: true, intervalMs: 7 })).intervalMs, 1000);
});
