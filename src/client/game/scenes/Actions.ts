import * as Phaser from 'phaser';
import type { ActionType, InitResponse } from '../../../shared/types';
import { api } from '../api';
import { backRow, bodyText, button, COLORS, FONT, heading, toastText, W } from '../ui';

const ACTIONS: { action: ActionType; title: string; blurb: string; boostedBy: string }[] = [
  { action: 'grow_food', title: 'Grow Food', blurb: '+3 food for the stores', boostedBy: 'farmer' },
  { action: 'repair_power', title: 'Repair Generator', blurb: '+4 power to the grid', boostedBy: 'engineer' },
  { action: 'treat_sick', title: 'Treat the Sick', blurb: '+2 medicine prepared', boostedBy: 'medic' },
  { action: 'guard_wall', title: 'Guard the Wall', blurb: '-5 threat, +2 defense', boostedBy: 'guard' },
];

export class Actions extends Phaser.Scene {
  private init_!: InitResponse;
  private energyText!: Phaser.GameObjects.Text;
  private mineText!: Phaser.GameObjects.Text;

  constructor() {
    super('Actions');
  }

  create(data: { init: InitResponse }) {
    this.init_ = data.init;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    heading(this, W / 2, 30, 'SPEND YOUR ENERGY');

    // council nudge badge (spec §10)
    const tally = Object.entries(this.init_.strategyVotes).sort(([, a], [, b]) => b - a);
    if (tally.length > 0) {
      this.add
        .text(W / 2, 84, `Council priority: ${tally[0]![0].replace(/_/g, ' ')}`, {
          fontFamily: FONT, fontSize: '18px', color: '#d9a429',
        })
        .setOrigin(0.5, 0);
    }

    this.energyText = this.add
      .text(W / 2, 120, '', { fontFamily: FONT, fontSize: '24px', color: COLORS.text })
      .setOrigin(0.5, 0);
    this.mineText = this.add
      .text(W / 2, 156, '', { fontFamily: FONT, fontSize: '17px', color: COLORS.dim })
      .setOrigin(0.5, 0);
    this.refreshLabels(this.init_.player.energyUsedToday, this.init_.yourActionsToday);

    ACTIONS.forEach((a, i) => {
      const boosted = this.init_.player.role === a.boostedBy;
      const opts: { width: number; height: number; color?: number } = { width: 620, height: 120 };
      if (boosted) opts.color = 0x3a5f3a;
      button(
        this, W / 2, 260 + i * 150,
        `${a.title}${boosted ? '  ★ role bonus' : ''}\n${a.blurb}`,
        () => this.act(a.action),
        opts,
      );
    });

    bodyText(this, 50, 880, 'Expeditions are launched from the city screen. Every point of energy you spend is tallied at dawn.', W - 100).setFontSize(17);
    backRow(this);
  }

  private refreshLabels(used: number, mine: InitResponse['yourActionsToday']) {
    const left = this.init_.effectiveEnergy - used;
    this.energyText.setText(`Energy left today: ${left}/${this.init_.effectiveEnergy}`);
    const summary = Object.entries(mine)
      .map(([k, v]) => `${k.replace(/_/g, ' ')} ×${v}`)
      .join('   ');
    this.mineText.setText(summary ? `Today you did: ${summary}` : 'You have not acted today.');
  }

  private act(action: ActionType) {
    api
      .takeAction(action)
      .then((res) => {
        this.init_ = { ...this.init_, player: res.player, yourActionsToday: res.yourActionsToday };
        this.refreshLabels(res.player.energyUsedToday, res.yourActionsToday);
        toastText(this, 'The city is a little stronger.');
      })
      .catch((err: Error) => toastText(this, err.message));
  }
}
