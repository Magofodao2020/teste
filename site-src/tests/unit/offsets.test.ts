import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DatasetError, buildIndex, flagExists, isValidDataset, parseFFlagsHpp, parseOffsetsJson, parseSiteDataset,
} from '../../src/core/offsets/dataset';
import {
  FFLAGS_HPP_URL, LIVE_VERSION_URL, OFFSETS_JSON_URL, OffsetService,
} from '../../src/core/offsets/service';
import { V_NEW, V_OLD, fflagsHpp, manifest, mockFetch, offsetsJson, siteDatasetJson } from './helpers';

const BASE = 'https://site.test/';
const MANIFEST = `${BASE}data/dumps/manifest.json`;
const siteFile = (v: string) => `${BASE}data/dumps/${v}.json`;

function service(routes: Parameters<typeof mockFetch>[0], storage = new Map()) {
  const f = mockFetch(routes);
  return { svc: new OffsetService({ fetch: f.fn, memory: storage, siteBase: BASE }), calls: f.calls, storage };
}

describe('parsers', () => {
  it('lê o dataset real publicado com o site', () => {
    const text = readFileSync('public/data/dumps/version-cec3ad5889b447cf.json', 'utf8');
    const ds = parseSiteDataset(text, 'version-cec3ad5889b447cf');
    expect(ds.names.length).toBe(14858);
    expect(ds.addresses[ds.names.indexOf('TaskSchedulerTargetFps')]).toBe('0x83e7808');
    expect(isValidDataset(ds)).toBe(true);
  });

  it('offsets.json: aceita estrutura válida e extrai grupo de FFlags', () => {
    const r = parseOffsetsJson(offsetsJson(V_NEW, true), V_NEW);
    expect(r.version).toBe(V_NEW);
    expect(r.flags?.names.length).toBe(600);
    expect(parseOffsetsJson(offsetsJson(V_NEW, false), V_NEW).flags).toBeNull();
  });

  it('offsets.json: rejeita JSON inválido, incompleto, sem versão, versão incoerente e estrutura errada', () => {
    const good = offsetsJson(V_NEW, true);
    expect(() => parseOffsetsJson('', V_NEW)).toThrow(DatasetError);
    expect(() => parseOffsetsJson(good.slice(0, good.length / 2), V_NEW)).toThrow(/JSON inválido/);
    expect(() => parseOffsetsJson('[]', V_NEW)).toThrow(DatasetError);
    expect(() => parseOffsetsJson(JSON.stringify({ Offsets: { A: { b: 1 } } }), V_NEW)).toThrow(/Roblox Version/);
    expect(() => parseOffsetsJson(good, V_OLD)).toThrow(/versão LIVE/);
    expect(() => parseOffsetsJson(JSON.stringify({ 'Roblox Version': V_NEW }), V_NEW)).toThrow(/Offsets/);
    expect(() => parseOffsetsJson(JSON.stringify({ 'Roblox Version': V_NEW, Offsets: {} }), V_NEW)).toThrow(/vazio/);
    expect(() => parseOffsetsJson(JSON.stringify({ 'Roblox Version': V_NEW, Offsets: { A: [1, 2] } }), V_NEW)).toThrow(/estrutura/);
    expect(() => parseOffsetsJson(JSON.stringify({ 'Roblox Version': V_NEW, Offsets: { A: { x: 'lixo' } } }), V_NEW)).toThrow(/Valor inválido/);
    expect(() => parseOffsetsJson(JSON.stringify({ 'Roblox Version': V_NEW, Offsets: { FFlags: { A: 0x200000 } } }), V_NEW)).toThrow(/poucos/);
  });

  it('FFlags.hpp: valida versão e ignora o namespace de estrutura', () => {
    const r = parseFFlagsHpp(fflagsHpp(V_NEW), V_NEW);
    expect(r.names).not.toContain('Pointer');
    expect(r.names.length).toBe(600);
    expect(() => parseFFlagsHpp(fflagsHpp(V_OLD), V_NEW)).toThrow(/versão LIVE/);
    expect(() => parseFFlagsHpp('<html>erro</html>', V_NEW)).toThrow(DatasetError);
  });

  it('índice usa a mesma chave do Helper (prefixo removido ou nome exato)', () => {
    const ds = parseSiteDataset(siteDatasetJson(V_NEW), V_NEW);
    const idx = buildIndex(ds, { TestFlag1: 'DFInt' });
    expect(idx.fullNames[1]).toBe('DFIntTestFlag1');
    expect(flagExists(idx, 'TestFlag1')).toBe(true);
    expect(flagExists(idx, 'DFIntTestFlag1')).toBe(true);
    expect(flagExists(idx, 'FFlagTestFlag0')).toBe(true);
    expect(flagExists(idx, 'FFlagTestFlag99999')).toBe(false);
    expect(flagExists(idx, 'TestFlag')).toBe(false); // nada de "nome parecido"
  });
});

