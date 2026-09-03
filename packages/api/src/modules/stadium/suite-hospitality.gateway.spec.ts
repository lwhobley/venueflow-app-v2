import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';

function payload(expiresAt: number) {
  return { venueId: 'venue-1', role: 'suite_manager', allAccess: false, facilityId: 'facility-1', expiresAt };
}

describe('SuiteHospitalityGateway ticket eviction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sweeps unconsumed, expired tickets on the next ticket creation', async () => {
    const gateway = new SuiteHospitalityGateway();
    vi.setSystemTime(0);

    // Issued but never consumed — this is the leak the eviction guards against.
    const stale = await gateway.createTicket(payload(60_000));

    vi.setSystemTime(120_000); // well past the stale ticket's expiry
    await gateway.createTicket(payload(180_000));

    // The stale ticket must no longer be redeemable once it has been swept.
    expect(await gateway.verifyAndConsumeTicket(stale)).toBeNull();
  });

  it('does not evict a ticket that has not expired yet', async () => {
    const gateway = new SuiteHospitalityGateway();
    vi.setSystemTime(0);

    const live = await gateway.createTicket(payload(60_000));

    vi.setSystemTime(10_000); // before expiry
    await gateway.createTicket(payload(120_000));

    const consumed = await gateway.verifyAndConsumeTicket(live);
    expect(consumed).not.toBeNull();
    expect(consumed?.facilityId).toBe('facility-1');
  });
});

describe('SuiteHospitalityGateway sequence numbering', () => {
  it('assigns strictly increasing local sequence numbers with no Redis configured', async () => {
    const gateway = new SuiteHospitalityGateway();
    const seen: number[] = [];
    gateway.on('facility:facility-1', (event: any) => seen.push(event.seq));

    await gateway.broadcastBeoUpdate('facility-1', 'zone-1', { beoNumber: 'A' });
    await gateway.broadcastReplenishment('facility-1', 'zone-1', { itemId: 'B' });
    await gateway.broadcastBeoUpdate('facility-1', 'zone-1', { beoNumber: 'C' });

    expect(seen).toEqual([1, 2, 3]);
  });

  it('uses a shared Redis INCR when Redis is configured, instead of the per-instance counter', async () => {
    const gateway = new SuiteHospitalityGateway();
    const incr = vi.fn().mockResolvedValueOnce(501).mockResolvedValueOnce(502);
    // Inject a fake Redis client — this deliberately reaches past the public
    // API to exercise the cluster-wide branch without a real Redis server.
    (gateway as any).pubClient = { incr, publish: vi.fn().mockResolvedValue(undefined) };

    const seen: number[] = [];
    gateway.on('facility:facility-1', (event: any) => seen.push(event.seq));

    await gateway.broadcastBeoUpdate('facility-1', 'zone-1', { beoNumber: 'A' });
    await gateway.broadcastReplenishment('facility-1', 'zone-1', { itemId: 'B' });

    expect(incr).toHaveBeenCalledTimes(2);
    // Values come straight from the shared counter (501, 502), not a
    // restarted-at-1 local counter — this is what makes them collision-free
    // across replicas that each start their own local counter at 0.
    expect(seen).toEqual([501, 502]);
  });

  it('falls back to the local counter if the Redis INCR fails, rather than dropping the broadcast', async () => {
    const gateway = new SuiteHospitalityGateway();
    (gateway as any).pubClient = {
      incr: vi.fn().mockRejectedValue(new Error('connection lost')),
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const seen: number[] = [];
    gateway.on('facility:facility-1', (event: any) => seen.push(event.seq));

    await gateway.broadcastBeoUpdate('facility-1', 'zone-1', { beoNumber: 'A' });

    expect(seen).toEqual([1]);
  });
});
