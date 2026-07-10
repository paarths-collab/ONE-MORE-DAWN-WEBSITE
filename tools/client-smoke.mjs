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
      staleCommentClaim: document.body.innerText.includes('SAY HI IN THE COMMENTS'),
      blockingReport: !!document.querySelector('.stats-modal.dawn-report'),
      teaser: !!document.querySelector('.dawn-teaser'),
      buildVisible: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('🔨')),
      upgradeVisible: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('UPGRADE')),
      playableScavenge: [...document.querySelectorAll('button')].some((b) => /SCAVENGE|pick a route/i.test((b.textContent || '').replace(/\\s+/g, ' '))),
      muteControl: !!document.querySelector('.mute-fab'),
      overflowX: document.body.scrollWidth > document.documentElement.clientWidth
    }))()`);
    assert(!boot.staleCommentClaim, 'Live V1 must not claim SAY HI posts to Reddit comments.');
    assert(!boot.blockingReport, 'Dawn Report must not block first interaction.');
    assert(boot.teaser, 'Dawn Report teaser should be visible in mock-live.');
    assert(!boot.buildVisible, 'Live mode must not show demo-only BUILD.');
    assert(!boot.upgradeVisible, 'Live mode must not show demo-only UPGRADE.');
    assert(!boot.playableScavenge, 'Live V1 must not show a playable scavenge action.');
    assert(boot.muteControl, 'V1 must show a global mute control.');
    assert(!boot.overflowX, 'Desktop page should not overflow horizontally.');

    // Sound is a live V1 promise: every local cue must resolve to a non-empty
    // same-origin WAV, and unmuting must call the media playback path.
    const soundAssets = await cdp.eval(`Promise.all(
      ${JSON.stringify([
        'button_click',
        'action_confirm',
        'vote_cast',
        'pledge',
        'raid_warning',
        'dawn_report',
        'city_fallen',
        'error_soft',
      ])}.map(async (name) => {
        const response = await fetch('assets/sfx/' + name + '.wav');
        const bytes = await response.arrayBuffer();
        return { name, ok: response.ok, type: response.headers.get('content-type') || '', bytes: bytes.byteLength };
      })
    )`);
    for (const asset of soundAssets) {
      assert(asset.ok && asset.bytes > 44, `Sound asset ${asset.name} must load as a non-empty WAV.`);
    }
    await cdp.eval(`(() => {
      window.__omdAudioPlays = [];
      HTMLMediaElement.prototype.play = function () {
        window.__omdAudioPlays.push(this.currentSrc || this.src || 'unknown');
        return Promise.resolve();
      };
      return true;
    })()`);

    // Mute toggle: flips aria-pressed, persists, and plays feedback when unmuted.
    const muteBefore = await cdp.eval(`document.querySelector('.mute-fab')?.getAttribute('aria-pressed')`);
    await cdp.eval(`document.querySelector('.mute-fab')?.click()`);
    await cdp.waitFor(`document.querySelector('.mute-fab')?.getAttribute('aria-pressed') !== ${JSON.stringify(muteBefore)}`, 'mute toggles state');
    const stored = await cdp.eval(`window.localStorage.getItem('omd_muted')`);
    assert(stored === '0' || stored === '1', 'mute state persists to localStorage');
    await cdp.eval(`document.querySelector('.mute-fab')?.click()`); // restore + audible feedback
    await cdp.waitFor(`window.__omdAudioPlays.some((src) => src.includes('button_click.wav'))`, 'unmute sound feedback');

    // The Dawn Report teaser and full ledger are both visible commands, so
    // exercise their open and close controls before changing dashboard tabs.
    await cdp.clickButton('VIEW');
    await cdp.waitFor('!!document.querySelector(".stats-modal.dawn-report.on")', 'dawn report opens');
    await cdp.eval(`document.querySelector('button[aria-label="Close dawn report"]')?.click()`);
    await cdp.waitFor('!document.querySelector(".stats-modal.dawn-report.on")', 'dawn report closes');
    await cdp.eval(`document.querySelector('.stats-fab')?.click()`);
    await cdp.waitFor('document.querySelector(".stats-modal.on h2")?.textContent.includes("CITY LEDGER")', 'stats ledger opens');
    await cdp.eval(`document.querySelector('button[aria-label="Close stats"]')?.click()`);
    await cdp.waitFor('!document.querySelector(".stats-modal.on")', 'stats ledger closes');

    for (const label of ['CITY', 'LIVE', 'TOP 🏆', 'MAP', 'WORLD', 'TOWN']) {
      await cdp.clickButton(label);
      if (label === 'LIVE') {
        await cdp.waitFor('document.body.innerText.includes("CITY CHATTER")', 'LIVE tab labels SAY HI as city chatter');
      }
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
    await cdp.waitFor(`window.__omdAudioPlays.some((src) => src.includes('action_confirm.wav'))`, 'accepted action sound');

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
    const firstDistrict = await cdp.eval(`document.querySelectorAll('.district').length`);
    assert(firstDistrict > 0, 'Settlement CITY tab should render at least one unlocked district.');
    await cdp.eval(`document.querySelector('.district')?.click()`);
    await cdp.waitFor('!!document.querySelector(".district.on")', 'district selection');
    await cdp.clickSelectorContaining('.bp-cta', 'ADD LABOR');
    await cdp.waitFor('!!document.querySelector(".build-panel")', 'build panel survives ADD LABOR');

    // Guard the pointer-events regression: the fabs carry the .hud class
    // (pointer-events:none) and must be re-enabled, or real clicks fall through
    // to the 3D canvas. Programmatic .click() below bypasses this, so assert the
    // computed style directly.
    const fabPe = await cdp.eval(`(() => {
      const pe = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).pointerEvents : 'missing'; };
      return { board: pe('.board-fab'), stats: pe('.stats-fab'), mute: pe('.mute-fab'), city: pe('.dash-fab') };
    })()`);
    for (const [name, pe] of Object.entries(fabPe)) {
      assert(pe === 'auto', `${name} fab must be clickable (pointer-events:auto), got "${pe}".`);
    }

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
        neigh: sheet?.querySelector('.db-neigh')?.textContent || '',
        structureRows: sheet?.querySelectorAll('table.st tbody tr').length || 0,
      };
    })()`);
    assert(board.title.includes('CITY DASHBOARD'), 'DASH fab should open the CITY DASHBOARD.');
    assert(/\d+ souls? (has|have) built here/.test(board.neigh), `Dashboard should show the neighborhood counter, saw "${board.neigh}".`);
    assert(board.neigh.includes('24'), `Neighborhood counter should reflect the house total (24), saw "${board.neigh}".`);
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

