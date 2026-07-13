import { KEYS } from '../storage/redisKeys';

/**
 * Per-user optimistic write lock.
 *
 * The energy-spend paths (POST /action, POST /mission/start) previously watched
 * the shared `players` hash, so ANY two users acting in the same instant voided
 * each other's transactions and got a spurious "Busy — try again" 409 — exactly
 * at the multiplayer scale the game is built for. Instead we watch a PER-USER
 * counter key. Two different users watch different keys and never collide; only
 * a genuine same-user double-tap (the case we actually want to reject) sees its
 * watched key change and aborts.
 *
 * WATCH semantics: the watched key must be MUTATED inside the transaction, so a
 * concurrent same-user commit invalidates the other's watch. incrBy on the lock
 * key does that. Devvit's exec() resolves to a non-empty array on commit and
 * throws / returns an empty array on a watched-key conflict (see the route-level
 * execOrConflict this replaces).
 */

/** The transaction surface beginUserLock needs — a structural subset of Devvit's
 *  TxClientLike, so the real client and the test fake both satisfy it. */
export type LockTx = {
  multi(): Promise<unknown>;
  hSet(key: string, fieldValues: Record<string, string>): Promise<unknown>;
  hIncrBy(key: string, field: string, value: number): Promise<unknown>;
  zIncrBy(key: string, member: string, value: number): Promise<unknown>;
  incrBy(key: string, value: number): Promise<unknown>;
  unwatch(): Promise<unknown>;
  exec(): Promise<unknown[]>;
};

/** The redis surface beginUserLock needs — just `watch`. */
export type LockableRedis = {
  watch(...keys: string[]): Promise<LockTx>;
};

export type UserLock = {
  /** Release the watch without writing (validation failed / nothing to commit). */
  abort(): Promise<void>;
  /**
   * Queue the caller's writes, bump this user's lock, and exec atomically.
   * Returns true on commit, false on a same-user conflict (→ the route replies
   * "Busy — try again"). Never throws for a conflict.
   */
  commit(queueWrites: (tx: LockTx) => Promise<void>): Promise<boolean>;
};

/**
 * Begin a per-user optimistic section. Call `commit(writes)` to apply, or
 * `abort()` to release. The caller does its reads + validation between begin and
 * commit, exactly like a raw watch/multi block — this only narrows the watched
 * key from the global hash to the single user's lock.
 */
export const beginUserLock = async (redis: LockableRedis, userId: string): Promise<UserLock> => {
  const lockKey = KEYS.playerLock(userId);
  const tx = await redis.watch(lockKey);
  return {
    abort: async () => {
      await tx.unwatch();
    },
    commit: async (queueWrites) => {
      await tx.multi();
      await queueWrites(tx);
      // Mutate the watched key so a concurrent same-user commit aborts one side.
      await tx.incrBy(lockKey, 1);
      try {
        const results = await tx.exec();
        return results.length > 0;
      } catch {
        return false;
      }
    },
  };
};
