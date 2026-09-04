import { describe, expect, it } from 'vitest';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { StadiumRealtimeController } from './stadium-realtime.controller';

function makePrismaStub(overrides: Record<string, unknown> = {}) {
  return {
    venue: { findUniqueOrThrow: async () => ({ organizationId: 'org-1' }) },
    scopeAssignment: { findFirst: async () => null },
    ...overrides,
  } as any;
}

describe('StadiumRealtimeController SSE teardown and sequence numbering', () => {
  it('attaches monotonic seq numbers and removes event listener on unsubscription', async () => {
    const gateway = new SuiteHospitalityGateway();
    const controller = new StadiumRealtimeController(gateway, makePrismaStub());

    const scope = {
      userId: 'user-1',
      profileId: 'profile-1',
      fullName: 'Manager',
      venueId: 'facility-1',
      venueName: 'Facility',
      role: 'event_manager',
      allAccess: false,
      subscriptionStatus: 'active',
      trialEndsAt: null,
    };

    const stream$ = await controller.streamFacilityEvents(scope, 'facility-1');
    const received: any[] = [];

    const subscription = stream$.subscribe((event) => {
      received.push(event);
    });

    await gateway.broadcastBeoUpdate('org-1', 'facility-1', 'zone-1', { beoNumber: 'BEO-1001' });
    await gateway.broadcastReplenishment('org-1', 'facility-1', 'zone-1', { itemId: 'item-1' });

    expect(received.length).toBe(2);
    expect(received[0].id).toBe('1');
    expect(received[0].data.seq).toBe(1);
    expect(received[0].type).toBe('suite_beo_updated');

    expect(received[1].id).toBe('2');
    expect(received[1].data.seq).toBe(2);
    expect(received[1].type).toBe('replenishment_requested');

    // Unsubscribe / teardown
    subscription.unsubscribe();

    // Broadcast another event after unsubscription
    await gateway.broadcastBeoUpdate('org-1', 'facility-1', 'zone-1', { beoNumber: 'BEO-1002' });

    // Should NOT receive event after teardown
    expect(received.length).toBe(2);
  });

  it('generates short-lived stream ticket and allows ticket-based streaming with gap recovery', async () => {
    const gateway = new SuiteHospitalityGateway();
    const controller = new StadiumRealtimeController(gateway, makePrismaStub());

    const scope = {
      userId: 'user-1',
      profileId: 'profile-1',
      fullName: 'Manager',
      venueId: 'facility-1',
      venueName: 'Facility',
      role: 'event_manager',
      allAccess: false,
      subscriptionStatus: 'active',
      trialEndsAt: null,
    };

    // 1. Generate stream ticket
    const { ticket } = await controller.createStreamTicket(scope, 'facility-1');
    expect(ticket).toBeDefined();

    // 2. Broadcast events into the gateway buffer before connection
    await gateway.broadcastBeoUpdate('org-1', 'facility-1', 'zone-1', { beoNumber: 'BEO-2001' });
    await gateway.broadcastBeoUpdate('org-1', 'facility-1', 'zone-1', { beoNumber: 'BEO-2002' });

    // 3. Connect with ticket and lastEventId = "1" to request missed event #2
    const stream$ = await controller.streamFacilityEvents(null as any, 'facility-1', undefined, '1', ticket);
    const received: any[] = [];
    const subscription = stream$.subscribe((event) => {
      received.push(event);
    });

    // Should immediately replay event #2
    expect(received.length).toBe(1);
    expect(received[0].id).toBe('2');
    expect(received[0].data.beoNumber).toBe('BEO-2002');

    // 4. Now broadcast live event #3
    await gateway.broadcastReplenishment('org-1', 'facility-1', 'zone-1', { itemId: 'item-live-3' });
    expect(received.length).toBe(2);
    expect(received[1].id).toBe('3');

    subscription.unsubscribe();
  });

  it('isolates cross-tenant events and filters out unauthorized department events in streamFacilityEvents', async () => {
    const gateway = new SuiteHospitalityGateway();
    const controller = new StadiumRealtimeController(gateway, makePrismaStub());

    const culinaryScope = {
      userId: 'user-cook',
      profileId: 'profile-cook',
      fullName: 'Cook',
      venueId: 'facility-1',
      venueName: 'Facility 1',
      role: 'staff',
      department: 'culinary',
      allAccess: false,
      subscriptionStatus: 'active',
      trialEndsAt: null,
    };

    const stream$ = await controller.streamFacilityEvents(culinaryScope, 'facility-1');
    const received: any[] = [];
    const subscription = stream$.subscribe((event) => {
      received.push(event);
    });

    // 1. Broadcast from another tenant (org-2) to facility-1: must NEVER arrive
    await gateway.broadcastDistroPickupUpdate('org-2', 'facility-1', null, {
      id: 'ticket-org-2',
      operationalAreaType: 'culinary',
    });

    // 2. Broadcast concession event from org-1 to facility-1: culinary subscriber must not see it
    await gateway.broadcastDistroPickupUpdate('org-1', 'facility-1', null, {
      id: 'ticket-concession',
      operationalAreaType: 'concession',
    });

    // 3. Broadcast culinary event from org-1 to facility-1: culinary subscriber MUST receive it
    await gateway.broadcastDistroPickupUpdate('org-1', 'facility-1', null, {
      id: 'ticket-culinary-allowed',
      operationalAreaType: 'culinary',
    });

    expect(received).toHaveLength(1);
    expect(received[0].data.id).toBe('ticket-culinary-allowed');

    subscription.unsubscribe();
  });
});

