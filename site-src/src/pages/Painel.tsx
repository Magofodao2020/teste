import {
  Activity, CircleAlert, CircleCheck, Crosshair, Database, Eraser, Gauge, Layers, LoaderCircle, Play, RefreshCw, TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { validateAll } from '../core/macros';
import { navigate } from '../App';
import { type StatusInfo, compatStatus, helperStatus, offsetStatus, robloxStatus } from '../state/status';
import { store, useApp } from '../state/store';
import {
  Ago, Button, Card, Chip, KeyBadge, Logo, Notice, formatNumber,
} from '../ui/components';
import { InvalidFlagsDialog } from './InvalidFlagsDialog';

function CheckRow({ info, title, action }: { info: StatusInfo; title?: string; action?: React.ReactNode }) {
  const tone = info.tone === 'busy' || info.tone === 'neutral' ? 'wait' : info.tone;
  const Icon = info.tone === 'ok' ? CircleCheck : info.tone === 'err' ? CircleAlert : info.tone === 'busy' ? LoaderCircle : TriangleAlert;
  return (
    <div className={`check ${tone}`}>
      <div className="check-icon"><Icon className={info.tone === 'busy' ? 'spin' : undefined} /></div>
      <div className="col" style={{ gap: 1 }}>
        <div className="check-title">{title ?? info.label}</div>
        <div className="check-text">{title ? `${info.label}. ${info.detail}` : info.detail}</div>
      </div>
      {action && <div className="check-action">{action}</div>}
    </div>
  );
}

export function PainelPage({ invalidCount }: { invalidCount: number }) {
  const helper = useApp((s) => s.helper);
  const checked = useApp((s) => s.helperChecked);
  const offsets = useApp((s) => s.offsets);
  const index = useApp((s) => s.index);
  const macros = useApp((s) => s.macros);
  const presets = useApp((s) => s.presets);
  const activeId = useApp((s) => s.activePresetId);
  const busy = useApp((s) => s.busy);
  const live = useApp((s) => s.live);
  const history = useApp((s) => s.history);
  const [cleaning, setCleaning] = useState(false);
  useEffect(() => store.watchLive(), []);
  const issues = useMemo(() => validateAll(macros), [macros]);
  const recentErrors = history.filter((h) => h.result === 'erro').slice(-4).reverse();

  const h = helperStatus(helper, checked);
  const r = robloxStatus(helper);
  const o = offsetStatus(offsets);
  const c = compatStatus(offsets, helper);
  const active = presets.find((p) => p.id === activeId) ?? null;
  const allOk = h.tone === 'ok' && r.tone === 'ok' && c.tone === 'ok' && o.tone === 'ok';
  const okButUnverified = h.tone === 'ok' && r.tone === 'ok' && c.tone === 'ok' && o.tone === 'warn';
  const headline = allOk ? 'Tudo pronto'
    : okButUnverified ? (offsets.status === 'offline' ? 'Pronto, mas versão LIVE não verificada' : 'Pronto, mas offsets desatualizados')
    : !helper && checked ? 'Abra o Helper'
    : h.tone !== 'ok' ? h.label
    : r.tone !== 'ok' ? (helper?.detection?.state === 'not-running' ? 'Abra o Roblox' : 'Roblox não identificado')
    : c.tone === 'err' ? 'Versões diferentes'
    : o.tone === 'err' ? 'Offsets indisponíveis'
    : 'Preparando…';

  return (
    <div className="page">
      <section className="card hero">
        <Logo className="hero-mark" />
        <Logo className="hero-watermark" alt="" />
        <div className="col" style={{ gap: 2, flex: 1 }}>
          <div className="eyebrow">Painel do BOPE</div>
          <h2>{headline}</h2>
          <p>{allOk ? 'Helper conectado, Roblox identificado, versão LIVE verificada e offsets na mesma versão. As ações e os presets estão prontos para uso.' : okButUnverified ? 'O Roblox em execução e os offsets em uso são da mesma versão (o Helper confere antes de escrever), mas o site não conseguiu confirmar a versão LIVE. Veja o item Offsets.' : 'Siga os itens abaixo. Cada um mostra o que falta e como resolver.'}</p>
        </div>
      </section>

      <Card title="Prontidão" icon={<CircleCheck size={18} />}>
        <div className="checklist" style={{ marginTop: 0 }}>
          <CheckRow info={h} title="Helper local" />
          <CheckRow info={r} title="Roblox" />
          <CheckRow
            info={o}
            title="Offsets"
            action={(offsets.status === 'outdated' || offsets.status === 'offline' || offsets.status === 'unavailable') && (
              <Button size="sm" icon={<RefreshCw />} onClick={() => void store.offsets?.refresh()}>Tentar de novo</Button>
            )}
          />
          <CheckRow info={c} title="Compatibilidade" />
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Versão e offsets" icon={<Database size={18} />}>
          <dl className="kv">
            <dt>Versão atual (LIVE)</dt>
            <dd className="mono">{offsets.liveVersion ? <>✓ {offsets.liveVersion}</> : <span style={{ color: 'var(--amber)', fontFamily: 'var(--font)' }}>⚠ não verificada</span>}</dd>
            <dt>Offsets</dt>
            <dd><Chip tone={o.tone}>{o.label}</Chip></dd>
            <dt>Dataset em uso</dt>
            <dd className="mono">{offsets.dataset ? offsets.dataset.version : '—'}{offsets.dataset && offsets.status !== 'ready' && <span className="tag amber" style={{ marginLeft: 8, fontFamily: 'var(--font)' }}>não confirmado como atual</span>}</dd>
            <dt>Flags no dump</dt>
            <dd>{index ? formatNumber(index.size) : '—'}</dd>
            <dt>Última sincronização</dt>
            <dd><Ago at={offsets.lastSyncAt} /></dd>
            <dt>Roblox em execução</dt>
            <dd className="mono">{helper?.runningBuild ?? <span className="faint" style={{ fontFamily: 'var(--font)' }}>{helper ? 'não identificado' : 'Helper desconectado'}</span>}</dd>
          </dl>
          {(o.tone === 'warn' || o.tone === 'err') && <div style={{ marginTop: 14 }}><Notice tone={o.tone}><strong>{o.label}</strong> {o.detail}</Notice></div>}
        </Card>

        <Card
          title="Executor e ações"
          icon={<Crosshair size={18} />}
          actions={<div className="row" style={{ gap: 4 }}><Button size="sm" variant="ghost" onClick={() => navigate('diagnostico')}>Diagnóstico</Button><Button size="sm" variant="ghost" onClick={() => navigate('acoes')}>Gerenciar</Button></div>}
        >
          <div className="col" style={{ gap: 12 }}>
            <div className="stat-tiles small">
              <div className="stat"><strong>{macros.macros.length}</strong><span>ações</span></div>
              <div className="stat"><strong>{macros.categories.length}</strong><span>categorias</span></div>
              <div className={`stat ${macros.macros.some((m) => m.enabled) ? 'ok' : ''}`}><strong>{macros.macros.filter((m) => m.enabled).length}</strong><span>ativas</span></div>
              <div className={`stat ${live?.running.length ? 'live' : ''}`}><strong>{live?.running.length ?? 0}</strong><span>rodando</span></div>
              <div className={`stat ${!helper ? 'bad' : live?.hookReady ? 'ok' : 'warn'}`}><strong>{!helper ? 'off' : live ? (live.hookReady ? 'hook' : 'polling') : '…'}</strong><span>executor</span></div>
              <button type="button" className={`stat ${issues.length ? 'warn' : ''}`} onClick={() => navigate('acoes')}><strong>{issues.length}</strong><span>avisos</span></button>
            </div>
            {recentErrors.length > 0 && (
              <div className="col" style={{ gap: 4 }}>
                <span className="field-label" style={{ color: '#ff8a8d' }}><TriangleAlert size={13} /> Erros recentes</span>
                {recentErrors.map((h) => <span key={h.seq} className="faint" style={{ fontSize: 12.5 }}>{new Date(h.at).toLocaleTimeString('pt-BR')} · <strong>{h.name}</strong>: {h.error}</span>)}
              </div>
            )}
            {!!live?.running.length && <span className="row" style={{ gap: 6, fontSize: 12.5 }}><Activity size={13} /> Rodando: {live.running.map((r) => r.name).join(', ')}</span>}
            {macros.macros.length === 0 && <span className="faint">Nenhuma ação criada.</span>}
            {macros.macros.filter((m) => m.enabled).slice(0, 6).map((m) => (
              <div key={m.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span className="row truncate" style={{ gap: 8 }}>
                  <span className="status-pill on">● Ativa</span>
                  <span className="truncate" style={{ fontWeight: 600 }}>{m.name}</span>
                </span>
                <KeyBadge code={m.trigger} />
              </div>
            ))}
            <div className="row wrap" style={{ gap: 6 }}>
              <Button size="sm" icon={<Crosshair />} onClick={() => navigate('acoes')}>Ações</Button>
              <Button size="sm" icon={<Gauge />} onClick={() => navigate('diagnostico')}>Latência e histórico</Button>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Preset ativo"
        icon={<Layers size={18} />}
        actions={<Button size="sm" variant="ghost" onClick={() => navigate('presets')}>Abrir presets</Button>}
      >
        {active ? (
          <div className="col" style={{ gap: 14 }}>
            <div className="row wrap" style={{ justifyContent: 'space-between' }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="swatch" style={{ background: active.color }} />
                <strong style={{ fontSize: 16 }}>{active.name}</strong>
                <span className="tag">{formatNumber(Object.keys(active.flags).length)} flags</span>
              </div>
              <Button
                variant="primary"
                icon={<Play />}
                busy={busy.apply}
                disabled={!helper || !offsets.dataset || !Object.keys(active.flags).length}
                onClick={() => void store.applyActive()}
              >
                Aplicar no Roblox
              </Button>
            </div>
            {invalidCount > 0 ? (
              <Notice tone="warn" action={<Button size="sm" icon={<Eraser />} onClick={() => setCleaning(true)}>Remover flags inválidas</Button>}>
                <strong>{invalidCount} {invalidCount === 1 ? 'configuração salva não existe' : 'configurações salvas não existem'} no dump atual.</strong> Elas são ignoradas pelo Helper.
              </Notice>
            ) : index ? (
              <Notice tone="ok">Todas as flags salvas existem no dump atual ({index.version}).</Notice>
            ) : null}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Nenhum preset selecionado.</p>
        )}
      </Card>
      {cleaning && <InvalidFlagsDialog onClose={() => setCleaning(false)} />}
    </div>
  );
}