async function landscapeLayoutSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 844,
      height: 390,
      deviceScaleFactor: 2,
      mobile: true,
      screenOrientation: { type: 'landscapePrimary', angle: 90 },
    });
    await cdp.call('Page.reload', { ignoreCache: true });
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("THE LAST CITY")', 'landscape city boot');
    await cdp.waitFor('!document.querySelector(".loader:not(.done)")', 'landscape loader exit');
    const layout = await cdp.eval(`(() => {
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const globals = [...document.querySelectorAll('.fab-bar button, .dash-fab')].filter(visible);
      const drawer = [...document.querySelectorAll('.dash.on button')].filter(visible);
      const intersections = [];
      for (const a of globals) {
        const ar = a.getBoundingClientRect();
        for (const b of drawer) {
          const br = b.getBoundingClientRect();
          const width = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
          const height = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
          if (width > 2 && height > 2) {
            intersections.push([(a.textContent || '').trim(), (b.textContent || '').trim()]);
          }
        }
      }
      return {
        intersections,
        overflowX: document.body.scrollWidth > document.documentElement.clientWidth,
        actionHeights: [...document.querySelectorAll('.act')].filter(visible).map((el) => el.getBoundingClientRect().height),
      };
    })()`);
    assert(layout.intersections.length === 0, `Landscape global controls must not overlap the CITY drawer: ${JSON.stringify(layout.intersections)}`);
    assert(!layout.overflowX, 'Landscape viewport should not overflow horizontally.');
    assert(layout.actionHeights.every((height) => height >= 44), `Landscape action buttons need 44px touch height, saw ${layout.actionHeights.join(', ')}.`);
  } finally {
    await close();
  }
}

