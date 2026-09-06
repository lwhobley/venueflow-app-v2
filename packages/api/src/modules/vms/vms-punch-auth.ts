import * as crypto from 'crypto';

/**
 * HMAC-signed, short-lived authorization tokens for VMS time-clock punches.
 *
 * Split out of vms.service.ts so the signing secret is resolved in exactly one
 * fail-closed place. The previous inline helper fell back to a secret literal
 * committed to this repository, which let anyone who had read the source forge
 * a punch for any worker whenever the runtime's secrets were missing.
 */

/** Shortest secret accepted, matching the JWT_SECRET floor enforced in auth.module.ts. */
export const MIN_PUNCH_SECRET_LENGTH = 32;

export type PunchAction = 'clock_in' | 'clock_out';

export type PunchTokenPayload = {
  staffMemberId: string;
  facilityId: string;
  action: PunchAction;
  attendanceId?: string;
  expiresInSeconds?: number;
};

export type PunchTokenExpectation = {
  staffMemberId?: string;
  facilityId: string;
  action: PunchAction;
  attendanceId?: string;
};

export type PunchTokenResult = { valid: boolean; staffMemberId?: string; error?: string };

const DEFAULT_TOKEN_TTL_SECONDS = 900;

/**
 * Resolve the punch signing secret, or throw.
 *
 * There is deliberately no fallback value: an unconfigured runtime must fail
 * to issue and fail to accept punch tokens rather than sign them with a
 * predictable key.
 */
export function getPunchSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = (env.JWT_SECRET || env.WORKER_CREDENTIAL_PEPPER || env.SESSION_SECRET || '').trim();
  if (secret.length < MIN_PUNCH_SECRET_LENGTH) {
    throw new Error(
      `Punch authorization is not configured. Set JWT_SECRET or WORKER_CREDENTIAL_PEPPER to at least ${MIN_PUNCH_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

/**
 * Constant-time signature comparison that tolerates attacker-controlled
 * lengths. `crypto.timingSafeEqual` throws on a length mismatch, so a
 * truncated signature has to be rejected before it reaches the compare.
 */
function signaturesMatch(candidate: string, expected: string): boolean {
  const candidateBuf = Buffer.from(candidate);
  const expectedBuf = Buffer.from(expected);
  if (candidateBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(candidateBuf, expectedBuf);
}

export function generatePunchAuthToken(payload: PunchTokenPayload): string {
  const data = {
    staffMemberId: payload.staffMemberId,
    facilityId: payload.facilityId,
    action: payload.action,
    attendanceId: payload.attendanceId,
    exp: Date.now() + (payload.expiresInSeconds ?? DEFAULT_TOKEN_TTL_SECONDS) * 1000,
  };
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}.${sign(body, getPunchSecret())}`;
}

export function verifyPunchAuthToken(token: string, expected: PunchTokenExpectation): PunchTokenResult {
  // Resolved outside the parse guard below: a misconfigured runtime must
  // surface as a 5xx, not as a plain "invalid token" that reads like a client
  // mistake and would let every punch silently fail closed-but-quiet.
  const secret = getPunchSecret();

  let body: string | undefined;
  let signature: string | undefined;
  let data: { staffMemberId?: string; facilityId?: string; action?: string; attendanceId?: string; exp?: number };
  try {
    [body, signature] = token.split('.');
    if (!body || !signature) return { valid: false, error: 'Malformed punch authorization token.' };
    if (!signaturesMatch(signature, sign(body, secret))) {
      return { valid: false, error: 'Invalid punch authorization token signature.' };
    }
    data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, error: 'Failed to verify punch authorization token.' };
  }

  if (typeof data?.exp !== 'number' || Date.now() > data.exp) {
    return { valid: false, error: 'Punch authorization token expired.' };
  }
  if (data.facilityId !== expected.facilityId) {
    return { valid: false, error: 'Punch token bound to different facility.' };
  }
  if (data.action !== expected.action) {
    return { valid: false, error: `Punch token action mismatch: expected ${expected.action}, got ${data.action}.` };
  }
  if (expected.staffMemberId && data.staffMemberId !== expected.staffMemberId) {
    return { valid: false, error: 'Punch token bound to different staff member.' };
  }
  if (expected.attendanceId && data.attendanceId && data.attendanceId !== expected.attendanceId) {
    return { valid: false, error: 'Punch token bound to different attendance record.' };
  }
  return { valid: true, staffMemberId: data.staffMemberId };
}
