import * as Phaser from 'phaser';
import type { InitResponse, Role } from '../../../shared/types';
import { api } from '../api';
import { bodyText, button, COLORS, H, heading, toastText, W, type ButtonOpts } from '../ui';

const ROLES: { role: Role; title: string; blurb: string }[] = [
  { role: 'scout', title: 'Scout', blurb: 'Sees crate contents from afar. +15s air on expeditions.' },
  { role: 'engineer', title: 'Engineer', blurb: 'Repair actions restore more power.' },
  { role: 'medic', title: 'Medic', blurb: 'Treatment actions yield more medicine.' },
  { role: 'farmer', title: 'Farmer', blurb: 'Growing actions yield more food.' },
  { role: 'guard', title: 'Guard', blurb: 'Guarding lowers threat further.' },
  { role: 'speaker', title: 'Speaker', blurb: 'Every action also lifts the city’s morale.' },
];

export class RoleSelect extends Phaser.Scene {
  constructor() {
    super('RoleSelect');
  }

  create(data: { init: InitResponse }) {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    heading(this, W / 2, 30, 'WHO ARE YOU IN THIS CITY?');

    const firstPick = data.init.player.role === null;
    bodyText(
      this,
      40,
      90,
      firstPick
        ? 'You live in the last city. Spend today’s energy to gather resources, vote on a crisis, and help the city survive one more dawn. Tomorrow, the city changes based on what everyone did.\n\nChoose your role:'
        : 'Changing roles takes effect immediately but can only be done once every 3 days.',
      W - 80,
    );

    ROLES.forEach((r, i) => {
      const y = 300 + i * 130;
      const opts: ButtonOpts = { width: 620, height: 110 };
      if (data.init.player.role === r.role) {
        opts.color = 0x3a5f3a;
      }
      button(this, W / 2, y, `${r.title}\n${r.blurb}`, () => this.pick(r.role), opts);
    });

    if (!firstPick) {
      button(this, W / 2, H - 70, '← Back to City', () => this.scene.start('Dashboard'), {
        width: 320,
        height: 56,
        color: 0x2a2e33,
      });
    }
  }

  private pick(role: Role) {
    api
      .chooseRole(role)
      .then(() => this.scene.start('Dashboard'))
      .catch((err: Error) => toastText(this, err.message));
  }
}
