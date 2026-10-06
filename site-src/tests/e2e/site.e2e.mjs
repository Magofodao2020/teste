// Testes ponta a ponta do site real (dist/) no Chromium, com o Helper simulado e
// as respostas do serviço de offsets simuladas por cenário.
// Rodar: npm run build && npm run test:e2e
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { extname, join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { startMockHelper } from './mock-helper.mjs';
import { CHROMIUM_ARGS, FAKE_PORT, startFakeImtheo } from './fake-imtheo.mjs';

const DIST = resolve('dist');
const SITE_PORT = 8833;
const SITE = `http://127.0.0.1:${SITE_PORT}/`;
const LIVE_URL = 'https://offsets.imtheo.lol/roblox/version';
const OFFSETS_URL = 'https://offsets.imtheo.lol/offsets.json';
const HPP_URL = 'https://offsets.imtheo.lol/FFlags.hpp';
const V_SITE = 'version-cec3ad5889b447cf';
const V_OLD = 'version-02c37bc51a384b8f';
const V_NEW = 'version-bbbbbbbbbbbbbbbb';
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const USER_PACK = JSON.parse(readFileSync(new URL('../unit/user-pack.json', import.meta.url), 'utf8'));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
// Hosting de teste. Sem proxy = comportamento de hosting estático (404 em /api).
// Com proxy = igual ao _worker.js/_redirects: repassa ao serviço (lado servidor, sem CORS).
let proxyEnabled = false;
function startStatic() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.startsWith('/api/imtheo/')) {
      const path = p.slice('/api/imtheo/'.length);
      if (!proxyEnabled || !['roblox/version', 'offsets.json', 'FFlags.hpp'].includes(path)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not Found'); }
      const up = https.request({ host: '127.0.0.1', port: FAKE_PORT, path: '/' + path, servername: 'offsets.imtheo.lol', rejectUnauthorized: false }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => { res.writeHead(r.statusCode, { 'Content-Type': r.headers['content-type'] ?? 'text/plain', 'X-Bope-Proxy': '1' }); res.end(Buffer.concat(chunks)); });
      });
      up.on('error', () => { res.writeHead(502); res.end('erro'); });
      return up.end();
    }
    if (p.endsWith('/')) p += 'index.html';
    const file = join(DIST, p);
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(SITE_PORT, '127.0.0.1', () => r(server)));
}

function flagsGroup(n = 700) {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`NovaFlag${i}`, 0x300000 + i * 8]));
}
function offsetsJson(version, withFlags = true) {
  const Offsets = { Humanoid: { Health: 404, MaxHealth: 436, Walkspeed: 476, JumpPower: 432 } };
  if (withFlags) Offsets.FFlags = flagsGroup();
  return JSON.stringify({ Source: 'https://imtheo.lol/Offsets', 'Roblox Version': version, 'Dumper Version': '2.2.4', 'Dumped At': '02:17 27/05/2026', 'Total Offsets': 4, Offsets });
}

let browser, staticServer, helper;
const counts = {};

