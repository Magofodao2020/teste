// Roda o 609.js (hook do Windows) num worker com um user32 SIMULADO: o teste
// manda eventos de mouse/teclado por memória compartilhada e o GetMessageW falso
// entrega cada um ao callback registrado, como o Windows faria.
const { workerData, parentPort } = require('worker_threads');
const Module = require('module');
Object.defineProperty(process, 'platform', { value: 'win32' });

const cmd = new Int32Array(workerData.cmd);      // [0] 1 = evento pendente, [1] retorno do callback, [2] tamanho do JSON
const bytes = new Uint8Array(workerData.bytes);
const hooks = {};
const koffi = {
  load: () => ({
    func: (decl) => {
      const name = /(\w+)\s*\(/.exec(decl)[1];
      return impl[name] || (() => 0);
    },
  }),
  struct: (n) => n, proto: (n) => n, pointer: (t) => t, array: () => ({}),
  register: (fn) => ({ fn }),
  decode: (lParam) => lParam,
  sizeof: () => 40,
};
const impl = {
  GetModuleHandleW: () => ({}),
  SetWindowsHookExW: (id, cb) => { hooks[id] = cb.fn; return { h: id }; },
  UnhookWindowsHookEx: (h) => { delete hooks[h.h]; return 1; },
  CallNextHookEx: () => 0,
  SetTimer: () => 1,
  GetCursorPos: () => 1,
  SendInput: (n, buf, size) => {
    const keys = [];
    for (let i = 0; i < n; i++) {
      const off = i * size;
      keys.push({ vk: buf.readUInt16LE(off + 8), scan: buf.readUInt16LE(off + 10), up: (buf.readUInt32LE(off + 12) & 2) !== 0, extra: Number(buf.readBigUInt64LE(off + 24)) });
    }
    parentPort.postMessage({ type: '__sendinput', keys });
    return n;
  },
  GetMessageW: () => {
    for (;;) {
      Atomics.wait(cmd, 0, 0);
      if (Atomics.load(cmd, 0) !== 1) continue;
      const ev = JSON.parse(Buffer.from(bytes.subarray(0, cmd[2])).toString());
      let ret = 0;
      if (ev.kind === 'quit') { Atomics.store(cmd, 0, 0); Atomics.notify(cmd, 0); return 0; }
      if (ev.kind === 'mouse' && hooks[14]) ret = Number(hooks[14](0, ev.msg, ev.data));
      if (ev.kind === 'key' && hooks[13]) ret = Number(hooks[13](0, ev.msg, ev.data));
      cmd[1] = ev.kind === 'state' ? (hooks[13] ? 1 : 0) : ret;
      Atomics.store(cmd, 0, 0);
      Atomics.notify(cmd, 0);
      return 1; // uma "mensagem": o loop do 609 reavalia o hook de teclado
    }
  },
};
const orig = Module._load;
Module._load = function (req, ...rest) { return req === './dp' ? koffi : orig.call(this, req, ...rest); };
require(workerData.file);
