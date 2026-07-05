import * as Phaser from 'phaser';
import { H, W } from './ui';

/**
 * Pixel Village UI toolkit — pure Phaser factory helpers (no scene state).
 * Source of truth for values: docs/design/DESIGN_SYSTEM.md and
 * docs/design/Pixel Village.dc.html. Scenes consume these builders; no
 * ad-hoc colors/fonts in scene code.
 */

export const PX = {
  bg0: 0x0c0a0a,
  bg1: 0x131010,
  card: 0x1b1717,
  card2: 0x231d1d,
  line: 0x2f2828,
  line2: 0x403636,
  gold: 0xe8c34a,
  goldbg: 0x2a2312,
  goldline: 0x6e5b1e,
  green: 0x4caf50,
  greenbg: 0x152914,
  greenline: 0x2e5b2c,
  blue: 0x6c8be0,
  red: 0xa03030,
  redbg: 0x2a1212,
  redline: 0x5e2020,
  // HUD construction colors (rgba chips / avatar outline in the design)
  chip: 0x140e08, // rgba(20,14,8,.92) HUD chip base
  panelBg: 0x120d08, // rgba(18,13,8,.96) inspector/panel base
  outline: 0x0e0c0c, // 2px pixel-avatar outline
  skin: 0xd9a878, // villager face
  // string forms for text colors:
  ink: '#e8e2d6',
  mut: '#8f8578',
  goldT: '#e8c34a',
  greenT: '#4caf50',
  redT: '#d66666',
  // terrain
  grassA: 0x5b8c3a,
  grassB: 0x548334,
  path: 0xc7a768,
  pathEdge: 0x9c7d44,
  sand: 0xd9c79b,
  water: 0x3a78a0,
  water2: 0x346c90,
  dock: 0x8f6a42,
} as const;

export const PIXEL_FONT = 'Silkscreen, monospace';
export const MONO_FONT = "'JetBrains Mono', monospace";

/** 0xRRGGBB → '#rrggbb' (for Phaser text color strings). */
export const hexStr = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** Silkscreen label style (headings, HUD chips). */
export const pxLabel = (
  size: number,
  color: string = PX.goldT,
): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: PIXEL_FONT,
  fontSize: `${size}px`,
  color,
  fontStyle: 'bold',
});

/** JetBrains Mono style (values, body, roles). Weight is a CSS weight string. */
export const monoText = (
  size: number,
  color: string = PX.ink,
  weight = '700',
): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: MONO_FONT,
  fontSize: `${size}px`,
  color,
  fontStyle: weight,
});

const roundChip = (
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number | Phaser.Types.GameObjects.Graphics.RoundedRectRadius,
  fill: number,
  alpha: number,
  strokeW: number,
  stroke: number,
): void => {
  g.fillStyle(fill, alpha);
  g.fillRoundedRect(x, y, w, h, radius);
  g.lineStyle(strokeW, stroke, 1);
  g.strokeRoundedRect(x, y, w, h, radius);
};

/** 54px circle badge — cycle number + "CYCLE". Centered on (x, y). */
export const cycleBadge = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  cycleNum: number,
): Phaser.GameObjects.Container => {
  const g = scene.add.graphics();
  g.fillStyle(PX.card2, 1);
  g.fillCircle(0, 0, 27);
  g.lineStyle(3, PX.gold, 1);
  g.strokeCircle(0, 0, 27);
  const num = scene.add.text(0, -5, String(cycleNum), pxLabel(14)).setOrigin(0.5);
  const lab = scene.add.text(0, 9, 'CYCLE', pxLabel(6, PX.mut)).setOrigin(0.5);
  return scene.add.container(x, y, [g, num, lab]);
};

/** Gold-lined chip with village name + sub. Top-left anchored at (x, y). */
export const namePlate = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  name: string,
  sub: string,
): Phaser.GameObjects.Container => {
  const h = 24;
  const nameT = scene.add.text(16, h / 2, name, pxLabel(11, PX.ink)).setOrigin(0, 0.5);
  const subT = scene.add
    .text(16 + nameT.width + 6, h / 2, sub, monoText(9, PX.mut, '500'))
    .setOrigin(0, 0.5);
  const w = subT.x + subT.width + 12;
  const g = scene.add.graphics();
  roundChip(g, 0, 0, w, h, { tl: 0, bl: 0, tr: 8, br: 8 }, PX.chip, 0.92, 2, PX.goldline);
  return scene.add.container(x, y, [g, nameT, subT]);
};

export type ProsperityBar = Phaser.GameObjects.Container & { setPct(n: number): void };

