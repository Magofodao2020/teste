// Botões laterais do mouse = "Voltar/Avançar" do navegador. Sem esta proteção, ao
// apertar o lateral para definir o gatilho de uma ação, o navegador volta de página
// (Chrome/Edge no mouseup; Firefox/LibreWolf às vezes só por WM_APPCOMMAND, sem
// evento de mouse no JavaScript) e a captura/edição se perde.
//
// 1. mouseup/auxclick dos botões 3/4 têm o padrão cancelado (Chrome/Edge/Brave/Opera).
// 2. Uma entrada "guarda" no histórico (mesma URL) fica sempre no topo. Se o navegador
//    voltar por causa do botão lateral, a guarda é recolocada e nada muda na tela.
//    Durante uma captura, esse "voltar" sem evento de mouse vira o código MouseBack.
// O botão Voltar da barra do navegador continua funcionando normalmente.

const RECENT_MS = 1500;
let installed = false;
let lastSideAt = 0;
let capturing = 0;
const subs = new Set<(code: string) => void>();

// Entradas do site: a "de verdade" ganha __bopePage; a guarda (por cima, mesma URL)
// ganha __bopeGuard. Entrada sem marca = navegação nova (link/#rota), não um "voltar".
type GuardState = { __bopeGuard?: number; __bopePage?: number } | null;

function armed() {
  try { return !!(history.state as GuardState)?.__bopeGuard; } catch { return true; }
}

function arm() {
  if (armed()) return;
  try {
    const st = (history.state as object | null) ?? {};
    history.replaceState({ ...st, __bopePage: 1 }, '');
    history.pushState({ ...st, __bopeGuard: 1 }, '', location.href);
  } catch { /* sem histórico */ }
}

export function installSideGuard() {
  if (installed || typeof window === 'undefined' || !window.history) return;
  installed = true;
  const onBtn = (e: MouseEvent) => {
    if (e.button !== 3 && e.button !== 4) return;
    lastSideAt = Date.now();
    if (e.type !== 'pointerdown' && e.cancelable) e.preventDefault();
  };
  for (const t of ['mousedown', 'mouseup', 'auxclick', 'pointerdown', 'pointerup']) window.addEventListener(t, onBtn as EventListener, true);
  // pushState só conta para o botão Voltar se feito com gesto do usuário.
  window.addEventListener('pointerdown', arm, true);
  window.addEventListener('keydown', arm, true);
  window.addEventListener('hashchange', arm);
  window.addEventListener('popstate', (e) => {
    const st = e.state as GuardState;
    // Guarda = nada a fazer. Sem marca = navegação nova para #rota (o hashchange arma).
    if (st?.__bopeGuard || !st?.__bopePage) return;
    const recent = Date.now() - lastSideAt < RECENT_MS;
    if (recent || capturing > 0) {
      // Se o lateral tivesse chegado como evento de mouse, a captura já teria terminado.
      if (capturing > 0) subs.forEach((fn) => { try { fn('MouseBack'); } catch { /* ignora */ } });
      arm();
      return;
    }
    // Voltar da barra do navegador: pula a entrada de mesma URL e volta de verdade.
    try { history.back(); } catch { /* ignora */ }
  });
}

/** Enquanto houver captura ativa, um "voltar" sem evento de mouse é tratado como MouseBack. */
export function beginSideCapture(onHistoryButton: (code: string) => void): () => void {
  capturing++;
  subs.add(onHistoryButton);
  return () => { capturing = Math.max(0, capturing - 1); subs.delete(onHistoryButton); };
}