async function splashSmoke(url) {
  const { cdp, close } = await openPage(`${url}splash.html`);
  try {
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 520,
      deviceScaleFactor: 2,
      mobile: true,
      screenOrientation: { type: 'portraitPrimary', angle: 0 },
    });
    await cdp.call('Page.reload', { ignoreCache: true });
    await cdp.waitFor('document.body.innerText.includes("ONE MORE DAWN")', 'feed splash boot');
    await cdp.waitFor('document.querySelector(".snoo")?.complete && document.querySelector(".snoo")?.naturalWidth > 0', 'feed splash survivor art');
    const splash = await cdp.eval(`(() => {
      const cta = document.querySelector('#start-button');
      const rect = cta?.getBoundingClientRect();
      const image = document.querySelector('.snoo');
      return {
        buttonCount: document.querySelectorAll('button').length,
        ctaText: cta?.textContent || '',
        ctaHeight: rect?.height || 0,
        imageLoaded: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        staleLinks: /Docs|r\\/Devvit|Discord/.test(document.body.innerText),
        sharedCity: document.body.innerText.includes('ONE SHARED CITY'),
        overflowX: document.body.scrollWidth > document.documentElement.clientWidth,
        overflowY: document.body.scrollHeight > document.documentElement.clientHeight,
      };
    })()`);
    assert(splash.buttonCount === 1, `Feed splash should have one primary command, saw ${splash.buttonCount}.`);
    assert(splash.ctaText.includes('ENTER THE CITY'), 'Feed splash should expose the Enter the City CTA.');
    assert(splash.ctaHeight >= 44, `Feed splash CTA needs 44px touch height, saw ${splash.ctaHeight}.`);
    assert(splash.imageLoaded, 'Feed splash survivor art must load from the local bundle.');
    assert(!splash.staleLinks, 'Feed splash must not expose stock Devvit template links.');
    assert(splash.sharedCity, 'Feed splash should state the shared-city premise.');
    assert(!splash.overflowX && !splash.overflowY, 'Feed splash should fit a 390×520 Reddit card without scrolling.');
    await cdp.clickButtonContaining('ENTER THE CITY');
    await cdp.waitFor('document.body.innerText.includes("ONE MORE DAWN")', 'feed splash survives expand request');
  } finally {
    await close();
  }
}