describe('OffsetService', () => {
  it('versão nova: usa o dataset publicado com o site e guarda no cache', async () => {
    const { svc, calls, storage } = service({
      [LIVE_VERSION_URL]: V_NEW + '\n', [MANIFEST]: manifest([V_OLD, V_NEW]), [siteFile(V_NEW)]: siteDatasetJson(V_NEW),
    });
    await svc.start();
    svc.dispose();
    const s = svc.getState();
    expect(s.status).toBe('ready');
    expect(s.dataset?.version).toBe(V_NEW);
    expect(s.source).toBe('site');
    expect(calls).not.toContain(OFFSETS_JSON_URL);
    expect((storage.get(V_NEW))).toBeTruthy();
  });

  it('versão igual à que já está na memória da aba: não baixa nada', async () => {
    const storage = new Map();
    { const d = parseSiteDataset(siteDatasetJson(V_NEW), V_NEW); storage.set(d.version, d); }
    const { svc, calls } = service({ [LIVE_VERSION_URL]: V_NEW }, storage);
    await svc.start();
    svc.dispose();
    expect(svc.getState().status).toBe('ready');
    expect(svc.getState().source).toBe('memória');
    expect(calls).toEqual([LIVE_VERSION_URL]);
  });

  it('versão nova fora do site: baixa offsets.json (com grupo de FFlags)', async () => {
    const { svc, calls } = service({
      [LIVE_VERSION_URL]: V_NEW, [MANIFEST]: manifest([V_OLD]), [OFFSETS_JSON_URL]: offsetsJson(V_NEW, true),
    });
    await svc.start();
    svc.dispose();
    expect(svc.getState()).toMatchObject({ status: 'ready', source: 'remote' });
    expect(svc.getState().dataset?.origin).toBe('imtheo');
    expect(calls).not.toContain(FFLAGS_HPP_URL);
  });

  it('offsets.json sem FFlags: completa com FFlags.hpp da mesma versão', async () => {
    const { svc, calls } = service({
      [LIVE_VERSION_URL]: V_NEW, [MANIFEST]: manifest([V_OLD]), [OFFSETS_JSON_URL]: offsetsJson(V_NEW, false), [FFLAGS_HPP_URL]: fflagsHpp(V_NEW),
    });
    await svc.start();
    svc.dispose();
    expect(svc.getState()).toMatchObject({ status: 'ready', source: 'remote' });
    expect(calls).toContain(FFLAGS_HPP_URL);
  });

  it('download inválido/parcial: mantém o dataset atual (status outdated)', async () => {
    for (const bad of [
      { status: 500 },
      '{"Roblox Version": "' + V_NEW + '", "Offsets": {"FFl',
      () => Promise.resolve({ ok: true, status: 200, text: () => Promise.reject(new TypeError('network error')) } as unknown as Response),
      offsetsJson(V_OLD, true),
    ]) {
      const storage = new Map();
      { const d = parseSiteDataset(siteDatasetJson(V_OLD), V_OLD); storage.set(d.version, d); }
      const { svc } = service({ [LIVE_VERSION_URL]: V_NEW, [MANIFEST]: manifest([V_OLD]), [OFFSETS_JSON_URL]: bad }, storage);
      await svc.start();
      svc.dispose();
      const s = svc.getState();
      expect(s.status).toBe('outdated');
      expect(s.dataset?.version).toBe(V_OLD);
      expect(s.error).toMatch(/Não foi possível atualizar os offsets/);
      expect(storage.get(V_NEW)).toBeUndefined();
    }
  });

  it('sem internet: usa o último dataset do cache', async () => {
    const storage = new Map();
    { const d = parseSiteDataset(siteDatasetJson(V_OLD), V_OLD); storage.set(d.version, d); }
    const { svc } = service({}, storage);
    await svc.start();
    svc.dispose();
    expect(svc.getState()).toMatchObject({ status: 'offline', liveVersion: null });
    expect(svc.getState().dataset?.version).toBe(V_OLD);
  });

  it('sem internet e sem cache: usa o dataset mais recente publicado com o site', async () => {
    const { svc } = service({ [MANIFEST]: manifest([V_OLD]), [siteFile(V_OLD)]: siteDatasetJson(V_OLD) });
    await svc.start();
    svc.dispose();
    expect(svc.getState()).toMatchObject({ status: 'offline', source: 'site' });
  });

  it('nenhum dataset válido em lugar nenhum: unavailable', async () => {
    const { svc } = service({ [MANIFEST]: manifest([V_OLD]), [siteFile(V_OLD)]: '{"robloxVersion":"x"}' });
    await svc.start();
    svc.dispose();
    expect(svc.getState()).toMatchObject({ status: 'unavailable', dataset: null });
  });

  it('resposta da versão LIVE inválida não é aceita', async () => {
    const { svc } = service({ [LIVE_VERSION_URL]: '<html>Cloudflare</html>', [MANIFEST]: manifest([V_OLD]), [siteFile(V_OLD)]: siteDatasetJson(V_OLD) });
    await svc.start();
    svc.dispose();
    expect(svc.getState().liveVersion).toBeNull();
    expect(svc.getState().status).toBe('offline');
  });

  it('chamadas simultâneas compartilham a mesma verificação', async () => {
    const { svc, calls } = service({ [LIVE_VERSION_URL]: V_NEW, [MANIFEST]: manifest([V_NEW]), [siteFile(V_NEW)]: siteDatasetJson(V_NEW) });
    await Promise.all([svc.refresh(), svc.refresh(), svc.refresh()]);
    expect(calls.filter((c) => c === LIVE_VERSION_URL)).toHaveLength(1);
    expect(calls.filter((c) => c === siteFile(V_NEW))).toHaveLength(1);
  });

  it('cache guarda no máximo 3 versões', async () => {
    const storage = new Map();
    for (let i = 0; i < 4; i++) {
      const v = `version-${String(i).repeat(16)}`;
      const { svc } = service({ [LIVE_VERSION_URL]: v, [MANIFEST]: manifest([v]), [siteFile(v)]: siteDatasetJson(v) }, storage);
      await svc.refresh();
    }
    expect([...storage.values()].length).toBe(3);
  });
});
