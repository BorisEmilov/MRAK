/**
 * Ed25519 signing keys for access tokens (docs/adr/0007-tokens.md). The first key signs; all keys
 * verify (rotation: publish the new key second, then promote it, then drop the old one after
 * the access-token TTL). Private keys come from the secret store (AUTH_JWT_KEYS), never the repo.
 */
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, importJWK, type CryptoKey, type JWK } from 'jose';
import { z } from 'zod';

export interface KeyStore {
  current: { kid: string; key: CryptoKey };
  /** Public keys of every active kid. */
  jwks: { keys: JWK[] };
}

const PrivateJwk = z.object({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  x: z.string(),
  d: z.string(),
  kid: z.string().min(1).max(64),
});

export async function loadKeyStore(json: string): Promise<KeyStore> {
  const jwks = z.array(PrivateJwk).min(1).max(4).parse(JSON.parse(json));
  const [first] = jwks;
  if (!first) throw new Error('AUTH_JWT_KEYS is empty');
  const key = await importJWK({ ...first, alg: 'EdDSA' }, 'EdDSA');
  if (key instanceof Uint8Array) throw new Error('AUTH_JWT_KEYS: not an asymmetric key');
  return {
    current: { kid: first.kid, key },
    jwks: {
      keys: jwks.map(({ kty, crv, x, kid }) => ({ kty, crv, x, kid, alg: 'EdDSA', use: 'sig' })),
    },
  };
}

/** A fresh private JWK (key ceremony / tests); never used implicitly in production. */
export async function generateSigningJwk(kid: string = randomUUID()): Promise<JWK> {
  const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  return { ...(await exportJWK(privateKey)), kid };
}
