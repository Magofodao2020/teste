import { Circle, Copy, Download, Plus, Square, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Macro, TEMPLATES, describeStep, exportPack, parseMacroImport, sanitizeStep, triggerLabel, type MacroStep,
} from '../core/macros';
import { store, useApp } from '../state/store';
import { Button, Modal, Notice } from '../ui/components';

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
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<{ ok: true; macros: Macro[] } | { ok: false; error: string } | null>(null);
  useEffect(() => {
    if (!text.trim()) { setParsed(null); return; }
    let alive = true;
    parseMacroImport(text).then((macros) => alive && setParsed({ ok: true, macros })).catch((e) => alive && setParsed({ ok: false, error: (e as Error).message }));
    return () => { alive = false; };
  }, [text]);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 16 * 1024 * 1024) { store.toast('error', 'Arquivo grande demais.'); return; }
    setText(await f.text());
  };
  return (
    <Modal
      title="Importar ações"
      wide
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!parsed?.ok} onClick={() => { if (parsed?.ok) { store.importMacros(parsed.macros); onClose(); } }}>Importar {parsed?.ok ? parsed.macros.length : ''} (desativadas)</Button></>}
    >
      <p className="muted" style={{ margin: 0 }}>Cole o JSON de uma ação ou pacote (<span className="mono">bope: macro / macro-pack</span>) ou um código <span className="mono">BOPE-SEQ1:</span> do site antigo.</p>
      <label className="btn btn-sm" style={{ cursor: 'pointer', justifySelf: 'start' }}>
        <Upload /> Escolher arquivo
        <input type="file" accept=".json,.txt,application/json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} aria-label="Dados para importar" spellCheck={false} placeholder='{"bope":"macro","v":1,"name":"Minha macro","steps":[...]}' />
      {parsed && (parsed.ok
        ? <Notice tone="ok">{parsed.macros.length} {parsed.macros.length === 1 ? 'ação' : 'ações'}: {parsed.macros.map((m) => m.name).join(', ')}.{(() => { const c = [...new Set(parsed.macros.map((m) => m.group).filter(Boolean))]; return c.length ? ` Categoria(s): ${c.join(', ')}.` : ''; })()} Entram desativadas.</Notice>
        : <Notice tone="err">{parsed.error}</Notice>)}
    </Modal>
  );
}

// ───────── exportar ─────────

export function ExportMacrosDialog({ macros, label, onClose }: { macros: Macro[]; label?: string; onClose: () => void }) {
  const json = useMemo(() => exportPack(macros), [macros]);
  const cats = useMemo(() => [...new Set(macros.map((m) => m.group).filter(Boolean))] as string[], [macros]);
  const title = macros.length === 1 ? `Exportar “${macros[0].name}”`
    : label && label !== 'todas' ? `Exportar categoria “${label}” (${macros.length} ${macros.length === 1 ? 'ação' : 'ações'})`
      : `Exportar ${macros.length} ações`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(json); store.toast('success', 'JSON copiado.'); } catch { store.toast('error', 'Não foi possível copiar. Selecione o texto e copie manualmente.'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    const base = macros.length === 1 ? macros[0].name
      : label && label !== 'todas' ? `categoria-${label}`
        : 'acoes-bope';
    a.download = `${base.replace(/[^\w\- ]+/g, '').trim() || 'acoes'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Modal title={title} wide onClose={onClose} footer={<><Button icon={<Copy />} onClick={() => void copy()}>Copiar</Button><Button variant="primary" icon={<Download />} onClick={download}>Baixar .json</Button></>}>
      <p className="muted" style={{ margin: 0 }}>
        A categoria de cada ação vai junto, então importar recria as categorias{cats.length ? ` (${cats.join(', ')})` : ''}. O estado ativa/desativada não é exportado: quem importar recebe as ações desativadas.
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
