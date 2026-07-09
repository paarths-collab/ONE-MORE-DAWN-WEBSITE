// Minimal V1 sound manager. Local files only (no external URLs), fail-silent,
// global mute persisted in localStorage. Never throws into gameplay.
//
// Assets live in public/assets/sfx/ and are served same-origin (Devvit CSP-safe).
// They are procedurally-generated placeholder tones (see tools/gen-sfx.mjs); swap
// in Kenney CC0 files by dropping same-named files in and updating EXT below.

export type SfxName =
  | 'button_click'
  | 'action_confirm'
  | 'vote_cast'
  | 'pledge'
  | 'raid_warning'
  | 'dawn_report'
  | 'city_fallen'
  | 'error_soft';

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
];
const MUTE_KEY = 'omd_muted';

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
    a.volume = 0.5;
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

/** Play a cue. No-op when muted, unsupported, blocked, or missing — never throws. */
export function playSound(name: SfxName): void {
  if (muted || !hasAudio) return;
  const t = template(name);
  if (!t) return;
  try {
    const node = t.cloneNode(true) as HTMLAudioElement;
    node.volume = t.volume;
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
