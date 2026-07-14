// Typed same-origin fetch helpers for the real multiplayer game API
// (src/server/routes/api.ts). Every helper resolves with the parsed JSON
// payload or throws an ApiFailure — callers decide live vs demo from that.

import type {
  ActionRequest,
  ActionResponse,
  ActionType,
  AvatarConfig,
  AvatarRequest,
  AvatarResponse,
  InitResponse,
  LandDonationRequest,
  LandDonationResponse,
  LeaderboardResponse,
  PledgeKind,
  PledgeRequest,
  PledgeResponse,
  RekindleResponse,
  Role,
  RoleRequest,
  RoleResponse,
  ShopEquipRequest,
  ShopEquipResponse,
  ShopPurchaseRequest,
  ShopPurchaseResponse,
  StrategyPlanId,
  StrategyRequest,
  StrategyResponse,
  TreasuryInvestmentRequest,
  TreasuryInvestmentResponse,
  VoteRequest,
  VoteResponse,
  WorldResponse,
} from '../shared/types';
import type {
  ChatterCategory,
  ChatterPostRequest,
  ChatterPostResponse,
  ChatterState,
} from '../shared/chatter';

/** Any failed API call: HTTP error (status + server message) or network/timeout (status 0). */
export class ApiFailure extends Error {
  /** HTTP status of the failed response; 0 for network errors and timeouts. */
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = 'ApiFailure';
    this.httpStatus = httpStatus;
  }
}

const TIMEOUT_MS = 8000;

/**
 * Same-origin JSON fetch with an 8s abort. GET when `body` is omitted, POST
 * otherwise. Non-2xx responses throw ApiFailure carrying the server's
 * `{ status:'error', message }` text when present. No retries.
 */
async function request<T>(path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      signal: ctrl.signal,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const parsed = (await res.json()) as { message?: unknown };
        if (typeof parsed.message === 'string') message = parsed.message;
      } catch {
        // non-JSON error body (e.g. the dev harness's 404 page) — keep the status text
      }
      throw new ApiFailure(message, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiFailure) throw err;
    throw new ApiFailure(err instanceof Error ? err.message : 'network error', 0);
  } finally {
    clearTimeout(timer);
  }
}

export const getInit = (): Promise<InitResponse> => request<InitResponse>('/api/init');

export const postAction = (action: ActionType): Promise<ActionResponse> => {
  const body: ActionRequest = { action };
  return request<ActionResponse>('/api/action', body);
};

export const postVote = (optionId: string, crisisId: string): Promise<VoteResponse> => {
  const body: VoteRequest = { optionId, crisisId };
  return request<VoteResponse>('/api/vote', body);
};

export const postPledge = (kind: PledgeKind): Promise<PledgeResponse> => {
  const body: PledgeRequest = { kind };
  return request<PledgeResponse>('/api/pledge', body);
};

export const postStrategy = (planId: StrategyPlanId): Promise<StrategyResponse> => {
  const body: StrategyRequest = { planId };
  return request<StrategyResponse>('/api/strategy', body);
};

/** Streak insurance: burn standing to restore a lapsed streak. */
export const postRekindle = (): Promise<RekindleResponse> =>
  request<RekindleResponse>('/api/rekindle', {});

// ---- Coin economy: cosmetic shop + community land expansion ----

export const postShopPurchase = (itemId: ShopPurchaseRequest['itemId']): Promise<ShopPurchaseResponse> => {
  const body: ShopPurchaseRequest = { itemId };
  return request<ShopPurchaseResponse>('/api/shop/purchase', body);
};

export const postShopEquip = (itemId: ShopEquipRequest['itemId']): Promise<ShopEquipResponse> => {
  const body: ShopEquipRequest = { itemId };
  return request<ShopEquipResponse>('/api/shop/equip', body);
};

export const postLandDonate = (
  projectId: LandDonationRequest['projectId'],
  amount: number,
): Promise<LandDonationResponse> => {
  const body: LandDonationRequest = { projectId, amount };
  return request<LandDonationResponse>('/api/shop/donate', body);
};

export const postTreasuryInvest = (
  projectId: TreasuryInvestmentRequest['projectId'],
  amount: number,
): Promise<TreasuryInvestmentResponse> => {
  const body: TreasuryInvestmentRequest = { projectId, amount };
  return request<TreasuryInvestmentResponse>('/api/shop/invest', body);
};

export const postRole = (role: Role): Promise<RoleResponse> => {
  const body: RoleRequest = { role };
  return request<RoleResponse>('/api/role', body);
};

export const postAvatar = (avatar: AvatarConfig): Promise<AvatarResponse> => {
  const body: AvatarRequest = { avatar };
  return request<AvatarResponse>('/api/avatar', body);
};

export const getWorld = (): Promise<WorldResponse> => request<WorldResponse>('/api/world');

export const getLeaderboard = (): Promise<LeaderboardResponse> =>
  request<LeaderboardResponse>('/api/leaderboard');

export const getChatter = (category: ChatterCategory): Promise<ChatterState> =>
  request<ChatterState>(`/api/chatter?category=${encodeURIComponent(category)}`);

export const postChatter = (category: ChatterCategory, text: string): Promise<ChatterPostResponse> => {
  const body: ChatterPostRequest = { category, text };
  return request<ChatterPostResponse>('/api/chatter', body);
};
