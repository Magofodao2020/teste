const test = require('node:test');
const assert = require('node:assert/strict');
require('./fakewin.cjs');
const W = globalThis.__fakeWin;
const PORT = 7991;
process.argv[2] = String(PORT);
const HELPER = process.env.HELPER_DIR;
const log = console.log; console.log = () => {};
require(HELPER + '/626.js');

const names = [], addresses = [];
const at = (rva) => W.BASE + rva;
for (let i = 0; i < 200; i++) { names.push(`FIntI${i}`); addresses.push('0x' + (0x100000 + i * 8).toString(16)); }
for (let i = 0; i < 200; i++) { names.push(`FFlagB${i}`); addresses.push('0x' + (0x101000 + i * 8).toString(16)); }
for (let i = 0; i < 100; i++) { names.push(`FFloatF${i}`); addresses.push('0x' + (0x102000 + i * 8).toString(16)); }
names.push('FStringSso'); addresses.push('0x110000');
names.push('FStringHeap'); addresses.push('0x110040');
names.push('FIntBad'); addresses.push('0x2000010');
// valores padrão do "jogo"
for (let i = 0; i < 200; i++) { const b = Buffer.alloc(4); b.writeInt32LE(1000 + i); W.poke(at(0x100000 + i * 8), b); }
for (let i = 0; i < 200; i++) W.poke(at(0x101000 + i * 8), Buffer.from([1]));
const third = Buffer.alloc(4); third.writeFloatLE(1 / 3);
for (let i = 0; i < 100; i++) W.poke(at(0x102000 + i * 8), third);
const sso = Buffer.alloc(32); sso.write('abc'); sso.writeBigUInt64LE(3n, 16); sso.writeBigUInt64LE(15n, 24); W.poke(at(0x110000), sso);
const heap = Buffer.alloc(32); heap.writeBigUInt64LE(0x7ff000001234n, 0); heap.writeBigUInt64LE(30n, 16); heap.writeBigUInt64LE(40n, 24); W.poke(at(0x110040), heap);
const snapshot = Buffer.from(W.regions[0].buf);

const post = async (path, body) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const int = (rva) => W.read(at(rva), 4).readInt32LE(0);
const V = W.VERSION;

