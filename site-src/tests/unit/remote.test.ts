import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSiteDataset } from '../../src/core/offsets/dataset';
import { RemoteClient, parseLiveVersion } from '../../src/core/offsets/remote';
import { LIVE_VERSION_URL, OFFSETS_JSON_URL, OffsetService } from '../../src/core/offsets/service';
import { MemoryKV } from '../../src/core/storage/db';
import { V_NEW, V_OLD, corsBlocked, mockFetch, offsetsJson, siteDatasetJson } from './helpers';

const BASE = 'https://meusite.test/';
const PROXY_LIVE = `${BASE}api/imtheo/roblox/version`;
const PROXY_OFFSETS = `${BASE}api/imtheo/offsets.json`;

async function withOld() {
  const storage = new MemoryKV();
  await storage.put('datasets', parseSiteDataset(siteDatasetJson(V_OLD), V_OLD));
  return storage;
}

describe('parseLiveVersion', () => {
  it('aceita texto puro com espaços/quebras de linha e normaliza', () => {
    expect(parseLiveVersion(' version-CEC3AD5889B447CF\r\n')).toEqual({ version: 'version-cec3ad5889b447cf' });
    expect(parseLiveVersion('﻿version-cec3ad5889b447cf')).toEqual({ version: 'version-cec3ad5889b447cf' });
  });
  it('aceita JSON string ou objeto com campo de versão', () => {
    expect(parseLiveVersion('"version-cec3ad5889b447cf"')).toEqual({ version: 'version-cec3ad5889b447cf' });
    expect(parseLiveVersion('{"version":"version-cec3ad5889b447cf"}')).toEqual({ version: 'version-cec3ad5889b447cf' });
    expect(parseLiveVersion('{"Roblox Version":"version-cec3ad5889b447cf"}')).toEqual({ version: 'version-cec3ad5889b447cf' });
  });
  it('recusa vazio, HTML, versão malformada e texto com versão no meio', () => {
    expect(parseLiveVersion('   ')).toEqual({ error: 'empty' });
    expect(parseLiveVersion('<html>version-cec3ad5889b447cf</html>')).toEqual({ error: 'invalid' });
    expect(parseLiveVersion('version-abc123def456')).toEqual({ error: 'invalid' });
    expect(parseLiveVersion('Current: version-cec3ad5889b447cf')).toEqual({ error: 'invalid' });
    expect(parseLiveVersion('{"version":"1.2.3"}')).toEqual({ error: 'invalid' });
  });
});

