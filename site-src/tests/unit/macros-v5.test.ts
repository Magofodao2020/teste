import { describe, expect, it } from 'vitest';
import {
  addCategory, applyImport, applyTiming, defaultMacrosState, directBlocker, duplicateCategory, exportAll, macroMs, macroTotalMs,
  moveMacroTo, newMacro, parseMacroImport, patchMany, removeCategory, restoreDefaults, restoreMacrosState, sanitizeMacro,
  savePresetFromMacro, timingDiff, toHelperMacro, upsertMacro, validateAll,
} from '../../src/core/macros';
import { mergeHistory, parseHistory, parseLive, statsByMacro } from '../../src/core/helper/live';

describe('modelo v5 das ações', () => {
  it('v4 salvo vira v5 sem perder nada (nomes, categorias, teclas, delays, etapas)', () => {
    const v4 = {
      v: 4, stopKey: 'F9', templatesRev: 2,
      categories: [{ id: 'c1', name: 'Combate' }],
      macros: [{ id: 'm1', name: 'Minha', categoryId: 'c1', enabled: true, trigger: 'KeyG', mode: 'loop', repeat: 3, loopDelay: 40, speed: 2, robloxOnly: false, sideKey: null, sideSound: true, steps: [{ t: 'key', code: 'KeyE', hold: 10, delay: 5 }] }],
    };
    const st = restoreMacrosState(JSON.parse(JSON.stringify(v4)));
    expect(st.v).toBe(5);
    expect(st.stopKey).toBe('F9');
    const m = st.macros[0];
    expect(m).toMatchObject({ id: 'm1', name: 'Minha', categoryId: 'c1', enabled: true, trigger: 'KeyG', mode: 'loop', repeat: 3, loopDelay: 40, speed: 2, robloxOnly: false });
    expect(m.steps).toEqual([{ t: 'key', code: 'KeyE', hold: 10, delay: 5, n: 1, gap: 60 }]);
    // campos novos com os padrões que mantêm o comportamento antigo
    expect(m).toMatchObject({ startDelay: 0, stepGap: 0, endDelay: 0, debounce: 150, onRetrigger: 'stop', mods: [], stopKey: null, group: '', blockTrigger: true });
    expect(st.timingPresets.length).toBeGreaterThan(0);
    expect(st.history).toBe(true);
    // v5 salvo continua igual
    expect(restoreMacrosState(JSON.parse(JSON.stringify(st)))).toEqual(st);
  });

  it('sanitização: 0 ms aceito em todos os delays, sem mínimo; parada ≠ gatilho; etapas com depois/desativada', () => {
    const m = sanitizeMacro({ trigger: 'F1', stopKey: 'F1', startDelay: 0, stepGap: 0, endDelay: -5, debounce: 0, mods: ['alt', 'ctrl', 'nada'], steps: [{ t: 'key', code: 'KeyA', after: 0 }, { t: 'wait', ms: 0, off: true }] })!;
    expect(m.stopKey).toBeNull();
    expect(m.endDelay).toBe(0);
    expect(m.debounce).toBe(0);
    expect(m.mods).toEqual(['ctrl', 'alt']);
    expect(m.steps[0].after).toBeUndefined();
    expect(m.steps[1].off).toBe(true);
    expect(toHelperMacro(m)).toMatchObject({ startDelay: 0, stepGap: 0, debounce: 0, mods: ['ctrl', 'alt'] });
  });

  it('duração planejada conta delays inicial/entre etapas/depois/final e repetições, sem etapas desativadas', () => {
    const m = newMacro({ startDelay: 10, stepGap: 5, endDelay: 20, repeat: 2, loopDelay: 7, steps: [{ t: 'wait', ms: 100, after: 3 }, { t: 'wait', ms: 50 }, { t: 'wait', ms: 999, off: true }] });
    expect(macroMs(m)).toBe(10 + 100 + 3 + 5 + 50 + 20);
    expect(macroTotalMs(m)).toBe(10 + (158) * 2 + 7 + 20);
  });

  it('restaurar padrão: modelo volta ao original; ação própria só zera temporização', () => {
    const st = defaultMacrosState();
    const g = st.macros.find((m) => m.id === 'gagatech')!;
    const back = restoreDefaults({ ...g, trigger: 'F4', steps: [], stepGap: 99 });
    expect(back.trigger).toBe('MouseBack');
    expect(back.steps).toEqual(g.steps);
    expect(back.categoryId).toBe(g.categoryId);
    const own = restoreDefaults(newMacro({ name: 'X', trigger: 'KeyX', stepGap: 50, debounce: 0, steps: [{ t: 'key', code: 'KeyA' }] }));
    expect(own).toMatchObject({ name: 'X', trigger: 'KeyX', stepGap: 0, debounce: 150 });
    expect(own.steps).toHaveLength(1);
  });

  it('presets de temporização: salvar da ação, ver o que muda, aplicar só quando pedido', () => {
    let st = defaultMacrosState();
    const m = newMacro({ stepGap: 12, loopDelay: 30 });
    const r = savePresetFromMacro(st, 'Meu ritmo', m);
    st = r.state;
    const p = st.timingPresets.find((x) => x.id === r.id)!;
    expect(p.values).toMatchObject({ stepGap: 12, loopDelay: 30 });
    const other = newMacro();
    expect(timingDiff(other, p.values).sort()).toEqual(['loopDelay', 'stepGap']);
    expect(applyTiming(other, p.values)).toMatchObject({ stepGap: 12, loopDelay: 30 });
    expect(savePresetFromMacro(st, 'Meu ritmo', m).state.timingPresets.at(-1)!.name).toBe('Meu ritmo (2)');
  });

  it('excluir categoria: sem categoria, mover para outra ou apagar junto (só se escolhido)', () => {
    let st = defaultMacrosState();
    const gk = st.categories.find((c) => c.name === 'GK')!.id;
    const bug = st.categories.find((c) => c.name === 'Bug Indi')!.id;
    const inGk = st.macros.filter((m) => m.categoryId === gk).map((m) => m.id);
    expect(removeCategory(st, gk).macros.filter((m) => inGk.includes(m.id)).every((m) => m.categoryId === null)).toBe(true);
    expect(removeCategory(st, gk, { moveTo: bug }).macros.filter((m) => inGk.includes(m.id)).every((m) => m.categoryId === bug)).toBe(true);
    expect(removeCategory(st, gk, 'delete').macros.some((m) => inGk.includes(m.id))).toBe(false);
    const dup = duplicateCategory(st, gk);
    st = dup.state;
    const copies = st.macros.filter((m) => m.categoryId === dup.id);
    expect(copies).toHaveLength(inGk.length);
    expect(copies.every((m) => !m.enabled && !inGk.includes(m.id))).toBe(true);
    expect(st.categories.find((c) => c.id === dup.id)!.name).toBe('GK (cópia)');
  });

  it('arrastar e soltar: muda de categoria e de posição', () => {
    let st = defaultMacrosState();
    const r = addCategory(st, 'Nova');
    st = r.state;
    st = moveMacroTo(st, 'perfect-dive', r.id, null);
    st = moveMacroTo(st, 'bug-indi', r.id, 'perfect-dive');
    const inNew = st.macros.filter((m) => m.categoryId === r.id).map((m) => m.id);
    expect(inNew).toEqual(['bug-indi', 'perfect-dive']);
  });

  it('edição em lote altera só as escolhidas e revalida', () => {
    const st = patchMany(defaultMacrosState(), ['bug-indi', 'perfect-dive'], { stepGap: 15, robloxOnly: false, debounce: -3 });
    const by = (id: string) => st.macros.find((m) => m.id === id)!;
    expect(by('bug-indi')).toMatchObject({ stepGap: 15, robloxOnly: false, debounce: 0 });
    expect(by('perfect-dive').stepGap).toBe(15);
    expect(by('gagatech').stepGap).toBe(0);
  });

  it('exportar/importar tudo: categorias em ordem, etapas, teclas, delays e presets — sem apagar nada', async () => {
    let st = defaultMacrosState();
    st = upsertMacro(st, { ...st.macros[0], stepGap: 33, mods: ['shift'], stopKey: 'F2', description: 'desc', steps: [{ t: 'key', code: 'KeyA', after: 4 }, { t: 'wait', ms: 1, off: true }] });
    st = savePresetFromMacro(st, 'Exportado', st.macros[0]).state;
    const pack = await parseMacroImport(exportAll(st));
    expect(pack.categories).toEqual(st.categories.map((c) => c.name));
    expect(pack.items[0].macro).toMatchObject({ stepGap: 33, mods: ['shift'], stopKey: 'F2', description: 'desc', enabled: false });
    expect(pack.items[0].macro.steps).toEqual([{ t: 'key', code: 'KeyA', after: 4, n: 1, hold: 40, gap: 60 }, { t: 'wait', ms: 1, off: true }]);
    const r = applyImport(st, pack, 'merge');
    expect(r.state.macros.length).toBe(st.macros.length * 2);
    expect(r.addedPresets).toBe(0); // presets idênticos não duplicam
    const changed = { ...pack, timingPresets: pack.timingPresets!.map((p) => ({ ...p, values: { ...p.values, stepGap: 1 } })) };
    const r2 = applyImport(st, changed, 'merge');
    expect(r2.addedPresets).toBeGreaterThan(0);
    expect(r2.state.timingPresets.length).toBe(st.timingPresets.length + r2.addedPresets); // nada sobrescrito
  });

  it('validação: conflitos, etapas incompatíveis e referências quebradas, com como corrigir', () => {
    let st = defaultMacrosState();
    st = { ...st, macros: st.macros.map((m) => (['bug-indi', 'gagatech', 'perfect-dive'].includes(m.id) ? { ...m, enabled: true } : m)) };
    st = upsertMacro(st, { ...st.macros.find((m) => m.id === 'perfect-dive')!, steps: [{ t: 'keyup', code: 'KeyZ' }], categoryId: 'sumiu' });
    const issues = validateAll(st);
    const text = issues.map((i) => i.text).join('\n');
    expect(text).toMatch(/"Bug Indi", "Gagatech" usam o mesmo botão.*roda direto no hook/);
    expect(text).toMatch(/solta Z, mas nenhuma etapa antes segura essa tecla/);
    expect(text).toMatch(/categoria que não existe/);
    expect(issues.every((i) => i.fix.length > 0)).toBe(true);
  });

  it('Gagatech roda direto no hook só quando a configuração permite (e diz por quê)', () => {
    const g = defaultMacrosState().macros.find((m) => m.id === 'gagatech')!;
    expect(directBlocker(g)).toBeNull();
    expect(directBlocker({ ...g, robloxOnly: true })).toMatch(/Roblox em foco/);
    expect(directBlocker({ ...g, trigger: 'KeyG' })).toMatch(/lateral/);
    expect(directBlocker({ ...g, startDelay: 5 })).toMatch(/espera/);
    expect(directBlocker({ ...g, trigger: 'MouseMiddle' })).toBeNull();
  });
});

