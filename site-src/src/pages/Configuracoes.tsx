import { Activity, Cpu, Database, HardDrive, RefreshCw, Trash2 } from 'lucide-react';
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
            <Chip tone={o.tone}>{o.label}</Chip>
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

      <DiagnosticCard />

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

const KIND_LABEL: Record<string, string> = {
  cors: 'CORS bloqueou a leitura da resposta',
  network: 'Sem conexão com o serviço',
  offline: 'Navegador sem internet',
  timeout: 'Tempo esgotado',
  http: 'Erro HTTP',
  empty: 'Resposta vazia',
  invalid: 'Resposta inválida',
  validation: 'Dados recusados na validação',
};

/** Resultado real da última requisição ao serviço de offsets (nada é inferido). */
/** Consulta /api/imtheo/_status: diz se o proxy (_worker.js) está ativo neste hosting. */
async function checkProxy(): Promise<{ ok: boolean; text: string }> {
  try {
    const res = await fetch('./api/imtheo/_status', { cache: 'no-store' });
    const isProxy = res.headers.get('x-bope-proxy') === '1';
    if (isProxy && res.ok) return { ok: true, text: 'Proxy do site ATIVO (_worker.js publicado). Se ainda houver erro, ele vem do serviço de offsets — veja a mensagem acima.' };
    const type = res.headers.get('content-type') ?? '';
    return { ok: false, text: `Proxy do site NÃO está ativo: /api/imtheo/_status respondeu HTTP ${res.status}${/html/i.test(type) ? ' com a página do site' : ''}. No Cloudflare Pages, confira se o zip enviado tem o arquivo _worker.js na raiz.` };
  } catch (e) {
    return { ok: false, text: `Não foi possível testar o proxy (${(e as Error).message}).` };
  }
}

function DiagnosticCard() {
  const d = useApp((s) => s.offsets.diagnostic);
  const [proxy, setProxy] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  return (
    <Card
      title="Diagnóstico da conexão"
      icon={<Activity size={18} />}
      actions={<Button size="sm" busy={testing} onClick={async () => { setTesting(true); setProxy(await checkProxy()); setTesting(false); }}>Testar proxy do site</Button>}
    >
      {proxy && <div style={{ marginBottom: 12 }}><Notice tone={proxy.ok ? 'ok' : 'warn'}>{proxy.text}</Notice></div>}
      {!d ? (
        <p className="muted" style={{ margin: 0 }}>Nenhuma consulta ao serviço ainda.</p>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          <Chip tone={d.ok ? 'ok' : 'err'}>{d.ok ? `✓ ${d.step}: OK` : `✕ ${d.step}: ${KIND_LABEL[d.kind ?? ''] ?? 'falha'}`}</Chip>
          <p style={{ margin: 0 }}>{d.message}</p>
          {d.info && (
            <dl className="kv">
              <dt>URL</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{d.info.url}</dd>
              <dt>Origem enviada</dt><dd className="mono">{d.info.origin}</dd>
              <dt>Rota</dt><dd>{d.info.via}</dd>
              <dt>Status HTTP</dt><dd className="mono">{d.info.status ?? (d.kind === 'cors' ? 'não legível (bloqueado por CORS)' : '—')}</dd>
              <dt>Tipo de conteúdo</dt><dd className="mono">{d.info.contentType ?? '—'}</dd>
              {d.info.redirectedTo && (<><dt>Redirecionado para</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{d.info.redirectedTo}</dd></>)}
              {d.info.sample && (<><dt>Início da resposta</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{d.info.sample}</dd></>)}
              <dt>Duração</dt><dd>{d.info.durationMs != null ? `${d.info.durationMs} ms` : '—'}</dd>
              <dt>Quando</dt><dd><Ago at={d.at} /></dd>
            </dl>
          )}
          {!d.ok && (
            <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
              Para conferir: abra as ferramentas do navegador (F12) → aba <strong>Network/Rede</strong> → clique em <strong>Verificar agora</strong> e selecione a requisição <span className="mono">version</span>.
              Erro de CORS aparece no Console como “blocked by CORS policy”.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
