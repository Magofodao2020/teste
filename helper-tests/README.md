# Testes do Helper (escrita/pausa de flags)

Rodam fora do Windows: `fakewin.cjs` simula o Windows (koffi) e um processo do
Roblox com memória (páginas graváveis e só leitura).

```bash
mkdir -p /tmp/h && unzip -o "gerenciador-helper-2.2.0 (3).zip" -d /tmp/h
HELPER_DIR=/tmp/h/helper node --test helper-tests/pause.test.cjs helper-tests/engine.test.cjs
```
