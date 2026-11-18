/**
 * Live content packs from the CDN (docs/systems/seasonal-events.md → Implementation). Packs are
 * data only: each file's size, SHA-256 and Ed25519 signature are checked against the signed index
 * before it is parsed with the strict pack schema. Anything that fails is skipped, never trusted.
 */
import { ContentPackFile } from '@mrak/content-schema';
import { z } from 'zod';

/** Per-file limit (asset rule: nothing above 2 MB). */
export const MAX_PACK_BYTES = 2 * 1024 * 1024;

const PackIndex = z
  .array(
    z.strictObject({
      // eslint-disable-next-line security/detect-unsafe-regex -- separator-delimited id: linear (timed in docs/security/test-report.md)
      packId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      version: z.string().regex(/^\d+\.\d+\.\d+$/),
      path: z.string().regex(/^[a-z0-9][a-z0-9./-]*\.json$/),
      size: z.int().min(1).max(MAX_PACK_BYTES),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      /** Base64 Ed25519 signature of the file bytes. */
      signature: z.string().min(1).max(200),
    }),
  )
  .max(50);

export type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromBase64 = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Verifies one pack file: size, hash, signature, then the strict schema. */
export async function verifyPack(
  bytes: ArrayBuffer,
  entry: { size: number; sha256: string; signature: string },
  key: CryptoKey,
): Promise<ContentPackFile | null> {
  if (bytes.byteLength !== entry.size || bytes.byteLength > MAX_PACK_BYTES) return null;
  if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== entry.sha256) return null;
  const signed = await crypto.subtle.verify('Ed25519', key, fromBase64(entry.signature), bytes);
  if (!signed) return null;
  try {
    const parsed = ContentPackFile.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function importPackKey(base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(base64), 'Ed25519', false, ['verify']);
}

/** Every pack of the CDN index that verifies; failures are reported and skipped. */
export async function fetchPacks(
  baseUrl: string,
  publicKey: string,
  fetchFn: FetchLike = fetch,
): Promise<ContentPackFile[]> {
  const key = await importPackKey(publicKey);
  const res = await fetchFn(`${baseUrl}/index.json`);
  if (!res.ok) return [];
  const index = PackIndex.safeParse(JSON.parse(new TextDecoder().decode(await res.arrayBuffer())));
  if (!index.success) return [];
  const packs: ContentPackFile[] = [];
  for (const entry of index.data) {
    const file = await fetchFn(`${baseUrl}/${entry.path}`);
    const pack = file.ok ? await verifyPack(await file.arrayBuffer(), entry, key) : null;
    if (pack && pack.packId === entry.packId && pack.version === entry.version) packs.push(pack);
    else console.warn(`[packs] rejected ${entry.packId}@${entry.version}`);
  }
  return packs;
}
