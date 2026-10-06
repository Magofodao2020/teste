// Testes ponta a ponta do site real (dist/) no Chromium, com o Helper simulado e
// as respostas do serviço de offsets simuladas por cenário.
// Rodar: npm run build && npm run test:e2e
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { startMockHelper } from './mock-helper.mjs';

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
function startStatic() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let file = join(DIST, p);
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
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
    await page.getByText('✓ Atualizados').first().waitFor();
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

  it('cache: ao reabrir com a mesma versão, não baixa nada de novo', async () => {
    const ctx = await browser.newContext();
    await (await open({ [LIVE_URL]: { body: V_NEW }, [OFFSETS_URL]: { body: offsetsJson(V_NEW) } }, { context: ctx })).page.getByText('✓ Atualizados').first().waitFor();
    assert.equal(counts[OFFSETS_URL], 1);
    const again = await open({ [LIVE_URL]: { body: V_NEW }, [OFFSETS_URL]: { body: offsetsJson(V_NEW) } }, { context: ctx });
    await again.page.getByText('✓ Atualizados').first().waitFor();
    assert.equal(counts[OFFSETS_URL] ?? 0, 0, 'reutiliza o dataset do cache');
    await ctx.close();
  });

  it('versão nova: baixa offsets.json, valida e envia ao Helper', async () => {
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_NEW }, [OFFSETS_URL]: { body: offsetsJson(V_NEW) } });
    await page.getByText('✓ Atualizados').first().waitFor();
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
    await page.getByText('✓ Atualizados').first().waitFor();
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
    await page.getByText('Não foi possível atualizar os offsets.').first().waitFor();
    await page.getByText(/Os dados atuais \(version-cec3ad5889b447cf\) foram mantidos/).first().waitFor();
    await waitFor(() => helper.state.offsets?.version === V_SITE);
    await ctx.close();
  });

  it('não existe seletor manual de versão em nenhuma página', async () => {
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_SITE } });
    for (const r of ['painel', 'acoes', 'presets', 'catalogo', 'config']) {
      await page.goto(`${SITE}#/${r}`);
      await page.waitForTimeout(400);
      assert.equal(await page.locator('select').count(), 0, `select em ${r}`);
      const text = await page.locator('body').innerText();
      assert.doesNotMatch(text, /selecionar versão|forçar versão|AHK/i, `texto proibido em ${r}`);
    }
    await ctx.close();
  });
});

describe('ações', () => {
  it('somente as cinco ações, com keybinds exatas e valores do pack enviados ao Helper', async () => {
    const { page, ctx } = await open({ [LIVE_URL]: { body: V_SITE } });
    await page.goto(`${SITE}#/acoes`);
    const names = await page.locator('.action-name').allInnerTexts();
    assert.deepEqual(names, ['Bug Indi', 'Bug indi ESQUERDA', 'Bug indi DIREITA', 'Perfect Dive', 'Gagatech']);
    const macros = await waitFor(() => helper.state.macros);
    assert.equal(macros.length, 5);
    macros.forEach((m, i) => {
      const { bope, v, ...fields } = USER_PACK.macros[i];
      assert.deepEqual({ name: m.name, mode: m.mode, repeat: m.repeat, loopDelay: m.loopDelay, speed: m.speed, robloxOnly: m.robloxOnly, steps: m.steps, trigger: m.trigger }, fields);
    });
    assert.deepEqual(macros.map((m) => m.trigger), ['MouseBack', 'MouseForward', 'MouseBack', 'MouseRight', 'MouseForward']);
    assert.deepEqual(helper.state.settings, { stopKey: 'F8' });

    // ativar Bug indi DIREITA desativa Bug Indi (mesmo botão)
    await page.getByRole('switch', { name: 'Ativar Bug indi DIREITA' }).click();
    await waitFor(() => helper.state.macros.find((m) => m.id === 'bug-indi-direita').enabled);
    assert.equal(helper.state.macros.find((m) => m.id === 'bug-indi').enabled, false);
    assert.equal(await page.getByRole('switch', { name: 'Ativar Bug Indi', exact: true }).getAttribute('aria-checked'), 'false');

    // trocar botão por captura (tecla G) e restaurar padrão
    await page.getByRole('button', { name: 'Botão de Gagatech' }).click();
    await page.waitForTimeout(200);
    await page.keyboard.press('KeyG');
    await waitFor(() => helper.state.macros.find((m) => m.id === 'gagatech').trigger === 'KeyG');
    await page.getByRole('button', { name: 'Restaurar padrão' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restaurar padrão' }).click();
    await waitFor(() => helper.state.macros.find((m) => m.id === 'gagatech').trigger === 'MouseForward');

    // testar envia o macro com os mesmos passos
    await page.getByRole('button', { name: 'Testar (3 s)' }).first().click();
    const run = await waitFor(() => helper.state.posts.find((p) => p.path === '/macro/run'));
    assert.deepEqual(run.data.macro.steps, USER_PACK.macros[0].steps);
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
    assert.deepEqual(stores.sort(), ['datasets', 'presets']);
    await page.goto(`${SITE}#/acoes`);
    assert.equal(await page.locator('.action').count(), 5);
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
