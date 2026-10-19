import { describe, expect, it, vi } from 'vitest';

const FN = '../../api/imtheo.mjs';

function mockRes() {
  const r = { statusCode: 0, headers: {} as Record<string, string>, body: undefined as unknown,
    setHeader(k: string, v: string) { r.headers[k.toLowerCase()] = v; }, end(b?: unknown) { r.body = b; } };
  return r;
}

describe('proxy do Vercel (api/imtheo.mjs)', () => {
  it('status, lista fechada, método e repasse com identificação', async () => {
    const handler = (await import(/* @vite-ignore */ FN)).default as (req: unknown, res: unknown) => Promise<void>;
    const upstream = vi.fn(async () => new Response('version-cec3ad5889b447cf', { status: 200, headers: { 'content-type': 'text/plain' } }));
    vi.stubGlobal('fetch', upstream);

    let res = mockRes();
    await handler({ url: '/api/imtheo?path=_status', method: 'GET' }, res);
    expect(JSON.parse(String(res.body))).toMatchObject({ ok: true, proxy: 'painel-bope', host: 'vercel' });

    res = mockRes();
    await handler({ url: '/api/imtheo?path=roblox/version', method: 'GET' }, res);
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toBe('version-cec3ad5889b447cf');
    expect(res.headers['x-bope-proxy']).toBe('1');
    expect(res.headers['x-bope-upstream-status']).toBe('200');
    expect(upstream).toHaveBeenCalledWith('https://offsets.imtheo.lol/roblox/version', expect.any(Object));

    res = mockRes();
    await handler({ url: '/api/imtheo?path=../../etc/passwd', method: 'GET' }, res);
    expect(res.statusCode).toBe(404);
    res = mockRes();
    await handler({ url: '/api/imtheo?path=offsets.json', method: 'POST' }, res);
    expect(res.statusCode).toBe(405);
    expect(upstream).toHaveBeenCalledTimes(1);

    upstream.mockImplementationOnce(async () => new Response('Not Found', { status: 404 }));
    res = mockRes();
    await handler({ url: '/api/imtheo?path=offsets.json', method: 'GET' }, res);
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-bope-upstream-status']).toBe('404');
    vi.unstubAllGlobals();
  });
});
