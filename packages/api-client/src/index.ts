/**
 * Typed client for services/online-api (contract: services/online-api/openapi.yaml). Hand-written
 * until the OpenAPI generator is set up; keep it in step with the spec.
 */

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

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    /** RFC 9457 problem code (e.g. "captcha_required", "weak_password"). */
    readonly code: string = 'error',
    readonly retryAfterS?: number,
  ) {
    super(`online-api answered ${String(status)} ${code}`);
  }
}

export interface OnlineClientOptions {
  baseUrl: string;
  /** The in-memory access token (never persisted), or null when signed out. */
  accessToken: () => string | null;
  fetch?: typeof fetch;
}

export function createOnlineClient(options: OnlineClientOptions) {
  const call = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const token = options.accessToken();
    if (token === null) throw new ApiError(401);
    const res = await (options.fetch ?? fetch)(`${options.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new ApiError(res.status);
    return res.json();
  };
  return {
    signedIn: (): boolean => options.accessToken() !== null,
    recordProgress: async (entries: readonly ProgressEntry[]): Promise<RecordReply> =>
      (await call('/v1/progress', {
        method: 'POST',
        body: JSON.stringify({ entries }),
      })) as RecordReply,
    listProgress: async (): Promise<ProgressEntry[]> =>
      ((await call('/v1/progress')) as { entries: ProgressEntry[] }).entries,
  };
}
export type OnlineClient = ReturnType<typeof createOnlineClient>;

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

/**
 * Typed client for /v1/auth and /v1/me (services/online-api/openapi.json). The access token lives
 * only in this closure (never localStorage/sessionStorage/IndexedDB); a 401 triggers one refresh.
 */
export function createAccountClient(options: AccountClientOptions) {
  let access: string | null = null;
  let user: AccountUser | null = null;
  let refreshing: Promise<boolean> | null = null;
  const doFetch = options.fetch ?? fetch;

  const raw = async (
    path: string,
    init: RequestInit & { auth?: boolean } = {},
  ): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-MRAK-CSRF': '1',
    };
    if (init.auth && access) headers['Authorization'] = `Bearer ${access}`;
    return doFetch(`${options.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: path.startsWith('/v1/auth/') ? 'include' : 'omit',
    });
  };

  const fail = async (res: Response): Promise<never> => {
    let code = 'error';
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      // not a problem document
    }
    const retry = res.headers.get('retry-after');
    throw new ApiError(res.status, code, retry === null ? undefined : Number(retry));
  };

  const accept = async (res: Response): Promise<AccountUser> => {
    const body = (await res.json()) as Issued;
    access = body.accessToken;
    user = body.user;
    if (options.native && body.refreshToken) await options.native.save(body.refreshToken);
    return body.user;
  };

  /** One refresh at a time; false when signed out. */
  const refresh = (): Promise<boolean> => {
    refreshing ??= (async () => {
      const token = options.native ? await options.native.load() : undefined;
      if (options.native && !token) return false;
      const res = await raw('/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify(token ? { refreshToken: token } : {}),
      });
      if (!res.ok) {
        access = null;
        user = null;
        if (options.native) await options.native.save(null);
        return false;
      }
      await accept(res);
      return true;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    let res = await raw(path, { ...init, auth: true });
    if (res.status === 401 && (await refresh())) res = await raw(path, { ...init, auth: true });
    if (!res.ok) await fail(res);
    return res;
  };

  const post = async (path: string, body: unknown): Promise<Response> => {
    const res = await raw(path, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) await fail(res);
    return res;
  };

  return {
    /** The in-memory access token, for other online-api clients. */
    accessToken: (): string | null => access,
    user: (): AccountUser | null => user,
    /** Restores the session at startup (cookie or secure store). */
    resume: refresh,
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
      await post('/v1/auth/logout', token ? { refreshToken: token } : {});
      access = null;
      user = null;
      if (options.native) await options.native.save(null);
    },
    logoutAll: async () => {
      await call('/v1/auth/logout-all', { method: 'POST' });
      access = null;
      user = null;
    },
    forgotPassword: async (email: string, captcha: string) => {
      await post('/v1/auth/forgot-password', { email, captcha });
    },
    resetPassword: async (token: string, password: string) => {
      await post('/v1/auth/reset-password', { token, password });
    },
    me: async (): Promise<AccountUser> => (await (await call('/v1/me')).json()) as AccountUser,
    updateMe: async (patch: { displayName: string | null }): Promise<AccountUser> =>
      (await (
        await call('/v1/me', { method: 'PATCH', body: JSON.stringify(patch) })
      ).json()) as AccountUser,
    sessions: async (): Promise<AccountSession[]> =>
      ((await (await call('/v1/me/sessions')).json()) as { sessions: AccountSession[] }).sessions,
    revokeSession: async (id: string) => {
      await call(`/v1/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    changePassword: async (currentPassword: string, newPassword: string) => {
      await call('/v1/me/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      access = null;
      user = null;
    },
    exportData: async (): Promise<unknown> => (await call('/v1/me/export')).json(),
    deleteAccount: async (password: string) => {
      await call('/v1/me', {
        method: 'DELETE',
        body: JSON.stringify({ password, confirm: 'DELETE' }),
      });
      access = null;
      user = null;
    },
  };
}
export type AccountClient = ReturnType<typeof createAccountClient>;