describe('estado ao vivo e histórico', () => {
  it('lê o estado do executor e junta o histórico sem duplicar', () => {
    const live = parseLive({ running: [{ id: 'a', name: 'A', since: 1 }], hookReady: true, workers: { total: 2, busy: 1, max: 16 }, direct: { g: { slot: 1, presses: 3, fails: 0, held: true, last: 5 } }, directWhy: { g: null, x: 'motivo' }, historySeq: 9 })!;
    expect(live.running[0].id).toBe('a');
    expect(live.direct.g.presses).toBe(3);
    expect(live.directWhy.x).toBe('motivo');
    const h1 = parseHistory({ seq: 2, items: [{ seq: 1, id: 'a', name: 'A', result: 'concluída', latency: 1.5 }, { seq: 2, id: 'a', name: 'A', result: 'concluída', latency: 2.5 }] }).items;
    const merged = mergeHistory(h1, [...h1, { ...h1[1], seq: 3, latency: 0.5 }]);
    expect(merged.map((h) => h.seq)).toEqual([1, 2, 3]);
    const s = statsByMacro(merged)[0];
    expect(s.runs).toBe(3);
    expect(s.latAvg).toBeCloseTo(1.5);
    expect(s.latMin).toBe(0.5);
    expect(s.latJitter).toBeGreaterThan(0);
  });
});
