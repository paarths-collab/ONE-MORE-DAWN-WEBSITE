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

// CI runners software-render the three.js canvas on 2 vCPUs and run several
// times slower than a dev machine — scale every wait ceiling in one place
// instead of tuning individual call sites. Override with SMOKE_TIME_SCALE.
const TIME_SCALE = Math.max(1, Number(process.env.SMOKE_TIME_SCALE ?? (process.env.CI ? 4 : 1)) || 1);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function completeContextLesson(cdp, title) {
  const expected = JSON.stringify(title);
  await cdp.waitFor(
    `(document.querySelector('.coach .co-head span')?.textContent || '').includes(${expected})`,
    `${title} contextual advisor lesson`,
  );
  assert((await cdp.eval(`document.querySelector('.coach .co-step')?.textContent || ''`)).includes('1/1'), `${title} should be a single contextual lesson.`);
  let guard = 0;
  while (guard++ < 4 && (await cdp.eval(`!!document.querySelector('.coach')`))) {
    await cdp.eval(`document.querySelector('.coach .co-next')?.click()`);
    await sleep(100);
  }
  await cdp.waitFor(`!document.querySelector('.coach') && !document.querySelector('.coach-ring')`, `${title} lesson closes`);
}

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
  const deadline = timeoutMs * TIME_SCALE;
  let last = '';
  while (Date.now() - started < deadline) {
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
      }, 10_000 * TIME_SCALE);
    });
  }

  async eval(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description
          ?? result.exceptionDetails.text
          ?? 'Runtime.evaluate failed',
      );
    }
    return result.result.value;
  }

  async waitFor(expression, label, timeoutMs = 20_000) {
    const started = Date.now();
    const deadline = timeoutMs * TIME_SCALE;
    let lastError = null;
    while (Date.now() - started < deadline) {
      // A transient eval throw (mid-navigation / mid-render DOM) means "not
      // yet", not "broken" — only surface it if the condition never comes true.
      try {
        if (await this.eval(expression)) return;
        lastError = null;
      } catch (err) {
        lastError = err;
      }
      await sleep(250);
    }
    const detail = lastError ? ` (last eval error: ${lastError.message})` : '';
    throw new Error(`Timed out waiting for ${label}${detail}`);
  }

  /** Retry a click expression until the target is present AND enabled.
   *  A found-but-disabled button (React state not yet flushed, busy flags)
   *  would otherwise no-op silently and surface as a downstream timeout —
   *  the flake this guards against. */
  async #clickWithRetry(expression, failMessage, timeoutMs = 5_000) {
    const started = Date.now();
    const deadline = timeoutMs * TIME_SCALE;
    for (;;) {
      const state = await this.eval(expression); // 'clicked' | 'disabled' | 'missing'
      if (state === 'clicked') return;
      if (Date.now() - started >= deadline) {
        assert(false, `${failMessage} (last state: ${state})`);
      }
      await sleep(150);
    }
  }

  async clickButton(text) {
    const escaped = JSON.stringify(text);
    await this.#clickWithRetry(`
      (() => {
        const wanted = ${escaped};
        const btn = [...document.querySelectorAll('button')]
          .find((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim() === wanted);
        if (!btn) return 'missing';
        if (btn.disabled) return 'disabled';
        btn.click();
        return 'clicked';
      })()
    `, `Button not clickable: ${text}`);
  }

  async clickButtonContaining(text) {
    const escaped = JSON.stringify(text);
    await this.#clickWithRetry(`
      (() => {
        const wanted = ${escaped};
        const btn = [...document.querySelectorAll('button')]
          .find((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim().includes(wanted));
        if (!btn) return 'missing';
        if (btn.disabled) return 'disabled';
        btn.click();
        return 'clicked';
      })()
    `, `Button containing text not clickable: ${text}`);
  }

  async clickSelectorContaining(selector, text) {
    const escapedSelector = JSON.stringify(selector);
    const escapedText = JSON.stringify(text);
    await this.#clickWithRetry(`
      (() => {
        const selector = ${escapedSelector};
        const wanted = ${escapedText};
        const el = [...document.querySelectorAll(selector)]
          .find((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim().includes(wanted));
        if (!el) return 'missing';
        if (el.disabled) return 'disabled';
        el.click();
        return 'clicked';
      })()
    `, `${selector} containing text not clickable: ${text}`);
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
    for (let i = 0; i < 80 * TIME_SCALE; i++) {
      if (existsSync(portFile)) {
        debugPort = (await readFile(portFile, 'utf8')).split(/\r?\n/)[0] ?? '';
        if (debugPort) break;
      }
      await sleep(125);
    }
    assert(debugPort, 'Chrome did not expose a DevTools port.');

    let target;
    for (let i = 0; i < 80 * TIME_SCALE; i++) {
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
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("VAELMAR")', 'live city boot');
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
    assert(!boot.teaser, 'Dawn Report teaser should wait until first-run advisor guidance is complete.');
    assert(!boot.buildVisible, 'Live mode must not show demo-only BUILD.');
    assert(!boot.upgradeVisible, 'Live mode must not show demo-only UPGRADE.');
    assert(!boot.playableScavenge, 'Live V1 must not show a playable scavenge action.');
    assert(!boot.muteControl, 'Secondary controls should stay hidden while the first-run advisor speaks.');
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
      window.__omdAudioEvents = [];
      HTMLMediaElement.prototype.play = function () {
        window.__omdAudioPlays.push(this.currentSrc || this.src || 'unknown');
        window.__omdAudioEvents.push({ src: this.currentSrc || this.src || 'unknown', volume: this.volume });
        return Promise.resolve();
      };
      return true;
    })()`);

    // Advisor onboarding teaches four essentials up front. Deeper lessons are
    // delayed until the player opens the matching surface.
    await cdp.waitFor(`!!document.querySelector('.coach')`, 'advisor coach appears on first visit');
    const advisorRendering = await cdp.eval(`(() => {
      const portrait = document.querySelector('.co-avatar');
      if (!(portrait instanceof SVGElement)) return null;
      return {
        imageRendering: getComputedStyle(portrait).imageRendering,
        viewBox: portrait.getAttribute('viewBox'),
        width: portrait.getBoundingClientRect().width,
      };
    })()`);
    assert(advisorRendering?.imageRendering !== 'pixelated', 'Advisor portrait should render as smooth vector art.');
    assert(advisorRendering?.viewBox === '0 0 72 92' && advisorRendering.width >= 60, 'Advisor portrait should use the detailed high-resolution composition.');
    await cdp.waitFor(`(document.querySelector('.title .sub')?.textContent || '').includes('r/meadowbrook')`, 'top bar identifies the real subreddit city');
    await cdp.waitFor(`[...document.querySelectorAll('.h-owner')].some((el) => (el.textContent || '').includes('u/mock_user'))`, 'current player house uses the real Reddit username');
    const coachHead = await cdp.eval(`document.querySelector('.coach .co-head span')?.textContent || ''`);
    assert(coachHead.includes('ADVISOR'), 'coach chip is framed as the ADVISOR');
    await cdp.waitFor(`!!document.querySelector('.coach-ring')`, 'advisor highlight ring anchors to the UI');
    // Each step may take TWO taps: the first completes Maren's typewriter line,
    // the second advances — so the guard allows 2× the step count plus slack.
    let tourGuard = 0;
    const introTitles = new Set();
    while (tourGuard++ < 12 && (await cdp.eval(`!!document.querySelector('.coach')`))) {
      introTitles.add(await cdp.eval(`document.querySelector('.coach .co-head span')?.textContent || ''`));
      await cdp.eval(`document.querySelector('.coach .co-next')?.click()`);
      await sleep(150);
    }
    for (const title of ['WELCOME, SURVIVOR', 'THE VITALS', 'THE DAY', 'YOUR ENERGY']) {
      assert([...introTitles].some((head) => head.includes(title)), `Opening advisor primer should include ${title}.`);
    }
    assert(![...introTitles].some((head) => head.includes('MY TASK FOR YOU')), 'Opening advisor primer must stop before contextual lessons.');
    await cdp.waitFor(`!document.querySelector('.coach') && !document.querySelector('.coach-ring')`, 'four-step primer + ring dismiss after GOT IT');
    assert((await cdp.eval(`window.localStorage.getItem('omd_coach_v1')`)) === '1', 'advisor primer marks itself seen');
    await cdp.waitFor(`!!document.querySelector('.dawn-teaser')`, 'Dawn Report teaser appears after advisor primer');

    // Secondary controls become available after the primer. Sound and music
    // live in the compact settings menu instead of crowding the first screen.
    await cdp.waitFor(`!!document.querySelector('.gear-fab')`, 'settings control appears after advisor primer');
    await cdp.eval(`document.querySelector('.gear-fab')?.click()`);
    await cdp.waitFor(`!!document.querySelector('.mute-fab') && !!document.querySelector('.music-fab') && !!document.querySelector('.volume-slider')`, 'sound controls and volume open from settings');
    const volumeBefore = await cdp.eval(`(() => { const slider = document.querySelector('.volume-slider'); return slider ? { value: slider.value, label: slider.closest('.volume-control')?.textContent || '' } : null; })()`);
    assert(volumeBefore && volumeBefore.value === '100' && volumeBefore.label.includes('100%'), `master volume should default to 100%, saw ${JSON.stringify(volumeBefore)}.`);
    await cdp.eval(`(() => {
      const slider = document.querySelector('.volume-slider');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!slider || !setter) return false;
      setter.call(slider, '35');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await cdp.waitFor(`localStorage.getItem('omd_master_volume') === '0.35' && document.querySelector('.volume-slider')?.value === '35'`, 'master volume persists and updates');
    const musicBefore = await cdp.eval(`(() => { const f = document.querySelector('.music-fab'); return f ? { pressed: f.getAttribute('aria-pressed'), stored: localStorage.getItem('omd_music_muted') } : null; })()`);
    assert(musicBefore && musicBefore.pressed === 'false', `music control should render default-off, saw ${JSON.stringify(musicBefore)}.`);
    await cdp.eval(`document.querySelector('.music-fab')?.click()`);
    await cdp.waitFor(`document.querySelector('.music-fab')?.getAttribute('aria-pressed') === 'true'`, 'music toggles on');
    assert((await cdp.eval(`localStorage.getItem('omd_music_muted')`)) === '0', 'music mute state persists to localStorage');
    await cdp.eval(`document.querySelector('.music-fab')?.click()`); // restore off
    const muteBefore = await cdp.eval(`document.querySelector('.mute-fab')?.getAttribute('aria-pressed')`);
    await cdp.eval(`document.querySelector('.mute-fab')?.click()`);
    await cdp.waitFor(`document.querySelector('.mute-fab')?.getAttribute('aria-pressed') !== ${JSON.stringify(muteBefore)}`, 'mute toggles state');
    const stored = await cdp.eval(`window.localStorage.getItem('omd_muted')`);
    assert(stored === '0' || stored === '1', 'mute state persists to localStorage');
    await cdp.eval(`document.querySelector('.mute-fab')?.click()`); // restore + audible feedback
    await cdp.waitFor(`window.__omdAudioPlays.some((src) => src.includes('button_click.wav'))`, 'unmute sound feedback');
    const volumeEvent = await cdp.eval(`window.__omdAudioEvents.filter((event) => event.src.includes('button_click.wav')).at(-1)`);
    assert(volumeEvent && Math.abs(volumeEvent.volume - 0.175) < 0.01, `SFX should honor 35% master volume, saw ${JSON.stringify(volumeEvent)}.`);
    await cdp.eval(`(() => {
      const slider = document.querySelector('.volume-slider');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!slider || !setter) return false;
      setter.call(slider, '100');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await cdp.waitFor(`localStorage.getItem('omd_master_volume') === '1'`, 'master volume restores after assertion');
    await cdp.eval(`document.querySelector('.gear-fab')?.click()`);

    const eta = await cdp.eval(`document.querySelector('.dp-eta')?.textContent || ''`);
    assert(/dawn in \d/.test(eta), `day pill should count down to dawn, saw "${eta}".`);

    await cdp.eval(`document.querySelector('.dash-fab')?.click()`);
    await completeContextLesson(cdp, 'THE CITY PANEL');

    // The Dawn Report teaser and full ledger are both visible commands, so
    // exercise their open and close controls before changing dashboard tabs.
    await cdp.clickButton('VIEW');
    await cdp.waitFor('!!document.querySelector(".stats-modal.dawn-report.on")', 'dawn report opens');
    await cdp.eval(`document.querySelector('button[aria-label="Close dawn report"]')?.click()`);
    await cdp.waitFor('!document.querySelector(".stats-modal.dawn-report.on")', 'dawn report closes');
    await cdp.waitFor(`!!document.querySelector('.rekindle-chip')`, 'rekindle offer follows the dawn report');
    const rekindle = await cdp.eval(`document.querySelector('.rekindle-chip')?.textContent.replace(/\\s+/g, ' ') || ''`);
    assert(/12-day flame/.test(rekindle) && /24/.test(rekindle), `rekindle chip should offer the 12-day flame for 24 standing, saw "${rekindle}".`);
    await cdp.eval(`document.querySelector('.rekindle-chip .rk-btn')?.click()`);
    await cdp.waitFor(`!document.querySelector('.rekindle-chip')`, 'rekindle chip resolves after accepting');
    await cdp.waitFor(`document.body.innerText.includes('the flame burns again')`, 'rekindle success notif');
    await cdp.waitFor(`!!document.querySelector('.mission-chip')`, 'daily mission follows the rekindle offer');
    const mission = await cdp.eval(`document.querySelector('.mission-chip')?.textContent.replace(/\\s+/g, ' ') || ''`);
    assert(/LV 7/.test(mission) && /1\/2/.test(mission), `mission chip should show level and progress, saw "${mission}".`);
    assert(mission.includes('🔥 12d'), `mission chip should surface the rekindled 12-day streak, saw "${mission}".`);
    await cdp.eval(`document.querySelector('.mission-chip .p-x')?.click()`);
    await cdp.eval(`document.querySelector('.stats-fab')?.click()`);
    await cdp.waitFor('document.querySelector(".stats-modal.on h2")?.textContent.includes("CITY LEDGER")', 'stats ledger opens');
    const ledgerWorld = await cdp.eval(`(() => {
      const rows = [...document.querySelectorAll('.stats-modal.on .st')];
      return rows.at(-1)?.textContent || '';
    })()`);
    assert(ledgerWorld.includes('r/meadowbrook') && ledgerWorld.includes('r/ironhollow'), 'Live ledger should list real registered subreddit cities.');
    assert(!/ashfall|deepwater|saltmere|thornwick/i.test(ledgerWorld), 'Live ledger must not backfill fictional subreddit cities.');
    await cdp.eval(`document.querySelector('button[aria-label="Close stats"]')?.click()`);
    await cdp.waitFor('!document.querySelector(".stats-modal.on")', 'stats ledger closes');

    for (const label of ['CITY', 'LIVE', 'TOP', 'MAP', 'WORLD', 'TOWN']) {
      await cdp.clickButton(label);
      if (label === 'CITY') await completeContextLesson(cdp, 'WE BUILD TOGETHER');
      if (label === 'LIVE') await completeContextLesson(cdp, 'WE DECIDE TOGETHER');
      if (label === 'TOP') await completeContextLesson(cdp, 'THE RECORD');
      if (label === 'LIVE') {
        await cdp.waitFor('!!document.querySelector(".chatter-hub") && document.body.innerText.includes("CITY CHATTER HUB")', 'Reddit City Chatter loads');
        const livePanel = await cdp.eval(`document.querySelector('.dash')?.innerText || ''`);
        assert(!livePanel.includes('SAY HI'), 'LIVE discussion must not masquerade as a Reddit action.');
        assert(livePanel.includes('Posting is optional and creates a public Reddit comment'), 'City Chatter must disclose its public Reddit side effect.');
        assert(livePanel.includes('app account'), 'Unapproved-playtest attribution limitation must stay visible.');
        assert(livePanel.includes('ashen_fox') && livePanel.includes('Fortify the north wall'), 'City Chatter should render Reddit-sourced strategy replies.');
        const chatterThread = await cdp.eval(`document.querySelector('.chatter-thread')?.dataset.commentsUrl || ''`);
        assert(chatterThread.includes('/r/meadowbrook/comments/chatter_week_4/'), `City Chatter should target its weekly Reddit post, saw "${chatterThread}".`);

        await cdp.clickSelectorContaining('.chatter-topics button', 'Raid');
        await cdp.waitFor(`(document.querySelector('.chatter-feed')?.textContent || '').includes('quiet_marrow')`, 'Raid chatter category loads from Reddit');
        await cdp.eval(`(() => {
          const field = document.querySelector('.chatter-compose textarea');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          if (!field || !setter) return false;
          setter.call(field, 'Protect the outer fields before dusk.');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
        await cdp.clickButton('POST TO REDDIT');
        await cdp.waitFor(`(document.querySelector('.chatter-feed')?.textContent || '').includes('Protect the outer fields before dusk.')`, 'confirmed Reddit comment returns to the chatter feed');
        await cdp.waitFor(`document.body.innerText.includes('Posted publicly to Reddit as u/mock_user')`, 'Reddit attribution confirmation');
        const chatterAfterPost = await cdp.eval(`(() => ({
          draft: document.querySelector('.chatter-compose textarea')?.value || '',
          author: document.querySelector('.chatter-message .chatter-author')?.textContent || ''
        }))()`);
        assert(chatterAfterPost.draft === '', 'City Chatter should clear the draft only after Reddit confirms the post.');
        assert(chatterAfterPost.author.includes('mock_user'), 'Confirmed post should show its actual Reddit author.');
      }
      if (label === 'WORLD') {
        await cdp.waitFor('document.querySelectorAll(".wm-city").length >= 2', 'multiple world cities render');
        const world = await cdp.eval(`(() => ({
          count: document.querySelectorAll('.wm-city').length,
          names: [...document.querySelectorAll('.wm-name')].map((n) => n.textContent || '')
        }))()`);
        assert(world.count === 2, `LIVE world should render exactly its two registered cities, saw ${world.count}.`);
        assert(world.names.includes('r/meadowbrook') && world.names.includes('r/ironhollow'), 'WORLD view should include your city and a rival city.');
        assert(!world.names.some((name) => /ashfall|deepwater|saltmere|thornwick/i.test(name)), 'LIVE world map must not backfill fictional subreddit cities.');
        // Multi-city travel: selecting a REAL rival city offers a TRAVEL button
        // (fictional filler settlements must not). Assert presence, never click —
        // it would navigate the page out of the test.
        await cdp.eval(`(() => { const el = [...document.querySelectorAll('.wm-city')].find((c) => c.querySelector('.wm-name')?.textContent === 'r/ironhollow'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
        await cdp.waitFor(`(document.querySelector('.wm-travel')?.textContent || '').includes('R/IRONHOLLOW')`, 'rival city selection offers TRAVEL');
        // Your OWN city is real too, but traveling to the subreddit you are
        // already in is a dead-end exit — it must never offer TRAVEL.
        await cdp.eval(`(() => { const el = [...document.querySelectorAll('.wm-city')].find((c) => c.querySelector('.wm-name')?.textContent === 'r/meadowbrook'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
        await cdp.waitFor(`!document.querySelector('.wm-travel') && (document.querySelector('.wm-info')?.textContent || '').includes('r/meadowbrook')`, 'own city offers no TRAVEL');
      }
      await sleep(200);
    }

    await cdp.clickButton('LIVE');
    await cdp.clickButtonContaining('Prepare for Raid');
    await cdp.waitFor('[...document.querySelectorAll("button.co-plan")].some((b) => b.disabled && (b.textContent || "").includes("Prepare for Raid"))', 'council strategy lock after submit');
    await cdp.waitFor('document.body.innerText.includes("of the council backs it")', 'strategy confirmation reports community support');
    await completeContextLesson(cdp, 'MY TASK FOR YOU');
    await cdp.clickButtonContaining('Fortify first');
    await cdp.waitFor('document.body.innerText.includes("Fortify first") && document.querySelectorAll(".cr-opt:disabled").length >= 3', 'vote lock after submit');
    await cdp.waitFor('document.body.innerText.includes("of the city backs this choice")', 'crisis confirmation reports community support');
    await cdp.clickButtonContaining('Stand Vigil');
    await cdp.waitFor('[...document.querySelectorAll(".mk-pledge")].every((b) => b.disabled) && document.body.innerText.includes("you pledged for Mira")', 'pledge locks and confirms');
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

    // SHOP — four accepted contributions mint 4 Coins, but the tenth lifetime
    // civic share routes one into the shared treasury. The wallet therefore
    // moves 4 → 7; the treasury moves 4 → 5 and can finish Outer Fields.
    await cdp.clickButton('SHOP');
    await cdp.waitFor(`(document.querySelector('.ch-coins')?.textContent || '').includes('7 COINS')`, 'coin balance reflects the automatic civic share');
    await cdp.eval(`(() => { const row = [...document.querySelectorAll('.shop-row')].find((r) => r.textContent.includes('Hearth Lantern')); row?.querySelector('.sr-btn')?.click(); })()`);
    await cdp.waitFor(`document.body.innerText.includes('purchased. 4 Coins remain')`, 'purchase debits the exact catalog price once');
    await cdp.waitFor(`(document.querySelector('.ch-coins')?.textContent || '').includes('4 COINS')`, 'coin header reflects the debit');
    await cdp.eval(`(() => { const row = [...document.querySelectorAll('.shop-row')].find((r) => r.textContent.includes('Hearth Lantern')); row?.querySelector('.sr-btn')?.click(); })()`);
    await cdp.waitFor(`[...document.querySelectorAll('.shop-row')].some((r) => r.textContent.includes('Hearth Lantern') && r.textContent.includes('EQUIPPED'))`, 'owned item equips onto the house');
    await cdp.clickButton('EXPAND');
    await cdp.waitFor(`document.body.innerText.includes('VILLAGE LAND FUND') && document.body.innerText.includes('SHARED BY THE WHOLE VILLAGE')`, 'land fund is explicitly collective');
    await cdp.waitFor(`document.body.innerText.includes('CITY TREASURY') && document.body.innerText.includes('5 🪙') && document.body.innerText.includes('3 paid')`, 'treasury shows collective balance and personal civic share');
    const frontierBefore = await cdp.eval(`(() => {
      const scene = window.__village?.scene;
      return {
        mainland: !!scene?.getObjectByName('continuous-mainland'),
        roads: !!scene?.getObjectByName('mainland-road-network'),
        forestCount: scene?.getObjectByName('mainland-forest-canopies')?.count || 0,
        scrubCount: scene?.getObjectByName('mainland-scrub-and-stones')?.count || 0,
        frontier: scene?.getObjectByName('frontier-outer_fields')?.visible ?? false,
        developed: scene?.getObjectByName('land-outer_fields')?.visible ?? false,
      };
    })()`);
    assert(frontierBefore.mainland && frontierBefore.roads && frontierBefore.forestCount > 200 && frontierBefore.scrubCount >= 200, `Mainland should have rolling terrain detail, roads, forest, and scrub, saw ${JSON.stringify(frontierBefore)}.`);
    assert(frontierBefore.frontier && !frontierBefore.developed, `Locked land should be visible wilderness on one mainland, saw ${JSON.stringify(frontierBefore)}.`);
    await cdp.eval(`document.querySelector('.treasury-invest')?.click()`);
    await cdp.waitFor(`document.body.innerText.includes('Outer Fields unlocked with the village treasury')`, 'the collective treasury unlocks the district');
    await cdp.waitFor(`[...document.querySelectorAll('.land-row')].some((r) => r.textContent.includes('Outer Fields') && r.textContent.includes('OPEN'))`, 'the funded district shows as open village land');
    await cdp.waitFor(`window.__village?.scene?.getObjectByName('land-outer_fields')?.visible === true && window.__village?.scene?.getObjectByName('frontier-outer_fields')?.visible === false`, 'funding develops the frontier in the 3D scene');
    await cdp.waitFor(`document.body.innerText.includes('CITY TREASURY') && document.body.innerText.includes('0 🪙')`, 'treasury balance reflects the shared investment');
    await cdp.waitFor(`(document.querySelector('.ch-coins')?.textContent || '').includes('4 COINS')`, 'treasury spending never debits the triggering citizen');

    // Guard the pointer-events regression: the fabs carry the .hud class
    // (pointer-events:none) and must be re-enabled, or real clicks fall through
    // to the 3D canvas. Programmatic .click() below bypasses this, so assert the
    // computed style directly.
    const fabPe = await cdp.eval(`(() => {
      const pe = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).pointerEvents : 'missing'; };
      return { board: pe('.board-fab'), stats: pe('.stats-fab'), gear: pe('.gear-fab'), city: pe('.dash-fab') };
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
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("VAELMAR")', 'landscape city boot');
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
    await cdp.waitFor('document.body?.innerText.includes("ONE MORE DAWN")', 'feed splash boot');
    await cdp.waitFor(`document.body && getComputedStyle(document.body).backgroundImage.includes('splash-art.jpg')`, 'feed splash kingdom art');
    const splash = await cdp.eval(`(() => {
      const cta = document.querySelector('#start-button');
      const rect = cta?.getBoundingClientRect();
      return {
        buttonCount: document.querySelectorAll('button').length,
        ctaText: cta?.textContent || '',
        ctaHeight: rect?.height || 0,
        imageLoaded: getComputedStyle(document.body).backgroundImage.includes('splash-art.jpg'),
        staleLinks: /Docs|r\\/Devvit|Discord/.test(document.body.innerText),
        sharedCity: document.body.innerText.includes('ONE SHARED CITY'),
        overflowX: document.body.scrollWidth > document.documentElement.clientWidth,
        overflowY: document.body.scrollHeight > document.documentElement.clientHeight,
      };
    })()`);
    assert(splash.buttonCount === 1, `Feed splash should have one primary command, saw ${splash.buttonCount}.`);
    assert(splash.ctaText.includes('ENTER THE CITY'), 'Feed splash should expose the Enter the City CTA.');
    assert(splash.ctaHeight >= 44, `Feed splash CTA needs 44px touch height, saw ${splash.ctaHeight}.`);
    assert(splash.imageLoaded, 'Feed splash kingdom art must load from the local bundle.');
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
    // Phoenix Dawn: the memorial must promise the rebirth, not a dead end.
    await cdp.waitFor('document.body.innerText.includes("rises from the ashes at the next dawn")', 'fallen screen promises the Phoenix Dawn');
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

async function reconstructionSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("VAELMAR")', 'reconstruction city boot');
    await cdp.waitFor('!document.querySelector(".loader:not(.done)")', 'reconstruction loader exit');
    let primerGuard = 0;
    while (primerGuard++ < 12 && (await cdp.eval(`!!document.querySelector('.coach')`))) {
      await cdp.eval(`document.querySelector('.coach .co-next')?.click()`);
      await sleep(100);
    }
    await cdp.clickButton('CITY');
    await completeContextLesson(cdp, 'WE BUILD TOGETHER');
    // The energy dome HUD renders on the CITY tab: 6 shield panels + an energy %.
    await cdp.waitFor(`!!document.querySelector('.dome-panel')`, 'the ENERGY DOME panel shows on the CITY tab');
    const domeTxt = await cdp.eval(`(() => { const p = document.querySelector('.dome-panel'); return p ? p.textContent.replace(/\\s+/g,' ') : ''; })()`);
    assert(/ENERGY DOME/.test(domeTxt), 'dome panel is titled ENERGY DOME.');
    assert(/\d+%/.test(domeTxt), `dome panel shows the shield energy percent, saw "${domeTxt}".`);
    const pipCount = await cdp.eval(`document.querySelectorAll('.dome-panel .dome-pip').length`);
    assert(pipCount === 6, `dome shows one pip per segment (6), saw ${pipCount}.`);
    const shatteredPips = await cdp.eval(`document.querySelectorAll('.dome-panel .dome-pip.dome-gone').length`);
    assert(shatteredPips >= 1, `a shattered panel (shield 0) reads as a spent pip, saw ${shatteredPips}.`);
    // A raid damaged a neighbor's home: the whole city rebuilds it (not the owner).
    await cdp.waitFor(`!!document.querySelector('.rebuild-panel')`, 'the REBUILD THE NEIGHBORHOOD panel shows while homes are in ruins');
    const before = await cdp.eval(`(() => { const p = document.querySelector('.rebuild-panel'); return p ? p.textContent.replace(/\\s+/g,' ') : ''; })()`);
    assert(/REBUILD THE NEIGHBORHOOD/.test(before), 'rebuild panel is titled for the shared effort.');
    assert(/ashen_fox/.test(before), `rebuild panel names the owner whose home is being restored, saw "${before}".`);
    assert(/4\/5/.test(before), `rebuild panel shows the shared progress toward the home, saw "${before}".`);
    // One citizen's labor completes the restore -> the whole city rebuilt the home.
    await cdp.clickSelectorContaining('.rebuild-cta', 'CONTRIBUTE LABOR');
    await cdp.waitFor(`document.body.innerText.includes('stands again') || document.body.innerText.includes('rebuilt')`, 'the community restores the home');
    await cdp.waitFor(`!document.querySelector('.rebuild-panel')`, 'the rebuild panel clears once the neighborhood is restored');
  } finally {
    await close();
  }
}

// Reconnect the City: open the daily puzzle from the CITY tab, solve it with the
// Hint button, and confirm the "district connected" payoff + server score/reward.
async function puzzleSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("VAELMAR")', 'puzzle city boot');
    await cdp.waitFor('!document.querySelector(".loader:not(.done)")', 'puzzle loader exit');
    let g = 0;
    while (g++ < 12 && (await cdp.eval(`!!document.querySelector('.coach')`))) {
      await cdp.eval(`document.querySelector('.coach .co-next')?.click()`);
      await sleep(100);
    }
    await cdp.clickButton('CITY');
    await completeContextLesson(cdp, 'WE BUILD TOGETHER');
    // The daily-puzzle entry card, then open the board.
    await cdp.waitFor(`!!document.querySelector('.puzzle-card')`, 'the RECONNECT THE CITY entry shows on the CITY tab');
    await cdp.eval(`document.querySelector('.puzzle-card')?.click()`);
    await cdp.waitFor(`!!document.querySelector('.pz-root')`, 'the puzzle board opens');
    assert(await cdp.eval(`document.body.innerText.toLowerCase().includes('dark district')`), "the board names today's level.");
    // Solve it with the Hint button (each hint nudges a tile toward its solution).
    for (let i = 0; i < 30; i++) {
      if (await cdp.eval(`!!document.querySelector('.pz-banner')`)) break;
      await cdp.eval(`[...document.querySelectorAll('.pz-btn.hint')].find((b) => !b.disabled)?.click()`);
      await sleep(110);
    }
    await cdp.waitFor(`!!document.querySelector('.pz-banner') && document.body.innerText.includes('THE DISTRICT')`, 'the district lights up once every required building is reconnected');
    // The solve posts to the server; the reward / share line surfaces.
    await cdp.waitFor(`document.body.innerText.includes('reconnected in') || document.body.innerText.includes('district is back online')`, 'the solve is scored and the city reward lands');
  } finally {
    await close();
  }
}

async function campSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("VAELMAR")', 'camp city boot');
    await cdp.waitFor('!document.querySelector(".loader:not(.done)")', 'camp loader exit');
    // The first-run primer clears the stage (fabs hidden while Maren speaks),
    // so walk through it before exercising fab-driven surfaces.
    let campPrimerGuard = 0;
    while (campPrimerGuard++ < 12 && (await cdp.eval(`!!document.querySelector('.coach')`))) {
      await cdp.eval(`document.querySelector('.coach .co-next')?.click()`);
      await sleep(100);
    }
    await cdp.clickButton('CITY');
    await completeContextLesson(cdp, 'WE BUILD TOGETHER');
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
    await cdp.waitFor(`location.protocol === 'http:'`, 'portrait page origin');
    await cdp.eval(`localStorage.setItem('omd_coach_v1', '1')`);
    await cdp.call('Page.reload', { ignoreCache: true });
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("VAELMAR")', 'portrait city boot');
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
    assert(!(await cdp.eval(`document.querySelector('.dash')?.classList.contains('on')`)), 'CITY drawer should start closed in portrait so actions remain reachable.');
    await cdp.eval(`document.querySelector('.dash-fab')?.click()`);
    await cdp.waitFor(`document.querySelector('.dash')?.classList.contains('on')`, 'portrait CITY drawer open');
    await cdp.waitFor(`!!document.querySelector('.coach')`, 'portrait contextual advisor appears');
    const stagedDrawer = await cdp.eval(`(() => {
      const dash = document.querySelector('.dash');
      const coach = document.querySelector('.coach');
      const cityFab = document.querySelector('.dash-fab');
      const style = dash ? getComputedStyle(dash) : null;
      const overlaps = (a, b) => {
        if (!a || !b) return true;
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return !(ar.right <= br.left || br.right <= ar.left || ar.bottom <= br.top || br.bottom <= ar.top);
      };
      return {
        active: dash?.classList.contains('coach-active') || false,
        opacity: style?.opacity || '',
        pointer: style?.pointerEvents || '',
        coachHitsCityControl: overlaps(coach, cityFab),
      };
    })()`);
    assert(stagedDrawer.active && stagedDrawer.opacity === '0' && stagedDrawer.pointer === 'none' && !stagedDrawer.coachHitsCityControl, `Portrait advisor must not overlap the CITY drawer or its control, saw ${JSON.stringify(stagedDrawer)}.`);
    await completeContextLesson(cdp, 'THE CITY PANEL');
    await cdp.waitFor(`getComputedStyle(document.querySelector('.dash')).opacity === '1'`, 'portrait drawer reveals after advisor');
    const coveredActions = await cdp.eval(`getComputedStyle(document.querySelector('.hotbar')).pointerEvents`);
    assert(coveredActions === 'none', 'Portrait actions behind the open CITY drawer must not remain clickable.');
  } finally {
    await close();
  }
}

async function optionalNameFailureSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('document.body.innerText.includes("CHOOSE YOUR ROLE")', 'optional-name onboarding');
    await cdp.clickSelectorContaining('.ob-role', 'GUARD');
    await cdp.clickButton('ENTER THE CITY');
    await cdp.waitFor('!document.body.innerText.includes("CHOOSE YOUR ROLE")', 'role accepted despite avatar failure', 30_000);
    const text = await cdp.eval(`document.body.innerText`);
    assert(!text.includes('could not set your role'), 'Optional name failure must not report the accepted role as failed.');
  } finally { await close(); }
}

async function refreshFailureSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("VAELMAR")', 'refresh-failure city boot');
    await cdp.waitFor('!document.querySelector(".loader:not(.done)")', 'refresh-failure loader exit');
    await cdp.clickSelectorContaining('.act', 'GUARD');
    await cdp.waitFor('document.body.innerText.includes("your work lands at the next dawn")', 'accepted action feedback');
    await cdp.waitFor(`[...document.querySelectorAll('.act')].find((b) => b.textContent.includes('GUARD'))?.textContent.includes('✓ ×1 today')`, 'accepted action remains recorded');
    const text = await cdp.eval(`document.body.innerText`);
    assert(!text.includes('the action failed, try again'), 'A committed action must not be reported as failed when refresh fails.');
  } finally { await close(); }
}

async function leaderboardFailureSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("VAELMAR")', 'leaderboard-failure city boot');
    await cdp.eval(`[...document.querySelectorAll('.dash-tab')].find((b) => b.textContent.includes('TOP'))?.click()`);
    await cdp.waitFor('document.body.innerText.includes("city ledger could not be reached")', 'honest leaderboard failure');
    const text = await cdp.eval(`document.querySelector('.dash')?.innerText || ''`);
    assert(!text.includes('saltcedar'), 'Live leaderboard failure must not expose fictional demo rankings.');
  } finally { await close(); }
}

