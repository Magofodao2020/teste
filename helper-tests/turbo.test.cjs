// Turbo faz parte do aplicar: depois de aplicar/retomar o Helper reaplica sozinho
// as flags que o Roblox desfizer (a cada 1 s). Para ao pausar. Sem rota para desligar.
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
const FLAGS = { DFIntSimX: '30', FFlagY: 'true' };

test.before(async () => {
  for (let i = 0; i < 50; i++) { try { await status(); break; } catch { await sleep(50); } }
  await post('/set-offsets', { version: V, names, addresses });
});
test.after(() => { console.log = realLog; setTimeout(() => process.exit(0), 50); });

test('parado até aplicar; não existe rota para desligar', async () => {
  assert.equal((await status()).turbo.active, false);
  assert.equal((await post('/turbo', { enabled: false })).ok, false);
});

test('aplicar liga o turbo: reaplica o que o Roblox desfizer', async () => {
  assert.equal((await post('/apply', { flags: FLAGS, dumpVersion: V })).ok, true);
  assert.equal((await status()).turbo.active, true);
  setInt(60); W.poke(at(0x101300), Buffer.from([0]));
  await sleep(1300);
  assert.equal(int(), 30);
  assert.equal(W.read(at(0x101300), 1)[0], 1);
  assert.ok(logs.some((l) => l.includes('[TURBO] reaplicada(s)')));
});

test('pausar para o turbo; retomar liga de novo', async () => {
  await post('/pause', { dumpVersion: V });
  assert.equal((await status()).turbo.active, false);
  assert.equal(int(), 60);
  await sleep(1300);
  assert.equal(int(), 60, 'pausado não volta');
  await post('/resume', { flags: FLAGS, dumpVersion: V });
  assert.equal((await status()).turbo.active, true);
  setInt(99);
  await sleep(1300);
  assert.equal(int(), 30);
});

test('flag desligada pelo atalho não é reaplicada', async () => {
  await post('/toggle', { name: 'DFIntSimX', flags: FLAGS, dumpVersion: V });
  assert.equal(int(), 60);
  await sleep(1300);
  assert.equal(int(), 60);
  assert.equal(W.read(at(0x101300), 1)[0], 1, 'a outra continua aplicada');
});
