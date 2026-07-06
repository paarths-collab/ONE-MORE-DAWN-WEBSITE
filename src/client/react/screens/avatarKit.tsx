import { useState } from 'react';
import type { AvatarConfig, Gender } from '../../../shared/types';
import {
  AVATAR_NAME_MAX,
  AVATAR_NAME_MIN,
  GENDER_META,
  GENDERS,
  HAIR_STYLES,
  HAIRS,
  OUTFITS,
  SKINS,
  defaultAvatar,
  sanitizeAvatarName,
} from '../../../shared/avatar';

// AVATAR KIT — the shared pixel-figure renderer + the survivor creator.
// AvatarConfig stores palette INDICES (see shared/avatar.ts); this file is the
// only place that turns them into pixels, so the look is consistent everywhere
// (identity header, citizens list, sidebar, creator preview).

const pick = <T,>(arr: readonly T[], i: number, fallback: T): T => arr[i] ?? fallback;

/** Hair drawn behind the head (long strands framing the face). */
function backHair(styleIdx: number, hair: string) {
  if (HAIR_STYLES[styleIdx] === 'Long') {
    return (
      <>
        <rect x="4.6" y="4" width="1.6" height="8.5" fill={hair} />
        <rect x="13.8" y="4" width="1.6" height="8.5" fill={hair} />
      </>
    );
  }
  return null;
}

/** Hair drawn on top of the head, one shape per style. */
function frontHair(styleIdx: number, hair: string) {
  const style = HAIR_STYLES[styleIdx] ?? 'Crop';
  switch (style) {
    case 'Bald':
      return null;
    case 'Spikes':
      return (
        <>
          <rect x="5.6" y="3.8" width="8.8" height="1.6" fill={hair} />
          <rect x="5.6" y="1.4" width="1.4" height="3" fill={hair} />
          <rect x="7.4" y="0.8" width="1.4" height="3.6" fill={hair} />
          <rect x="9.3" y="1.2" width="1.4" height="3.2" fill={hair} />
          <rect x="11.2" y="0.8" width="1.4" height="3.6" fill={hair} />
          <rect x="13" y="1.6" width="1.4" height="2.8" fill={hair} />
        </>
      );
    case 'Cap':
      return (
        <>
          <rect x="4.6" y="4.6" width="10.8" height="1.4" rx="0.7" fill={hair} />
          <rect x="5.8" y="2.2" width="8.4" height="3" rx="1.4" fill={hair} />
        </>
      );
    case 'Swoop':
      return (
        <>
          <rect x="5.4" y="3" width="9.2" height="2.4" rx="1" fill={hair} />
          <rect x="5.6" y="5" width="5" height="1.5" fill={hair} />
        </>
      );
    case 'Long':
      return (
        <>
          <rect x="5.4" y="2.8" width="9.2" height="2.8" rx="1.2" fill={hair} />
          <rect x="5.6" y="5.2" width="2.4" height="1.3" fill={hair} />
          <rect x="12" y="5.2" width="2.4" height="1.3" fill={hair} />
        </>
      );
    case 'Crop':
    default:
      return (
        <>
          <rect x="5.6" y="3.2" width="8.8" height="2.6" rx="1" fill={hair} />
          <rect x="5.7" y="5.2" width="8.6" height="1.1" fill={hair} />
        </>
      );
  }
}

/** The survivor as pixel art, drawn from an AvatarConfig. Scales to any size. */
export function PixelAvatar({ avatar, size = 32 }: { avatar: AvatarConfig; size?: number }) {
  const skin = pick(SKINS, avatar.skin, SKINS[0]!);
  const hair = pick(HAIRS, avatar.hair, HAIRS[0]!);
  const outfit = pick(OUTFITS, avatar.outfit, OUTFITS[0]!);
  const eye = '#20170f';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`${avatar.name}, ${GENDER_META[avatar.gender].label}`}
    >
      {backHair(avatar.hairStyle, hair)}
      {/* neck (behind body + head) */}
      <rect x="8" y="10.5" width="4" height="3.5" fill={skin} />
      {/* shoulders / shirt */}
      <rect x="3" y="13.5" width="14" height="6.5" rx="2.6" fill={outfit} />
      {/* head */}
      <rect x="5.8" y="3.6" width="8.4" height="8.6" rx="2.4" fill={skin} />
      {/* ears */}
      <rect x="4.9" y="7.2" width="1.3" height="2.1" rx="0.6" fill={skin} />
      <rect x="13.8" y="7.2" width="1.3" height="2.1" rx="0.6" fill={skin} />
      {/* eyes */}
      <rect x="7.9" y="7.4" width="1.4" height="1.5" rx="0.4" fill={eye} />
      <rect x="10.7" y="7.4" width="1.4" height="1.5" rx="0.4" fill={eye} />
      {frontHair(avatar.hairStyle, hair)}
    </svg>
  );
}

