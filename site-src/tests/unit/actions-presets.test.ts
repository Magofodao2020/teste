import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACK, addCategory, applyImport, canActivate, decodeShare, defaultMacrosState, duplicateMacro, exportAll, exportCategory,
  groupMacros, importCollisions, moveCategory, moveItem, parseMacroImport, removeCategory, renameCategory, reorderMacro,
  restoreMacrosState, sanitizeMacro, setAllEnabled, setCategoryEnabled, setEnabled, setMacroCategory, toHelperMacro, upsertMacro,
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

  it('primeira abertura: categorias Bug Indi e GK, modelos dentro, nenhum ativo', () => {
    const st = defaultMacrosState();
    expect(st.categories.map((c) => c.name)).toEqual(['Bug Indi', 'GK']);
    const nameOf = (id: string | null) => st.categories.find((c) => c.id === id)?.name ?? null;
    expect(st.macros.map((m) => [m.name, m.trigger, nameOf(m.categoryId)])).toEqual([
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

  const catId = (st: ReturnType<typeof defaultMacrosState>, name: string) => st.categories.find((c) => c.name === name)!.id;
  const idToName = (st: ReturnType<typeof defaultMacrosState>) => (id: string | null) => st.categories.find((c) => c.id === id)?.name ?? null;

  it('categorias: groupMacros devolve pastas na ordem + grupo "Sem categoria" por último', () => {
    let st = defaultMacrosState();
    st = upsertMacro(st, { ...st.macros[0], id: 'livre', name: 'Livre', categoryId: null });
    const groups = groupMacros(st);
    expect(groups.map((g) => [g.category?.name ?? null, g.macros.length])).toEqual([['Bug Indi', 3], ['GK', 2], [null, 1]]);
  });

  it('criar categoria vazia (nome único) e excluir devolve as ações para "Sem categoria"', () => {
    let st = defaultMacrosState();
    const r = addCategory(st, 'GK'); // nome colide → vira "GK (2)"
    st = r.state;
    expect(st.categories.map((c) => c.name)).toEqual(['Bug Indi', 'GK', 'GK (2)']);
    expect(groupMacros(st).find((g) => g.category?.id === r.id)!.macros).toEqual([]); // vazia
    // excluir a categoria GK: as 2 ações ficam sem categoria, não são apagadas
    const gk = catId(st, 'GK');
    st = removeCategory(st, gk);
    expect(st.categories.some((c) => c.name === 'GK')).toBe(false);
    const semCat = groupMacros(st).find((g) => g.category === null)!;
    expect(semCat.macros.map((m) => m.name).sort()).toEqual(['Gagatech', 'Perfect Dive']);
    expect(st.macros.length).toBe(5); // nenhuma ação apagada
  });

  it('mover ação entre categorias, deixar sem categoria e reordenar dentro da pasta', () => {
    let st = defaultMacrosState();
    st = setMacroCategory(st, 'perfect-dive', catId(st, 'Bug Indi'));
    expect(idToName(st)(st.macros.find((m) => m.id === 'perfect-dive')!.categoryId)).toBe('Bug Indi');
    st = setMacroCategory(st, 'perfect-dive', null); // sem categoria
    expect(st.macros.find((m) => m.id === 'perfect-dive')!.categoryId).toBeNull();
    // reordenar dentro de Bug Indi: sobe a 3ª para o topo, só troca com o vizinho do mesmo grupo
    const before = groupMacros(st).find((g) => g.category?.name === 'Bug Indi')!.macros.map((m) => m.name);
    expect(before).toEqual(['Bug Indi', 'Bug indi ESQUERDA', 'Bug indi DIREITA']);
    st = reorderMacro(st, 'bug-indi-direita', -1);
    const after = groupMacros(st).find((g) => g.category?.name === 'Bug Indi')!.macros.map((m) => m.name);
    expect(after).toEqual(['Bug Indi', 'Bug indi DIREITA', 'Bug indi ESQUERDA']);
  });

  it('renomear/mover categoria; ativar/desativar por categoria pula sem botão', () => {
    let st = defaultMacrosState();
    st = renameCategory(st, catId(st, 'GK'), 'Goleiro');
    expect(st.categories.map((c) => c.name)).toEqual(['Bug Indi', 'Goleiro']);
    st = moveCategory(st, catId(st, 'Goleiro'), -1);
    expect(st.categories.map((c) => c.name)).toEqual(['Goleiro', 'Bug Indi']);
    st = setCategoryEnabled(st, catId(st, 'Goleiro'), true);
    expect(st.macros.filter((m) => m.enabled).map((m) => m.name).sort()).toEqual(['Gagatech', 'Perfect Dive']);
    st = upsertMacro(st, { ...st.macros[0], id: 'g-sem-botao', name: 'Z', categoryId: catId(st, 'Goleiro'), trigger: null });
    st = setCategoryEnabled(st, catId(st, 'Goleiro'), true);
    expect(st.macros.find((m) => m.id === 'g-sem-botao')!.enabled).toBe(false);
    st = setCategoryEnabled(st, catId(st, 'Goleiro'), false);
    expect(st.macros.some((m) => m.enabled)).toBe(false);
  });

  it('exportar tudo preserva a estrutura; exportar uma categoria leva as ações; importar reconstrói', async () => {
    const st = defaultMacrosState();
    const all = JSON.parse(exportAll(st));
    expect(all.categories.map((c: { name: string }) => c.name)).toEqual(['Bug Indi', 'GK']);
    expect(all.macros.every((m: { category?: string }) => ['Bug Indi', 'GK'].includes(m.category!))).toBe(true);

    const gkJson = exportCategory(st, catId(st, 'GK'));
    const pack = await parseMacroImport(gkJson);
    expect(pack.categories).toEqual(['GK']);
    expect(pack.items.map((i) => [i.macro.name, i.categoryName])).toEqual([['Perfect Dive', 'GK'], ['Gagatech', 'GK']]);
    expect(pack.items.every((i) => !i.macro.enabled)).toBe(true);
  });

  it('importar categoria existente: "merge" adiciona dentro; "new" cria separada; nada é apagado', async () => {
    const base = defaultMacrosState();
    const pack = await parseMacroImport(exportCategory(base, catId(base, 'GK')));
    expect(importCollisions(base, pack)).toEqual(['GK']);

    const merged = applyImport(base, pack, 'merge').state;
    expect(merged.categories.map((c) => c.name)).toEqual(['Bug Indi', 'GK']); // não cria categoria nova
    expect(merged.macros.length).toBe(7); // 5 + 2 importadas (ids novos)

    const asNew = applyImport(base, pack, 'new').state;
    expect(asNew.categories.map((c) => c.name)).toEqual(['Bug Indi', 'GK', 'GK (2)']);
    expect(asNew.macros.length).toBe(7);
  });

  it('migração v3 (categoria como texto "group") vira categorias-entidade', () => {
    const v3 = { v: 3, stopKey: 'F8', macros: [
      { id: 'a', name: 'A', group: 'Movimento', trigger: 'KeyA', steps: [{ t: 'key', code: 'KeyE' }] },
      { id: 'b', name: 'B', group: 'Combate', trigger: 'KeyB', steps: [{ t: 'key', code: 'KeyE' }] },
      { id: 'c', name: 'C', trigger: 'KeyC', steps: [{ t: 'key', code: 'KeyE' }] },
    ] };
    const st = restoreMacrosState(v3);
    expect(st.v).toBe(4);
    expect(st.categories.map((c) => c.name)).toEqual(['Movimento', 'Combate']);
    const name = idToName(st);
    expect(st.macros.map((m) => [m.name, name(m.categoryId)])).toEqual([['A', 'Movimento'], ['B', 'Combate'], ['C', null]]);
  });

  it('importação: JSON, pacote e código BOPE-SEQ1 do site antigo — sempre desativadas, sem AHK', async () => {
    const one = { bope: 'macro', v: 1, name: 'A', trigger: 'KeyA', steps: [{ t: 'key', code: 'KeyE' }] };
    expect((await parseMacroImport(JSON.stringify(one))).items[0].macro).toMatchObject({ name: 'A', enabled: false });
    const pack = JSON.stringify({ bope: 'macro-pack', v: 1, macros: [one, { ...one, name: 'Flick Up (AHK)' }] });
    expect((await parseMacroImport(pack)).items.map((i) => i.macro.name)).toEqual(['A']);
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
