import {
  Activity, ArrowDown, ArrowLeft, ArrowUp, Copy, Crosshair, Eye, EyeOff, GripVertical, Play, Plus, RotateCcw, Save, Square, Timer, Trash2, X, Zap,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  GROUP_POLICIES, type GroupPolicy, MODES, MODS, MOUSE_BUTTONS, type Macro, type MacroMode, type MacroStep, type Mod, STEP_LABEL, STEP_TYPES,
  type StepType, TEMPLATES, type TimingValues, applyTiming, defaultStep, describeStep, directBlocker, hasSideFlick, macroMs, macroProblems,
  macroTotalMs, moveItem, restoreDefaults, sanitizeMacro, sanitizeStep, timingDiff, timingOf, triggerLabel,
} from '../core/macros';
import { store, useApp } from '../state/store';
import { Button, Card, Confirm, KeyCapture, Modal, Notice, Switch } from '../ui/components';
import { IntField, NumField, TimingInputs } from '../ui/fields';

const SECTIONS = [
  ['geral', 'Geral'], ['ativacao', 'Ativação'], ['etapas', 'Etapas'], ['tempo', 'Temporização'],
  ['repeticoes', 'Repetições'], ['comportamento', 'Comportamento'], ['avancado', 'Avançado'],
] as const;

/**
 * Editor de uma ação (nova, gravada ou existente), organizado em seções. Nada é
 * salvo até clicar em Salvar; ações novas são salvas DESATIVADAS.
 */
