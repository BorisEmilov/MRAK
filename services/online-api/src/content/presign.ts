/**
 * Short-lived presigned GET URLs for paid content in Cloudflare R2 (S3 API, SigV4 query auth).
 * The API never streams content: it checks the entitlement and hands out a URL valid for at most
 * 5 minutes for one object (R2 has no egress fees; threat model C-31).
 */
import { createHash, createHmac } from 'node:crypto';

export const MAX_PRESIGN_SECONDS = 300;

export interface PresignInput {
  /** e.g. "<account>.r2.cloudflarestorage.com" */
  host: string;
  /** Absolute object path, e.g. "/paid-content/packs/winter.json" (path-style for R2). */
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** "auto" for R2. */
  region: string;
  now: Date;
  expiresSeconds: number;
}

/** RFC 3986 encoding as SigV4 requires (keep "/" in paths). */
function enc(value: string, keepSlash = false): string {
  const out = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlash ? out.replaceAll('%2F', '/') : out;
}

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

export function presignGet(i: PresignInput, maxSeconds = MAX_PRESIGN_SECONDS): string {
  if (i.expiresSeconds < 1 || i.expiresSeconds > maxSeconds)
    throw new RangeError(`presigned URLs live 1–${String(maxSeconds)} s`);
  const amzDate = i.now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${i.region}/s3/aws4_request`;
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${i.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(i.expiresSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
    .map(([k, v]) => `${enc(k ?? '')}=${enc(v ?? '')}`)
    .sort()
    .join('&');
  const path = enc(i.path, true);
  const canonical = ['GET', path, query, `host:${i.host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join(
    '\n',
  );
  const toSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonical).digest('hex'),
  ].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, date), i.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `https://${i.host}${path}?${query}&X-Amz-Signature=${signature}`;
}
