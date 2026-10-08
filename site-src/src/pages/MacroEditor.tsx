import {
  ArrowDown, ArrowLeft, ArrowUp, Copy, Crosshair, GripVertical, Play, Plus, Save, Trash2, X,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import {
  MODES, MOUSE_BUTTONS, type Macro, type MacroMode, type MacroStep, STEP_LABEL, STEP_TYPES, type StepType,
  defaultStep, describeStep, macroMs, macroProblems, moveItem, sanitizeMacro, sanitizeStep,
} from '../core/macros';
import { store, useApp } from '../state/store';
import { Button, Card, Confirm, KeyCapture, Notice, Switch } from '../ui/components';

/**
 * Editor de uma macro (nova, gravada ou existente). Nada é salvo até clicar em
 * Salvar; macros novas são salvas DESATIVADAS.
 */
export function MacroEditor({ initial, isNew, onClose }: { initial: Macro; isNew: boolean; onClose: () => void }) {
  const helper = useApp((s) => s.helper);
  const categories = useApp((s) => s.macros.categories);
  const [m, setM] = useState<Macro>(() => structuredClone(initial));
  const [addType, setAddType] = useState<StepType>('key');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const dirty = useMemo(() => isNew || JSON.stringify(m) !== JSON.stringify(initial), [m, initial, isNew]);
  const problems = macroProblems(m);
  const saveProblems = problems.filter((p) => !p.startsWith('Defina o botão')); // sem botão pode salvar (fica desativada)

  const patch = (p: Partial<Macro>) => setM((cur) => ({ ...cur, ...p }));
  const setStep = (i: number, s: MacroStep) => setM((cur) => ({ ...cur, steps: cur.steps.map((x, k) => (k === i ? s : x)) }));
  const move = (from: number, to: number) => setM((cur) => ({ ...cur, steps: moveItem(cur.steps, from, to) }));

  const save = () => {
    if (saveProblems.length) { setShowErrors(true); return; }
    const clean = sanitizeMacro({ ...m, steps: m.steps.map((s) => sanitizeStep(s)).filter(Boolean) });
    if (!clean) return;
    store.saveMacro(clean);
    onClose();
  };
  const leave = () => (dirty ? setConfirmLeave(true) : onClose());

  return (
    <div className="page">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 10 }}>
          <Button variant="ghost" icon={<ArrowLeft />} onClick={leave}>Voltar</Button>
          <h2 style={{ margin: 0, fontSize: 18 }}>{isNew ? 'Nova ação' : `Editar “${initial.name}”`}</h2>
          {!isNew && <span className={`status-pill ${initial.enabled ? 'on' : 'off'}`}>{initial.enabled ? '● Ativa' : '○ Desativada'}</span>}
        </div>
        <div className="row wrap">
          <Button icon={<Play />} disabled={!helper || !m.steps.length} onClick={() => void store.testMacro(m)} title={helper ? 'Roda uma vez em 3 segundos (sem salvar)' : 'Helper desconectado'}>Testar (3 s)</Button>
          <Button onClick={leave}>Cancelar</Button>
          <Button variant="primary" icon={<Save />} onClick={save}>Salvar</Button>
        </div>
      </div>

      {showErrors && saveProblems.length > 0 && <Notice tone="err">{saveProblems.join(' ')}</Notice>}
      {isNew && <Notice>A ação será salva <strong>desativada</strong>. Ative na lista quando quiser usar.</Notice>}

      <Card title="Configuração">
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
            <span className="faint" style={{ fontSize: 12 }}>Escolha a pasta da ação. Crie novas categorias na aba Ações.</span>
          </label>
          <div className="col">
            <span className="field-label">Botão ou tecla que ativa</span>
            <div className="row">
              <KeyCapture value={m.trigger} onChange={(c) => patch({ trigger: c })} label="Botão que ativa" />
              {m.trigger && <Button size="sm" variant="ghost" icon={<X />} onClick={() => patch({ trigger: null })} aria-label="Remover botão" />}
            </div>
            {!m.trigger && <span className="faint" style={{ fontSize: 12 }}>Sem botão a ação pode ser salva, mas não pode ser ativada.</span>}
          </div>
          <div className="col">
            <span className="field-label">Modo</span>
            <div className="seg" role="group" aria-label="Modo">
              {MODES.map(([v, l]) => <button key={v} type="button" aria-pressed={m.mode === v} onClick={() => patch({ mode: v as MacroMode })}>{l}</button>)}
            </div>
            <span className="faint" style={{ fontSize: 12 }}>
              {m.mode === 'once' ? 'Roda as repetições e para. Apertar de novo durante a execução cancela.' : m.mode === 'loop' ? 'Aperta: começa a repetir. Aperta de novo: para.' : 'Repete enquanto o botão estiver pressionado.'}
            </span>
          </div>
          {m.mode === 'once' && <NumField label="Repetições" value={m.repeat} min={1} onChange={(v) => patch({ repeat: Math.max(1, Math.round(v)) })} />}
          {(m.mode !== 'once' || m.repeat > 1) && <NumField label="Intervalo entre repetições" suffix="ms" value={m.loopDelay} onChange={(v) => patch({ loopDelay: v })} />}
          <NumField label="Velocidade" suffix="×" step={0.1} min={0.05} max={50} value={m.speed} onChange={(v) => patch({ speed: Math.min(50, Math.max(0.05, v || 1)) })} hint="2× = metade do tempo" />
          <div className="col">
            <span className="field-label">Só com o Roblox em foco</span>
            <div className="row"><Switch checked={m.robloxOnly} onChange={(v) => patch({ robloxOnly: v })} label="Só com o Roblox em foco" /><span className="faint" style={{ fontSize: 12.5 }}>{m.robloxOnly ? 'Não dispara se outra janela estiver na frente.' : 'Dispara em qualquer janela.'}</span></div>
          </div>
        </div>
      </Card>

      <Card title={`Etapas (${m.steps.length})`} actions={<span className="faint" style={{ fontSize: 12.5 }}>~{macroMs(m)} ms por execução</span>}>
        <div className="col" style={{ gap: 10 }}>
          {m.steps.length === 0 && <p className="muted" style={{ margin: 0 }}>Nenhuma etapa ainda. Escolha o tipo abaixo e clique em “Adicionar etapa”.</p>}
          {m.steps.map((s, i) => (
            <div
              key={i}
              className={`step-card ${dragFrom === i ? 'dragging' : ''}`}
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
                <Button size="sm" variant="ghost" icon={<ArrowUp />} disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Subir etapa ${i + 1}`} title="Subir" />
                <Button size="sm" variant="ghost" icon={<ArrowDown />} disabled={i === m.steps.length - 1} onClick={() => move(i, i + 1)} aria-label={`Descer etapa ${i + 1}`} title="Descer" />
                <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => setM((c) => ({ ...c, steps: [...c.steps.slice(0, i + 1), structuredClone(s), ...c.steps.slice(i + 1)] }))} aria-label={`Duplicar etapa ${i + 1}`} title="Duplicar" />
                <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setM((c) => ({ ...c, steps: c.steps.filter((_, k) => k !== i) }))} aria-label={`Remover etapa ${i + 1}`} title="Remover" />
              </div>
              <StepFields step={s} onChange={(ns) => setStep(i, ns)} />
            </div>
          ))}
          <div className="row wrap" style={{ marginTop: 4 }}>
            <select className="select" style={{ width: 'auto', minWidth: 220 }} value={addType} onChange={(e) => setAddType(e.target.value as StepType)} aria-label="Tipo da nova etapa">
              {STEP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <Button icon={<Plus />} onClick={() => setM((c) => ({ ...c, steps: [...c.steps, defaultStep(addType)] }))}>Adicionar etapa</Button>
          </div>
        </div>
      </Card>

      {confirmLeave && (
        <Confirm title="Descartar alterações?" danger confirmLabel="Descartar" onConfirm={onClose} onClose={() => setConfirmLeave(false)}>
          <p style={{ margin: 0 }}>As alterações nesta ação não foram salvas.</p>
        </Confirm>
      )}
    </div>
  );
}

function NumField({ label, value, onChange, min = 0, max, step = 1, suffix, hint }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; hint?: string;
}) {
  return (
    <label className="col num-field">
      <span className="field-label">{label}</span>
      <span className="row" style={{ gap: 6 }}>
        <input
          className="input"
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => { const v = Number(e.target.value); onChange(Number.isFinite(v) ? Math.max(min, max != null ? Math.min(max, v) : v) : min); }}
          aria-label={label}
        />
        {suffix && <span className="faint" style={{ fontSize: 12 }}>{suffix}</span>}
      </span>
      {hint && <span className="faint" style={{ fontSize: 11.5 }}>{hint}</span>}
    </label>
  );
}

/** Campo de inteiro com sinal (dx, dy, x, y, scroll). */
function IntField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="col num-field">
      <span className="field-label">{label}</span>
      <input className="input" type="number" step={1} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Math.round(Number(e.target.value) || 0))} aria-label={label} />
      {hint && <span className="faint" style={{ fontSize: 11.5 }}>{hint}</span>}
    </label>
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

function StepFields({ step, onChange }: { step: MacroStep; onChange: (s: MacroStep) => void }) {
  const n = (k: string) => Number(step[k] ?? 0);
  const set = (k: string, v: unknown) => onChange({ ...step, [k]: v });
  const delay = step.t !== 'wait' && <NumField label="Esperar antes" suffix="ms" value={n('delay')} onChange={(v) => onChange(v > 0 ? { ...step, delay: v } : (({ delay: _d, ...rest }) => rest as MacroStep)(step))} />;
  switch (step.t) {
    case 'key':
      return (
        <Fields>
          <div className="col"><span className="field-label">Tecla</span><KeyCapture keyboardOnly value={String(step.code ?? '')} onChange={(c) => set('code', c)} label="Tecla da etapa" placeholder="Definir tecla" /></div>
          <NumField label="Vezes" min={1} value={n('n') || 1} onChange={(v) => set('n', Math.max(1, Math.round(v)))} />
          <NumField label="Segurar" suffix="ms" value={n('hold')} onChange={(v) => set('hold', v)} />
          {n('n') > 1 && <NumField label="Intervalo" suffix="ms" value={n('gap')} onChange={(v) => set('gap', v)} />}
          {delay}
        </Fields>
      );
    case 'keydown': case 'keyup':
      return (
        <Fields>
          <div className="col"><span className="field-label">Tecla</span><KeyCapture keyboardOnly value={String(step.code ?? '')} onChange={(c) => set('code', c)} label="Tecla da etapa" placeholder="Definir tecla" /></div>
          {delay}
        </Fields>
      );
    case 'click':
      return (
        <Fields>
          <BtnSelect value={String(step.btn ?? 'left')} onChange={(v) => set('btn', v)} />
          <NumField label="Vezes" min={1} value={n('n') || 1} onChange={(v) => set('n', Math.max(1, Math.round(v)))} />
          <NumField label="Segurar" suffix="ms" value={n('hold')} onChange={(v) => set('hold', v)} />
          {n('n') > 1 && <NumField label="Intervalo" suffix="ms" value={n('gap')} onChange={(v) => set('gap', v)} />}
          {delay}
        </Fields>
      );
    case 'down': case 'up':
      return <Fields><BtnSelect value={String(step.btn ?? 'left')} onChange={(v) => set('btn', v)} />{delay}</Fields>;
    case 'scroll':
      return (
        <Fields>
          <IntField label="Cliques" value={n('amount')} onChange={(v) => set('amount', v || 1)} hint="+ para cima, − para baixo" />
          {Math.abs(n('amount')) > 1 && <NumField label="Intervalo" suffix="ms" value={n('gap')} onChange={(v) => set('gap', v)} />}
          {delay}
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
          {delay}
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
          {delay}
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
          {delay}
        </Fields>
      );
    }
    default:
      return null;
  }
}
