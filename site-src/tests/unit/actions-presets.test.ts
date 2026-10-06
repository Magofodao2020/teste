import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACK, defaultActionsState, restoreActionsState, setEnabled, setTrigger, toHelperMacro,
} from '../../src/core/actions';
import { buildIndex, parseSiteDataset } from '../../src/core/offsets/dataset';
import {
  normalizePreset, parseImport, removeInvalidFlags, sanitizeHotkeys, scanInvalidFlags, type Preset,
} from '../../src/core/presets';
import { V_NEW, siteDatasetJson } from './helpers';

// Cópia literal do pack fornecido pelo usuário — o código não pode divergir disto.
const USER_PACK = JSON.parse(readFileSync('tests/unit/user-pack.json', 'utf8'));

describe('ações', () => {
  it('o pack embutido é idêntico ao fornecido', () => {
    expect(DEFAULT_PACK).toEqual(USER_PACK);
  });

  it('somente as cinco ações, com os gatilhos exatos', () => {
    const st = defaultActionsState();
    expect(st.actions.map((a) => [a.macro.name, a.trigger])).toEqual([
      ['Bug Indi', 'MouseBack'], ['Bug indi ESQUERDA', 'MouseForward'], ['Bug indi DIREITA', 'MouseBack'],
      ['Perfect Dive', 'MouseRight'], ['Gagatech', 'MouseForward'],
    ]);
    expect(st.actions.map((a) => a.group)).toEqual(['Bug Indi', 'Bug Indi', 'Bug Indi', 'GK', 'GK']);
  });

  it('o que vai para o Helper preserva todos os valores do pack', () => {
    const st = defaultActionsState();
    st.actions.forEach((a, i) => {
      const { bope: _b, v: _v, ...fields } = USER_PACK.macros[i];
      const sent = toHelperMacro(a);
      expect({ name: sent.name, mode: sent.mode, repeat: sent.repeat, loopDelay: sent.loopDelay, speed: sent.speed, robloxOnly: sent.robloxOnly, steps: sent.steps, trigger: sent.trigger })
        .toEqual(fields);
    });
  });

  it('no máximo uma ação ativa por botão', () => {
    let st = defaultActionsState();
    expect(st.actions.filter((a) => a.enabled).map((a) => a.id)).toEqual(['bug-indi', 'bug-indi-esquerda', 'perfect-dive']);
    st = setEnabled(st, 'bug-indi-direita', true);
    expect(st.actions.find((a) => a.id === 'bug-indi')!.enabled).toBe(false);
    st = setEnabled(st, 'gagatech', true);
    expect(st.actions.find((a) => a.id === 'bug-indi-esquerda')!.enabled).toBe(false);
    st = setTrigger(st, 'perfect-dive', 'MouseBack');
    expect(st.actions.find((a) => a.id === 'bug-indi-direita')!.enabled).toBe(false);
    // valores dos passos nunca mudam
    expect(st.actions.map((a) => a.macro)).toEqual(USER_PACK.macros);
  });

  it('estado salvo só restaura ativa/gatilho; lixo e versões antigas viram o padrão', () => {
    const saved = setTrigger(defaultActionsState(), 'gagatech', 'KeyG');
    const back = restoreActionsState(JSON.parse(JSON.stringify(saved)));
    expect(back.actions.find((a) => a.id === 'gagatech')!.trigger).toBe('KeyG');
    const tampered = JSON.parse(JSON.stringify(saved));
    tampered.actions[0].macro.steps[0].dy = 1;
    expect(restoreActionsState(tampered).actions[0].macro.steps[0].dy).toBe(20001);
    expect(restoreActionsState({ macros: [{ name: 'Flick Down (AHK)' }] })).toEqual(defaultActionsState());
  });
});

describe('presets e flags inválidas', () => {
  const index = buildIndex(parseSiteDataset(siteDatasetJson(V_NEW), V_NEW), { TestFlag2: 'FInt' });
  const mk = (id: string, flags: Preset['flags']): Preset => ({ id, name: id, flags, color: '#E5141B', createdAt: '', updatedAt: '' });

  it('encontra só as flags que não existem no dump e remove só elas', () => {
    const presets = [
      mk('a', { FFlagTestFlag0: true, TestFlag1: 5, FFlagNaoExiste: true, FIntTestFlag2: 3 }),
      mk('b', { DFIntSumiu: 1, DFIntTambemSumiu: 2 }),
      mk('c', { TestFlag3: 'x' }),
    ];
    const hotkeys = { FFlagTestFlag0: { toggleKey: 'F1' }, FFlagNaoExiste: { toggleKey: 'F2' } };
    const report = scanInvalidFlags(presets, hotkeys, index);
    expect(report.total).toBe(3);
    expect(report.presets).toEqual([
      { id: 'a', name: 'a', flags: ['FFlagNaoExiste'] },
      { id: 'b', name: 'b', flags: ['DFIntSumiu', 'DFIntTambemSumiu'] },
    ]);
    expect(report.hotkeys).toEqual(['FFlagNaoExiste']);
    const r = removeInvalidFlags(presets, hotkeys, report);
    expect(r.presets[0].flags).toEqual({ FFlagTestFlag0: true, TestFlag1: 5, FIntTestFlag2: 3 });
    expect(r.presets[1].flags).toEqual({});
    expect(r.presets[2]).toBe(presets[2]);
    expect(r.hotkeys).toEqual({ FFlagTestFlag0: { toggleKey: 'F1' } });
    expect(r.changed.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('preset do site antigo: rascunho vira conteúdo e a versão manual é descartada', () => {
    const p = normalizePreset({ id: 'x', name: 'Antigo', robloxVersion: 'version-1111111111111111', flags: { FFlagA: true }, draft: { FFlagA: false, FIntB: 2 } })!;
    expect(p.flags).toEqual({ FFlagA: false, FIntB: 2 });
    expect(p).not.toHaveProperty('robloxVersion');
    expect(p).not.toHaveProperty('draft');
  });

  it('importação aceita {name, flags} e objeto simples; rejeita lixo', () => {
    expect(parseImport('{"name":"X","flags":{"FFlagA":true,"bad name":1}}')).toEqual({ name: 'X', flags: { FFlagA: true }, ignored: 1 });
    expect(parseImport('{"FIntA":240,"name":"ignorado"}')).toEqual({ name: null, flags: { FIntA: 240 }, ignored: 0 });
    expect(() => parseImport('[1]')).toThrow();
    expect(() => parseImport('{"a b":1}')).toThrow(/Nenhuma flag/);
  });

  it('hotkeys salvas são sanitizadas', () => {
    expect(sanitizeHotkeys({ FFlagA: { toggleKey: 'F1', junk: 1 }, 'x y': { toggleKey: 'F2' }, FFlagB: {} })).toEqual({ FFlagA: { toggleKey: 'F1' } });
  });
});
