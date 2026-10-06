// Utilitários de teste: fetch simulado por URL e geradores de payload.
export type Route = string | (() => Promise<Response> | Response) | { status: number; body?: string };

export function mockFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    if (r === undefined) throw new TypeError('Failed to fetch');
    if (typeof r === 'function') return r();
    if (typeof r === 'string') return new Response(r, { status: 200 });
    return new Response(r.body ?? '', { status: r.status });
  }) as typeof fetch;
  return { fn, calls };
}

export const V_OLD = 'version-02c37bc51a384b8f';
export const V_NEW = 'version-aaaaaaaaaaaaaaaa';

export function flagEntries(n: number, start = 0x200000) {
  return Array.from({ length: n }, (_, i) => ({ name: `TestFlag${i}`, address: '0x' + (start + i * 8).toString(16) }));
}

export function siteDatasetJson(version: string, n = 600) {
  return JSON.stringify({ robloxVersion: version, dumperVersion: '2.2.4', dumpDate: '2026-10-06T07:23:00Z', flags: flagEntries(n) });
}

export function offsetsJson(version: string, withFlags: boolean, n = 600) {
  const Offsets: Record<string, Record<string, number | string>> = { Humanoid: { Health: 404, MaxHealth: 436, Walkspeed: 476, JumpPower: 432 } };
  if (withFlags) Offsets.FFlags = Object.fromEntries(flagEntries(n).map((f) => [f.name, f.address]));
  return JSON.stringify({ Source: 'https://imtheo.lol/Offsets', 'Roblox Version': version, 'Dumper Version': '2.2.4', 'Dumped At': '02:17 27/05/2026', 'Total Offsets': 4, Offsets });
}

export function fflagsHpp(version: string, n = 600) {
  const lines = flagEntries(n).map((f) => `         inline constexpr uintptr_t ${f.name} = ${f.address};`);
  return `#pragma once\n/*  Roblox Version  : ${version}\n*/\n#include <cstdint>\nnamespace FFlagList {\n  inline constexpr uintptr_t Pointer = 0x8a927f8;\n}\nnamespace FFlagOffsets {\n${lines.join('\n')}\n}\n`;
}

export function manifest(versions: string[]) {
  return JSON.stringify({ schema: 1, latest: versions[versions.length - 1], versions: versions.map((v) => ({ id: v, file: `${v}.json` })) });
}
