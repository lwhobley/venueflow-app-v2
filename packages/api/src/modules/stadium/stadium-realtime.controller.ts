import { Controller, ForbiddenException, MessageEvent, Param, Post, Query, Sse, UnauthorizedException, UseInterceptors } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { Public } from '../../auth/public.decorator';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { canAccessCrossFacilityRealtime, canManageAssignedScope, canViewPilotHealth } from '../../auth/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { SkipTenantTransaction } from '../../prisma/skip-tenant-transaction.decorator';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/stadium')
@RequireSubscription()
export class StadiumRealtimeController {
  constructor(
    private readonly gateway: SuiteHospitalityGateway,
    private readonly prisma: PrismaService,
  ) {}

  @Post('facilities/:facilityId/ticket')
  async createStreamTicket(
    @VenueScope() scope: Scope,
    @Param('facilityId') facilityId: string,
    @Query('zoneId') zoneId?: string,
  ) {
    if (!scope) throw new UnauthorizedException('Authentication required to generate stream ticket.');
    if (scope.venueId !== facilityId && !canAccessCrossFacilityRealtime(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Realtime stream is restricted to assigned facility scope.');
    }
    if (zoneId && !canManageAssignedScope(scope.role) && !canViewPilotHealth(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Zone-scoped realtime stream requires assigned scope authorization.');
    }
    // A role that only has assigned-scope access (not full venue management or
    // platform-wide visibility) must hold a matching ScopeAssignment — for the
    // requested zone, or a facility-wide assignment when no zone is requested.
    // Without this, such a role could request any zoneId (or omit it to get a
    // facility-wide ticket) and receive live operational data for zones it is
    // not actually assigned to. Mirrors SuiteHospitalityController.assertOperator.
    if (scope.venueId === facilityId && canManageAssignedScope(scope.role) && !canViewPilotHealth(scope.role, scope.allAccess)) {
      await this.assertZoneAssignment(scope, zoneId);
    }
    const ticket = await this.gateway.createTicket({
      venueId: scope.venueId,
      role: scope.role,
      allAccess: scope.allAccess,
      facilityId,
      zoneId,
      expiresAt: Date.now() + 60_000,
    });
    return { ticket, expiresInSeconds: 60 };
  }

  @Public()
  @SkipTenantTransaction()
  @Sse('facilities/:facilityId/live-stream')
  async streamFacilityEvents(
    @VenueScope() scope: Scope,
    @Param('facilityId') facilityId: string,
    @Query('zoneId') zoneId?: string,
    @Query('lastEventId') lastEventIdQuery?: string,
    @Query('ticket') ticket?: string,
  ): Promise<Observable<MessageEvent>> {
    let activeRole = scope?.role;
    let activeAllAccess = scope?.allAccess;
    let activeVenueId = scope?.venueId;

    // Support single-use stream ticket authentication if provided
    if (ticket) {
      const ticketPayload = await this.gateway.verifyAndConsumeTicket(ticket);
      if (!ticketPayload || ticketPayload.facilityId !== facilityId) {
        throw new ForbiddenException('Invalid or expired streaming ticket.');
      }
      // The ticket's zone binding is authoritative and was the only thing
      // actually checked against ScopeAssignment at issuance. Without this
      // comparison, a caller could take a legitimately zone-scoped ticket and
      // subscribe to a *different* zone's channel by supplying a different
      // zoneId query param — silently widening the ticket's grant.
      if (ticketPayload.zoneId !== zoneId) {
        throw new ForbiddenException('Invalid or expired streaming ticket.');
      }
      activeRole = ticketPayload.role;
      activeAllAccess = ticketPayload.allAccess;
      activeVenueId = ticketPayload.venueId;
    } else if (!scope) {
      throw new UnauthorizedException('A valid streaming ticket or authorization token is required.');
    }

    if (activeVenueId !== facilityId && !canAccessCrossFacilityRealtime(activeRole, activeAllAccess)) {
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

  // Mirrors SuiteHospitalityController.assertOperator / ConcourseInventoryController.assertOperator.
  private async assertZoneAssignment(scope: Scope, zoneId?: string) {
    const assignment = await this.prisma.scopeAssignment.findFirst({
      where: {
        organizationId: await this.organizationIdFor(scope.venueId),
        active: true,
        membership: { userId: scope.userId, status: 'active' },
        AND: [
          { OR: [{ facilityId: null }, { facilityId: scope.venueId }] },
          zoneId ? { OR: [{ zoneId: null }, { zoneId }] } : { zoneId: null },
        ],
      },
      select: { id: true },
    });
    if (!assignment) {
      throw new ForbiddenException('This realtime stream is outside your assigned facility or zone.');
    }
  }

  private async organizationIdFor(facilityId: string) {
    const venue = await this.prisma.venue.findUniqueOrThrow({ where: { id: facilityId }, select: { organizationId: true } });
    return venue.organizationId;
  }
}

