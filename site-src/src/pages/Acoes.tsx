import {
  ChevronDown, ChevronRight, Circle, Copy, Crosshair, Download, FolderOpen, LayoutTemplate, Pencil, Play, Plus, Power, PowerOff, Square, Trash2, TriangleAlert, Upload,
} from 'lucide-react';
import { useState } from 'react';
import {
  type Macro, type MacroGroup, type MacroStep, MODES, activeConflicts, canActivate, describeStep, groupMacros, macroMs, newMacroId, triggerLabel,
} from '../core/macros';
import { store, useApp } from '../state/store';
import {
  Button, Card, Confirm, Empty, KeyCapture, Modal, Notice,
} from '../ui/components';
import { MacroEditor } from './MacroEditor';
import { ExportMacrosDialog, ImportMacrosDialog, RecorderDialog, TemplatesDialog } from './MacroDialogs';

type Editing = { macro: Macro; isNew: boolean } | null;
type Dialog =
  | { kind: 'record' } | { kind: 'import' } | { kind: 'templates' }
  | { kind: 'export'; macros: Macro[]; label?: string } | { kind: 'delete'; macro: Macro }
  | { kind: 'rename-cat'; from: string } | null;

function blankMacro(steps: MacroStep[] = [], name = 'Nova ação'): Macro {
  const now = Date.now();
  return { id: newMacroId(), name, enabled: false, trigger: null, mode: 'once', repeat: 1, loopDelay: 0, speed: 1, robloxOnly: true, steps, createdAt: now, updatedAt: now };
}

// Quais categorias estão retraídas (só conveniência visual, por navegador).
const COLLAPSE_KEY = 'bope:acoes:collapsed:v1';
function loadCollapsed(): Set<string> {
  try { const a = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'); return new Set(Array.isArray(a) ? a.map(String) : []); } catch { return new Set(); }
}
function saveCollapsed(set: Set<string>) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set])); } catch { /* bloqueado */ }
}

