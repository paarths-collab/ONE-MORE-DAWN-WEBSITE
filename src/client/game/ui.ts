import * as Phaser from 'phaser';

export const W = 720;
export const H = 1280;

export const COLORS = {
  bg: 0x121417,
  panel: 0x1d2126,
  panelLine: 0x343b44,
  text: '#e8e6e3',
  dim: '#9aa3ad',
  accent: 0xd97b29, // dawn orange
  accentText: '#d97b29',
  good: 0x4caf6d,
  bad: 0xc4453c,
  warn: 0xd9a429,
} as const;

export const FONT = 'Verdana, Arial, sans-serif';

export type ButtonOpts = {
  width?: number;
  height?: number;
  color?: number;
  disabled?: boolean;
};

/** Flat rectangle button with a label. Returns the container. */
export const button = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: ButtonOpts = {},
): Phaser.GameObjects.Container => {
  const width = opts.width ?? 300;
  const height = opts.height ?? 64;
  const color = opts.disabled ? 0x2a2e33 : (opts.color ?? COLORS.accent);
  const rect = scene.add
    .rectangle(0, 0, width, height, color, 1)
    .setStrokeStyle(2, COLORS.panelLine);
  const text = scene.add
    .text(0, 0, label, {
      fontFamily: FONT,
      fontSize: '24px',
      color: opts.disabled ? COLORS.dim : COLORS.text,
      align: 'center',
      wordWrap: { width: width - 20 },
    })
    .setOrigin(0.5);
  const container = scene.add.container(x, y, [rect, text]);
  container.setSize(width, height);
  if (!opts.disabled) {
    rect.setInteractive({ useHandCursor: true });
    rect.on('pointerdown', () => rect.setScale(0.97));
    rect.on('pointerup', () => {
      rect.setScale(1);
      onClick();
    });
    rect.on('pointerout', () => rect.setScale(1));
  }
  return container;
};

/** Panel with title; container positioned at (x, y) top-left. */
export const panel = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  title?: string,
): Phaser.GameObjects.Container => {
  const rect = scene.add
    .rectangle(width / 2, height / 2, width, height, COLORS.panel, 1)
    .setStrokeStyle(2, COLORS.panelLine);
  const children: Phaser.GameObjects.GameObject[] = [rect];
  if (title) {
    children.push(
      scene.add.text(16, 10, title, {
        fontFamily: FONT,
        fontSize: '20px',
        color: COLORS.accentText,
        fontStyle: 'bold',
      }),
    );
  }
  return scene.add.container(x, y, children);
};

/** Labeled horizontal resource bar (0..max). */
export const resourceBar = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  value: number,
  max: number,
  barColor: number,
): Phaser.GameObjects.Container => {
  const barW = 280;
  const pct = Math.max(0, Math.min(1, value / max));
  const container = scene.add.container(x, y);
  container.add(
    scene.add.text(0, 0, label, { fontFamily: FONT, fontSize: '18px', color: COLORS.dim }),
  );
  container.add(scene.add.rectangle(0, 28, barW, 16, 0x11141a, 1).setOrigin(0, 0.5));
  container.add(scene.add.rectangle(0, 28, barW * pct, 16, barColor, 1).setOrigin(0, 0.5));
  container.add(
    scene.add
      .text(barW + 10, 28, String(Math.round(value)), {
        fontFamily: FONT,
        fontSize: '18px',
        color: COLORS.text,
      })
      .setOrigin(0, 0.5),
  );
  return container;
};

export const heading = (scene: Phaser.Scene, x: number, y: number, text: string) =>
  scene.add
    .text(x, y, text, { fontFamily: FONT, fontSize: '34px', color: COLORS.text, fontStyle: 'bold' })
    .setOrigin(0.5, 0);

export const bodyText = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  width: number,
) =>
  scene.add.text(x, y, text, {
    fontFamily: FONT,
    fontSize: '20px',
    color: COLORS.text,
    wordWrap: { width },
    lineSpacing: 6,
  });

/** Standard back-to-city nav row used by every sub-scene. */
export const backRow = (scene: Phaser.Scene, target = 'Dashboard') =>
  button(scene, W / 2, H - 70, '← Back to City', () => scene.scene.start(target), {
    width: 320,
    height: 56,
    color: 0x2a2e33,
  });

export const toastText = (scene: Phaser.Scene, message: string) => {
  const t = scene.add
    .text(W / 2, H - 160, message, {
      fontFamily: FONT,
      fontSize: '20px',
      color: COLORS.text,
      backgroundColor: '#1d2126',
      padding: { x: 14, y: 10 },
    })
    .setOrigin(0.5)
    .setDepth(1000);
  scene.tweens.add({
    targets: t,
    alpha: 0,
    delay: 1800,
    duration: 400,
    onComplete: () => t.destroy(),
  });
};
