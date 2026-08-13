import { describe, expect, it } from 'vitest';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { StadiumRealtimeController } from './stadium-realtime.controller';

describe('StadiumRealtimeController SSE teardown and sequence numbering', () => {
  it('attaches monotonic seq numbers and removes event listener on unsubscription', async () => {
    const gateway = new SuiteHospitalityGateway();
    const controller = new StadiumRealtimeController(gateway);

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

    gateway.broadcastBeoUpdate('facility-1', 'zone-1', { beoNumber: 'BEO-1001' });
    gateway.broadcastReplenishment('facility-1', 'zone-1', { itemId: 'item-1' });

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
    gateway.broadcastBeoUpdate('facility-1', 'zone-1', { beoNumber: 'BEO-1002' });

    // Should NOT receive event after teardown
    expect(received.length).toBe(2);
  });

  it('generates short-lived stream ticket and allows ticket-based streaming with gap recovery', async () => {
    const gateway = new SuiteHospitalityGateway();
    const controller = new StadiumRealtimeController(gateway);

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
    gateway.broadcastBeoUpdate('facility-1', 'zone-1', { beoNumber: 'BEO-2001' });
    gateway.broadcastBeoUpdate('facility-1', 'zone-1', { beoNumber: 'BEO-2002' });

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
    gateway.broadcastReplenishment('facility-1', 'zone-1', { itemId: 'item-live-3' });
    expect(received.length).toBe(2);
    expect(received[1].id).toBe('3');

    subscription.unsubscribe();
  });
});
