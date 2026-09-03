import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma, ReservationSource, ReservationStatus } from '@prisma/client';
import type { Request } from 'express';
import { canManageVenue } from '../../auth/roles';
import { Public } from '../../auth/public.decorator';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { csvCell } from '../../common/csv';
import { getClientIp } from '../../common/http';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { zonedDateBounds, zonedIsoDate } from '../../common/venue-time';
import { secretsMatch } from '../../common/webhook-auth';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { ReservationMutationService } from './reservation-mutation.service';
import { ReservationNotifierService } from './reservation-notifier.service';

type Scope = VenueScopedRequest['venueScope'];
const RESERVATION_STATUSES = ['requested', 'confirmed', 'checked_in', 'seated', 'completed', 'no_show', 'cancelled'] as const;
const RESERVATION_SOURCES = ['direct', 'opentable', 'resy', 'phone', 'walk_in', 'sevenrooms', 'tock', 'google', 'generic'] as const;
const SYNC_SOURCES = ['opentable', 'resy', 'sevenrooms', 'tock', 'google', 'generic'] as const;
const MAX_INGEST_EVENTS = 500;
// Bound applied to the reservations CSV export only when the caller supplies
// no date range at all (an explicit range is left uncapped).
const DEFAULT_EXPORT_WINDOW_DAYS = 90;
const INGEST_RATE_LIMIT_MAX = 120;
const INGEST_RATE_LIMIT_WINDOW_MS = 60_000;

class SaveReservationDto {
  @IsString()
  @IsOptional()
  reservationId?: string;

  @IsString()
  guestName!: string;

  @IsInt()
  @Min(1)
  partySize!: number;

  @IsString()
  reservationTime!: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  durationMinutes?: number;

  @IsIn(RESERVATION_STATUSES)
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsIn(RESERVATION_SOURCES)
  @IsOptional()
  source?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  specialRequests?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tableIds?: string[];

  /** Legacy clients sent floor-table labels under this name. */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tableNumbers?: string[];

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  guestCompany?: string;

  @IsString()
  @IsOptional()
  occasion?: string;

  @IsOptional()
  @IsBoolean()
  isPrivateEvent?: boolean;

  @IsString()
  @IsOptional()
  eventName?: string;

  @IsString()
  @IsOptional()
  eventStatus?: string;

  @IsString()
  @IsOptional()
  eventSpace?: string;

  @IsString()
  @IsOptional()
  setupStyle?: string;

  @IsString()
  @IsOptional()
  menuNotes?: string;

  @IsString()
  @IsOptional()
  beverageNotes?: string;

  @IsString()
  @IsOptional()
  billingNotes?: string;

  @IsString()
  @IsOptional()
  contractStatus?: string;

  @IsString()
  @IsOptional()
  beoStatus?: string;

  @IsInt()
  @IsOptional()
  estimatedValueCents?: number;

  @IsInt()
  @IsOptional()
  depositDueCents?: number;
}

class ReservationSyncEventDto {
  // Non-empty: both ids key the idempotency/dedup uniqueness, so an empty
  // string would collapse distinct events onto one row.
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  externalEventId!: string;

  @IsString()
  eventType!: string;

  // When the source system produced this update. Arrival order is not reliable
  // for webhooks, so this is required to prevent stale events regressing state.
  @IsNumber()
  eventTimestamp!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  externalId!: string;

  @IsString()
  guestName!: string;

  @IsInt()
  @Min(1)
  partySize!: number;

  @IsNumber()
  reservationTime!: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  durationMinutes?: number;

  @IsIn(RESERVATION_STATUSES)
  @IsOptional()
  status?: string;

  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() notes?: string;
  @IsString() @IsOptional() specialRequests?: string;
}

class ReservationIngestDto {
  @IsIn(SYNC_SOURCES)
  provider!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReservationSyncEventDto)
  events!: ReservationSyncEventDto[];
}

class ReservationHoldDto {
  @IsString()
  startsAt!: string;

  @IsString()
  endsAt!: string;

