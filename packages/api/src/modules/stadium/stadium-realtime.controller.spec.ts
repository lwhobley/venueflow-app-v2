import { describe, expect, it } from 'vitest';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { StadiumRealtimeController } from './stadium-realtime.controller';

describe('StadiumRealtimeController SSE teardown and sequence numbering', () => {
  it('attaches monotonic seq numbers and removes event listener on unsubscription', () => {
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

    const stream$ = controller.streamFacilityEvents(scope, 'facility-1');
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
});
