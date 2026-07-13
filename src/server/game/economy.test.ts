import { describe, expect, it } from 'vitest';
import { COIN_DAILY_CAP } from '../../shared/shop';
import { freshPlayer } from './dayLogic';
import { awardContributionCoin } from './economy';

const base = () => freshPlayer('t2_e', 'earner', 4);

describe('awardContributionCoin', () => {
  it('awards exactly 1 Coin for an accepted contribution', () => {
    const { player, coinsGained, economy } = awardContributionCoin(base(), 2, 4);
    expect(coinsGained).toBe(1);
    expect(player.coins).toBe(1);
    expect(player.coinsEarnedToday).toBe(1);
    expect(player.coinsEarnedCycle).toBe(2);
    expect(player.coinsEarnedDay).toBe(4);
    expect(economy).toMatchObject({ coins: 1, earnedToday: 1, dailyCap: 5 });
  });

  it('never exceeds the daily cap', () => {
    let player = base();
    for (let i = 0; i < COIN_DAILY_CAP + 3; i++) {
      player = awardContributionCoin(player, 2, 4).player;
    }
    expect(player.coins).toBe(COIN_DAILY_CAP);
    expect(player.coinsEarnedToday).toBe(COIN_DAILY_CAP);
    expect(awardContributionCoin(player, 2, 4).coinsGained).toBe(0);
  });

  it('a new day resets only the earned counter, never the balance', () => {
    let player = base();
    for (let i = 0; i < COIN_DAILY_CAP; i++) {
      player = awardContributionCoin(player, 2, 4).player;
    }
    const nextDay = awardContributionCoin(player, 2, 5);
    expect(nextDay.coinsGained).toBe(1);
    expect(nextDay.player.coins).toBe(COIN_DAILY_CAP + 1);
    expect(nextDay.player.coinsEarnedToday).toBe(1);
    expect(nextDay.player.coinsEarnedDay).toBe(5);
  });

  it('a Phoenix cycle cannot inherit the previous cycle day cap', () => {
    const capped = {
      ...base(),
      coins: 10,
      coinsEarnedToday: COIN_DAILY_CAP,
      coinsEarnedCycle: 2,
      coinsEarnedDay: 1,
    };
    const reborn = awardContributionCoin(capped, 3, 1);
    expect(reborn.coinsGained).toBe(1);
    expect(reborn.player.coins).toBe(11);
    expect(reborn.player.coinsEarnedToday).toBe(1);
    expect(reborn.player.coinsEarnedCycle).toBe(3);
  });

  it('treats missing or malformed economy fields as safe defaults', () => {
    const legacy = {
      ...base(),
      coins: -8,
      coinsEarnedToday: Number.NaN,
      coinsEarnedCycle: undefined,
      coinsEarnedDay: undefined,
    };
    const { player, coinsGained } = awardContributionCoin(legacy, 4, 9);
    expect(coinsGained).toBe(1);
    expect(player.coins).toBe(1);
    expect(player.coinsEarnedToday).toBe(1);
    expect(player.coinsEarnedCycle).toBe(4);
    expect(player.coinsEarnedDay).toBe(9);
  });

  it('is pure', () => {
    const player = base();
    awardContributionCoin(player, 2, 4);
    expect(player.coins).toBe(0);
  });
});
