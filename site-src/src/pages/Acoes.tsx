import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, Circle, Copy, Crosshair, Download, FolderPlus, FolderOpen, LayoutTemplate, Pencil, Play, Plus, Power, PowerOff, Square, Trash2, TriangleAlert, Upload,
} from 'lucide-react';
import { useState } from 'react';
import {
  type Category, type Macro, type MacroGroup, type MacroStep, MODES, activeConflicts, canActivate, describeStep,
  exportAll, exportCategory, exportMacro, groupMacros, macroMs, newMacroId, triggerLabel,
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
  | { kind: 'export'; title: string; json: string; filename: string; note?: string }
  | { kind: 'delete'; macro: Macro }
  | { kind: 'create-cat' } | { kind: 'rename-cat'; cat: Category } | { kind: 'delete-cat'; cat: Category; count: number }
  | null;

function blankMacro(steps: MacroStep[] = [], name = 'Nova ação', categoryId: string | null = null): Macro {
  const now = Date.now();
  return { id: newMacroId(), name, categoryId, enabled: false, trigger: null, mode: 'once', repeat: 1, loopDelay: 0, speed: 1, robloxOnly: true, sideKey: null, sideSound: true, steps, createdAt: now, updatedAt: now };
}

const safe = (s: string) => s.replace(/[/\\]+/g, '-');
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
  const groups = groupMacros(state);
  const nCats = state.categories.length;

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
              <span><strong style={{ fontSize: 20 }}>{nCats}</strong> <span className="muted">{nCats === 1 ? 'categoria' : 'categorias'}</span></span>
            </div>
          </div>
          <div className="row wrap">
            <Button variant={allActive ? 'default' : 'primary'} icon={<Power />} disabled={!activatable || allActive} onClick={() => store.setAllMacrosEnabled(true)}>Ativar tudo</Button>
            <Button icon={<PowerOff />} disabled={active === 0} onClick={() => store.setAllMacrosEnabled(false)}>Desativar tudo</Button>
          </div>
        </div>
        <div className="divider" style={{ margin: '16px 0' }} />
        <div className="row wrap">
          <Button variant="primary" icon={<Plus />} onClick={() => setEditing({ macro: blankMacro(), isNew: true })}>Criar ação</Button>
          <Button icon={<FolderPlus />} onClick={() => setDialog({ kind: 'create-cat' })}>Criar categoria</Button>
          <Button icon={<Circle />} onClick={() => setDialog({ kind: 'record' })}>Gravar macro</Button>
          <Button variant="ghost" icon={<LayoutTemplate />} onClick={() => setDialog({ kind: 'templates' })}>Modelos</Button>
          <Button variant="ghost" icon={<Upload />} onClick={() => setDialog({ kind: 'import' })}>Importar</Button>
          <Button variant="ghost" icon={<Download />} disabled={!total && !nCats} onClick={() => setDialog({ kind: 'export', title: 'Exportar tudo', json: exportAll(state), filename: 'acoes-bope' })}>Exportar todas</Button>
        </div>
      </Card>

      <section className="col" style={{ gap: 14 }}>
        {total === 0 && nCats === 0 ? (
          <Card>
            <Empty icon={<Crosshair />} title="Nenhuma ação">Crie uma ação, uma categoria, grave uma macro ou adicione um dos modelos (Bug Indi, Perfect Dive, Gagatech…).</Empty>
          </Card>
        ) : (
          groups.map((g) => {
            const key = g.category ? g.category.id : 'uncat';
            if (!g.category && g.macros.length === 0) return null; // "Sem categoria" só aparece com ações
            return (
              <CategorySection
                key={key}
                group={g}
                categories={state.categories}
                allMacros={state.macros}
                helperOn={!!helper}
                collapsed={collapsed.has(key)}
                onToggle={() => toggle(key)}
                onNewMacro={() => setEditing({ macro: blankMacro([], 'Nova ação', g.category?.id ?? null), isNew: true })}
                onExport={() => g.category
                  ? setDialog({ kind: 'export', title: `Exportar categoria “${g.category.name}”`, json: exportCategory(state, g.category.id), filename: `categoria-${safe(g.category.name)}` })
                  : setDialog({ kind: 'export', title: 'Exportar “Sem categoria”', json: exportCategory(state, null), filename: 'sem-categoria' })}
                onRename={(cat) => setDialog({ kind: 'rename-cat', cat })}
                onDelete={(cat) => setDialog({ kind: 'delete-cat', cat, count: g.macros.length })}
                onEditMacro={(m) => setEditing({ macro: m, isNew: false })}
                onExportMacro={(m) => setDialog({ kind: 'export', title: `Exportar “${m.name}”`, json: exportMacro(m), filename: m.name, note: 'Exporta só esta ação (sem categoria).' })}
                onDeleteMacro={(m) => setDialog({ kind: 'delete', macro: m })}
              />
            );
          })
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
      {dialog?.kind === 'export' && <ExportMacrosDialog title={dialog.title} json={dialog.json} filename={dialog.filename} note={dialog.note} onClose={close} />}
      {dialog?.kind === 'create-cat' && <CategoryNameDialog title="Criar categoria" confirmLabel="Criar" onConfirm={(name) => store.addCategory(name)} onClose={close} />}
      {dialog?.kind === 'rename-cat' && <CategoryNameDialog title={`Renomear “${dialog.cat.name}”`} confirmLabel="Salvar" initial={dialog.cat.name} onConfirm={(name) => store.renameCategory(dialog.cat.id, name)} onClose={close} />}
      {dialog?.kind === 'delete-cat' && (
        <Confirm title="Excluir categoria" danger confirmLabel="Excluir categoria" onConfirm={() => store.removeCategory(dialog.cat.id)} onClose={close}>
          <p style={{ margin: 0 }}>Excluir a categoria <strong>{dialog.cat.name}</strong>?{dialog.count > 0 ? <> As {dialog.count} {dialog.count === 1 ? 'ação dentro dela volta' : 'ações dentro dela voltam'} para <strong>Sem categoria</strong> — nenhuma ação é apagada.</> : ''}</p>
        </Confirm>
      )}
      {dialog?.kind === 'delete' && (
        <Confirm title="Excluir ação" danger confirmLabel="Excluir" onConfirm={() => store.deleteMacro(dialog.macro.id)} onClose={close}>
          <p style={{ margin: 0 }}>Excluir <strong>{dialog.macro.name}</strong>? Não dá para desfazer (os modelos podem ser adicionados de novo em “Modelos”).</p>
        </Confirm>
      )}
    </div>
  );
}

function CategorySection({ group, categories, allMacros, helperOn, collapsed, onToggle, onNewMacro, onExport, onRename, onDelete, onEditMacro, onExportMacro, onDeleteMacro }: {
  group: MacroGroup; categories: Category[]; allMacros: Macro[]; helperOn: boolean; collapsed: boolean;
  onToggle: () => void; onNewMacro: () => void; onExport: () => void; onRename: (c: Category) => void; onDelete: (c: Category) => void;
  onEditMacro: (m: Macro) => void; onExportMacro: (m: Macro) => void; onDeleteMacro: (m: Macro) => void;
}) {
  const { category, macros } = group;
  const active = macros.filter((m) => m.enabled).length;
  const activatable = macros.filter(canActivate).length;
  const allActive = activatable > 0 && macros.filter(canActivate).every((m) => m.enabled);
  const label = category ? category.name : 'Sem categoria';
  const catId = category ? category.id : null;

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
          <Button size="sm" variant={allActive ? 'default' : 'primary'} icon={<Power />} disabled={!activatable || allActive} onClick={() => store.setCategoryEnabled(catId, true)}>Ativar todas</Button>
          <Button size="sm" icon={<PowerOff />} disabled={active === 0} onClick={() => store.setCategoryEnabled(catId, false)}>Desativar todas</Button>
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={onNewMacro} aria-label={`Nova ação em ${label}`} title="Criar ação nesta categoria" />
          <Button size="sm" variant="ghost" icon={<Download />} onClick={onExport} aria-label={`Exportar categoria ${label}`} title="Exportar categoria (com as ações dentro)" />
          {category && <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => onRename(category)} aria-label={`Renomear categoria ${label}`} title="Renomear categoria" />}
          {category && <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => onDelete(category)} aria-label={`Excluir categoria ${label}`} title="Excluir categoria (as ações ficam sem categoria)" />}
        </div>
      </div>
      {!collapsed && (
        <div className="col cat-body" style={{ gap: 10 }}>
          {macros.length === 0
            ? <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>Categoria vazia. Use “Mover para…” em uma ação ou o <strong>+</strong> acima para criar uma aqui.</p>
            : macros.map((m, i) => (
              <MacroRow
                key={m.id}
                m={m}
                categories={categories}
                conflicts={activeConflicts({ v: 4, categories, macros: allMacros, stopKey: '' }, m)}
                helperOn={helperOn}
                isFirst={i === 0}
                isLast={i === macros.length - 1}
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

function CategoryNameDialog({ title, confirmLabel, initial = '', onConfirm, onClose }: { title: string; confirmLabel: string; initial?: string; onConfirm: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const ok = name.trim().length > 0;
  const submit = () => { if (ok) { onConfirm(name.trim()); onClose(); } };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ok} onClick={submit}>{confirmLabel}</Button></>}
    >
      <label className="col">
        <span className="field-label">Nome da categoria</span>
        <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} aria-label="Nome da categoria" placeholder="Ex.: Movimento, Combate, GK…" />
      </label>
    </Modal>
  );
}

function MacroRow({ m, categories, conflicts, helperOn, isFirst, isLast, onEdit, onExport, onDelete }: {
  m: Macro; categories: Category[]; conflicts: Macro[]; helperOn: boolean; isFirst: boolean; isLast: boolean;
  onEdit: () => void; onExport: () => void; onDelete: () => void;
}) {
  const mode = MODES.find(([v]) => v === m.mode)?.[1] ?? m.mode;
  const ready = canActivate(m);
  return (
    <article className={`macro-row ${m.enabled ? 'on' : ''}`} aria-label={m.name}>
      <div className="macro-main">
        <div className="col reorder" style={{ gap: 2 }}>
          <button type="button" className="icon-btn" disabled={isFirst} onClick={() => store.reorderMacro(m.id, -1)} aria-label={`Subir ${m.name}`} title="Subir"><ArrowUp size={14} /></button>
          <button type="button" className="icon-btn" disabled={isLast} onClick={() => store.reorderMacro(m.id, 1)} aria-label={`Descer ${m.name}`} title="Descer"><ArrowDown size={14} /></button>
        </div>
        <span className={`status-pill ${m.enabled ? 'on' : 'off'}`} aria-label={m.enabled ? 'Ativa' : 'Desativada'}>{m.enabled ? '● Ativa' : '○ Desativada'}</span>
        <div className="col" style={{ gap: 2, minWidth: 0, flex: '1 1 180px' }}>
          <strong className="macro-name">{m.name}</strong>
          <span className="faint truncate" style={{ fontSize: 12 }} title={m.steps.map(describeStep).join('\n')}>
            {mode}{m.mode === 'once' && m.repeat > 1 ? ` ×${m.repeat}` : ''} · {m.steps.length} {m.steps.length === 1 ? 'etapa' : 'etapas'} · ~{macroMs(m)} ms{m.robloxOnly ? ' · só no Roblox' : ''}{m.sideKey ? ` · lado: ${triggerLabel(m.sideKey)}` : ''}
          </span>
        </div>
        <KeyCapture value={m.trigger} onChange={(c) => store.setMacroTrigger(m.id, c)} label={`Botão de ${m.name}`} />
      </div>
      <div className="macro-actions">
        {m.enabled
          ? <Button size="sm" icon={<PowerOff />} onClick={() => store.setMacroEnabled(m.id, false)}>Desativar</Button>
          : <Button size="sm" variant="primary" icon={<Power />} disabled={!ready} title={ready ? undefined : 'Defina um botão e pelo menos uma etapa'} onClick={() => store.setMacroEnabled(m.id, true)}>Ativar</Button>}
        <label className="move-select" title="Mover para categoria">
          <span className="sr-only">Mover {m.name} para categoria</span>
          <select aria-label={`Mover ${m.name} para categoria`} value={m.categoryId ?? ''} onChange={(e) => store.setMacroCategory(m.id, e.target.value || null)}>
            <option value="">Sem categoria</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
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
