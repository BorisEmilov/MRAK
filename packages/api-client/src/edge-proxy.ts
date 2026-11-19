/**
 * Same-origin API proxy for Cloudflare Pages Functions (ADR 0012, threat model C-46):
 * `https://<site>/api/<path>` → `${API_ORIGIN}/<path>` with the edge secret and the client IP.
 * Runs on the Workers runtime (standard fetch/Request/Headers only).
 */
export interface ProxyEnv {
  /** Render service URL, e.g. https://mrak-api.onrender.com (https only). */
  API_ORIGIN?: string;
  /** Shared secret the API requires in `x-mrak-edge` (≥ 32 chars). */
  EDGE_SECRET?: string;
}

const PREFIX = '/api';
/** Above the API's own 1 MB body limit: the API answers 413 with its usual problem body. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Headers a client must never be able to set on the way to the origin. */
const STRIPPED = [
  'x-mrak-edge',
  'x-mrak-client-ip',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
  'host',
];

const problem = (status: number, code: string): Response =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status }), {
    status,
    headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' },
  });

export async function proxyApi(
  request: Request,
  env: ProxyEnv,
  doFetch: typeof fetch = fetch,
): Promise<Response> {
  const secret = env.EDGE_SECRET ?? '';
  let origin: URL;
  try {
    origin = new URL(env.API_ORIGIN ?? '');
  } catch {
    return problem(503, 'api-not-configured');
  }
  if (origin.protocol !== 'https:' || secret.length < 32) return problem(503, 'api-not-configured');

  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${PREFIX}/`)) return problem(404, 'not-found');
  const path = url.pathname.slice(PREFIX.length);
  // `/api//evil.test/x` would otherwise resolve to another host.
  if (path.startsWith('//') || path.includes('\\')) return problem(404, 'not-found');
  const target = new URL(path + url.search, origin);
  if (target.origin !== origin.origin) return problem(404, 'not-found');

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return problem(413, 'payload-too-large');

  const headers = new Headers(request.headers);
  for (const h of STRIPPED) headers.delete(h);
  for (const h of [...headers.keys()]) if (h.startsWith('cf-')) headers.delete(h);
  headers.set('x-mrak-edge', secret);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-mrak-client-ip', ip);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : null;
  if (body && body.byteLength > MAX_BODY_BYTES) return problem(413, 'payload-too-large');

  try {
    return await doFetch(target, { method: request.method, headers, body, redirect: 'manual' });
  } catch {
    return problem(502, 'api-unreachable');
  }
}