/** 150×10 gold bar + "PROSPERITY" label. Top-left anchored at (x, y). */
export const prosperityBar = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  pct: number,
): ProsperityBar => {
  const track = scene.add.graphics();
  roundChip(track, 0, 0, 150, 10, 5, PX.chip, 0.9, 2, PX.goldline);
  const fill = scene.add.graphics();
  const label = scene.add.text(158, 5, 'PROSPERITY', pxLabel(7)).setOrigin(0, 0.5);
  const c = scene.add.container(x, y, [track, fill, label]) as ProsperityBar;
  c.setPct = (n: number) => {
    const clamped = Math.max(0, Math.min(100, n));
    fill.clear();
    if (clamped > 0) {
      fill.fillStyle(PX.gold, 1);
      fill.fillRoundedRect(2, 2, Math.max(3, (146 * clamped) / 100), 6, 3);
    }
  };
  c.setPct(pct);
  return c;
};

export type PillHandle = {
  container: Phaser.GameObjects.Container;
  setValue(v: string | number): void;
};

/** Rounded-99 resource chip: icon square + gold value + mut label. Centered on (x, y). */
export const resourcePill = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  iconColor: number,
  value: string | number,
  label: string,
): PillHandle => {
  const h = 26;
  const bg = scene.add.graphics();
  const icon = scene.add.rectangle(0, 0, 10, 10, iconColor).setStrokeStyle(1, PX.outline);
  const valT = scene.add.text(0, 0, String(value), monoText(13, PX.goldT, '800')).setOrigin(0, 0.5);
  const labT = scene.add.text(0, 0, label, pxLabel(7, PX.mut)).setOrigin(0, 0.5);
  const container = scene.add.container(x, y, [bg, icon, valT, labT]);
  const layout = () => {
    const w = 9 + 10 + 7 + valT.width + 7 + labT.width + 13;
    bg.clear();
    roundChip(bg, -w / 2, -h / 2, w, h, h / 2, PX.chip, 0.92, 2, PX.goldline);
    icon.setPosition(-w / 2 + 14, 0);
    valT.setPosition(-w / 2 + 26, 0);
    labT.setPosition(valT.x + valT.width + 7, 0);
    container.setSize(w, h);
  };
  layout();
  return {
    container,
    setValue: (v) => {
      valT.setText(String(v));
      layout();
    },
  };
};

export type RibbonHandle = {
  container: Phaser.GameObjects.Container;
  setCount(c: string | number): void;
};

/** Floating building label: accent-lined pill, name + count. Centered on (x, y). */
export const ribbon = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  name: string,
  count: string | number,
  accent: number = PX.gold,
): RibbonHandle => {
  const h = 22;
  const bg = scene.add.graphics();
  const nameT = scene.add.text(0, 0, name, pxLabel(9, hexStr(accent))).setOrigin(0, 0.5);
  const cntT = scene.add.text(0, 0, String(count), monoText(9, PX.ink, '700')).setOrigin(0, 0.5);
  const container = scene.add.container(x, y, [bg, nameT, cntT]);
  const layout = () => {
    const w = 11 + nameT.width + 7 + cntT.width + 11;
    bg.clear();
    roundChip(bg, -w / 2, -h / 2, w, h, 6, PX.chip, 0.92, 2, accent);
    nameT.setPosition(-w / 2 + 11, 0);
    cntT.setPosition(nameT.x + nameT.width + 7, 0);
    container.setSize(w, h);
  };
  layout();
  return {
    container,
    setCount: (c) => {
      cntT.setText(String(c));
      layout();
    },
  };
};

/** 52px bordered square + Silkscreen label beneath. Square centered on (x, y). */
export const bottomButton = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  lineColor: number,
  onClick: () => void,
): Phaser.GameObjects.Container => {
  const g = scene.add.graphics();
  roundChip(g, -26, -26, 52, 52, 9, PX.chip, 0.94, 2, lineColor);
  const iconSq = scene.add.rectangle(0, 0, 14, 14, lineColor).setStrokeStyle(2, PX.outline);
  const labT = scene.add.text(0, 30, label, pxLabel(7, hexStr(lineColor))).setOrigin(0.5, 0);
  const hit = scene.add
    .rectangle(0, 0, 52, 52, 0xffffff, 0)
    .setInteractive({ useHandCursor: true });
  const container = scene.add.container(x, y, [g, iconSq, labT, hit]);
  hit.on('pointerdown', () => container.setScale(0.94));
  hit.on('pointerup', () => {
    container.setScale(1);
    onClick();
  });
  hit.on('pointerout', () => container.setScale(1));
  return container;
};

export type VillagerOpts = { color: number; hair: number; name: string; online: boolean };

/**
 * 26px pixel avatar: hair cap + face + body (2px outline), name tag, oval
 * shadow, subtle bob tween. Feet sit at local y=0; caller positions/tweens
 * the returned container to walk.
 */