/** Abre o site com as rotas do serviço de offsets definidas pelo cenário. */
async function open(routes, { context, viewport } = {}) {
  const ctx = context ?? await browser.newContext({ viewport: viewport ?? { width: 1360, height: 900 } });
  for (const k of Object.keys(counts)) delete counts[k];
  await ctx.route('https://offsets.imtheo.lol/**', async (route) => {
    const url = route.request().url();
    counts[url] = (counts[url] ?? 0) + 1;
    const r = routes[url];
    if (!r || r === 'fail') return route.abort('internetdisconnected');
    return route.fulfill({ status: r.status ?? 200, body: r.body, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' } });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(SITE);
  await page.waitForSelector('.topbar', { timeout: 15000 });
  return { ctx, page, errors };
}

async function waitFor(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('tempo esgotado esperando condição');
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  assert.ok(existsSync(join(DIST, 'index.html')), 'rode npm run build antes');
  staticServer = await startStatic();
  browser = await chromium.launch({ executablePath: EXECUTABLE });
});
after(async () => {
  await browser?.close();
  await new Promise((r) => staticServer.close(r));
});
beforeEach(async () => {
  await helper?.close();
  helper = await startMockHelper({ running: V_SITE });
});

describe('versão automática e offsets', () => {
  it('versão LIVE igual ao dataset do site: offsets atualizados, nenhum download externo', async () => {
    const { page, ctx, errors } = await open({ [LIVE_URL]: { body: V_SITE } });
    await page.getByText('✓ Versão LIVE verificada').first().waitFor();
    assert.equal(counts[OFFSETS_URL] ?? 0, 0);
    assert.equal(counts[LIVE_URL], 1);
    // Helper recebe o dataset, com prefixos de tipo nos nomes
    const off = await waitFor(() => helper.state.offsets);
    assert.equal(off.version, V_SITE);
    assert.equal(off.count, 14858);
    assert.ok(off.names.includes('DFIntTaskSchedulerTargetFps') || off.names.includes('TaskSchedulerTargetFps'));
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it('nada de offsets gravado no computador: ao reabrir consulta de novo; na mesma aba, não repete download', async () => {
    const ctx = await browser.newContext();
    const first = await open({ [LIVE_URL]: { body: V_NEW }, [OFFSETS_URL]: { body: offsetsJson(V_NEW) } }, { context: ctx });
    await first.page.getByText('✓ Versão LIVE verificada').first().waitFor();
    assert.equal(counts[OFFSETS_URL], 1);
    // "Verificar agora" na mesma aba: versão igual → só a consulta de versão
    await first.page.goto(`${SITE}#/config`);
    await first.page.getByRole('button', { name: 'Verificar agora' }).click();
    await first.page.waitForTimeout(800);
    assert.equal(counts[OFFSETS_URL], 1, 'mesma aba reaproveita a memória');
    // nenhum dataset de offsets no IndexedDB nem no localStorage
    const stored = await first.page.evaluate(() => new Promise((r) => { const q = indexedDB.open('gerenciador'); q.onsuccess = () => { r({ stores: [...q.result.objectStoreNames], ls: JSON.stringify(localStorage) }); q.result.close(); }; }));
    assert.deepEqual(stored.stores, ['presets']);
    assert.doesNotMatch(stored.ls, /NovaFlag|0x3000/);
    // nova abertura: memória vazia → baixa de novo (nada ficou salvo)
    const again = await open({ [LIVE_URL]: { body: V_NEW }, [OFFSETS_URL]: { body: offsetsJson(V_NEW) } }, { context: ctx });
    await again.page.getByText('✓ Versão LIVE verificada').first().waitFor();
    assert.equal(counts[OFFSETS_URL], 1);
    await ctx.close();
  });

  it('versão nova: baixa offsets.json, valida e envia ao Helper', async () => {
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_NEW }, [OFFSETS_URL]: { body: offsetsJson(V_NEW) } });
    await page.getByText('✓ Versão LIVE verificada').first().waitFor();
    assert.equal(counts[OFFSETS_URL], 1);
    assert.equal(counts[HPP_URL] ?? 0, 0);
    await waitFor(() => helper.state.offsets?.version === V_NEW);
    assert.equal(helper.state.offsets.count, 700);
    // Roblox (V_SITE) ≠ offsets (V_NEW): o site avisa para atualizar o Roblox
    await page.getByText('Versões diferentes').waitFor();
    await ctx.close();
  });

  it('offsets.json sem FFlags: completa com FFlags.hpp da mesma versão', async () => {
    const hpp = `/*  Roblox Version  : ${V_NEW}\n*/\nnamespace FFlagOffsets {\n${Object.entries(flagsGroup()).map(([k, v]) => `inline constexpr uintptr_t ${k} = 0x${v.toString(16)};`).join('\n')}\n}`;
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_NEW }, [OFFSETS_URL]: { body: offsetsJson(V_NEW, false) }, [HPP_URL]: { body: hpp } });
    await page.getByText('✓ Versão LIVE verificada').first().waitFor();
    assert.equal(counts[HPP_URL], 1);
    await ctx.close();
  });

  it('sem internet: mantém o último dataset válido e informa', async () => {
    const { page, ctx } = await open({ [LIVE_URL]: 'fail' });
    await page.getByText('Versão LIVE não verificada').first().waitFor();
    await page.getByText(V_SITE).first().waitFor();
    await waitFor(() => helper.state.offsets?.version === V_SITE);
    await ctx.close();
  });

  it('JSON inválido/parcial: não substitui o dataset atual', async () => {
    const partial = offsetsJson(V_NEW).slice(0, 300);
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_NEW }, [OFFSETS_URL]: { body: partial } });
    await page.getByText('⚠ Offsets desatualizados').first().waitFor();
    await page.getByText(/não foi possível atualizar os offsets/).first().waitFor();
    await page.getByText(/Os dados atuais \(version-cec3ad5889b447cf\) foram mantidos/).first().waitFor();
    await waitFor(() => helper.state.offsets?.version === V_SITE);
    await ctx.close();
  });

  it('não existe seletor manual de versão em nenhuma página', async () => {
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_SITE } });
    for (const r of ['painel', 'acoes', 'presets', 'catalogo', 'config']) {
      await page.goto(`${SITE}#/${r}`);
      await page.waitForTimeout(400);
      const versionSelects = await page.evaluate(() => [...document.querySelectorAll('select')].filter((s) => [...s.options].some((o) => /version-/.test(o.textContent ?? ''))).length);
      assert.equal(versionSelects, 0, `seletor de versão em ${r}`);
      const text = await page.locator('body').innerText();
      assert.doesNotMatch(text, /selecionar versão|forçar versão|AHK/i, `texto proibido em ${r}`);
    }
    await ctx.close();
  });
});

