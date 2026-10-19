import {
  Activity, ArrowDown, ArrowUp, CheckSquare, ChevronDown, ChevronRight, Circle, Copy, Crosshair, Download, FolderPlus, FolderOpen,
  GripVertical, LayoutTemplate, ListChecks, Pencil, Play, Plus, Power, PowerOff, Search, SlidersHorizontal, Square, Timer, Trash2,
  TriangleAlert, Upload, X, Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  type Category, type Issue, type Macro, type MacroStep, MODES, canActivate, describeStep, directBlocker, exportAll, exportCategory,
  exportMacro, exportSelection, groupMacros, macroTotalMs, newMacro, triggerLabel, validateAll,
} from '../core/macros';
import { store, useApp } from '../state/store';
import {
  Button, Card, Confirm, Empty, KeyCapture, Modal, Notice, Switch,
} from '../ui/components';
import { MacroEditor } from './MacroEditor';
import {
  BatchEditDialog, ExportMacrosDialog, ImportMacrosDialog, RecorderDialog, TemplatesDialog, TimingPresetsDialog,
} from './MacroDialogs';

type Editing = { macro: Macro; isNew: boolean } | null;
type Dialog =
  | { kind: 'record' } | { kind: 'import' } | { kind: 'templates' } | { kind: 'presets' } | { kind: 'batch' } | { kind: 'delete-many' }
  | { kind: 'export'; title: string; json: string; filename: string; note?: string }
  | { kind: 'delete'; macro: Macro }
  | { kind: 'create-cat' } | { kind: 'rename-cat'; cat: Category } | { kind: 'delete-cat'; cat: Category; count: number }
  | null;
