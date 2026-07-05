import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../shared/balance';
import {
  PLEDGE_KINDS, buildLedger, buildPledgeInfo, isPledgeKind, pledgeOptions, type PledgerEntry,
} from './pledges';

const entry = (over: Partial<PledgerEntry> = {}): PledgerEntry => ({
  kind: 'stand_vigil',
  name: 'anon•••',
  at: 0,
  contribution: 0,
  ...over,
});

describe('pledge kinds and options', () => {
  it('exposes exactly the 4 balance options, in order', () => {
    expect(PLEDGE_KINDS).toEqual(['stand_vigil', 'share_rations', 'run_messages', 'back_council']);
    const opts = pledgeOptions();
    expect(opts.map((o) => o.id)).toEqual([...PLEDGE_KINDS]);
    for (const o of opts) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.icon.length).toBeGreaterThan(0);
      expect(o.effect.length).toBeGreaterThan(0);
    }
  });

  it('isPledgeKind guards request bodies', () => {
    expect(isPledgeKind('stand_vigil')).toBe(true);
    expect(isPledgeKind('back_council')).toBe(true);
    expect(isPledgeKind('hack_the_wall')).toBe(false);
    expect(isPledgeKind(42)).toBe(false);
    expect(isPledgeKind(undefined)).toBe(false);
  });
});

describe('buildLedger', () => {
  const pledgers: Record<string, PledgerEntry> = {
    a: entry({ name: 'aaa•••', at: 10, contribution: 50 }),
    b: entry({ name: 'bbb•••', at: 20, contribution: 90 }),
    c: entry({ name: 'ccc•••', at: 30, contribution: 10 }),
    d: entry({ name: 'ddd•••', at: 40, contribution: 90 }), // ties b, pledged later
    e: entry({ name: 'eee•••', at: 50, contribution: 0 }),
    f: entry({ name: 'fff•••', at: 60, contribution: 5 }),
  };

  it('tops by contribution (ties: earliest pledge), recent newest-first, both capped', () => {
    const ledger = buildLedger(pledgers, 'a');
    expect(ledger.topHelpers).toEqual(['bbb•••', 'ddd•••', 'aaa•••']);
    expect(ledger.recent).toEqual(['fff•••', 'eee•••', 'ddd•••', 'ccc•••', 'bbb•••']);
    expect(ledger.topHelpers.length).toBe(BALANCE.marked.ledgerTop);
    expect(ledger.recent.length).toBe(BALANCE.marked.ledgerRecent);
  });

  it("mine is today's pledged resolve (0 when I have not pledged)", () => {
    expect(buildLedger(pledgers, 'a').mine).toBe(BALANCE.marked.pledgePerTap);
    expect(buildLedger(pledgers, 'zzz').mine).toBe(0);
    expect(buildLedger({}, 'a')).toEqual({ topHelpers: [], recent: [], mine: 0 });
  });

  it('buildPledgeInfo flags usedToday and carries the options', () => {
    expect(buildPledgeInfo(pledgers, 'a').usedToday).toBe(true);
    const empty = buildPledgeInfo({}, 'a');
    expect(empty.usedToday).toBe(false);
    expect(empty.options).toHaveLength(4);
    expect(empty.ledger.mine).toBe(0);
  });
});
