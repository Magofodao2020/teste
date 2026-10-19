import { Circle, Copy, Download, Pencil, Plus, Square, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  type BatchPatch, DEFAULT_TIMING, GROUP_POLICIES, type GroupPolicy, type ImportedPack, MODES, type MacroMode, RETRIGGERS, type Retrigger,
  TEMPLATES, type TimingPreset, type TimingValues, describeStep, importCollisions, newPresetId, parseMacroImport, sanitizeStep,
  triggerLabel, type MacroStep,
} from '../core/macros';
import { store, useApp } from '../state/store';
import { Button, Modal, Notice, Switch } from '../ui/components';
import { TimingInputs } from '../ui/fields';

// ───────── gravador ─────────

type RecPhase = 'setup' | 'starting' | 'countdown' | 'recording' | 'stopping';

/**
 * Grava teclado/mouse pelo Helper (hook global do Windows). Ao parar, entrega as
 * etapas para revisão no editor — nada é salvo nem ativado automaticamente.
 */
export function RecorderDialog({ onClose, onRecorded }: { onClose: () => void; onRecorded: (steps: MacroStep[]) => void }) {
  const helper = useApp((s) => s.helper);
  const [moves, setMoves] = useState<'path' | 'clicks' | 'none'>('clicks');
  const [coords, setCoords] = useState<'abs' | 'rel'>('abs');
  const [phase, setPhase] = useState<RecPhase>('setup');
  const [events, setEvents] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [stopKey, setStopKey] = useState('F8');
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef<RecPhase>('setup');
  phaseRef.current = phase;
  const doneRef = useRef(false);

  const finish = (steps: unknown[] | null | undefined) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const clean = (steps ?? []).map(sanitizeStep).filter((s): s is MacroStep => !!s);
    if (!clean.length) { setError('Nada foi gravado. Tente de novo.'); setPhase('setup'); doneRef.current = false; return; }
    onRecorded(clean);
  };

  // Acompanha a gravação (inclui parada pela tecla de parada no jogo).
  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'recording') return;
    const t = setInterval(async () => {
      const st = await store.helper.recordStatus();
      if (!st) return;
      setEvents(st.events); setElapsed(st.elapsedMs); setStopKey(st.stopKey);
      if (st.state === 'recording' && phaseRef.current === 'countdown') setPhase('recording');
      if (st.state === 'done') finish(st.steps);
      if (st.state === 'idle' && phaseRef.current === 'recording') { setError('A gravação foi interrompida.'); setPhase('setup'); }
    }, 300);
    return () => clearInterval(t);
  }, [phase]);

  // Fechar o diálogo no meio da gravação cancela/para no Helper.
  useEffect(() => () => {
    if (!doneRef.current && (phaseRef.current === 'countdown' || phaseRef.current === 'recording')) void store.helper.recordStop();
  }, []);

  const start = async () => {
    setError(null);
    setPhase('starting');
    const r = await store.helper.recordStart({ moves, coords, countdown: 3000, sampleMs: 10 });
    if (!r.ok) { setError(r.message); setPhase('setup'); return; }
    if (typeof r.stopKey === 'string') setStopKey(r.stopKey);
    setPhase('countdown');
  };

  const stop = async () => {
    const wasCountdown = phaseRef.current === 'countdown';
    setPhase('stopping');
    const r = await store.helper.recordStop();
    if (wasCountdown || r.cancelled) { setPhase('setup'); return; }
    if (!r.ok) { setError(r.message); setPhase('setup'); return; }
    finish(r.steps as unknown[]);
  };

  const recording = phase === 'countdown' || phase === 'recording' || phase === 'stopping';
  return (
    <Modal
      title="Gravar macro"
      onClose={onClose}
      footer={recording ? (
        <Button variant="danger" icon={<Square />} busy={phase === 'stopping'} onClick={() => void stop()}>{phase === 'countdown' ? 'Cancelar' : 'Parar gravação'}</Button>
      ) : (
        <>
          <Button onClick={onClose}>Fechar</Button>
          <Button variant="primary" icon={<Circle />} busy={phase === 'starting'} disabled={!helper} onClick={() => void start()}>Começar a gravar</Button>
        </>
      )}
    >
      {!helper && <Notice tone="err">O gravador usa o Helper local. Abra o help.bat para gravar.</Notice>}
      {error && <Notice tone="err">{error}</Notice>}
      {recording ? (
        <div className="rec-live" role="status">
          <span className="rec-dot" />
          <div className="col" style={{ gap: 2 }}>
            <strong style={{ fontSize: 17 }}>{phase === 'countdown' ? 'Começa em instantes… vá para o jogo.' : '● Gravando...'}</strong>
            <span className="muted">{events} eventos · {(elapsed / 1000).toFixed(1)} s</span>
            <span className="faint" style={{ fontSize: 12.5 }}>Pare com a tecla <strong>{triggerLabel(stopKey)}</strong> (recomendado: o clique em “Parar gravação” também seria gravado).</span>
          </div>
        </div>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>Grava teclado, botões e cliques do mouse, scroll e os intervalos entre eles, na ordem. No fim você revisa e edita antes de salvar; a macro é salva <strong>desativada</strong>.</p>
          <div className="col">
            <span className="field-label">Movimento do mouse</span>
            <div className="seg" role="group" aria-label="Movimento do mouse">
              <button type="button" aria-pressed={moves === 'clicks'} onClick={() => setMoves('clicks')}>Só onde clicou</button>
              <button type="button" aria-pressed={moves === 'path'} onClick={() => setMoves('path')}>Trajetória completa</button>
              <button type="button" aria-pressed={moves === 'none'} onClick={() => setMoves('none')}>Não gravar</button>
            </div>
          </div>
          {moves === 'path' && (
            <div className="col">
              <span className="field-label">Coordenadas</span>
              <div className="seg" role="group" aria-label="Coordenadas">
                <button type="button" aria-pressed={coords === 'abs'} onClick={() => setCoords('abs')}>Posição na tela</button>
                <button type="button" aria-pressed={coords === 'rel'} onClick={() => setCoords('rel')}>Relativa (câmera)</button>
              </div>
            </div>
          )}
          <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>Começa 3 segundos depois de clicar. Use a mesma resolução/escala de tela ao gravar e ao executar.</p>
        </>
      )}
    </Modal>
  );
}