test.before(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/status`); break; } catch { await new Promise((r) => setTimeout(r, 50)); } }
  const r = await post('/set-offsets', { version: V, names, addresses });
  assert.equal(r.ok, true, r.message);
});
test.after(() => { console.log = log; setTimeout(() => process.exit(0), 50); });

test('aplicar → pausar volta EXATAMENTE aos bytes originais, inclusive float', async () => {
  const flags = { FIntI1: '5', FFlagB2: 'false', FFloatF3: '2.5', FIntI4: '1004' /* já igual */ };
  const a = await post('/apply', { flags, dumpVersion: V });
  assert.equal(a.applied, 4, JSON.stringify(a));
  assert.equal(int(0x100008), 5);
  const before = W.writes.length;
  const p = await post('/pause', { flags, dumpVersion: V });
  assert.equal(p.ok, true, p.message);
  assert.equal(p.reverted, 3, p.message);
  assert.ok(W.regions[0].buf.equals(snapshot), 'memória idêntica ao estado original do jogo');
  // só escreveu nas 3 flags realmente alteradas (FIntI4 já estava igual)
  const addrs = W.writes.slice(before).map((w) => w.addr - W.BASE).sort();
  assert.deepEqual(addrs, [0x100008, 0x101010, 0x102018].sort());
});

test('pausar não escreve "padrão" chutado em flags do preset que não foram alteradas', async () => {
  const before = W.writes.length;
  const p = await post('/pause', { flags: { FIntI10: '7', FFlagB11: 'false', FFloatF12: '9' }, dumpVersion: V });
  assert.equal(W.writes.length, before, 'nenhuma escrita');
  assert.equal(int(0x100050), 1010);
  assert.match(p.message, /Nada para pausar/);
});

test('aplicar duas vezes com valores diferentes: o original continua sendo o do jogo', async () => {
  await post('/apply', { flags: { FIntI20: '1' }, dumpVersion: V });
  await post('/apply', { flags: { FIntI20: '2' }, dumpVersion: V });
  await post('/pause', { dumpVersion: V });
  assert.equal(int(0x1000a0), 1020);
});

test('aplicar → pausar → retomar → pausar (vários ciclos) sempre volta ao original', async () => {
  const flags = { FIntI30: '0', FFlagB31: 'false', FFloatF32: '100' };
  await post('/apply', { flags, dumpVersion: V });
  for (let k = 0; k < 5; k++) {
    const p = await post('/pause', { flags, dumpVersion: V });
    assert.equal(p.reverted, 3, p.message);
    assert.ok(W.regions[0].buf.equals(snapshot));
    const r = await post('/resume', { flags, dumpVersion: V });
    assert.equal(r.applied, 3);
    assert.equal(int(0x1000f0), 0);
  }
  await post('/pause', { flags, dumpVersion: V });
  assert.ok(W.regions[0].buf.equals(snapshot));
});

test('toggle liga/desliga restaura o original; cycle também', async () => {
  const flags = { FIntI40: '77' };
  const on = await post('/toggle', { name: 'FIntI40', flags, dumpVersion: V });
  assert.equal(on.enabled, true); assert.equal(int(0x100140), 77);
  const off = await post('/toggle', { name: 'FIntI40', flags, dumpVersion: V });
  assert.equal(off.ok, true, off.message); assert.equal(int(0x100140), 1040);
  await post('/cycle', { name: 'FIntI41', cycleValues: ['1', '2'], flags: {}, dumpVersion: V });
  await post('/pause', { dumpVersion: V });
  assert.equal(int(0x100148), 1041);
  assert.ok(W.regions[0].buf.equals(snapshot));
});

test('offset em página não gravável: recusa sem mudar a proteção', async () => {
  const before = W.writes.length;
  const a = await post('/apply', { flags: { FIntBad: '1' }, dumpVersion: V });
  assert.equal(a.applied, 0);
  assert.match(a.failures[0].reason, /não gravável/);
  assert.equal(W.writes.length, before);
});

test('valor inválido para int/float não escreve NaN/0', async () => {
  const before = W.writes.length;
  const a = await post('/apply', { flags: { FIntI50: 'abc' }, dumpVersion: V });
  assert.equal(a.applied, 0);
  assert.equal(W.writes.length, before);
  assert.equal(int(0x100190), 1050);
});

test('texto: SSO troca só buffer+tamanho; texto longo (heap) não é tocado', async () => {
  const a = await post('/apply', { flags: { FStringSso: 'xyz12', FStringHeap: 'oi' }, dumpVersion: V });
  assert.equal(a.applied, 1, JSON.stringify(a.failures));
  const s = W.read(at(0x110000), 32);
  assert.equal(s.toString('utf8', 0, 5), 'xyz12'); assert.equal(s.readBigUInt64LE(16), 5n); assert.equal(s.readBigUInt64LE(24), 15n);
  assert.ok(W.read(at(0x110040), 32).equals(heap), 'string no heap intacta');
  assert.match(a.failures[0].reason, /longo/);
  // restaura o estado para os outros testes
  W.poke(at(0x110000), sso);
});

test('Helper sem o original (ex.: reaberto depois de aplicar): pausa não chuta valor', async () => {
  // Simula Roblox reaberto: outro processo → estado zerado; valor "estranho" na memória fica intocado
  W.setRunning(false); await post('/pause', { dumpVersion: V }); W.setRunning(true);
  const odd = Buffer.alloc(4); odd.writeInt32LE(123); W.poke(at(0x100200), odd);
  const before = W.writes.length;
  const p = await post('/pause', { flags: { FIntI64: '5' }, dumpVersion: V });
  assert.equal(W.writes.length, before);
  assert.equal(int(0x100200), 123);
  assert.ok(p.ok);
});
