/**
 * Studio access (docs/systems/studio.md → Access): never public. Production requires a valid
 * Cloudflare Access JWT; without Access configuration only loopback/private peers are served.
 * The peer is the TCP socket address, never X-Forwarded-For (a client could forge it).
 */
import type { RequestHandler } from 'express';
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { isIP } from 'node:net';

/** Verifies `Cf-Access-Jwt-Assertion` → the user's email, or null. */
export type AccessVerifier = (token: string) => Promise<string | null>;

export function accessVerifier(
  teamDomain: string,
  audience: string,
  jwks?: JSONWebKeySet,
): AccessVerifier {
  const keys = jwks
    ? createLocalJWKSet(jwks)
    : createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: `https://${teamDomain}`,
        audience,
        algorithms: ['RS256'],
      });
      return typeof payload['email'] === 'string' ? payload['email'] : null;
    } catch {
      return null;
    }
  };
}

/** Loopback and private (RFC 1918 / ULA) peers: the developer's machine or the compose network. */
export function localPeer(address: string | undefined): boolean {
  const a = (address ?? '').replace(/^::ffff:/, '');
  if (a === '::1' || a.startsWith('127.')) return true;
  if (isIP(a) === 4) {
    const [x = 0, y = 0] = a.split('.').map(Number);
    return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
  }
  return /^f[cd][0-9a-f]{2}:/i.test(a);
}

export function accessGuard(opts: {
  verify?: AccessVerifier;
  allowPeer?: (address: string | undefined) => boolean;
}): RequestHandler {
  const allowPeer = opts.allowPeer ?? localPeer;
  return (req, res, next) => {
    if (req.method === 'GET' && req.path === '/health') {
      next();
      return;
    }
    if (!opts.verify) {
      if (!allowPeer(req.socket.remoteAddress)) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      res.locals['author'] = 'local';
      next();
      return;
    }
    const token = req.get('cf-access-jwt-assertion') ?? '';
    opts
      .verify(token)
      .then((email) => {
        if (!email) {
          res.status(401).json({ error: 'access_required' });
          return;
        }
        res.locals['author'] = email.slice(0, 120);
        next();
      })
      .catch(next);
  };
}
