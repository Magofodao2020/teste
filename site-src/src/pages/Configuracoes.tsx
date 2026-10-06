import { Cpu, Database, HardDrive, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { HELPER_PORTS } from '../core/helper/client';
import { LIVE_VERSION_URL } from '../core/offsets/service';
import { deleteAllSiteData } from '../core/storage/db';
import { helperStatus, offsetStatus } from '../state/status';
import { store, useApp } from '../state/store';
import { Ago, Button, Card, Chip, Confirm, Notice } from '../ui/components';

const SOURCE_LABEL = { cache: 'cache do navegador', site: 'dados publicados com o site', remote: 'serviço de offsets (download)' } as const;

export function ConfigPage() {
  const helper = useApp((s) => s.helper);
  const checked = useApp((s) => s.helperChecked);
  const offsets = useApp((s) => s.offsets);
  const persistent = useApp((s) => s.storagePersistent);
  const [searching, setSearching] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const h = helperStatus(helper, checked);
  const o = offsetStatus(offsets);
  const busyOffsets = offsets.status === 'checking' || offsets.status === 'updating';

  return (
    <div className="page">
      <div className="grid grid-2">
        <Card title="Helper local" icon={<Cpu size={18} />}>
          <div className="col" style={{ gap: 14 }}>
            <Chip tone={h.tone}>{h.label}</Chip>
            <dl className="kv">
              <dt>Endereço</dt><dd className="mono">{helper ? `127.0.0.1:${helper.port}` : `127.0.0.1:${HELPER_PORTS[0]}–${HELPER_PORTS[HELPER_PORTS.length - 1]}`}</dd>
              <dt>Versão do Helper</dt><dd>{helper?.helperVersion ?? '—'}</dd>
              <dt>Roblox em execução</dt><dd className="mono">{helper?.runningBuild ?? '—'}</dd>
              <dt>Offsets no Helper</dt><dd className="mono">{helper?.siteOffsetsBuild ?? '—'}</dd>
            </dl>
            <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
              O Helper roda só na sua máquina, sem internet e sem gravar nada no PC. Ele recebe deste site os offsets, as ações e os atalhos, e mantém tudo apenas em memória.
            </p>
            <div>
              <Button icon={<RefreshCw />} busy={searching} onClick={async () => { setSearching(true); const st = await store.pollHelper(); setSearching(false); store.toast(st ? 'success' : 'info', st ? 'Helper conectado.' : 'Helper não encontrado. Abra o help.bat.'); }}>
                Procurar Helper
              </Button>
            </div>
          </div>
        </Card>

        <Card title="Offsets" icon={<Database size={18} />}>
          <div className="col" style={{ gap: 14 }}>
            <Chip tone={o.tone === 'ok' ? 'ok' : o.tone}>{o.tone === 'ok' ? '✓ Atualizados' : o.label}</Chip>
            <dl className="kv">
              <dt>Versão atual (LIVE)</dt><dd className="mono">{offsets.liveVersion ?? '—'}</dd>
              <dt>Dataset em uso</dt><dd className="mono">{offsets.dataset?.version ?? '—'}</dd>
              <dt>Origem</dt><dd>{offsets.source ? SOURCE_LABEL[offsets.source] : '—'}</dd>
              <dt>Verificado</dt><dd><Ago at={offsets.liveCheckedAt} /></dd>
            </dl>
            <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
              A versão é definida automaticamente pela versão LIVE publicada em <span className="mono">{new URL(LIVE_VERSION_URL).host}</span>, verificada ao abrir o site e a cada 30 minutos.
              Os offsets só são baixados quando a versão muda; um download inválido nunca substitui os dados atuais.
            </p>
            {offsets.error && offsets.status !== 'ready' && <Notice tone={offsets.status === 'unavailable' ? 'err' : 'warn'}>{offsets.error}</Notice>}
            <div>
              <Button icon={<RefreshCw />} busy={busyOffsets} onClick={() => void store.offsets?.refresh()}>Verificar agora</Button>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Dados deste navegador" icon={<HardDrive size={18} />}>
        <div className="col" style={{ gap: 12 }}>
          {!persistent && <Notice tone="warn">O navegador bloqueou o armazenamento local. Presets e cache valem só enquanto esta aba estiver aberta.</Notice>}
          <p className="muted" style={{ margin: 0 }}>
            Presets, atalhos, ações e o cache de offsets ficam salvos apenas neste navegador. Apagar remove tudo isso daqui; o Helper não guarda nada.
          </p>
          <div><Button variant="danger" icon={<Trash2 />} onClick={() => setConfirmWipe(true)}>Apagar dados do site</Button></div>
        </div>
      </Card>

      {confirmWipe && (
        <Confirm
          title="Apagar dados do site"
          danger
          confirmLabel="Apagar tudo"
          onClose={() => setConfirmWipe(false)}
          onConfirm={async () => { store.dispose(); await deleteAllSiteData(); location.reload(); }}
        >
          <p style={{ margin: 0 }}>Remove todos os presets, atalhos, configurações das ações e o cache de offsets deste navegador. Não dá para desfazer.</p>
        </Confirm>
      )}
    </div>
  );
}
