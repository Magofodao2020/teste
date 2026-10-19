// Executor de ações v3 (521/592): temporização, etapas desativadas, parada por
// ação, combinações, re-acionamento, grupos com prioridade/fila e histórico.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMacroSystem, sanitizeMacro } = require(process.env.HELPER_DIR + '/521.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mods = { ctrl: false, shift: false, alt: false };
const sys = createMacroSystem({ codeToVk: () => 0, isWin: false, hasFfi: false, log: () => {}, modsDown: () => mods });
const base = { enabled: true, mode: 'once', repeat: 1, speed: 1, robloxOnly: false, debounce: 0 };
const key = (code, extra = {}) => ({ t: 'key', code, hold: 0, ...extra });
async function runOf(id, act) {
  const before = sys.lastRun(id);
  act();
  for (let i = 0; i < 200 && sys.lastRun(id) === before; i++) await sleep(10);
  return sys.lastRun(id);
}
const downs = (r) => r.mockLog.filter((e) => e.a === 'kdown');

test.after(() => { sys.shutdown(); setTimeout(() => process.exit(0), 50); });

test('sanitização: campos novos e padrões compatíveis', () => {
  const m = sanitizeMacro({ id: 'a', trigger: 'F1', steps: [key('KeyA', { after: 5, off: true })], mods: ['shift', 'x'], stopKey: 'F1' });
  assert.deepEqual(m.mods, ['shift']);
  assert.equal(m.stopKey, null, 'parada igual ao gatilho é recusada');
  assert.equal(m.debounce, 150, 'trava antiga de 150 ms continua o padrão');
  assert.equal(m.onRetrigger, 'stop');
  assert.equal(m.steps[0].after, 5);
  assert.equal(m.steps[0].off, true);
  assert.equal(sanitizeMacro({ trigger: 'F1', steps: [], debounce: 0 }).debounce, 0, '0 = sem trava');
});

test('delay inicial, entre etapas, depois da etapa e final: medidos no executor', async () => {
  sys.setConfig({ macros: [{ ...base, id: 't', trigger: 'F2', startDelay: 30, stepGap: 40, endDelay: 50, steps: [key('KeyA', { after: 20 }), key('KeyB'), key('KeyC', { off: true })] }] });
  const t0 = Date.now();
  const r = await runOf('t', () => sys.onDown('F2'));
  const d = downs(r);
  assert.equal(d.length, 2, 'etapa desativada não roda');
  const gap = d[1].t - d[0].t;
  assert.ok(gap >= 58 && gap < 75, `depois (20) + entre etapas (40) ≈ 60 ms, veio ${gap}`);
  assert.equal(r.steps, 2);
  assert.ok(Date.now() - t0 >= 30 + 60 + 50 - 5, 'delay inicial e final contam');
  assert.ok(r.latency >= 28, `latência inclui o delay inicial (${r.latency})`);
  assert.ok(r.lateMax < 20, `esperas no horário (atraso máx ${r.lateMax} ms)`);
});

test('0 ms: etapas seguidas sem espera nenhuma', async () => {
  sys.setConfig({ macros: [{ ...base, id: 'z', trigger: 'F3', steps: [key('KeyA'), key('KeyB'), key('KeyC')] }] });
  const r = await runOf('z', () => sys.onDown('F3'));
  const d = downs(r);
  assert.ok(d[2].t - d[0].t < 3, `3 teclas em < 3 ms (veio ${d[2].t - d[0].t})`);
});

test('tecla de parada da própria ação interrompe e solta o que segurava', async () => {
  sys.setConfig({ macros: [{ ...base, id: 's', trigger: 'F4', stopKey: 'F5', steps: [{ t: 'keydown', code: 'KeyW' }, { t: 'wait', ms: 2000 }] }] });
  const r = await runOf('s', () => { sys.onDown('F4'); setTimeout(() => sys.onDown('F5'), 60); });
  assert.equal(r.result, 'parada');
  assert.deepEqual(r.mockLog.map((e) => e.a), ['kdown', 'kup'], 'W foi solta ao parar');
});