  @IsString()
  reason!: string;
}

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/reservations')
export class ReservationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: ReservationNotifierService,
    private readonly mutations: ReservationMutationService,
  ) {}

  private requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
    if (!scope || !canManageVenue(scope.role, scope.allAccess)) throw new ForbiddenException('Not authorized');
  }

  // External reservation providers (OpenTable, Resy, ...) POST sync events here,
  // authenticated by the connection's webhook secret. Each event is recorded
  // once (unique on venue+provider+externalEventId); redeliveries are skipped.
  @Public()
  @Post('ingest/:venueId')
  async ingest(
    @Req() request: Request,
    @Param('venueId') venueId: string,
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() body: ReservationIngestDto,
  ) {
    if (body.events.length > MAX_INGEST_EVENTS) {
      throw new BadRequestException(`A single sync request can include at most ${MAX_INGEST_EVENTS} events.`);
    }
    const provider = body.provider as ReservationSource;
    // Verify the per-connection secret before touching the rate limiter so an
    // unauthenticated spray of random venueIds can't churn RateLimitBucket rows.
    const connection = await this.prisma.reservationConnection.findFirst({ where: { venueId, provider } });
    if (!connection?.webhookSecret || !secretsMatch(secret, connection.webhookSecret)) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
    await assertWithinSharedRateLimit(this.prisma, `reservation-ingest:${venueId}:${getClientIp(request)}`, INGEST_RATE_LIMIT_MAX, INGEST_RATE_LIMIT_WINDOW_MS, 'Too many webhook requests.');
    if (connection.status !== 'connected') {
      throw new BadRequestException('This reservation integration is not currently connected.');
    }

    const now = new Date();
    let duplicates = 0;
    let processed = 0;
    let failed = 0;

    for (const event of body.events) {
      // 1) Claim the idempotency row in its OWN committed transaction, before
      //    any processing. If processing later fails and its transaction rolls
      //    back, this row survives so the failure stays recorded (and the event
      //    can be retried) — the previous single-transaction structure rolled
      //    the row away on failure, so the "mark failed" update matched nothing.
      try {
        await this.prisma.reservationSyncEvent.create({
          data: {
            venueId,
            provider,
            externalEventId: event.externalEventId,
            eventType: event.eventType,
            payload: event as unknown as Prisma.InputJsonValue,
            processedAt: now,
            status: 'processing',
          },
        });
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
        // Already seen: a currently-processing delivery is also a duplicate.
        // Only retry an explicitly failed event or a processing claim old enough
        // to be considered abandoned after a worker crash.
        const prior = await this.prisma.reservationSyncEvent.findFirst({
          where: { venueId, provider, externalEventId: event.externalEventId },
          select: { status: true, processedAt: true },
        });
        const activeProcessingClaim =
          prior?.status === 'processing' && prior.processedAt.getTime() > Date.now() - 5 * 60 * 1000;
        if (prior?.status === 'processed' || prior?.status === 'ignored_stale' || activeProcessingClaim) {
          duplicates += 1;
          continue;
        }
        await this.prisma.reservationSyncEvent.updateMany({
          where: { venueId, provider, externalEventId: event.externalEventId },
          data: { status: 'processing', errorMessage: null, processedAt: now },
        });
      }

      // 2) Process the reservation in a separate transaction.
      try {
        const reservationTime = new Date(event.reservationTime);
        const sourceEventAt = new Date(event.eventTimestamp);
        if (isNaN(reservationTime.getTime())) {
          throw new BadRequestException('Invalid reservationTime');
        }
        if (isNaN(sourceEventAt.getTime())) {
          throw new BadRequestException('Invalid eventTimestamp');
        }
        const result = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reservation-sync:${venueId}:${provider}:${event.externalId}`}))`;
          const fields: Prisma.ReservationUpdateInput = {
            guestName: event.guestName,
            partySize: event.partySize,
            reservationTime,
            durationMinutes: event.durationMinutes ?? 90,
            status: (event.status ?? 'confirmed') as ReservationStatus,
            guestPhone: event.phone?.trim() ?? null,
            guestEmail: event.email?.trim() ?? null,
            notes: event.notes?.trim() ?? null,
            specialRequests: event.specialRequests?.trim() ?? null,
            lastExternalEventAt: sourceEventAt,
          };
          const existing = await tx.reservation.findFirst({
            where: { venueId, source: provider, externalId: event.externalId },
            select: { id: true, lastExternalEventAt: true },
          });
          if (existing?.lastExternalEventAt && existing.lastExternalEventAt > sourceEventAt) {
            return { reservationId: existing.id, ignoredStale: true };
          }
          const reservationId = existing
            ? (await tx.reservation.update({ where: { id: existing.id }, data: fields, select: { id: true } })).id
            : (await tx.reservation.create({
                data: {
                  venueId,
                  source: provider,
                  externalId: event.externalId,
                  guestName: event.guestName,
                  partySize: event.partySize,
                  reservationTime,
                  durationMinutes: event.durationMinutes ?? 90,
                  status: (event.status ?? 'confirmed') as ReservationStatus,
                  guestPhone: event.phone?.trim() ?? null,
                  guestEmail: event.email?.trim() ?? null,
                  notes: event.notes?.trim() ?? null,
                  specialRequests: event.specialRequests?.trim() ?? null,
                  lastExternalEventAt: sourceEventAt,
                },
                select: { id: true },
              })).id;
          return { reservationId, ignoredStale: false };
        });

        // 3) Mark processed (committed independently of the processing tx).
        await this.prisma.reservationSyncEvent.updateMany({
          where: { venueId, provider, externalEventId: event.externalEventId },
          data: {
            reservationId: result.reservationId,
            processedAt: new Date(),
            status: result.ignoredStale ? 'ignored_stale' : 'processed',
            errorMessage: null,
          },
        });
        if (result.ignoredStale) duplicates += 1;
        else processed += 1;
      } catch (error: any) {
        // The 'processing' row was committed in step 1, so this update matches it.
        await this.prisma.reservationSyncEvent.updateMany({
          where: { venueId, provider, externalEventId: event.externalEventId },
          data: { status: 'failed', errorMessage: String(error?.message ?? error).slice(0, 500) },
        });
        failed += 1;
      }
    }

    if (failed > 0) {
      throw new ServiceUnavailableException(`Reservation sync failed for ${failed} event${failed === 1 ? '' : 's'}.`);
    }

    await this.prisma.reservationConnection.update({ where: { id: connection.id }, data: { lastSyncAt: new Date() } });

    return { ok: true, processed, duplicates, failed };
  }

  @RequireSubscription('active')
  @Get()
  async getReservationsPage(
    @VenueScope() scope: Scope,
    @Query('date') date?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.requireManager(scope);
    const pageNum = Math.max(0, parseInt(page ?? '0', 10) || 0);
    const limitNum = Math.min(Math.max(1, parseInt(limit ?? '50', 10) || 50), 200);
    const where: Record<string, unknown> = {
      venueId: scope.venueId,
      deletedAt: null,
    };
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Invalid date');
      const timezone = await this.getVenueTimezone(scope.venueId);
      const { start, end } = zonedDateBounds(timezone, date);
      where['reservationTime'] = { gte: new Date(start), lt: new Date(end) };
    }
    if (status) {
      if (!RESERVATION_STATUSES.includes(status as any)) throw new BadRequestException('Invalid status');
      where['status'] = status;
    }
    const [reservations, totalCount] = await this.prisma.$transaction([
      this.prisma.reservation.findMany({
        where: where as any,
        orderBy: { reservationTime: 'asc' },
        skip: pageNum * limitNum,
        take: limitNum,
      }),
      this.prisma.reservation.count({ where: where as any }),
    ]);
    return {
      reservations: reservations.map((r) => ({
        id: r.id,
        venueId: r.venueId,
        guestId: r.guestId ?? null,
        guestName: r.guestName,
        partySize: r.partySize,
        reservationTime: r.reservationTime.getTime(),
        durationMinutes: r.durationMinutes,
        status: r.status,
        source: r.source,
        tags: r.tags,
        guestCompany: r.guestCompany ?? null,
        occasion: r.occasion ?? null,
        notes: r.notes ?? null,
        specialRequests: r.specialRequests ?? null,
        isPrivateEvent: r.isPrivateEvent ?? false,
        eventName: r.eventName ?? null,
        eventStatus: r.eventStatus ?? null,
        eventSpace: r.eventSpace ?? null,
        setupStyle: r.setupStyle ?? null,
        menuNotes: r.menuNotes ?? null,
        beverageNotes: r.beverageNotes ?? null,
        billingNotes: r.billingNotes ?? null,
        contractStatus: r.contractStatus ?? null,
        beoStatus: r.beoStatus ?? null,
        estimatedValueCents: r.estimatedValueCents ?? null,
        depositDueCents: r.depositDueCents ?? null,
        phone: r.guestPhone ?? null,
        email: r.guestEmail ?? null,
        createdAt: r.createdAt.getTime(),
        updatedAt: r.updatedAt.getTime(),
      })),
      totalCount,
    };
  }

  @RequireSubscription('active')
  @Post()
  async saveReservation(@VenueScope() scope: Scope, @Body() body: SaveReservationDto) {
    this.requireManager(scope);
    const { reservation, previousStatus } = await this.mutations.saveReservation({
      venueId: scope.venueId,
      reservationId: body.reservationId,
      guestName: body.guestName,
      partySize: body.partySize,
      reservationTime: body.reservationTime,
      durationMinutes: body.durationMinutes,
      status: body.status,
      notes: body.notes,
      source: body.source,
      tags: body.tags,
      specialRequests: body.specialRequests,
      tableIds: body.tableIds,
      tableNumbers: body.tableNumbers,
      phone: body.phone,
      email: body.email,
      guestCompany: body.guestCompany,
      occasion: body.occasion,
      isPrivateEvent: body.isPrivateEvent,
      eventName: body.eventName,
      eventStatus: body.eventStatus,
      eventSpace: body.eventSpace,
      setupStyle: body.setupStyle,
      menuNotes: body.menuNotes,
      beverageNotes: body.beverageNotes,
      billingNotes: body.billingNotes,
      contractStatus: body.contractStatus,
      beoStatus: body.beoStatus,
      estimatedValueCents: body.estimatedValueCents,
      depositDueCents: body.depositDueCents,
    });
    if (
      reservation.guestEmail &&
      reservation.status === 'confirmed' &&
      (!body.reservationId || previousStatus !== 'confirmed') &&
      !reservation.confirmationSentAt
    ) {
      void this.notifier.sendConfirmation(reservation.id);
    }
    return { id: reservation.id };
  }

  // ============================================================
  // Cover-pacing: 15-min buckets of booked covers for a given date.
  // ============================================================
  @RequireSubscription('active')
  @Get('cover-pacing')
  async getCoverPacing(@VenueScope() scope: Scope, @Query('date') date?: string) {
    this.requireManager(scope);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Pass ?date=YYYY-MM-DD');
    }
    const timezone = await this.getVenueTimezone(scope.venueId);
    const bounds = zonedDateBounds(timezone, date);
    const start = new Date(bounds.start);
    const end = new Date(bounds.end);

    const [reservations, plan] = await Promise.all([
      this.prisma.reservation.findMany({
        where: {
          venueId: scope.venueId,
          deletedAt: null,
          status: { notIn: ['cancelled', 'no_show'] },
          reservationTime: { gte: start, lt: end },
        },
        select: { reservationTime: true, partySize: true, durationMinutes: true },
      }),
      this.prisma.floorPlan.findFirst({
        where: { venueId: scope.venueId, isActive: true },
        include: { tables: { select: { seats: true, isReservable: true } } },
      }),
    ]);

    const seatingCapacity = (plan?.tables ?? [])
      .filter((t) => t.isReservable)
      .reduce((sum, t) => sum + t.seats, 0);

    const bucketCount = Math.ceil((end.getTime() - start.getTime()) / (15 * 60 * 1000));
    const buckets: Array<{ slot: number; startsAt: number; covers: number }> = [];
    for (let i = 0; i < bucketCount; i += 1) {
      buckets.push({ slot: i, startsAt: start.getTime() + i * 15 * 60 * 1000, covers: 0 });
    }
    for (const r of reservations) {
      // Count a reservation in every 15-min slot it overlaps so a 7pm party
      // of 6 with a 90-min turn shows up in 6 buckets, accurately reflecting
      // kitchen load.
      const startMs = r.reservationTime.getTime();
      const endMs = startMs + r.durationMinutes * 60 * 1000;
      const firstSlot = Math.max(0, Math.floor((startMs - start.getTime()) / (15 * 60 * 1000)));
      const lastSlot = Math.min(bucketCount - 1, Math.floor((endMs - 1 - start.getTime()) / (15 * 60 * 1000)));
      for (let i = firstSlot; i <= lastSlot; i += 1) {
        buckets[i].covers += r.partySize;
      }
    }

    const peak = buckets.reduce((max, b) => Math.max(max, b.covers), 0);
    return {
      date,
      seatingCapacity,
      peakCovers: peak,
      totalReservations: reservations.length,
      buckets: buckets.filter((b) => b.covers > 0 || (b.slot >= 40 && b.slot <= 92)).map((b) => ({
        startsAt: b.startsAt,
        covers: b.covers,
      })),
    };
  }

  // ============================================================
  // Guest preference autofill: lookup by email or phone.
  // ============================================================
  @RequireSubscription('active')
  @Get('guest-autofill')
  async guestAutofill(
    @VenueScope() scope: Scope,
    @Query('email') email?: string,
    @Query('phone') phone?: string,
  ) {
    this.requireManager(scope);
    const cleanEmail = email?.trim().toLowerCase();
    const cleanPhone = phone?.replace(/[^\d+]/g, '');
    if (!cleanEmail && !cleanPhone) return { guest: null };
    const guest = await this.prisma.guest.findFirst({
      where: {
        venueId: scope.venueId,
        deletedAt: null,
        OR: [
          ...(cleanEmail ? [{ email: cleanEmail }] : []),
          ...(cleanPhone ? [{ phone: cleanPhone }] : []),
        ],
      },
    });
    if (!guest) return { guest: null };
    const recent = await this.prisma.reservation.findFirst({
      where: { venueId: scope.venueId, deletedAt: null, guestId: guest.id, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true, partySize: true },
    });
    return {
      guest: {
        id: guest.id,
        fullName: guest.fullName,
        email: guest.email,
        phone: guest.phone,
        favoriteTable: guest.favoriteTable,
        preferredServer: guest.preferredServer,
        dietaryNotes: guest.dietaryNotes,
        tags: guest.tags,
        lifecycleStage: guest.lifecycleStage,
        lastVisitAt: recent?.completedAt?.getTime() ?? null,
        lastPartySize: recent?.partySize ?? null,
      },
    };
  }

  // ============================================================
  // Reservation holds: block off date/time windows.
  // ============================================================
  @RequireSubscription('active')
  @Get('holds')
  async listHolds(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const now = new Date();
    const rows = await this.prisma.reservationHold.findMany({
      where: { venueId: scope.venueId, endsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt.getTime(),
      endsAt: row.endsAt.getTime(),
      reason: row.reason,
    }));
  }

  @RequireSubscription('active')
  @Post('holds')
  async createHold(@VenueScope() scope: Scope, @Body() body: ReservationHoldDto) {
    this.requireManager(scope);
    const created = await this.mutations.createHold({
      venueId: scope.venueId,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      reason: body.reason,
    });
    return { id: created.id };
  }

  @RequireSubscription('active')
  @Delete('holds/:id')
  async deleteHold(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    await this.mutations.deleteHold({ venueId: scope.venueId, holdId: id });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Delete(':id')
  async removeReservation(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    await this.mutations.removeReservation({ venueId: scope.venueId, reservationId: id });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Get('export-csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="reservations.csv"')
  async exportReservationsCsv(
    @VenueScope() scope: Scope,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    this.requireManager(scope);
    const where: Record<string, unknown> = {
      venueId: scope.venueId,
      deletedAt: null,
    };
    if (startDate || endDate) {
      const timeFilter: Record<string, Date> = {};
      if (startDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new BadRequestException('Invalid start date');
        const timezone = await this.getVenueTimezone(scope.venueId);
        timeFilter['gte'] = new Date(zonedDateBounds(timezone, startDate).start);
      }
      if (endDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new BadRequestException('Invalid end date');
        const timezone = await this.getVenueTimezone(scope.venueId);
        timeFilter['lt'] = new Date(zonedDateBounds(timezone, endDate).end);
      }
      where['reservationTime'] = timeFilter;
    } else {
      // No range at all previously meant "every reservation this venue has
      // ever had" materialized into memory on one request. Default to a
      // bounded window (90 days back, 90 days forward) instead — wide enough
      // to cover typical "recent activity" reporting without an unbounded
      // full-table scan. An explicit range from the caller is left as-is.
      const timezone = await this.getVenueTimezone(scope.venueId);
      const nowMs = Date.now();
      const todayIso = zonedIsoDate(timezone, nowMs);
      const dayMs = 24 * 60 * 60 * 1000;
      where['reservationTime'] = {
        gte: new Date(zonedDateBounds(timezone, todayIso).start - DEFAULT_EXPORT_WINDOW_DAYS * dayMs),
        lt: new Date(zonedDateBounds(timezone, todayIso).end + DEFAULT_EXPORT_WINDOW_DAYS * dayMs),
      };
    }
    const reservations = await this.prisma.reservation.findMany({
      where: where as any,
      orderBy: { reservationTime: 'asc' },
    });
    const headers = ['Name', 'Party', 'Time', 'Status', 'Phone', 'Email', 'Notes'];
    const rows = [headers.map(csvCell).join(',')];
    for (const r of reservations) {
      rows.push([
        csvCell(r.guestName),
        csvCell(r.partySize),
        csvCell(r.reservationTime.toISOString()),
        csvCell(r.status),
        csvCell(r.guestPhone),
        csvCell(r.guestEmail),
        csvCell(r.notes),
      ].join(','));
    }
    return rows.join('\n');
  }

  private async getVenueTimezone(venueId: string): Promise<string | null> {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: { timezone: true } });
    return venue?.timezone ?? null;
  }
}
