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
    helper/client.ts    cliente do Helper local (127.0.0.1:7962–7966)
    actions.ts          as cinco ações (pack exato) e regras de botão
    presets.ts          presets, importação/exportação, limpeza de flags inexistentes
    storage/            IndexedDB do site (presets + cache de offsets) e localStorage (preferências)
  state/
    store.ts            estado central + sincronização com o Helper (fila serializada)
    status.ts           textos de status em pt-BR (funções puras)
  pages/                Painel, Ações, Presets, Catálogo, Configurações
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

O site envia ao Helper apenas o necessário (`/set-offsets`: versão, nomes e RVAs).
O Helper não acessa a internet.

### Dados do usuário

Presets e cache de offsets: IndexedDB `gerenciador` (v2). Ações, atalhos e
preferências: localStorage. Presets do site antigo são migrados automaticamente.
