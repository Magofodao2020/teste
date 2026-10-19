Datasets de offsets publicados junto com o site.

O site define a versão automaticamente (versão LIVE) e baixa os offsets quando
ela muda. Estes arquivos são uma fonte local: se a versão LIVE tiver um arquivo
aqui, o site usa este arquivo em vez de baixar de fora.

manifest.json  -> lista de versões disponíveis.
<versao>.json  -> offsets de FFlags (robloxVersion, flags[]).

Para publicar uma versão (opcional):
  node scripts/build-dataset.mjs caminho/para/FFlags.hpp
Depois: npm run build e publique a pasta dist/.
