import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { canManageVenue } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

const ZONE_TYPES = ['concession_stand', 'grab_and_go', 'portable_cart', 'kiosk', 'food_vendor', 'commissary', 'production_kitchen', 'premium_suite', 'premium_club', 'loge_hospitality', 'in_seat_service', 'catering', 'banquet', 'bar', 'beer_cart', 'beverage', 'mobile_pickup', 'retail_fnb', 'partner_pop_up', 'back_of_house', 'other'] as const;
const FNB_DEPARTMENTS = ['concessions', 'culinary_production', 'premium_hospitality', 'catering_banquets', 'beverage_operations', 'retail_fnb', 'vendor_partners'] as const;
const ZONE_STATUSES = ['open', 'restricted', 'closed', 'incident'] as const;
const EVENT_TYPES = ['game', 'concert', 'tournament', 'festival', 'community', 'corporate', 'other'] as const;
const EVENT_STATUSES = ['draft', 'planning', 'ready', 'live', 'completed', 'cancelled'] as const;
const READINESS_STATUSES = ['not_started', 'in_progress', 'ready', 'blocked'] as const;
const PARTNER_TYPES = ['local_concept', 'restaurant_concept', 'pop_up', 'licensed_brand', 'food_vendor', 'beverage_vendor', 'distributor', 'other'] as const;
const PARTNER_STATUSES = ['onboarding', 'approved', 'active', 'paused', 'noncompliant', 'terminated'] as const;

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

@Controller('v1/stadium')
@RequireSubscription()
export class StadiumController {
  constructor(private readonly prisma: PrismaService) {}

  private assertManager(scope: Scope) {
    if (!canManageVenue(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Manager access is required for stadium configuration.');
    }
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
        include: { fnbReadiness: { select: { status: true } } },
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
          fnbReadiness: undefined,
        };
      }),
      partners,
    };
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
    const zone = await this.prisma.fnbOperationUnit.findFirst({ where: { id, venueId: scope.venueId }, select: { id: true } });
    if (!zone) throw new NotFoundException('F&B operation unit not found.');
    return this.prisma.fnbOperationUnit.update({ where: { id }, data: { status: body.status } });
  }

  @Post('events')
  async createEvent(@VenueScope() scope: Scope, @Body() body: CreateEventDto) {
    this.assertManager(scope);
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.venueEvent.create({
        data: {
          venueId: scope.venueId,
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
          data: zones.map((zone) => ({ venueId: scope.venueId, eventId: event.id, zoneId: zone.id })),
        });
      }
      return event;
    });
  }

  @Patch('events/:id/status')
  async updateEventStatus(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: UpdateEventStatusDto) {
    this.assertManager(scope);
    const event = await this.prisma.venueEvent.findFirst({ where: { id, venueId: scope.venueId }, select: { id: true } });
    if (!event) throw new NotFoundException('Stadium event not found.');
    return this.prisma.venueEvent.update({ where: { id }, data: { status: body.status } });
  }

  @Post('event-plan')
  async generateEventPlan(@VenueScope() scope: Scope, @Body() body: GenerateEventPlanDto) {
    this.assertManager(scope);
    if (body.venue_id !== scope.venueId) throw new ForbiddenException('The requested venue is outside your active venue scope.');
    const options = body.options ?? {};
    const event = await this.prisma.venueEvent.findFirst({ where: { id: body.event_id, venueId: scope.venueId }, select: { id: true, title: true, eventType: true, startsAt: true, gatesOpenAt: true, expectedGuests: true, opponentOrHeadliner: true } });
    if (!event) throw new NotFoundException('Stadium event not found.');
    const [venue, outlets, comparableEvents] = await Promise.all([
      this.prisma.venue.findUniqueOrThrow({ where: { id: scope.venueId }, select: { id: true, name: true, stadiumCapacity: true } }),
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
    return {
      function: 'generate_event_plan', venue: { id: venue.id, name: venue.name }, event: { ...event, expectedAttendance: attendance },
      forecast: { inputs: { attendance, eventType: event.eventType, eventDate: event.startsAt, gatesOpenAt: event.gatesOpenAt, comparableEventCount: comparableEvents.length, comparableAttendance }, assumptions: { baselinePerCapCents: perCapCents, outletActivation: 'Open and restricted outlets are included; restricted outlets require manager confirmation.', weatherAdjustmentApplied: false }, estimatedSalesCents, explanation: attendance == null ? 'Add expected attendance before using this plan for purchasing or labor decisions.' : `The baseline forecast uses ${attendance.toLocaleString()} attendees and a ${(perCapCents / 100).toFixed(2)} per-cap for a ${event.eventType} event.` },
      outletPars: options.include_par_plan === false ? [] : outlets.map((outlet) => { const share = totalWeight ? (activationWeight[outlet.type] ?? 0.5) / totalWeight : 0; const projectedSalesCents = estimatedSalesCents == null ? null : Math.round(estimatedSalesCents * share); return { outletId: outlet.id, outletCode: outlet.code, outletName: outlet.name, department: outlet.department, stadiumZone: outlet.stadiumZone, projectedSalesCents, activationStatus: outlet.status, recommendation: projectedSalesCents == null ? 'Set attendance to calculate a sales-driven par.' : `Stage approximately ${(projectedSalesCents / 800).toFixed(0)} average-price item equivalents, then validate against the outlet menu and on-hand inventory.` }; }),
      productionPlan: options.include_production_plan === false ? [] : outlets.filter((outlet) => ['commissary', 'production_kitchen', 'back_of_house'].includes(outlet.type)).map((outlet) => ({ outletId: outlet.id, department: outlet.department, stadiumZone: outlet.stadiumZone, task: `Build batch-production and packaging plan for ${outlet.name}.`, foodSafetyControl: 'Confirm approved recipes, cook/chill/hold temperatures, labeling, and dispatch times before release.' })),
      laborPlan: options.include_labor_plan === false ? [] : outlets.filter((outlet) => !['commissary', 'production_kitchen', 'back_of_house'].includes(outlet.type)).map((outlet) => ({ outletId: outlet.id, outletName: outlet.name, department: outlet.department, suggestedRoles: outlet.type === 'bar' || outlet.type === 'beer_cart' ? ['1 lead', '2 bartenders', '1 runner'] : ['1 lead', '2 cashiers', '1 runner'], note: 'Confirm this starting template against service windows, menu complexity, union rules, and actual staffing availability.' })),
      checklists: options.include_checklists === false ? [] : outlets.map((outlet) => ({ outletId: outlet.id, outletName: outlet.name, tasks: ['Confirm outlet activation and POS readiness.', 'Verify product transfer, cold/hot holding controls, and allergen information.', ...(outlet.type === 'bar' || outlet.type === 'beer_cart' ? ['Confirm alcohol inventory, ID-check process, and responsible-service staffing.'] : [])] })),
      dataGaps,
    };
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
    return this.prisma.eventFnbReadiness.upsert({
      where: { eventId_zoneId: { eventId, zoneId } },
      create: { venueId: scope.venueId, eventId, zoneId, status: body.status, notes: body.notes?.trim() || null, checkedBy: scope.profileId, checkedAt: new Date() },
      update: { status: body.status, notes: body.notes?.trim() || null, checkedBy: scope.profileId, checkedAt: new Date() },
    });
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
}
