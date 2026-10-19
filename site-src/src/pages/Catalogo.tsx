import { Check, Library, Plus, Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { type FlagType, type FlagValue, flagType, inferTypeFromName } from '../core/flags';
import { hasFlag, store, useApp } from '../state/store';
import { Button, Card, Empty, Notice, formatNumber } from '../ui/components';

const MAX_RESULTS = 200;
const TYPES: Array<{ id: FlagType | 'all'; label: string }> = [
  { id: 'all', label: 'Todas' }, { id: 'bool', label: 'bool' }, { id: 'int', label: 'int' }, { id: 'float', label: 'float' }, { id: 'string', label: 'string' },
];

function defaultValue(name: string): FlagValue {
  const t = flagType(name, '');
  return t === 'bool' ? true : t === 'int' || t === 'float' ? 0 : '';
}

export function CatalogoPage() {
  const index = useApp((s) => s.index);
  const offsets = useApp((s) => s.offsets);
  const presets = useApp((s) => s.presets);
  const activeId = useApp((s) => s.activePresetId);
  const active = presets.find((p) => p.id === activeId) ?? null;
  const [q, setQ] = useState('');
  const [type, setType] = useState<FlagType | 'all'>('all');
  const term = useDeferredValue(q.trim().toLowerCase());

  const { results, total } = useMemo(() => {
    if (!index) return { results: [] as string[], total: 0 };
    const out: string[] = [];
    let n = 0;
    for (const name of index.fullNames) {
      if (term && !name.toLowerCase().includes(term)) continue;
      if (type !== 'all' && inferTypeFromName(name) !== type) continue;
      n++;
      if (out.length < MAX_RESULTS) out.push(name);
    }
    return { results: out, total: n };
  }, [index, term, type]);

  if (!index) {
    return (
      <div className="page">
        <Card>
          {offsets.status === 'unavailable'
            ? <Empty icon={<Library />} title="Não foi possível carregar os offsets.">As funções que dependem deles estão indisponíveis.</Empty>
            : <Empty icon={<span className="spinner" style={{ width: 28, height: 28 }} />} title="Carregando o catálogo…">Preparando as flags do dump atual.</Empty>}
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <Card>
        <div className="col" style={{ gap: 12 }}>
          <div className="row wrap" style={{ justifyContent: 'space-between' }}>
            <span className="muted">{formatNumber(index.size)} flags no dump <span className="mono">{index.version}</span></span>
            <span className="muted">Adicionando em: <strong style={{ color: 'var(--text)' }}>{active?.name ?? '—'}</strong></span>
          </div>
          <div className="input-icon">
            <Search />
            <input className="input" autoFocus placeholder="Buscar flag pelo nome (ex.: Fps, Texture, Network)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar flag" />
          </div>
          <div className="row wrap" style={{ justifyContent: 'space-between' }}>
            <div className="seg" role="group" aria-label="Tipo">
              {TYPES.map((t) => <button key={t.id} type="button" aria-pressed={type === t.id} onClick={() => setType(t.id)}>{t.label}</button>)}
            </div>
            <span className="faint" style={{ fontSize: 12.5 }}>
              {formatNumber(total)} {total === 1 ? 'resultado' : 'resultados'}{total > MAX_RESULTS ? ` · mostrando ${MAX_RESULTS}, refine a busca` : ''}
            </span>
          </div>
        </div>
      </Card>
      {!active && <Notice tone="warn">Crie ou selecione um preset para adicionar flags.</Notice>}
      {results.length === 0 ? (
        <Card><Empty icon={<Search />} title="Nenhuma flag encontrada">Tente outra parte do nome.</Empty></Card>
      ) : (
        <div className="list">
          {results.map((name) => {
            const inPreset = !!active && hasFlag(active.flags, name);
            return (
              <div key={name} className="list-row">
                <span className="mono truncate" style={{ flex: 1 }} title={name}>{name}</span>
                <span className="tag" title={inferTypeFromName(name) ? undefined : 'Sem prefixo: o tipo vem do valor'}>{inferTypeFromName(name) ?? 'auto'}</span>
                {inPreset ? (
                  <span className="tag green"><Check size={13} /> No preset</span>
                ) : (
                  <Button size="sm" icon={<Plus />} disabled={!active} onClick={() => active && store.setFlag(active.id, name, defaultValue(name))}>Adicionar</Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
