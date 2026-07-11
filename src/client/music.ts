// Background music engine. Separate from the SFX cues in sound.ts because:
// - it has its own mute (many players want SFX on, music off)
// - it needs a user gesture to start (browsers block autoplay music)
// - it crossfades between tracks by game state (calm dusk vs raid tension)
//
// Tracks live in public/assets/music/. If a file is missing the engine no-ops
// silently; gameplay is never blocked by an audio failure.

export type MusicTrack = 'dusk' | 'raid' | 'dawn';

// Track table: file paths + volume + optional fadeInMs override.
// Files are dropped into public/assets/music/ and served same-origin.
const TRACKS: Record<MusicTrack, { file: string; volume: number }> = {
  dusk: { file: 'assets/music/dusk.mp3', volume: 0.24 },
  raid: { file: 'assets/music/raid.ogg', volume: 0.28 },
  dawn: { file: 'assets/music/dawn.ogg', volume: 0.30 },
};

const MUTE_KEY = 'omd_music_muted';
const FADE_MS = 1600;
const FADE_STEP_MS = 60;

const hasAudio = typeof window !== 'undefined' && typeof window.Audio !== 'undefined';

// Default OFF so nothing surprises a first-time player; they enable via the fab.
let muted = ((): boolean => {
  try {
    const v = window.localStorage.getItem(MUTE_KEY);
    // null => never toggled => default muted
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
})();

let unlocked = false; // set after the first user gesture
let currentTrack: MusicTrack | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentFade: number | null = null;

/** Called on the first user gesture (pointerdown) — browsers gate audio until then. */
export function unlockMusic(): void {
  if (unlocked || !hasAudio) return;
  unlocked = true;
  // If we were asked to play a track before the gesture landed, honor it now.
  if (!muted && currentTrack) startTrack(currentTrack, /* fade */ true);
}

/** Ambient/dusk main theme (also plays under most non-tense states). */
export function playTrack(name: MusicTrack): void {
  if (currentTrack === name) return;
  currentTrack = name;
  if (muted || !unlocked || !hasAudio) return;
  startTrack(name, /* fade */ true);
}

/** Stop music entirely (used when the city has fallen and we want silence). */
export function stopMusic(): void {
  currentTrack = null;
  fadeOutAndStop();
}

export function isMusicMuted(): boolean {
  return muted;
}

export function toggleMusicMuted(): boolean {
  muted = !muted;
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  if (muted) {
    fadeOutAndStop();
  } else if (unlocked && currentTrack) {
    startTrack(currentTrack, /* fade */ true);
  }
  return muted;
}

function startTrack(name: MusicTrack, fade: boolean): void {
  const cfg = TRACKS[name];
  if (!cfg) return;
  const nextAudio = new Audio(cfg.file);
  nextAudio.loop = true;
  nextAudio.volume = fade ? 0 : cfg.volume;
  const play = nextAudio.play();
  if (play && typeof play.catch === 'function') {
    // autoplay blocked — reset unlocked so the next gesture retries.
    play.catch(() => {
      unlocked = false;
    });
  }
  // fade OUT the old one, IN the new one, then swap.
  const oldAudio = currentAudio;
  currentAudio = nextAudio;
  if (fade) {
    fadeAudio(oldAudio, oldAudio ? oldAudio.volume : 0, 0, () => {
      try { oldAudio?.pause(); } catch { /* ignore */ }
    });
    fadeAudio(nextAudio, 0, cfg.volume);
  } else if (oldAudio) {
    try { oldAudio.pause(); } catch { /* ignore */ }
  }
}

function fadeOutAndStop(): void {
  if (!currentAudio) return;
  const a = currentAudio;
  currentAudio = null;
  fadeAudio(a, a.volume, 0, () => {
    try { a.pause(); } catch { /* ignore */ }
  });
}

function fadeAudio(a: HTMLAudioElement | null, from: number, to: number, done?: () => void): void {
  if (!a) { done?.(); return; }
  if (currentFade !== null) window.clearInterval(currentFade);
  const steps = Math.max(1, Math.floor(FADE_MS / FADE_STEP_MS));
  let i = 0;
  a.volume = clamp01(from);
  currentFade = window.setInterval(() => {
    i += 1;
    const t = i / steps;
    a.volume = clamp01(from + (to - from) * t);
    if (i >= steps) {
      if (currentFade !== null) window.clearInterval(currentFade);
      currentFade = null;
      a.volume = clamp01(to);
      done?.();
    }
  }, FADE_STEP_MS);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
