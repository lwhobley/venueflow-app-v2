import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { createHash } from 'crypto';
import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { canFinalizeCloseout, canManageAssignedScope, canManageVenue, canOverrideEventState, canViewPilotHealth } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { withTenantTransaction } from '../../prisma/tenant-transaction';
import { Prisma } from '@prisma/client';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { assertEventTransition, EVENT_OPERATIONAL_STATES, legacyStatusForState, type EventOperationalState } from './event-state';
import { organizationIdForPairedVenue } from '../../common/venue-facility';


type Scope = NonNullable<VenueScopedRequest['venueScope']>;

const ZONE_TYPES = ['concession_stand', 'grab_and_go', 'portable_cart', 'kiosk', 'food_vendor', 'commissary', 'production_kitchen', 'premium_suite', 'premium_club', 'loge_hospitality', 'in_seat_service', 'catering', 'banquet', 'bar', 'beer_cart', 'beverage', 'mobile_pickup', 'retail_fnb', 'partner_pop_up', 'back_of_house', 'other'] as const;
const FNB_DEPARTMENTS = ['concessions', 'culinary_production', 'premium_hospitality', 'catering_banquets', 'beverage_operations', 'retail_fnb', 'vendor_partners'] as const;
const ZONE_STATUSES = ['open', 'restricted', 'closed', 'incident'] as const;
const EVENT_TYPES = ['game', 'concert', 'tournament', 'festival', 'community', 'corporate', 'other'] as const;
const EVENT_STATUSES = ['draft', 'planning', 'ready', 'live', 'completed', 'cancelled'] as const;
const READINESS_STATUSES = ['not_started', 'in_progress', 'ready', 'blocked'] as const;
const PARTNER_TYPES = ['local_concept', 'restaurant_concept', 'pop_up', 'licensed_brand', 'food_vendor', 'beverage_vendor', 'distributor', 'other'] as const;
const PARTNER_STATUSES = ['onboarding', 'approved', 'active', 'paused', 'noncompliant', 'terminated'] as const;
const ISSUE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

class CreateZoneDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsIn(FNB_DEPARTMENTS) department!: (typeof FNB_DEPARTMENTS)[number];
  @IsIn(ZONE_TYPES) type!: (typeof ZONE_TYPES)[number];
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsString() stadiumZone?: string;
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() notes?: string;
}

class UpdateZoneStatusDto {
  @IsIn(ZONE_STATUSES) status!: (typeof ZONE_STATUSES)[number];
}

class CreateEventDto {
  @IsString() title!: string;
  @IsOptional() @IsString() eventCode?: string;
  @IsIn(EVENT_TYPES) eventType!: (typeof EVENT_TYPES)[number];
  @IsDateString() startsAt!: string;
  @IsOptional() @IsDateString() gatesOpenAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsInt() @Min(0) expectedAttendance?: number;
  @IsOptional() @IsString() opponentOrHeadliner?: string;
  @IsOptional() @IsString() notes?: string;
}

class UpdateEventStatusDto {
  @IsIn(EVENT_STATUSES) status!: (typeof EVENT_STATUSES)[number];
  @IsOptional() @IsString() reason?: string;
}

class UpdateEventOperationalStateDto {
  @IsIn(EVENT_OPERATIONAL_STATES) state!: EventOperationalState;
  @IsOptional() @IsString() reason?: string;
}

class EventPlanOptionsDto {
  @IsOptional() @IsBoolean() use_historical_events?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(10) max_comparables?: number;
  @IsOptional() @IsBoolean() apply_weather_adjustments?: boolean;
  @IsOptional() @IsBoolean() include_labor_plan?: boolean;
  @IsOptional() @IsBoolean() include_production_plan?: boolean;
  @IsOptional() @IsBoolean() include_par_plan?: boolean;
  @IsOptional() @IsBoolean() include_checklists?: boolean;
}

class GenerateEventPlanDto {
  @IsString() venue_id!: string;
  @IsString() event_id!: string;
  options!: EventPlanOptionsDto;
}

class UpdateReadinessDto {
  @IsIn(READINESS_STATUSES) status!: (typeof READINESS_STATUSES)[number];
  @IsOptional() @IsString() notes?: string;
}

class CreateEventIssueDto {
  @IsOptional() @IsString() outletId?: string;
  @IsString() issueType!: string;
  @IsIn(ISSUE_SEVERITIES) severity!: (typeof ISSUE_SEVERITIES)[number];
  @IsString() title!: string;
  @IsString() description!: string;
  @IsOptional() @IsString() ownerUserId?: string;
  @IsOptional() @IsString() clientMutationId?: string;
}

class ResolveEventIssueDto {
  @IsString() resolutionNotes!: string;
}

class EventIssueQueryDto {
  @IsOptional() @IsIn(ISSUE_SEVERITIES) severity?: (typeof ISSUE_SEVERITIES)[number];
  @IsOptional() @IsIn(['open', 'acknowledged', 'resolved']) status?: 'open' | 'acknowledged' | 'resolved';
  @IsOptional() @IsString() outletId?: string;
}

class UpsertEventCloseoutDto {
  @IsOptional() @IsIn(['draft', 'finalized', 'adjusted']) status?: 'draft' | 'finalized' | 'adjusted';
  @IsOptional() @IsInt() @Min(0) actualAttendance?: number;
  @IsOptional() @IsInt() actualSalesCents?: number;
  @IsOptional() @IsInt() forecastSalesCents?: number;
  @IsOptional() @IsNumber() @Min(0) laborHours?: number;
  @IsOptional() @IsInt() laborCostCents?: number;
  @IsOptional() @IsInt() inventoryVarianceCents?: number;
  @IsOptional() outletResults?: Record<string, unknown>;
  @IsOptional() inventoryResults?: Record<string, unknown>;
  @IsOptional() laborResults?: Record<string, unknown>;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() adjustmentReason?: string;
}

