import { Activity, Gauge, History, ListOrdered, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type HistoryEntry, type MacroStats, statsByMacro } from '../core/helper/live';
import { store, useApp } from '../state/store';
import { Button, Card, Empty, Notice, Switch } from '../ui/components';

const fmt = (v: number | null | undefined, d = 2) => (v == null ? '—' : `${Number(v.toFixed(d))} ms`);
const RESULT_TONE: Record<string, string> = { concluída: 'green', direto: 'gold', parada: '', solta: '', erro: 'red', bloqueada: 'amber' };

/**
 * Diagnóstico do executor: o que está rodando agora, histórico de execuções e as
 * latências REAIS medidas no Helper (gatilho → 1ª entrada enviada, duração real ×
 * planejada, atraso das esperas). Tudo vem do Helper; o site só mostra.
 */
export function DiagnosticoPage() {
  const helper = useApp((s) => s.helper);
  const live = useApp((s) => s.live);
  const history = useApp((s) => s.history);
  const historyOn = useApp((s) => s.macros.history);
  const [macroFilter, setMacroFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');
  useEffect(() => store.watchLive(), []);

  const stats = useMemo(() => statsByMacro(history.filter((h) => h.result !== 'bloqueada')), [history]);
  const shown = useMemo(() => history.filter((h) => (macroFilter === 'all' || h.id === macroFilter) && (resultFilter === 'all' || h.result === resultFilter)).slice(-200).reverse(), [history, macroFilter, resultFilter]);
  const names = useMemo(() => [...new Map(history.map((h) => [h.id, h.name])).entries()], [history]);
  const recent = macroFilter === 'all' ? null : history.filter((h) => h.id === macroFilter && h.latency != null).slice(-60);

  return (
    <div className="page">
      {!helper && <Notice tone="warn"><strong>Helper desconectado.</strong> O diagnóstico vem do executor local; abra o help.bat.</Notice>}

      <Card title="Executor agora" icon={<Activity size={18} />}>
        <div className="stat-tiles">
          <div className={`stat ${helper ? 'ok' : 'bad'}`}><strong>{helper ? 'conectado' : 'desconectado'}</strong><span>Helper</span></div>
          <div className={`stat ${live?.hookReady ? 'ok' : 'warn'}`}><strong>{live ? (live.hookReady ? 'ativo' : 'inativo') : '—'}</strong><span>hook do Windows</span></div>
          <div className={`stat ${live?.running.length ? 'live' : ''}`}><strong>{live?.running.length ?? 0}</strong><span>rodando</span></div>
          <div className="stat"><strong>{live?.queued.length ?? 0}</strong><span>na fila</span></div>
          <div className="stat"><strong>{live ? `${live.workers.busy}/${live.workers.total}` : '—'}</strong><span>workers ocupados (máx. {live?.workers.max ?? '—'})</span></div>
        </div>
        {live && !live.hookReady && helper && <p className="faint" style={{ margin: '10px 0 0', fontSize: 12.5 }}>Sem o hook, os gatilhos são lidos por polling a cada 8 ms (até ~8 ms a mais de latência) e a execução direta da Gagatech fica desligada.</p>}
        {live?.simulated && <Notice tone="warn">Helper fora do Windows: execução simulada (nada é enviado ao sistema).</Notice>}
        {!!live?.running.length && (
          <div className="list" style={{ marginTop: 12 }}>
            {live.running.map((r) => (
              <div key={r.id} className="list-row">
                <span className="live-badge"><Activity size={12} /> rodando</span>
                <strong className="truncate" style={{ flex: 1 }}>{r.name}</strong>
                <span className="faint" style={{ fontSize: 12 }}>há {Math.max(0, Math.round((Date.now() - r.since) / 100) / 10)} s</span>
                <Button size="sm" variant="danger" icon={<Square />} onClick={() => void store.stopMacro(r.id)}>Parar</Button>
              </div>
            ))}
          </div>
        )}
        {!!live?.queued.length && <p className="faint" style={{ margin: '10px 0 0', fontSize: 12.5 }}>Na fila: {live.queued.map((q) => `${q.name} (grupo ${q.group})`).join(', ')}.</p>}
      </Card>

      <Card title="Latência por ação" icon={<Gauge size={18} />}>
        {stats.length === 0 ? (
          <Empty icon={<Gauge />} title="Sem execuções ainda">Use uma ação (no jogo ou em “Testar”) para ver as latências medidas no Helper.</Empty>
        ) : (
          <>
            <LatencyChart stats={stats} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ação</th><th>Execuções</th><th title="Gatilho → primeira entrada enviada">Latência média</th><th>Mín · Máx</th>
                    <th title="Desvio padrão da latência">Variação</th><th>Duração real</th><th>Planejada</th><th title="Maior atraso de uma espera em relação ao horário planejado">Atraso máx.</th><th>Travadas</th><th>Etapas</th><th>Erros</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.id} className={macroFilter === s.id ? 'sel' : ''} onClick={() => setMacroFilter(macroFilter === s.id ? 'all' : s.id)} style={{ cursor: 'pointer' }}>
                      <td><strong>{s.name}</strong></td>
                      <td>{s.runs}</td>
                      <td className="mono">{fmt(s.latAvg)}</td>
                      <td className="mono">{fmt(s.latMin)} · {fmt(s.latMax)}</td>
                      <td className="mono">{fmt(s.latJitter)}</td>
                      <td className="mono">{fmt(s.msAvg, 1)}</td>
                      <td className="mono">{fmt(s.plannedAvg, 0)}</td>
                      <td className={`mono ${s.lateMax != null && s.lateMax > 5 ? 'warn-text' : ''}`}>{fmt(s.lateMax)}</td>
                      <td className={s.stalls ? 'warn-text' : ''}>{s.stalls}</td>
                      <td>{Math.round(s.stepsAvg * 10) / 10}</td>
                      <td className={s.errors ? 'err-text' : ''}>{s.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {recent && recent.length > 1 && <Sparkline entries={recent} />}
            <p className="faint" style={{ margin: '10px 0 0', fontSize: 12 }}>
              Latência = do instante em que o Windows entregou o gatilho até a primeira entrada enviada pelo executor (inclui o delay inicial configurado). Ações “diretas” (Gagatech) enviam as teclas dentro do próprio hook: latência ≈ 0.
              “Atraso máx.” mostra o quanto uma espera passou do horário planejado; “travadas” conta atrasos acima de 40 ms (PC ocupado), quando o executor recomeça a contar do agora. Clique numa linha para filtrar.
            </p>
          </>
        )}
      </Card>

      <Card
        title="Histórico de execuções"
        icon={<History size={18} />}
        actions={(
          <div className="row wrap" style={{ gap: 8 }}>
            <Switch checked={historyOn} onChange={(v) => store.setHistoryEnabled(v)} label="Registrar histórico" />
            <Button size="sm" variant="ghost" icon={<Trash2 />} disabled={!history.length} onClick={() => void store.clearHistory()}>Limpar</Button>
          </div>
        )}
      >
        {!historyOn && <Notice tone="warn">O registro está desligado: o Helper não guarda novas execuções.</Notice>}
        <div className="toolbar" style={{ margin: '0 0 12px' }}>
          <select className="select" value={macroFilter} onChange={(e) => setMacroFilter(e.target.value)} aria-label="Filtrar histórico por ação">
            <option value="all">Todas as ações</option>
            {names.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className="select" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} aria-label="Filtrar histórico por resultado">
            <option value="all">Todos os resultados</option>
            {['concluída', 'parada', 'solta', 'direto', 'bloqueada', 'erro'].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <span className="faint" style={{ fontSize: 12.5 }}>{shown.length} de {history.length}</span>
        </div>
        {shown.length === 0 ? <p className="faint" style={{ margin: 0 }}>Nada registrado ainda.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Hora</th><th>Ação</th><th>Resultado</th><th>Duração</th><th>Planejada</th><th>Latência</th><th>Etapas</th><th>Atraso máx.</th><th>Detalhe</th></tr></thead>
              <tbody>
                {shown.map((h) => (
                  <tr key={h.seq}>
                    <td className="mono">{new Date(h.at).toLocaleTimeString('pt-BR')}</td>
                    <td>{h.name}</td>
                    <td><span className={`tag ${RESULT_TONE[h.result] ?? ''}`}>{h.result}</span></td>
                    <td className="mono">{fmt(h.ms, 1)}</td>
                    <td className="mono">{fmt(h.planned, 0)}</td>
                    <td className="mono">{fmt(h.latency)}</td>
                    <td>{h.steps}{h.iterations > 1 ? ` ×${h.iterations}` : ''}</td>
                    <td className="mono">{fmt(h.lateMax)}</td>
                    <td className="faint" style={{ fontSize: 12 }}>{h.error ?? (h.stalls ? `${h.stalls} travada(s)` : '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Barras horizontais: faixa mín–máx da latência de cada ação, com a média marcada. */
function LatencyChart({ stats }: { stats: MacroStats[] }) {
  const rows = stats.filter((s) => s.latAvg != null).slice(0, 12);
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((s) => s.latMax ?? 0));
  const W = 560, L = 150, R = 70, H = 26;
  const x = (v: number) => L + (v / max) * (W - L - R);
  return (
    <figure className="chart" aria-label="Latência por ação (mín, média, máx)">
      <svg viewBox={`0 0 ${W} ${rows.length * H + 22}`} role="img">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={x(max * f)} x2={x(max * f)} y1={0} y2={rows.length * H} className="grid-line" />
            <text x={x(max * f)} y={rows.length * H + 15} className="axis" textAnchor="middle">{Number((max * f).toFixed(2))} ms</text>
          </g>
        ))}
        {rows.map((s, i) => (
          <g key={s.id} transform={`translate(0 ${i * H})`}>
            <text x={L - 8} y={H / 2 + 4} className="label" textAnchor="end">{s.name.length > 20 ? s.name.slice(0, 19) + '…' : s.name}</text>
            <rect x={x(s.latMin ?? 0)} y={H / 2 - 5} width={Math.max(2, x(s.latMax ?? 0) - x(s.latMin ?? 0))} height={10} rx={5} className="range" />
            <circle cx={x(s.latAvg ?? 0)} cy={H / 2} r={5} className="avg" />
            <text x={W - R + 6} y={H / 2 + 4} className="value">{Number((s.latAvg ?? 0).toFixed(2))} ms</text>
          </g>
        ))}
      </svg>
      <figcaption className="faint">Faixa = menor e maior latência · ponto = média.</figcaption>
    </figure>
  );
}

/** Últimas latências de uma ação (para ver variação e picos). */
function Sparkline({ entries }: { entries: HistoryEntry[] }) {
  const vals = entries.map((e) => e.latency ?? 0);
  const max = Math.max(0.01, ...vals);
  const W = 560, H = 70;
  const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * W},${H - (v / max) * (H - 8) - 4}`).join(' ');
  return (
    <figure className="chart" aria-label={`Últimas ${vals.length} latências de ${entries[0].name}`}>
      <div className="row" style={{ gap: 8 }}><ListOrdered size={14} /><span className="field-label">Últimas {vals.length} execuções de {entries[entries.length - 1].name}</span><span className="faint" style={{ fontSize: 12 }}>pico {Number(max.toFixed(2))} ms</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" preserveAspectRatio="none" style={{ height: 70 }}>
        <polyline points={pts} className="spark" />
      </svg>
    </figure>
  );
}
