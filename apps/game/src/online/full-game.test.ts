import { createHash } from 'node:crypto';
import type { StoreClient } from '@mrak/api-client';
import { describe, expect, it } from 'vitest';
import { downloadFullPack } from './full-game';

const pack = {
  packId: 'mrak-full',
  version: '1.0.0',
  entries: {},
  files: {},
  treeNodes: {},
  locales: { en: {} },
};
const bytes = Buffer.from(JSON.stringify(pack));
const sha = createHash('sha256').update(bytes).digest('hex');

function client(over: Partial<{ sha256: string; bytes: number }> = {}): StoreClient {
  return {
    fullPack: () =>
      Promise.resolve({
        url: 'https://r2.test/p',
        version: '1.0.0',
        sha256: sha,
        bytes: bytes.length,
        expiresAt: '',
        ...over,
      }),
  } as unknown as StoreClient;
}
const fetchOk = (() => Promise.resolve(new Response(bytes))) as unknown as typeof fetch;

describe('full pack download (docs/systems/store.md)', () => {
  it('accepts the pack only when size, hash and schema match', async () => {
    await expect(downloadFullPack(client(), fetchOk)).resolves.toMatchObject({
      packId: 'mrak-full',
    });
    await expect(downloadFullPack(client({ sha256: '0'.repeat(64) }), fetchOk)).rejects.toThrow(
      'hash',
    );
    await expect(downloadFullPack(client({ bytes: 3 }), fetchOk)).rejects.toThrow('size');
    const expired = (() =>
      Promise.resolve(new Response('', { status: 403 }))) as unknown as typeof fetch;
    await expect(downloadFullPack(client(), expired)).rejects.toThrow('403');
  });
});
