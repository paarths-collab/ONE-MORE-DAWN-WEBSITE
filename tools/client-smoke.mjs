import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VITE_BIN = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const NODE_BIN = existsSync(process.execPath) ? process.execPath : 'node';
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function removeTempDir(path) {
  for (let i = 0; i < 8; i++) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch {
      await sleep(150);
    }
  }
}

const findChrome = () => {
  const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!exe) {
    throw new Error('Chrome/Edge was not found. Set CHROME_PATH to run client smoke tests.');
  }
  return exe;
};

async function waitForHttp(url, label, timeoutMs = 30_000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(250);
  }
  throw new Error(`${label} did not become ready: ${last}`);
}

function startVite(port, extraEnv = {}) {
  const child = spawn(
    NODE_BIN,
    [VITE_BIN, '--config', 'vite.dev3d.config.mjs', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: ROOT,
      env: { ...process.env, MOCK_API: '1', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return {
    output: () => output,
    stop: () => {
      if (!child.killed) child.kill();
    },
  };
}

class CdpPage {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10_000);
    });
  }

  async eval(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'Runtime.evaluate failed');
    }
    return result.result.value;
  }

  async waitFor(expression, label, timeoutMs = 20_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.eval(expression)) return;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  async clickButton(text) {
    const escaped = JSON.stringify(text);
    const ok = await this.eval(`
      (() => {
        const wanted = ${escaped};
        const btn = [...document.querySelectorAll('button')]
          .find((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim() === wanted);
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    assert(ok, `Button not found: ${text}`);
  }

  async clickButtonContaining(text) {
    const escaped = JSON.stringify(text);
    const ok = await this.eval(`
      (() => {
        const wanted = ${escaped};
        const btn = [...document.querySelectorAll('button')]
          .find((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim().includes(wanted));
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    assert(ok, `Button containing text not found: ${text}`);
  }

  async clickSelectorContaining(selector, text) {
    const escapedSelector = JSON.stringify(selector);
    const escapedText = JSON.stringify(text);
    const ok = await this.eval(`
      (() => {
        const selector = ${escapedSelector};
        const wanted = ${escapedText};
        const el = [...document.querySelectorAll(selector)]
          .find((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim().includes(wanted));
        if (!el) return false;
        el.click();
        return true;
      })()
    `);
    assert(ok, `${selector} containing text not found: ${text}`);
  }

  close() {
    this.ws.close();
  }
}

async function openPage(url) {
  const chrome = findChrome();
  const userDir = await mkdtemp(join(tmpdir(), 'omd-chrome-'));
  const proc = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--no-first-run',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDir}`,
    url,
  ], { stdio: 'ignore', windowsHide: true });

  try {
    const portFile = join(userDir, 'DevToolsActivePort');
    let debugPort = '';
    for (let i = 0; i < 80; i++) {
      if (existsSync(portFile)) {
        debugPort = (await readFile(portFile, 'utf8')).split(/\r?\n/)[0] ?? '';
        if (debugPort) break;
      }
      await sleep(125);
    }
    assert(debugPort, 'Chrome did not expose a DevTools port.');

    let target;
    for (let i = 0; i < 80; i++) {
      const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === 'page' && t.url.startsWith(url));
      if (target?.webSocketDebuggerUrl) break;
      await sleep(125);
    }
    assert(target?.webSocketDebuggerUrl, 'Chrome page target was not found.');
    const cdp = new CdpPage(new WebSocket(target.webSocketDebuggerUrl));
    await new Promise((resolve) => cdp.ws.addEventListener('open', resolve, { once: true }));
    await cdp.call('Runtime.enable');
    await cdp.call('Log.enable');
    await cdp.waitFor('document.readyState !== "loading"', 'DOM ready');
    return {
      cdp,
      close: async () => {
        cdp.close();
        if (!proc.killed) proc.kill();
        await removeTempDir(userDir);
      },
    };
  } catch (err) {
    if (!proc.killed) proc.kill();
    await removeTempDir(userDir);
    throw err;
  }
}

async function withServer(name, port, env, run) {
  const server = startVite(port, env);
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, `${name} Vite`);
    await run(`http://127.0.0.1:${port}/`);
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(server.output());
    throw err;
  } finally {
    server.stop();
  }
}

