// Mede, pelo loop de polling real, quantas vezes UM aperto dispara o toggle.
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
names.push('FFlagX'); addresses.push('0x101100');
W.poke(at(0x101100), Buffer.from([0]));
const post = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const configLogs = () => logs.filter((l) => l.includes('[CONFIG] FFlagX'));

test.before(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/status`); break; } catch { await sleep(50); } }
  await post('/set-offsets', { version: V, names, addresses });
  // hotkey: tecla T (VK 0x54) faz toggle da FFlagX com valor true
  await post('/set-hotkeys', { hotkeys: { FFlagX: { toggleKey: 'KeyT' } }, flags: { FFlagX: 'true' } });
  await sleep(50);
});
test.after(() => { console.log = realLog; setTimeout(() => process.exit(0), 50); });

test('um clique curto dispara o toggle UMA vez', async () => {
  logs.length = 0;
  W.keyDown(0x54); await sleep(60); W.keyUp(0x54); await sleep(260);
  realLog('LOGS clique:', JSON.stringify(configLogs()));
  assert.equal(configLogs().length, 1, 'esperado 1 disparo por clique');
});

test('segurar a tecla não dispara repetido', async () => {
  logs.length = 0;
  W.keyDown(0x54); await sleep(400); W.keyUp(0x54); await sleep(260);
  realLog('LOGS segurar:', JSON.stringify(configLogs()));
  assert.equal(configLogs().length, 1, 'segurar = 1 disparo');
});

test('disparo duplo rápido (bounce do botão) vira UM toggle só', async () => {
  logs.length = 0;
  // dois "apertos" bem rápidos, dentro do cooldown
  W.keyDown(0x54); await sleep(20); W.keyUp(0x54);
  await sleep(30);
  W.keyDown(0x54); await sleep(20); W.keyUp(0x54);
  await sleep(300);
  realLog('LOGS bounce:', JSON.stringify(configLogs()));
  assert.equal(configLogs().length, 1, 'bounce = 1 disparo');
});

test('dois acionamentos separados (depois do descanso) funcionam', async () => {
  logs.length = 0;
  W.keyDown(0x54); await sleep(40); W.keyUp(0x54); await sleep(350);
  W.keyDown(0x54); await sleep(40); W.keyUp(0x54); await sleep(350);
  realLog('LOGS dois:', JSON.stringify(configLogs()));
  assert.equal(configLogs().length, 2, 'dois acionamentos espaçados = 2');
});