export function MacroEditor({ initial, isNew, onClose }: { initial: Macro; isNew: boolean; onClose: () => void }) {
  const helper = useApp((s) => s.helper);
  const categories = useApp((s) => s.macros.categories);
  const presets = useApp((s) => s.macros.timingPresets);
  const live = useApp((s) => s.live);
  const allMacros = useApp((s) => s.macros.macros);
  const groups = useMemo(() => [...new Set(allMacros.map((x) => x.group).filter(Boolean))], [allMacros]);
  const [m, setM] = useState<Macro>(() => structuredClone(initial));
  const [addType, setAddType] = useState<StepType>('key');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [presetAsk, setPresetAsk] = useState<{ id: string; diff: string[] } | null>(null);
  const [savePreset, setSavePreset] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => store.watchLive(), []);
  useEffect(() => { document.querySelector('.content')?.scrollTo({ top: 0 }); }, []);
  const dirty = useMemo(() => isNew || JSON.stringify(m) !== JSON.stringify(initial), [m, initial, isNew]);
  const problems = macroProblems(m);
  const saveProblems = problems.filter((p) => !p.startsWith('Defina o botão')); // sem botão pode salvar (fica desativada)

  const patch = (p: Partial<Macro>) => setM((cur) => ({ ...cur, ...p }));
  const flickHasDx = hasSideFlick(m.steps);
  const setStep = (i: number, s: MacroStep) => setM((cur) => ({ ...cur, steps: cur.steps.map((x, k) => (k === i ? s : x)) }));
  const move = (from: number, to: number) => setM((cur) => ({ ...cur, steps: moveItem(cur.steps, from, to) }));
  const running = !!live?.running.some((r) => r.id === m.id);
  const directInfo = live?.direct[m.id] ?? null;

  const save = () => {
    if (saveProblems.length) { setShowErrors(true); return; }
    const clean = sanitizeMacro({ ...m, steps: m.steps.map((s) => sanitizeStep(s)).filter(Boolean) });
    if (!clean) return;
    store.saveMacro(clean);
    onClose();
  };
  const leave = () => (dirty ? setConfirmLeave(true) : onClose());
  const askPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    const diff = timingDiff(m, p.values);
    if (!diff.length) { store.toast('info', `"${p.name}" já é igual a esta ação.`); return; }
    setPresetAsk({ id, diff: diff.map(String) });
  };

  return (
    <div className="page">
      <div className="editor-head">
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <Button variant="ghost" icon={<ArrowLeft />} onClick={leave}>Voltar</Button>
          <h2 className="truncate" style={{ margin: 0, fontSize: 18 }}>{isNew ? 'Nova ação' : `Editar “${initial.name}”`}</h2>
          {!isNew && <span className={`status-pill ${initial.enabled ? 'on' : 'off'}`}>{initial.enabled ? '● Ativa' : '○ Desativada'}</span>}
          {running && <span className="live-badge"><Activity size={12} /> rodando agora</span>}
          {dirty && !isNew && <span className="tag amber">alterações não salvas</span>}
        </div>
        <div className="row wrap">
          {running
            ? <Button variant="danger" icon={<Square />} onClick={() => void store.stopMacro(m.id)}>Parar</Button>
            : <Button icon={<Play />} disabled={!helper || !m.steps.some((s) => !s.off)} onClick={() => void store.testMacro(m)} title={helper ? 'Roda uma vez em 3 segundos (sem salvar)' : 'Helper desconectado'}>Testar (3 s)</Button>}
          <Button onClick={leave}>Cancelar</Button>
          <Button variant="primary" icon={<Save />} onClick={save}>Salvar</Button>
        </div>
      </div>
      <nav className="section-nav" aria-label="Seções do editor">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#sec-${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{label}</a>)}
        <span className="faint" style={{ marginLeft: 'auto', fontSize: 12.5 }}>~{macroMs(m)} ms por passada{m.mode === 'once' && m.repeat > 1 ? ` · ~${macroTotalMs(m)} ms no total` : ''}</span>
      </nav>

      {showErrors && saveProblems.length > 0 && <Notice tone="err">{saveProblems.join(' ')}</Notice>}
      {isNew && <Notice>A ação será salva <strong>desativada</strong>. Ative na lista quando quiser usar.</Notice>}

      <Section id="geral" title="Geral">
        <div className="form-grid">
          <label className="col">
            <span className="field-label">Nome</span>
            <input className="input" value={m.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} aria-label="Nome da ação" />
          </label>
          <label className="col">
            <span className="field-label">Categoria</span>
            <select className="input" value={m.categoryId ?? ''} onChange={(e) => patch({ categoryId: e.target.value || null })} aria-label="Categoria da ação">
              <option value="">Sem categoria</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="col" style={{ gridColumn: '1 / -1' }}>
            <span className="field-label">Descrição (opcional)</span>
            <input className="input" value={m.description} maxLength={500} onChange={(e) => patch({ description: e.target.value })} aria-label="Descrição da ação" placeholder="Para que serve, quando usar…" />
          </label>
        </div>
      </Section>

      <Section id="ativacao" title="Ativação">
        <div className="form-grid">
          <div className="col">
            <span className="field-label">Botão ou tecla que ativa</span>
            <div className="row">
              <KeyCapture value={m.trigger} onChange={(c) => patch({ trigger: c })} label="Botão que ativa" />
              {m.trigger && <Button size="sm" variant="ghost" icon={<X />} onClick={() => patch({ trigger: null })} aria-label="Remover botão" />}
            </div>
            {!m.trigger && <span className="faint" style={{ fontSize: 12 }}>Sem botão a ação pode ser salva, mas não pode ser ativada.</span>}
          </div>
          <div className="col">
            <span className="field-label">Combinação (segurar junto com o botão)</span>
            <div className="row wrap" role="group" aria-label="Combinação">
              {MODS.map(([k, l]) => (
                <label key={k} className="row chk"><input type="checkbox" checked={m.mods.includes(k)} onChange={(e) => patch({ mods: e.target.checked ? [...m.mods, k] : m.mods.filter((x) => x !== k) as Mod[] })} aria-label={`Exigir ${l}`} /> {l}</label>
              ))}
            </div>
            <span className="faint" style={{ fontSize: 12 }}>{m.mods.length ? `Só dispara com ${m.mods.map((k) => MODS.find(([x]) => x === k)![1]).join(' + ')} + ${triggerLabel(m.trigger)}.` : 'Sem combinação: o botão sozinho dispara.'}</span>
          </div>
          <div className="col">
            <span className="field-label">Tecla de parada desta ação</span>
            <div className="row">
              <KeyCapture value={m.stopKey} onChange={(c) => patch({ stopKey: c })} label="Tecla de parada da ação" placeholder="Definir" />
              {m.stopKey && <Button size="sm" variant="ghost" icon={<X />} onClick={() => patch({ stopKey: null })} aria-label="Remover tecla de parada da ação" />}
            </div>
            <span className="faint" style={{ fontSize: 12 }}>Interrompe só esta ação (e solta o que ela segurava). A parada geral continua valendo.</span>
          </div>
          <div className="col">
            <span className="field-label">Só com o Roblox em foco</span>
            <div className="row"><Switch checked={m.robloxOnly} onChange={(v) => patch({ robloxOnly: v })} label="Só com o Roblox em foco" /><span className="faint" style={{ fontSize: 12.5 }}>{m.robloxOnly ? 'Não dispara se outra janela estiver na frente.' : 'Dispara em qualquer janela.'}</span></div>
          </div>
          {flickHasDx && (
            <div className="col">
              <span className="field-label">Botão que alterna o lado do flick</span>
              <div className="row">
                <KeyCapture value={m.sideKey} onChange={(c) => patch({ sideKey: c })} label="Botão que alterna o lado" placeholder="Definir" />
                {m.sideKey && <Button size="sm" variant="ghost" icon={<X />} onClick={() => patch({ sideKey: null })} aria-label="Remover botão de alternar lado" />}
              </div>
              {m.sideKey && m.sideKey === m.trigger
                ? <span role="alert" style={{ fontSize: 12, color: 'var(--danger, #e5484d)' }}>Use um botão diferente do botão da ação.</span>
                : <span className="faint" style={{ fontSize: 12 }}>{m.sideKey ? `Cada toque troca o flick entre esquerda e direita.${live?.sides[m.id] ? ` Agora: ${live.sides[m.id]}.` : ' Começa no lado configurado nas etapas.'}` : 'Opcional: um botão para trocar o flick entre esquerda e direita.'}</span>}
              {m.sideKey && (
                <div className="row" style={{ marginTop: 6 }}>
                  <Switch checked={m.sideSound} onChange={(v) => patch({ sideSound: v })} label="Bipe ao trocar o lado" />
                  <span className="faint" style={{ fontSize: 12.5 }}>{m.sideSound ? 'Bipe agudo = direita, grave = esquerda.' : 'Sem som ao trocar.'}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section id="etapas" title={`Etapas (${m.steps.length})`} actions={<span className="faint" style={{ fontSize: 12.5 }}>{m.steps.filter((s) => s.off).length ? `${m.steps.filter((s) => s.off).length} desativada(s) · ` : ''}~{macroMs(m)} ms por execução</span>}>
        <div className="col" style={{ gap: 10 }}>
          {m.steps.length === 0 && <p className="muted" style={{ margin: 0 }}>Nenhuma etapa ainda. Escolha o tipo abaixo e clique em “Adicionar etapa”.</p>}
          {m.steps.map((s, i) => (
            <div
              key={i}
              className={`step-card ${dragFrom === i ? 'dragging' : ''} ${s.off ? 'off' : ''}`}
              draggable
              onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { if (dragFrom !== null) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }}
              onDragEnd={() => setDragFrom(null)}
              aria-label={`Etapa ${i + 1}`}
            >
              <div className="step-head">
                <span className="drag-handle" title="Arraste para reordenar"><GripVertical size={16} /></span>
                <span className="step-num">{i + 1}</span>
                <strong>{STEP_LABEL[s.t]}</strong>
                <span className="faint truncate" style={{ fontSize: 12 }}>{describeStep(s)}</span>
                <div style={{ flex: 1 }} />
                <Button size="sm" variant="ghost" icon={s.off ? <EyeOff /> : <Eye />} onClick={() => setStep(i, s.off ? (({ off: _o, ...rest }) => rest as MacroStep)(s) : { ...s, off: true })} aria-label={`${s.off ? 'Reativar' : 'Desativar'} etapa ${i + 1}`} title={s.off ? 'Etapa desativada (não roda) — clique para reativar' : 'Desativar esta etapa (não roda, mas fica salva)'} />
                <Button size="sm" variant="ghost" icon={<ArrowUp />} disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Subir etapa ${i + 1}`} title="Subir" />
                <Button size="sm" variant="ghost" icon={<ArrowDown />} disabled={i === m.steps.length - 1} onClick={() => move(i, i + 1)} aria-label={`Descer etapa ${i + 1}`} title="Descer" />
                <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => setM((c) => ({ ...c, steps: [...c.steps.slice(0, i + 1), structuredClone(s), ...c.steps.slice(i + 1)] }))} aria-label={`Duplicar etapa ${i + 1}`} title="Duplicar" />
                <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setM((c) => ({ ...c, steps: c.steps.filter((_, k) => k !== i) }))} aria-label={`Remover etapa ${i + 1}`} title="Remover" />
              </div>
              <StepFields step={s} index={i} onChange={(ns) => setStep(i, ns)} />
            </div>
          ))}
          <div className="row wrap" style={{ marginTop: 4 }}>
            <select className="select" style={{ width: 'auto', minWidth: 220 }} value={addType} onChange={(e) => setAddType(e.target.value as StepType)} aria-label="Tipo da nova etapa">
              {STEP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <Button icon={<Plus />} onClick={() => setM((c) => ({ ...c, steps: [...c.steps, defaultStep(addType)] }))}>Adicionar etapa</Button>
          </div>
        </div>
      </Section>

      <Section
        id="tempo"
        title="Temporização"
        actions={(
          <div className="row wrap" style={{ gap: 6 }}>
            <select className="select" style={{ width: 'auto' }} value="" onChange={(e) => { if (e.target.value) askPreset(e.target.value); }} aria-label="Aplicar preset de tempo">
              <option value="">Aplicar preset…</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Button size="sm" variant="ghost" icon={<Timer />} onClick={() => setSavePreset(true)}>Guardar como preset</Button>
          </div>
        )}
      >
        <TimingInputs value={timingOf(m)} onChange={(v: TimingValues) => setM((cur) => applyTiming(cur, v))} />
        <p className="faint" style={{ margin: '10px 0 0', fontSize: 12 }}>
          0 ms = sem espera nenhuma: o Helper envia a próxima entrada na hora. Esperas acima de ~2 ms usam o relógio do sistema com espera ativa no último 1,5 ms (precisão abaixo de 1 ms).
        </p>
      </Section>

      <Section id="repeticoes" title="Repetições">
        <div className="form-grid">
          <div className="col" style={{ gridColumn: '1 / -1' }}>
            <span className="field-label">Modo</span>
            <div className="seg" role="group" aria-label="Modo">
              {MODES.map(([v, l]) => <button key={v} type="button" aria-pressed={m.mode === v} onClick={() => patch({ mode: v as MacroMode })}>{l}</button>)}
            </div>
            <span className="faint" style={{ fontSize: 12 }}>
              {m.mode === 'once' ? 'Roda as repetições e para.' : m.mode === 'loop' ? 'Aperta: começa a repetir. Aperta de novo: para (toggle).' : m.mode === 'mirror' ? 'Apertou o botão: roda as etapas e segura as teclas. Soltou o botão: solta tudo junto. Lateral/meio podem ficar bloqueados (não voltam a página).' : 'Repete enquanto o botão estiver pressionado.'}
            </span>
          </div>
          {m.mode === 'once' && <NumField label="Repetições" value={m.repeat} min={1} max={1000000} onChange={(v) => patch({ repeat: Math.max(1, Math.round(v)) })} />}
          {m.mode !== 'mirror' && (m.mode !== 'once' || m.repeat > 1) && <NumField label="Intervalo entre repetições" suffix="ms" value={m.loopDelay} onChange={(v) => patch({ loopDelay: v })} />}
        </div>
      </Section>

      <Section id="comportamento" title="Comportamento">
        <div className="form-grid">
          <label className="col">
            <span className="field-label">Grupo exclusivo</span>
            <input className="input" value={m.group} maxLength={40} onChange={(e) => patch({ group: e.target.value })} aria-label="Grupo exclusivo" placeholder="vazio = roda em paralelo" list="macro-groups" />
            <span className="faint" style={{ fontSize: 12 }}>Ações do mesmo grupo nunca rodam juntas (ex.: “movimento”).</span>
          </label>
          {m.group.trim() && <NumField label="Prioridade no grupo" min={-100} max={100} value={m.priority} onChange={(v) => patch({ priority: Math.round(v) })} hint="Maior interrompe menor; menor fica bloqueada." />}
          {m.group.trim() && (
            <label className="col">
              <span className="field-label">Empate de prioridade</span>
              <select className="select" value={m.groupPolicy} onChange={(e) => patch({ groupPolicy: e.target.value as GroupPolicy })} aria-label="Empate de prioridade">
                {GROUP_POLICIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <span className="faint" style={{ fontSize: 12 }}>“Esperar na fila” = execução sequencial.</span>
            </label>
          )}
          {m.mode === 'mirror' && (
            <div className="col">
              <span className="field-label">Bloquear o botão</span>
              <div className="row"><Switch checked={m.blockTrigger} onChange={(v) => patch({ blockTrigger: v })} label="Bloquear o botão que ativa" /><span className="faint" style={{ fontSize: 12.5 }}>{m.blockTrigger ? 'O lateral/meio não chega ao jogo nem ao navegador (como o script).' : 'O clique do botão também chega ao jogo.'}</span></div>
            </div>
          )}
        </div>
        <datalist id="macro-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      </Section>

      <Section id="avancado" title="Avançado">
        <div className="col" style={{ gap: 12 }}>
          {m.mode === 'mirror' && <DirectPanel m={m} info={directInfo} helperOn={!!helper} hookReady={!!live?.hookReady} helperWhy={live?.directWhy[m.id]} />}
          <div className="row wrap" style={{ gap: 10 }}>
            <Button icon={<RotateCcw />} onClick={() => setConfirmReset(true)}>{m.templateId ? 'Restaurar o modelo original' : 'Restaurar temporização padrão'}</Button>
            <span className="faint" style={{ fontSize: 12.5 }}>
              {m.templateId ? `Modelo de origem: ${TEMPLATES.find((t) => t.id === m.templateId)?.pack.name}. Volta tudo ao modelo (mantém a categoria).` : 'Volta delays, trava, repetição e comportamento aos padrões; etapas e botões ficam.'}
            </span>
          </div>
          <span className="faint mono" style={{ fontSize: 11 }}>id: {m.id}</span>
        </div>
      </Section>

      {confirmLeave && (
        <Confirm title="Descartar alterações?" danger confirmLabel="Descartar" onConfirm={onClose} onClose={() => setConfirmLeave(false)}>
          <p style={{ margin: 0 }}>As alterações nesta ação não foram salvas.</p>
        </Confirm>
      )}
      {presetAsk && (
        <Confirm title="Aplicar preset?" confirmLabel="Aplicar" onConfirm={() => { const p = presets.find((x) => x.id === presetAsk.id); if (p) setM((cur) => applyTiming(cur, p.values)); }} onClose={() => setPresetAsk(null)}>
          <p style={{ margin: 0 }}>O preset muda nesta ação: <strong>{presetAsk.diff.map((k) => TIMING_LABEL[k] ?? k).join(', ')}</strong>. Nada é salvo até clicar em Salvar.</p>
        </Confirm>
      )}
      {savePreset && <SavePresetDialog m={m} onClose={() => setSavePreset(false)} />}
      {confirmReset && (
        <Confirm title="Restaurar padrão?" confirmLabel="Restaurar" onConfirm={() => setM(restoreDefaults(m))} onClose={() => setConfirmReset(false)}>
          <p style={{ margin: 0 }}>{m.templateId ? 'A ação volta a ser igual ao modelo original (etapas, botão, tempos).' : 'Delays, trava, repetição e comportamento voltam aos padrões.'} Nada é salvo até clicar em Salvar.</p>
        </Confirm>
      )}
    </div>
  );
}

const TIMING_LABEL: Record<string, string> = { startDelay: 'delay inicial', stepGap: 'delay entre etapas', loopDelay: 'delay entre repetições', endDelay: 'delay final', speed: 'velocidade', debounce: 'trava anti-repetição', onRetrigger: 'apertar de novo' };

function Section({ id, title, actions, children }: { id: string; title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return <div id={`sec-${id}`} className="editor-section"><Card title={title} actions={actions}>{children}</Card></div>;
}

function SavePresetDialog({ m, onClose }: { m: Macro; onClose: () => void }) {
  const [name, setName] = useState(`Tempo de ${m.name}`.slice(0, 40));
  return (
    <Modal title="Salvar como preset de tempo" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!name.trim()} onClick={() => { store.presetFromMacro(name, m); onClose(); }}>Salvar preset</Button></>}>
      <label className="col">
        <span className="field-label">Nome do preset</span>
        <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} aria-label="Nome do novo preset" />
      </label>
      <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>Guarda os delays, a velocidade, a trava e o “apertar de novo” desta ação. Não muda nenhuma outra ação.</p>
    </Modal>
  );
}

const SLOT_NAME: Record<number, string> = { 1: 'lateral ◄', 2: 'lateral ►', 3: 'botão do meio' };

/** Gagatech / "segurar junto": mostra se roda direto no hook (latência zero) e os contadores reais. */
function DirectPanel({ m, info, helperOn, hookReady, helperWhy }: { m: Macro; info: { slot: number; presses: number; fails: number; held: boolean; last: number } | null; helperOn: boolean; hookReady: boolean; helperWhy: string | null | undefined }) {
  const why = directBlocker(m) ?? (!m.enabled ? 'está desativada (ative na lista)' : !helperOn ? 'o Helper está desconectado' : !hookReady ? 'o hook do Windows não está ativo no Helper' : helperWhy ?? null);
  return (
    <div className={`direct-panel ${why ? '' : 'on'}`}>
      <div className="row" style={{ gap: 8 }}>
        <Zap size={16} />
        <strong>Execução direta no hook (estilo Gagatech)</strong>
        <span className={`tag ${why ? 'amber' : 'green'}`}>{why ? 'não' : 'ativa'}</span>
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
        {why
          ? `Esta ação roda pelo executor normal porque ${why}. Para latência zero: modo “Segurar junto”, gatilho lateral ou meio, sem “só no Roblox”, sem combinação e uma única etapa “Apertar teclas juntas” (até 4 teclas) sem espera.`
          : `O próprio hook do Windows aperta as teclas no instante do apertar e solta as mesmas no soltar (um envio só, igual ao Gagatech.py). Outras ações no mesmo botão são ignoradas.`}
      </p>
      {info && (
        <div className="stat-tiles small">
          <div className="stat"><strong>{SLOT_NAME[info.slot] ?? '—'}</strong><span>botão</span></div>
          <div className={`stat ${info.held ? 'live' : ''}`}><strong>{info.held ? 'segurando' : 'solto'}</strong><span>agora</span></div>
          <div className="stat"><strong>{info.presses}</strong><span>acionamentos</span></div>
          <div className={`stat ${info.fails ? 'bad' : ''}`}><strong>{info.fails}</strong><span>falhas do Windows</span></div>
          <div className="stat"><strong>{info.last ? new Date(info.last).toLocaleTimeString('pt-BR') : '—'}</strong><span>último uso</span></div>
        </div>
      )}
      {info && info.fails > 0 && <Notice tone="warn">O Windows recusou teclas. Se o Roblox roda como administrador, rode o help.bat como administrador também.</Notice>}
    </div>
  );
}

function BtnSelect({ value, onChange, allowNone }: { value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <label className="col num-field">
      <span className="field-label">Botão do mouse</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Botão do mouse">
        {allowNone && <option value="none">Nenhum (só movimento)</option>}
        {MOUSE_BUTTONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Fields({ children }: { children: ReactNode }) {
  return <div className="step-fields">{children}</div>;
}

function StepFields({ step, index, onChange }: { step: MacroStep; index: number; onChange: (s: MacroStep) => void }) {
  const n = (k: string) => Number(step[k] ?? 0);
  const set = (k: string, v: unknown) => onChange({ ...step, [k]: v });
  const opt = (k: 'delay' | 'after', v: number) => onChange(v > 0 ? { ...step, [k]: v } : (() => { const c = { ...step }; delete c[k]; return c; })());
  const delays = (
    <>
      {step.t !== 'wait' && <NumField label="Esperar antes" ariaLabel={`Esperar antes da etapa ${index + 1}`} suffix="ms" value={n('delay')} onChange={(v) => opt('delay', v)} />}
      <NumField label="Esperar depois" ariaLabel={`Esperar depois da etapa ${index + 1}`} suffix="ms" value={n('after')} onChange={(v) => opt('after', v)} />
    </>
  );
  switch (step.t) {
    case 'key':
      return (
        <Fields>
          <div className="col"><span className="field-label">Tecla</span><KeyCapture keyboardOnly value={String(step.code ?? '')} onChange={(c) => set('code', c)} label="Tecla da etapa" placeholder="Definir tecla" /></div>
          <NumField label="Vezes" min={1} value={n('n') || 1} onChange={(v) => set('n', Math.max(1, Math.round(v)))} />
          <NumField label="Segurar" suffix="ms" value={n('hold')} onChange={(v) => set('hold', v)} />
          {n('n') > 1 && <NumField label="Intervalo" suffix="ms" value={n('gap')} onChange={(v) => set('gap', v)} />}
          {delays}
        </Fields>
      );
    case 'keysdown': {
      const codes = Array.isArray(step.codes) ? (step.codes as string[]) : [];
      const setCodes = (c: string[]) => set('codes', c);
      return (
        <Fields>
          <div className="col" style={{ gridColumn: '1 / -1' }}>
            <span className="field-label">Teclas (apertadas ao mesmo tempo, na ordem)</span>
            <div className="row wrap">
              {codes.map((c, i) => (
                <span key={i} className="row" style={{ gap: 4 }}>
                  <KeyCapture keyboardOnly value={c} onChange={(v) => setCodes(codes.map((x, j) => (j === i ? (v ?? x) : x)))} label={`Tecla ${i + 1} das teclas juntas`} placeholder="Definir tecla" />
                  {codes.length > 1 && <Button size="sm" variant="ghost" icon={<X />} onClick={() => setCodes(codes.filter((_, j) => j !== i))} aria-label={`Remover tecla ${i + 1}`} />}
                </span>
              ))}
              {codes.length < 10 && <Button size="sm" onClick={() => setCodes([...codes, 'KeyE'])}>+ Tecla</Button>}
            </div>
            <span className="faint" style={{ fontSize: 12 }}>{n('gap') ? `Descem uma a uma com ${n('gap')} ms entre elas e sobem na mesma ordem com o mesmo intervalo.` : 'Intervalo 0: descem juntas num único envio e sobem juntas.'} Ficam seguradas até o fim da ação (no modo “Segurar junto”, até soltar o botão).</span>
          </div>
          <NumField label="Intervalo entre as teclas" ariaLabel={`Intervalo entre as teclas da etapa ${index + 1}`} suffix="ms" value={n('gap')} onChange={(v) => onChange(v > 0 ? { ...step, gap: v } : (({ gap: _g, ...rest }) => rest as MacroStep)(step))} hint="0 = todas ao mesmo tempo (execução direta no hook)." />
          {delays}
        </Fields>
      );
    }
    case 'keydown': case 'keyup':
      return (
        <Fields>
          <div className="col"><span className="field-label">Tecla</span><KeyCapture keyboardOnly value={String(step.code ?? '')} onChange={(c) => set('code', c)} label="Tecla da etapa" placeholder="Definir tecla" /></div>
          {delays}
        </Fields>
      );
    case 'click':
      return (
        <Fields>
          <BtnSelect value={String(step.btn ?? 'left')} onChange={(v) => set('btn', v)} />
          <NumField label="Vezes" min={1} value={n('n') || 1} onChange={(v) => set('n', Math.max(1, Math.round(v)))} />
          <NumField label="Segurar" suffix="ms" value={n('hold')} onChange={(v) => set('hold', v)} />
          {n('n') > 1 && <NumField label="Intervalo" suffix="ms" value={n('gap')} onChange={(v) => set('gap', v)} />}
          {delays}
        </Fields>
      );
    case 'down': case 'up':
      return <Fields><BtnSelect value={String(step.btn ?? 'left')} onChange={(v) => set('btn', v)} />{delays}</Fields>;
    case 'scroll':
      return (
        <Fields>
          <IntField label="Cliques" value={n('amount')} onChange={(v) => set('amount', v || 1)} hint="+ para cima, − para baixo" />
          {Math.abs(n('amount')) > 1 && <NumField label="Intervalo" suffix="ms" value={n('gap')} onChange={(v) => set('gap', v)} />}
          {delays}
        </Fields>
      );
    case 'move':
      return (
        <Fields>
          <IntField label={step.rel ? 'ΔX' : 'X'} value={n('x')} onChange={(v) => set('x', v)} />
          <IntField label={step.rel ? 'ΔY' : 'Y'} value={n('y')} onChange={(v) => set('y', v)} />
          <NumField label="Duração" suffix="ms" value={n('dur')} onChange={(v) => set('dur', v)} hint="0 = instantâneo" />
          <div className="col">
            <span className="field-label">Relativo (câmera)</span>
            <Switch checked={!!step.rel} onChange={(v) => onChange(v ? { ...step, rel: true } : (({ rel: _r, ...rest }) => rest as MacroStep)(step))} label="Movimento relativo" />
          </div>
          {!step.rel && (
            <div className="col">
              <span className="field-label">Posição</span>
              <Button size="sm" icon={<Crosshair />} onClick={async () => { store.toast('info', 'Posicione o mouse: a posição é lida em 3 s.'); const p = await store.pickCursor(3000); if (p) onChange({ ...step, x: p.x, y: p.y }); }}>Pegar do cursor (3 s)</Button>
            </div>
          )}
          {delays}
        </Fields>
      );
    case 'flick':
      return (
        <Fields>
          <BtnSelect allowNone value={String(step.btn ?? 'left')} onChange={(v) => set('btn', v)} />
          <NumField label="Espera inicial" suffix="ms" value={n('pre')} onChange={(v) => set('pre', v)} />
          {step.btn !== 'none' && <NumField label="Segurar botão" suffix="ms" value={n('hold')} onChange={(v) => set('hold', v)} />}
          {step.btn !== 'none' && <NumField label="Espera após soltar" suffix="ms" value={n('afterUp')} onChange={(v) => set('afterUp', v)} />}
          <IntField label="X (relativo)" value={n('dx')} onChange={(v) => set('dx', v)} hint="+ direita, − esquerda" />
          <IntField label="Y (relativo)" value={n('dy')} onChange={(v) => set('dy', v)} hint="+ baixo, − cima" />
          <NumField label="Duração do movimento" suffix="ms" value={n('moveDur')} onChange={(v) => set('moveDur', v)} hint="0 = um único envio" />
          <NumField label="Espera após mover" suffix="ms" value={n('afterMove')} onChange={(v) => set('afterMove', v)} />
          <NumField label="Cooldown" suffix="ms" value={n('cooldown')} onChange={(v) => set('cooldown', v)} />
          <NumField label="Esperar depois" ariaLabel={`Esperar depois da etapa ${index + 1}`} suffix="ms" value={n('after')} onChange={(v) => opt('after', v)} />
        </Fields>
      );
    case 'text':
      return (
        <Fields>
          <label className="col" style={{ gridColumn: '1 / -1' }}>
            <span className="field-label">Texto</span>
            <input className="input" value={String(step.text ?? '')} maxLength={5000} onChange={(e) => set('text', e.target.value)} aria-label="Texto a digitar" />
          </label>
          <NumField label="Intervalo entre letras" suffix="ms" value={n('gap')} onChange={(v) => set('gap', v)} />
          {delays}
        </Fields>
      );
    case 'wait':
      return <Fields><NumField label="Esperar" suffix="ms" value={n('ms')} onChange={(v) => set('ms', v)} /></Fields>;
    case 'path': {
      const pts = (step.pts as number[]) ?? [];
      const total = pts.reduce((a, v, k) => (k % 3 === 0 ? a + (Number(v) || 0) : a), 0);
      const toLine = () => {
        if (pts.length < 3) return;
        let x = 0, y = 0;
        if (step.rel) for (let k = 0; k + 2 < pts.length; k += 3) { x += Number(pts[k + 1]) || 0; y += Number(pts[k + 2]) || 0; }
        else { x = Number(pts[pts.length - 2]) || 0; y = Number(pts[pts.length - 1]) || 0; }
        onChange({ t: 'move', x, y, dur: Math.round(total), ...(step.rel ? { rel: true } : {}), ...(step.delay ? { delay: step.delay } : {}) });
      };
      return (
        <Fields>
          <p className="muted" style={{ margin: 0, gridColumn: '1 / -1', fontSize: 13 }}>
            Trajetória gravada com {Math.floor(pts.length / 3)} pontos em {Math.round(total)} ms{step.rel ? ' (relativa, para câmera)' : ' (posições na tela)'}.
          </p>
          <div className="col"><span className="field-label">Simplificar</span><Button size="sm" onClick={toLine}>Converter em movimento reto</Button></div>
          {delays}
        </Fields>
      );
    }
    default:
      return null;
  }
}
