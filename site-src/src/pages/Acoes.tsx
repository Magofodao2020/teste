import { Info, Play, RotateCcw, Square, Timer } from 'lucide-react';
import { useState } from 'react';
import {
  ACTION_GROUPS, type Action, describeStep, sharedTrigger, triggerLabel,
} from '../core/actions';
import { store, useApp } from '../state/store';
import {
  Button, Card, Confirm, KeyCapture, Notice, Switch,
} from '../ui/components';

function durationMs(a: Action) {
  let ms = 0;
  for (const s of a.macro.steps) {
    const n = (k: string) => Number(s[k] ?? 0);
    if (s.t === 'flick') ms += n('pre') + n('hold') + n('afterUp') + n('moveDur') + n('afterMove') + n('cooldown');
    else if (s.t === 'key') ms += Math.max(1, n('n')) * n('hold') + (Math.max(1, n('n')) - 1) * n('gap');
    else if (s.t === 'wait') ms += n('ms');
  }
  return Math.round(ms / (a.macro.speed || 1));
}

function ActionCard({ action }: { action: Action }) {
  const actionsState = useApp((s) => s.actions);
  const helper = useApp((s) => s.helper);
  const shared = sharedTrigger(actionsState, action.id);
  const activeOther = shared.find((a) => a.enabled);
  return (
    <article className={`action ${action.enabled ? 'on' : ''}`} aria-label={action.macro.name}>
      <div className="action-head">
        <Switch checked={action.enabled} onChange={(v) => store.setActionEnabled(action.id, v)} label={`Ativar ${action.macro.name}`} />
        <div className="action-title">
          <span className="action-name">{action.macro.name}</span>
          <span className="faint" style={{ fontSize: 12 }}>{action.enabled ? 'Ativa' : 'Inativa'} · só com o Roblox em foco</span>
        </div>
        <KeyCapture value={action.trigger} onChange={(code) => store.setActionTrigger(action.id, code)} label={`Botão de ${action.macro.name}`} />
      </div>
      <ol className="steps">
        {action.macro.steps.map((s, i) => (
          <li key={i}><span>{i + 1}.</span><span>{describeStep(s)}</span></li>
        ))}
      </ol>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <span className="faint row" style={{ gap: 6, fontSize: 12 }}><Timer size={14} /> {durationMs(action) ? `~${durationMs(action)} ms por execução` : 'Teclas em sequência imediata'}</span>
        <Button size="sm" icon={<Play />} disabled={!helper} onClick={() => void store.testAction(action.id)} title={helper ? 'Roda uma vez em 3 segundos' : 'Helper desconectado'}>
          Testar (3 s)
        </Button>
      </div>
      {shared.length > 0 && (
        <div className="faint row" style={{ gap: 8, fontSize: 12, alignItems: 'flex-start' }}>
          <Info size={14} style={{ flex: 'none', marginTop: 2 }} />
          <span>
            Divide o botão <strong style={{ color: 'var(--text-2)' }}>{triggerLabel(action.trigger)}</strong> com {shared.map((a) => a.macro.name).join(', ')}.
            {action.enabled ? ' Ativar a outra desativa esta.' : activeOther ? ` Ativar esta desativa ${activeOther.macro.name}.` : ''}
          </span>
        </div>
      )}
    </article>
  );
}

export function AcoesPage() {
  const actions = useApp((s) => s.actions);
  const helper = useApp((s) => s.helper);
  const [confirmReset, setConfirmReset] = useState(false);
  const enabledCount = actions.actions.filter((a) => a.enabled).length;

  return (
    <div className="page">
      {!helper && (
        <Notice tone="warn"><strong>Helper desconectado.</strong> As ações são executadas pelo Helper local. Abra o help.bat e deixe a janela aberta; a configuração é enviada automaticamente.</Notice>
      )}
      <Notice>
        Cada botão do mouse dispara <strong>no máximo uma ação ativa</strong> (duas no mesmo botão rodariam juntas).
        Clique no botão de uma ação para trocá-lo. Os passos seguem exatamente a configuração do BOPE.
      </Notice>

      {ACTION_GROUPS.map((g) => (
        <section key={g} className="col" style={{ gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="eyebrow">{g}</div>
            <span className="faint" style={{ fontSize: 12 }}>
              {actions.actions.filter((a) => a.group === g && a.enabled).length} de {actions.actions.filter((a) => a.group === g).length} ativas
            </span>
          </div>
          <div className="grid grid-2">
            {actions.actions.filter((a) => a.group === g).map((a) => <ActionCard key={a.id} action={a} />)}
          </div>
        </section>
      ))}

      <Card title="Controle" icon={<Square size={18} />}>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 16 }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <span className="field-label">Tecla de parada</span>
            <KeyCapture value={actions.stopKey} onChange={(c) => store.setStopKey(c)} allowScroll={false} label="Tecla de parada" />
            <span className="faint" style={{ fontSize: 12.5 }}>Para todas as ações em andamento.</span>
          </div>
          <div className="row wrap">
            <Button icon={<Square />} disabled={!helper} onClick={() => void store.stopActions()}>Parar tudo agora</Button>
            <Button variant="ghost" icon={<RotateCcw />} onClick={() => setConfirmReset(true)}>Restaurar padrão</Button>
          </div>
        </div>
        <p className="faint" style={{ margin: '12px 0 0', fontSize: 12.5 }}>{enabledCount} de {actions.actions.length} ações ativas.</p>
      </Card>

      {confirmReset && (
        <Confirm title="Restaurar ações" confirmLabel="Restaurar padrão" onConfirm={() => store.resetActions()} onClose={() => setConfirmReset(false)}>
          <p style={{ margin: 0 }}>Volta os botões e o estado (ativa/inativa) das cinco ações para o padrão. Os passos das ações não mudam.</p>
        </Confirm>
      )}
    </div>
  );
}
