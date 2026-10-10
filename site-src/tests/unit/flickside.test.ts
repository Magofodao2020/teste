import { describe, expect, it } from 'vitest';
import { macroProblems, sanitizeMacro, toExport, toHelperMacro } from '../../src/core/macros';

const base = { id: 'b', name: 'Bug indi', trigger: 'MouseBack', steps: [{ t: 'flick', btn: 'left', dx: 150, dy: 0 }] };

describe('alternar lado do flick', () => {
  it('guarda o botão de lado e o som; vai para o Helper e para a exportação', () => {
    const m = sanitizeMacro({ ...base, sideKey: 'MouseForward', sideSound: false })!;
    expect(m.sideKey).toBe('MouseForward');
    expect(m.sideSound).toBe(false);
    expect(toHelperMacro(m)).toMatchObject({ sideKey: 'MouseForward', sideSound: false });
    expect(toExport(m)).toMatchObject({ sideKey: 'MouseForward', sideSound: false });
    // importar de volta mantém
    expect(sanitizeMacro(toExport(m))!.sideKey).toBe('MouseForward');
  });

  it('padrão: sem botão de lado, som ligado; mesmo botão da ação é recusado', () => {
    const m = sanitizeMacro(base)!;
    expect(m.sideKey).toBeNull();
    expect(m.sideSound).toBe(true);
    expect(toExport(m)).not.toHaveProperty('sideKey');
    expect(sanitizeMacro({ ...base, sideKey: 'MouseBack' })!.sideKey).toBeNull();
    expect(macroProblems({ ...m, sideKey: 'MouseBack' })).toContain('O botão de alternar o lado tem que ser diferente do botão da ação.');
  });
});
