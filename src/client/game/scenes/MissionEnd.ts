import * as Phaser from 'phaser';
import type { MissionCompleteResponse, MissionStatus } from '../../../shared/types';
import { bodyText, button, COLORS, FONT, H, heading, W } from '../ui';

type MissionEndData = {
  result?: MissionCompleteResponse;
  error?: string;
  status: MissionStatus;
};

export class MissionEnd extends Phaser.Scene {
  constructor() {
    super('MissionEnd');
  }

  create(data: MissionEndData) {
    this.cameras.main.setBackgroundColor(COLORS.bg);

    if (data.error || !data.result) {
      heading(this, W / 2, 120, 'THE MISSION WAS LOST');
      bodyText(this, 40, 220, data.error ?? 'Something went wrong on the way home.', W - 80);
    } else {
      const escaped = data.status === 'escaped';
      const title = escaped ? 'YOU MADE IT BACK' : 'DRAGGED BACK HALF-ALIVE';
      heading(this, W / 2, 120, title);

      const loot = data.result.banked;
      const lootParts = Object.entries(loot)
        .filter(([, v]) => (v ?? 0) > 0)
        .map(([k, v]) => `+${v} ${k}`);
      const haulLine =
        lootParts.length > 0 ? lootParts.join('   ') : 'You came back empty-handed.';

      bodyText(this, 40, 220, haulLine, W - 80).setFontSize(22);

      const bankLine = lootParts.length > 0
        ? 'HAUL BANKED → delivered to the city at dawn.'
        : 'The city still counts your courage.';
      bodyText(this, 40, 300, bankLine, W - 80).setFontSize(18);

      let y = 370;
      if (data.result.injured) {
        this.add
          .text(40, y, 'You are INJURED: -1 energy tomorrow.', {
            fontFamily: FONT,
            fontSize: '18px',
            color: '#c4453c',
          });
        y += 40;
      }

      this.add.text(
        40,
        y,
        `+${data.result.contributionGained} contribution`,
        {
          fontFamily: FONT,
          fontSize: '18px',
          color: COLORS.dim,
        },
      );
      y += 40;

      if (data.result.unlockedTitle) {
        this.add.text(40, y, `TITLE UNLOCKED: ${data.result.unlockedTitle}`, {
          fontFamily: FONT,
          fontSize: '20px',
          color: COLORS.accentText,
          fontStyle: 'bold',
        });
        y += 44;
      }

      if (data.status === 'timeout') {
        bodyText(
          this,
          40,
          y + 20,
          'Your air ran out. Half the pack was left in the dark.',
          W - 80,
        ).setFontSize(16);
      } else if (data.status === 'hazard') {
        bodyText(
          this,
          40,
          y + 20,
          'A hazard caught you. You dropped half of what you gathered.',
          W - 80,
        ).setFontSize(16);
      }
    }

    button(this, W / 2, H - 120, 'Back to the City', () => this.scene.start('Dashboard'), {
      width: 360,
      height: 64,
    });
  }
}