export function AcoesPage() {
  const state = useApp((s) => s.macros);
  const helper = useApp((s) => s.helper);
  const [editing, setEditing] = useState<Editing>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const close = () => setDialog(null);
  const toggle = (key: string) => setCollapsed((cur) => {
    const next = new Set(cur);
    next.has(key) ? next.delete(key) : next.add(key);
    saveCollapsed(next);
    return next;
  });

  if (editing) return <MacroEditor initial={editing.macro} isNew={editing.isNew} onClose={() => setEditing(null)} />;

  const total = state.macros.length;
  const active = state.macros.filter((m) => m.enabled).length;
  const activatable = state.macros.filter(canActivate).length;
  const allActive = activatable > 0 && state.macros.filter(canActivate).every((m) => m.enabled);
  const groups = groupMacros(state.macros);

  return (
    <div className="page">
      {!helper && (
        <Notice tone="warn"><strong>Helper desconectado.</strong> As ações são executadas pelo Helper local. Abra o help.bat e deixe a janela aberta; a configuração é enviada automaticamente.</Notice>
      )}

      <Card>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 16 }}>
          <div className="col" style={{ gap: 2 }}>
            <div className="eyebrow">Ações</div>
            <div className="row" style={{ gap: 14, alignItems: 'baseline' }}>
              <span aria-live="polite"><strong style={{ fontSize: 20 }}>{active}</strong> <span className="muted">{active === 1 ? 'ativa' : 'ativas'}</span></span>
              <span><strong style={{ fontSize: 20 }}>{total - active}</strong> <span className="muted">{total - active === 1 ? 'desativada' : 'desativadas'}</span></span>
              <span><strong style={{ fontSize: 20 }}>{groups.length}</strong> <span className="muted">{groups.length === 1 ? 'categoria' : 'categorias'}</span></span>
            </div>
          </div>
          <div className="row wrap">
            <Button variant={allActive ? 'default' : 'primary'} icon={<Power />} disabled={!activatable || allActive} onClick={() => store.setAllMacrosEnabled(true)}>Ativar todas</Button>
            <Button icon={<PowerOff />} disabled={active === 0} onClick={() => store.setAllMacrosEnabled(false)}>Desativar todas</Button>
          </div>
        </div>
        <div className="divider" style={{ margin: '16px 0' }} />
        <div className="row wrap">
          <Button variant="primary" icon={<Plus />} onClick={() => setEditing({ macro: blankMacro(), isNew: true })}>Criar ação</Button>
          <Button icon={<Circle />} onClick={() => setDialog({ kind: 'record' })}>Gravar macro</Button>
          <Button variant="ghost" icon={<LayoutTemplate />} onClick={() => setDialog({ kind: 'templates' })}>Modelos</Button>
          <Button variant="ghost" icon={<Upload />} onClick={() => setDialog({ kind: 'import' })}>Importar</Button>
          <Button variant="ghost" icon={<Download />} disabled={!total} onClick={() => setDialog({ kind: 'export', macros: state.macros, label: 'todas' })}>Exportar todas</Button>
        </div>
        <p className="faint" style={{ margin: '10px 0 0', fontSize: 12.5 }}>Defina a categoria de cada ação no editor. Exportar/importar uma categoria leva junto todas as ações dentro dela.</p>
      </Card>

      <section className="col" style={{ gap: 14 }}>
        <div className="eyebrow">Minhas ações</div>
        {total === 0 ? (
          <Card>
            <Empty icon={<Crosshair />} title="Nenhuma ação">Crie uma ação, grave uma macro ou adicione um dos modelos (Bug Indi, Perfect Dive, Gagatech…).</Empty>
          </Card>
        ) : (
          groups.map((g) => (
            <CategorySection
              key={g.key}
              group={g}
              allMacros={state.macros}
              helperOn={!!helper}
              collapsed={collapsed.has(g.key)}
              onToggle={() => toggle(g.key)}
              onExport={() => setDialog({ kind: 'export', macros: g.macros, label: g.name ?? 'Sem categoria' })}
              onRename={(from) => setDialog({ kind: 'rename-cat', from })}
              onEditMacro={(m) => setEditing({ macro: m, isNew: false })}
              onExportMacro={(m) => setDialog({ kind: 'export', macros: [m] })}
              onDeleteMacro={(m) => setDialog({ kind: 'delete', macro: m })}
            />
          ))
        )}
      </section>

      <Card title="Controle" icon={<Square size={18} />}>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 16 }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <span className="field-label">Tecla de parada</span>
            <KeyCapture value={state.stopKey} onChange={(c) => store.setStopKey(c)} allowScroll={false} label="Tecla de parada" />
            <span className="faint" style={{ fontSize: 12.5 }}>Para todas as ações em andamento e encerra a gravação.</span>
          </div>
          <Button icon={<Square />} disabled={!helper} onClick={() => void store.stopActions()}>Parar tudo agora</Button>
        </div>
      </Card>

      {dialog?.kind === 'record' && (
        <RecorderDialog
          onClose={close}
          onRecorded={(steps) => {
            close();
            const t = new Date();
            setEditing({ macro: blankMacro(steps, `Gravação ${t.toLocaleDateString('pt-BR')} ${t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`), isNew: true });
            store.toast('info', `Gravação com ${steps.length} etapas. Revise e salve.`);
          }}
        />
      )}
      {dialog?.kind === 'import' && <ImportMacrosDialog onClose={close} />}
      {dialog?.kind === 'templates' && <TemplatesDialog onClose={close} />}
      {dialog?.kind === 'export' && <ExportMacrosDialog macros={dialog.macros} label={dialog.label} onClose={close} />}
      {dialog?.kind === 'rename-cat' && <RenameCategoryDialog from={dialog.from} onClose={close} />}
      {dialog?.kind === 'delete' && (
        <Confirm title="Excluir ação" danger confirmLabel="Excluir" onConfirm={() => store.deleteMacro(dialog.macro.id)} onClose={close}>
          <p style={{ margin: 0 }}>Excluir <strong>{dialog.macro.name}</strong>? Não dá para desfazer (os modelos podem ser adicionados de novo em “Modelos”).</p>
        </Confirm>
      )}
    </div>
  );
}