describe('diagnóstico da consulta LIVE', () => {
  it('CORS: a sonda no-cors responde → "CORS bloqueou a leitura"; hosting sem proxy é explicado', async () => {
    const { fn, modes } = mockFetch({ [LIVE_VERSION_URL]: corsBlocked(), [PROXY_LIVE]: { status: 404, body: 'Not found' } });
    const svc = new OffsetService({ fetch: fn, storage: await withOld(), siteBase: BASE });
    await svc.refresh();
    const s = svc.getState();
    expect(s.status).toBe('offline');
    expect(s.liveVersion).toBeNull();
    expect(s.diagnostic?.kind).toBe('cors');
    expect(s.diagnostic?.message).toMatch(/CORS bloqueou a leitura da resposta/);
    expect(s.diagnostic?.message).toMatch(/proxy do site \(\/api\/imtheo\/\) não está ativo/);
    expect(s.diagnostic?.message).toMatch(/HTTP 404/);
    expect(s.diagnostic?.info?.origin).toBeTruthy();
    expect(modes).toEqual(expect.arrayContaining([[LIVE_VERSION_URL, 'cors'], [LIVE_VERSION_URL, 'no-cors']]));
  });

  it('CORS + proxy do site: usa o proxy e os próximos pedidos já vão por ele', async () => {
    const { fn, calls } = mockFetch({
      [LIVE_VERSION_URL]: corsBlocked(), [OFFSETS_JSON_URL]: corsBlocked(),
      [PROXY_LIVE]: V_NEW, [PROXY_OFFSETS]: offsetsJson(V_NEW, true),
    });
    const svc = new OffsetService({ fetch: fn, storage: await withOld(), siteBase: BASE });
    await svc.refresh();
    expect(svc.getState()).toMatchObject({ status: 'ready', liveVersion: V_NEW, source: 'remote' });
    expect(svc.getState().diagnostic?.info?.via).toBe('proxy do site');
    expect(calls).not.toContain(OFFSETS_JSON_URL); // depois de confirmar CORS, vai direto ao proxy
    expect(calls).toContain(PROXY_OFFSETS);
  });

  it('proxy que devolve a página HTML do site (rewrite SPA) não é aceito como proxy', async () => {
    const { fn } = mockFetch({ [LIVE_VERSION_URL]: corsBlocked(), [PROXY_LIVE]: { status: 200, body: '<!doctype html><html></html>', type: 'text/html' } });
    const svc = new OffsetService({ fetch: fn, storage: await withOld(), siteBase: BASE });
    await svc.refresh();
    expect(svc.getState().diagnostic?.kind).toBe('cors');
    expect(svc.getState().diagnostic?.message).toMatch(/devolveu a página do site/);
  });

  it('proxy ATIVO mas o serviço responde 404: a culpa é do serviço, não do hosting', async () => {
    const proxied404 = () => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain', 'x-bope-proxy': '1', 'x-bope-upstream-status': '404' } });
    const { fn } = mockFetch({ [LIVE_VERSION_URL]: corsBlocked(), [PROXY_LIVE]: proxied404 });
    const svc = new OffsetService({ fetch: fn, storage: await withOld(), siteBase: BASE });
    await svc.refresh();
    const d = svc.getState().diagnostic!;
    expect(d.kind).toBe('http');
    expect(d.message).toMatch(/O proxy do site está ativo, mas offsets.imtheo.lol respondeu HTTP 404 para \/roblox\/version/);
    expect(d.message).not.toMatch(/não está ativo/);
  });

  it('proxy de Netlify/Vercel (sem cabeçalho próprio) que responde a versão é aceito', async () => {
    const { fn } = mockFetch({ [LIVE_VERSION_URL]: corsBlocked(), [PROXY_LIVE]: V_NEW });
    const svc = new OffsetService({ fetch: fn, storage: await withOld(), siteBase: BASE });
    await svc.refresh();
    expect(svc.getState().liveVersion).toBe(V_NEW);
  });

  it('sem conexão: sonda também falha → erro de rede (não é chamado de CORS)', async () => {
    const { fn, calls } = mockFetch({});
    const svc = new OffsetService({ fetch: fn, storage: await withOld(), siteBase: BASE });
    await svc.refresh();
    expect(svc.getState().diagnostic?.kind).toBe('network');
    expect(calls).not.toContain(PROXY_LIVE); // proxy só com CORS confirmado
  });

  it('HTTP 500 e resposta vazia têm causas próprias', async () => {
    for (const [route, kind, rx] of [[{ status: 500, body: 'erro' }, 'http', /HTTP 500/], ['', 'empty', /vazia/]] as const) {
      const { fn } = mockFetch({ [LIVE_VERSION_URL]: route });
      const svc = new OffsetService({ fetch: fn, storage: await withOld(), siteBase: BASE });
      await svc.refresh();
      expect(svc.getState().status).toBe('offline');
      expect(svc.getState().diagnostic?.kind).toBe(kind);
      expect(svc.getState().diagnostic?.message).toMatch(rx);
    }
  });

  it('timeout: a requisição é abortada e a causa é "tempo esgotado"', async () => {
    vi.useFakeTimers();
    const hang = (init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const { fn } = mockFetch({ [LIVE_VERSION_URL]: hang });
    const svc = new OffsetService({ fetch: fn, storage: await withOld(), siteBase: BASE });
    const p = svc.refresh();
    await vi.advanceTimersByTimeAsync(10_500);
    await p;
    expect(svc.getState().diagnostic?.kind).toBe('timeout');
    expect(svc.getState().diagnostic?.message).toMatch(/tempo esgotado/);
  });

  it('falha depois de um sucesso: a versão LIVE antiga não é reaproveitada', async () => {
    let up = true;
    const { fn } = mockFetch({ [LIVE_VERSION_URL]: () => { if (up) return new Response(V_OLD); throw new TypeError('x'); } });
    const svc = new OffsetService({ fetch: fn, storage: await withOld(), siteBase: BASE });
    await svc.refresh();
    expect(svc.getState()).toMatchObject({ status: 'ready', liveVersion: V_OLD });
    up = false;
    await svc.refresh();
    expect(svc.getState()).toMatchObject({ status: 'offline', liveVersion: null });
  });

  it('RemoteClient registra status, tipo e redirect', async () => {
    const res = new Response('version-cec3ad5889b447cf', { status: 200, headers: { 'content-type': 'text/plain' } });
    Object.defineProperty(res, 'redirected', { value: true });
    Object.defineProperty(res, 'url', { value: 'https://outro.test/v' });
    const client = new RemoteClient((async () => res) as unknown as typeof fetch, BASE);
    const r = await client.get('roblox/version', 1000);
    expect(r.info).toMatchObject({ status: 200, contentType: 'text/plain', redirectedTo: 'https://outro.test/v', via: 'direto' });
  });
});

afterEach(() => { vi.useRealTimers(); });