describe('ações e macros', () => {
  const row = (page, name) => page.locator('article.macro-row', { has: page.locator('.macro-name', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });
  const enabledIds = () => (helper.state.macros ?? []).filter((m) => m.enabled).map((m) => m.id).sort();

  it('estado inicial: modelos disponíveis e NENHUMA ação ativa; ativar/desativar uma; ativar todas; desativar todas', async () => {
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_SITE } });
    await page.goto(`${SITE}#/acoes`);
    assert.deepEqual(await page.locator('.macro-name').allInnerTexts(), ['Bug Indi', 'Bug indi ESQUERDA', 'Bug indi DIREITA', 'Perfect Dive', 'Gagatech']);
    assert.equal(await page.getByText('○ Desativada').count(), 5);
    assert.equal(await page.getByText('● Ativa').count(), 0);
    const macros = await waitFor(() => helper.state.macros);
    assert.equal(macros.filter((m) => m.enabled).length, 0, 'nada ativo no Helper');
    macros.forEach((m, i) => {
      const { bope, v, ...fields } = USER_PACK.macros[i];
      assert.deepEqual({ name: m.name, mode: m.mode, repeat: m.repeat, loopDelay: m.loopDelay, speed: m.speed, robloxOnly: m.robloxOnly, steps: m.steps, trigger: m.trigger }, fields);
    });

    await row(page, 'Perfect Dive').getByRole('button', { name: 'Ativar', exact: true }).click();
    await waitFor(() => enabledIds().join() === 'perfect-dive');
    assert.equal(await row(page, 'Perfect Dive').getByText('● Ativa').count(), 1);
    await row(page, 'Perfect Dive').getByRole('button', { name: 'Desativar', exact: true }).click();
    await waitFor(() => enabledIds().length === 0);

    await page.getByRole('button', { name: 'Ativar todas', exact: true }).click();
    await waitFor(() => enabledIds().length === 5);
    assert.equal(await page.getByText('● Ativa').count(), 5);
    assert.equal(await page.getByRole('button', { name: 'Ativar todas', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Desativar todas', exact: true }).click();
    await waitFor(() => enabledIds().length === 0);
    assert.equal(await page.getByText('○ Desativada').count(), 5);

    // estado persiste no navegador (o Helper não guarda nada)
    await row(page, 'Gagatech').getByRole('button', { name: 'Ativar', exact: true }).click();
    await page.reload(); await page.waitForSelector('.topbar');
    await page.goto(`${SITE}#/acoes`);
    assert.equal(await row(page, 'Gagatech').getByText('● Ativa').count(), 1);
    await ctx.close();
  });

  it('criar, editar (reordenar/arrastar/duplicar/remover etapas), salvar desativada, duplicar e excluir', async () => {
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_SITE } });
    await page.goto(`${SITE}#/acoes`);
    await page.getByRole('button', { name: 'Criar ação' }).click();
    await page.getByText('Nova ação').first().waitFor();
    await page.getByLabel('Nome da ação').fill('Minha Macro');
    await page.getByRole('button', { name: 'Botão que ativa' }).click();
    await page.waitForTimeout(200);
    await page.keyboard.press('F6');

    // Etapa 1: tecla Space hold 30 · Etapa 2: esperar 50 · Etapa 3: tecla Q hold 30
    const addStep = async (type) => { await page.getByLabel('Tipo da nova etapa').selectOption(type); await page.getByRole('button', { name: 'Adicionar etapa' }).click(); };
    await addStep('key');
    await page.getByRole('button', { name: 'Tecla da etapa' }).nth(0).click(); await page.waitForTimeout(200); await page.keyboard.press('Space');
    await page.getByLabel('Segurar').nth(0).fill('30');
    await addStep('wait');
    await page.getByLabel('Esperar', { exact: true }).fill('50');
    await addStep('key');
    await page.getByRole('button', { name: 'Tecla da etapa' }).nth(1).click(); await page.waitForTimeout(200); await page.keyboard.press('KeyQ');
    await page.getByLabel('Segurar').nth(1).fill('30');
    // duplicar e remover a etapa 3, subir/descer, arrastar
    await page.getByRole('button', { name: 'Duplicar etapa 3' }).click();
    assert.equal(await page.locator('.step-card').count(), 4);
    await page.getByRole('button', { name: 'Remover etapa 4' }).click();
    await page.getByRole('button', { name: 'Descer etapa 1' }).click();
    await page.getByRole('button', { name: 'Subir etapa 2' }).click();
    await page.locator('.step-card').nth(2).dragTo(page.locator('.step-card').nth(0));
    await page.locator('.step-card').nth(0).dragTo(page.locator('.step-card').nth(2));
    await page.getByRole('button', { name: 'Salvar' }).click();
    await page.getByText('Ação "Minha Macro" criada · Status: desativada.').waitFor();

    const sent = await waitFor(() => helper.state.macros?.find((m) => m.name === 'Minha Macro'));
    assert.equal(sent.enabled, false);
    assert.equal(sent.trigger, 'F6');
    assert.deepEqual(sent.steps, [{ t: 'key', code: 'Space', n: 1, hold: 30, gap: 60 }, { t: 'wait', ms: 50 }, { t: 'key', code: 'KeyQ', n: 1, hold: 30, gap: 60 }]);
    assert.equal(await row(page, 'Minha Macro').getByText('○ Desativada').count(), 1);

    // editar: renomear e alterar o modo
    await row(page, 'Minha Macro').getByRole('button', { name: 'Editar' }).click();
    await page.getByLabel('Nome da ação').fill('Minha Macro 2');
    await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Loop (liga/desliga)' }).click();
    await page.getByRole('button', { name: 'Salvar' }).click();
    await waitFor(() => helper.state.macros?.some((m) => m.name === 'Minha Macro 2' && m.mode === 'loop'));

    // duplicar e excluir
    await row(page, 'Minha Macro 2').getByRole('button', { name: 'Duplicar Minha Macro 2' }).click();
    await row(page, 'Minha Macro 2 (cópia)').waitFor();
    await row(page, 'Minha Macro 2 (cópia)').getByRole('button', { name: 'Excluir Minha Macro 2 (cópia)' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click();
    await waitFor(() => !helper.state.macros?.some((m) => m.name === 'Minha Macro 2 (cópia)'));

    // validação: sem etapas não salva
    await page.getByRole('button', { name: 'Criar ação' }).click();
    await page.getByRole('button', { name: 'Salvar' }).click();
    await page.getByText('Adicione pelo menos uma etapa.').waitFor();
    await ctx.close();
  });

  it('gravar macro: gravando → parar → revisar no editor → salvar desativada', async () => {
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_SITE } });
    await page.goto(`${SITE}#/acoes`);
    await waitFor(() => helper.state.macros);
    await page.getByRole('button', { name: 'Gravar macro' }).click();
    await page.getByRole('button', { name: 'Começar a gravar' }).click();
    await page.getByText('● Gravando...').waitFor();
    await page.getByRole('button', { name: 'Parar gravação' }).click();
    await page.getByText(/Gravação com 3 etapas/).waitFor();
    assert.equal(await page.locator('.step-card').count(), 3);
    await page.getByRole('button', { name: 'Botão que ativa' }).click(); await page.waitForTimeout(200); await page.keyboard.press('F7');
    await page.getByRole('button', { name: 'Salvar' }).click();
    const rec = await waitFor(() => helper.state.macros?.find((m) => m.name.startsWith('Gravação')));
    assert.equal(rec.enabled, false);
    assert.deepEqual(rec.steps.map((s) => s.t), ['key', 'click', 'scroll']);
    assert.equal(helper.state.posts.find((p) => p.path === '/macro/record/start').data.countdown, 3000);
    await ctx.close();
  });

  it('modelos, importar e exportar (sempre desativadas, sem AHK)', async () => {
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_SITE } });
    await page.goto(`${SITE}#/acoes`);
    await row(page, 'Bug Indi').getByRole('button', { name: 'Excluir Bug Indi' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click();
    await page.getByRole('button', { name: 'Modelos' }).click();
    await page.getByRole('dialog').locator('.list-row', { hasText: 'Bug Indi' }).first().getByRole('button', { name: 'Adicionar' }).click();
    await page.keyboard.press('Escape');
    await row(page, 'Bug Indi').waitFor();
    assert.equal(await row(page, 'Bug Indi').getByText('○ Desativada').count(), 1);

    await page.getByRole('button', { name: 'Importar' }).click();
    const pack = { bope: 'macro-pack', v: 1, macros: [{ bope: 'macro', v: 1, name: 'Importada', trigger: 'KeyH', steps: [{ t: 'text', text: 'gg', gap: 20 }] }, { bope: 'macro', v: 1, name: 'Flick Up (AHK)', steps: [{ t: 'flick' }] }] };
    await page.getByLabel('Dados para importar').fill(JSON.stringify(pack));
    await page.getByRole('button', { name: /Importar 1 \(desativadas\)/ }).click();
    await row(page, 'Importada').waitFor();
    assert.equal(await page.getByText('Flick Up (AHK)').count(), 0);
    const imp = await waitFor(() => helper.state.macros?.find((m) => m.name === 'Importada'));
    assert.equal(imp.enabled, false);

    await page.getByRole('button', { name: 'Exportar todas' }).click();
    const json = JSON.parse(await page.getByLabel('JSON exportado').inputValue());
    assert.equal(json.bope, 'macro-pack');
    assert.ok(json.macros.every((m) => !('enabled' in m)));
    await ctx.close();
  });

  it('Helper reiniciado recebe offsets, ações e atalhos de novo', async () => {
    const { ctx } = await open({ [LIVE_URL]: { body: V_SITE } });
    await waitFor(() => helper.state.offsets && helper.state.macros);
    helper.restart();
    await waitFor(() => helper.state.offsets && helper.state.macros && helper.state.hotkeys, 12000);
    await ctx.close();
  });
});