function CategorySection({ group, allMacros, helperOn, collapsed, onToggle, onExport, onRename, onEditMacro, onExportMacro, onDeleteMacro }: {
  group: MacroGroup; allMacros: ReturnType<typeof groupMacros>[number]['macros']; helperOn: boolean;
  collapsed: boolean; onToggle: () => void; onExport: () => void; onRename: (from: string) => void;
  onEditMacro: (m: Macro) => void; onExportMacro: (m: Macro) => void; onDeleteMacro: (m: Macro) => void;
}) {
  const { name, macros } = group;
  const active = macros.filter((m) => m.enabled).length;
  const activatable = macros.filter(canActivate).length;
  const allActive = activatable > 0 && macros.filter(canActivate).every((m) => m.enabled);
  const label = name ?? 'Sem categoria';
  const state = { v: 3 as const, macros: allMacros, stopKey: '' };

  return (
    <div className={`cat-group ${active ? 'has-active' : ''}`}>
      <div className="cat-head">
        <button type="button" className="cat-toggle" aria-expanded={!collapsed} onClick={onToggle} aria-label={`${collapsed ? 'Abrir' : 'Retrair'} categoria ${label}`}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
          <FolderOpen size={16} className="faint" />
          <span className="cat-name">{label}</span>
          <span className="tag">{macros.length}</span>
          {active > 0 && <span className="tag green">{active} ativa{active > 1 ? 's' : ''}</span>}
        </button>
        <div className="row wrap" style={{ gap: 6 }}>
          <Button size="sm" variant={allActive ? 'default' : 'primary'} icon={<Power />} disabled={!activatable || allActive} onClick={() => store.setCategoryEnabled(name, true)}>Ativar categoria</Button>
          <Button size="sm" icon={<PowerOff />} disabled={active === 0} onClick={() => store.setCategoryEnabled(name, false)}>Desativar categoria</Button>
          <Button size="sm" variant="ghost" icon={<Download />} onClick={onExport} aria-label={`Exportar categoria ${label}`} title="Exportar categoria (com as ações dentro)" />
          {name && <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => onRename(name)} aria-label={`Renomear categoria ${label}`} title="Renomear categoria" />}
        </div>
      </div>
      {!collapsed && (
        <div className="col cat-body" style={{ gap: 10 }}>
          {macros.map((m) => (
            <MacroRow
              key={m.id}
              m={m}
              conflicts={activeConflicts(state, m)}
              helperOn={helperOn}
              onEdit={() => onEditMacro(m)}
              onExport={() => onExportMacro(m)}
              onDelete={() => onDeleteMacro(m)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RenameCategoryDialog({ from, onClose }: { from: string; onClose: () => void }) {
  const [name, setName] = useState(from);
  return (
    <Modal
      title={`Renomear categoria “${from}”`}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={() => { store.renameCategory(from, name); onClose(); }}>Salvar</Button></>}
    >
      <label className="col">
        <span className="field-label">Nome da categoria</span>
        <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} aria-label="Novo nome da categoria" placeholder="Deixe em branco para remover a categoria" />
      </label>
      <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>Muda a categoria de todas as ações deste grupo. Em branco, elas ficam sem categoria.</p>
    </Modal>
  );
}

function MacroRow({ m, conflicts, helperOn, onEdit, onExport, onDelete }: {
  m: Macro; conflicts: Macro[]; helperOn: boolean; onEdit: () => void; onExport: () => void; onDelete: () => void;
}) {
  const mode = MODES.find(([v]) => v === m.mode)?.[1] ?? m.mode;
  const ready = canActivate(m);
  return (
    <article className={`macro-row ${m.enabled ? 'on' : ''}`} aria-label={m.name}>
      <div className="macro-main">
        <span className={`status-pill ${m.enabled ? 'on' : 'off'}`} aria-label={m.enabled ? 'Ativa' : 'Desativada'}>{m.enabled ? '● Ativa' : '○ Desativada'}</span>
        <div className="col" style={{ gap: 2, minWidth: 0, flex: '1 1 200px' }}>
          <span className="row" style={{ gap: 8, minWidth: 0 }}>
            <strong className="macro-name">{m.name}</strong>
          </span>
          <span className="faint truncate" style={{ fontSize: 12 }} title={m.steps.map(describeStep).join('\n')}>
            {mode}{m.mode === 'once' && m.repeat > 1 ? ` ×${m.repeat}` : ''} · {m.steps.length} {m.steps.length === 1 ? 'etapa' : 'etapas'} · ~{macroMs(m)} ms{m.robloxOnly ? ' · só no Roblox' : ''}
          </span>
        </div>
        <KeyCapture value={m.trigger} onChange={(c) => store.setMacroTrigger(m.id, c)} label={`Botão de ${m.name}`} />
      </div>
      <div className="macro-actions">
        {m.enabled
          ? <Button size="sm" icon={<PowerOff />} onClick={() => store.setMacroEnabled(m.id, false)}>Desativar</Button>
          : <Button size="sm" variant="primary" icon={<Power />} disabled={!ready} title={ready ? undefined : 'Defina um botão e pelo menos uma etapa'} onClick={() => store.setMacroEnabled(m.id, true)}>Ativar</Button>}
        <Button size="sm" icon={<Pencil />} onClick={onEdit}>Editar</Button>
        <Button size="sm" variant="ghost" icon={<Play />} disabled={!helperOn || !m.steps.length} onClick={() => void store.testMacro(m)} title="Roda uma vez em 3 segundos">Testar</Button>
        <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => store.duplicateMacro(m.id)} aria-label={`Duplicar ${m.name}`} title="Duplicar" />
        <Button size="sm" variant="ghost" icon={<Download />} onClick={onExport} aria-label={`Exportar ${m.name}`} title="Exportar" />
        <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={onDelete} aria-label={`Excluir ${m.name}`} title="Excluir" />
      </div>
      {!m.trigger && <span className="faint" style={{ fontSize: 12 }}>Sem botão definido: não pode ser ativada.</span>}
      {m.enabled && conflicts.length > 0 && (
        <span className="row" style={{ gap: 6, fontSize: 12, color: '#fcd34d' }}>
          <TriangleAlert size={14} /> Mesmo botão ({triggerLabel(m.trigger)}) de {conflicts.map((c) => c.name).join(', ')}: as ações ativas rodam juntas.
        </span>
      )}
    </article>
  );
}
