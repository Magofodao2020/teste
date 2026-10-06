import {
  Crosshair, Layers, LayoutDashboard, Library, PanelLeftClose, PanelLeftOpen, Settings,
} from 'lucide-react';
import { type ComponentType, useEffect, useMemo, useState } from 'react';
import { scanInvalidFlags } from './core/presets';
import { AcoesPage } from './pages/Acoes';
import { CatalogoPage } from './pages/Catalogo';
import { ConfigPage } from './pages/Configuracoes';
import { PainelPage } from './pages/Painel';
import { PresetsPage } from './pages/Presets';
import { compatStatus, helperStatus, offsetStatus, robloxStatus } from './state/status';
import { store, useApp } from './state/store';
import { Chip, Logo, Toasts, shortVersion } from './ui/components';

export type Route = 'painel' | 'acoes' | 'presets' | 'catalogo' | 'config';

interface NavEntry { id: Route; label: string; subtitle: string; icon: ComponentType; section?: string }
const NAV: NavEntry[] = [
  { id: 'painel', label: 'Painel', subtitle: 'Visão geral: Helper, Roblox, offsets, ações e presets', icon: LayoutDashboard },
  { id: 'acoes', label: 'Ações', subtitle: 'Bug Indi e GK — o que cada botão do mouse faz', icon: Crosshair, section: 'Operação' },
  { id: 'presets', label: 'Presets', subtitle: 'Flags salvas e aplicação no Roblox', icon: Layers },
  { id: 'catalogo', label: 'Catálogo de flags', subtitle: 'Todas as flags do dump atual', icon: Library },
  { id: 'config', label: 'Configurações', subtitle: 'Helper, offsets e dados do site', icon: Settings, section: 'Sistema' },
];

function readRoute(): Route {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  return NAV.some((n) => n.id === r) ? r : 'painel';
}

export function navigate(r: Route) {
  if (readRoute() !== r) location.hash = `#/${r}`;
}

/** Botões laterais do mouse são gatilhos das ações: no site não devem voltar a página. */
function useSideButtonGuard() {
  useEffect(() => {
    const block = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) e.preventDefault(); };
    window.addEventListener('mouseup', block, true);
    window.addEventListener('auxclick', block, true);
    return () => {
      window.removeEventListener('mouseup', block, true);
      window.removeEventListener('auxclick', block, true);
    };
  }, []);
}

function useInvalidCount() {
  const index = useApp((s) => s.index);
  const presets = useApp((s) => s.presets);
  const hotkeys = useApp((s) => s.hotkeys);
  return useMemo(() => (index ? scanInvalidFlags(presets, hotkeys, index).total : 0), [index, presets, hotkeys]);
}

export function App() {
  const ready = useApp((s) => s.ready);
  const bootError = useApp((s) => s.bootError);
  const collapsed = useApp((s) => s.sidebarCollapsed);
  const [route, setRoute] = useState<Route>(readRoute);
  useSideButtonGuard();
  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const invalid = useInvalidCount();

  if (!ready) {
    return (
      <div className="boot">
        <div className="boot-inner">
          <div className="boot-ring"><Logo /></div>
          <div className="boot-title">BOPE</div>
          <div className="boot-sub">Carregando o painel…</div>
        </div>
      </div>
    );
  }
  if (bootError) {
    return (
      <div className="boot">
        <div className="boot-inner">
          <Logo className="hero-mark" />
          <div className="boot-title">BOPE</div>
          <div className="boot-sub">Não foi possível iniciar o painel: {bootError}</div>
          <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Recarregar</button>
        </div>
      </div>
    );
  }

  const entry = NAV.find((n) => n.id === route)!;
  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <Logo className="brand-mark" />
          <div className="brand-text">
            <div className="brand-title">B<span>.</span>O<span>.</span>P<span>.</span>E</div>
            <div className="brand-sub">Painel</div>
          </div>
        </div>
        <nav className="nav" aria-label="Navegação principal">
          {NAV.map((n) => {
            const Icon = n.icon;
            const badge = n.id === 'presets' && invalid > 0 ? invalid : null;
            return (
              <div key={n.id} style={{ display: 'contents' }}>
                {n.section && <div className="nav-label">{n.section}</div>}
                <a
                  href={`#/${n.id}`}
                  className={`nav-item ${route === n.id ? 'active' : ''}`}
                  aria-current={route === n.id ? 'page' : undefined}
                  title={n.label}
                  data-badge={badge ? '' : undefined}
                >
                  <Icon />
                  <span className="nav-text">{n.label}</span>
                  {badge && <span className="nav-badge" title={`${badge} flags inválidas`}>{badge}</span>}
                </a>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <button type="button" className="nav-item collapse-toggle" onClick={() => store.toggleSidebar()} title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            <span className="foot-text">{collapsed ? 'Expandir' : 'Recolher menu'}</span>
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="truncate">
            <h1>{entry.label}</h1>
            <div className="subtitle truncate">{entry.subtitle}</div>
          </div>
          <TopStatus />
        </header>
        <main className="content">
          {route === 'painel' && <PainelPage invalidCount={invalid} />}
          {route === 'acoes' && <AcoesPage />}
          {route === 'presets' && <PresetsPage />}
          {route === 'catalogo' && <CatalogoPage />}
          {route === 'config' && <ConfigPage />}
        </main>
      </div>
      <Toasts />
    </div>
  );
}

function TopStatus() {
  const helper = useApp((s) => s.helper);
  const checked = useApp((s) => s.helperChecked);
  const offsets = useApp((s) => s.offsets);
  const h = helperStatus(helper, checked);
  const r = robloxStatus(helper);
  const o = offsetStatus(offsets);
  const c = compatStatus(offsets, helper);
  const robloxChip = !helper ? h : r.tone === 'ok' ? c : r;
  return (
    <div className="topbar-status">
      <Chip tone={robloxChip.tone} title={robloxChip.detail} onClick={() => navigate('painel')}>
        <span className="chip-label">{robloxChip === c ? (c.tone === 'ok' ? 'Roblox compatível' : c.label) : robloxChip.label}</span>
      </Chip>
      <Chip tone={o.tone === 'ok' ? 'gold' : o.tone} title={`${o.label} ${o.detail}`} onClick={() => navigate('painel')}>
        <span className="chip-label">Offsets</span>
        <span className="mono">{shortVersion(offsets.dataset?.version)}</span>
      </Chip>
    </div>
  );
}
