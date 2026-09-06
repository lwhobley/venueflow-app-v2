import { InternalServerErrorException } from '@nestjs/common';
import * as crypto from 'crypto';

export function getPunchSecret(): string {
  const secret = (process.env.WORKER_CREDENTIAL_PEPPER || process.env.JWT_SECRET || process.env.SESSION_SECRET || '').trim();
  if (secret.length < 32) {
    throw new InternalServerErrorException(
      'WORKER_CREDENTIAL_PEPPER or JWT_SECRET (32+ characters) is required for punch authorization.',
    );
  }
  return secret;
}

export function generatePunchAuthToken(payload: {
  staffMemberId: string;
  facilityId: string;
  action: 'clock_in' | 'clock_out';
  attendanceId?: string;
  expiresInSeconds?: number;
}): string {
  const exp = Date.now() + (payload.expiresInSeconds ?? 900) * 1000;
  const data = {
    staffMemberId: payload.staffMemberId,
    facilityId: payload.facilityId,
    action: payload.action,
    attendanceId: payload.attendanceId,
    exp,
  };
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto.createHmac('sha256', getPunchSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyPunchAuthToken(token: string, expected: {
  staffMemberId?: string;
  facilityId: string;
  action: 'clock_in' | 'clock_out';
  attendanceId?: string;
}): { valid: boolean; staffMemberId?: string; error?: string } {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return { valid: false, error: 'Malformed punch authorization token.' };
    const expectedSig = crypto.createHmac('sha256', getPunchSecret()).update(body).digest('base64url');
    const providedBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      return { valid: false, error: 'Invalid punch authorization token signature.' };
    }
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (Date.now() > data.exp) {
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
  } catch {
    return { valid: false, error: 'Failed to verify punch authorization token.' };
  }
}
