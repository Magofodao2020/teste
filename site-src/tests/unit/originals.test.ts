import { describe, expect, it } from 'vitest';
import { OriginalsMemory, parseOriginals } from '../../src/core/helper/originals';

describe('originais das flags (memória da aba)', () => {
  it('o primeiro original visto vence (é o padrão do jogo)', () => {
    const m = new OriginalsMemory();
    m.record('1:7', [{ rva: 16, type: 'int', name: 'DFIntX', raw: '3c000000' }]);
    // Helper reaberto capturou o valor alterado como "original": não sobrescreve.
    m.record('1:7', [{ rva: 16, type: 'int', name: 'DFIntX', raw: '1e000000' }, { rva: 32, type: 'bool', name: 'FFlagY', raw: '00' }]);
    expect(m.payload()).toEqual([{ session: '1:7', items: [
      { rva: 16, type: 'int', name: 'DFIntX', raw: '3c000000' },
      { rva: 32, type: 'bool', name: 'FFlagY', raw: '00' },
    ] }]);
  });

  it('ignora sessão vazia, guarda no máximo 3 processos e valida a entrada', () => {
    const m = new OriginalsMemory();
    m.record(null, [{ rva: 1, type: 'bool', name: '', raw: '00' }]);
    expect(m.payload()).toEqual([]);
    for (const s of ['a', 'b', 'c', 'd']) m.record(s, [{ rva: 1, type: 'bool', name: '', raw: '00' }]);
    expect(m.payload().map((p) => p.session)).toEqual(['b', 'c', 'd']);
    expect(parseOriginals([{ rva: 4, type: 'int', raw: 'zz' }, { rva: 1.5, type: 'int', raw: '00' }, 'x', { rva: 8, type: 'int', raw: '01000000', name: 'A' }]))
      .toEqual([{ rva: 8, type: 'int', name: 'A', raw: '01000000' }]);
  });
});