// ───────── importar ─────────

export function ImportMacrosDialog({ onClose }: { onClose: () => void }) {
  const stateMacros = useApp((s) => s.macros);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<{ ok: true; pack: ImportedPack } | { ok: false; error: string } | null>(null);
  useEffect(() => {
    if (!text.trim()) { setParsed(null); return; }
    let alive = true;
    parseMacroImport(text).then((pack) => alive && setParsed({ ok: true, pack })).catch((e) => alive && setParsed({ ok: false, error: (e as Error).message }));
    return () => { alive = false; };
  }, [text]);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 16 * 1024 * 1024) { store.toast('error', 'Arquivo grande demais.'); return; }
    setText(await f.text());
  };
  const pack = parsed?.ok ? parsed.pack : null;
  const collisions = pack ? importCollisions(stateMacros, pack) : [];
  const run = (mode: 'merge' | 'new') => { if (pack) { store.importPack(pack, mode); onClose(); } };

  return (
    <Modal
      title="Importar ações"
      wide
      onClose={onClose}
      footer={!pack ? <Button onClick={onClose}>Cancelar</Button>
        : collisions.length ? (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button onClick={() => run('new')}>Criar como novas</Button>
            <Button variant="primary" onClick={() => run('merge')}>Adicionar às existentes</Button>
          </>
        ) : (
          <><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={() => run('merge')}>Importar {pack.items.length} (desativadas)</Button></>
        )}
    >
      <p className="muted" style={{ margin: 0 }}>Cole o JSON de uma ação, pacote ou categoria (<span className="mono">bope: macro / macro-pack</span>) ou um código <span className="mono">BOPE-SEQ1:</span> do site antigo.</p>
      <label className="btn btn-sm" style={{ cursor: 'pointer', justifySelf: 'start' }}>
        <Upload /> Escolher arquivo
        <input type="file" accept=".json,.txt,application/json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} aria-label="Dados para importar" spellCheck={false} placeholder='{"bope":"macro-pack","v":2,"categories":[{"name":"Combate"}],"macros":[...]}' />
      {parsed && (parsed.ok
        ? (
          <>
            <Notice tone="ok">
              {pack!.items.length} {pack!.items.length === 1 ? 'ação' : 'ações'}{pack!.items.length ? `: ${pack!.items.map((i) => i.macro.name).join(', ')}` : ''}.
              {pack!.categories.length ? ` Categoria(s): ${pack!.categories.join(', ')}.` : ' Sem categoria.'} Entram desativadas.
              {pack!.timingPresets?.length ? ` ${pack!.timingPresets.length} preset(s) de tempo (nenhum existente é sobrescrito).` : ''}
            </Notice>
            {collisions.length > 0 && (
              <Notice tone="warn">
                Já existe {collisions.length === 1 ? 'a categoria' : 'as categorias'} <strong>{collisions.join(', ')}</strong>.
                “Adicionar às existentes” coloca as ações dentro {collisions.length === 1 ? 'dela' : 'delas'}; “Criar como novas” cria categorias separadas. Nada é apagado.
              </Notice>
            )}
          </>
        )
        : <Notice tone="err">{parsed.error}</Notice>)}
    </Modal>
  );
}