export const pixelVillager = (
  scene: Phaser.Scene,
  opts: VillagerOpts,
): Phaser.GameObjects.Container => {
  const shadow = scene.add.graphics();
  shadow.fillStyle(0x000000, 0.3);
  shadow.fillEllipse(0, 2, 20, 6);

  const av = scene.add.graphics();
  // body 22×15 (feet at y=0)
  av.fillStyle(opts.color, 1);
  av.fillRoundedRect(-11, -15, 22, 15, 4);
  av.lineStyle(2, PX.outline, 1);
  av.strokeRoundedRect(-11, -15, 22, 15, 4);
  // face 14×7 with 2px side outlines
  av.fillStyle(PX.skin, 1);
  av.fillRect(-7, -21, 14, 7);
  av.fillStyle(PX.outline, 1);
  av.fillRect(-9, -21, 2, 7);
  av.fillRect(7, -21, 2, 7);
  // hair cap 16×10, rounded top
  const cap = { tl: 5, tr: 5, bl: 0, br: 0 };
  av.fillStyle(opts.hair, 1);
  av.fillRoundedRect(-8, -31, 16, 10, cap);
  av.lineStyle(2, PX.outline, 1);
  av.strokeRoundedRect(-8, -31, 16, 10, cap);
  const avatar = scene.add.container(0, 0, [av]);

  const tagT = scene.add
    .text(0, 0, opts.name, pxLabel(8, opts.online ? PX.greenT : PX.ink))
    .setOrigin(0.5);
  const tw = tagT.width + 12;
  const th = tagT.height + 4;
  const tagBg = scene.add.graphics();
  roundChip(tagBg, -tw / 2, -41 - th, tw, th, 3, 0x0a0808, 0.9, 1, opts.online ? PX.green : PX.line2);
  tagT.setPosition(0, -41 - th / 2);

  const container = scene.add.container(0, 0, [shadow, avatar, tagBg, tagT]);
  scene.tweens.add({
    targets: avatar,
    y: -2,
    duration: 600,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
  return container;
};

/** Dashboard stat card: top edge accent, icon + label, big value, sub. Top-left anchored. */
export const statCard = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  iconColor: number,
  label: string,
  value: string | number,
  sub: string,
): Phaser.GameObjects.Container => {
  const h = 86;
  const g = scene.add.graphics();
  roundChip(g, 0, 0, w, h, 8, PX.card, 1, 1, PX.line2);
  g.fillStyle(iconColor, 1);
  g.fillRect(2, 0, w - 4, 3);
  const icon = scene.add.rectangle(20, 19, 10, 10, iconColor).setStrokeStyle(1, PX.outline);
  const labT = scene.add.text(32, 19, label, monoText(10, PX.mut, '700')).setOrigin(0, 0.5);
  const valT = scene.add.text(15, 32, String(value), monoText(25, PX.ink, '800'));
  const subT = scene.add.text(15, 64, sub, monoText(10, PX.mut, '600'));
  return scene.add.container(x, y, [g, icon, labT, valT, subT]);
};

/** Zone occupancy row: label left, count/cap right, fill bar below. Top-left anchored. */
export const occupancyRow = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  label: string,
  count: number,
  cap: number,
  barColor: number,
): Phaser.GameObjects.Container => {
  const labT = scene.add.text(0, 6, label, monoText(11, PX.ink, '700')).setOrigin(0, 0.5);
  const cntT = scene.add
    .text(w, 6, `${count}/${cap}`, monoText(10, PX.goldT, '600'))
    .setOrigin(1, 0.5);
  const bar = scene.add.graphics();
  roundChip(bar, 0, 16, w, 9, 4, PX.bg0, 1, 1, PX.line);
  const pct = cap > 0 ? Math.min(1, Math.max(0, count / cap)) : 0;
  if (pct > 0) {
    bar.fillStyle(barColor, 1);
    bar.fillRoundedRect(1, 17, Math.max(3, (w - 2) * pct), 7, 3);
  }
  return scene.add.container(x, y, [labT, cntT, bar]);
};

/** Generic dark rounded panel (inspector / notice board base). Top-left anchored. */
export const panel = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  borderColor: number = PX.line2,
): Phaser.GameObjects.Container => {
  const g = scene.add.graphics();
  roundChip(g, 0, 0, w, h, 10, PX.panelBg, 0.96, 2, borderColor);
  return scene.add.container(x, y, [g]);
};

/** Bottom toast in the pixel style; auto-fades (mirrors ui.ts toastText timing). */
export const pixelToast = (scene: Phaser.Scene, message: string): void => {
  const t = scene.add.text(0, 0, message, monoText(11, PX.ink, '700')).setOrigin(0.5);
  const w = t.width + 36;
  const h = t.height + 20;
  const g = scene.add.graphics();
  roundChip(g, -w / 2, -h / 2, w, h, 7, PX.card2, 1, 1.5, PX.goldline);
  const c = scene.add.container(W / 2, H - 160, [g, t]).setDepth(1000);
  scene.tweens.add({
    targets: c,
    alpha: 0,
    delay: 1800,
    duration: 400,
    onComplete: () => c.destroy(),
  });
};