async function liveSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("THE LAST CITY")', 'live city boot');
    await cdp.waitFor('!document.querySelector(".loader:not(.done)")', 'loader exit');
    const boot = await cdp.eval(`(() => ({
      blockingReport: !!document.querySelector('.stats-modal.dawn-report'),
      teaser: !!document.querySelector('.dawn-teaser'),
      buildVisible: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('🔨')),
      upgradeVisible: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('UPGRADE')),
      playableScavenge: [...document.querySelectorAll('button')].some((b) => /SCAVENGE|pick a route/i.test((b.textContent || '').replace(/\\s+/g, ' '))),
      muteControl: !!document.querySelector('.mute-fab'),
      overflowX: document.body.scrollWidth > document.documentElement.clientWidth
    }))()`);
    assert(!boot.blockingReport, 'Dawn Report must not block first interaction.');
    assert(boot.teaser, 'Dawn Report teaser should be visible in mock-live.');
    assert(!boot.buildVisible, 'Live mode must not show demo-only BUILD.');
    assert(!boot.upgradeVisible, 'Live mode must not show demo-only UPGRADE.');
    assert(!boot.playableScavenge, 'Live V1 must not show a playable scavenge action.');
    assert(boot.muteControl, 'V1 must show a global mute control.');
    assert(!boot.overflowX, 'Desktop page should not overflow horizontally.');

    // Mute toggle: flips aria-pressed and persists to localStorage; audio never throws.
    const muteBefore = await cdp.eval(`document.querySelector('.mute-fab')?.getAttribute('aria-pressed')`);
    await cdp.eval(`document.querySelector('.mute-fab')?.click()`);
    await cdp.waitFor(`document.querySelector('.mute-fab')?.getAttribute('aria-pressed') !== ${JSON.stringify(muteBefore)}`, 'mute toggles state');
    const stored = await cdp.eval(`window.localStorage.getItem('omd_muted')`);
    assert(stored === '0' || stored === '1', 'mute state persists to localStorage');
    await cdp.eval(`document.querySelector('.mute-fab')?.click()`); // restore for the rest of the run

    for (const label of ['LIVE', 'TOP 🏆', 'MAP', 'WORLD']) {
      await cdp.clickButton(label);
      if (label === 'WORLD') {
        await cdp.waitFor('document.querySelectorAll(".wm-city").length >= 2', 'multiple world cities render');
        const world = await cdp.eval(`(() => ({
          count: document.querySelectorAll('.wm-city').length,
          names: [...document.querySelectorAll('.wm-name')].map((n) => n.textContent || '')
        }))()`);
        assert(world.count >= 2, 'WORLD view should render multiple cities in mock-live.');
        assert(world.names.includes('r/meadowbrook') && world.names.includes('r/ironhollow'), 'WORLD view should include your city and a rival city.');
      }
      await sleep(200);
    }

    await cdp.clickButton('LIVE');
    await cdp.clickButtonContaining('Prepare for Raid');
    await cdp.waitFor('[...document.querySelectorAll("button.co-plan")].some((b) => b.disabled && (b.textContent || "").includes("Prepare for Raid"))', 'council strategy lock after submit');
    await cdp.clickButtonContaining('Fortify first');
    await cdp.waitFor('document.body.innerText.includes("Fortify first") && document.querySelectorAll(".cr-opt:disabled").length >= 3', 'vote lock after submit');
    await cdp.clickButtonContaining('Stand Vigil');
    await cdp.waitFor('document.body.innerText.includes("26/40") || document.body.innerText.includes("26")', 'pledge update');
    await cdp.clickSelectorContaining('.act', 'GUARD');
    await cdp.waitFor('[...document.querySelectorAll(".act")].some((b) => (b.textContent || "").includes("GUARD") && (b.textContent || "").includes("×1 today"))', 'action update');

    // BUILD FROM ZERO — the community-progress panel lives in the CITY tab.
    // Runs last: ADD LABOR fires a live mutation whose re-fetch would race the
    // vote/pledge/action flow above if placed earlier.
    await cdp.clickButton('CITY');
    await cdp.waitFor('!!document.querySelector(".build-panel")', 'build panel renders');
    const buildPanel = await cdp.eval(`(() => {
      const cta = document.querySelector('.bp-cta');
      return {
        hasPanel: !!document.querySelector('.build-panel'),
        hasBar: !!document.querySelector('.build-panel .bp-bar'),
        nextName: (document.querySelector('.bp-nm')?.textContent || ''),
        bodyHasFarm: document.body.innerText.includes('Farm'),
        ctaIsButton: !!cta && cta.tagName === 'BUTTON',
        ctaEnabled: !!cta && !cta.disabled,
      };
    })()`);
    assert(buildPanel.hasPanel, 'CITY tab should show the build panel.');
    assert(buildPanel.hasBar, 'Build panel should render a progress bar.');
    assert(buildPanel.bodyHasFarm && buildPanel.nextName.includes('Farm'), 'Build panel should name the next building (Farm).');
    assert(buildPanel.ctaIsButton, 'ADD LABOR CTA must be a real button.');
    assert(buildPanel.ctaEnabled, 'ADD LABOR CTA should be enabled when energy remains and not built today.');
    await cdp.clickSelectorContaining('.bp-cta', 'ADD LABOR');
    await cdp.waitFor('!!document.querySelector(".build-panel")', 'build panel survives ADD LABOR');

    // CITY DASHBOARD — the consolidated overview: settlement inventory,
    // resources, and the updates feed. Opened via the 📋 DASH fab.
    await cdp.eval(`document.querySelector('.board-fab')?.click()`);
    await cdp.waitFor('!!document.querySelector(".stats-modal.on")', 'city dashboard opens');
    const board = await cdp.eval(`(() => {
      const sheet = document.querySelector('.stats-modal.on .stats-sheet');
      const secs = [...(sheet?.querySelectorAll('.st-sec') || [])].map((s) => (s.textContent || '').trim());
      return {
        title: sheet?.querySelector('h2')?.textContent || '',
        sections: secs,
        hasStage: !!sheet?.querySelector('.db-stage'),
        hasFeed: !!sheet?.querySelector('.db-feed'),
        structureRows: sheet?.querySelectorAll('table.st tbody tr').length || 0,
      };
    })()`);
    assert(board.title.includes('CITY DASHBOARD'), 'DASH fab should open the CITY DASHBOARD.');
    assert(board.sections.includes('SETTLEMENT'), 'Dashboard should show the SETTLEMENT section.');
    assert(board.sections.some((s) => s.includes('INVENTORY')), 'Dashboard should show the resource INVENTORY.');
    assert(board.sections.includes('UPDATES'), 'Dashboard should show the UPDATES feed.');
    assert(board.hasStage && board.hasFeed, 'Dashboard should render the settlement stage and updates feed.');
    assert(board.structureRows >= 7, 'Dashboard should list every buildable structure.');
    await cdp.eval(`document.querySelector('.board-fab')?.click()`); // close for a clean end state
  } finally {
    await close();
  }
}

