import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';

function computeRevisionHash(parentHash: string | null, version: number, payload: Record<string, unknown>): string {
  const content = JSON.stringify({ parentHash, version, payload });
  return createHash('sha256').update(content).digest('hex');
}

describe('Event Closeout Immutable Revision Hash Chain', () => {
  it('computes deterministic SHA-256 hash for v1 revision', () => {
    const payload = {
      actualAttendance: 45000,
      actualSalesCents: 85000000,
      forecastSalesCents: 80000000,
    };
    const hash1 = computeRevisionHash(null, 1, payload);
    const hash2 = computeRevisionHash(null, 1, payload);

    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(hash2);
  });

  it('chains revision v2 to parent hash v1 deterministically', () => {
    const payloadV1 = { actualAttendance: 45000, actualSalesCents: 85000000 };
    const parentHash = computeRevisionHash(null, 1, payloadV1);

    const payloadV2 = { actualAttendance: 45000, actualSalesCents: 87500000, adjustmentReason: 'Late POS batch audit' };
    const revisionHashV2 = computeRevisionHash(parentHash, 2, payloadV2);

    expect(revisionHashV2).toHaveLength(64);
    expect(revisionHashV2).not.toBe(parentHash);
  });

  it('incorporates outletResults, inventoryResults, and laborResults into revision hash', () => {
    const basePayload = {
      actualAttendance: 45000,
      actualSalesCents: 85000000,
    };
    const withResults = {
      ...basePayload,
      outletResults: { stand101: { salesCents: 1500000 } },
      inventoryResults: { beerKegs: { variance: -2 } },
      laborResults: { supervisors: { hours: 42.5 } },
    };

    const baseHash = computeRevisionHash(null, 1, basePayload);
    const resultsHash = computeRevisionHash(null, 1, withResults);

    expect(resultsHash).toHaveLength(64);
    expect(resultsHash).not.toBe(baseHash);
  });
});
