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
    gateway.on('org-1:facility-1', (event: any) => seen.push(event.seq));

    await gateway.broadcastBeoUpdate('org-1', 'facility-1', 'zone-1', { beoNumber: 'A' });
    await gateway.broadcastReplenishment('org-1', 'facility-1', 'zone-1', { itemId: 'B' });
    await gateway.broadcastBeoUpdate('org-1', 'facility-1', 'zone-1', { beoNumber: 'C' });

    expect(seen).toEqual([1, 2, 3]);
  });

  it('uses a shared Redis INCR when Redis is configured, instead of the per-instance counter', async () => {
    const gateway = new SuiteHospitalityGateway();
    const incr = vi.fn().mockResolvedValueOnce(501).mockResolvedValueOnce(502);
    (gateway as any).pubClient = { incr, publish: vi.fn().mockResolvedValue(undefined) };

    const seen: number[] = [];
    gateway.on('org-1:facility-1', (event: any) => seen.push(event.seq));

    await gateway.broadcastBeoUpdate('org-1', 'facility-1', 'zone-1', { beoNumber: 'A' });
    await gateway.broadcastReplenishment('org-1', 'facility-1', 'zone-1', { itemId: 'B' });

    expect(incr).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([501, 502]);
  });

  it('falls back to the local counter if the Redis INCR fails, rather than dropping the broadcast', async () => {
    const gateway = new SuiteHospitalityGateway();
    (gateway as any).pubClient = {
      incr: vi.fn().mockRejectedValue(new Error('connection lost')),
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const seen: number[] = [];
    gateway.on('org-1:facility-1', (event: any) => seen.push(event.seq));

    await gateway.broadcastBeoUpdate('org-1', 'facility-1', 'zone-1', { beoNumber: 'A' });

    expect(seen).toEqual([1]);
  });
});

