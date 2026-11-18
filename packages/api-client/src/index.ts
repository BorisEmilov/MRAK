/**
 * Typed client for services/online-api (contract: services/online-api/openapi.json, generated).
 * One shared HTTP layer (`createAccountClient().request`): access token in memory only, a single
 * refresh in flight, one retry after a 401 and a clean sign-out when the refresh fails. Feature
 * clients (progress, saves) are built on top of it.
 */

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    /** RFC 9457 problem code (e.g. "captcha_required", "conflict"); "network" when offline. */
    readonly code: string = 'error',
    readonly retryAfterS?: number,
    /** The problem document (e.g. `current` of a 412 save conflict). */
    readonly body?: unknown,
  ) {
    super(`online-api answered ${String(status)} ${code}`);
  }
}

// ---------------------------------------------------------------- accounts

export type Platform = 'web' | 'desktop' | 'android' | 'ios';

export interface AccountUser {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  createdAt: string;
}

export interface AccountSession {
  id: string;
  platform: Platform;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

interface Issued {
  accessToken: string;
  expiresIn: number;
  user: AccountUser;
  refreshToken?: string;
}

export interface AccountClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /**
   * Native shells (Tauri/Capacitor, phase 34) keep the refresh token in the OS secure store and
   * pass it here; browsers leave this out and rely on the HttpOnly cookie.
   */
  native?: {
    platform: Exclude<Platform, 'web'>;
    load: () => Promise<string | null>;
    save: (token: string | null) => Promise<void>;
  };
}

async function toError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // not a problem document
  }
  const code = (body as { error?: string } | null)?.error ?? 'error';
  const retry = res.headers.get('retry-after');
  return new ApiError(res.status, code, retry === null ? undefined : Number(retry), body);
}