// ───────── exportar ─────────

export function ExportMacrosDialog({ title, json, filename, note, onClose }: { title: string; json: string; filename: string; note?: string; onClose: () => void }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(json); store.toast('success', 'JSON copiado.'); } catch { store.toast('error', 'Não foi possível copiar. Selecione o texto e copie manualmente.'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename.replace(/[^\w\- ]+/g, '').trim() || 'acoes'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Modal title={title} wide onClose={onClose} footer={<><Button icon={<Copy />} onClick={() => void copy()}>Copiar</Button><Button variant="primary" icon={<Download />} onClick={download}>Baixar .json</Button></>}>
      <p className="muted" style={{ margin: 0 }}>
        {note ?? 'A estrutura (categorias e ações) vai junto, então importar reconstrói as pastas.'} O estado ativa/desativada não é exportado: quem importar recebe as ações desativadas.
      </p>
      <textarea className="textarea" readOnly value={json} aria-label="JSON exportado" style={{ minHeight: 280 }} />
    </Modal>
  );
}

// ───────── modelos ─────────

export function TemplatesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Modelos de ação" wide onClose={onClose} footer={<Button onClick={onClose}>Fechar</Button>}>
      <p className="muted" style={{ margin: 0 }}>Ações prontas do BOPE. Ao adicionar, entram na sua lista <strong>desativadas</strong> e podem ser editadas.</p>
      <div className="list">
        {TEMPLATES.map((t) => (
          <div key={t.id} className="list-row">
            <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
              <span><strong>{t.pack.name}</strong> <span className="tag gold" style={{ marginLeft: 6 }}>{t.group}</span></span>
              <span className="faint truncate" style={{ fontSize: 12 }}>{triggerLabel(t.pack.trigger)} · {t.pack.steps.map(describeStep).join(' · ')}</span>
            </div>
            <Button size="sm" icon={<Plus />} onClick={() => store.addTemplate(t.id)}>Adicionar</Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ───────── presets de temporização ─────────

/** Cria, edita e exclui presets de tempo. Aplicar numa ação só acontece quando o usuário pede. */
export function TimingPresetsDialog({ onClose }: { onClose: () => void }) {
  const presets = useApp((s) => s.macros.timingPresets);
  const [editing, setEditing] = useState<TimingPreset | null>(null);
  return (
    <Modal title="Presets de tempo" wide onClose={onClose} footer={<Button onClick={onClose}>Fechar</Button>}>
      <p className="muted" style={{ margin: 0 }}>Conjuntos de delays e comportamento para reaplicar. Aplicar um preset nunca acontece sozinho: escolha no editor da ação ou nas selecionadas.</p>
      {editing ? (
        <div className="col" style={{ gap: 12 }}>
          <label className="col">
            <span className="field-label">Nome do preset</span>
            <input className="input" value={editing.name} maxLength={40} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Nome do preset" />
          </label>
          <TimingInputs value={editing.values} onChange={(values) => setEditing({ ...editing, values })} prefix="Preset: " />
          <div className="row wrap">
            <Button onClick={() => setEditing(null)}>Cancelar</Button>
            <Button variant="primary" disabled={!editing.name.trim()} onClick={() => { store.saveTimingPreset(editing); setEditing(null); }}>Salvar preset</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="list">
            {presets.length === 0 && <div className="list-row faint">Nenhum preset.</div>}
            {presets.map((p) => (
              <div key={p.id} className="list-row">
                <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <strong>{p.name}</strong>
                  <span className="faint truncate" style={{ fontSize: 12 }}>{describeTiming(p.values)}</span>
                </div>
                <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEditing(structuredClone(p))} aria-label={`Editar preset ${p.name}`} />
                <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => store.removeTimingPreset(p.id)} aria-label={`Excluir preset ${p.name}`} />
              </div>
            ))}
          </div>
          <Button icon={<Plus />} onClick={() => setEditing({ id: newPresetId(), name: 'Novo preset', values: { ...DEFAULT_TIMING } })} style={{ justifySelf: 'start' }}>Novo preset</Button>
        </>
      )}
    </Modal>
  );
}

export function describeTiming(v: TimingValues): string {
  const parts = [`início ${v.startDelay} ms`, `entre etapas ${v.stepGap} ms`, `repetições ${v.loopDelay} ms`, `final ${v.endDelay} ms`];
  if (v.speed !== 1) parts.push(`${v.speed}×`);
  parts.push(v.debounce ? `trava ${v.debounce} ms` : 'sem trava');
  parts.push(`apertar de novo: ${RETRIGGERS.find(([k]) => k === v.onRetrigger)?.[1].toLowerCase()}`);
  return parts.join(' · ');
}

// ───────── edição em lote ─────────

type BatchField = keyof BatchPatch;
const BATCH_FIELDS: Array<[BatchField, string]> = [
  ['mode', 'Modo'], ['repeat', 'Repetições'], ['startDelay', 'Delay inicial'], ['stepGap', 'Delay entre etapas'], ['loopDelay', 'Delay entre repetições'],
  ['endDelay', 'Delay final'], ['speed', 'Velocidade'], ['debounce', 'Trava anti-repetição'], ['onRetrigger', 'Apertar de novo'],
  ['robloxOnly', 'Só com o Roblox em foco'], ['group', 'Grupo'], ['priority', 'Prioridade'], ['groupPolicy', 'Empate no grupo'], ['blockTrigger', 'Bloquear o botão (segurar junto)'],
];

/** Muda de uma vez só os campos marcados em todas as ações selecionadas. */
export function BatchEditDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [on, setOn] = useState<Set<BatchField>>(new Set());
  const [v, setV] = useState<Required<BatchPatch>>({
    mode: 'once', repeat: 1, ...DEFAULT_TIMING, robloxOnly: true, group: '', priority: 0, groupPolicy: 'interrupt', blockTrigger: true,
  });
  const mark = (k: BatchField, val: boolean) => setOn((cur) => { const n = new Set(cur); val ? n.add(k) : n.delete(k); return n; });
  const set = <K extends BatchField>(k: K, val: Required<BatchPatch>[K]) => { setV((cur) => ({ ...cur, [k]: val })); mark(k, true); };
  const apply = () => {
    const patch: BatchPatch = {};
    for (const k of on) (patch as Record<string, unknown>)[k] = v[k];
    store.patchMany(ids, patch);
    onClose();
  };
  const input = (k: BatchField) => {
    switch (k) {
      case 'mode': return <select className="select" value={v.mode} onChange={(e) => set('mode', e.target.value as MacroMode)} aria-label="Lote: modo">{MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select>;
      case 'onRetrigger': return <select className="select" value={v.onRetrigger} onChange={(e) => set('onRetrigger', e.target.value as Retrigger)} aria-label="Lote: apertar de novo">{RETRIGGERS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select>;
      case 'groupPolicy': return <select className="select" value={v.groupPolicy} onChange={(e) => set('groupPolicy', e.target.value as GroupPolicy)} aria-label="Lote: empate no grupo">{GROUP_POLICIES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select>;
      case 'robloxOnly': case 'blockTrigger': return <Switch checked={v[k]} onChange={(b) => set(k, b)} label={`Lote: ${BATCH_FIELDS.find(([f]) => f === k)![1]}`} />;
      case 'group': return <input className="input" value={v.group} maxLength={40} onChange={(e) => set('group', e.target.value)} aria-label="Lote: grupo" placeholder="vazio = sem grupo" />;
      default: return <input className="input" type="number" value={v[k] as number} step={k === 'speed' ? 0.1 : 1} onChange={(e) => set(k, Number(e.target.value) || 0)} aria-label={`Lote: ${BATCH_FIELDS.find(([f]) => f === k)![1]}`} />;
    }
  };
  return (
    <Modal
      title={`Editar ${ids.length} ${ids.length === 1 ? 'ação' : 'ações'} em lote`}
      wide
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!on.size} onClick={apply}>Aplicar {on.size ? `(${on.size} ${on.size === 1 ? 'campo' : 'campos'})` : ''}</Button></>}
    >
      <p className="muted" style={{ margin: 0 }}>Marque só o que quer mudar. Os outros campos de cada ação ficam como estão.</p>
      <div className="batch-grid">
        {BATCH_FIELDS.map(([k, label]) => (
          <label key={k} className={`batch-field ${on.has(k) ? 'on' : ''}`}>
            <span className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={on.has(k)} onChange={(e) => mark(k, e.target.checked)} aria-label={`Mudar ${label}`} />
              <span className="field-label">{label}</span>
            </span>
            {input(k)}
          </label>
        ))}
      </div>
    </Modal>
  );
}