// ---------- the creator ----------

const Swatches = ({
  label,
  colors,
  value,
  onPick,
}: {
  label: string;
  colors: readonly string[];
  value: number;
  onPick: (i: number) => void;
}) => (
  <div className="pxl-cre-field">
    <div className="lbl">{label}</div>
    <div className="pxl-cre-swatches">
      {colors.map((c, i) => (
        <button
          key={i}
          type="button"
          className={i === value ? 'pxl-sw on' : 'pxl-sw'}
          style={{ background: c }}
          aria-label={`${label} ${i + 1}`}
          aria-pressed={i === value}
          onClick={() => onPick(i)}
        />
      ))}
    </div>
  </div>
);

const Chips = ({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly string[];
  value: number;
  onPick: (i: number) => void;
}) => (
  <div className="pxl-cre-field">
    <div className="lbl">{label}</div>
    <div className="pxl-cre-chips">
      {options.map((o, i) => (
        <button
          key={o}
          type="button"
          className={i === value ? 'pxl-chip on' : 'pxl-chip'}
          aria-pressed={i === value}
          onClick={() => onPick(i)}
        >
          {o}
        </button>
      ))}
    </div>
  </div>
);

export type AvatarCreatorProps = {
  initial: AvatarConfig | null;
  seed: string;
  busy?: boolean;
  mode?: 'onboard' | 'edit';
  onSave: (avatar: AvatarConfig) => void;
  onCancel?: () => void;
};

/**
 * The survivor builder: name, gender, and pixel look with a live preview.
 * Self-contained (holds draft state); the parent decides the chrome (a
 * full-screen gate on first visit, or an overlay sheet when editing later).
 */
export function AvatarCreator({ initial, seed, busy, mode = 'onboard', onSave, onCancel }: AvatarCreatorProps) {
  const [draft, setDraft] = useState<AvatarConfig>(() => initial ?? defaultAvatar(seed));
  const set = (patch: Partial<AvatarConfig>) => setDraft((d) => ({ ...d, ...patch }));

  const genderIdx = Math.max(0, GENDERS.indexOf(draft.gender));
  const cleanName = sanitizeAvatarName(draft.name);
  const nameOk = cleanName.length >= AVATAR_NAME_MIN;

  const randomize = () =>
    // Vary everything but the name (never clobber what they typed).
    setDraft((d) => ({
      ...defaultAvatar(`${seed}:${d.skin}:${d.hair}:${d.hairStyle}:${d.outfit}:${d.gender}`),
      name: d.name,
    }));

  return (
    <div className="pxl-cre">
      <div className="pxl-cre-preview">
        <div className="disc">
          <PixelAvatar avatar={draft} size={112} />
        </div>
        <div className="who">
          <div className="nm">{cleanName || 'Your survivor'}</div>
          <div className="pr">
            {GENDER_META[draft.gender].label} · {HAIR_STYLES[draft.hairStyle]}
          </div>
        </div>
        <button type="button" className="pxl-cre-dice" onClick={randomize} aria-label="Randomize look">
          🎲 Shuffle
        </button>
      </div>

      <div className="pxl-cre-field">
        <div className="lbl">Survivor name</div>
        <input
          className="pxl-input"
          type="text"
          value={draft.name}
          maxLength={AVATAR_NAME_MAX}
          placeholder="e.g. Ash of the North"
          onChange={(e) => set({ name: e.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="hint">{nameOk ? 'A name your city will remember.' : `At least ${AVATAR_NAME_MIN} letters.`}</div>
      </div>

      <Chips label="Pronouns" options={GENDERS.map((g) => GENDER_META[g].label)} value={genderIdx} onPick={(i) => set({ gender: GENDERS[i] as Gender })} />
      <Swatches label="Skin" colors={SKINS} value={draft.skin} onPick={(i) => set({ skin: i })} />
      <Swatches label="Hair color" colors={HAIRS} value={draft.hair} onPick={(i) => set({ hair: i })} />
      <Chips label="Hair style" options={HAIR_STYLES} value={draft.hairStyle} onPick={(i) => set({ hairStyle: i })} />
      <Swatches label="Outfit" colors={OUTFITS} value={draft.outfit} onPick={(i) => set({ outfit: i })} />

      <div className="pxl-cre-actions">
        {mode === 'edit' && onCancel && (
          <button type="button" className="pxl-btn ghost" style={{ marginTop: 0 }} onClick={onCancel} disabled={busy}>
            ✕ Cancel
          </button>
        )}
        <button
          type="button"
          className="pxl-btn"
          style={{ marginTop: 0 }}
          disabled={!nameOk || busy}
          onClick={() => onSave({ ...draft, name: cleanName })}
        >
          {busy ? '…' : mode === 'edit' ? '✓ Save look' : '☀️ Enter the city'}
        </button>
      </div>
    </div>
  );
}
