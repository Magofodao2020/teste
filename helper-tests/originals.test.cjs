// Helper fechado e aberto de novo com o Roblox ainda alterado: o Helper novo
// guardaria o valor ALTERADO como "original" e desligar/pausar não voltaria ao
// padrão. O site guarda os originais (só em memória) e devolve ao Helper novo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFlagEngine } = require(process.env.HELPER_DIR + '/633.js');

const BASE = 0x140000000;
const mem = Buffer.alloc(0x1000);
const RVA = 0x200;
mem.writeInt32LE(60, RVA); // padrão do jogo
const os = {
  openProcess: () => ({}), closeHandle: () => {}, isAlive: () => true, startTime: () => '777',
  moduleInfo: () => ({ base: BASE, size: 0x1000 }),
  query: () => ({ state: 0x1000, protect: 0x04, base: BASE, size: 0x1000 }),
  read: (h, addr, len) => Buffer.from(mem.subarray(addr - BASE, addr - BASE + len)),
  write: (h, addr, data) => { data.copy(mem, addr - BASE); return true; },
};
const entry = { rva: RVA, type: 'int', fullName: 'DFIntSimX' };
const val = () => mem.readInt32LE(RVA);

test('Helper novo recupera o padrão guardado pelo site', () => {
  const a = createFlagEngine(os);
  a.attach(4242);
  assert.equal(a.apply([{ name: 'DFIntSimX', entry, value: '30' }]).ok, true);
  assert.equal(val(), 30);
  const saved = { session: a.sessionId(), items: a.exportOriginals() };
  assert.equal(saved.session, '4242:777');
  assert.deepEqual(saved.items, [{ rva: RVA, type: 'int', name: 'DFIntSimX', raw: '3c000000' }]);

  // Helper reaberto: sem os originais, o "padrão" capturado seria 30.
  const b = createFlagEngine(os);
  b.attach(4242);
  b.apply([{ name: 'DFIntSimX', entry, value: '30' }]);
  const blind = b.restore(['DFIntSimX']);
  assert.equal(blind.restored[0].unchanged, true, 'avisa que não sabe o padrão');
  assert.equal(val(), 30);

  // Com os originais do site: o desligar volta ao padrão de verdade.
  assert.equal(b.seedOriginals('outra:sessao', saved.items).ok, false, 'outro processo é recusado');
  assert.equal(b.seedOriginals(saved.session, saved.items).seeded, 1);
  assert.equal(b.isLive('SimX'), true, 'conta como alterada (memória ≠ padrão)');
  const r = b.restore(['DFIntSimX']);
  assert.equal(r.restored[0].value, '60');
  assert.equal(val(), 60);
});

test('originais inválidos são ignorados', () => {
  const c = createFlagEngine(os);
  c.attach(4242);
  const bad = [{ rva: RVA + 1, type: 'int', raw: '3c000000' }, { rva: RVA, type: 'int', raw: '3c00' }, { rva: RVA, type: 'xx', raw: '00' }, { rva: 0x5000, type: 'int', raw: '3c000000' }];
  assert.equal(c.seedOriginals(c.sessionId(), bad).seeded, 0);
});