async function onboardingSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('document.body && document.body.innerText.includes("CHOOSE YOUR ROLE")', 'onboarding overlay');
    await cdp.clickSelectorContaining('.ob-role', 'GUARD');
    await cdp.clickButton('ENTER THE CITY');
    await cdp.waitFor('document.body && !document.body.innerText.includes("CHOOSE YOUR ROLE")', 'onboarding completion');
  } finally {
    await close();
  }
}

async function fallenSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('document.body && document.body.innerText.includes("THE CITY HAS FALLEN")', 'fallen terminal screen');
    const state = await cdp.eval(`(() => ({
      hasGrowFood: document.body.innerText.includes('GROW FOOD'),
      hasBuild: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('🔨')),
      hasTeaser: !!document.querySelector('.dawn-teaser'),
      text: document.body.innerText
    }))()`);
    assert(!state.hasGrowFood, 'Fallen city must hide action hotbar.');
    assert(!state.hasBuild, 'Fallen city must hide BUILD.');
    assert(!state.hasTeaser, 'Fallen city must hide Dawn Report teaser.');
  } finally {
    await close();
  }
}

async function campSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("THE LAST CITY")', 'camp city boot');
    await cdp.waitFor('!document.querySelector(".loader:not(.done)")', 'camp loader exit');
    await cdp.clickButton('CITY');
    await cdp.waitFor('!!document.querySelector(".build-panel")', 'camp build panel renders');
    const camp = await cdp.eval(`(() => {
      const text = document.body.innerText;
      const panel = document.querySelector('.build-panel');
      return {
        stage: document.querySelector('.bp-stage')?.textContent || '',
        nextName: document.querySelector('.bp-nm')?.textContent || '',
        built: document.querySelector('.bp-built')?.textContent || '',
        meta: document.querySelector('.bp-meta')?.textContent || '',
        cta: document.querySelector('.bp-cta')?.textContent || '',
        hasBar: !!panel?.querySelector('.bp-bar'),
        playableScavenge: [...document.querySelectorAll('button')].some((b) => /SCAVENGE|pick a route/i.test((b.textContent || '').replace(/\\s+/g, ' '))),
        text,
      };
    })()`);
    assert(camp.stage.includes('Camp'), 'Brand-new mock city should show Camp stage.');
    assert(camp.nextName.includes('Shelter'), 'Brand-new mock city should name Shelter as the first unlock.');
    assert(camp.built.includes('nothing yet'), 'Brand-new mock city should not claim any buildings are built.');
    assert(camp.meta.includes('0/24'), 'Brand-new mock city should show zero shared labor progress.');
    assert(camp.cta.includes('ADD LABOR'), 'Brand-new mock city should expose the Add Labor contribution CTA.');
    assert(camp.hasBar, 'Brand-new mock city should render the shared build progress bar.');
    assert(!camp.playableScavenge, 'Camp smoke must not expose playable scavenge.');
  } finally {
    await close();
  }
}

await withServer('mock-live core loop', 4640, {}, liveSmoke);
await withServer('mock-live onboarding', 4641, { MOCK_ROLE_NULL: '1' }, onboardingSmoke);
await withServer('mock-live fallen city', 4642, { MOCK_FALLEN: '1' }, fallenSmoke);
await withServer('mock-live brand-new camp', 4643, { MOCK_CAMP: '1' }, campSmoke);

console.log('client smoke passed');
