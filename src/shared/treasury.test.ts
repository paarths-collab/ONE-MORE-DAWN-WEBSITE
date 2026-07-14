import { describe, expect, it } from 'vitest';
import {
  TREASURY_LEVY_CONTRIBUTIONS,
  applyTreasuryLevy,
  normalizeTreasuryFields,
  treasuryStateOf,
} from './treasury';

describe('city treasury contract', () => {
  it('assesses exactly one Coin after ten accepted contributions', () => {
    let fields = normalizeTreasuryFields({});
    let coins = 0;
    let paid = 0;
    for (let i = 0; i < TREASURY_LEVY_CONTRIBUTIONS; i++) {
      coins += 1;
      const result = applyTreasuryLevy(fields, coins, 1);
      fields = result.fields;
      coins = result.coins;
      paid += result.paidNow;
    }
    expect({ coins, paid, fields }).toEqual({
      coins: 9,
      paid: 1,
      fields: { treasuryProgress: 0, treasuryBacklog: 0, treasuryPaid: 1 },
    });
  });

  it('records an unpaid share as backlog and settles it from future earnings', () => {
    const missed = applyTreasuryLevy(
      { treasuryProgress: 9, treasuryBacklog: 0, treasuryPaid: 0 },
      0,
      0,
    );
    expect(missed).toMatchObject({
      coins: 0,
      paidNow: 0,
      fields: { treasuryProgress: 0, treasuryBacklog: 1, treasuryPaid: 0 },
    });

    const repaid = applyTreasuryLevy(missed.fields, 1, 1);
    expect(repaid).toMatchObject({
      coins: 0,
      paidNow: 1,
      fields: { treasuryProgress: 1, treasuryBacklog: 0, treasuryPaid: 1 },
    });
  });

  it('fails malformed player and Redis values closed without hiding valid totals', () => {
    expect(normalizeTreasuryFields({
      treasuryProgress: Number.NaN,
      treasuryBacklog: -4,
      treasuryPaid: 3,
    })).toEqual({ treasuryProgress: 0, treasuryBacklog: 0, treasuryPaid: 3 });
    expect(treasuryStateOf(
      { treasuryProgress: 4, treasuryBacklog: 2, treasuryPaid: 7 },
      { balance: '12', collected: 'bad', invested: '5' },
    )).toEqual({
      balance: 12,
      totalCollected: 0,
      totalInvested: 5,
      levyEvery: 10,
      yours: { progress: 4, backlog: 2, paid: 7 },
    });
  });
});
