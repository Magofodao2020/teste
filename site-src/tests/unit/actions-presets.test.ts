import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACK, canActivate, categoryNames, decodeShare, defaultMacrosState, duplicateMacro, exportPack, groupMacros, moveItem, parseMacroImport,
  renameCategory, restoreMacrosState, sanitizeMacro, setAllEnabled, setCategoryEnabled, setEnabled, toHelperMacro, upsertMacro,
} from '../../src/core/macros';
import { buildIndex, parseSiteDataset } from '../../src/core/offsets/dataset';
import {
  normalizePreset, parseImport, removeInvalidFlags, sanitizeHotkeys, scanInvalidFlags, type Preset,
} from '../../src/core/presets';
import { V_NEW, siteDatasetJson } from './helpers';

// Cópia literal do pack fornecido pelo usuário — o código não pode divergir disto.
const USER_PACK = JSON.parse(readFileSync('tests/unit/user-pack.json', 'utf8'));

describe('ações e macros', () => {
  it('o pack dos modelos é idêntico ao fornecido', () => {
    expect(DEFAULT_PACK).toEqual(USER_PACK);
  });

  it('primeira abertura: os cinco modelos configurados e NENHUM ativo', () => {
    const st = defaultMacrosState();
    expect(st.macros.map((m) => [m.name, m.trigger, m.group])).toEqual([
      ['Bug Indi', 'MouseBack', 'Bug Indi'], ['Bug indi ESQUERDA', 'MouseForward', 'Bug Indi'], ['Bug indi DIREITA', 'MouseBack', 'Bug Indi'],
      ['Perfect Dive', 'MouseRight', 'GK'], ['Gagatech', 'MouseForward', 'GK'],
    ]);
    expect(st.macros.every((m) => m.enabled === false)).toBe(true);
  });

  it('o que vai para o Helper preserva os valores do pack', () => {
    defaultMacrosState().macros.forEach((m, i) => {
      const { bope: _b, v: _v, ...fields } = USER_PACK.macros[i];
      const sent = toHelperMacro(m);
      expect({ name: sent.name, mode: sent.mode, repeat: sent.repeat, loopDelay: sent.loopDelay, speed: sent.speed, robloxOnly: sent.robloxOnly, steps: sent.steps, trigger: sent.trigger }).toEqual(fields);
      expect(sent.enabled).toBe(false);
    });
  });

  it('ativar/desativar uma, ativar todas e desativar todas', () => {
    let st = defaultMacrosState();
    st = setEnabled(st, 'gagatech', true);
    expect(st.macros.filter((m) => m.enabled).map((m) => m.id)).toEqual(['gagatech']);
    st = setAllEnabled(st, true);
    expect(st.macros.every((m) => m.enabled)).toBe(true); // inclusive mesmo botão: o usuário pediu "todas"
    st = setAllEnabled(st, false);
    expect(st.macros.every((m) => !m.enabled)).toBe(true);
  });

  it('macro sem botão ou sem etapas não é ativada (nem pelo "ativar todas")', () => {
    let st = defaultMacrosState();
    st = upsertMacro(st, { ...st.macros[0], id: 'sem-botao', name: 'X', trigger: null });
    st = upsertMacro(st, { ...st.macros[0], id: 'sem-etapas', name: 'Y', steps: [] });
    st = setAllEnabled(st, true);
    expect(st.macros.find((m) => m.id === 'sem-botao')!.enabled).toBe(false);
    expect(st.macros.find((m) => m.id === 'sem-etapas')!.enabled).toBe(false);
    expect(st.macros.filter((m) => m.enabled)).toHaveLength(5);
    expect(canActivate(st.macros[0])).toBe(true);
  });

  it('duplicar cria cópia desativada logo abaixo; reordenar etapas', () => {
    let st = setEnabled(defaultMacrosState(), 'perfect-dive', true);
    const r = duplicateMacro(st, 'perfect-dive');
    st = r.state;
    expect(st.macros[4].name).toBe('Perfect Dive (cópia)');
    expect(st.macros[4].enabled).toBe(false);
    expect(st.macros[4].steps).toEqual(st.macros[3].steps);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('migração da versão anterior (v2, que ativava sozinha): mantém botões, tudo desativado', () => {
    const v2 = { v: 2, stopKey: 'F9', actions: [
      { id: 'bug-indi', enabled: true, trigger: 'MouseBack' }, { id: 'perfect-dive', enabled: true, trigger: 'KeyG' },
    ] };
    const st = restoreMacrosState(null, v2);
    expect(st.macros.every((m) => !m.enabled)).toBe(true);
    expect(st.macros.find((m) => m.id === 'perfect-dive')!.trigger).toBe('KeyG');
    expect(st.stopKey).toBe('F9');
  });

  it('migração do site antigo: importa macros do usuário, descarta AHK Flick, tudo desativado', () => {
    const v1 = { macros: [
      { id: 'a1', name: 'Flick Down (AHK)', category: 'AHK Flick', enabled: true, trigger: 'MouseBack', steps: [{ t: 'flick', dx: 13, dy: 4502 }] },
      { id: 'u1', name: 'Minha macro', enabled: true, trigger: 'KeyF', steps: [{ t: 'key', code: 'KeyE', hold: 30 }] },
      { id: 'x', name: 'Bug Indi', enabled: true, trigger: 'MouseBack', steps: [{ t: 'wait', ms: 1 }] },
    ], settings: { stopKey: 'F7' } };
    const st = restoreMacrosState(null, null, v1);
    expect(st.macros.map((m) => m.name)).toEqual(['Bug Indi', 'Bug indi ESQUERDA', 'Bug indi DIREITA', 'Perfect Dive', 'Gagatech', 'Minha macro']);
    expect(st.macros.every((m) => !m.enabled)).toBe(true);
    expect(JSON.stringify(st)).not.toMatch(/AHK/i);
    expect(st.stopKey).toBe('F7');
  });

  it('estado salvo v3 é respeitado; ativa sem botão vira desativada', () => {
    const saved = setEnabled(defaultMacrosState(), 'gagatech', true);
    saved.macros.push({ ...saved.macros[0], id: 'zz', enabled: true, trigger: null });
    const back = restoreMacrosState(JSON.parse(JSON.stringify(saved)));
    expect(back.macros.find((m) => m.id === 'gagatech')!.enabled).toBe(true);
    expect(back.macros.find((m) => m.id === 'zz')!.enabled).toBe(false);
  });

  it('sanitização segue o Helper: tipo desconhecido some, números limitados', () => {
    const m = sanitizeMacro({ name: 'T', speed: 999, repeat: -3, steps: [{ t: 'exploit' }, { t: 'flick', dx: 9e9 }, { t: 'key', code: 'KeyA', hold: -5 }] })!;
    expect(m.speed).toBe(50);
    expect(m.repeat).toBe(1);
    expect(m.steps.map((s) => s.t)).toEqual(['flick', 'key']);
    expect(m.steps[0].dx).toBe(100000);
    expect(m.steps[1].hold).toBe(0);
  });

  it('categorias: agrupa por "group" preservando a ordem, com bucket sem categoria', () => {
    const st = defaultMacrosState();
    const semCat = { ...st.macros[0], id: 'livre', name: 'Livre', group: undefined };
    const groups = groupMacros([...st.macros, semCat]);
    expect(groups.map((g) => [g.name, g.macros.length])).toEqual([['Bug Indi', 3], ['GK', 2], [null, 1]]);
    expect(categoryNames([...st.macros, semCat])).toEqual(['Bug Indi', 'GK']);
  });

  it('ativar/desativar por categoria só afeta a categoria (e pula sem botão/etapas)', () => {
    let st = defaultMacrosState();
    st = setCategoryEnabled(st, 'GK', true);
    expect(st.macros.filter((m) => m.enabled).map((m) => m.group)).toEqual(['GK', 'GK']);
    st = upsertMacro(st, { ...st.macros[0], id: 'gk-sem-botao', name: 'Z', group: 'GK', trigger: null });
    st = setCategoryEnabled(st, 'GK', true);
    expect(st.macros.find((m) => m.id === 'gk-sem-botao')!.enabled).toBe(false); // sem botão não ativa
    st = setCategoryEnabled(st, 'GK', false);
    expect(st.macros.some((m) => m.enabled)).toBe(false);
  });

  it('renomear categoria muda o group de todas as ações dela; vazio remove a categoria', () => {
    let st = defaultMacrosState();
    st = renameCategory(st, 'GK', 'Goleiro');
    expect(st.macros.filter((m) => m.group === 'Goleiro').map((m) => m.name)).toEqual(['Perfect Dive', 'Gagatech']);
    expect(st.macros.some((m) => m.group === 'GK')).toBe(false);
    st = renameCategory(st, 'Goleiro', '   ');
    expect(st.macros.filter((m) => m.name === 'Perfect Dive')[0].group).toBeUndefined();
  });

  it('exportar leva a categoria junto e importar a recria', async () => {
    const st = defaultMacrosState();
    const gk = st.macros.filter((m) => m.group === 'GK');
    const json = exportPack(gk);
    expect(JSON.parse(json).category).toBe('GK');
    const back = await parseMacroImport(json);
    expect(back.map((m) => [m.name, m.group])).toEqual([['Perfect Dive', 'GK'], ['Gagatech', 'GK']]);
    expect(back.every((m) => !m.enabled)).toBe(true);
  });

  it('importação: JSON, pacote e código BOPE-SEQ1 do site antigo — sempre desativadas, sem AHK', async () => {
    const one = { bope: 'macro', v: 1, name: 'A', trigger: 'KeyA', steps: [{ t: 'key', code: 'KeyE' }] };
    expect((await parseMacroImport(JSON.stringify(one)))[0]).toMatchObject({ name: 'A', enabled: false });
    const pack = JSON.stringify({ bope: 'macro-pack', v: 1, macros: [one, { ...one, name: 'Flick Up (AHK)' }] });
    expect((await parseMacroImport(pack)).map((m) => m.name)).toEqual(['A']);
    const code = 'BOPE-SEQ1:' + btoa(JSON.stringify(one)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect((await decodeShare(code)) as { name: string }).toMatchObject({ name: 'A' });
    await expect(parseMacroImport('{"name":"sem etapas"}')).rejects.toThrow(/Nenhuma ação válida/);
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
