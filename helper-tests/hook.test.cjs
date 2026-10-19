// Hook do Windows (609.js) com user32 simulado: gatilhos sem polling, Gagatech
// direta no ◄/►/meio, bloqueio opcional e filtro das teclas que o próprio hook injeta.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Worker } = require('worker_threads');

const shared = new Int32Array(new SharedArrayBuffer(48 * 4));
const cmd = new Int32Array(new SharedArrayBuffer(16));
const bytes = new Uint8Array(new SharedArrayBuffer(4096));
const msgs = [];
const w = new Worker(path.join(__dirname, 'hooksim.cjs'), {
  workerData: { cmd: cmd.buffer, bytes: bytes.buffer, shared: shared.buffer, file: path.join(process.env.HELPER_DIR, '609.js') },
});
w.on('message', (m) => msgs.push(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MARK = 0x424f5045;
const WM = { LDOWN: 0x201, LUP: 0x202, MDOWN: 0x207, MUP: 0x208, XDOWN: 0x20b, XUP: 0x20c, KDOWN: 0x100, KUP: 0x101 };

/** Entrega um evento ao hook e devolve o retorno do callback (1 = bloqueado). */
async function send(ev) {
  const b = Buffer.from(JSON.stringify(ev));
  b.copy(Buffer.from(bytes.buffer), 0);
  cmd[2] = b.length;
  Atomics.store(cmd, 0, 1);
  Atomics.notify(cmd, 0);
  for (let i = 0; i < 500 && Atomics.load(cmd, 0) !== 0; i++) await sleep(2);
  await sleep(5); // mensagens do worker chegam pelo event loop
  return cmd[1];
}
const x = (msg, which, extra = 0) => send({ kind: 'mouse', msg, data: { x: 0, y: 0, mouseData: which << 16, flags: 0, time: 0, dwExtraInfo: extra } });
const mid = (msg) => send({ kind: 'mouse', msg, data: { x: 0, y: 0, mouseData: 0, flags: 0, time: 0, dwExtraInfo: 0 } });
const key = (msg, vk, flags = 0, extra = 0) => send({ kind: 'key', msg, data: { vkCode: vk, scanCode: 0, flags, time: 0, dwExtraInfo: extra } });
const take = (type) => { const out = msgs.filter((m) => m.type === type); for (const m of out) msgs.splice(msgs.indexOf(m), 1); return out; };
function setDirect(slot, keys, block) {
  const base = 5 + (slot - 1) * 6;
  Atomics.store(shared, base, 0);
  keys.forEach(([vk, scan], i) => Atomics.store(shared, base + 1 + i, vk | (scan << 8)));
  Atomics.store(shared, base + 5, block ? 1 : 0);
  Atomics.store(shared, base, keys.length);
}

test.before(async () => { for (let i = 0; i < 200 && !msgs.some((m) => m.type === 'ready'); i++) await sleep(10); });
test.after(async () => { send({ kind: 'quit' }); await sleep(50); w.terminate(); });

test('hook fica pronto', () => { assert.ok(msgs.some((m) => m.type === 'ready')); });

test('Gagatech direta no ◄: C + Espaço no apertar, mesmas teclas no soltar, botão bloqueado', async () => {
  setDirect(1, [[0x43, 0x2e], [0x20, 0x39]], true);
  take('__sendinput'); take('input'); take('direct');
  assert.equal(await x(WM.XDOWN, 1), 1, 'apertar bloqueado');
  assert.equal(await x(WM.XDOWN, 1), 1, 'repetição do apertar não reenvia');
  setDirect(1, [[0x51, 0x10]], true); // trocar a config com o botão segurado...
  assert.equal(await x(WM.XUP, 1), 1, 'soltar bloqueado');
  const sent = take('__sendinput');
  assert.equal(sent.length, 2, 'um envio no apertar e um no soltar');
  assert.deepEqual(sent[0].keys.map((k) => [k.vk, k.scan, k.up, k.extra]), [[0x43, 0x2e, false, 0], [0x20, 0x39, false, 0]], 'igual ao script: VK+scan, dwExtraInfo 0');
  assert.deepEqual(sent[1].keys.map((k) => [k.vk, k.up]), [[0x43, true], [0x20, true]], '...solta as MESMAS teclas que apertou');
  const inp = take('input');
  assert.deepEqual(inp.map((m) => [m.code, m.up]), [['MouseBack', false], ['MouseBack', false], ['MouseBack', true]]);
  assert.ok(inp.every((m) => typeof m.at === 'number'));
  assert.equal(take('direct').length, 2);
  setDirect(1, [], false);
});

test('botão do meio direto sem bloquear: teclas saem e o clique segue para o jogo', async () => {
  setDirect(3, [[0x45, 0x12]], false);
  take('__sendinput');
  assert.equal(await mid(WM.MDOWN), 0, 'não bloqueado');
  assert.equal(await mid(WM.MUP), 0);
  assert.equal(take('__sendinput').length, 2);
  setDirect(3, [], false);
  take('input'); take('direct');
});

test('botões observados chegam pelo hook (sem polling); entradas do próprio Helper são ignoradas', async () => {
  Atomics.store(shared, 23, 1 | 16); // esquerdo + ►
  take('input');
  assert.equal(await send({ kind: 'mouse', msg: WM.LDOWN, data: { mouseData: 0, dwExtraInfo: 0 } }), 0, 'esquerdo não é bloqueado');
  await send({ kind: 'mouse', msg: WM.LDOWN, data: { mouseData: 0, dwExtraInfo: MARK } }); // clique injetado por uma ação
  await x(WM.XDOWN, 2); await x(WM.XUP, 2);
  assert.deepEqual(take('input').map((m) => [m.code, m.up]), [['MouseLeft', false], ['MouseForward', false], ['MouseForward', true]]);
  Atomics.store(shared, 23, 0);
});

test('teclado: hook instalado só com tecla observada; sem auto-repeat; filtra teclas injetadas pelo hook', async () => {
  assert.equal(await send({ kind: 'state' }), 0, 'sem tecla observada: sem hook de teclado');
  Atomics.store(shared, 24 + (0x47 >>> 5), 1 << (0x47 & 31)); // G
  Atomics.store(shared, 24 + (0x43 >>> 5), Atomics.load(shared, 24 + (0x43 >>> 5)) | (1 << (0x43 & 31))); // C
  await send({ kind: 'tick' });
  assert.equal(await send({ kind: 'state' }), 1, 'hook de teclado instalado');
  assert.equal(Atomics.load(shared, 32), 1, 'avisa a thread principal (sem polling de teclas)');
  take('input');
  await key(WM.KDOWN, 0x47); await key(WM.KDOWN, 0x47); await key(WM.KUP, 0x47);
  assert.deepEqual(take('input').map((m) => [m.vk, m.up]), [[0x47, false], [0x47, true]], 'auto-repeat ignorado');
  // a Gagatech direta injeta C: o C volta marcado como injetado e NÃO vira gatilho
  setDirect(2, [[0x43, 0x2e]], true);
  await x(WM.XDOWN, 2);
  await key(WM.KDOWN, 0x43, 0x10);
  await x(WM.XUP, 2);
  await key(WM.KUP, 0x43, 0x10);
  assert.deepEqual(take('input').filter((m) => m.vk === 0x43), [], 'C injetado pelo hook não dispara');
  await key(WM.KDOWN, 0x43); // C de verdade
  assert.equal(take('input').filter((m) => m.vk === 0x43).length, 1, 'C físico dispara');
  for (let i = 24; i < 32; i++) Atomics.store(shared, i, 0);
  await send({ kind: 'tick' });
  assert.equal(await send({ kind: 'state' }), 0, 'sem tecla observada: hook de teclado removido');
  assert.equal(Atomics.load(shared, 32), 0);
});
