import { Controller, ForbiddenException, MessageEvent, Param, Post, Query, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { canManageAssignedScope, canViewPilotHealth } from '../../auth/roles';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

@Controller('v1/stadium')
@RequireSubscription()
export class StadiumRealtimeController {
  constructor(private readonly gateway: SuiteHospitalityGateway) {}

  @Post('facilities/:facilityId/ticket')
  createStreamTicket(
    @VenueScope() scope: Scope,
    @Param('facilityId') facilityId: string,
    @Query('zoneId') zoneId?: string,
  ) {
    if (scope.venueId !== facilityId && !canViewPilotHealth(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Realtime stream is restricted to assigned facility scope.');
    }
    if (zoneId && !canManageAssignedScope(scope.role) && !canViewPilotHealth(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Zone-scoped realtime stream requires assigned scope authorization.');
    }
    const ticket = this.gateway.createTicket({
      venueId: scope.venueId,
      role: scope.role,
      allAccess: scope.allAccess,
      facilityId,
      zoneId,
      expiresAt: Date.now() + 60_000,
    });
    return { ticket, expiresInSeconds: 60 };
  }

  @Sse('facilities/:facilityId/live-stream')
  streamFacilityEvents(
    @VenueScope() scope: Scope,
    @Param('facilityId') facilityId: string,
    @Query('zoneId') zoneId?: string,
    @Query('lastEventId') lastEventIdQuery?: string,
    @Query('ticket') ticket?: string,
  ): Observable<MessageEvent> {
    let activeRole = scope?.role;
    let activeAllAccess = scope?.allAccess;
    let activeVenueId = scope?.venueId;

    // Support single-use stream ticket authentication if provided
    if (ticket) {
      const ticketPayload = this.gateway.verifyAndConsumeTicket(ticket);
      if (!ticketPayload || ticketPayload.facilityId !== facilityId) {
        throw new ForbiddenException('Invalid or expired streaming ticket.');
      }
      activeRole = ticketPayload.role;
      activeAllAccess = ticketPayload.allAccess;
      activeVenueId = ticketPayload.venueId;
    }

    if (activeVenueId !== facilityId && !canViewPilotHealth(activeRole, activeAllAccess)) {
      throw new ForbiddenException('Realtime stream is restricted to assigned facility scope.');
    }
    if (zoneId && !canManageAssignedScope(activeRole) && !canViewPilotHealth(activeRole, activeAllAccess)) {
      throw new ForbiddenException('Zone-scoped realtime stream requires assigned scope authorization.');
    }

    return new Observable<MessageEvent>((subscriber) => {
      const channelKey = zoneId ? `zone:${zoneId}` : `facility:${facilityId}`;
      let currentSeq = 0;

      // True gap recovery: replay any missed events from ring buffer if lastEventId is supplied
      const lastSeq = Number(lastEventIdQuery ?? 0);
      if (Number.isFinite(lastSeq) && lastSeq > 0) {
        const missedEvents = this.gateway.getEventsSince(facilityId, lastSeq, zoneId);
        for (const missed of missedEvents) {
          currentSeq = Math.max(currentSeq, missed.seq);
          subscriber.next({
            id: String(missed.seq),
            type: missed.event,
            data: {
              ...missed.data,
              event: missed.event,
              seq: missed.seq,
              timestamp: missed.timestamp,
            },
          } as MessageEvent);
        }
      }

      const handler = (payload: unknown) => {
        const dataObj = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : { data: payload };
        const seq = typeof dataObj.seq === 'number' ? dataObj.seq : ++currentSeq;
        currentSeq = Math.max(currentSeq, seq);

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

