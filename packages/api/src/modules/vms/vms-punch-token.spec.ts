import { afterEach, describe, expect, it } from 'vitest';
import { generatePunchAuthToken, getPunchSecret, verifyPunchAuthToken } from './vms-punch-auth';

const SECRET = 'unit-test-punch-secret-key-32chars';

describe('VMS punch authorization tokens', () => {
  const previous = {
    JWT_SECRET: process.env.JWT_SECRET,
    SESSION_SECRET: process.env.SESSION_SECRET,
    WORKER_CREDENTIAL_PEPPER: process.env.WORKER_CREDENTIAL_PEPPER,
  };

  afterEach(() => {
    process.env.JWT_SECRET = previous.JWT_SECRET;
    process.env.SESSION_SECRET = previous.SESSION_SECRET;
    process.env.WORKER_CREDENTIAL_PEPPER = previous.WORKER_CREDENTIAL_PEPPER;
  });

  it('refuses to sign or verify without a 32+ character secret', () => {
    delete process.env.JWT_SECRET;
    delete process.env.SESSION_SECRET;
    delete process.env.WORKER_CREDENTIAL_PEPPER;
    expect(() => getPunchSecret()).toThrow(/32\+ characters/);
  });

  it('round-trips a valid token', () => {
    process.env.JWT_SECRET = SECRET;
    const token = generatePunchAuthToken({
      staffMemberId: 'staff-1',
      facilityId: 'facility-1',
      action: 'clock_in',
    });
    const result = verifyPunchAuthToken(token, { facilityId: 'facility-1', action: 'clock_in', staffMemberId: 'staff-1' });
    expect(result).toEqual({ valid: true, staffMemberId: 'staff-1' });
  });

  it('rejects a truncated signature without throwing', () => {
    process.env.JWT_SECRET = SECRET;
    const token = generatePunchAuthToken({
      staffMemberId: 'staff-1',
      facilityId: 'facility-1',
      action: 'clock_in',
    });
    const [body] = token.split('.');
    const result = verifyPunchAuthToken(`${body}.abc`, { facilityId: 'facility-1', action: 'clock_in' });
    expect(result.valid).toBe(false);
  });
});
