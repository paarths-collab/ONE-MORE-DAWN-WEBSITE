// Generates the V1 placeholder SFX as tiny 16-bit mono WAV files.
// These are procedurally synthesized here (no external assets), so they are
// unambiguously license-free. Swap them for Kenney CC0 .ogg files anytime by
// dropping same-named files in and updating the extension in src/client/sound.ts.
// Run: node tools/gen-sfx.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public', 'assets', 'sfx');
const RATE = 44100;

// One tone layer: frequency (Hz or [from,to] glide), duration s, gain, wave.
const tone = (samples, f, dur, gain, wave = 'sine', vibrato = 0) => {
  const n = Math.floor(dur * RATE);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const p = i / n;
    // soft attack + exponential decay envelope
    const env = Math.min(1, p / 0.06) * Math.pow(1 - p, 1.6) * gain;
    const freq = Array.isArray(f) ? f[0] + (f[1] - f[0]) * p : f;
    const vib = vibrato ? 1 + vibrato * Math.sin(2 * Math.PI * 6 * t) : 1;
    const ph = 2 * Math.PI * freq * vib * t;
    let s = Math.sin(ph);
    if (wave === 'tri') s = (2 / Math.PI) * Math.asin(Math.sin(ph));
    if (wave === 'soft') s = 0.7 * Math.sin(ph) + 0.3 * Math.sin(2 * ph);
    samples[i] = (samples[i] ?? 0) + s * env;
  }
};

const render = (layers, dur) => {
  const n = Math.floor(dur * RATE);
  const buf = new Float32Array(n);
  for (const L of layers) tone(buf, ...L);
  // to 16-bit PCM with a tiny fade-out to avoid clicks
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const fade = i > n - 400 ? (n - i) / 400 : 1;
    const v = Math.max(-1, Math.min(1, buf[i] * fade));
    pcm.writeInt16LE((v * 32767) | 0, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

// name -> [layers, duration]. Kept soft (gain <= 0.3) so nothing is harsh.
const SFX = {
  button_click: [[[880, 0.045, 0.22, 'tri']], 0.06],
  action_confirm: [[[523, 0.09, 0.22], [784, 0.12, 0.22]], 0.2],
  vote_cast: [[[[600, 720], 0.12, 0.24, 'soft']], 0.14],
  pledge: [[[440, 0.26, 0.22, 'sine', 0.01], [660, 0.26, 0.08]], 0.3],
  raid_warning: [[[[170, 150], 0.34, 0.28, 'tri'], [225, 0.34, 0.14]], 0.36],
  dawn_report: [[[660, 0.28, 0.2, 'soft'], [990, 0.28, 0.12]], 0.32],
  city_fallen: [[[[300, 140], 0.42, 0.26, 'sine'], [150, 0.42, 0.12]], 0.46],
  error_soft: [[[[240, 180], 0.12, 0.22, 'tri']], 0.14],
};

await mkdir(OUT, { recursive: true });
for (const [name, [layers, dur]] of Object.entries(SFX)) {
  await writeFile(join(OUT, `${name}.wav`), render(layers, dur));
}
console.log(`wrote ${Object.keys(SFX).length} sfx to ${OUT}`);