describe('Realtime Gateway Security Isolation Probes (RT-01 through RT-05)', () => {
  it('RT-01: menu overlay updates do not leak to un-namespaced zone:global or another tenant', async () => {
    const gateway = new SuiteHospitalityGateway();
    const receivedTenantA: any[] = [];
    const receivedTenantB: any[] = [];
    const receivedBareGlobal: any[] = [];
    const receivedZoneGlobal: any[] = [];

    gateway.on('org-a:facility-a', (e) => receivedTenantA.push(e));
    gateway.on('org-b:facility-b', (e) => receivedTenantB.push(e));
    gateway.on('global', (e) => receivedBareGlobal.push(e));
    gateway.on('zone:global', (e) => receivedZoneGlobal.push(e));

    await gateway.broadcastBeoUpdate('org-a', 'facility-a', undefined, {
      type: 'menu_overlay_updated',
      name: 'Tenant A VIP Menu',
    });

    expect(receivedTenantA).toHaveLength(1);
    expect(receivedTenantB).toHaveLength(0);
    expect(receivedBareGlobal).toHaveLength(0);
    expect(receivedZoneGlobal).toHaveLength(0);
  });

  it('RT-02: concourse transfer replenishments do not leak to hardcoded zone:zone-central or other facilities', async () => {
    const gateway = new SuiteHospitalityGateway();
    const receivedTenantA: any[] = [];
    const receivedZoneCentral: any[] = [];
    const receivedTenantB: any[] = [];

    gateway.on('org-a:facility-a', (e) => receivedTenantA.push(e));
    gateway.on('zone:zone-central', (e) => receivedZoneCentral.push(e));
    gateway.on('org-b:facility-b', (e) => receivedTenantB.push(e));

    await gateway.broadcastReplenishment('org-a', 'facility-a', undefined, {
      transferId: 'tr-100',
      items: [{ code: 'BEER', quantity: 24 }],
    });

    expect(receivedTenantA).toHaveLength(1);
    expect(receivedZoneCentral).toHaveLength(0);
    expect(receivedTenantB).toHaveLength(0);
  });

  it('RT-03: zone-less kitchen tickets do not leak to un-namespaced zone:global or another facility', async () => {
    const gateway = new SuiteHospitalityGateway();
    const receivedCulinaryA: any[] = [];
    const receivedZoneGlobal: any[] = [];
    const receivedFacilityB: any[] = [];

    gateway.on('org-a:facility-a:area:culinary', (e) => receivedCulinaryA.push(e));
    gateway.on('zone:global', (e) => receivedZoneGlobal.push(e));
    gateway.on('org-b:facility-b:area:culinary', (e) => receivedFacilityB.push(e));

    await gateway.broadcastDistroPickupUpdate(
      'org-a',
      'facility-a',
      null,
      {
        id: 'ticket-99',
        itemName: 'Steak Tartare',
        operationalAreaType: 'culinary',
      },
      'distro_pickup_updated',
    );

    expect(receivedCulinaryA).toHaveLength(1);
    expect(receivedZoneGlobal).toHaveLength(0);
    expect(receivedFacilityB).toHaveLength(0);
  });

  it('RT-04: enforces department operational area isolation at the channel level', async () => {
    const gateway = new SuiteHospitalityGateway();
    const culinarySubscriber: any[] = [];
    const concessionSubscriber: any[] = [];

    // Culinary subscriber only listens to culinary and kitchen channels
    gateway.on('org-1:facility-1:area:culinary', (e) => culinarySubscriber.push(e));
    gateway.on('org-1:facility-1:area:kitchen', (e) => culinarySubscriber.push(e));

    // Concession subscriber listens to concession channel
    gateway.on('org-1:facility-1:area:concession', (e) => concessionSubscriber.push(e));

    // Concession ticket update occurs
    await gateway.broadcastDistroPickupUpdate(
      'org-1',
      'facility-1',
      null,
      {
        id: 'ticket-hotdogs',
        itemName: 'Pretzels and Hotdogs',
        operationalAreaType: 'concession',
      },
      'distro_pickup_updated',
    );

    // Culinary subscriber must NOT receive concessions event
    expect(culinarySubscriber).toHaveLength(0);
    expect(concessionSubscriber).toHaveLength(1);
    expect(concessionSubscriber[0].data.itemName).toBe('Pretzels and Hotdogs');
  });

  it('RT-05: bare global channel is completely retired and receives zero broadcasts', async () => {
    const gateway = new SuiteHospitalityGateway();
    const globalEvents: any[] = [];
    gateway.on('global', (e) => globalEvents.push(e));

    await gateway.broadcastBeoUpdate('org-1', 'facility-1', 'zone-1', { beo: 'test' });
    await gateway.broadcastReplenishment('org-1', 'facility-1', 'zone-1', { rep: 'test' });
    await gateway.broadcastDistroPickupUpdate('org-1', 'facility-1', 'zone-1', {
      id: 't-1',
      operationalAreaType: 'suite',
    });

    expect(globalEvents).toHaveLength(0);
  });

  it('Replay isolation: getEventsSince isolates ring buffer replay by tenant, facility, and operational area', async () => {
    const gateway = new SuiteHospitalityGateway();

    await gateway.broadcastBeoUpdate('org-a', 'facility-a', null, { event: 'beo-a' });
    await gateway.broadcastBeoUpdate('org-b', 'facility-b', null, { event: 'beo-b' });
    await gateway.broadcastDistroPickupUpdate('org-a', 'facility-a', null, {
      id: 'ticket-culinary',
      operationalAreaType: 'culinary',
    });
    await gateway.broadcastDistroPickupUpdate('org-a', 'facility-a', null, {
      id: 'ticket-concession',
      operationalAreaType: 'concession',
    });

    // Tenant A queries without department filter: should only get facility-a events
    const tenantAEvents = gateway.getEventsSince('org-a', 'facility-a', 0);
    expect(tenantAEvents.every((e) => e.organizationId === 'org-a' && e.facilityId === 'facility-a')).toBe(true);
    expect(tenantAEvents).toHaveLength(3);

    // Tenant A queries with culinary-only filter: should not see the concession ticket
    const culinaryEvents = gateway.getEventsSince('org-a', 'facility-a', 0, null, new Set(['culinary']));
    expect(culinaryEvents).toHaveLength(2); // beo-a (general) + ticket-culinary
    expect(culinaryEvents.some((e) => e.data.id === 'ticket-concession')).toBe(false);
  });
});
