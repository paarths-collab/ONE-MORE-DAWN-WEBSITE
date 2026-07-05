import { BALANCE } from '../../shared/balance';
import type { PledgeInfo, PledgeKind, PledgeLedger, PledgeOption } from '../../shared/types';

/**
 * Pure shaping helpers for the one-tap pledge system (hook layer, Plan 1).
 * No I/O and no Devvit imports — unit-tested directly.
 */

/** What gets recorded per pledger in the day-scoped pledgers hash. */
export type PledgerEntry = {
  kind: PledgeKind;
  /** masked display name captured at pledge time (village.ts maskName) */
  name: string;
  /** epoch ms — real Redis hashes have no field order, so "recent" needs this */
  at: number;
  /** lifetime contribution at pledge time — sorts the "top helpers" list */
  contribution: number;
};

export const PLEDGE_KINDS: readonly PledgeKind[] = BALANCE.pledgeOptions.map((o) => o.id);

export const isPledgeKind = (value: unknown): value is PledgeKind =>
  typeof value === 'string' && (PLEDGE_KINDS as readonly string[]).includes(value);

/** Mutable copy of the balance options (BALANCE is deeply readonly). */
export const pledgeOptions = (): PledgeOption[] => BALANCE.pledgeOptions.map((o) => ({ ...o }));

/**
 * Public-credit ledger: top helpers by lifetime contribution (ties: earliest
 * pledge first), recent helpers newest-first, and my resolve added today.
 */
export const buildLedger = (
  pledgers: Record<string, PledgerEntry>,
  userId: string,
): PledgeLedger => {
  const entries = Object.values(pledgers);
  const topHelpers = [...entries]
    .sort((a, b) => b.contribution - a.contribution || a.at - b.at)
    .slice(0, BALANCE.marked.ledgerTop)
    .map((e) => e.name);
  const recent = [...entries]
    .sort((a, b) => b.at - a.at)
    .slice(0, BALANCE.marked.ledgerRecent)
    .map((e) => e.name);
  const mine = pledgers[userId] ? BALANCE.marked.pledgePerTap : 0;
  return { topHelpers, recent, mine };
};

export const buildPledgeInfo = (
  pledgers: Record<string, PledgerEntry>,
  userId: string,
): PledgeInfo => ({
  options: pledgeOptions(),
  usedToday: pledgers[userId] !== undefined,
  ledger: buildLedger(pledgers, userId),
});
