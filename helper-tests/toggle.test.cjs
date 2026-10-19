// /toggle e /cycle de flags no Windows+Roblox simulados.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fakewin.cjs');
const W = globalThis.__fakeWin;
const PORT = 7995;
process.argv[2] = String(PORT);
const logs = [];
const realLog = console.log;
console.log = (...a) => logs.push(a.join(' '));
require(process.env.HELPER_DIR + '/626.js');

const V = W.VERSION;
const at = (rva) => W.BASE + rva;
const names = [], addresses = [];
// enchimento para passar do mínimo de 500 offsets válidos (apontam para a .data gravável)
for (let i = 0; i < 600; i++) { names.push('FIntFill' + i); addresses.push('0x' + (0x103000 + i * 8).toString(16)); }
names.push('FFlagX'); addresses.push('0x101100'); // bool, página gravável
names.push('FIntY'); addresses.push('0x100100');  // int
names.push('FFloatZ'); addresses.push('0x102100'); // float
// valores padrão do "jogo"
W.poke(at(0x101100), Buffer.from([0]));               // FFlagX = false
{ const b = Buffer.alloc(4); b.writeInt32LE(777); W.poke(at(0x100100), b); } // FIntY = 777
{ const b = Buffer.alloc(4); b.writeFloatLE(1.5); W.poke(at(0x102100), b); }

const post = async (p, body) => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const int = (rva) => W.read(at(rva), 4).readInt32LE(0);
const u8 = (rva) => W.read(at(rva), 1).readUInt8(0);

test.before(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/status`); break; } catch { await new Promise((r) => setTimeout(r, 50)); } }
  const r = await post('/set-offsets', { version: V, names, addresses });
  assert.equal(r.ok, true, r.message);
});
test.after(() => { console.log = realLog; setTimeout(() => process.exit(0), 50); });

test('toggle bool: 1º liga com o valor do preset, 2º desliga voltando ao original', async () => {
  const on = await post('/toggle', { name: 'FFlagX', flags: { FFlagX: 'true' }, dumpVersion: V });
  assert.deepEqual([on.ok, on.enabled, on.value], [true, true, 'true'], JSON.stringify(on));
  assert.equal(u8(0x101100), 1, 'memória ligada');
  const off = await post('/toggle', { name: 'FFlagX', flags: { FFlagX: 'true' }, dumpVersion: V });
  assert.deepEqual([off.ok, off.enabled], [true, false], JSON.stringify(off));
  assert.equal(u8(0x101100), 0, 'voltou ao original (false)');
});

test('toggle int: liga no valor setado (não no padrão do jogo)', async () => {
  const on = await post('/toggle', { name: 'FIntY', flags: { FIntY: '60' }, dumpVersion: V });
  assert.deepEqual([on.ok, on.enabled, on.value], [true, true, '60'], JSON.stringify(on));
  assert.equal(int(0x100100), 60);
  const off = await post('/toggle', { name: 'FIntY', flags: { FIntY: '60' }, dumpVersion: V });
  assert.equal(off.enabled, false);
  assert.equal(int(0x100100), 777);
});

test('cycle int: passa pelos valores na ordem', async () => {
  const vals = ['10', '20', '30'];
  let r = await post('/cycle', { name: 'FIntY', cycleValues: vals, flags: {}, dumpVersion: V });
  assert.deepEqual([r.ok, r.value], [true, '10'], JSON.stringify(r));
  assert.equal(int(0x100100), 10);
  r = await post('/cycle', { name: 'FIntY', cycleValues: vals, flags: {}, dumpVersion: V });
  assert.equal(r.value, '20'); assert.equal(int(0x100100), 20);
  r = await post('/cycle', { name: 'FIntY', cycleValues: vals, flags: {}, dumpVersion: V });
  assert.equal(r.value, '30'); assert.equal(int(0x100100), 30);
  r = await post('/cycle', { name: 'FIntY', cycleValues: vals, flags: {}, dumpVersion: V });
  assert.equal(r.value, '10'); assert.equal(int(0x100100), 10);
  // pausa volta ao original
  await post('/pause', { dumpVersion: V });
  assert.equal(int(0x100100), 777);
});

test('toggle liga/desliga/liga: na 3ª o valor volta a ser o setado', async () => {
  await post('/toggle', { name: 'FIntY', flags: { FIntY: '99' }, dumpVersion: V });
  await post('/toggle', { name: 'FIntY', flags: { FIntY: '99' }, dumpVersion: V });
  const on = await post('/toggle', { name: 'FIntY', flags: { FIntY: '99' }, dumpVersion: V });
  assert.deepEqual([on.enabled, on.value], [true, '99'], JSON.stringify(on));
  assert.equal(int(0x100100), 99);
  await post('/pause', { dumpVersion: V });
});
