import { Eraser } from 'lucide-react';
import { useMemo } from 'react';
import { scanInvalidFlags } from '../core/presets';
import { store, useApp } from '../state/store';
import { Button, Modal, Notice } from '../ui/components';

/**
 * Compara TODAS as flags salvas (todos os presets + hotkeys de flags) com o dump
 * atual e remove, após confirmação, somente as que não existem mais nele.
 */
export function InvalidFlagsDialog({ onClose }: { onClose: () => void }) {
  const index = useApp((s) => s.index);
  const presets = useApp((s) => s.presets);
  const hotkeys = useApp((s) => s.hotkeys);
  const report = useMemo(() => (index ? scanInvalidFlags(presets, hotkeys, index) : null), [index, presets, hotkeys]);

  if (!index || !report) {
    return (
      <Modal title="Remover flags inválidas" onClose={onClose} footer={<Button onClick={onClose}>Fechar</Button>}>
        <Notice tone="err">Não foi possível carregar os offsets. Sem o dump atual não dá para saber quais flags são inválidas.</Notice>
      </Modal>
    );
  }

  const nothing = report.total === 0 && report.hotkeys.length === 0;
  return (
    <Modal
      title="Remover flags inválidas"
      onClose={onClose}
      wide
      footer={nothing ? <Button onClick={onClose}>Fechar</Button> : (
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="danger" icon={<Eraser />} onClick={() => { store.removeInvalid(report); onClose(); }}>
            Remover configurações inválidas
          </Button>
        </>
      )}
    >
      {nothing ? (
        <Notice tone="ok">Nenhuma configuração inválida. Todas as flags salvas existem no dump atual ({report.version}).</Notice>
      ) : (
        <>
          <div className="row" style={{ gap: 14, alignItems: 'baseline' }}>
            <span className="big-number">{report.total}</span>
            <strong>{report.total === 1 ? 'configuração inválida encontrada.' : 'configurações inválidas encontradas.'}</strong>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Essas configurações não existem mais no dump atual (<span className="mono">{report.version}</span>).
            A comparação usa o mesmo identificador que o Helper usa para achar cada flag. As flags válidas não são alteradas.
          </p>
          <div className="list">
            {report.presets.map((p) => (
              <details key={p.id} className="list-row" style={{ display: 'block' }}>
                <summary style={{ cursor: 'pointer' }}>
                  <strong>{p.name}</strong> <span className="tag red" style={{ marginLeft: 8 }}>{p.flags.length}</span>
                </summary>
                <ul style={{ margin: '10px 0 2px', paddingLeft: 18, columns: '2 260px' }}>
                  {p.flags.map((f) => <li key={f} className="mono" style={{ breakInside: 'avoid' }}>{f}</li>)}
                </ul>
              </details>
            ))}
          </div>
          {report.hotkeys.length > 0 && (
            <Notice tone="warn">
              {report.hotkeys.length} {report.hotkeys.length === 1 ? 'hotkey de flag inexistente também será removida' : 'hotkeys de flags inexistentes também serão removidas'}.
            </Notice>
          )}
        </>
      )}
    </Modal>
  );
}
