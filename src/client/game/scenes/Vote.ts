import * as Phaser from 'phaser';
import type { InitResponse, StrategyPlanId } from '../../../shared/types';
import { BALANCE } from '../../../shared/balance';
import { api } from '../api';
import { backRow, bodyText, button, COLORS, FONT, heading, panel, toastText, W } from '../ui';

export class Vote extends Phaser.Scene {
  private init_!: InitResponse;

  constructor() {
    super('Vote');
  }

  create(data: { init: InitResponse }) {
    this.init_ = data.init;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    const { crisis } = this.init_;

    heading(this, W / 2, 24, 'TODAY THE CITY DECIDES');

    const cr = panel(this, 20, 90, W - 40, 170, `CRISIS: ${crisis.title.toUpperCase()}`);
    cr.add(bodyText(this, 16, 40, crisis.narrative, W - 90).setFontSize(18));

    const votedCrisis = this.init_.yourCrisisVote;
    crisis.options.forEach((o, i) => {
      const count = this.init_.crisisVotes[o.id] ?? 0;
      const mine = votedCrisis === o.id;
      const opts: { width: number; height: number; color?: number; disabled?: boolean } = { width: 620, height: 110 };
      if (mine) opts.color = 0x3a5f3a;
      if (votedCrisis !== null && !mine) opts.disabled = true;
      button(
        this, W / 2, 330 + i * 130,
        `${o.label}  (${count} votes)${mine ? '  ✓ your vote' : ''}\n${o.description}`,
        () => this.voteCrisis(o.id),
        opts,
      );
    });

    // --- council plan (separate vote, spec §10) ---
    this.add
      .text(W / 2, 720, 'COUNCIL PLAN — what should citizens focus on today?', {
        fontFamily: FONT, fontSize: '20px', color: '#d9a429',
      })
      .setOrigin(0.5, 0);

    const myPlan = this.init_.yourStrategyVote;
    BALANCE.strategyPlans.forEach((planId, i) => {
      const count = this.init_.strategyVotes[planId] ?? 0;
      const mine = myPlan === planId;
      const col = i % 2 === 0 ? W / 2 - 165 : W / 2 + 165;
      const row = 800 + Math.floor(i / 2) * 80;
      const opts: { width: number; height: number; color?: number; disabled?: boolean } = { width: 310, height: 64 };
      opts.color = mine ? 0x3a5f3a : 0x2a4a5f;
      if (myPlan !== null && !mine) opts.disabled = true;
      button(
        this, col, row,
        `${planId.replace(/_/g, ' ')} (${count})${mine ? ' ✓' : ''}`,
        () => this.voteStrategy(planId),
        opts,
      );
    });

    backRow(this);
  }

  private voteCrisis(optionId: string) {
    api
      .vote(optionId, this.init_.crisis.id)
      .then((res) => {
        this.init_ = { ...this.init_, crisisVotes: res.crisisVotes, yourCrisisVote: res.yourCrisisVote };
        this.scene.restart({ init: this.init_ });
      })
      .catch((err: Error) => toastText(this, err.message));
  }

  private voteStrategy(planId: StrategyPlanId) {
    api
      .strategy(planId)
      .then((res) => {
        this.init_ = { ...this.init_, strategyVotes: res.strategyVotes, yourStrategyVote: res.yourStrategyVote };
        this.scene.restart({ init: this.init_ });
      })
      .catch((err: Error) => toastText(this, err.message));
  }
}