test('combinação: só dispara com Ctrl segurado', async () => {
  sys.setConfig({ macros: [{ ...base, id: 'c', trigger: 'KeyG', mods: ['ctrl'], steps: [key('KeyA')] }] });
  sys.onDown('KeyG');
  await sleep(80);
  assert.equal(sys.lastRun('c'), null, 'sem Ctrl não roda');
  mods = { ctrl: true, shift: false, alt: false };
  const r = await runOf('c', () => sys.onDown('KeyG'));
  mods = { ctrl: false, shift: false, alt: false };
  assert.equal(r.result, 'concluída');
});

test('re-acionamento: ignorar e reiniciar', async () => {
  const long = [{ t: 'keydown', code: 'KeyW' }, { t: 'wait', ms: 300 }];
  sys.setConfig({ macros: [{ ...base, id: 'i', trigger: 'F6', onRetrigger: 'ignore', steps: long }] });
  const r1 = await runOf('i', () => { sys.onDown('F6'); setTimeout(() => sys.onDown('F6'), 50); });
  assert.equal(r1.result, 'concluída', 'ignorar: o 2º aperto não parou');
  sys.setConfig({ macros: [{ ...base, id: 'r', trigger: 'F7', onRetrigger: 'restart', steps: long }] });
  const first = await runOf('r', () => { sys.onDown('F7'); setTimeout(() => sys.onDown('F7'), 50); });
  assert.equal(first.result, 'parada');
  assert.equal(sys.isRunning('r'), true, 'reiniciou logo depois de parar');
  sys.stop('r');
  await sleep(50);
});

test('grupo: prioridade maior interrompe; menor fica bloqueada; fila espera a vez', async () => {
  const long = [{ t: 'wait', ms: 400 }];
  sys.setConfig({ macros: [
    { ...base, id: 'lo', trigger: 'F8x', group: 'mov', priority: 0, steps: long },
    { ...base, id: 'hi', trigger: 'F9', group: 'mov', priority: 5, steps: long },
    { ...base, id: 'q', trigger: 'F10', group: 'mov', priority: 5, groupPolicy: 'queue', steps: [key('KeyQ')] },
  ] });
  sys.onDown('F8x');
  await sleep(30);
  const lo = await runOf('lo', () => sys.onDown('F9'));
  assert.equal(lo.result, 'parada', 'a de prioridade maior interrompeu');
  assert.equal(sys.isRunning('hi'), true);
  sys.onDown('F8x');
  await sleep(30);
  assert.equal(sys.isRunning('lo'), false, 'a de prioridade menor ficou bloqueada');
  assert.ok(sys.getHistory().items.some((h) => h.id === 'lo' && h.result === 'bloqueada'));
  sys.onDown('F10');
  assert.equal(sys.isRunning('q'), false, 'na fila enquanto "hi" roda');
  assert.equal(sys.state().queued.length, 1);
  const q = await runOf('q', () => {});
  assert.equal(q.result, 'concluída', 'rodou quando o grupo liberou');
});

test('histórico incremental e workers reaproveitados (sem recriar por execução)', async () => {
  sys.setConfig({ macros: [{ ...base, id: 'h', trigger: 'F11', steps: [key('KeyH')] }] });
  const seq = sys.getHistory().seq;
  for (let i = 0; i < 5; i++) await runOf('h', () => sys.onDown('F11'));
  const h = sys.getHistory(seq).items.filter((x) => x.id === 'h');
  assert.equal(h.length, 5);
  assert.ok(h.every((x) => x.result === 'concluída' && typeof x.latency === 'number'));
  assert.ok(sys.state().workers.total <= 4, `pool pequeno (${sys.state().workers.total} workers)`);
  sys.clearHistory();
  assert.equal(sys.getHistory().items.length, 0);
});