describe('CORS real (servidor HTTPS no lugar de offsets.imtheo.lol)', () => {
  let corsBrowser, fake;
  before(async () => {
    fake = await startFakeImtheo();
    corsBrowser = await chromium.launch({ executablePath: EXECUTABLE, args: CHROMIUM_ARGS });
  });
  after(async () => { proxyEnabled = false; await corsBrowser?.close(); await fake?.close(); });

  async function openReal(path = 'painel') {
    const ctx = await corsBrowser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${SITE}#/${path}`);
    await page.waitForSelector('.topbar');
    return { ctx, page };
  }

  it('servidor sem Access-Control-Allow-Origin e hosting estático: "CORS bloqueou a leitura da resposta" + fallback claro', async () => {
    proxyEnabled = false;
    fake.state.routes = { '/roblox/version': { body: 'version-cec3ad5889b447cf\n', cors: false } };
    fake.state.hits = [];
    const { ctx, page } = await openReal('config');
    const diag = page.locator('section.card', { hasText: 'Diagnóstico da conexão' });
    await diag.getByText('CORS bloqueou a leitura da resposta').first().waitFor();
    await diag.getByText(`não autoriza a origem ${SITE.replace(/\/$/, '')}`, { exact: false }).waitFor();
    await diag.getByText(/O proxy do site \(\/api\/imtheo\/\) não está ativo/).waitFor();
    assert.ok(fake.state.hits.some((h) => h.mode === 'cors' && h.origin === SITE.replace(/\/$/, '')), 'a requisição saiu com Origin');
    assert.ok(fake.state.hits.some((h) => h.mode === 'no-cors'), 'sonda no-cors confirmou a resposta');
    await page.goto(`${SITE}#/painel`);
    await page.getByText('⚠ Versão LIVE não verificada').first().waitFor();
    await page.getByText('não confirmado como atual').waitFor();
    await page.getByText(/Usando o último dataset válido: version-cec3ad5889b447cf/).first().waitFor();
    await ctx.close();
  });

  it('servidor sem CORS, mas hosting com proxy (/api/imtheo): verifica a versão e baixa offsets.json pelo proxy', async () => {
    proxyEnabled = true;
    fake.state.routes = {
      '/roblox/version': { body: V_NEW, cors: false },
      '/offsets.json': { body: offsetsJson(V_NEW), cors: false, type: 'application/json' },
    };
    const { ctx, page } = await openReal('painel');
    await page.getByText('✓ Versão LIVE verificada').first().waitFor();
    await waitFor(() => helper.state.offsets?.version === V_NEW);
    await page.goto(`${SITE}#/config`);
    await page.getByText('proxy do site').first().waitFor();
    await ctx.close();
    proxyEnabled = false;
  });

  it('proxy ativo, mas o serviço responde 404: diagnóstico aponta o serviço (não o hosting)', async () => {
    proxyEnabled = true;
    fake.state.routes = {};
    const { ctx, page } = await openReal('config');
    const diag = page.locator('section.card', { hasText: 'Diagnóstico da conexão' });
    await diag.getByText(/O proxy do site está ativo, mas offsets.imtheo.lol respondeu HTTP 404 para \/roblox\/version/).first().waitFor();
    await ctx.close();
    proxyEnabled = false;
  });

  it('servidor com CORS: leitura direta, sem proxy', async () => {
    fake.state.routes = { '/roblox/version': { body: 'version-cec3ad5889b447cf', cors: true } };
    fake.state.hits = [];
    const { ctx, page } = await openReal('painel');
    await page.getByText('✓ Versão LIVE verificada').first().waitFor();
    assert.ok(!fake.state.hits.some((h) => h.mode === 'no-cors'));
    await ctx.close();
  });

  it('HTTP 500 e resposta inválida têm diagnóstico próprio', async () => {
    for (const [route, rx] of [[{ status: 500, body: 'erro interno', cors: true }, /HTTP 500/], [{ body: '<html>manutenção</html>', cors: true, type: 'text/html' }, /não é uma versão válida/]]) {
      fake.state.routes = { '/roblox/version': route };
      const { ctx, page } = await openReal('config');
      await page.locator('section.card', { hasText: 'Diagnóstico da conexão' }).getByText(rx).first().waitFor();
      await ctx.close();
    }
  });
});

