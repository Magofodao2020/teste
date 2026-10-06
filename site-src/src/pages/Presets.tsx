import {
  CircleAlert, CircleCheck, Copy, Download, Eraser, FileJson, Keyboard, Layers, Pause, Pencil, Play, Plus,
  Search, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { triggerLabel } from '../core/macros';
import { type FlagType, type FlagValue, coerceValue, flagType } from '../core/flags';
import { flagExists } from '../core/offsets/dataset';
import { type Preset, exportPreset, parseImport, scanInvalidFlags } from '../core/presets';
import { compatStatus } from '../state/status';
import { type BuiltinGroup, hasFlag, store, useApp } from '../state/store';
import {
  Button, Card, Confirm, Empty, KeyBadge, KeyCapture, Modal, Notice, formatNumber,
} from '../ui/components';
import { InvalidFlagsDialog } from './InvalidFlagsDialog';

type Dialog =
  | { kind: 'new' } | { kind: 'rename'; preset: Preset } | { kind: 'delete'; preset: Preset }
  | { kind: 'import' } | { kind: 'export'; preset: Preset } | { kind: 'hotkey'; flag: string }
  | { kind: 'invalid' } | null;

export function PresetsPage() {
  const presets = useApp((s) => s.presets);
  const activeId = useApp((s) => s.activePresetId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const active = presets.find((p) => p.id === activeId) ?? null;
  const close = () => setDialog(null);

  return (
    <div className="page">
      <div className="split">
        <PresetSidebar onDialog={setDialog} />
        {active ? <PresetEditor preset={active} onDialog={setDialog} /> : (
          <Card><Empty icon={<Layers />} title="Nenhum preset">Crie um preset ou importe um JSON para começar.</Empty></Card>
        )}
      </div>
      {dialog?.kind === 'new' && <NameDialog title="Novo preset" initial="Novo preset" confirm="Criar" onSubmit={(n) => store.addPreset(n)} onClose={close} />}
      {dialog?.kind === 'rename' && <NameDialog title="Renomear preset" initial={dialog.preset.name} confirm="Salvar" onSubmit={(n) => store.renamePreset(dialog.preset.id, n)} onClose={close} />}
      {dialog?.kind === 'delete' && (
        <Confirm title="Excluir preset" danger confirmLabel="Excluir" onConfirm={() => void store.deletePreset(dialog.preset.id)} onClose={close}>
          <p style={{ margin: 0 }}>Excluir <strong>{dialog.preset.name}</strong> e suas {Object.keys(dialog.preset.flags).length} flags? Não dá para desfazer.</p>
        </Confirm>
      )}
      {dialog?.kind === 'import' && <ImportDialog onClose={close} />}
      {dialog?.kind === 'export' && <ExportDialog preset={dialog.preset} onClose={close} />}
      {dialog?.kind === 'hotkey' && active && <HotkeyDialog flag={dialog.flag} preset={active} onClose={close} />}
      {dialog?.kind === 'invalid' && <InvalidFlagsDialog onClose={close} />}
    </div>
  );
}

function PresetSidebar({ onDialog }: { onDialog: (d: Dialog) => void }) {
  const presets = useApp((s) => s.presets);
  const activeId = useApp((s) => s.activePresetId);
  const [builtin, setBuiltin] = useState<BuiltinGroup[] | null>(null);
  const [showBuiltin, setShowBuiltin] = useState(false);
  useEffect(() => {
    if (showBuiltin && !builtin) void store.builtinPresets().then(setBuiltin);
  }, [showBuiltin, builtin]);

  return (
    <Card
      title="Presets"
      actions={<Button size="sm" variant="primary" icon={<Plus />} onClick={() => onDialog({ kind: 'new' })}>Novo</Button>}
    >
      <div className="preset-list">
        {presets.map((p) => (
          <button key={p.id} type="button" className={`preset-item ${p.id === activeId ? 'active' : ''}`} onClick={() => store.setActivePreset(p.id)} aria-current={p.id === activeId}>
            <span className="swatch" style={{ background: p.color }} />
            <span className="truncate" style={{ fontWeight: 600 }}>{p.name}</span>
            <span className="faint" style={{ marginLeft: 'auto', fontSize: 12 }}>{Object.keys(p.flags).length}</span>
          </button>
        ))}
      </div>
      <div className="divider" style={{ margin: '14px 0' }} />
      <div className="col" style={{ gap: 8 }}>
        <Button icon={<Upload />} onClick={() => onDialog({ kind: 'import' })}>Importar JSON</Button>
        <Button variant="ghost" icon={<Sparkles />} onClick={() => setShowBuiltin((v) => !v)} aria-expanded={showBuiltin}>
          {showBuiltin ? 'Ocultar presets prontos' : 'Presets prontos'}
        </Button>
      </div>
      {showBuiltin && (
        <div className="col" style={{ gap: 12, marginTop: 12 }}>
          {!builtin && <div className="row faint"><span className="spinner" /> Carregando…</div>}
          {builtin?.length === 0 && <p className="faint" style={{ margin: 0 }}>Não foi possível carregar os presets prontos.</p>}
          {builtin?.map((g) => (
            <div key={g.person} className="col" style={{ gap: 4 }}>
              <div className="eyebrow">{g.person}</div>
              {g.presets.map((bp) => (
                <div key={bp.name} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="truncate">{bp.name} <span className="faint" style={{ fontSize: 12 }}>· {Object.keys(bp.flags).length}</span></span>
                  <Button size="sm" variant="ghost" icon={<Plus />} title="Copiar para um novo preset" onClick={() => { store.addPreset(`${g.person} — ${bp.name}`, bp.flags); store.toast('success', `Preset "${bp.name}" adicionado.`); }}>Usar</Button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PresetEditor({ preset, onDialog }: { preset: Preset; onDialog: (d: Dialog) => void }) {
  const index = useApp((s) => s.index);
  const helper = useApp((s) => s.helper);
  const offsets = useApp((s) => s.offsets);
  const hotkeys = useApp((s) => s.hotkeys);
  const presets = useApp((s) => s.presets);
  const busy = useApp((s) => s.busy);
  const [filter, setFilter] = useState('');
  const names = useMemo(() => Object.keys(preset.flags).sort((a, b) => a.localeCompare(b)), [preset.flags]);
  const invalidHere = useMemo(() => (index ? names.filter((n) => !flagExists(index, n)) : []), [index, names]);
  const invalidAll = useMemo(() => (index ? scanInvalidFlags(presets, hotkeys, index).total : 0), [index, presets, hotkeys]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? names.filter((n) => n.toLowerCase().includes(q)) : names;
  }, [names, filter]);
  const compat = compatStatus(offsets, helper);
  const count = names.length;
  const liveDisabled = !helper || !offsets.dataset;

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 14 }}>
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <span className="swatch" style={{ background: preset.color, width: 14, height: 14 }} />
            <h2 className="truncate" style={{ margin: 0, fontSize: 19 }}>{preset.name}</h2>
            <span className="tag">{formatNumber(count)} flags</span>
          </div>
          <div className="row wrap">
            <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => onDialog({ kind: 'rename', preset })}>Renomear</Button>
            <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => store.duplicatePreset(preset.id)}>Duplicar</Button>
            <Button size="sm" variant="ghost" icon={<Download />} onClick={() => onDialog({ kind: 'export', preset })}>Exportar</Button>
            <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => onDialog({ kind: 'delete', preset })} aria-label="Excluir preset" title="Excluir preset" />
          </div>
        </div>
        <div className="divider" style={{ margin: '16px 0' }} />
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div className="row wrap">
            <Button variant="primary" icon={<Play />} busy={busy.apply} disabled={liveDisabled || !count} onClick={() => void store.applyActive()}>Aplicar no Roblox</Button>
            <Button icon={<Pause />} busy={busy.pause} disabled={liveDisabled} onClick={() => void store.pauseAll()} title="Volta as flags do preset ao valor original/padrão na memória">Pausar</Button>
            <Button icon={<Play />} busy={busy.resume} disabled={liveDisabled || !count} onClick={() => void store.resumeAll()} title="Reaplica todas as flags do preset">Retomar</Button>
          </div>
          <span className={`chip ${compat.tone}`} title={compat.detail}><span className="dot" />{compat.label}</span>
        </div>
        {!helper && <p className="faint" style={{ margin: '10px 0 0', fontSize: 12.5 }}>Abra o Helper (help.bat) para aplicar no Roblox. A edição funciona sem ele.</p>}
        {helper && compat.tone === 'err' && <div style={{ marginTop: 12 }}><Notice tone="err">{compat.detail}</Notice></div>}
      </Card>

      {invalidAll > 0 && (
        <Notice tone="warn" action={<Button size="sm" icon={<Eraser />} onClick={() => onDialog({ kind: 'invalid' })}>Remover flags inválidas</Button>}>
          <strong>{invalidHere.length > 0 ? `${invalidHere.length} ${invalidHere.length === 1 ? 'flag deste preset não existe' : 'flags deste preset não existem'} no dump atual.` : `${invalidAll} flags salvas em outros presets não existem no dump atual.`}</strong>{' '}
          Elas são ignoradas na aplicação.
        </Notice>
      )}
      {!index && offsets.status === 'unavailable' && (
        <Notice tone="err"><strong>Não foi possível carregar os offsets.</strong> Não dá para validar as flags nem aplicar no Roblox.</Notice>
      )}

      <Card title="Flags do preset" icon={<FileJson size={18} />}>
        <div className="col" style={{ gap: 12 }}>
          <AddFlag preset={preset} />
          {count > 8 && (
            <div className="input-icon">
              <Search />
              <input className="input" placeholder={`Filtrar ${count} flags deste preset…`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar flags do preset" />
            </div>
          )}
          {count === 0 ? (
            <Empty icon={<Layers />} title="Preset vazio">Adicione flags pela busca acima, pelo Catálogo ou importe um JSON.</Empty>
          ) : (
            <div className="list" role="list">
              {shown.map((name) => (
                <FlagRow
                  key={name}
                  presetId={preset.id}
                  name={name}
                  value={preset.flags[name]}
                  valid={index ? flagExists(index, name) : null}
                  hotkey={hotkeys[name]?.toggleKey ?? hotkeys[name]?.cycleKey ?? null}
                  onHotkey={() => onDialog({ kind: 'hotkey', flag: name })}
                />
              ))}
              {shown.length === 0 && <div className="list-row faint">Nenhuma flag com “{filter}”.</div>}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function FlagRow({ presetId, name, value, valid, hotkey, onHotkey }: {
  presetId: string; name: string; value: FlagValue; valid: boolean | null; hotkey: string | null; onHotkey: () => void;
}) {
  const type = flagType(name, value);
  return (
    <div className={`list-row ${valid === false ? 'invalid' : ''}`} role="listitem">
      <span title={valid === false ? 'Não existe no dump atual' : valid ? 'Existe no dump atual' : 'Sem dump para validar'} style={{ display: 'flex', flex: 'none' }}>
        {valid === false ? <CircleAlert size={16} color="var(--red)" /> : <CircleCheck size={16} color={valid ? 'var(--green)' : 'var(--text-3)'} />}
      </span>
      <div className="col" style={{ gap: 0, flex: 1, minWidth: 0 }}>
        <span className="mono truncate" title={name}>{name}</span>
        {valid === false && <span style={{ color: '#ff8a8d', fontSize: 11.5 }}>Não existe no dump atual</span>}
      </div>
      <span className="tag nowrap" style={{ flex: 'none' }}>{type}</span>
      <ValueEditor type={type} value={value} onChange={(v) => store.setFlag(presetId, name, v)} label={`Valor de ${name}`} />
      <button type="button" className={`keycap ${hotkey ? '' : 'is-empty'}`} onClick={onHotkey} title="Atalho para ligar/desligar esta flag" aria-label={`Atalho de ${name}`} style={{ flex: 'none' }}>
        <Keyboard />{hotkey ? triggerLabel(hotkey) : 'Atalho'}
      </button>
      <Button size="sm" variant="ghost" icon={<X />} onClick={() => store.removeFlag(presetId, name)} aria-label={`Remover ${name}`} title="Remover do preset" />
    </div>
  );
}

function ValueEditor({ type, value, onChange, label }: { type: FlagType; value: FlagValue; onChange: (v: FlagValue) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  if (type === 'bool') {
    const on = coerceValue('bool', value) === true;
    return (
      <div className="seg flag-value" role="group" aria-label={label} style={{ justifyContent: 'center' }}>
        <button type="button" aria-pressed={on} onClick={() => onChange(true)}>true</button>
        <button type="button" aria-pressed={!on} onClick={() => onChange(false)}>false</button>
      </div>
    );
  }
  const commit = () => {
    const v = coerceValue(type, draft);
    if (String(v) !== String(value)) onChange(v);
    else setDraft(String(value));
  };
  return (
    <div className="flag-value">
      <input
        className="input"
        aria-label={label}
        inputMode={type === 'string' ? 'text' : 'decimal'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(String(value)); }}
      />
    </div>
  );
}

function defaultValueFor(name: string): FlagValue {
  const t = flagType(name, '');
  return t === 'bool' ? true : t === 'int' || t === 'float' ? 0 : '';
}

function AddFlag({ preset }: { preset: Preset }) {
  const index = useApp((s) => s.index);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!index || term.length < 2) return [];
    const out: string[] = [];
    for (const n of index.fullNames) {
      if (n.toLowerCase().includes(term) && !hasFlag(preset.flags, n)) out.push(n);
      if (out.length >= 8) break;
    }
    return out;
  }, [q, index, preset.flags]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const add = (name: string) => {
    store.setFlag(preset.id, name, defaultValueFor(name));
    setQ(''); setOpen(false); setSel(0);
  };
  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div className="input-icon">
        <Plus />
        <input
          className="input"
          placeholder={index ? 'Adicionar flag: digite parte do nome (ex.: TaskScheduler)' : 'Sem offsets carregados para buscar flags'}
          disabled={!index}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setSel(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Enter' && results[sel]) add(results[sel]);
            if (e.key === 'Escape') setOpen(false);
          }}
          aria-label="Adicionar flag ao preset"
          aria-autocomplete="list"
        />
      </div>
      {open && results.length > 0 && (
        <div className="suggest" role="listbox">
          {results.map((n, i) => (
            <button key={n} type="button" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => add(n)}>
              <span className="mono truncate">{n}</span>
              <span className="tag" style={{ marginLeft: 'auto' }}>{flagType(n, '')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NameDialog({ title, initial, confirm, onSubmit, onClose }: { title: string; initial: string; confirm: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const ok = name.trim().length > 0;
  const submit = () => { if (ok) { onSubmit(name.trim()); onClose(); } };
  return (
    <Modal title={title} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ok} onClick={submit}>{confirm}</Button></>}>
      <label className="col">
        <span className="field-label">Nome</span>
        <input className="input" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} onFocus={(e) => e.target.select()} />
      </label>
    </Modal>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const activeId = useApp((s) => s.activePresetId);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try { return { ok: true as const, ...parseImport(text) }; } catch (e) { return { ok: false as const, error: (e as Error).message }; }
  }, [text]);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { store.toast('error', 'Arquivo grande demais (máx. 8 MB).'); return; }
    setText(await f.text());
    if (!name) setName(f.name.replace(/\.json$/i, ''));
  };
  const count = parsed?.ok ? Object.keys(parsed.flags).length : 0;
  return (
    <Modal
      title="Importar JSON"
      wide
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button disabled={!parsed?.ok || !activeId} onClick={() => { if (parsed?.ok && activeId) { store.mergeFlags(activeId, parsed.flags); store.toast('success', `${count} flags mescladas no preset ativo.`); onClose(); } }}>Mesclar no preset ativo</Button>
          <Button variant="primary" disabled={!parsed?.ok} onClick={() => { if (parsed?.ok) { store.addPreset(name || parsed.name || 'Importado', parsed.flags); store.toast('success', `Preset criado com ${count} flags.`); onClose(); } }}>Criar novo preset</Button>
        </>
      )}
    >
      <p className="muted" style={{ margin: 0 }}>Cole um JSON de flags (<span className="mono">{'{"FFlagX": true}'}</span> ou <span className="mono">{'{"name": …, "flags": {…}}'}</span>) ou escolha um arquivo.</p>
      <div className="row wrap">
        <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
          <Upload /> Escolher arquivo
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        <input className="input" style={{ maxWidth: 280, height: 32 }} placeholder="Nome do novo preset" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do novo preset" />
      </div>
      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder='{"DFIntTaskSchedulerTargetFps": 240}' aria-label="JSON" spellCheck={false} />
      {parsed && (parsed.ok
        ? <Notice tone="ok">{count} flags válidas{parsed.ignored ? ` · ${parsed.ignored} entradas ignoradas (nome ou valor inválido)` : ''}.</Notice>
        : <Notice tone="err">{parsed.error}</Notice>)}
    </Modal>
  );
}

function ExportDialog({ preset, onClose }: { preset: Preset; onClose: () => void }) {
  const json = useMemo(() => exportPreset(preset), [preset]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(json); store.toast('success', 'JSON copiado.'); } catch { store.toast('error', 'Não foi possível copiar. Selecione o texto e copie manualmente.'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${preset.name.replace(/[^\w\- ]+/g, '').trim() || 'preset'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Modal title={`Exportar “${preset.name}”`} wide onClose={onClose} footer={<><Button icon={<Copy />} onClick={() => void copy()}>Copiar</Button><Button variant="primary" icon={<Download />} onClick={download}>Baixar .json</Button></>}>
      <textarea className="textarea" readOnly value={json} aria-label="JSON do preset" style={{ minHeight: 300 }} />
    </Modal>
  );
}

function HotkeyDialog({ flag, preset, onClose }: { flag: string; preset: Preset; onClose: () => void }) {
  const current = useApp((s) => s.hotkeys[flag]);
  const [toggleKey, setToggleKey] = useState<string | null>(current?.toggleKey ?? null);
  const [cycleKey, setCycleKey] = useState<string | null>(current?.cycleKey ?? null);
  const [cycleValues, setCycleValues] = useState((current?.cycleValues ?? []).join(', '));
  const values = cycleValues.split(',').map((v) => v.trim()).filter(Boolean);
  const save = () => {
    store.setHotkey(flag, toggleKey || cycleKey ? { toggleKey: toggleKey ?? undefined, cycleKey: cycleKey ?? undefined, cycleValues: cycleKey ? values : undefined } : null);
    onClose();
  };
  return (
    <Modal
      title="Atalho da flag"
      onClose={onClose}
      footer={(
        <>
          {current && <Button variant="danger" onClick={() => { store.setHotkey(flag, null); onClose(); }}>Remover atalho</Button>}
          <div style={{ flex: 1 }} />
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!!cycleKey && values.length < 2} onClick={save}>Salvar</Button>
        </>
      )}
    >
      <p className="mono" style={{ margin: 0, wordBreak: 'break-all' }}>{flag}</p>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Funciona com o Helper aberto, mesmo com o Roblox em foco. Valor no preset: <span className="mono">{String(preset.flags[flag])}</span>.</p>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <div className="col"><span className="field-label">Ligar/desligar</span><span className="faint" style={{ fontSize: 12 }}>Alterna entre o valor do preset e o original.</span></div>
        <div className="row">
          <KeyCapture value={toggleKey} onChange={setToggleKey} label="Atalho de ligar/desligar" placeholder="Definir" />
          {toggleKey && <Button size="sm" variant="ghost" icon={<X />} onClick={() => setToggleKey(null)} aria-label="Limpar atalho de ligar/desligar" />}
        </div>
      </div>
      <div className="divider" />
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <div className="col"><span className="field-label">Alternar valores</span><span className="faint" style={{ fontSize: 12 }}>Cada toque passa para o próximo valor.</span></div>
        <div className="row">
          <KeyCapture value={cycleKey} onChange={setCycleKey} label="Atalho de alternar valores" placeholder="Definir" />
          {cycleKey && <Button size="sm" variant="ghost" icon={<X />} onClick={() => setCycleKey(null)} aria-label="Limpar atalho de alternar" />}
        </div>
      </div>
      {cycleKey && (
        <label className="col">
          <span className="field-label">Valores (separados por vírgula, mínimo 2)</span>
          <input className="input mono" value={cycleValues} onChange={(e) => setCycleValues(e.target.value)} placeholder="60, 144, 240" />
        </label>
      )}
      {(toggleKey || cycleKey) && <div className="row faint" style={{ fontSize: 12.5 }}>Atual: {toggleKey && <KeyBadge code={toggleKey} />} {cycleKey && <KeyBadge code={cycleKey} />}</div>}
    </Modal>
  );
}
