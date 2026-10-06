// Windows + Roblox simulados para testar o Helper fora do Windows.
const Module = require('module');
const PID = 4242;
const BASE = 0x140000000;
const VERSION = 'version-aaaaaaaaaaaaaaaa';
const EXE = `C:\\Users\\x\\AppData\\Local\\Fishstrap\\Versions\\${VERSION}\\RobloxPlayerBeta.exe`;
const regions = [
  { base: BASE + 0x100000, size: 0x200000, prot: 0x04 },   // .data (flags)
  { base: BASE + 0x2000000, size: 0x10000, prot: 0x02 },   // só leitura (offset errado)
];
for (const r of regions) r.buf = Buffer.alloc(r.size);
const writes = [];
let running = true;
let startTime = 1000n;
const failWrites = new Set();
function find(addr, len) { return regions.find((r) => addr >= r.base && addr + len <= r.base + r.size); }
const mem = {
  BASE, VERSION, PID, regions, writes,
  read(addr, len) { const r = find(addr, len); return r ? Buffer.from(r.buf.subarray(addr - r.base, addr - r.base + len)) : null; },
  poke(addr, data) { const r = find(addr, data.length); data.copy(r.buf, addr - r.base); },
  setRunning(v) { running = v; },
  failWrites,
  // Roblox fechado e aberto de novo com o MESMO PID: horário de criação diferente.
  restart(memory) { startTime += 1n; if (memory) memory.copy(regions[0].buf); },
};
globalThis.__fakeWin = mem;
const H = (n) => ({ h: n });
const impl = {
  OpenProcess: (acc, inh, pid) => (running && pid === PID ? H(7) : null),
  CloseHandle: () => 1,
  CreateToolhelp32Snapshot: () => (running ? H(9) : H(9)),
  Process32FirstW: (s, pe) => { if (!running) return 0; pe.szExeFile = 'RobloxPlayerBeta.exe'; pe.th32ProcessID = PID; return 1; },
  Process32NextW: () => 0,
  Module32FirstW: (s, me) => { if (!running) return 0; me.szModule = 'RobloxPlayerBeta.exe'; me.szExePath = EXE; me.modBaseAddr = BASE; me.modBaseSize = 0x3000000; return 1; },
  Module32NextW: () => 0,
  QueryFullProcessImageNameW: (h, f, buf, size) => { const b = Buffer.from(EXE, 'utf16le'); b.copy(buf); size[0] = EXE.length; return 1; },
  FindWindowW: () => (running ? 1 : 0),
  GetWindowThreadProcessId: (hwnd, out) => { out[0] = PID; return 1; },
  GetExitCodeProcess: (h, out) => { out[0] = running ? 259 : 0; return 1; },
  GetProcessTimes: (h, c) => { c.writeBigUInt64LE(startTime, 0); return 1; },
  NtReadVirtualMemory: (h, addr, buf, len, br) => { const d = mem.read(addr, len); if (!d) return -1; d.copy(buf); br[0] = len; return 0; },
  ReadProcessMemory: (h, addr, buf, len, br) => { const d = mem.read(addr, len); if (!d) return 0; d.copy(buf); br[0] = len; return 1; },
  NtWriteVirtualMemory: (h, addr, data, len, bw) => {
    const r = find(addr, len);
    if (!r || r.prot !== 0x04 || failWrites.has(addr)) return -1;
    writes.push({ addr, data: Buffer.from(data.subarray(0, len)) });
    data.copy(r.buf, addr - r.base, 0, len); bw[0] = len; return 0;
  },
  WriteProcessMemory: () => 0,
  VirtualQueryEx: (h, addr, mbi) => {
    const r = regions.find((x) => addr >= x.base && addr < x.base + x.size);
    if (!r) return 0;
    mbi.writeBigUInt64LE(BigInt(r.base), 0); mbi.writeBigUInt64LE(BigInt(r.size), 24);
    mbi.writeUInt32LE(0x1000, 32); mbi.writeUInt32LE(r.prot, 36); return 48;
  },
  VirtualProtectEx: () => { throw new Error('VirtualProtectEx não deveria ser chamado'); },
};
const koffi = {
  load: () => ({ func: (name) => impl[name] ?? (() => 0) }),
  struct: () => ({}), array: () => ({}), pointer: () => ({}), inout: () => ({}), out: () => ({}),
  sizeof: () => 1080, address: (h) => BigInt(h?.h ?? 0), register: () => ({}), proto: () => ({}), unregister: () => {},
};
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'koffi' ? koffi : orig.call(this, req, ...rest); };
Object.defineProperty(process, 'platform', { value: 'win32' });
