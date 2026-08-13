import { Controller, ForbiddenException, MessageEvent, Param, Sse } from '@nestjs/common';
import { EventEmitter } from 'events';
import { Observable, fromEvent } from 'rxjs';
import { map } from 'rxjs/operators';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { canViewPilotHealth } from '../../auth/roles';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

@Controller('v1/stadium')
export class StadiumRealtimeController {
  constructor(private readonly gateway: SuiteHospitalityGateway) {}

  @Sse('facilities/:facilityId/live-stream')
  streamFacilityEvents(@VenueScope() scope: Scope, @Param('facilityId') facilityId: string): Observable<MessageEvent> {
    if (scope.venueId !== facilityId && !canViewPilotHealth(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Realtime stream is restricted to assigned facility scope.');
    }

    const emitter = new EventEmitter();
    const handler = (payload: unknown) => emitter.emit('event', payload);
    const channelKey = `facility:${facilityId}`;

    this.gateway.on(channelKey, handler);

    return fromEvent(emitter, 'event').pipe(
      map((payload) => ({
        data: payload,
      } as MessageEvent)),
    );
  }
}