class SubmitCloseoutRevisionDto extends PartialType(UpsertEventCloseoutDto) {
  @IsString() adjustmentReason!: string;
}

function computeRevisionHash(parentHash: string | null, version: number, payload: Record<string, unknown>): string {
  const content = JSON.stringify({ parentHash, version, payload });
  return createHash('sha256').update(content).digest('hex');
}


class UpsertPartnerDto {
  @IsOptional() @IsString() partnerId?: string;
  @IsString() name!: string;
  @IsIn(PARTNER_TYPES) type!: (typeof PARTNER_TYPES)[number];
  @IsOptional() @IsIn(PARTNER_STATUSES) status?: (typeof PARTNER_STATUSES)[number];
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactEmail?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsInt() @Min(0) revenueShareBps?: number;
  @IsOptional() @IsDateString() complianceExpiresAt?: string;
  @IsOptional() @IsString() brandStandardsNotes?: string;
}

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/stadium')
@RequireSubscription()
export class StadiumController {
  constructor(private readonly prisma: PrismaService) {}

  private assertManager(scope: Scope) {
    if (!canManageVenue(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Manager access is required for stadium configuration.');
    }
  }

  /** Resolves the org and guarantees the same-id Facility exists, so `venueId` is safe as a facilityId. */
  private async organizationIdFor(venueId: string): Promise<string> {
    return organizationIdForPairedVenue(this.prisma, venueId);
  }

  @Get('overview')
  async overview(@VenueScope() scope: Scope) {
    const now = new Date();
    const [venue, zones, events, partners] = await Promise.all([
      this.prisma.venue.findUniqueOrThrow({
        where: { id: scope.venueId },
        select: { id: true, name: true, venueType: true, stadiumCapacity: true, homeTeam: true, timezone: true },
      }),
      this.prisma.fnbOperationUnit.findMany({
        where: { venueId: scope.venueId },
        orderBy: [{ department: 'asc' }, { stadiumZone: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.venueEvent.findMany({
        where: { venueId: scope.venueId, startsAt: { gte: now } },
        orderBy: { startsAt: 'asc' },
        take: 20,
        include: {
          fnbReadiness: { select: { status: true } },
          issues: { where: { status: { not: 'resolved' } }, select: { severity: true } },
        },
      }),
      this.prisma.fnbPartner.findMany({ where: { venueId: scope.venueId }, orderBy: [{ status: 'asc' }, { name: 'asc' }] }),
    ]);

    return {
      venue,
      zones,
      events: events.map((event) => {
        const readinessTotal = event.fnbReadiness.length;
        const readinessReady = event.fnbReadiness.filter((row) => row.status === 'ready').length;
        return {
          ...event,
          expectedAttendance: event.expectedGuests,
          readinessPercent: readinessTotal ? Math.round((readinessReady / readinessTotal) * 100) : 0,
          openHighOrCriticalIssueCount: event.issues.filter((issue) => issue.severity === 'high' || issue.severity === 'critical').length,
          fnbReadiness: undefined,
          issues: undefined,
        };
      }),
      partners,
    };
  }

  @Get('pilot-health')
  async pilotHealth(@VenueScope() scope: Scope) {
    if (!canViewPilotHealth(scope.role, scope.allAccess)) throw new ForbiddenException('Pilot Health access is restricted to leadership and audit roles.');
    const [events, readiness, issues, closeouts, activity] = await Promise.all([
      this.prisma.venueEvent.findMany({ where: { venueId: scope.venueId, operationalState: { notIn: ['archived'] } }, select: { id: true, operationalState: true, startsAt: true } }),
      this.prisma.eventFnbReadiness.findMany({ where: { venueId: scope.venueId }, select: { status: true } }),
      this.prisma.eventIssue.findMany({ where: { venueId: scope.venueId, status: { not: 'resolved' } }, select: { severity: true, status: true, openedAt: true } }),
      this.prisma.eventCloseout.findMany({ where: { venueId: scope.venueId }, select: { status: true, eventId: true, updatedAt: true } }),
      this.prisma.eventAuditLog.findMany({ where: { venueId: scope.venueId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, select: { actorProfileId: true, action: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    const readyCount = readiness.filter((row) => row.status === 'ready').length;
    return {
      activeEvents: events.filter((event) => ['pre_open', 'live', 'closing'].includes(event.operationalState)).length,
      eventsByState: events.reduce<Record<string, number>>((counts, event) => { counts[event.operationalState] = (counts[event.operationalState] ?? 0) + 1; return counts; }, {}),
      outletReadinessPercent: readiness.length ? Math.round((readyCount / readiness.length) * 100) : 0,
      openCriticalIssues: issues.filter((issue) => issue.severity === 'critical').length,
      unresolvedIssues: issues.length,
      closeoutStatus: { draft: closeouts.filter((row) => row.status === 'draft').length, finalized: closeouts.filter((row) => row.status === 'finalized').length, adjusted: closeouts.filter((row) => row.status === 'adjusted').length },
      userActivity24h: { total: activity.length, uniqueUsers: new Set(activity.map((item) => item.actorProfileId).filter(Boolean)).size, byAction: activity.reduce<Record<string, number>>((counts, item) => { counts[item.action] = (counts[item.action] ?? 0) + 1; return counts; }, {}) },
      generatedAt: new Date().toISOString(),
    };
  }

  @Get('integration-readiness')
  async integrationReadiness(@VenueScope() scope: Scope) {
    if (!canViewPilotHealth(scope.role, scope.allAccess)) throw new ForbiddenException('Integration readiness is restricted to leadership and audit roles.');
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [pos, reservations, posChecks, inventoryItems] = await Promise.all([
      this.prisma.posConnection.findMany({ where: { venueId: scope.venueId }, select: { provider: true, status: true, lastSyncAt: true } }),
      this.prisma.reservationConnection.findMany({ where: { venueId: scope.venueId }, select: { provider: true, status: true, lastSyncAt: true } }),
      this.prisma.posCheck.count({ where: { venueId: scope.venueId, updatedAt: { gte: since } } }),
      this.prisma.barInventoryItem.count({ where: { venueId: scope.venueId } }),
    ]);
    return { pos, reservations, last30Days: { posChecks }, canonicalInventoryItems: inventoryItems, manualCsvImportAvailable: true, providerIntegrations: 'Authenticated provider adapters remain venue-configured; CSV/manual entry is the approved fallback.', generatedAt: new Date().toISOString() };
  }

  @Get('events/:id/nfl-brief')
  async nflGameDayBrief(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!canViewPilotHealth(scope.role, scope.allAccess) && !canManageAssignedScope(scope.role)) throw new ForbiddenException('NFL game-day access is restricted to operations roles.');
    const event = await this.prisma.venueEvent.findFirst({ where: { id, venueId: scope.venueId }, select: { id: true, title: true, eventType: true, startsAt: true, gatesOpenAt: true, endsAt: true, expectedGuests: true, opponentOrHeadliner: true, operationalState: true } });
    if (!event) throw new NotFoundException('Stadium event not found.');
    if (event.eventType !== 'game') throw new BadRequestException('NFL game-day brief is only available for game events.');
    const [outlets, readiness, issues] = await Promise.all([
      this.prisma.fnbOperationUnit.findMany({ where: { venueId: scope.venueId }, select: { id: true, name: true, department: true, type: true, stadiumZone: true, status: true }, orderBy: [{ department: 'asc' }, { stadiumZone: 'asc' }, { name: 'asc' }] }),
      this.prisma.eventFnbReadiness.findMany({ where: { venueId: scope.venueId, eventId: id }, select: { zoneId: true, status: true, notes: true } }),
      this.prisma.eventIssue.findMany({ where: { venueId: scope.venueId, eventId: id, status: { not: 'resolved' } }, select: { title: true, severity: true, outletId: true } }),
    ]);
    const kickoff = event.startsAt.getTime();
    const gates = event.gatesOpenAt?.getTime() ?? kickoff - 90 * 60 * 1000;
    return { event, phases: [{ key: 'load_in', label: 'Load-in and production', at: new Date(gates - 4 * 60 * 60 * 1000).toISOString() }, { key: 'gates', label: 'Gates open', at: new Date(gates).toISOString() }, { key: 'pregame', label: 'Pregame surge', at: new Date(kickoff - 30 * 60 * 1000).toISOString() }, { key: 'kickoff', label: 'Kickoff', at: event.startsAt.toISOString() }, { key: 'halftime', label: 'Halftime surge', at: new Date(kickoff + 2 * 60 * 60 * 1000).toISOString() }, { key: 'postgame', label: 'Postgame egress', at: new Date((event.endsAt?.getTime() ?? kickoff + 4 * 60 * 60 * 1000)).toISOString() }], activation: outlets.map((outlet) => ({ ...outlet, readiness: readiness.find((row) => row.zoneId === outlet.id)?.status ?? 'not_started' })), openIssues: issues, controls: ['Confirm alcohol ID-check and responsible-service coverage before gates.', 'Stage water, ice, and nonalcoholic beverage backup for heat and halftime demand.', 'Verify hot/cold holding, allergen labeling, and batch release times.', 'Keep a runner and warehouse transfer path open for halftime replenishment.'], assumptions: ['Halftime timing is a planning estimate; replace with the official game clock/run of show.', 'Weather is not connected; apply venue-approved heat, cold, rain, and lightning procedures.'] };
  }

  @Post('zones')
  async createZone(@VenueScope() scope: Scope, @Body() body: CreateZoneDto) {
    this.assertManager(scope);
    return this.prisma.fnbOperationUnit.create({
      data: {
        venueId: scope.venueId,
        code: body.code.trim().toUpperCase(),
        name: body.name.trim(),
        department: body.department,
        type: body.type,
        capacity: body.capacity,
        stadiumZone: body.stadiumZone?.trim() || null,
        level: body.level?.trim() || null,
        notes: body.notes?.trim() || null,
      },
    });
  }

  @Patch('zones/:id/status')
  async updateZoneStatus(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: UpdateZoneStatusDto) {
    this.assertManager(scope);
    const zone = await this.prisma.fnbOperationUnit.findFirst({ where: { id, venueId: scope.venueId }, select: { id: true, status: true } });
    if (!zone) throw new NotFoundException('F&B operation unit not found.');
    return this.prisma.fnbOperationUnit.update({ where: { id }, data: { status: body.status } });
  }

  @Post('events')
  async createEvent(@VenueScope() scope: Scope, @Body() body: CreateEventDto) {
    this.assertManager(scope);
    return withTenantTransaction(this.prisma, async (tx) => {
      const venue = await tx.venue.findUniqueOrThrow({ where: { id: scope.venueId }, select: { organizationId: true } });
      const event = await tx.venueEvent.create({
        data: {
          venueId: scope.venueId,
          organizationId: venue.organizationId,
          title: body.title.trim(),
          eventCode: body.eventCode?.trim().toUpperCase() || null,
          eventType: body.eventType,
          startsAt: new Date(body.startsAt),
          gatesOpenAt: body.gatesOpenAt ? new Date(body.gatesOpenAt) : null,
          endsAt: body.endsAt ? new Date(body.endsAt) : null,
          expectedGuests: body.expectedAttendance,
          opponentOrHeadliner: body.opponentOrHeadliner?.trim() || null,
          notes: body.notes?.trim() || null,
          createdBy: scope.profileId,
        },
      });
      const zones = await tx.fnbOperationUnit.findMany({ where: { venueId: scope.venueId }, select: { id: true } });
      if (zones.length) {
        await tx.eventFnbReadiness.createMany({
        data: zones.map((zone) => ({ organizationId: venue.organizationId, venueId: scope.venueId, eventId: event.id, zoneId: zone.id })),
        });
      }
      await tx.eventAuditLog.create({ data: { organizationId: venue.organizationId, venueId: scope.venueId, eventId: event.id, actorProfileId: scope.profileId, entityType: 'event', entityId: event.id, action: 'event_created', metadata: { eventType: event.eventType, expectedAttendance: event.expectedGuests } } });
      return event;
    }, { venueId: scope.venueId });
  }

  @Patch('events/:id/status')
  async updateEventStatus(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: UpdateEventStatusDto) {
    const legacyMap: Record<(typeof EVENT_STATUSES)[number], EventOperationalState> = { draft: 'draft', planning: 'planning', ready: 'pre_open', live: 'live', completed: 'closed', cancelled: 'archived' };
    return this.transitionEvent(scope, id, legacyMap[body.status], body.reason);
  }

  @Patch('events/:id/state')
  async updateEventOperationalState(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: UpdateEventOperationalStateDto) {
    return this.transitionEvent(scope, id, body.state, body.reason);
  }

  private async transitionEvent(scope: Scope, id: string, target: EventOperationalState, reason?: string) {
    this.assertManager(scope);
    const event = await this.prisma.venueEvent.findFirst({ where: { id, venueId: scope.venueId }, select: { id: true, operationalState: true } });
    if (!event) throw new NotFoundException('Stadium event not found.');
    assertEventTransition(event.operationalState as EventOperationalState, target, {
      reason,
      canOverride: canOverrideEventState(scope.role, scope.allAccess),
    });
    const organizationId = await this.organizationIdFor(scope.venueId);
    return withTenantTransaction(this.prisma, async (tx) => {
      const cas = await tx.venueEvent.updateMany({
        where: { id, venueId: scope.venueId, operationalState: event.operationalState },
        data: {
          operationalState: target,
          stateChangedAt: new Date(),
          status: legacyStatusForState(target),
          ...(target === 'approved' ? { approvedAt: new Date(), approvedBy: scope.profileId } : {}),
        },
      });
      if (cas.count !== 1) {
        throw new ConflictException('Event operational state was modified concurrently. Please refresh and try again.');
      }
      const updated = await tx.venueEvent.findUniqueOrThrow({ where: { id } });
      await tx.eventAuditLog.create({ data: { organizationId, venueId: scope.venueId, eventId: id, actorProfileId: scope.profileId, entityType: 'event', entityId: id, action: 'event_state_changed', reason: reason?.trim() || null, metadata: { from: event.operationalState, to: target } } });
      return updated;
    }, { venueId: scope.venueId });
  }

  @Get('events/:id/issues')
  async listEventIssues(@VenueScope() scope: Scope, @Param('id') id: string, @Query() query: EventIssueQueryDto) {
    const event = await this.prisma.venueEvent.findFirst({ where: { id, venueId: scope.venueId }, select: { id: true } });
    if (!event) throw new NotFoundException('Stadium event not found.');
    return this.prisma.eventIssue.findMany({ where: { venueId: scope.venueId, eventId: id, ...(query.status ? { status: query.status } : {}), ...(query.severity ? { severity: query.severity } : {}), ...(query.outletId ? { outletId: query.outletId } : {}) }, orderBy: [{ severity: 'desc' }, { openedAt: 'desc' }] });
  }

  @Get('events/:id/audit')
  async listEventAudit(@VenueScope() scope: Scope, @Param('id') id: string) {
    const event = await this.prisma.venueEvent.findFirst({ where: { id, venueId: scope.venueId }, select: { id: true } });
    if (!event) throw new NotFoundException('Stadium event not found.');
    return this.prisma.eventAuditLog.findMany({ where: { venueId: scope.venueId, eventId: id }, orderBy: { createdAt: 'desc' } });
  }

  @Post('events/:id/issues')
  async createEventIssue(@VenueScope() scope: Scope, @Param('id') eventId: string, @Body() body: CreateEventIssueDto) {
    this.assertOperational(scope);
    const [event, organizationId, outlet] = await Promise.all([
      this.prisma.venueEvent.findFirst({ where: { id: eventId, venueId: scope.venueId }, select: { id: true, operationalState: true } }),
      this.organizationIdFor(scope.venueId),
      body.outletId ? this.prisma.fnbOperationUnit.findFirst({ where: { id: body.outletId, venueId: scope.venueId }, select: { id: true } }) : Promise.resolve(null),
    ]);
    if (!event) throw new NotFoundException('Stadium event not found.');
    if (body.outletId && !outlet) throw new NotFoundException('F&B outlet not found.');
    if (['closed', 'archived'].includes(event.operationalState)) throw new ForbiddenException('Issues cannot be opened after event closeout. Use an authorized adjustment workflow.');
    try {
      return await withTenantTransaction(this.prisma, async (tx) => {
        if (body.clientMutationId) {
          const existing = await tx.eventIssue.findFirst({ where: { organizationId, clientMutationId: body.clientMutationId } });
          if (existing) return existing;
        }
        const issue = await tx.eventIssue.create({ data: { organizationId, venueId: scope.venueId, eventId, outletId: body.outletId ?? null, issueType: body.issueType.trim(), severity: body.severity, title: body.title.trim(), description: body.description.trim(), reportedByUserId: scope.profileId, ownerUserId: body.ownerUserId?.trim() || null, clientMutationId: body.clientMutationId ?? null } });
        await tx.eventAuditLog.create({ data: { organizationId, venueId: scope.venueId, eventId, issueId: issue.id, actorProfileId: scope.profileId, entityType: 'event_issue', entityId: issue.id, action: 'issue_created', metadata: { issueType: issue.issueType, severity: issue.severity, outletId: issue.outletId } } });
        return issue;
      }, { venueId: scope.venueId });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002' && body.clientMutationId) {
        const existing = await this.prisma.eventIssue.findFirst({ where: { organizationId, clientMutationId: body.clientMutationId } });
        if (existing) return existing;
      }
      throw error;
    }
  }

  private assertOperational(scope: Scope) {
    if (!canManageVenue(scope.role, scope.allAccess) && !canManageAssignedScope(scope.role)) throw new ForbiddenException('Operational stadium access is required.');
  }

  @Patch('issues/:id/acknowledge')
  async acknowledgeEventIssue(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.assertOperational(scope);
    const issue = await this.prisma.eventIssue.findFirst({ where: { id, venueId: scope.venueId }, select: { id: true, eventId: true, organizationId: true, status: true } });
    if (!issue) throw new NotFoundException('Event issue not found.');
    if (issue.status === 'resolved') throw new BadRequestException('A resolved issue cannot be acknowledged.');
    return withTenantTransaction(this.prisma, async (tx) => {
      const transition = await tx.eventIssue.updateMany({ where: { id, venueId: scope.venueId, status: 'open' }, data: { status: 'acknowledged', acknowledgedAt: new Date(), ownerUserId: scope.profileId } });
      if (transition.count !== 1) throw new ConflictException('Issue state changed. Refresh and try again.');
      const updated = await tx.eventIssue.findUniqueOrThrow({ where: { id } });
      await tx.eventAuditLog.create({ data: { organizationId: issue.organizationId, venueId: scope.venueId, eventId: issue.eventId, issueId: id, actorProfileId: scope.profileId, entityType: 'event_issue', entityId: id, action: 'issue_acknowledged' } });
      return updated;
    }, { venueId: scope.venueId });
  }

  @Patch('issues/:id/resolve')
  async resolveEventIssue(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: ResolveEventIssueDto) {
    this.assertOperational(scope);
    const issue = await this.prisma.eventIssue.findFirst({ where: { id, venueId: scope.venueId }, select: { id: true, eventId: true, organizationId: true, status: true } });
    if (!issue) throw new NotFoundException('Event issue not found.');
    if (issue.status === 'resolved') throw new BadRequestException('Event issue is already resolved.');
    return withTenantTransaction(this.prisma, async (tx) => {
      const transition = await tx.eventIssue.updateMany({ where: { id, venueId: scope.venueId, status: { in: ['open', 'acknowledged'] } }, data: { status: 'resolved', resolvedAt: new Date(), resolutionNotes: body.resolutionNotes.trim(), ownerUserId: scope.profileId } });
      if (transition.count !== 1) throw new ConflictException('Issue state changed. Refresh and try again.');
      const updated = await tx.eventIssue.findUniqueOrThrow({ where: { id } });
      await tx.eventAuditLog.create({ data: { organizationId: issue.organizationId, venueId: scope.venueId, eventId: issue.eventId, issueId: id, actorProfileId: scope.profileId, entityType: 'event_issue', entityId: id, action: 'issue_resolved', metadata: { resolutionNotes: body.resolutionNotes.trim() } } });
      return updated;
    }, { venueId: scope.venueId });
  }

  @Post('event-plan')
  async generateEventPlan(@VenueScope() scope: Scope, @Body() body: GenerateEventPlanDto) {
    this.assertManager(scope);
    if (body.venue_id !== scope.venueId) throw new ForbiddenException('The requested venue is outside your active venue scope.');
    const options = body.options ?? {};
    const event = await this.prisma.venueEvent.findFirst({ where: { id: body.event_id, venueId: scope.venueId }, select: { id: true, title: true, eventType: true, startsAt: true, gatesOpenAt: true, expectedGuests: true, opponentOrHeadliner: true } });
    if (!event) throw new NotFoundException('Stadium event not found.');
    const [venue, outlets, comparableEvents] = await Promise.all([
      this.prisma.venue.findUniqueOrThrow({ where: { id: scope.venueId }, select: { id: true, name: true, stadiumCapacity: true, organizationId: true } }),
      this.prisma.fnbOperationUnit.findMany({ where: { venueId: scope.venueId, status: { in: ['open', 'restricted'] } }, select: { id: true, code: true, name: true, department: true, type: true, stadiumZone: true, status: true }, orderBy: [{ department: 'asc' }, { stadiumZone: 'asc' }, { code: 'asc' }] }),
      options.use_historical_events === false ? [] : this.prisma.venueEvent.findMany({ where: { venueId: scope.venueId, eventType: event.eventType, startsAt: { lt: event.startsAt } }, select: { id: true, title: true, startsAt: true, expectedGuests: true }, orderBy: { startsAt: 'desc' }, take: options.max_comparables ?? 5 }),
    ]);
    const attendance = event.expectedGuests ?? (venue.stadiumCapacity ? Math.round(venue.stadiumCapacity * 0.7) : null);
    const perCapCents = ({ game: 1800, concert: 2200, tournament: 1700, festival: 2000, community: 1400, corporate: 2400, other: 1600 } as const)[event.eventType];
    const estimatedSalesCents = attendance == null ? null : attendance * perCapCents;
    const activationWeight: Record<string, number> = { concession_stand: 1, grab_and_go: 1.15, portable_cart: 0.55, kiosk: 0.7, food_vendor: 0.9, premium_suite: 1.4, premium_club: 1.3, loge_hospitality: 1.15, in_seat_service: 0.65, bar: 1.1, beer_cart: 0.65, beverage: 0.75, mobile_pickup: 0.9, retail_fnb: 0.4, partner_pop_up: 0.7, catering: 0.8, banquet: 0.8, commissary: 0, production_kitchen: 0, back_of_house: 0, other: 0.5 };
    const totalWeight = outlets.reduce((total, outlet) => total + (activationWeight[outlet.type] ?? 0.5), 0);
    const comparableAttendance = comparableEvents.map((item) => item.expectedGuests).filter((value): value is number => value != null);
    const dataGaps = [
      ...(event.expectedGuests == null ? ['Expected attendance is not set; forecast uses 70% of venue capacity.'] : []),
      ...(options.apply_weather_adjustments ? ['Weather adjustment requested, but no weather feed is connected. No weather adjustment was applied.'] : []),
      ...(!comparableEvents.length ? ['No comparable events are available for this event type.'] : []),
      'POS sales, recipes, inventory, and payroll data are not connected; pars and labor are planning recommendations, not actuals.',
    ];
    const plan = {
      function: 'generate_event_plan', venue: { id: venue.id, name: venue.name }, event: { ...event, expectedAttendance: attendance },
      forecast: { inputs: { attendance, eventType: event.eventType, eventDate: event.startsAt, gatesOpenAt: event.gatesOpenAt, comparableEventCount: comparableEvents.length, comparableAttendance }, assumptions: { baselinePerCapCents: perCapCents, outletActivation: 'Open and restricted outlets are included; restricted outlets require manager confirmation.', weatherAdjustmentApplied: false }, estimatedSalesCents, explanation: attendance == null ? 'Add expected attendance before using this plan for purchasing or labor decisions.' : `The baseline forecast uses ${attendance.toLocaleString()} attendees and a ${(perCapCents / 100).toFixed(2)} per-cap for a ${event.eventType} event.` },
      outletPars: options.include_par_plan === false ? [] : outlets.map((outlet) => { const share = totalWeight ? (activationWeight[outlet.type] ?? 0.5) / totalWeight : 0; const projectedSalesCents = estimatedSalesCents == null ? null : Math.round(estimatedSalesCents * share); return { outletId: outlet.id, outletCode: outlet.code, outletName: outlet.name, department: outlet.department, stadiumZone: outlet.stadiumZone, projectedSalesCents, activationStatus: outlet.status, recommendation: projectedSalesCents == null ? 'Set attendance to calculate a sales-driven par.' : `Stage approximately ${(projectedSalesCents / 800).toFixed(0)} average-price item equivalents, then validate against the outlet menu and on-hand inventory.` }; }),
      productionPlan: options.include_production_plan === false ? [] : outlets.filter((outlet) => ['commissary', 'production_kitchen', 'back_of_house'].includes(outlet.type)).map((outlet) => ({ outletId: outlet.id, department: outlet.department, stadiumZone: outlet.stadiumZone, task: `Build batch-production and packaging plan for ${outlet.name}.`, foodSafetyControl: 'Confirm approved recipes, cook/chill/hold temperatures, labeling, and dispatch times before release.' })),
      laborPlan: options.include_labor_plan === false ? [] : outlets.filter((outlet) => !['commissary', 'production_kitchen', 'back_of_house'].includes(outlet.type)).map((outlet) => ({ outletId: outlet.id, outletName: outlet.name, department: outlet.department, suggestedRoles: outlet.type === 'bar' || outlet.type === 'beer_cart' ? ['1 lead', '2 bartenders', '1 runner'] : ['1 lead', '2 cashiers', '1 runner'], note: 'Confirm this starting template against service windows, menu complexity, union rules, and actual staffing availability.' })),
      checklists: options.include_checklists === false ? [] : outlets.map((outlet) => ({ outletId: outlet.id, outletName: outlet.name, tasks: ['Confirm outlet activation and POS readiness.', 'Verify product transfer, cold/hot holding controls, and allergen information.', ...(outlet.type === 'bar' || outlet.type === 'beer_cart' ? ['Confirm alcohol inventory, ID-check process, and responsible-service staffing.'] : [])] })),
      dataGaps,
    };
    await withTenantTransaction(this.prisma, async (tx) => {
      await tx.eventPlanSnapshot.upsert({ where: { eventId: event.id }, create: { id: `plan_${event.id}`, organizationId: venue.organizationId, venueId: scope.venueId, eventId: event.id, generatedBy: scope.profileId, attendance, estimatedSalesCents, plan: plan as unknown as Prisma.InputJsonValue, dataGaps }, update: { generatedBy: scope.profileId, generatedAt: new Date(), attendance, estimatedSalesCents, plan: plan as unknown as Prisma.InputJsonValue, dataGaps } });
      await tx.eventAuditLog.create({ data: { organizationId: venue.organizationId, venueId: scope.venueId, eventId: event.id, actorProfileId: scope.profileId, entityType: 'event_plan', entityId: event.id, action: 'plan_generated', metadata: { options: options as unknown as Prisma.InputJsonValue } } });
    }, { venueId: scope.venueId });
    return plan;
  }

  @Patch('events/:eventId/zones/:zoneId/readiness')
  async updateZoneReadiness(
    @VenueScope() scope: Scope,
    @Param('eventId') eventId: string,
    @Param('zoneId') zoneId: string,
    @Body() body: UpdateReadinessDto,
  ) {
    this.assertManager(scope);
    const [event, zone] = await Promise.all([
      this.prisma.venueEvent.findFirst({ where: { id: eventId, venueId: scope.venueId }, select: { id: true } }),
      this.prisma.fnbOperationUnit.findFirst({ where: { id: zoneId, venueId: scope.venueId }, select: { id: true } }),
    ]);
    if (!event || !zone) throw new NotFoundException('Event or facility zone not found.');
    const organizationId = await this.organizationIdFor(scope.venueId);
    return withTenantTransaction(this.prisma, async (tx) => {
      const readiness = await tx.eventFnbReadiness.upsert({
        where: { eventId_zoneId: { eventId, zoneId } },
        create: { organizationId: organizationId, venueId: scope.venueId, eventId, zoneId, status: body.status, notes: body.notes?.trim() || null, checkedBy: scope.profileId, checkedAt: new Date() },
        update: { status: body.status, notes: body.notes?.trim() || null, checkedBy: scope.profileId, checkedAt: new Date() },
      });
      await tx.eventAuditLog.create({ data: { organizationId, venueId: scope.venueId, eventId, actorProfileId: scope.profileId, entityType: 'event_readiness', entityId: readiness.id, action: 'outlet_readiness_updated', metadata: { zoneId, status: body.status } } });
      return readiness;
    }, { venueId: scope.venueId });
  }

  @Post('partners')
  async upsertPartner(@VenueScope() scope: Scope, @Body() body: UpsertPartnerDto) {
    this.assertManager(scope);
    const data = {
      name: body.name.trim(),
      type: body.type,
      status: body.status ?? 'onboarding' as const,
      contactName: body.contactName?.trim() || null,
      contactEmail: body.contactEmail?.trim().toLowerCase() || null,
      contactPhone: body.contactPhone?.trim() || null,
      revenueShareBps: body.revenueShareBps,
      complianceExpiresAt: body.complianceExpiresAt ? new Date(body.complianceExpiresAt) : null,
      brandStandardsNotes: body.brandStandardsNotes?.trim() || null,
    };
    if (!body.partnerId) return this.prisma.fnbPartner.create({ data: { venueId: scope.venueId, ...data } });
    const partner = await this.prisma.fnbPartner.findFirst({ where: { id: body.partnerId, venueId: scope.venueId }, select: { id: true } });
    if (!partner) throw new NotFoundException('F&B partner not found.');
    return this.prisma.fnbPartner.update({ where: { id: partner.id }, data });
  }

  @Get('events/:id/closeout')
  async getEventCloseout(@VenueScope() scope: Scope, @Param('id') eventId: string) {
    const event = await this.prisma.venueEvent.findFirst({ where: { id: eventId, venueId: scope.venueId }, select: { id: true } });
    if (!event) throw new NotFoundException('Stadium event not found.');
    return this.prisma.eventCloseout.findUnique({
      where: { eventId },
      include: { revisions: { orderBy: { version: 'desc' } } },
    });
  }

  @Post('events/:id/closeout')
  async upsertEventCloseout(@VenueScope() scope: Scope, @Param('id') eventId: string, @Body() body: UpsertEventCloseoutDto) {
    if (!canManageVenue(scope.role, scope.allAccess) && !canFinalizeCloseout(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Closeout modifications require manager or financial authority.');
    }
    const isFinalizing = body.status === 'finalized';
    if (isFinalizing && !canFinalizeCloseout(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Closeout finalization requires financial director or administrative authority.');
    }
    const event = await this.prisma.venueEvent.findFirst({ where: { id: eventId, venueId: scope.venueId }, select: { id: true } });
    if (!event) throw new NotFoundException('Stadium event not found.');
    const organizationId = await this.organizationIdFor(scope.venueId);

    return withTenantTransaction(this.prisma, async (tx) => {
      // Serialize drafts/finalization, including the first closeout creation.
      await tx.$queryRaw`SELECT "id" FROM "VenueEvent" WHERE "id" = ${eventId} FOR UPDATE`;
      const existing = await tx.eventCloseout.findUnique({ where: { eventId } });
      if (existing && existing.status !== 'draft') {
        throw new ConflictException('Finalized or adjusted closeouts must be modified via immutable revisions.');
      }

      const status = isFinalizing ? ('finalized' as const) : (existing?.status ?? ('draft' as const));
      const parent = existing ? await tx.eventCloseoutRevision.findFirst({
        where: { closeoutId: existing.id }, orderBy: { version: 'desc' },
      }) : null;
      const version = (parent?.version ?? 0) + 1;
      const closeout = await tx.eventCloseout.upsert({
        where: { eventId },
        create: {
          organizationId,
          venueId: scope.venueId,
          eventId,
          status,
          currentVersion: version,
          actualAttendance: body.actualAttendance ?? null,
          actualSalesCents: body.actualSalesCents ?? null,
          forecastSalesCents: body.forecastSalesCents ?? null,
          laborHours: body.laborHours ?? null,
          laborCostCents: body.laborCostCents ?? null,
          inventoryVarianceCents: body.inventoryVarianceCents ?? null,
          outletResults: (body.outletResults as Prisma.InputJsonValue) ?? null,
          inventoryResults: (body.inventoryResults as Prisma.InputJsonValue) ?? null,
          laborResults: (body.laborResults as Prisma.InputJsonValue) ?? null,
          notes: body.notes?.trim() || null,
          finalizedAt: isFinalizing ? new Date() : null,
          finalizedBy: isFinalizing ? scope.profileId : null,
        },
        update: {
          status,
          currentVersion: version,
          actualAttendance: body.actualAttendance ?? undefined,
          actualSalesCents: body.actualSalesCents ?? undefined,
          forecastSalesCents: body.forecastSalesCents ?? undefined,
          laborHours: body.laborHours ?? undefined,
          laborCostCents: body.laborCostCents ?? undefined,
          inventoryVarianceCents: body.inventoryVarianceCents ?? undefined,
          outletResults: (body.outletResults as Prisma.InputJsonValue) ?? undefined,
          inventoryResults: (body.inventoryResults as Prisma.InputJsonValue) ?? undefined,
          laborResults: (body.laborResults as Prisma.InputJsonValue) ?? undefined,
          notes: body.notes?.trim() || undefined,
          ...(isFinalizing ? { finalizedAt: new Date(), finalizedBy: scope.profileId } : {}),
        },
      });

      const payload = {
        actualAttendance: closeout.actualAttendance,
        actualSalesCents: closeout.actualSalesCents,
        forecastSalesCents: closeout.forecastSalesCents,
        laborHours: closeout.laborHours,
        laborCostCents: closeout.laborCostCents,
        inventoryVarianceCents: closeout.inventoryVarianceCents,
        outletResults: closeout.outletResults,
        inventoryResults: closeout.inventoryResults,
        laborResults: closeout.laborResults,
      };
      const revisionHash = computeRevisionHash(parent?.revisionHash ?? null, version, payload);

      await tx.eventCloseoutRevision.create({
        data: {
          organizationId,
          venueId: scope.venueId,
          closeoutId: closeout.id,
          version,
          parentRevisionId: parent?.id ?? null,
          revisionHash,
          actualAttendance: closeout.actualAttendance,
          actualSalesCents: closeout.actualSalesCents,
          forecastSalesCents: closeout.forecastSalesCents,
          laborHours: closeout.laborHours,
          laborCostCents: closeout.laborCostCents,
          inventoryVarianceCents: closeout.inventoryVarianceCents,
          outletResults: (closeout.outletResults as Prisma.InputJsonValue) ?? null,
          inventoryResults: (closeout.inventoryResults as Prisma.InputJsonValue) ?? null,
          laborResults: (closeout.laborResults as Prisma.InputJsonValue) ?? null,
          createdBy: scope.profileId,
          approvedBy: isFinalizing ? scope.profileId : null,
          approvedAt: isFinalizing ? new Date() : null,
        },
      });

      await tx.eventAuditLog.create({
        data: {
          organizationId,
          venueId: scope.venueId,
          eventId,
          actorProfileId: scope.profileId,
          entityType: 'event_closeout',
          entityId: closeout.id,
          action: isFinalizing ? 'closeout_finalized' : 'closeout_saved',
          metadata: { version, status },
        },
      });

      return tx.eventCloseout.findUniqueOrThrow({
        where: { id: closeout.id },
        include: { revisions: { orderBy: { version: 'desc' } } },
      });
    }, { venueId: scope.venueId });
  }

  @Post('events/:id/closeout/revisions')
  async submitCloseoutRevision(@VenueScope() scope: Scope, @Param('id') eventId: string, @Body() body: SubmitCloseoutRevisionDto) {
    if (!canFinalizeCloseout(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Submitting closeout revisions requires financial director or administrative authority.');
    }
    if (!body.adjustmentReason?.trim()) {
      throw new BadRequestException('A reason is required to submit a closeout revision.');
    }

    const organizationId = await this.organizationIdFor(scope.venueId);
    return withTenantTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VenueEvent" WHERE "id" = ${eventId} AND "venueId" = ${scope.venueId} FOR UPDATE`;
      const closeout = await tx.eventCloseout.findFirst({
        where: { eventId, venueId: scope.venueId },
        include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!closeout) throw new NotFoundException('Event closeout not found.');
      if (closeout.status === 'draft') throw new ConflictException('Finalize the draft before submitting an adjustment.');
      const nextVersion = closeout.currentVersion + 1;
      const latestRevision = closeout.revisions[0];
      const parentHash = latestRevision?.revisionHash ?? null;
      const payload = {
        actualAttendance: body.actualAttendance ?? closeout.actualAttendance,
        actualSalesCents: body.actualSalesCents ?? closeout.actualSalesCents,
        forecastSalesCents: body.forecastSalesCents ?? closeout.forecastSalesCents,
        laborHours: body.laborHours ?? closeout.laborHours,
        laborCostCents: body.laborCostCents ?? closeout.laborCostCents,
        inventoryVarianceCents: body.inventoryVarianceCents ?? closeout.inventoryVarianceCents,
        outletResults: body.outletResults !== undefined ? body.outletResults : closeout.outletResults,
        inventoryResults: body.inventoryResults !== undefined ? body.inventoryResults : closeout.inventoryResults,
        laborResults: body.laborResults !== undefined ? body.laborResults : closeout.laborResults,
        adjustmentReason: body.adjustmentReason.trim(),
      };
      const revisionHash = computeRevisionHash(parentHash, nextVersion, payload);

      const revision = await tx.eventCloseoutRevision.create({
        data: {
          organizationId,
          venueId: scope.venueId,
          closeoutId: closeout.id,
          version: nextVersion,
          parentRevisionId: latestRevision?.id ?? null,
          revisionHash,
          actualAttendance: payload.actualAttendance,
          actualSalesCents: payload.actualSalesCents,
          forecastSalesCents: payload.forecastSalesCents,
          laborHours: payload.laborHours,
          laborCostCents: payload.laborCostCents,
          inventoryVarianceCents: payload.inventoryVarianceCents,
          outletResults: (payload.outletResults as Prisma.InputJsonValue) ?? null,
          inventoryResults: (payload.inventoryResults as Prisma.InputJsonValue) ?? null,
          laborResults: (payload.laborResults as Prisma.InputJsonValue) ?? null,
          adjustmentReason: payload.adjustmentReason,
          createdBy: scope.profileId,
          approvedBy: scope.allAccess ? scope.profileId : null,
          approvedAt: scope.allAccess ? new Date() : null,
        },
      });

      await tx.eventCloseout.update({
        where: { id: closeout.id },
        data: {
          status: 'adjusted',
          currentVersion: nextVersion,
          actualAttendance: payload.actualAttendance,
          actualSalesCents: payload.actualSalesCents,
          forecastSalesCents: payload.forecastSalesCents,
          laborHours: payload.laborHours,
          laborCostCents: payload.laborCostCents,
          inventoryVarianceCents: payload.inventoryVarianceCents,
          outletResults: (payload.outletResults as Prisma.InputJsonValue) ?? undefined,
          inventoryResults: (payload.inventoryResults as Prisma.InputJsonValue) ?? undefined,
          laborResults: (payload.laborResults as Prisma.InputJsonValue) ?? undefined,
          adjustmentReason: payload.adjustmentReason,
        },
      });

      await tx.eventAuditLog.create({
        data: {
          organizationId,
          venueId: scope.venueId,
          eventId,
          actorProfileId: scope.profileId,
          entityType: 'event_closeout_revision',
          entityId: revision.id,
          action: 'closeout_revision_added',
          reason: body.adjustmentReason.trim(),
          metadata: { version: nextVersion, parentHash, revisionHash },
        },
      });

      return tx.eventCloseout.findUniqueOrThrow({
        where: { id: closeout.id },
        include: { revisions: { orderBy: { version: 'desc' } } },
      });
    }, { venueId: scope.venueId });
  }
}

