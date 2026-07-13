import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The music engine crossfades between looping tracks. The bug this guards:
 * a single shared fade timer let the incoming track's fade-in cancel the
 * outgoing track's fade-out, so the old track kept playing underneath
 * forever (track stacking). Fades must be per-element and stop must leave
 * silence.
 */
class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  loop = false;
  volume = 1;
  paused = true;
  preload = '';
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  cloneNode(): FakeAudio {
    const clone = new FakeAudio(this.src);
    clone.volume = this.volume;
    return clone;
  }
  load(): void {}
}

const playing = () => FakeAudio.instances.filter((a) => !a.paused);

const loadMusic = async () => import('./music');

describe('music engine crossfades', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeAudio.instances = [];
    vi.stubGlobal('window', {
      Audio: FakeAudio,
      localStorage: {
        getItem: (key: string) => key === 'omd_music_muted' ? '0' : null,
        setItem: () => undefined,
      }, // pre-unmuted, full master volume
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (t: ReturnType<typeof setInterval>) => clearInterval(t),
    });
    vi.stubGlobal('Audio', FakeAudio);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('dusk to raid to dawn to stop leaves exactly one, then zero, playing tracks', async () => {
    const music = await loadMusic();
    music.unlockMusic();
    music.playTrack('dusk');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(playing()).toHaveLength(1);

    music.playTrack('raid');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(playing()).toHaveLength(1);
    expect(playing()[0]!.src).toContain('raid');

    music.playTrack('dawn');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(playing()).toHaveLength(1);
    expect(playing()[0]!.src).toContain('dawn');

    music.stopMusic();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(playing()).toHaveLength(0);
  });

  it('rapid switches mid-fade never stack old tracks (single-shared-timer regression)', async () => {
    const music = await loadMusic();
    music.unlockMusic();
    music.playTrack('dusk');
    await vi.advanceTimersByTimeAsync(300); // dusk still fading in
    music.playTrack('raid');
    await vi.advanceTimersByTimeAsync(300); // dusk fading out, raid fading in
    music.playTrack('dawn');
    await vi.advanceTimersByTimeAsync(10_000); // let every fade run to completion
    expect(playing()).toHaveLength(1);
    expect(playing()[0]!.src).toContain('dawn');

    music.stopMusic();
    await vi.advanceTimersByTimeAsync(6000);
    expect(playing()).toHaveLength(0);
  });

  it('applies master-volume changes immediately to the current track', async () => {
    const music = await loadMusic();
    const audioSettings = await import('./audioSettings');
    music.unlockMusic();
    music.playTrack('dusk');
    await vi.advanceTimersByTimeAsync(10_000);

    audioSettings.setMasterVolume(0.25);
    music.refreshMusicVolume();

    expect(playing()).toHaveLength(1);
    expect(playing()[0]!.volume).toBeCloseTo(0.06);
  });

  it('scales SFX playback with the persisted master volume', async () => {
    const audioSettings = await import('./audioSettings');
    const sound = await import('./sound');
    audioSettings.setMasterVolume(0.4);

    sound.playSound('button_click');
    await Promise.resolve();

    const cue = FakeAudio.instances.at(-1);
    expect(cue?.src).toContain('button_click');
    expect(cue?.paused).toBe(false);
    expect(cue?.volume).toBeCloseTo(0.2);
  });
});
