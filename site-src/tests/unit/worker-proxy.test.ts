import { describe, expect, it, vi } from 'vitest';

// _worker.js é JavaScript puro publicado com o site (Cloudflare Pages).
const WORKER = '../../public/_worker.js';

async function load() {
  return (await import(/* @vite-ignore */ WORKER)).default as { fetch: (r: Request, env: unknown) => Promise<Response> };
}

describe('proxy do site (_worker.js)', () => {
  it('repassa somente os 3 caminhos permitidos, só GET/HEAD, sem cookies, com cache', async () => {
    const worker = await load();
    const upstream = vi.fn(async (url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)?.Cookie).toBeUndefined();
      return new Response(url.endsWith('version') ? 'version-cec3ad5889b447cf' : '{}', { status: 200, headers: { 'content-type': 'text/plain' } });
    });
    vi.stubGlobal('fetch', upstream);
    const env = { ASSETS: { fetch: vi.fn(async () => new Response('static')) } };

    const ok = await worker.fetch(new Request('https://site.test/api/imtheo/roblox/version', { headers: { Cookie: 'x=1' } }), env);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('version-cec3ad5889b447cf');
    expect(ok.headers.get('X-Bope-Proxy')).toBe('1');
    expect(ok.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(ok.headers.get('X-Bope-Upstream-Status')).toBe('200');
    const st = await worker.fetch(new Request('https://site.test/api/imtheo/_status'), env);
    expect(await st.json()).toMatchObject({ ok: true, proxy: 'painel-bope' });
    expect(upstream).toHaveBeenCalledWith('https://offsets.imtheo.lol/roblox/version', expect.any(Object));

    expect(await (await worker.fetch(new Request('https://site.test/api/imtheo/../../etc/passwd'), env)).text()).toBe('static'); // normalizado: não passa pelo proxy
    expect((await worker.fetch(new Request('https://site.test/api/imtheo/constructor'), env)).status).toBe(404);
    expect((await worker.fetch(new Request('https://site.test/api/imtheo/offsets.json', { method: 'POST', body: 'x' }), env)).status).toBe(405);
    expect(upstream).toHaveBeenCalledTimes(1);

    const page = await worker.fetch(new Request('https://site.test/index.html'), env);
    expect(await page.text()).toBe('static');
    vi.unstubAllGlobals();
  });

  it('falha do serviço vira 502 com mensagem (sem derrubar o site)', async () => {
    const worker = await load();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('dns'); }));
    const r = await worker.fetch(new Request('https://site.test/api/imtheo/offsets.json'), { ASSETS: { fetch: vi.fn() } });
    expect(r.status).toBe(502);
    vi.unstubAllGlobals();
  });
});
