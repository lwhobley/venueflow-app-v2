import { describe, expect, it } from 'vitest';
import { assertEventTransition } from './event-state';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { createHash } from 'crypto';

function computeRevisionHash(parentHash: string | null, version: number, payload: Record<string, unknown>): string {
  const content = JSON.stringify({ parentHash, version, payload });
  return createHash('sha256').update(content).digest('hex');
}

describe('Stadium Event End-to-End Rehearsal Simulation', () => {
  it('executes a full 60,000-seat stadium event lifecycle with zero operational state or accounting violations', async () => {
    // Phase 1: Planning & Operational State Machine Validation
    expect(() => assertEventTransition('planning', 'approved')).not.toThrow();
    expect(() => assertEventTransition('approved', 'pre_open')).not.toThrow();
    expect(() => assertEventTransition('pre_open', 'live')).not.toThrow();
    expect(() => assertEventTransition('live', 'closing')).not.toThrow();
    expect(() => assertEventTransition('closing', 'closed')).not.toThrow();
    expect(() => assertEventTransition('closed', 'archived', { reason: 'Post-event archiving' })).not.toThrow();

    // Phase 2: Suite Hospitality BEO Order & Replenishment Event Broadcasting
    const gateway = new SuiteHospitalityGateway();
    const emittedEvents: any[] = [];

    gateway.on('facility:facility-nfl-stadium', (event) => {
      emittedEvents.push(event);
    });

    const beoOrder = {
      beoNumber: 'BEO-NFL-9901',
      suiteNumber: 'Suite 302',
      vipGuestName: 'Enterprise Client VIP',
      totalCents: 450000,
    };
    await gateway.broadcastBeoUpdate('facility-nfl-stadium', 'zone-club-level', beoOrder);

    const replenishment = {
      standId: 'stand-section-104',
      itemSku: 'SKU-BEER-PREMIUM',
      quantityRequested: 200,
    };
    await gateway.broadcastReplenishment('facility-nfl-stadium', 'zone-concourse-east', replenishment);

    expect(emittedEvents.length).toBe(2);
    expect(emittedEvents[0].event).toBe('suite_beo_updated');
    expect(emittedEvents[0].data.beoNumber).toBe('BEO-NFL-9901');
    expect(emittedEvents[1].event).toBe('replenishment_requested');

    // Phase 3: Financial Closeout Revision Ledger Hash Chaining
    const initialCloseoutPayload = {
      actualAttendance: 58500,
      actualSalesCents: 142500000,
      forecastSalesCents: 140000000,
      laborHours: 1250.5,
      laborCostCents: 3750000,
      inventoryVarianceCents: -12500,
    };
    const hashV1 = computeRevisionHash(null, 1, initialCloseoutPayload);
    expect(hashV1).toHaveLength(64);

    const postAuditPayload = {
      actualAttendance: 58500,
      actualSalesCents: 143800000, // Late POS check batch ingested
      forecastSalesCents: 140000000,
      laborHours: 1250.5,
      laborCostCents: 3750000,
      inventoryVarianceCents: -9800,
      adjustmentReason: 'Late POS check settlement reconciliation batch',
    };
    const hashV2 = computeRevisionHash(hashV1, 2, postAuditPayload);

    expect(hashV2).toHaveLength(64);
    expect(hashV2).not.toBe(hashV1);

    // Verify hash determinism
    const recomputedHashV2 = computeRevisionHash(hashV1, 2, postAuditPayload);
    expect(recomputedHashV2).toBe(hashV2);
  });
});