async function onboardingSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('document.body && document.body.innerText.includes("CHOOSE YOUR ROLE")', 'onboarding overlay');
    // First-time understanding: the intro must name the two signature hooks —
    // the city starts as a Camp, and contributing raises your own house.
    const intro = await cdp.eval(`document.querySelector('.onboard-sheet')?.textContent || ''`);
    assert(/Camp/.test(intro), `Onboarding intro should say the city starts as a Camp, saw "${intro.slice(0, 220)}".`);
    assert(/house/i.test(intro), `Onboarding intro should say your contribution raises your own house, saw "${intro.slice(0, 220)}".`);
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
        districtCount: document.querySelectorAll('.district').length,
        districtsEmpty: document.querySelector('.districts .mini-cap')?.textContent || '',
        playableScavenge: [...document.querySelectorAll('button')].some((b) => /SCAVENGE|pick a route/i.test((b.textContent || '').replace(/\\s+/g, ' '))),
        text,
      };
    })()`);
    assert(camp.stage.includes('Camp'), 'Brand-new mock city should show Camp stage.');
    assert(camp.districtCount === 0, `Brand-new Camp should list no districts (starts from scratch), saw ${camp.districtCount}.`);
    assert(camp.districtsEmpty.includes('No districts yet'), `Fresh Camp CITY tab should show a districts empty-state, not a bare "DISTRICTS" header, saw "${camp.districtsEmpty}".`);
    assert(camp.nextName.includes('Shelter'), 'Brand-new mock city should name Shelter as the first unlock.');
    assert(camp.built.includes('Nothing stands here yet. Contribute labor to build the first Shelter.'), 'Brand-new mock city should explain the empty Camp state.');
    assert(camp.meta.includes('0/24'), 'Brand-new mock city should show zero shared labor progress.');
    assert(camp.cta.includes('ADD LABOR'), 'Brand-new mock city should expose the Add Labor contribution CTA.');
    assert(camp.hasBar, 'Brand-new mock city should render the shared build progress bar.');
    assert(!camp.playableScavenge, 'Camp smoke must not expose playable scavenge.');

    // One-redditor-one-house: a brand-new Camp has no contributors yet, so the
    // neighborhood counter reads zero (the town starts from scratch).
    await cdp.eval(`document.querySelector('.board-fab')?.click()`);
    await cdp.waitFor('!!document.querySelector(".stats-modal.on .db-neigh")', 'camp dashboard neighborhood line');
    const neigh = await cdp.eval(`document.querySelector('.stats-modal.on .db-neigh')?.textContent || ''`);
    assert(/\b0 souls have built here/.test(neigh), `Brand-new Camp should show zero souls built, saw "${neigh}".`);
  } finally {
    await close();
  }
}

async function portraitSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenOrientation: { type: 'portraitPrimary', angle: 0 },
    });
    await cdp.call('Page.reload', { ignoreCache: true });
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("THE LAST CITY")', 'portrait city boot');
    await cdp.waitFor('!document.querySelector(".loader:not(.done)")', 'portrait loader exit');
    const portrait = await cdp.eval(`(() => {
      const gate = document.querySelector('.rotate-gate');
      const gateStyle = gate ? getComputedStyle(gate) : null;
      const fab = document.querySelector('.dash-fab');
      const fabStyle = fab ? getComputedStyle(fab) : null;
      return {
        gateDisplay: gateStyle?.display || 'missing',
        gatePointer: gateStyle?.pointerEvents || 'missing',
        gatePosition: gateStyle?.position || 'missing',
        fabPointer: fabStyle?.pointerEvents || 'missing',
        overflowX: document.body.scrollWidth > document.documentElement.clientWidth,
      };
    })()`);
    assert(portrait.gateDisplay !== 'none' && portrait.gateDisplay !== 'missing', 'Portrait advisory should be visible on phone-sized portrait viewports.');
    assert(portrait.gatePointer === 'none', `Portrait advisory must not trap taps, got pointer-events:${portrait.gatePointer}.`);
    assert(portrait.gatePosition === 'fixed', 'Portrait advisory should remain visible without taking layout space.');
    assert(portrait.fabPointer === 'auto', `CITY fab should remain tappable in portrait, got pointer-events:${portrait.fabPointer}.`);
    assert(!portrait.overflowX, 'Portrait viewport should not overflow horizontally.');
  } finally {
    await close();
  }
}

async function firstHouseSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("THE LAST CITY")', 'first-house city boot');
    await cdp.waitFor('!document.querySelector(".loader:not(.done)")', 'first-house loader exit');
    await cdp.clickSelectorContaining('.act', 'GUARD');
    await cdp.waitFor('document.body.innerText.includes("Your house now stands in the city. Build order #3.")', 'first contribution house feedback');
    await sleep(200);
    const count = await cdp.eval(`(document.body.innerText.match(/Your house now stands in the city/g) || []).length`);
    assert(count === 1, `First-house feedback should appear once, saw ${count}.`);
  } finally {
    await close();
  }
}

await withServer('mock-live core loop', 4640, {}, liveSmoke);
await withServer('mock-live onboarding', 4641, { MOCK_ROLE_NULL: '1' }, onboardingSmoke);
await withServer('mock-live fallen city', 4642, { MOCK_FALLEN: '1' }, fallenSmoke);
await withServer('mock-live brand-new camp', 4643, { MOCK_CAMP: '1' }, campSmoke);
await withServer('mock-live portrait fallback', 4644, {}, portraitSmoke);
await withServer('mock-live first house feedback', 4645, { MOCK_NO_HOUSE: '1' }, firstHouseSmoke);
await withServer('mock-live landscape layout', 4646, {}, landscapeLayoutSmoke);
await withServer('feed splash', 4647, {}, splashSmoke);

console.log('client smoke passed');
