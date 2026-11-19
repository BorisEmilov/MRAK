import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { scrub } from './sentry.js';

describe('Sentry scrubbing (SEC-OBS-47)', () => {
  it('drops request, user, breadcrumbs, extra and host before sending', () => {
    const event = {
      type: undefined,
      message: 'boom',
      request: { headers: { authorization: 'Bearer x', cookie: '__Secure-mrak_rt=y' } },
      user: { email: 'a@example.com', ip_address: '203.0.113.7' },
      breadcrumbs: [{ message: 'POST /v1/auth/login' }],
      extra: { body: '{"password":"p"}' },
      server_name: 'srv-1',
      exception: { values: [{ type: 'Error', value: 'boom' }] },
    } as unknown as ErrorEvent;
    const out = JSON.stringify(scrub(event));
    expect(out).not.toMatch(/Bearer|mrak_rt|example\.com|203\.0\.113|password|srv-1|login/);
    expect(out).toMatch(/boom/);
  });
});