describe('StadiumRealtimeController zone-assignment enforcement', () => {
  const assignedScopeUser = {
    userId: 'user-2',
    profileId: 'profile-2',
    fullName: 'Suite Manager',
    venueId: 'facility-1',
    venueName: 'Facility',
    role: 'suite_manager',
    allAccess: false,
    subscriptionStatus: 'active',
    trialEndsAt: null,
  };

  it('rejects a ticket request for a zone the caller has no ScopeAssignment for', async () => {
    const gateway = new SuiteHospitalityGateway();
    const prisma = makePrismaStub({ scopeAssignment: { findFirst: async () => null } });
    const controller = new StadiumRealtimeController(gateway, prisma);

    await expect(controller.createStreamTicket(assignedScopeUser, 'facility-1', 'zone-other')).rejects.toThrow(
      'This realtime stream is outside your assigned facility or zone.',
    );
  });

  it('rejects an omitted zoneId (facility-wide ticket) unless the caller holds a facility-wide ScopeAssignment', async () => {
    const gateway = new SuiteHospitalityGateway();
    const prisma = makePrismaStub({ scopeAssignment: { findFirst: async () => null } });
    const controller = new StadiumRealtimeController(gateway, prisma);

    await expect(controller.createStreamTicket(assignedScopeUser, 'facility-1')).rejects.toThrow(
      'This realtime stream is outside your assigned facility or zone.',
    );
  });

  it('issues a ticket when a matching ScopeAssignment exists', async () => {
    const gateway = new SuiteHospitalityGateway();
    const prisma = makePrismaStub({ scopeAssignment: { findFirst: async () => ({ id: 'assignment-1' }) } });
    const controller = new StadiumRealtimeController(gateway, prisma);

    const { ticket } = await controller.createStreamTicket(assignedScopeUser, 'facility-1', 'zone-mine');
    expect(ticket).toBeDefined();
  });

  it('rejects streaming when the ticket zone does not match the requested zone', async () => {
    const gateway = new SuiteHospitalityGateway();
    const prisma = makePrismaStub({ scopeAssignment: { findFirst: async () => ({ id: 'assignment-1' }) } });
    const controller = new StadiumRealtimeController(gateway, prisma);

    const { ticket } = await controller.createStreamTicket(assignedScopeUser, 'facility-1', 'zone-mine');

    // Replaying the ticket with a different zoneId query param must not widen
    // its grant to another zone.
    await expect(
      controller.streamFacilityEvents(null as any, 'facility-1', 'zone-other', undefined, ticket),
    ).rejects.toThrow('Invalid or expired streaming ticket.');
  });

  it('narrows cross-facility ticket access to platform-wide roles', async () => {
    const gateway = new SuiteHospitalityGateway();
    const controller = new StadiumRealtimeController(gateway, makePrismaStub());

    const auditorAtOtherVenue = {
      userId: 'user-3',
      profileId: 'profile-3',
      fullName: 'Auditor',
      venueId: 'facility-2',
      venueName: 'Other Facility',
      role: 'auditor',
      allAccess: false,
      subscriptionStatus: 'active',
      trialEndsAt: null,
    };

    // An auditor at their own venue is not platform-wide, so viewing a
    // different facility must be rejected even though canViewPilotHealth('auditor') is true.
    await expect(controller.createStreamTicket(auditorAtOtherVenue, 'facility-1')).rejects.toThrow(
      'Realtime stream is restricted to assigned facility scope.',
    );
  });
});