type StatusFilter = 'all' | 'on' | 'off' | 'running' | 'issues';
type Sort = 'custom' | 'name' | 'trigger' | 'updated';
type Drag = { kind: 'macro' | 'cat'; id: string } | null;

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
  const live = useApp((s) => s.live);
  const [editing, setEditing] = useState<Editing>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<Sort>('custom');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showIssues, setShowIssues] = useState(false);
  const [drag, setDrag] = useState<Drag>(null);
  useEffect(() => store.watchLive(), []);
  // a seleção acompanha as ações que ainda existem
  useEffect(() => {
    setSelected((cur) => { const ids = new Set(state.macros.map((m) => m.id)); const next = new Set([...cur].filter((id) => ids.has(id))); return next.size === cur.size ? cur : next; });
  }, [state.macros]);

  const issues = useMemo(() => validateAll(state), [state]);
  const issueBy = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const i of issues) if (i.macroId) map.set(i.macroId, [...(map.get(i.macroId) ?? []), i]);
    return map;
  }, [issues]);
  const running = useMemo(() => new Set((live?.running ?? []).map((r) => r.id)), [live]);

  if (editing) return <MacroEditor initial={editing.macro} isNew={editing.isNew} onClose={() => { setEditing(null); requestAnimationFrame(() => document.querySelector('.content')?.scrollTo({ top: 0 })); }} />;

  const close = () => setDialog(null);
  const toggle = (key: string) => setCollapsed((cur) => {
    const next = new Set(cur);
    next.has(key) ? next.delete(key) : next.add(key);
    saveCollapsed(next);
    return next;
  });
  const select = (id: string, on: boolean) => setSelected((cur) => { const next = new Set(cur); on ? next.add(id) : next.delete(id); return next; });

  const total = state.macros.length;
  const active = state.macros.filter((m) => m.enabled).length;
  const activatable = state.macros.filter(canActivate).length;
  const allActive = activatable > 0 && state.macros.filter(canActivate).every((m) => m.enabled);
  const nCats = state.categories.length;
  const errors = issues.filter((i) => i.level === 'erro').length;

  const q = query.trim().toLowerCase();
  const matches = (m: Macro) => {
    if (q && !`${m.name} ${m.description} ${triggerLabel(m.trigger)}`.toLowerCase().includes(q)) return false;
    if (catFilter === 'none' && m.categoryId && state.categories.some((c) => c.id === m.categoryId)) return false;
    if (catFilter !== 'all' && catFilter !== 'none' && m.categoryId !== catFilter) return false;
    if (statusFilter === 'on' && !m.enabled) return false;
    if (statusFilter === 'off' && m.enabled) return false;
    if (statusFilter === 'running' && !running.has(m.id)) return false;
    if (statusFilter === 'issues' && !issueBy.has(m.id)) return false;
    return true;
  };
  const grouped = sort === 'custom' && !q && catFilter === 'all' && statusFilter === 'all';
  const flat = grouped ? [] : state.macros.filter(matches).sort((a, b) => (
    sort === 'name' ? a.name.localeCompare(b.name, 'pt-BR')
      : sort === 'trigger' ? triggerLabel(a.trigger).localeCompare(triggerLabel(b.trigger), 'pt-BR')
        : sort === 'updated' ? b.updatedAt - a.updatedAt : 0));
  const visibleIds = grouped ? state.macros.map((m) => m.id) : flat.map((m) => m.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const sel = [...selected];

  const rowProps = (m: Macro) => ({
    m,
    categories: state.categories,
    selected: selected.has(m.id),
    running: running.has(m.id),
    issues: issueBy.get(m.id) ?? [],
    side: live?.sides[m.id] ?? null,
    direct: live?.direct[m.id] ?? null,
    helperOn: !!helper,
    drag,
    onSelect: (on: boolean) => select(m.id, on),
    onDrag: setDrag,
    onEdit: () => setEditing({ macro: m, isNew: false }),
    onExport: () => setDialog({ kind: 'export', title: `Exportar “${m.name}”`, json: exportMacro(m), filename: m.name, note: 'Exporta só esta ação (sem categoria).' }),
    onDelete: () => setDialog({ kind: 'delete', macro: m }),
  });

  return (
    <div className="page">
      {!helper && (
        <Notice tone="warn"><strong>Helper desconectado.</strong> As ações são executadas pelo Helper local. Abra o help.bat e deixe a janela aberta; a configuração é enviada automaticamente.</Notice>
      )}

      <Card>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 16 }}>
          <div className="stat-tiles" aria-live="polite">
            <div className="stat"><strong>{active}</strong><span>{active === 1 ? 'ativa' : 'ativas'}</span></div>
            <div className="stat"><strong>{total - active}</strong><span>{total - active === 1 ? 'desativada' : 'desativadas'}</span></div>
            <div className="stat"><strong>{nCats}</strong><span>{nCats === 1 ? 'categoria' : 'categorias'}</span></div>
            <div className={`stat ${running.size ? 'live' : ''}`}><strong>{running.size}</strong><span>rodando agora</span></div>
            <button type="button" className={`stat ${issues.length ? (errors ? 'bad' : 'warn') : ''}`} onClick={() => setShowIssues((v) => !v)} aria-expanded={showIssues} title="Ver problemas encontrados">
              <strong>{issues.length}</strong><span>{issues.length === 1 ? 'aviso' : 'avisos'}</span>
            </button>
          </div>
          <div className="row wrap">
            <Button variant={allActive ? 'default' : 'primary'} icon={<Power />} disabled={!activatable || allActive} onClick={() => store.setAllMacrosEnabled(true)}>Ativar tudo</Button>
            <Button icon={<PowerOff />} disabled={active === 0} onClick={() => store.setAllMacrosEnabled(false)}>Desativar tudo</Button>
            <Button icon={<Square />} disabled={!helper} onClick={() => void store.stopActions()} title="Para todas as ações em andamento">Parar tudo</Button>
          </div>
        </div>
        <div className="divider" style={{ margin: '16px 0' }} />
        <div className="row wrap">
          <Button variant="primary" icon={<Plus />} onClick={() => setEditing({ macro: newMacro(), isNew: true })}>Criar ação</Button>
          <Button icon={<FolderPlus />} onClick={() => setDialog({ kind: 'create-cat' })}>Criar categoria</Button>
          <Button icon={<Circle />} onClick={() => setDialog({ kind: 'record' })}>Gravar macro</Button>
          <Button variant="ghost" icon={<LayoutTemplate />} onClick={() => setDialog({ kind: 'templates' })}>Modelos</Button>
          <Button variant="ghost" icon={<Timer />} onClick={() => setDialog({ kind: 'presets' })}>Presets de tempo</Button>
          <Button variant="ghost" icon={<Upload />} onClick={() => setDialog({ kind: 'import' })}>Importar</Button>
          <Button variant="ghost" icon={<Download />} disabled={!total && !nCats} onClick={() => setDialog({ kind: 'export', title: 'Exportar tudo', json: exportAll(state), filename: 'acoes-bope' })}>Exportar todas</Button>
        </div>
      </Card>

      {showIssues && <IssuesPanel issues={issues} macros={state.macros} onEdit={(m) => setEditing({ macro: m, isNew: false })} onClose={() => setShowIssues(false)} />}

      <div className="toolbar">
        <label className="input-icon toolbar-search">
          <Search />
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar por nome, descrição ou botão…" aria-label="Pesquisar ações" />
        </label>
        <select className="select" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Filtrar por categoria">
          <option value="all">Todas as categorias</option>
          {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">Sem categoria</option>
        </select>
        <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} aria-label="Filtrar por estado">
          <option value="all">Todos os estados</option>
          <option value="on">Ativas</option>
          <option value="off">Desativadas</option>
          <option value="running">Rodando agora</option>
          <option value="issues">Com aviso</option>
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Ordenar">
          <option value="custom">Ordem personalizada</option>
          <option value="name">Nome</option>
          <option value="trigger">Botão</option>
          <option value="updated">Editadas por último</option>
        </select>
        <label className="row chk" title="Selecionar todas as visíveis">
          <input type="checkbox" checked={allVisibleSelected} onChange={(e) => setSelected(e.target.checked ? new Set(visibleIds) : new Set())} aria-label="Selecionar todas as visíveis" />
          <span className="faint" style={{ fontSize: 12.5 }}>Todas</span>
        </label>
      </div>

      {sel.length > 0 && (
        <div className="batch-bar" role="toolbar" aria-label="Ações selecionadas">
          <strong><CheckSquare size={16} /> {sel.length} {sel.length === 1 ? 'selecionada' : 'selecionadas'}</strong>
          <Button size="sm" icon={<Power />} onClick={() => store.setManyEnabled(sel, true)}>Ativar</Button>
          <Button size="sm" icon={<PowerOff />} onClick={() => store.setManyEnabled(sel, false)}>Desativar</Button>
          <select className="select" value="" onChange={(e) => { if (e.target.value) store.moveMany(sel, e.target.value === '__none' ? null : e.target.value); }} aria-label="Mover selecionadas para categoria">
            <option value="">Mover para…</option>
            {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__none">Sem categoria</option>
          </select>
          <select className="select" value="" onChange={(e) => { if (e.target.value) store.applyTimingPreset(sel, e.target.value); }} aria-label="Aplicar preset de tempo nas selecionadas">
            <option value="">Aplicar preset de tempo…</option>
            {state.timingPresets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button size="sm" icon={<SlidersHorizontal />} onClick={() => setDialog({ kind: 'batch' })}>Editar em lote</Button>
          <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => store.duplicateMany(sel)}>Duplicar</Button>
          <Button size="sm" variant="ghost" icon={<Download />} onClick={() => setDialog({ kind: 'export', title: `Exportar ${sel.length} selecionadas`, json: exportSelection(state, sel), filename: 'acoes-selecionadas' })}>Exportar</Button>
          <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => setDialog({ kind: 'delete-many' })}>Excluir</Button>
          <Button size="sm" variant="ghost" icon={<X />} onClick={() => setSelected(new Set())} aria-label="Limpar seleção" />
        </div>
      )}

      <section className="col" style={{ gap: 14 }}>
        {total === 0 && nCats === 0 ? (
          <Card>
            <Empty icon={<Crosshair />} title="Nenhuma ação">Crie uma ação, uma categoria, grave uma macro ou adicione um dos modelos (Bug Indi, Perfect Dive, Gagatech…).</Empty>
          </Card>
        ) : grouped ? (
          groupMacros(state).map((g) => {
            const key = g.category ? g.category.id : 'uncat';
            if (!g.category && g.macros.length === 0) return null; // "Sem categoria" só aparece com ações
            const catId = g.category ? g.category.id : null;
            return (
              <div
                key={key}
                className={`cat-group ${g.macros.some((m) => m.enabled) ? 'has-active' : ''} ${drag ? 'drop-zone' : ''}`}
                onDragOver={(e) => { if (drag) e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag?.kind === 'macro') store.moveMacroTo(drag.id, catId, null);
                  else if (drag?.kind === 'cat' && g.category && drag.id !== g.category.id) store.moveCategoryTo(drag.id, g.category.id);
                  setDrag(null);
                }}
              >
                <CategoryHead
                  group={g.macros}
                  category={g.category}
                  collapsed={collapsed.has(key)}
                  selectedCount={g.macros.filter((m) => selected.has(m.id)).length}
                  onSelectAll={(on) => setSelected((cur) => { const next = new Set(cur); for (const m of g.macros) on ? next.add(m.id) : next.delete(m.id); return next; })}
                  onToggle={() => toggle(key)}
                  onDrag={setDrag}
                  onNewMacro={() => setEditing({ macro: newMacro({ categoryId: catId }), isNew: true })}
                  onExport={() => g.category
                    ? setDialog({ kind: 'export', title: `Exportar categoria “${g.category.name}”`, json: exportCategory(state, g.category.id), filename: `categoria-${safe(g.category.name)}` })
                    : setDialog({ kind: 'export', title: 'Exportar “Sem categoria”', json: exportCategory(state, null), filename: 'sem-categoria' })}
                  onRename={(cat) => setDialog({ kind: 'rename-cat', cat })}
                  onDelete={(cat) => setDialog({ kind: 'delete-cat', cat, count: g.macros.length })}
                />
                {!collapsed.has(key) && (
                  <div className="col cat-body" style={{ gap: 10 }}>
                    {g.macros.length === 0
                      ? <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>Categoria vazia. Arraste uma ação para cá, use “Mover para…” ou o <strong>+</strong> acima.</p>
                      : g.macros.map((m, i) => <MacroRow key={m.id} {...rowProps(m)} isFirst={i === 0} isLast={i === g.macros.length - 1} reorder />)}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <Card title={`Resultados (${flat.length})`} actions={<Button size="sm" variant="ghost" onClick={() => { setQuery(''); setCatFilter('all'); setStatusFilter('all'); setSort('custom'); }}>Limpar filtros</Button>}>
            {flat.length === 0 ? <p className="faint" style={{ margin: 0 }}>Nenhuma ação com esses filtros.</p> : (
              <div className="col" style={{ gap: 10 }}>{flat.map((m) => <MacroRow key={m.id} {...rowProps(m)} showCategory />)}</div>
            )}
          </Card>
        )}
      </section>

      <Card title="Controle" icon={<Square size={18} />}>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 16 }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <span className="field-label">Tecla de parada</span>
            <KeyCapture value={state.stopKey} onChange={(c) => store.setStopKey(c)} allowScroll={false} label="Tecla de parada" />
            <span className="faint" style={{ fontSize: 12.5 }}>Para todas as ações em andamento e encerra a gravação.</span>
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <Switch checked={state.history} onChange={(v) => store.setHistoryEnabled(v)} label="Registrar histórico de execuções" />
            <span className="faint" style={{ fontSize: 12.5 }}>Histórico de execuções {state.history ? 'ligado' : 'desligado'} (só na memória do Helper; veja em Diagnóstico).</span>
          </div>
        </div>
      </Card>

      {dialog?.kind === 'record' && (
        <RecorderDialog
          onClose={close}
          onRecorded={(steps: MacroStep[]) => {
            close();
            const t = new Date();
            setEditing({ macro: newMacro({ steps, name: `Gravação ${t.toLocaleDateString('pt-BR')} ${t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` }), isNew: true });
            store.toast('info', `Gravação com ${steps.length} etapas. Revise e salve.`);
          }}
        />
      )}
      {dialog?.kind === 'import' && <ImportMacrosDialog onClose={close} />}
      {dialog?.kind === 'templates' && <TemplatesDialog onClose={close} />}
      {dialog?.kind === 'presets' && <TimingPresetsDialog onClose={close} />}
      {dialog?.kind === 'batch' && <BatchEditDialog ids={sel} onClose={close} />}
      {dialog?.kind === 'export' && <ExportMacrosDialog title={dialog.title} json={dialog.json} filename={dialog.filename} note={dialog.note} onClose={close} />}
      {dialog?.kind === 'create-cat' && <CategoryNameDialog title="Criar categoria" confirmLabel="Criar" onConfirm={(name) => store.addCategory(name)} onClose={close} />}
      {dialog?.kind === 'rename-cat' && <CategoryNameDialog title={`Renomear “${dialog.cat.name}”`} confirmLabel="Salvar" initial={dialog.cat.name} onConfirm={(name) => store.renameCategory(dialog.cat.id, name)} onClose={close} />}
      {dialog?.kind === 'delete-cat' && <DeleteCategoryDialog cat={dialog.cat} count={dialog.count} categories={state.categories} onClose={close} />}
      {dialog?.kind === 'delete' && (
        <Confirm title="Excluir ação" danger confirmLabel="Excluir" onConfirm={() => store.deleteMacro(dialog.macro.id)} onClose={close}>
          <p style={{ margin: 0 }}>Excluir <strong>{dialog.macro.name}</strong>? Não dá para desfazer (os modelos podem ser adicionados de novo em “Modelos”).</p>
        </Confirm>
      )}
      {dialog?.kind === 'delete-many' && (
        <Confirm title="Excluir ações selecionadas" danger confirmLabel={`Excluir ${sel.length}`} onConfirm={() => { store.removeMany(sel); setSelected(new Set()); }} onClose={close}>
          <p style={{ margin: 0 }}>Excluir <strong>{sel.length}</strong> {sel.length === 1 ? 'ação' : 'ações'}? Não dá para desfazer.</p>
        </Confirm>
      )}
    </div>
  );
}

function IssuesPanel({ issues, macros, onEdit, onClose }: { issues: Issue[]; macros: Macro[]; onEdit: (m: Macro) => void; onClose: () => void }) {
  return (
    <Card title={`Validação (${issues.length})`} icon={<ListChecks size={18} />} actions={<Button size="sm" variant="ghost" icon={<X />} onClick={onClose} aria-label="Fechar validação" />}>
      {issues.length === 0 ? <Notice tone="ok">Nenhum problema encontrado nas ações.</Notice> : (
        <ul className="issue-list">
          {issues.map((i, k) => {
            const m = i.macroId ? macros.find((x) => x.id === i.macroId) : null;
            return (
              <li key={k} className={i.level}>
                <TriangleAlert size={15} />
                <div className="col" style={{ gap: 1 }}>
                  <span>{i.text}</span>
                  <span className="faint" style={{ fontSize: 12 }}>Como corrigir: {i.fix}</span>
                </div>
                {m && <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => onEdit(m)}>Editar</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function CategoryHead({ group, category, collapsed, selectedCount, onSelectAll, onToggle, onDrag, onNewMacro, onExport, onRename, onDelete }: {
  group: Macro[]; category: Category | null; collapsed: boolean; selectedCount: number; onSelectAll: (on: boolean) => void;
  onToggle: () => void; onDrag: (d: Drag) => void; onNewMacro: () => void; onExport: () => void; onRename: (c: Category) => void; onDelete: (c: Category) => void;
}) {
  const active = group.filter((m) => m.enabled).length;
  const activatable = group.filter(canActivate).length;
  const allActive = activatable > 0 && group.filter(canActivate).every((m) => m.enabled);
  const label = category ? category.name : 'Sem categoria';
  const catId = category ? category.id : null;
  return (
    <div className="cat-head">
      <div className="row" style={{ gap: 4, minWidth: 0, flex: '1 1 auto' }}>
        {category && (
          <span className="drag-handle" draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', category.id); onDrag({ kind: 'cat', id: category.id }); }} onDragEnd={() => onDrag(null)} title="Arraste para reordenar a categoria" aria-hidden="true"><GripVertical size={16} /></span>
        )}
        {group.length > 0 && <input type="checkbox" checked={selectedCount > 0 && selectedCount === group.length} onChange={(e) => onSelectAll(e.target.checked)} aria-label={`Selecionar ações de ${label}`} />}
        <button type="button" className="cat-toggle" aria-expanded={!collapsed} onClick={onToggle} aria-label={`${collapsed ? 'Abrir' : 'Retrair'} categoria ${label}`}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
          <FolderOpen size={16} className="faint" />
          <span className="cat-name">{label}</span>
          <span className="tag">{group.length}</span>
          {active > 0 && <span className="tag green">{active} ativa{active > 1 ? 's' : ''}</span>}
        </button>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <Button size="sm" variant={allActive ? 'default' : 'primary'} icon={<Power />} disabled={!activatable || allActive} onClick={() => store.setCategoryEnabled(catId, true)}>Ativar todas</Button>
        <Button size="sm" icon={<PowerOff />} disabled={active === 0} onClick={() => store.setCategoryEnabled(catId, false)}>Desativar todas</Button>
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={onNewMacro} aria-label={`Nova ação em ${label}`} title="Criar ação nesta categoria" />
        {category && <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => store.duplicateCategory(category.id)} aria-label={`Duplicar categoria ${label}`} title="Duplicar a categoria com as ações" />}
        <Button size="sm" variant="ghost" icon={<Download />} onClick={onExport} aria-label={`Exportar categoria ${label}`} title="Exportar categoria (com as ações dentro)" />
        {category && <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => onRename(category)} aria-label={`Renomear categoria ${label}`} title="Renomear categoria" />}
        {category && <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => onDelete(category)} aria-label={`Excluir categoria ${label}`} title="Excluir categoria (você escolhe o que fazer com as ações)" />}
      </div>
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

/** Excluir categoria: o usuário decide o destino das ações (nunca apaga sem escolher). */
function DeleteCategoryDialog({ cat, count, categories, onClose }: { cat: Category; count: number; categories: Category[]; onClose: () => void }) {
  const others = categories.filter((c) => c.id !== cat.id);
  const [what, setWhat] = useState<'uncat' | 'move' | 'delete'>('uncat');
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const confirm = () => {
    store.removeCategory(cat.id, what === 'delete' ? 'delete' : what === 'move' && target ? { moveTo: target } : 'uncat');
    onClose();
  };
  return (
    <Modal
      title="Excluir categoria"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="danger" onClick={confirm} autoFocus>Excluir categoria</Button></>}
    >
      <p style={{ margin: 0 }}>Excluir a categoria <strong>{cat.name}</strong>?{count === 0 ? ' Ela está vazia.' : ''}</p>
      {count > 0 && (
        <div className="col" role="radiogroup" aria-label="O que fazer com as ações" style={{ gap: 8 }}>
          <span className="field-label">O que fazer com {count === 1 ? 'a ação dentro dela' : `as ${count} ações dentro dela`}?</span>
          <label className="row"><input type="radio" name="del-cat" checked={what === 'uncat'} onChange={() => setWhat('uncat')} /> Deixar em <strong>Sem categoria</strong> (nenhuma ação é apagada)</label>
          {others.length > 0 && (
            <label className="row wrap"><input type="radio" name="del-cat" checked={what === 'move'} onChange={() => setWhat('move')} /> Mover para
              <select className="select" style={{ width: 'auto' }} value={target} onChange={(e) => { setTarget(e.target.value); setWhat('move'); }} aria-label="Categoria de destino">
                {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <label className="row"><input type="radio" name="del-cat" checked={what === 'delete'} onChange={() => setWhat('delete')} /> <span style={{ color: '#ff8a8d' }}>Excluir as ações junto</span></label>
          {what === 'delete' && <Notice tone="err">As {count} {count === 1 ? 'ação será apagada' : 'ações serão apagadas'} junto. Não dá para desfazer.</Notice>}
        </div>
      )}
    </Modal>
  );
}

const MOD_LABEL: Record<string, string> = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt' };

function MacroRow({ m, categories, selected, running, issues, side, direct, helperOn, drag, onSelect, onDrag, isFirst, isLast, reorder, showCategory, onEdit, onExport, onDelete }: {
  m: Macro; categories: Category[]; selected: boolean; running: boolean; issues: Issue[]; side: string | null;
  direct: { presses: number; fails: number; held: boolean } | null; helperOn: boolean; drag: Drag;
  onSelect: (on: boolean) => void; onDrag: (d: Drag) => void; isFirst?: boolean; isLast?: boolean; reorder?: boolean; showCategory?: boolean;
  onEdit: () => void; onExport: () => void; onDelete: () => void;
}) {
  const [over, setOver] = useState(false);
  const mode = MODES.find(([v]) => v === m.mode)?.[1] ?? m.mode;
  const ready = canActivate(m);
  const on = m.steps.filter((s) => !s.off);
  const cat = showCategory ? categories.find((c) => c.id === m.categoryId)?.name ?? 'Sem categoria' : null;
  const isDirect = m.enabled && m.mode === 'mirror' && !directBlocker(m);
  const conflictIssue = issues.find((i) => /mesmo botão/.test(i.text));
  return (
    <article
      className={`macro-row ${m.enabled ? 'on' : ''} ${running || direct?.held ? 'running' : ''} ${selected ? 'selected' : ''} ${over ? 'drop-before' : ''}`}
      aria-label={m.name}
      onDragOver={(e) => { if (drag?.kind === 'macro' && drag.id !== m.id) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (drag?.kind === 'macro') { e.preventDefault(); e.stopPropagation(); store.moveMacroTo(drag.id, m.categoryId, m.id); onDrag(null); } setOver(false); }}
    >
      <div className="macro-main">
        <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Selecionar ${m.name}`} />
        <span
          className="drag-handle"
          draggable
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); onDrag({ kind: 'macro', id: m.id }); }}
          onDragEnd={() => onDrag(null)}
          title="Arraste para reordenar ou mover para outra categoria"
          aria-hidden="true"
        >
          <GripVertical size={16} />
        </span>
        {reorder && (
          <div className="col reorder" style={{ gap: 2 }}>
            <button type="button" className="icon-btn" disabled={isFirst} onClick={() => store.reorderMacro(m.id, -1)} aria-label={`Subir ${m.name}`} title="Subir"><ArrowUp size={14} /></button>
            <button type="button" className="icon-btn" disabled={isLast} onClick={() => store.reorderMacro(m.id, 1)} aria-label={`Descer ${m.name}`} title="Descer"><ArrowDown size={14} /></button>
          </div>
        )}
        <span className={`status-pill ${m.enabled ? 'on' : 'off'}`} aria-label={m.enabled ? 'Ativa' : 'Desativada'}>{m.enabled ? '● Ativa' : '○ Desativada'}</span>
        <div className="col" style={{ gap: 2, minWidth: 0, flex: '1 1 200px' }}>
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            <strong className="macro-name">{m.name}</strong>
            {(running || direct?.held) && <span className="live-badge"><Activity size={12} /> rodando</span>}
            {isDirect && <span className="tag gold" title="Executada direto no hook do Windows (latência zero)"><Zap size={11} /> direta</span>}
            {cat && <span className="tag">{cat}</span>}
            {issues.length > 0 && <span className={`tag ${issues.some((i) => i.level === 'erro') ? 'red' : 'amber'}`} title={issues.map((i) => i.text).join('\n')}><TriangleAlert size={11} /> {issues.length}</span>}
          </div>
          {m.description && <span className="faint truncate" style={{ fontSize: 12 }}>{m.description}</span>}
          <span className="faint truncate" style={{ fontSize: 12 }} title={m.steps.map(describeStep).join('\n')}>
            {mode}{m.mode === 'once' && m.repeat > 1 ? ` ×${m.repeat}` : ''} · {on.length} {on.length === 1 ? 'etapa' : 'etapas'}{on.length !== m.steps.length ? ` (+${m.steps.length - on.length} desativadas)` : ''} · ~{macroTotalMs(m)} ms
            {m.robloxOnly ? ' · só no Roblox' : ''}{m.group ? ` · grupo ${m.group}` : ''}{m.stopKey ? ` · para com ${triggerLabel(m.stopKey)}` : ''}
            {m.sideKey ? ` · lado: ${triggerLabel(m.sideKey)}${side ? ` (${side})` : ''}` : ''}{direct ? ` · ${direct.presses} acionamentos${direct.fails ? `, ${direct.fails} falhas` : ''}` : ''}
          </span>
        </div>
        <span className="row" style={{ gap: 4 }}>
          {m.mods.map((k) => <span key={k} className="tag">{MOD_LABEL[k]} +</span>)}
          <KeyCapture value={m.trigger} onChange={(c) => store.setMacroTrigger(m.id, c)} label={`Botão de ${m.name}`} />
        </span>
      </div>
      <div className="macro-actions">
        {m.enabled
          ? <Button size="sm" icon={<PowerOff />} onClick={() => store.setMacroEnabled(m.id, false)}>Desativar</Button>
          : <Button size="sm" variant="primary" icon={<Power />} disabled={!ready} title={ready ? undefined : 'Defina um botão e pelo menos uma etapa ativa'} onClick={() => store.setMacroEnabled(m.id, true)}>Ativar</Button>}
        <label className="move-select" title="Mover para categoria">
          <span className="sr-only">Mover {m.name} para categoria</span>
          <select aria-label={`Mover ${m.name} para categoria`} value={m.categoryId ?? ''} onChange={(e) => store.setMacroCategory(m.id, e.target.value || null)}>
            <option value="">Sem categoria</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <Button size="sm" icon={<Pencil />} onClick={onEdit}>Editar</Button>
        {running
          ? <Button size="sm" variant="danger" icon={<Square />} onClick={() => void store.stopMacro(m.id)} aria-label={`Parar ${m.name}`}>Parar</Button>
          : <Button size="sm" variant="ghost" icon={<Play />} disabled={!helperOn || !on.length} onClick={() => void store.testMacro(m)} title="Roda uma vez em 3 segundos">Testar</Button>}
        <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => store.duplicateMacro(m.id)} aria-label={`Duplicar ${m.name}`} title="Duplicar" />
        <Button size="sm" variant="ghost" icon={<Download />} onClick={onExport} aria-label={`Exportar ${m.name}`} title="Exportar" />
        <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={onDelete} aria-label={`Excluir ${m.name}`} title="Excluir" />
      </div>
      {!m.trigger && <span className="faint" style={{ fontSize: 12 }}>Sem botão definido: não pode ser ativada.</span>}
      {m.enabled && conflictIssue && (
        <span className="row" style={{ gap: 6, fontSize: 12, color: '#fcd34d' }}>
          <TriangleAlert size={14} /> {conflictIssue.text}
        </span>
      )}
    </article>
  );
}
