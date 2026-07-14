// Minimal V1 sound manager. Local files only (no external URLs), fail-silent,
// global mute persisted in localStorage. Never throws into gameplay.
//
// Assets live in public/assets/sfx/ and are served same-origin (Devvit CSP-safe).

import { getMasterVolume } from './audioSettings';

export type SfxName =
  | 'button_click'
  | 'action_confirm'
  | 'vote_cast'
  | 'pledge'
  | 'raid_warning'
  | 'dawn_report'
  | 'city_fallen'
  | 'error_soft'
  | 'siege_bell'
  | 'fireball'
  | 'impact_hit'
  | 'wall_crack'
  | 'house_collapse'
  | 'rebuild_done'
  | 'dome_block'
  | 'dome_pierce'
  | 'dome_shatter'
  | 'dome_repair';

const EXT = 'wav'; // change to 'ogg'/'mp3' if you swap in Kenney files with that extension
const NAMES: SfxName[] = [
  'button_click',
  'action_confirm',
  'vote_cast',
  'pledge',
  'raid_warning',
  'dawn_report',
  'city_fallen',
  'error_soft',
  'siege_bell',
  'fireball',
  'impact_hit',
  'wall_crack',
  'house_collapse',
  'rebuild_done',
  'dome_block',
  'dome_pierce',
  'dome_shatter',
  'dome_repair',
];
const MUTE_KEY = 'omd_muted';
const SFX_VOLUME = 0.5;

const hasAudio = typeof window !== 'undefined' && typeof window.Audio !== 'undefined';

let muted = ((): boolean => {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();

// One decoded template Audio per sound; playback clones it so rapid repeats overlap.
const templates = new Map<SfxName, HTMLAudioElement>();
function template(name: SfxName): HTMLAudioElement | null {
  if (!hasAudio) return null;
  let a = templates.get(name);
  if (!a) {
    a = new Audio(`assets/sfx/${name}.${EXT}`);
    a.preload = 'auto';
    a.volume = SFX_VOLUME;
    templates.set(name, a);
  }
  return a;
}

/** Preload the sound files (optional; playback also lazy-loads). Safe to call once. */
export function preloadSounds(): void {
  if (!hasAudio) return;
  for (const n of NAMES) {
    try {
      template(n)?.load();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Prime audio inside strict webviews (Reddit app / embedded browsers): some
 * only allow playback that traces to a user gesture, so the FIRST pointerdown
 * plays a zero-volume cue to earn the permission. Safe to call repeatedly;
 * fail-silent like everything else here.
 */
let unlocked = false;
export function unlockAudio(): void {
  if (unlocked || !hasAudio) return;
  unlocked = true;
  try {
    const t = template('button_click');
    if (!t) return;
    const node = t.cloneNode(true) as HTMLAudioElement;
    node.volume = 0;
    void node
      .play()
      .then(() => node.pause())
      .catch(() => {
        unlocked = false; // gesture didn't count — try again on the next one
      });
  } catch {
    unlocked = false;
  }
}

/** Play a cue. No-op when muted, unsupported, blocked, or missing — never throws. */
export function playSound(name: SfxName): void {
  if (muted || !hasAudio) return;
  const t = template(name);
  if (!t) return;
  try {
    const node = t.cloneNode(true) as HTMLAudioElement;
    node.volume = t.volume * getMasterVolume();
    // play() returns a promise in modern browsers; swallow autoplay/decoding rejections
    void node.play().catch(() => {});
  } catch {
    /* audio unavailable — ignore */
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    /* storage unavailable — keep in-memory state */
  }
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}
