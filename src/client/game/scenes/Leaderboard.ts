import * as Phaser from 'phaser';
import type { FactionId, LeaderboardEntry, LeaderboardResponse } from '../../../shared/types';
import { api } from '../api';
import { backRow, COLORS, FONT, H, heading, panel, W } from '../ui';

const FACTION_LABELS: Record<FactionId, string> = {
  builders: 'Builders',
  wardens: 'Wardens',
  seekers: 'Seekers',
  hearth: 'Hearth',
};

const PANEL_X = 30;
const PANEL_W = W - 60;
const LIST_PANEL_H = 300;
const FACTION_PANEL_H = 250;
const ROW_H = 24;

export class Leaderboard extends Phaser.Scene {
  constructor() {
    super('Leaderboard');
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    heading(this, W / 2, 28, 'HALL OF THE CITY');

    const loading = this.add
      .text(W / 2, H / 2, 'Reading the ledgers…', {
        fontFamily: FONT,
        fontSize: '20px',
        color: COLORS.dim,
      })
      .setOrigin(0.5);

    api
      .leaderboard()
      .then((res) => {
        loading.destroy();
        this.render(res);
      })
      .catch((err: Error) => {
        loading.setText(`The ledgers are sealed.\n${err.message}`);
      });

    backRow(this);
  }

  private render(res: LeaderboardResponse) {
    let y = 100;

    this.list_(y, 'TOP CONTRIBUTORS', res.contributors, 'no deeds recorded yet.');
    y += LIST_PANEL_H + 20;

    this.list_(y, 'BEST SCOUTS', res.scouts, 'no expeditions returned yet.');
    y += LIST_PANEL_H + 20;

    this.factions_(y, res.factions);
  }

  private list_(y: number, title: string, entries: LeaderboardEntry[], emptyMsg: string) {
    const container = panel(this, PANEL_X, y, PANEL_W, LIST_PANEL_H, title);

    if (entries.length === 0) {
      container.add(
        this.add.text(16, 52, emptyMsg, { fontFamily: FONT, fontSize: '18px', color: COLORS.dim }),
      );
      return;
    }

    let rowY = 50;
    entries.forEach((e, i) => {
      const rank = `${i + 1}.`;
      const isTop = i === 0;
      container.add(
        this.add.text(16, rowY, rank, {
          fontFamily: FONT,
          fontSize: '18px',
          color: isTop ? COLORS.accentText : COLORS.dim,
          fontStyle: isTop ? 'bold' : 'normal',
        }),
      );
      container.add(
        this.add.text(54, rowY, e.username, {
          fontFamily: FONT,
          fontSize: '18px',
          color: isTop ? COLORS.accentText : COLORS.text,
          fontStyle: isTop ? 'bold' : 'normal',
        }),
      );
      container.add(
        this.add
          .text(PANEL_W - 16, rowY, String(e.score), {
            fontFamily: FONT,
            fontSize: '18px',
            color: isTop ? COLORS.accentText : COLORS.text,
            fontStyle: isTop ? 'bold' : 'normal',
          })
          .setOrigin(1, 0),
      );
      rowY += ROW_H;
    });
  }

  private factions_(y: number, factions: Record<FactionId, { rep: number; standing: number }>) {
    const container = panel(this, PANEL_X, y, PANEL_W, FACTION_PANEL_H, 'FACTION STANDINGS');

    const order = (Object.keys(factions) as FactionId[]).sort(
      (a, b) => factions[a].standing - factions[b].standing,
    );

    let rowY = 52;
    for (const f of order) {
      const { rep, standing } = factions[f];
      const isLeader = standing === 1;
      const color = isLeader ? COLORS.accentText : COLORS.text;
      container.add(
        this.add.text(16, rowY, `#${standing}`, {
          fontFamily: FONT,
          fontSize: '18px',
          color: isLeader ? COLORS.accentText : COLORS.dim,
          fontStyle: isLeader ? 'bold' : 'normal',
        }),
      );
      container.add(
        this.add.text(64, rowY, FACTION_LABELS[f], {
          fontFamily: FONT,
          fontSize: '18px',
          color,
          fontStyle: isLeader ? 'bold' : 'normal',
        }),
      );
      container.add(
        this.add
          .text(PANEL_W - 16, rowY, `${rep} rep`, {
            fontFamily: FONT,
            fontSize: '18px',
            color,
            fontStyle: isLeader ? 'bold' : 'normal',
          })
          .setOrigin(1, 0),
      );
      rowY += 40;
    }
  }
}
