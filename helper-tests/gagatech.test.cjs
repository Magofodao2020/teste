// Gagatech igual ao script Gagatech.js: segurar o lateral ◄ aperta C + Espaço
// AO MESMO TEMPO (um SendInput, VK + scan), soltar solta os dois juntos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMacroSystem, sanitizeMacro } = require(process.env.HELPER_DIR + '/521.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sys = createMacroSystem({ codeToVk: () => 0, isWin: false, hasFfi: false, log: () => {} });
const gaga = { id: 'gagatech', name: 'Gagatech', enabled: true, trigger: 'MouseBack', mode: 'mirror', repeat: 1, speed: 1, robloxOnly: false, steps: [{ t: 'keysdown', codes: ['KeyC', 'Space'] }] };

test.after(() => { setTimeout(() => process.exit(0), 50); });

test('modo e etapa novos passam pela validação', () => {
  const m = sanitizeMacro(gaga);
  assert.equal(m.mode, 'mirror');
  assert.deepEqual(m.steps, [{ t: 'keysdown', codes: ['KeyC', 'Space'] }]);
});

test('lateral bloqueado só para ação "segurar junto" ativa', () => {
  sys.setConfig({ macros: [gaga] });
  assert.equal(sys.blockedXButtons(), 1);
  sys.setConfig({ macros: [{ ...gaga, enabled: false }] });
  assert.equal(sys.blockedXButtons(), 0);
  sys.setConfig({ macros: [{ ...gaga, mode: 'once' }] });
  assert.equal(sys.blockedXButtons(), 0);
});

test('segura: C + Espaço descem juntos; solta: sobem juntos', async () => {
  sys.setConfig({ macros: [gaga] });
  sys.onDown('MouseBack');
  await sleep(150);
  assert.equal(sys.state().running.length, 1, 'segurando enquanto o botão está apertado');
  sys.onDown('MouseBack'); // repetição do apertar não solta nem repete
  await sleep(200);
  assert.equal(sys.state().running.length, 1);
  sys.onUp('MouseBack');
  for (let i = 0; i < 50 && !(sys.lastRun('gagatech') && sys.lastRun('gagatech').mockLog); i++) await sleep(20);
  const log = sys.lastRun('gagatech').mockLog;
  assert.deepEqual(log.map((e) => e.a), ['kbatch', 'kbatch'], 'exatamente dois envios: apertar e soltar');
  assert.deepEqual(log[0].keys, [{ vk: 0x43, scan: 0x2e, up: false }, { vk: 0x20, scan: 0x39, up: false }]);
  assert.deepEqual(log[1].keys, [{ vk: 0x43, scan: 0x2e, up: true }, { vk: 0x20, scan: 0x39, up: true }]);
  assert.equal(sys.lastRun('gagatech').reason, 'solto');
});

test('toque rapidíssimo (soltou antes de começar) ainda aperta e solta', async () => {
  sys.setConfig({ macros: [gaga] });
  const before = sys.lastRun('gagatech');
  sys.onDown('MouseBack');
  sys.onUp('MouseBack'); // na mesma volta do event loop
  for (let i = 0; i < 50 && sys.lastRun('gagatech') === before; i++) await sleep(20);
  const log = sys.lastRun('gagatech').mockLog;
  assert.deepEqual(log.map((e) => e.a), ['kbatch', 'kbatch']);
  assert.equal(log[0].keys[0].up, false); assert.equal(log[1].keys[0].up, true);
});

test('apertar logo de novo (sem trava de 150 ms) funciona', async () => {
  await sleep(50);
  const before = sys.lastRun('gagatech');
  sys.onDown('MouseBack'); await sleep(60); sys.onUp('MouseBack');
  for (let i = 0; i < 50 && sys.lastRun('gagatech') === before; i++) await sleep(20);
  assert.notEqual(sys.lastRun('gagatech'), before);
});

test('com o hook ativo, as teclas vão direto pelo hook (sem worker)', async () => {
  sys.setConfig({ macros: [gaga] });
  assert.deepEqual(sys.directChords(), { 1: [{ vk: 0x43, scan: 0x2e, ext: 0 }, { vk: 0x20, scan: 0x39, ext: 0 }] });
  // não vira direto: "só no Roblox", mais de uma etapa, ou gatilho que não é lateral
  sys.setConfig({ macros: [{ ...gaga, robloxOnly: true }] });
  assert.deepEqual(sys.directChords(), {});
  sys.setConfig({ macros: [{ ...gaga, steps: [...gaga.steps, { t: 'wait', ms: 5 }] }] });
  assert.deepEqual(sys.directChords(), {});
  sys.setConfig({ macros: [{ ...gaga, trigger: 'KeyG' }] });
  assert.deepEqual(sys.directChords(), {});
  // hook pronto: o main não roda a ação de novo (o hook já apertou)
  sys.setConfig({ macros: [gaga] });
  sys.attachHook({ shared: new Int32Array(16), ready: true });
  await sleep(300);
  sys.onDown('MouseBack');
  await sleep(100);
  assert.equal(sys.state().running.length, 0, 'nada rodando no worker');
  sys.onUp('MouseBack');
  sys.attachHook(null);
});
