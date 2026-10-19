// Publicação como Cloudflare WORKER (npm run deploy:cloudflare).
// O fluxo de Workers recusa publicar o _worker.js como arquivo, então só aqui
// criamos dist/.assetsignore. O zip para o Cloudflare PAGES não leva esse
// arquivo (no Pages o _worker.js precisa ficar no build para virar o proxy).
import { writeFileSync } from 'node:fs';
writeFileSync('dist/.assetsignore', '_worker.js\n_routes.json\n');
console.log('dist/.assetsignore criado para o deploy como Worker.');
