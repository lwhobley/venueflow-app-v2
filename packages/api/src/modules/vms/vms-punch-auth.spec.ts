import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generatePunchAuthToken, getPunchSecret, verifyPunchAuthToken } from './vms-punch-auth';

const VALID_SECRET = 'punch-secret-that-is-long-enough-32';

const SECRET_KEYS = ['JWT_SECRET', 'WORKER_CREDENTIAL_PEPPER', 'SESSION_SECRET'] as const;
const saved: Partial<Record<(typeof SECRET_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of SECRET_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.JWT_SECRET = VALID_SECRET;
});

afterEach(() => {
  for (const key of SECRET_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const expectation = { facilityId: 'facility-1', action: 'clock_in' } as const;

function token(overrides: Record<string, unknown> = {}) {
  return generatePunchAuthToken({
    staffMemberId: 'staff-1',
    facilityId: 'facility-1',
    action: 'clock_in',
    ...overrides,
  } as any);
}

describe('getPunchSecret', () => {
  it('throws when no secret is configured rather than using a built-in fallback', () => {
    delete process.env.JWT_SECRET;

    expect(() => getPunchSecret()).toThrow(/at least 32 characters/);
  });

  it('throws for a secret shorter than 32 characters', () => {
    process.env.JWT_SECRET = 'too-short';

    expect(() => getPunchSecret()).toThrow(/at least 32 characters/);
  });

  it('accepts WORKER_CREDENTIAL_PEPPER when JWT_SECRET is absent', () => {
    delete process.env.JWT_SECRET;
    process.env.WORKER_CREDENTIAL_PEPPER = VALID_SECRET;

    expect(getPunchSecret()).toBe(VALID_SECRET);
  });
});

describe('punch authorization tokens', () => {
  it('round-trips a token it just signed', () => {
    expect(verifyPunchAuthToken(token(), expectation)).toEqual({ valid: true, staffMemberId: 'staff-1' });
  });

  it('signing throws when the secret is missing', () => {
    delete process.env.JWT_SECRET;

    expect(() => token()).toThrow(/at least 32 characters/);
  });

  it('verifying throws when the secret is missing, rather than reporting a client error', () => {
    const signed = token();
    delete process.env.JWT_SECRET;

    expect(() => verifyPunchAuthToken(signed, expectation)).toThrow(/at least 32 characters/);
  });

  it('rejects a truncated signature without throwing', () => {
    const [body, signature] = token().split('.');

    expect(verifyPunchAuthToken(`${body}.${signature.slice(0, 5)}`, expectation)).toEqual({
      valid: false,
      error: 'Invalid punch authorization token signature.',
    });
  });

  it('rejects a token signed with a different secret', () => {
    const signed = token();
    process.env.JWT_SECRET = 'another-secret-that-is-long-enough!';

    expect(verifyPunchAuthToken(signed, expectation).valid).toBe(false);
  });

  it('rejects a malformed token', () => {
    expect(verifyPunchAuthToken('not-a-token', expectation)).toEqual({
      valid: false,
      error: 'Malformed punch authorization token.',
    });
  });

  it('rejects an expired token', () => {
    const signed = token({ expiresInSeconds: -1 });

    expect(verifyPunchAuthToken(signed, expectation).error).toBe('Punch authorization token expired.');
  });

  it('rejects a token bound to another facility', () => {
    expect(verifyPunchAuthToken(token(), { ...expectation, facilityId: 'facility-2' }).error).toBe(
      'Punch token bound to different facility.',
    );
  });

  it('rejects a clock-out token presented for a clock-in', () => {
    const signed = token({ action: 'clock_out' });

    expect(verifyPunchAuthToken(signed, expectation).error).toMatch(/action mismatch/);
  });

  it('rejects a token bound to another staff member', () => {
    expect(verifyPunchAuthToken(token(), { ...expectation, staffMemberId: 'staff-2' }).error).toBe(
      'Punch token bound to different staff member.',
    );
  });

  it('rejects a token bound to another attendance record', () => {
    const signed = token({ action: 'clock_out', attendanceId: 'att-1' });

    expect(
      verifyPunchAuthToken(signed, { facilityId: 'facility-1', action: 'clock_out', attendanceId: 'att-2' }).error,
    ).toBe('Punch token bound to different attendance record.');
  });
});
