#!/usr/bin/env node
// Publica um dataset de offsets junto com o site (opcional — o site também
// atualiza sozinho pela versão LIVE). Gera public/data/dumps/<versão>.json a
// partir de um FFlags.hpp do RbxDumperV2 e regenera o manifest.json.
// Uso: node scripts/build-dataset.mjs caminho/para/FFlags.hpp
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const DIR = 'public/data/dumps';
const RVA_MIN = 0x100000;
const RVA_MAX = 0x10000000;
const src = process.argv[2];
if (!src) { console.error('Uso: node scripts/build-dataset.mjs FFlags.hpp'); process.exit(1); }

const text = readFileSync(src, 'utf8');
const vm = /ClientVersion\s*=\s*"([^"]+)"|Roblox Version\s*:\s*(version-[0-9a-fA-F]+)/.exec(text);
const version = (vm?.[1] ?? vm?.[2] ?? '').toLowerCase();
if (!/^version-[0-9a-f]{16}$/.test(version)) { console.error('Versão do Roblox não encontrada no .hpp.'); process.exit(1); }
const meta = (label) => new RegExp(`${label}\\s*:\\s*(.+?)\\s*$`, 'm').exec(text)?.[1];

const body = text.replace(/namespace\s+FFlagList\s*\{[^}]*\}/g, '');
const seen = new Set();
const flags = [];
for (const m of body.matchAll(/uintptr_t\s+([A-Za-z_]\w{0,127})\s*=\s*0x([0-9a-fA-F]{1,8})/g)) {
  const rva = parseInt(m[2], 16);
  if (rva < RVA_MIN || rva > RVA_MAX || seen.has(m[1])) continue;
  seen.add(m[1]);
  flags.push({ name: m[1], address: '0x' + rva.toString(16), type: 'unknown' });
}
if (flags.length < 500) { console.error(`Poucos offsets de flags (${flags.length}).`); process.exit(1); }

const out = {
  robloxVersion: version,
  dumperVersion: meta('Dumper Version'),
  dumpDate: new Date().toISOString(),
  totalOffsets: flags.length,
  dumpedWith: 'RbxDumperV2',
  sourceFileName: basename(src),
  flags,
};
writeFileSync(join(DIR, `${version}.json`), JSON.stringify(out));

const versions = readdirSync(DIR)
  .filter((f) => /^version-[0-9a-f]{16}\.json$/.test(f))
  .map((file) => {
    const d = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    return { id: d.robloxVersion, robloxVersion: d.robloxVersion, flagCount: d.flags.length, dumperVersion: d.dumperVersion, dumpDate: d.dumpDate, totalOffsets: d.totalOffsets, file };
  })
  .sort((a, b) => String(a.dumpDate).localeCompare(String(b.dumpDate)));
const manifest = { schema: 1, generatedAt: new Date().toISOString(), latest: versions[versions.length - 1].id, versions };
writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`OK: ${version} (${flags.length} flags). Agora rode "npm run build" e publique a pasta dist/.`);
