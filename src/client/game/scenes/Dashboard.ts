import * as Phaser from 'phaser';
import type { InitResponse } from '../../../shared/types';
import { api } from '../api';
import {
  bodyText,
  button,
  COLORS,
  FONT,
  H,
  heading,
  panel,
  resourceBar,
  toastText,
  W,
} from '../ui';

export class Dashboard extends Phaser.Scene {
  private data_?: InitResponse;

  constructor() {
    super('Dashboard');
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    const loading = this.add
      .text(W / 2, H / 2, 'Reaching the city…', {
        fontFamily: FONT,
        fontSize: '24px',
        color: COLORS.dim,
      })
      .setOrigin(0.5);

    api
      .init()
      .then((data) => {
        this.data_ = data;
        loading.destroy();
        if (!data.player.role) {
          this.scene.start('RoleSelect', { init: data });
          return;
        }
        this.render(data);
      })
      .catch((err: Error) => {
        loading.setText(`Could not reach the city.\n${err.message}`);
      });
  }

  private render(data: InitResponse) {
    const { city, crisis, player } = data;

    heading(this, W / 2, 28, `THE LAST CITY — DAY ${city.day}`);
    this.add
      .text(
        W / 2,
        74,
        `Cycle ${city.cycle} · ${player.username} the ${player.role ?? 'undecided'} · streak ${player.streak}`,
        {
          fontFamily: FONT,
          fontSize: '18px',
          color: COLORS.dim,
        },
      )
      .setOrigin(0.5, 0);

    if (city.status === 'fallen') {
      bodyText(
        this,
        40,
        140,
        'The city has fallen. Its story is preserved in the timeline. A moderator can begin a new cycle.',
        W - 80,
      );
      button(this, W / 2, 320, 'View Timeline', () => this.scene.start('Timeline'));
      return;
    }

    if (data.activeLaw) {
      const law = data.activeLaw;
      const banner = panel(this, 20, 100, W - 40, 44);
      banner.add(
        this.add.text(16, 8, `⚖ LAW: ${law.label}`, {
          fontFamily: FONT,
          fontSize: '18px',
          color: COLORS.accentText,
          fontStyle: 'bold',
        }),
      );
      const cost = this.add
        .text(W - 56, 14, `− ${law.cost}`, {
          fontFamily: FONT,
          fontSize: '14px',
          color: '#c4453c',
        })
        .setOrigin(1, 0);
      banner.add(cost);
      banner.add(
        this.add
          .text(cost.x - cost.width - 16, 14, `+ ${law.buff}`, {
            fontFamily: FONT,
            fontSize: '14px',
            color: '#4caf6d',
          })
          .setOrigin(1, 0),
      );
    }

    const res = panel(this, 20, 150, W - 40, 260, 'CITY REPORT');
    res.add(resourceBar(this, 30, 46, 'FOOD', city.food, 100, COLORS.good));
    res.add(resourceBar(this, 30, 106, 'POWER', city.power, 100, COLORS.warn));
    res.add(resourceBar(this, 30, 166, 'MEDICINE', city.medicine, 50, 0x4c8caf));
    res.add(resourceBar(this, 380, 46, 'MORALE', city.morale, 100, 0xaf7baf));
    res.add(resourceBar(this, 380, 106, 'THREAT', city.threat, 100, COLORS.bad));
    res.add(
      this.add.text(380, 150, `POPULATION  ${city.population}`, {
        fontFamily: FONT,
        fontSize: '20px',
        color: COLORS.text,
      }),
    );

    if (data.raidInDays > 0) {
      res.add(
        this.add.text(
          380,
          182,
          `RAID in ${data.raidInDays} day${data.raidInDays === 1 ? '' : 's'}`,
          {
            fontFamily: FONT,
            fontSize: '15px',
            color: '#d9a429',
          },
        ),
      );
    } else {
      const raidWarn = this.add.text(380, 182, '⚠ RAID INBOUND', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#c4453c',
        fontStyle: 'bold',
      });
      res.add(raidWarn);
      this.tweens.add({
        targets: raidWarn,
        alpha: 0.5,
        yoyo: true,
        duration: 700,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    if (city.power < 25) {
      this.tweens.add({
        targets: res,
        alpha: 0.85,
        yoyo: true,
        duration: 1200,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      res.add(
        this.add.text(30, 226, '⚠ LOW POWER — sickness costs more, morale bleeds', {
          fontFamily: FONT,
          fontSize: '15px',
          color: '#c4453c',
        }),
      );
    }

    if (data.timelinePreview) {
      const yest = panel(this, 20, 426, W - 40, 124, 'YESTERDAY');
      yest.add(
        bodyText(this, 16, 40, data.timelinePreview.events.slice(0, 3).join('\n'), W - 90)
          .setFontSize(17),
      );
    }

    const cr = panel(this, 20, 562, W - 40, 150, `CRISIS: ${crisis.title.toUpperCase()}`);
    cr.add(bodyText(this, 16, 40, crisis.narrative, W - 90).setFontSize(18));
    cr.add(
      this.add.text(
        16,
        112,
        data.yourCrisisVote
          ? `You voted: ${data.yourCrisisVote.toUpperCase()}`
          : 'The city has not heard your voice yet.',
        {
          fontFamily: FONT,
          fontSize: '16px',
          color: data.yourCrisisVote ? COLORS.dim : COLORS.accentText,
        },
      ),
    );

    const tally = Object.entries(data.strategyVotes).sort(([, a], [, b]) => b - a);
    const total = tally.reduce((s, [, n]) => s + n, 0);
    const top = tally[0];
    const council = panel(this, 20, 724, W - 40, 84, 'THE COUNCIL');
    council.add(
      bodyText(
        this,
        16,
        40,
        top
          ? `Top plan today: ${top[0].replace(/_/g, ' ')} — ${Math.round((top[1] / total) * 100)}%`
          : 'No plan backed yet today. Set the city’s priority.',
        W - 90,
      ).setFontSize(18),
    );

    this.add.text(
      20,
      818,
      data.yourFaction
        ? `You lean ${data.yourFaction.toUpperCase()} · rep ${data.yourFactionRep}`
        : 'No faction yet — your actions decide.',
      {
        fontFamily: FONT,
        fontSize: '16px',
        color: data.yourFaction ? COLORS.accentText : COLORS.dim,
      },
    );

    const energyLeft = data.effectiveEnergy - player.energyUsedToday;
    const injured = player.injuredUntilDay >= city.day;
    this.add
      .text(
        W / 2,
        852,
        `ENERGY  ${energyLeft}/${data.effectiveEnergy}${injured ? '  — INJURED' : ''}`,
        {
          fontFamily: FONT,
          fontSize: '22px',
          color: injured ? '#c4453c' : COLORS.text,
        },
      )
      .setOrigin(0.5, 0);

    button(this, W / 2 - 165, 920, 'Spend Energy', () => this.scene.start('Actions', { init: data }), {
      width: 310,
    });
    button(
      this,
      W / 2 + 165,
      920,
      data.missionUsedToday ? 'Expedition done' : 'Expedition',
      () => this.startMission(),
      {
        width: 310,
        disabled: data.missionUsedToday || energyLeft <= 0,
      },
    );
    button(this, W / 2 - 165, 1000, 'Crisis Vote', () => this.scene.start('Vote', { init: data }), {
      width: 310,
    });
    button(this, W / 2 + 165, 1000, 'Timeline', () => this.scene.start('Timeline'), {
      width: 310,
      color: 0x2a2e33,
    });
    button(
      this,
      W / 2 - 165,
      1080,
      `Role: ${player.role}`,
      () => this.scene.start('RoleSelect', { init: data }),
      {
        width: 310,
        height: 52,
        color: 0x2a2e33,
      },
    );
    button(this, W / 2 + 165, 1080, 'Leaderboard', () => this.scene.start('Leaderboard'), {
      width: 310,
      height: 52,
      color: 0x2a2e33,
    });

    if (data.resolving) {
      toastText(this, 'A new dawn is being resolved — check back in a moment.');
    }
  }

  private startMission() {
    api
      .missionStart()
      .then((start) => this.scene.start('Mission', { start, threat: this.data_!.city.threat }))
      .catch((err: Error) => toastText(this, err.message));
  }
}
