const MASTER_VOLUME_KEY = 'omd_master_volume';
const DEFAULT_MASTER_VOLUME = 1;

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MASTER_VOLUME;
  return Math.min(1, Math.max(0, value));
}

function readMasterVolume(): number {
  if (typeof window === 'undefined') return DEFAULT_MASTER_VOLUME;
  try {
    const stored = window.localStorage.getItem(MASTER_VOLUME_KEY);
    return stored === null ? DEFAULT_MASTER_VOLUME : clampVolume(Number(stored));
  } catch {
    return DEFAULT_MASTER_VOLUME;
  }
}

let masterVolume = readMasterVolume();

export function getMasterVolume(): number {
  return masterVolume;
}

export function setMasterVolume(value: number): number {
  masterVolume = clampVolume(value);
  try {
    window.localStorage.setItem(MASTER_VOLUME_KEY, String(masterVolume));
  } catch {
    /* storage unavailable - keep the in-memory setting */
  }
  return masterVolume;
}