describe('presets e flags inválidas', () => {
  it('importar, detectar inválidas, cancelar e remover só as inválidas; aplicar envia ao Helper', async () => {
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_SITE } });
    await page.goto(`${SITE}#/presets`);
    await page.getByRole('button', { name: 'Importar JSON' }).click();
    const json = { name: 'Teste', flags: { DFIntTaskSchedulerTargetFps: 240, FFlagAbuseReport: true, FFlagNaoExisteMais123: true, DFIntSumiuDoDump: 5 } };
    await page.getByLabel('JSON', { exact: true }).fill(JSON.stringify(json));
    await page.getByRole('button', { name: 'Criar novo preset' }).click();
    await page.getByText('2 flags deste preset não existem no dump atual.').waitFor();

    await page.getByRole('button', { name: 'Remover flags inválidas' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByText('configurações inválidas encontradas.').waitFor();
    assert.equal(await dlg.locator('.big-number').innerText(), '2');
    await dlg.getByRole('button', { name: 'Cancelar' }).click();
    await page.getByText('2 flags deste preset não existem no dump atual.').waitFor();

    await page.getByRole('button', { name: 'Remover flags inválidas' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remover configurações inválidas' }).click();
    await page.getByText('2 configurações inválidas removidas.').waitFor();
    const rows = await page.locator('.list-row .mono').allInnerTexts();
    assert.deepEqual(rows.sort(), ['DFIntTaskSchedulerTargetFps', 'FFlagAbuseReport']);

    // persistiu no navegador (recarregar mantém)
    await page.reload();
    await page.waitForSelector('.topbar');
    await page.goto(`${SITE}#/presets`);
    await page.getByText('Teste').first().waitFor();
    assert.equal(await page.locator('.list-row.invalid').count(), 0);

    await waitFor(() => helper.state.offsets?.version === V_SITE);
    await page.getByRole('button', { name: 'Aplicar no Roblox' }).click();
    await page.getByText('Todas as 2 configurações aplicadas na memória.').waitFor();
    const apply = helper.state.posts.find((p) => p.path === '/apply');
    assert.deepEqual(apply.data, { flags: { DFIntTaskSchedulerTargetFps: '240', FFlagAbuseReport: 'true' }, dumpVersion: V_SITE });
    await ctx.close();
  });

  it('migra presets e preferências do site antigo e descarta o AHK Flick e a versão escolhida', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await ctx.route('https://offsets.imtheo.lol/**', (r) => r.fulfill({ body: V_SITE, headers: { 'Access-Control-Allow-Origin': '*' } }));
    await page.goto(`${SITE}data/dumps/README.txt`);
    await page.evaluate(async () => {
      localStorage.setItem('gerenciador:prefs:v1', JSON.stringify({ activeDumpId: 'version-02c37bc51a384b8f', activePresetId: 'old-1', clientVersion: 'version-02c37bc51a384b8f' }));
      localStorage.setItem('gerenciador:macros:v1', JSON.stringify({ macros: [{ name: 'Flick Down (AHK)', category: 'AHK Flick', trigger: 'MouseBack' }] }));
      localStorage.setItem('gerenciador:hotkeys:v1', JSON.stringify({ FFlagAbuseReport: { toggleKey: 'F6' } }));
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('gerenciador', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of ['dumpMeta', 'dumpFlags', 'cache']) db.createObjectStore(s, { keyPath: s === 'cache' ? 'key' : 'id' });
          db.createObjectStore('presets', { keyPath: 'id' });
          db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        };
        req.onsuccess = () => {
          const tx = req.result.transaction('presets', 'readwrite');
          tx.objectStore('presets').put({ id: 'old-1', name: 'Meu preset antigo', robloxVersion: 'version-02c37bc51a384b8f', flags: { FFlagAbuseReport: false }, draft: { FFlagAbuseReport: true, DFIntTaskSchedulerTargetFps: 144 }, color: '#22c55e', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
          tx.oncomplete = () => { req.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    });
    await page.goto(`${SITE}#/presets`);
    await page.waitForSelector('.topbar');
    await page.getByRole('heading', { name: 'Meu preset antigo' }).waitFor();
    const rows = await page.locator('.list-row .mono').allInnerTexts();
    assert.deepEqual(rows.sort(), ['DFIntTaskSchedulerTargetFps', 'FFlagAbuseReport']);
    const ls = await page.evaluate(() => ({ prefs: localStorage.getItem('gerenciador:prefs:v1'), macros: localStorage.getItem('gerenciador:macros:v1'), hotkeys: localStorage.getItem('gerenciador:hotkeys:v1'), stores: null }));
    assert.equal(ls.prefs, null);
    assert.equal(ls.macros, null);
    assert.ok(ls.hotkeys.includes('F6'));
    const stores = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('gerenciador'); q.onsuccess = () => { r([...q.result.objectStoreNames]); q.result.close(); }; }));
    assert.deepEqual(stores.sort(), ['presets']);
    await page.goto(`${SITE}#/acoes`);
    assert.equal(await page.locator('.macro-row').count(), 5);
    assert.equal(await page.getByText('○ Desativada').count(), 5);
    await ctx.close();
  });
});