async function firstHouseSmoke(url) {
  const { cdp, close } = await openPage(url);
  try {
    await cdp.waitFor('!!document.querySelector("canvas") && document.body.innerText.includes("VAELMAR")', 'first-house city boot');
    await cdp.waitFor('!document.querySelector(".loader:not(.done)")', 'first-house loader exit');
    // Complete the four essentials so the first contribution can reveal its
    // house lesson instead of competing with first-run onboarding.
    let primerGuard = 0;
    while (primerGuard++ < 12 && (await cdp.eval(`!!document.querySelector('.coach')`))) {
      await cdp.eval(`document.querySelector('.coach .co-next')?.click()`);
      await sleep(100);
    }
    await cdp.clickSelectorContaining('.act', 'GUARD');
    await cdp.waitFor('document.body.innerText.includes("Your house now stands in the city. Build order #3.")', 'first contribution house feedback');
    // Count while the toast is on screen — it expires within seconds, and the
    // lesson walk below can take longer than that on a slow CI runner.
    await sleep(200);
    const count = await cdp.eval(`(document.body.innerText.match(/Your house now stands in the city/g) || []).length`);
    assert(count === 1, `First-house feedback should appear once, saw ${count}.`);
    await completeContextLesson(cdp, 'YOUR HOUSE');
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
await withServer('mock-live refresh failure', 4648, { MOCK_INIT_FAIL_AFTER_MUTATION: '1' }, refreshFailureSmoke);
await withServer('mock-live leaderboard failure', 4649, { MOCK_LEADERBOARD_FAIL: '1' }, leaderboardFailureSmoke);
await withServer('mock-live optional name failure', 4650, { MOCK_ROLE_NULL: '1', MOCK_AVATAR_FAIL: '1' }, optionalNameFailureSmoke);
await withServer('mock-live raid reconstruction', 4651, { MOCK_RAID_AFTERMATH: '1' }, reconstructionSmoke);
await withServer('mock-live daily puzzle', 4652, {}, puzzleSmoke);

console.log('client smoke passed');
