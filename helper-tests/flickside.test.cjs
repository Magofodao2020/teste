// Bug indi: um botão faz o flick, outro troca o lado (espelha o X) com bipe.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMacroSystem, sanitizeMacro } = require(process.env.HELPER_DIR + '/521.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const beeps = [];
const logs = [];
const sys = createMacroSystem({ codeToVk: () => 0, isWin: false, hasFfi: false, log: (...a) => logs.push(a.join(' ')), beep: (f, ms) => beeps.push([f, ms]) });
const macro = {
  id: 'bug', name: 'Bug indi', enabled: true, trigger: 'MouseBack', sideKey: 'MouseForward', sideSound: true, mode: 'once', repeat: 1, speed: 1, robloxOnly: false,
  steps: [{ t: 'flick', btn: 'none', pre: 0, afterUp: 0, dx: 150, dy: 0, moveDur: 0, afterMove: 0, cooldown: 0 }],
};
const flickDx = async () => {
  for (let i = 0; i < 100 && !(sys.lastRun('bug') && sys.lastRun('bug').mockLog); i++) await sleep(20);
  const rel = sys.lastRun('bug').mockLog.filter((e) => e.a === 'rel');
  return rel.reduce((s, e) => s + e.dx, 0);
};
const fire = async () => {
  const before = sys.lastRun('bug');
  sys.onDown('MouseBack');
  for (let i = 0; i < 100 && sys.lastRun('bug') === before; i++) await sleep(20);
  return flickDx();
};

test.after(() => { sys.shutdown && sys.shutdown(); setTimeout(() => process.exit(0), 50); });

test('mesmo botão para ação e lado é recusado', () => {
  assert.equal(sanitizeMacro({ ...macro, sideKey: 'MouseBack' }).sideKey, null);
});

test('flick no lado configurado; trocar o lado espelha o X e bipa', async () => {
  sys.setConfig({ macros: [macro] });
  assert.equal(sys.state().sides.bug, 'DIREITA');
  assert.equal(await fire(), 150);
  await sleep(200);
  sys.onDown('MouseForward');
  assert.equal(sys.state().sides.bug, 'ESQUERDA');
  assert.deepEqual(beeps.at(-1), [600, 70], 'grave = esquerda');
  await sleep(200);
  assert.equal(await fire(), -150);
  await sleep(200);
  sys.onDown('MouseForward');
  assert.equal(sys.state().sides.bug, 'DIREITA');
  assert.deepEqual(beeps.at(-1), [1200, 70], 'agudo = direita');
  assert.ok(logs.some((l) => l.includes('lado do flick → ESQUERDA')));
});

test('o lado sobrevive à ressincronização do site; sem som se desligado', async () => {
  await sleep(200);
  sys.onDown('MouseForward');
  sys.setConfig({ macros: [{ ...macro, sideSound: false }] });
  assert.equal(sys.state().sides.bug, 'ESQUERDA');
  const n = beeps.length;
  await sleep(200);
  sys.onDown('MouseForward');
  assert.equal(beeps.length, n);
  sys.setConfig({ macros: [{ ...macro, sideKey: null }] });
  assert.deepEqual(sys.state().sides, {});
});
