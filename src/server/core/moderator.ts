import { context, reddit } from '@devvit/web/server';

export type ModeratorCheck = { ok: true } | { ok: false; message: string };

/**
 * Fail-closed authorization gate for the /internal/menu/* routes. devvit.json
 * declares those routes as forModerators menu items, but a declaration is not
 * authorization: every handler re-verifies the caller here so the destructive
 * actions (reset, seed-demo, force-resolve, post-create) can never run for a
 * non-moderator even if the endpoints are ever reachable another way.
 *
 * How the check works (verified against @devvit/web 0.13.6 types):
 *  1. context.userId — absent for logged-out callers → deny.
 *  2. reddit.getCurrentUser() — resolves undefined for logged-out renders → deny.
 *  3. User.getModPermissionsForSubreddit(subredditName) — the platform's own
 *     definition of "is a moderator here": a non-empty permission list (e.g.
 *     ['all']) means moderator; an empty list means not one → deny.
 * The subreddit name comes from context, falling back to a
 * reddit.getCurrentSubreddit() RPC. ANY error along the way denies — this
 * guard fails closed, never open.
 */
export const requireModerator = async (): Promise<ModeratorCheck> => {
  const denied: ModeratorCheck = {
    ok: false,
    message: 'Moderators only, this action is restricted.',
  };
  const { userId } = context;
  if (!userId) return denied;
  try {
    const user = await reddit.getCurrentUser();
    if (!user) return denied;
    const subredditName = context.subredditName ?? (await reddit.getCurrentSubreddit()).name;
    const permissions = await user.getModPermissionsForSubreddit(subredditName);
    return permissions.length > 0 ? { ok: true } : denied;
  } catch {
    return { ok: false, message: 'Could not verify moderator status, action blocked.' };
  }
};
