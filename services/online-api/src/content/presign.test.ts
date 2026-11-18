import { describe, expect, it } from 'vitest';
import { presignGet } from './presign.js';

describe('R2 presigned URLs (SigV4)', () => {
  it('matches the AWS documentation example signature', () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html (example request).
    const url = presignGet(
      {
        host: 'examplebucket.s3.amazonaws.com',
        path: '/test.txt',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
        now: new Date('2013-05-24T00:00:00Z'),
        expiresSeconds: 86400,
      },
      86400,
    );
    expect(url).toContain(
      'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('never signs URLs that live longer than 5 minutes', () => {
    const base = {
      host: 'acct.r2.cloudflarestorage.com',
      path: '/paid/pack one.json',
      accessKeyId: 'k',
      secretAccessKey: 's',
      region: 'auto',
      now: new Date('2026-11-17T12:00:00Z'),
    };
    expect(() => presignGet({ ...base, expiresSeconds: 301 })).toThrow(RangeError);
    const url = new URL(presignGet({ ...base, expiresSeconds: 300 }));
    expect(url.pathname).toBe('/paid/pack%20one.json');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  });
});
