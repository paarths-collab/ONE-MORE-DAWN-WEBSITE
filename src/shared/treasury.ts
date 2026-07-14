// Shared city treasury. Coins remain integer-only, so a 10% civic share is
// assessed as one Coin after every ten accepted contributions.

export const TREASURY_LEVY_CONTRIBUTIONS = 10;

export type TreasuryFields = {
  treasuryProgress?: number;
  treasuryBacklog?: number;
  treasuryPaid?: number;
};

export type NormalizedTreasuryFields = {
  treasuryProgress: number;
  treasuryBacklog: number;
  treasuryPaid: number;
};

export type TreasuryState = {
  balance: number;
  totalCollected: number;
  totalInvested: number;
  levyEvery: number;
  yours: {
    progress: number;
    backlog: number;
    paid: number;
  };
};

export type TreasuryLevy = {
  coins: number;
  fields: NormalizedTreasuryFields;
  paidNow: number;
  dueAdded: number;
};

const nonNegativeInteger = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

const storedInteger = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return nonNegativeInteger(parsed);
};

export const normalizeTreasuryFields = (
  player: TreasuryFields,
): NormalizedTreasuryFields => ({
  treasuryProgress: Math.min(
    TREASURY_LEVY_CONTRIBUTIONS - 1,
    nonNegativeInteger(player.treasuryProgress),
  ),
  treasuryBacklog: nonNegativeInteger(player.treasuryBacklog),
  treasuryPaid: nonNegativeInteger(player.treasuryPaid),
});

/**
 * Assess one accepted contribution. Existing backlog is paid only from the
 * newly earned Coin; a newly due share can use the current wallet. This keeps
 * old debt from unexpectedly draining saved Coins while ensuring future
 * contribution earnings settle it before they become spendable.
 */
export const applyTreasuryLevy = (
  player: TreasuryFields,
  coinBalanceAfterAward: number,
  coinsGained: number,
): TreasuryLevy => {
  const stored = normalizeTreasuryFields(player);
  const grossCoins = nonNegativeInteger(coinBalanceAfterAward);
  const freshCoins = Math.min(grossCoins, nonNegativeInteger(coinsGained));

  const backlogPaid = Math.min(stored.treasuryBacklog, freshCoins);
  let coins = grossCoins - backlogPaid;
  const progressTotal = stored.treasuryProgress + 1;
  const dueAdded = Math.floor(progressTotal / TREASURY_LEVY_CONTRIBUTIONS);
  const newlyDuePaid = Math.min(dueAdded, coins);
  coins -= newlyDuePaid;

  const paidNow = backlogPaid + newlyDuePaid;
  return {
    coins,
    paidNow,
    dueAdded,
    fields: {
      treasuryProgress: progressTotal % TREASURY_LEVY_CONTRIBUTIONS,
      treasuryBacklog:
        stored.treasuryBacklog - backlogPaid + dueAdded - newlyDuePaid,
      treasuryPaid: stored.treasuryPaid + paidNow,
    },
  };
};

export const treasuryStateOf = (
  player: TreasuryFields,
  raw: Record<string, unknown>,
): TreasuryState => {
  const yours = normalizeTreasuryFields(player);
  return {
    balance: storedInteger(raw.balance),
    totalCollected: storedInteger(raw.collected),
    totalInvested: storedInteger(raw.invested),
    levyEvery: TREASURY_LEVY_CONTRIBUTIONS,
    yours: {
      progress: yours.treasuryProgress,
      backlog: yours.treasuryBacklog,
      paid: yours.treasuryPaid,
    },
  };
};
