import { Controller, ForbiddenException, MessageEvent, Param, Post, Query, Sse, UnauthorizedException, UseInterceptors } from '@nestjs/common';
import { Observable } from 'rxjs';
import { getChannelKeys, SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { Public } from '../../auth/public.decorator';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { canAccessCrossFacilityRealtime, canManageAssignedScope, canViewPilotHealth } from '../../auth/roles';
import { getAuthorizedOperationalAreas } from '../../auth/access-control.helper';
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
    if (scope.venueId === facilityId && canManageAssignedScope(scope.role) && !canViewPilotHealth(scope.role, scope.allAccess)) {
      await this.assertZoneAssignment(scope, zoneId);
    }

    const organizationId = await this.organizationIdFor(facilityId).catch(() => 'default-org');
    const allowedAreasSet = await getAuthorizedOperationalAreas({
      userId: scope.userId,
      venueId: facilityId,
      role: scope.role,
      allAccess: scope.allAccess,
      departmentCode: (scope as any)?.department,
      prisma: this.prisma,
    });
    const allowedAreas = allowedAreasSet ? Array.from(allowedAreasSet) : undefined;

    const ticket = await this.gateway.createTicket({
      venueId: scope.venueId,
      role: scope.role,
      allAccess: scope.allAccess,
      facilityId,
      organizationId,
      zoneId,
      allowedAreas,
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
    let organizationId: string | undefined;
    let allowedAreas: string[] | undefined;

    // Support single-use stream ticket authentication if provided
    if (ticket) {
      const ticketPayload = await this.gateway.verifyAndConsumeTicket(ticket);
      if (!ticketPayload || ticketPayload.facilityId !== facilityId) {
        throw new ForbiddenException('Invalid or expired streaming ticket.');
      }
      if (ticketPayload.zoneId !== zoneId) {
        throw new ForbiddenException('Invalid or expired streaming ticket.');
      }
      activeRole = ticketPayload.role;
      activeAllAccess = ticketPayload.allAccess;
      activeVenueId = ticketPayload.venueId;
      organizationId = ticketPayload.organizationId;
      allowedAreas = ticketPayload.allowedAreas;
    } else if (!scope) {
      throw new UnauthorizedException('A valid streaming ticket or authorization token is required.');
    }

    if (activeVenueId !== facilityId && !canAccessCrossFacilityRealtime(activeRole, activeAllAccess)) {
      throw new ForbiddenException('Realtime stream is restricted to assigned facility scope.');
    }
    if (zoneId && !canManageAssignedScope(activeRole) && !canViewPilotHealth(activeRole, activeAllAccess)) {
      throw new ForbiddenException('Zone-scoped realtime stream requires assigned scope authorization.');
    }

    if (!organizationId) {
      organizationId = await this.organizationIdFor(facilityId).catch(() => 'default-org');
    }
    if (!allowedAreas) {
      const areasSet = await getAuthorizedOperationalAreas({
        userId: scope?.userId,
        venueId: facilityId,
        role: activeRole,
        allAccess: activeAllAccess,
        departmentCode: (scope as any)?.department,
        prisma: this.prisma,
      });
      allowedAreas = areasSet ? Array.from(areasSet) : undefined;
    }

    const channelKeys = getChannelKeys({
      organizationId,
      facilityId,
      zoneId,
      allowedAreas,
    });

    return new Observable<MessageEvent>((subscriber) => {
      let currentSeq = 0;
      const allowedAreasSet = new Set((allowedAreas || []).map((a) => a.toLowerCase()));
      const isBroadAdmin =
        Boolean(activeAllAccess) ||
        activeRole === 'platform_admin' ||
        activeRole === 'organization_admin' ||
        activeRole === 'owner' ||
        activeRole === 'admin';

      // True gap recovery: replay any missed events from ring buffer if lastEventId is supplied
      const lastSeq = Number(lastEventIdQuery ?? 0);
      if (Number.isFinite(lastSeq) && lastSeq > 0) {
        const missedEvents = this.gateway.getEventsSince(
          organizationId,
          facilityId,
          lastSeq,
          zoneId,
          isBroadAdmin ? null : allowedAreasSet,
        );
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

        // Defense-in-depth: check operationalAreaType if present on ticket/event data
        const eventArea = (dataObj.data && typeof dataObj.data === 'object' && (dataObj.data as any).operationalAreaType)
          ? String((dataObj.data as any).operationalAreaType).toLowerCase()
          : (dataObj.operationalAreaType ? String(dataObj.operationalAreaType).toLowerCase() : null);

        if (eventArea && !isBroadAdmin && !allowedAreasSet.has(eventArea)) {
          return; // Drop event if outside subscriber's allowed operational area
        }

        const seq = typeof dataObj.seq === 'number' ? dataObj.seq : ++currentSeq;
        currentSeq = Math.max(currentSeq, seq);

        const innerData =
          typeof dataObj.data === 'object' && dataObj.data !== null
            ? (dataObj.data as Record<string, unknown>)
            : {};

        subscriber.next({
          id: String(seq),
          type: typeof dataObj.event === 'string' ? dataObj.event : 'message',
          data: {
            ...innerData,
            ...dataObj,
            seq,
          },
        } as MessageEvent);
      };

      for (const ch of channelKeys) {
        this.gateway.on(ch, handler);
      }

      return () => {
        for (const ch of channelKeys) {
          this.gateway.off(ch, handler);
        }
      };
    });
  }

  // Mirrors SuiteHospitalityController.assertOperator / ConcourseInventoryController.assertOperator.
  private async assertZoneAssignment(scope: Scope, zoneId?: string) {
    const orgId = await this.organizationIdFor(scope.venueId);
    const assignment = await this.prisma.scopeAssignment.findFirst({
      where: {
        organizationId: orgId,
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

  private async organizationIdFor(facilityId: string): Promise<string> {
    if (this.prisma?.venue?.findUniqueOrThrow) {
      const venue = await this.prisma.venue.findUniqueOrThrow({
        where: { id: facilityId },
        select: { organizationId: true },
      });
      return venue.organizationId;
    }
    if (this.prisma?.venue?.findUnique) {
      const venue = await this.prisma.venue.findUnique({
        where: { id: facilityId },
        select: { organizationId: true },
      });
      if (venue?.organizationId) return venue.organizationId;
    }
    return 'default-org';
  }
}
