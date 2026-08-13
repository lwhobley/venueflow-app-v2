import { Controller, ForbiddenException, MessageEvent, Param, Query, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { canManageAssignedScope, canViewPilotHealth } from '../../auth/roles';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

@Controller('v1/stadium')
export class StadiumRealtimeController {
  constructor(private readonly gateway: SuiteHospitalityGateway) {}

  @Sse('facilities/:facilityId/live-stream')
  streamFacilityEvents(
    @VenueScope() scope: Scope,
    @Param('facilityId') facilityId: string,
    @Query('zoneId') zoneId?: string,
  ): Observable<MessageEvent> {
    if (scope.venueId !== facilityId && !canViewPilotHealth(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Realtime stream is restricted to assigned facility scope.');
    }
    if (zoneId && !canManageAssignedScope(scope.role) && !canViewPilotHealth(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Zone-scoped realtime stream requires assigned scope authorization.');
    }

    return new Observable<MessageEvent>((subscriber) => {
      const channelKey = zoneId ? `zone:${zoneId}` : `facility:${facilityId}`;
      let seq = 0;

      const handler = (payload: unknown) => {
        seq += 1;
        const dataObj = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : { data: payload };
        subscriber.next({
          id: String(seq),
          type: typeof dataObj.event === 'string' ? dataObj.event : 'message',
          data: {
            ...dataObj,
            seq,
          },
        } as MessageEvent);
      };

      this.gateway.on(channelKey, handler);

      return () => {
        this.gateway.off(channelKey, handler);
      };
    });
  }
}

