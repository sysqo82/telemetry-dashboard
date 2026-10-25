import { describe, expect, it } from 'vitest';
import { generateFingerprint } from '../src/services/fingerprint.js';

describe('fingerprint', () => {
  const base = { service: 'svc', exceptionType: 'Err', message: 'x' };

  it('ignores line numbers and message text when a frame exists', () => {
    const a = generateFingerprint({ ...base, stacktrace: 'at run (/app/db.ts:45)' });
    const b = generateFingerprint({ ...base, message: 'y', stacktrace: 'at run (/app/db.ts:99:3)' });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.culprit).toBe('run (/app/db.ts:45)');
  });

  it('differs by service, type and frame', () => {
    const f = (o: object) => generateFingerprint({ ...base, stacktrace: 'at a (/app/a.ts:1)', ...o }).fingerprint;
    expect(f({})).not.toBe(f({ service: 'other' }));
    expect(f({})).not.toBe(f({ exceptionType: 'Other' }));
    expect(f({})).not.toBe(f({ stacktrace: 'at b (/app/b.ts:1)' }));
  });

  it('skips node_modules frames and normalizes message when no stack', () => {
    const r = generateFingerprint({ ...base, stacktrace: 'at x (/node_modules/y.js:1)\nat mine (/app/m.ts:2)' });
    expect(r.culprit).toContain('mine');
    const a = generateFingerprint({ ...base, message: 'user 123 failed' });
    const b = generateFingerprint({ ...base, message: 'user 456 failed' });
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