export function createAccountClient(options: AccountClientOptions) {
  let access: string | null = null;
  let user: AccountUser | null = null;
  let refreshing: Promise<boolean> | null = null;
  const listeners = new Set<(user: AccountUser | null) => void>();
  const doFetch = options.fetch ?? fetch;

  const notify = (): void => {
    for (const l of listeners) l(user);
  };

  /** Forgets the session locally (tokens, user) and tells listeners. */
  const signOutLocally = async (): Promise<void> => {
    const was = access !== null || user !== null;
    access = null;
    user = null;
    if (options.native) await options.native.save(null);
    if (was) notify();
  };

  const raw = async (
    path: string,
    init: RequestInit & { auth?: boolean } = {},
  ): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-MRAK-CSRF': '1',
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.auth && access) headers['Authorization'] = `Bearer ${access}`;
    try {
      return await doFetch(`${options.baseUrl}${path}`, {
        ...init,
        headers,
        credentials: path.startsWith('/v1/auth/') ? 'include' : 'omit',
      });
    } catch {
      throw new ApiError(0, 'network');
    }
  };

  const accept = async (res: Response): Promise<AccountUser> => {
    const body = (await res.json()) as Issued;
    access = body.accessToken;
    user = body.user;
    if (options.native && body.refreshToken) await options.native.save(body.refreshToken);
    notify();
    return body.user;
  };

  /** One refresh at a time; false (and a clean local sign-out) when the session is gone. */
  const refresh = (): Promise<boolean> => {
    refreshing ??= (async () => {
      const token = options.native ? await options.native.load() : undefined;
      if (options.native && !token) return false;
      const res = await raw('/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify(token ? { refreshToken: token } : {}),
      });
      if (res.status === 401 || res.status === 403) {
        await signOutLocally();
        return false;
      }
      if (!res.ok) throw await toError(res);
      await accept(res);
      return true;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  /**
   * Authenticated request: bearer token, one refresh + one retry on 401, clean sign-out if that
   * fails. Throws ApiError for any non-2xx (status 0 = network).
   */
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    if (!access && !(await refresh())) throw new ApiError(401, 'unauthorized');
    let res = await raw(path, { ...init, auth: true });
    if (res.status === 401) {
      if (!(await refresh())) throw new ApiError(401, 'unauthorized');
      res = await raw(path, { ...init, auth: true });
      if (res.status === 401) {
        await signOutLocally();
        throw new ApiError(401, 'unauthorized');
      }
    }
    if (!res.ok) throw await toError(res);
    return res;
  };

  const post = async (path: string, body: unknown): Promise<Response> => {
    const res = await raw(path, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) throw await toError(res);
    return res;
  };

  return {
    /** The in-memory access token. */
    accessToken: (): string | null => access,
    user: (): AccountUser | null => user,
    signedIn: (): boolean => user !== null,
    /** Called on sign-in, refresh and sign-out (null). Returns an unsubscribe function. */
    onChange: (listener: (user: AccountUser | null) => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request,
    /** Restores the session at startup (cookie or secure store). Never throws. */
    resume: (): Promise<boolean> => refresh().catch(() => false),
    register: async (input: {
      email: string;
      password: string;
      displayName?: string;
      captcha: string;
    }) => {
      await post('/v1/auth/register', input);
    },
    verifyEmail: async (token: string) => {
      await post('/v1/auth/verify-email', { token });
    },
    resendVerification: async (email: string, captcha: string) => {
      await post('/v1/auth/resend-verification', { email, captcha });
    },
    login: async (input: { email: string; password: string; captcha?: string }) =>
      accept(
        await post('/v1/auth/login', {
          ...input,
          platform: options.native?.platform ?? 'web',
        }),
      ),
    logout: async () => {
      const token = options.native ? await options.native.load() : null;
      try {
        await post('/v1/auth/logout', token ? { refreshToken: token } : {});
      } finally {
        await signOutLocally();
      }
    },
    logoutAll: async () => {
      await request('/v1/auth/logout-all', { method: 'POST' });
      await signOutLocally();
    },
    forgotPassword: async (email: string, captcha: string) => {
      await post('/v1/auth/forgot-password', { email, captcha });
    },
    resetPassword: async (token: string, password: string) => {
      await post('/v1/auth/reset-password', { token, password });
    },
    me: async (): Promise<AccountUser> => {
      user = (await (await request('/v1/me')).json()) as AccountUser;
      notify();
      return user;
    },
    updateMe: async (patch: { displayName: string | null }): Promise<AccountUser> =>
      (await (
        await request('/v1/me', { method: 'PATCH', body: JSON.stringify(patch) })
      ).json()) as AccountUser,
    sessions: async (): Promise<AccountSession[]> =>
      ((await (await request('/v1/me/sessions')).json()) as { sessions: AccountSession[] })
        .sessions,
    revokeSession: async (id: string) => {
      await request(`/v1/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    changePassword: async (currentPassword: string, newPassword: string) => {
      await request('/v1/me/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      await signOutLocally();
    },
    exportData: async (): Promise<unknown> => (await request('/v1/me/export')).json(),
    deleteAccount: async (password: string) => {
      await request('/v1/me', {
        method: 'DELETE',
        body: JSON.stringify({ password, confirm: 'DELETE' }),
      });
      await signOutLocally();
    },
  };
}
export type AccountClient = ReturnType<typeof createAccountClient>;

// ---------------------------------------------------------------- account progress

/** One account progress row; idempotent per (account, kind, key). */
export type ProgressEntry =
  | { kind: 'achievement' | 'node' | 'route' | 'ending'; key: string; at: number }
  | { kind: 'legacy'; key: string; value: number; at: number }
  | { kind: 'stat'; key: 'nights' | 'exorcisms'; value: number; at: number };

export interface RecordReply {
  recorded: { kind: string; key: string }[];
  rejected: { kind: string; key: string; reason: 'unknown' | 'entitlement' }[];
}

/** Max entries per request (the server refuses more). */
export const PROGRESS_BATCH = 50;

export function createOnlineClient(account: Pick<AccountClient, 'request' | 'signedIn'>) {
  return {
    signedIn: (): boolean => account.signedIn(),
    recordProgress: async (entries: readonly ProgressEntry[]): Promise<RecordReply> =>
      (await (
        await account.request('/v1/progress', {
          method: 'POST',
          body: JSON.stringify({ entries }),
        })
      ).json()) as RecordReply,
    listProgress: async (): Promise<ProgressEntry[]> =>
      ((await (await account.request('/v1/progress')).json()) as { entries: ProgressEntry[] })
        .entries,
  };
}
export type OnlineClient = ReturnType<typeof createOnlineClient>;

// ---------------------------------------------------------------- cloud saves

export const CLOUD_SLOTS = ['slot-1', 'slot-2', 'slot-3', 'auto'] as const;
export type CloudSlot = (typeof CLOUD_SLOTS)[number];

export interface CloudSaveMeta {
  savedAt: string;
  gameDate: { year: number; month: number; day: number; minute: number };
  zone: string | null;
  generation: number;
  playtimeMs: number;
  contentVersion: string;
  reason: string | null;
  thumbnail: string | null;
}

export interface CloudSaveInfo {
  slot: CloudSlot;
  version: number;
  checksum: string;
  bytes: number;
  meta: CloudSaveMeta;
  updatedAt: string;
}

export interface CloudSave extends CloudSaveInfo {
  data: string;
}

/** A 412 from PUT/DELETE: the cloud holds `current` (null: the slot is empty). */
export function conflictOf(err: unknown): CloudSaveInfo | null | undefined {
  if (!(err instanceof ApiError) || err.status !== 412) return undefined;
  return (err.body as { current?: CloudSaveInfo | null } | null)?.current ?? null;
}

export function createSavesClient(account: Pick<AccountClient, 'request' | 'signedIn'>) {
  const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
  const precondition = (base: number | null): Record<string, string> =>
    base === null ? { 'If-None-Match': '*' } : { 'If-Match': `"v${String(base)}"` };
  return {
    signedIn: (): boolean => account.signedIn(),
    list: async (): Promise<CloudSaveInfo[]> =>
      (await json<{ saves: CloudSaveInfo[] }>(await account.request('/v1/saves'))).saves,
    get: async (slot: CloudSlot, version?: number): Promise<CloudSave> =>
      json<CloudSave>(
        await account.request(
          `/v1/saves/${slot}${version === undefined ? '' : `?version=${String(version)}`}`,
        ),
      ),
    /** Uploads on top of `base` (null: the slot must be empty). 412 → see conflictOf(). */
    put: async (
      slot: CloudSlot,
      save: { meta: CloudSaveMeta; data: string; checksum: string },
      base: number | null,
    ): Promise<CloudSaveInfo> =>
      json<CloudSaveInfo>(
        await account.request(`/v1/saves/${slot}`, {
          method: 'PUT',
          headers: precondition(base),
          body: JSON.stringify(save),
        }),
      ),
    remove: async (slot: CloudSlot, version: number): Promise<void> => {
      await account.request(`/v1/saves/${slot}`, {
        method: 'DELETE',
        headers: precondition(version),
      });
    },
  };
}
export type SavesClient = ReturnType<typeof createSavesClient>;

// ---------------------------------------------------------------- store (docs/systems/store.md)

export const SKUS = ['full-game', 'collector'] as const;
export type Sku = (typeof SKUS)[number];

export interface Entitlement {
  sku: Sku;
  source: 'web' | 'steam' | 'ios' | 'android';
  status: 'active' | 'revoked';
  purchasedAt: string;
  refundedAt: string | null;
}

/** Signed, short-lived URL of the paid full pack (only with the full-game entitlement). */
export interface FullPackTicket {
  url: string;
  version: string;
  sha256: string;
  bytes: number;
  expiresAt: string;
}

export function createStoreClient(account: Pick<AccountClient, 'request'>) {
  const post = (path: string, body: unknown) =>
    account.request(path, { method: 'POST', body: JSON.stringify(body) });
  return {
    /** Active and revoked entitlements; "collector" implies "full-game" (reported as both). */
    entitlements: async (): Promise<Entitlement[]> =>
      (
        (await (await account.request('/v1/store/entitlements')).json()) as {
          entitlements: Entitlement[];
        }
      ).entitlements,
    /** Hosted checkout for a verified account; `consent` = immediate access + waiver accepted. */
    checkout: async (sku: Sku, consent: true): Promise<{ url: string }> =>
      (await (await post('/v1/store/checkout', { sku, consent })).json()) as { url: string },
    fullPack: async (): Promise<FullPackTicket> =>
      (await (await post('/v1/content/full', {})).json()) as FullPackTicket,
    collectorName: async (name: string): Promise<{ status: string }> =>
      (await (await post('/v1/store/collector-name', { name })).json()) as { status: string },
  };
}
export type StoreClient = ReturnType<typeof createStoreClient>;

/**
 * Where to go after signing in: a same-origin path from `?next=`, otherwise `fallback`.
 * Resolving against the origin also rejects `//host` and `/\host` (browsers treat both as
 * protocol-relative), absolute URLs and `javascript:` (threat model C-11).
 */
export function safeNext(next: string | null, origin: string, fallback = '/account/'): string {
  if (!next?.startsWith('/')) return fallback;
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}