describe('interface', () => {
  it('sem rolagem horizontal em janelas pequenas e menu recolhível', async () => {
    for (const viewport of [{ width: 1024, height: 700 }, { width: 760, height: 900 }, { width: 390, height: 844 }]) {
      const { page, ctx, errors } = await open({ [LIVE_URL]: { body: V_SITE } }, { viewport });
      for (const r of ['painel', 'acoes', 'presets', 'catalogo', 'config']) {
        await page.goto(`${SITE}#/${r}`);
        await page.waitForTimeout(300);
        const overflow = await page.evaluate(() => {
          const c = document.querySelector('.content');
          return { doc: document.documentElement.scrollWidth - window.innerWidth, content: c ? c.scrollWidth - c.clientWidth : 0 };
        });
        assert.ok(overflow.doc <= 0 && overflow.content <= 0, `overflow em ${r} @${viewport.width}: ${JSON.stringify(overflow)}`);
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_SITE } });
    await page.getByRole('button', { name: /Recolher menu/ }).click();
    assert.ok(await page.locator('.app.collapsed').count());
    await page.reload();
    await page.waitForSelector('.topbar');
    assert.ok(await page.locator('.app.collapsed').count(), 'preferência lembrada');
    await ctx.close();
  });

  it('Helper desconectado: site funciona e explica o que fazer', async () => {
    await helper.close();
    helper = { close: async () => {}, state: {} };
    const { page, ctx, errors } = await open({ [LIVE_URL]: { body: V_SITE } });
    await page.getByRole('heading', { name: 'Abra o Helper' }).waitFor();
    await page.goto(`${SITE}#/presets`);
    assert.equal(await page.getByRole('button', { name: 'Aplicar no Roblox' }).isDisabled(), true);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
});
