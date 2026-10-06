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

export function offsetStatus(o: OffsetState): StatusInfo {
  const v = o.dataset?.version;
  switch (o.status) {
    case 'loading':
      return { tone: 'busy', label: 'Carregando offsets…', detail: 'Preparando os dados do site.' };
    case 'checking':
      return { tone: 'busy', label: 'Verificando versão…', detail: v ? `Usando ${v} enquanto verifica a versão LIVE.` : 'Consultando a versão LIVE publicada.' };
    case 'updating':
      return { tone: 'busy', label: 'Atualizando offsets...', detail: `Baixando os offsets de ${o.liveVersion}.` };
    case 'ready':
      return { tone: 'ok', label: 'Atualizados', detail: `Offsets de ${v}, a versão LIVE atual.` };
    case 'outdated':
      return { tone: 'warn', label: 'Não foi possível atualizar os offsets.', detail: `Os dados atuais (${v}) foram mantidos para evitar uma configuração inválida.` };
    case 'offline':
      return { tone: 'warn', label: 'Versão LIVE não verificada', detail: `Sem resposta do serviço de versão. Usando o último dataset válido (${v}).` };
    case 'unavailable':
    default:
      return { tone: 'err', label: 'Não foi possível carregar os offsets.', detail: 'As funções que dependem deles estão indisponíveis.' };
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
