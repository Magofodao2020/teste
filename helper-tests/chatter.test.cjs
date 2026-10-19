// Chatter/duplo sinal a ~210 ms: o debounce antigo (180 ms) deixava passar e virava
// ON→OFF; a trava nova (em andamento + 250 ms de descanso) mantém UM toggle.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fakewin.cjs');
const W = globalThis.__fakeWin;
const PORT = 7998; process.argv[2] = String(PORT);
const logs = []; const realLog = console.log; console.log = (...a) => logs.push(a.join(' '));
require(process.env.HELPER_DIR + '/626.js');
const V = W.VERSION; const at = (rva) => W.BASE + rva;
const names = [], addresses = [];
for (let i = 0; i < 600; i++) { names.push('FIntFill' + i); addresses.push('0x' + (0x103000 + i * 8).toString(16)); }
names.push('FFlagX'); addresses.push('0x101100');
W.poke(at(0x101100), Buffer.from([0]));
const post = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = () => logs.filter((l) => l.includes('[CONFIG] FFlagX')).length;

test.before(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/status`); break; } catch { await sleep(50); } }
  await post('/set-offsets', { version: V, names, addresses });
  await post('/set-hotkeys', { hotkeys: { FFlagX: { toggleKey: 'KeyT' } }, flags: { FFlagX: 'true' } });
  await sleep(50);
});
test.after(() => { console.log = realLog; setTimeout(() => process.exit(0), 50); });

test('chatter a ~210 ms conta como UM acionamento', async () => {
  logs.length = 0;
  W.keyDown(0x54); await sleep(200); W.keyUp(0x54); await sleep(12);
  W.keyDown(0x54); await sleep(60); W.keyUp(0x54); await sleep(320);
  assert.equal(n(), 1, 'um acionamento (com chatter) = 1 toggle, sem flip-flop ON/OFF');
  assert.ok(logs.some((l) => l.includes('ON -> true')), 'ficou ligado com o valor setado');
});
