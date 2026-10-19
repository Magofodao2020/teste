// Pelo Helper real (Windows simulado): ação com combinação Shift + G só dispara com
// o Shift segurado; o histórico chega pela rota HTTP do site.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fakewin.cjs');
const W = globalThis.__fakeWin;
const PORT = 7993; process.argv[2] = String(PORT);
const realLog = console.log; console.log = () => {};
require(process.env.HELPER_DIR + '/626.js');
const post = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const get = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const press = async (vk) => { W.keyDown(vk); await sleep(60); W.keyUp(vk); await sleep(120); };

test.before(async () => {
  for (let i = 0; i < 50; i++) { try { await get('/status'); break; } catch { await sleep(50); } }
  await post('/set-macros', { macros: [{ id: 'c', name: 'Combo', enabled: true, trigger: 'KeyG', mods: ['shift'], mode: 'once', robloxOnly: false, debounce: 0, steps: [{ t: 'key', code: 'KeyE', hold: 0 }] }], settings: { stopKey: 'F8', history: true } });
  await sleep(50);
});
test.after(() => { console.log = realLog; setTimeout(() => process.exit(0), 50); });

test('combinação: G sozinho não dispara; Shift + G dispara; histórico pela rota HTTP', async () => {
  await press(0x47);
  await sleep(200);
  assert.equal((await get('/macro/history')).items.length, 0, 'G sozinho não dispara');
  W.keyDown(0x10);
  await press(0x47);
  W.keyUp(0x10);
  let h;
  for (let i = 0; i < 50; i++) { h = await get('/macro/history'); if (h.items.length) break; await sleep(50); }
  assert.equal(h.items.length, 1, 'Shift + G disparou uma vez');
  assert.equal(h.items[0].name, 'Combo');
  assert.equal((await get(`/macro/history?since=${h.seq}`)).items.length, 0, 'incremental');
  const st = await get('/macro/state');
  assert.equal(st.ok, true);
  assert.ok(st.workers.total >= 1, 'pool pré-aquecido');
  assert.equal((await post('/macro/history/clear', {})).ok, true);
  assert.equal((await get('/macro/history')).items.length, 0);
});
