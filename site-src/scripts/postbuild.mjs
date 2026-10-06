// Depois do build: copia a configuração e a função do Vercel para dentro de dist/,
// para que um deploy feito só com a pasta dist (ou com o zip) também tenha o proxy.
// No deploy a partir do código, o Vercel usa vercel.json e api/ da raiz do projeto.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist/api', { recursive: true });
copyFileSync('api/imtheo.mjs', 'dist/api/imtheo.mjs');
const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
delete cfg.buildCommand; // dist já vem pronto: sem build, servido da raiz
delete cfg.outputDirectory;
writeFileSync('dist/vercel.json', JSON.stringify(cfg, null, 2) + '\n');
console.log('dist/vercel.json e dist/api/imtheo.mjs prontos (proxy do Vercel).');
