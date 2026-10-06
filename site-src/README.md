# Painel do BOPE — site

Código-fonte do site (React + TypeScript + Vite). O resultado do build (`dist/`) é o
conteúdo publicado/hospedado (o mesmo que vai no zip `gerenciador-site-hospedar`).

```bash
npm install
npm run dev        # desenvolvimento
npm run build      # typecheck + build em dist/
npm test           # testes unitários (Vitest)
npm run test:e2e   # testes ponta a ponta no Chromium (precisa do build)
```

`npm run test:e2e` usa o Chromium em `CHROMIUM_PATH` (padrão `/opt/pw-browsers/chromium`).

## Arquitetura

```
src/
  core/                 regras sem interface (testáveis)
    flags.ts            nomes/tipos de flag — espelho exato do Helper
    offsets/dataset.ts  modelo do dataset + parsers/validação (JSON do site, offsets.json, FFlags.hpp)
    offsets/service.ts  ÚNICO ponto que busca versão LIVE/offsets na internet (com cache e fallback)
    offsets/remote.ts   fetch com diagnóstico (CORS × rede × HTTP × formato) e proxy do site
    helper/client.ts    cliente do Helper local (127.0.0.1:7962–7966)
    macros.ts           ações/macros (modelos, sanitização igual ao Helper, import/export)
    presets.ts          presets, importação/exportação, limpeza de flags inexistentes
    storage/            IndexedDB do site (presets + cache de offsets) e localStorage (preferências)
  state/
    store.ts            estado central + sincronização com o Helper (fila serializada)
    status.ts           textos de status em pt-BR (funções puras)
  pages/                Painel, Ações (+ editor/gravador), Presets, Catálogo, Configurações
  ui/                   componentes, tema BOPE, logo e fontes (locais, sem CDN)
```

### Versão e offsets (automáticos)

1. Ao abrir, o site usa o último dataset válido do cache e consulta
   `https://offsets.imtheo.lol/roblox/version` (versão LIVE).
2. Mesma versão → reutiliza o dataset (nenhum download).
3. Versão nova → cache do navegador → `data/dumps/<versão>.json` publicado com o site →
   `https://offsets.imtheo.lol/offsets.json` (se não trouxer o grupo de FFlags,
   `https://offsets.imtheo.lol/FFlags.hpp` da mesma versão).
4. Baixa → faz o parse → valida → só então troca o dataset. Falhas mantêm o dataset atual.
5. Nova verificação a cada 30 min com a aba visível (ou ao voltar para a aba depois disso).

A interface sempre diferencia: **✓ Versão LIVE verificada** · **⚠ Versão LIVE não
verificada** (usando o último dataset válido, que NÃO é confirmado como atual) ·
**✕ Não foi possível carregar os offsets**. A causa exata fica em
Configurações → Diagnóstico da conexão.

### Diagnóstico de falhas (`src/core/offsets/remote.ts`)

Quando um `fetch` falha por CORS, DNS, certificado ou falta de internet, o navegador
entrega ao JavaScript sempre o mesmo `TypeError: Failed to fetch`. Para não chutar:

- pedido normal (`mode: 'cors'`) → se falhar, sonda `mode: 'no-cors'` na mesma URL;
- a sonda responde → o servidor respondeu, mas **CORS bloqueou a leitura da resposta**
  (a origem enviada aparece no diagnóstico);
- a sonda também falha → sem conexão (DNS, certificado, firewall/antivírus, extensão ou internet);
- HTTP ≠ 2xx, tempo esgotado, resposta vazia e resposta que não é `version-<16 hex>` têm
  mensagens próprias.

### Proxy do site (só se o CORS bloquear)

O serviço precisa responder com `Access-Control-Allow-Origin` para o navegador ler a
resposta. Se não responder, o site usa um proxy **do próprio hosting** na mesma
origem (`/api/imtheo/roblox/version`, `/api/imtheo/offsets.json`, `/api/imtheo/FFlags.hpp`).
Lista fechada de caminhos, só GET, sem credenciais. O Helper nunca participa.

| Hosting | Como publicar | Proxy |
|---|---|---|
| Cloudflare **Pages** | Workers & Pages → Criar → aba **Pages** → *Upload de arquivos* (zip do build) | `_worker.js` dentro do build |
| Cloudflare **Workers** | `npm run deploy:cloudflare` (usa `wrangler.jsonc`) | `public/_worker.js` como script do Worker |
| Netlify | arrastar a pasta/zip do build | regras no `_redirects` |
| Vercel | `vercel deploy dist` | `vercel.json` |
| GitHub Pages / estático puro | qualquer | sem proxy: só funciona se o serviço liberar CORS |

O upload de arquivos no fluxo **Workers** do painel aceita só arquivos estáticos e
recusa `_routes.json`/`_worker.js` ("Pages _routes.json is not supported"). Use o
fluxo **Pages** para o zip, ou `npm run deploy:cloudflare` para publicar como Worker
(esse comando cria `dist/.assetsignore` só para o deploy de Worker).

**Conferir o proxy:** abra `https://SEU-SITE/api/imtheo/_status` (ou Configurações →
Diagnóstico → *Testar proxy do site*). JSON `{"ok":true,"proxy":"painel-bope"}` = proxy
ativo. A página do site ou 404 = o `_worker.js` não foi publicado.
Com o proxy ativo, `https://SEU-SITE/api/imtheo/roblox/version` mostra exatamente o que
o serviço de offsets responde.

**Recomendado: Cloudflare Pages** — HTTPS automático, `_headers` já usado pelo site,
proxy (`_worker.js`) funciona no upload direto do zip e plano gratuito generoso.
Netlify é a segunda opção (proxy por regras no `_redirects`).

### Ações e macros

`src/core/macros.ts`: macros do usuário (criar, editar, gravar, importar/exportar) e os
modelos do BOPE (Bug Indi, Bug indi ESQUERDA, Bug indi DIREITA, Perfect Dive, Gagatech).
Nenhuma ação começa ativa. Os tipos de etapa são exatamente os que o Helper executa
(`flick, move, path, click, down, up, scroll, key, keydown, keyup, text, wait`).
A gravação usa as rotas do Helper `/macro/record/*` (hook global do Windows).

### Dados do usuário

Presets e cache de offsets: IndexedDB `gerenciador` (v2). Ações, atalhos e
preferências: localStorage. Presets do site antigo são migrados automaticamente.
