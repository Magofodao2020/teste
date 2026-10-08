// Tradução do estado técnico em mensagens curtas para a interface (pt-BR).
// Funções puras: a mesma regra vale no topo, no Painel e nas páginas.

import type { HelperStatus } from '../core/helper/client';
import type { OffsetState } from '../core/offsets/service';

export type StatusTone = 'ok' | 'warn' | 'err' | 'busy' | 'neutral';
export interface StatusInfo { tone: StatusTone; label: string; detail: string }

export function helperStatus(helper: HelperStatus | null, checked: boolean): StatusInfo {
  if (!checked) return { tone: 'busy', label: 'Procurando Helper…', detail: 'Verificando o Helper local nesta máquina.' };
  if (!helper) {
    return { tone: 'err', label: 'Helper desconectado', detail: 'Abra o help.bat (node 626.js) e deixe a janela aberta. Sem ele, as ações e a aplicação no Roblox não funcionam.' };
  }
  if (helper.platform !== 'win32' || !helper.ffiReady) {
    return { tone: 'warn', label: 'Helper sem acesso ao Windows', detail: 'O Helper está aberto, mas só funciona no Windows com as dependências instaladas (npm install).' };
  }
  return { tone: 'ok', label: 'Helper conectado', detail: `Helper ${helper.helperVersion} na porta ${helper.port}.` };
}

export function robloxStatus(helper: HelperStatus | null): StatusInfo {
  if (!helper) return { tone: 'neutral', label: 'Roblox: sem Helper', detail: 'O Helper identifica o Roblox em execução.' };
  const det = helper.detection;
  if (helper.runningBuild && det?.state === 'running') {
    return { tone: 'ok', label: 'Roblox em execução', detail: `Versão em execução: ${helper.runningBuild}` };
  }
  if (det?.state === 'not-running' || !helper.robloxFound) {
    return { tone: 'warn', label: 'Roblox não está em execução', detail: 'Abra o Roblox e entre em um jogo.' };
  }
  return { tone: 'warn', label: 'Não foi possível identificar a versão do Roblox', detail: det?.reason || 'Não foi possível identificar a versão do Roblox.' };
}

/** Causa curta da última falha (vem do diagnóstico real da requisição). */
export function failureCause(o: OffsetState): string {
  const d = o.diagnostic;
  if (!d || d.ok) return '';
  return d.message.replace(/\.$/, '');
}

export function offsetStatus(o: OffsetState): StatusInfo {
  const v = o.dataset?.version;
  const cause = failureCause(o);
  switch (o.status) {
    case 'loading':
      return { tone: 'busy', label: 'Carregando offsets…', detail: 'Preparando os dados do site.' };
    case 'checking':
      return { tone: 'busy', label: 'Verificando versão LIVE…', detail: v ? `Consultando o serviço. Até confirmar, o dataset ${v} NÃO é considerado atual.` : 'Consultando a versão LIVE publicada.' };
    case 'updating':
      return { tone: 'busy', label: 'Atualizando offsets...', detail: `Versão LIVE ${o.liveVersion} verificada. Baixando e validando os offsets.` };
    case 'ready':
      return { tone: 'ok', label: '✓ Versão LIVE verificada', detail: `${v} · Offsets atualizados.` };
    case 'outdated':
      return { tone: 'warn', label: '⚠ Offsets desatualizados', detail: `Versão LIVE ${o.liveVersion} verificada, mas não foi possível atualizar os offsets${cause ? ` (${cause})` : ''}. Os dados atuais (${v}) foram mantidos para evitar uma configuração inválida — eles NÃO são da versão atual.` };
    case 'offline':
      return { tone: 'warn', label: '⚠ Versão LIVE não verificada', detail: `Não foi possível consultar o serviço${cause ? ` (${cause})` : ''}. Usando o último dataset válido: ${v} — a versão atual não foi confirmada.` };
    case 'unavailable':
    default:
      return { tone: 'err', label: '✕ Não foi possível carregar os offsets', detail: `As funções que dependem deles estão indisponíveis.${cause ? ` Causa: ${cause}.` : ''}` };
  }
}

/** Offsets do site × Roblox que está rodando (o Helper bloqueia se diferirem). */
export function compatStatus(o: OffsetState, helper: HelperStatus | null): StatusInfo {
  const ds = o.dataset?.version ?? null;
  const running = helper?.runningBuild ?? null;
  if (!ds) return { tone: 'err', label: 'Sem offsets', detail: 'Não foi possível carregar os offsets. As funções que dependem deles estão indisponíveis.' };
  if (!running) return { tone: 'neutral', label: 'Aguardando o Roblox', detail: 'A compatibilidade é conferida quando o Helper identifica o Roblox em execução.' };
  if (running === ds) return { tone: 'ok', label: 'Compatível', detail: `Roblox em execução e offsets na mesma versão (${ds}).` };
  const live = o.liveVersion;
  if (live && ds === live && running !== live) {
    return { tone: 'err', label: 'Versão incompatível', detail: `Seu Roblox está em ${running}, mas a versão LIVE é ${live}. Atualize o Roblox (feche e abra de novo).` };
  }
  return { tone: 'err', label: 'Versão incompatível', detail: `Roblox em execução: ${running} · offsets do site: ${ds}. A aplicação fica bloqueada até as versões baterem.` };
}
