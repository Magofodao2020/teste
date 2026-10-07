// Atalho salvo duas vezes para a mesma flag (com e sem prefixo), toggle e cycle no
// MESMO botão: antes rodavam os dois (ON→CYCLE→OFF…). Agora só o toggle roda.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fakewin.cjs');
const W = globalThis.__fakeWin;
const PORT = 7997; process.argv[2] = String(PORT);
const logs = []; const realLog = console.log; console.log = (...a) => logs.push(a.join(' '));
require(process.env.HELPER_DIR + '/626.js');
const V = W.VERSION; const at = (rva) => W.BASE + rva;
const names = [], addresses = [];
for (let i = 0; i < 600; i++) { names.push('FIntFill' + i); addresses.push('0x' + (0x103000 + i * 8).toString(16)); }
names.push('DFIntSimX'); addresses.push('0x101200');
W.poke(at(0x101200), Buffer.from([60, 0, 0, 0]));
const post = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const val = () => W.read(at(0x101200), 4).readInt32LE(0);
const press = async () => { W.keyDown(0x54); await sleep(80); W.keyUp(0x54); await sleep(400); };

test.before(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/status`); break; } catch { await sleep(50); } }
  await post('/set-offsets', { version: V, names, addresses });
  await post('/set-hotkeys', {
    hotkeys: {
      DFIntSimX: { toggleKey: 'KeyT' },
      SimX: { cycleKey: 'KeyT', cycleValues: ['60', '30'] },
    },
    flags: { DFIntSimX: '30' },
  });
  await sleep(50);
});
test.after(() => { console.log = realLog; setTimeout(() => process.exit(0), 50); });

test('toggle e cycle da mesma flag no mesmo botão: só o toggle roda', async () => {
  logs.length = 0;
  await press();
  assert.equal(val(), 30, 'ligou com o valor do preset');
  assert.ok(!logs.some((l) => l.includes('CYCLE')), 'cycle não rodou');
  assert.ok(logs.some((l) => l.includes('MESMO botão')), 'avisou o conflito');
  await press();
  assert.equal(val(), 60, 'desligou e voltou ao original');
  await press();
  assert.equal(val(), 30, 'ligou de novo');
});

test('valor do toggle achado pelo nome limpo', async () => {
  await post('/set-hotkeys', { hotkeys: { SimX: { toggleKey: 'KeyT' } }, flags: { DFIntSimX: '30' } });
  await sleep(50);
  const before = val();
  await press();
  assert.notEqual(val(), before, 'o toggle pelo nome sem prefixo funcionou');
});

test('/status expõe os originais e /set-originals devolve o padrão', async () => {
  const st = await (await fetch(`http://127.0.0.1:${PORT}/status`)).json();
  assert.ok(st.flagSession, 'sessão do processo');
  const o = st.originals.find((x) => x.rva === 0x101200);
  assert.equal(o.raw, '3c000000', 'padrão 60 guardado');
  const r = await post('/set-originals', { sessions: [{ session: st.flagSession, items: [o] }] });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.seeded, 1);
});
