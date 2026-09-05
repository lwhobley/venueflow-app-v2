import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma, RequestStatus } from '@prisma/client';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { mapStaffRequest } from '../../common/mappers';
import { zonedDateBounds, zonedIsoDate } from '../../common/venue-time';
import { EmailService } from '../../email/email.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { SkipTenantTransaction } from '../../prisma/skip-tenant-transaction.decorator';
import { withTenantTransaction } from '../../prisma/tenant-transaction';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

const REQUEST_KINDS = ['add_shift', 'drop_shift', 'time_off', 'shift_swap', 'open_shift', 'sick_leave', 'time_correction', 'other'];
const REVIEW_STATUSES = ['approved', 'denied', 'cancelled'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOURS_PER_DAY = 8.0;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse a strict YYYY-MM-DD calendar date to noon UTC (noon dodges DST edges),
 * rejecting malformed or impossible values (e.g. 2026-02-31). Returns null when
 * the string is not a valid calendar date. A calendar date's identity (and its
 * weekday) is timezone-independent, so we deliberately do not involve a venue tz.
 */
export function parseIsoCalendarDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || !ISO_DATE_RE.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

/**
 * Whole-day hours for a PTO/sick request. Requires valid, non-reversed
 * YYYY-MM-DD dates and always returns a finite, positive number — a malformed
 * or reversed range throws rather than silently feeding NaN into a balance
 * decrement.
 */
export function calculateRequestHours(startStr?: string | null, endStr?: string | null): number {
  if (!startStr) return HOURS_PER_DAY;
  const start = parseIsoCalendarDate(startStr);
  if (!start) throw new BadRequestException('Request dates must be valid YYYY-MM-DD values.');
  const end = endStr ? parseIsoCalendarDate(endStr) : start;
  if (!end) throw new BadRequestException('Request dates must be valid YYYY-MM-DD values.');
  if (end.getTime() < start.getTime()) {
    throw new BadRequestException('End date must be on or after the start date.');
  }
  const diffDays = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  const hours = diffDays * HOURS_PER_DAY;
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new BadRequestException('Could not compute request hours from the provided dates.');
  }
  return hours;
}

class AvailabilityBlockDto {
  @IsInt()
  dayIndex!: number;

  @IsInt()
  startMinutes!: number;

  @IsInt()
  endMinutes!: number;

  @IsBoolean()
  available!: boolean;
}

// Time-correction payload for the clock screen. Distinct from AvailabilityBlock:
// corrections are a single object (not an array of weekly blocks), so they need
// their own validated shape — sending this under `availability` fails @IsArray
// and every submission would 400.
class TimeCorrectionDto {
  @IsOptional()
  @IsString()
  timeEntryId?: string | null;

  // Epoch milliseconds, as produced by the client's Date(...).getTime().
  @IsNumber()
  @Min(0)
  clockInAt!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  clockOutAt?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class CreateStaffRequestDto {
  @IsString()
  @IsIn(REQUEST_KINDS)
  kind!: string;

  @IsString()
  title!: string;

  @IsString()
  details!: string;

  @IsString()
  @IsOptional()
  @Matches(ISO_DATE_RE, { message: 'requestedForDate must be a YYYY-MM-DD date' })
  requestedForDate?: string;

  @IsString()
  @IsOptional()
  requestedShiftId?: string;

  @IsString()
  @IsOptional()
  @Matches(ISO_DATE_RE, { message: 'requestedRangeStart must be a YYYY-MM-DD date' })
  requestedRangeStart?: string;

  @IsString()
  @IsOptional()
  @Matches(ISO_DATE_RE, { message: 'requestedRangeEnd must be a YYYY-MM-DD date' })
  requestedRangeEnd?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityBlockDto)
  availability?: AvailabilityBlockDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TimeCorrectionDto)
  timeCorrection?: TimeCorrectionDto;
}

class ReviewStaffRequestDto {
  @IsString()
  @IsIn(REVIEW_STATUSES)
  status!: string;

  @IsString()
  @IsOptional()
  responseNotes?: string;
}

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/staff-requests')
export class StaffRequestsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  @RequireSubscription()
  @Get()
  async listStaffRequests(@VenueScope() scope: Scope) {
    if (!scope) return [];
    const requests = await this.prisma.staffRequest.findMany({
      where: {
        venueId: scope.venueId,
        ...(isAdminRole(scope.role) ? {} : { profileId: scope.profileId }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map(mapStaffRequest);
  }

  @RequireSubscription()
  // Awaits NotificationsService.notifyManagers, which awaits a blocking Expo
  // push fetch — must not hold the request transaction open for that call.
  @SkipTenantTransaction()
  @Post()
  async createStaffRequest(@VenueScope() scope: Scope, @Body() body: CreateStaffRequestDto) {
    if (!scope) throw new ForbiddenException('Profile does not belong to a venue');

    // Time corrections carry a single correction object (stored in the same
    // `availability` JSON column the reviewer reads). Validate it here so an
    // approval later can't act on a nonsensical range.
    if (body.kind === 'time_correction') {
      if (!body.timeCorrection) {
        throw new BadRequestException('Time correction details are required.');
      }
      const { clockInAt, clockOutAt } = body.timeCorrection;
      if (clockOutAt != null && clockOutAt <= clockInAt) {
        throw new BadRequestException('Clock-out time must be after clock-in time.');
      }
    }
    const requestPayload = body.kind === 'time_correction' ? body.timeCorrection : body.availability;

    // This route is @SkipTenantTransaction() (the notifications/email calls
    // below await a blocking Expo push fetch), so these writes need their own
    // GUC binding rather than relying on the request-scoped interceptor.
    const { profile, request } = await withTenantTransaction(this.prisma, async (tx) => {
      // Block time-off requests that overlap a manager-defined blackout window.
      if (body.kind === 'time_off') {
        const reqStart = body.requestedRangeStart || body.requestedForDate;
        const reqEnd = body.requestedRangeEnd || body.requestedForDate || reqStart;
        if (reqStart && reqEnd) {
          const blackouts = await tx.blackoutDate.findMany({
            where: { venueId: scope.venueId },
          });
          const hit = blackouts.find((b) => {
            const bStart = b.startDate.toISOString().split('T')[0];
            const bEnd = b.endDate.toISOString().split('T')[0];
            return reqStart <= bEnd && bStart <= reqEnd;
          });
          if (hit) {
            const bStartStr = hit.startDate.toISOString().split('T')[0];
            const bEndStr = hit.endDate.toISOString().split('T')[0];
            throw new BadRequestException(
              `Time off is blacked out ${bStartStr}${bEndStr !== bStartStr ? ` – ${bEndStr}` : ''} (${hit.reason}). Please choose other dates.`,
            );
          }
        }
      }

      const profile = await tx.profile.findUniqueOrThrow({ where: { id: scope.profileId } });
      const request = await tx.staffRequest.create({
        data: {
          venueId: scope.venueId,
          profileId: scope.profileId,
          kind: body.kind,
          status: 'pending',
          title: body.title,
          details: body.details,
          requestedForDate: body.requestedForDate,
          requestedShiftId: body.requestedShiftId,
          requestedRangeStart: body.requestedRangeStart,
          requestedRangeEnd: body.requestedRangeEnd,
          availability: requestPayload
            ? (requestPayload as unknown as Prisma.InputJsonValue)
            : undefined,
        },
      });
      return { profile, request };
    }, { venueId: scope.venueId });

    await this.notifications.notifyManagers({
      venueId: scope.venueId,
      kind: 'request_created',
      title: 'New staff request',
      body: `${profile.fullName} submitted ${body.kind.replace('_', ' ')}: ${body.title}`,
    });
    const kindLabel = body.kind.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const reqStart = body.requestedRangeStart || body.requestedForDate;
    const reqEnd = body.requestedRangeEnd || body.requestedForDate || reqStart;
    const dateRangeStr = reqStart && reqEnd ? (reqStart === reqEnd ? reqStart : `${reqStart} – ${reqEnd}`) : null;

    void this.email.sendToVenueManagers(scope.venueId, {
      subject: `Staff Request — ${kindLabel}: Action Required`,
      text:
        `Hi Manager,\n\n` +
        `${profile.fullName} has submitted a new ${kindLabel.toLowerCase()} request. Please review and take action in the Venue Wrangler app.\n\n` +
        `Request Details\n` +
        `Detail\tInfo\n` +
        `Employee\t${profile.fullName}\n` +
        `Request Type\t${kindLabel}\n` +
        `Title\t${body.title}\n` +
        `Details\t${body.details}\n` +
        (dateRangeStr ? `Date/Range\t${dateRangeStr}\n` : '') + '\n' +
        `How to Respond\n` +
        `1. Open the Venue Wrangler app\n` +
        `2. Go to Requests & Approvals\n` +
        `3. Select the request\n` +
        `4. Tap Approve or Deny — the employee will be notified instantly\n\n` +
        `Pending requests can also be managed from your Operations Dashboard.\n\n` +
        `Questions? support@venuewrangler.com\n\n` +
        `— The Venue Wrangler Team`,
    });

    return mapStaffRequest(request);
  }

  @RequireSubscription()
  // Awaits NotificationsService.notifyProfile, which awaits a blocking Expo
  // push fetch — must not hold the request transaction open for that call.
  @SkipTenantTransaction()
  @Patch(':id')
  async reviewStaffRequest(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: ReviewStaffRequestDto,
  ) {
    if (!scope || !isAdminRole(scope.role)) {
      throw new ForbiddenException('Not authorized');
    }

    // This route is @SkipTenantTransaction() (the notifyProfile/email calls
    // below await a blocking Expo push fetch), so this write needs its own
    // GUC binding rather than relying on the request-scoped interceptor.
    const result = await withTenantTransaction(this.prisma, async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "StaffRequest" WHERE "id" = ${id} FOR UPDATE`;
    const request = await tx.staffRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.venueId !== scope.venueId) {
      throw new ForbiddenException('Request does not belong to this venue');
    }
    if (request.status !== 'pending') {
      throw new BadRequestException('Only pending requests can be reviewed');
    }

    const reviewer = await tx.profile.findUniqueOrThrow({ where: { id: scope.profileId } });

    // Handle approval side-effects
    if (body.status === 'approved') {
      if (request.kind === 'sick_leave') {
        const hours = calculateRequestHours(request.requestedRangeStart || request.requestedForDate, request.requestedRangeEnd || request.requestedForDate);
        // Atomic decrement clamped at zero so two concurrent approvals can't
        // both read the same balance and under-deduct (lost update).
        await tx.$executeRaw`
          UPDATE "Profile"
          SET "sickHoursAccrued" = GREATEST(0, "sickHoursAccrued" - ${hours})
          WHERE id = ${request.profileId}`;
      } else if (request.kind === 'time_off') {
        const hours = calculateRequestHours(request.requestedRangeStart || request.requestedForDate, request.requestedRangeEnd || request.requestedForDate);
        await tx.$executeRaw`
          UPDATE "Profile"
          SET "ptoHoursAccrued" = GREATEST(0, "ptoHoursAccrued" - ${hours})
          WHERE id = ${request.profileId}`;
      }
      
      // Approved unavailable days are the only availability source. Release any
      // concrete dated shifts in the approved range so the open-shift board and
      // staffing totals update immediately.
      if ((request.kind === 'time_off' || request.kind === 'sick_leave') && tx.scheduleShift?.findMany) {
        const unavailableStart = request.requestedRangeStart || request.requestedForDate;
        const unavailableEnd = request.requestedRangeEnd || request.requestedForDate || unavailableStart;
        if (unavailableStart && unavailableEnd) {
          const assignedShifts = await tx.scheduleShift.findMany({
            where: { venueId: request.venueId, profileId: request.profileId },
            select: { id: true, weekStart: true, dayIndex: true },
          });
          const affectedIds = assignedShifts
            .filter((shift) => {
              if (!shift.weekStart) return false;
              const date = new Date(`${shift.weekStart}T00:00:00.000Z`);
              date.setUTCDate(date.getUTCDate() + shift.dayIndex);
              const iso = date.toISOString().slice(0, 10);
              return iso >= unavailableStart && iso <= unavailableEnd;
            })
            .map((shift) => shift.id);
          if (affectedIds.length > 0) {
            await tx.scheduleShift.updateMany({
              where: { id: { in: affectedIds } },
              data: { profileId: null, status: 'open' },
            });
          }
        }
      }

      if (request.kind === 'time_correction') {
        const correction = (request.availability as any) || {};
        const venue = await tx.venue.findUnique({
          where: { id: request.venueId },
          select: { timezone: true },
        });
        const correctedClockIn = new Date(correction.clockInAt);
        if (isNaN(correctedClockIn.getTime())) {
          throw new BadRequestException('Invalid correction clock-in time');
        }
        const correctedClockOut = correction.clockOutAt ? new Date(correction.clockOutAt) : null;
        if (correction.clockOutAt && (!correctedClockOut || isNaN(correctedClockOut.getTime()))) {
          throw new BadRequestException('Invalid correction clock-out time');
        }
        const willBeOpen = !correctedClockOut;

        const applyCorrection = async (targetId: string) => {
          if (willBeOpen) {
            const otherOpen = await tx.timeEntry.findFirst({
              where: {
                profileId: request.profileId,
                venueId: request.venueId,
                isOpen: true,
                id: { not: targetId },
              },
              select: { id: true },
            });
            if (otherOpen) {
              throw new BadRequestException(
                'Cannot leave this correction open — staff already has an open clock-in.',
              );
            }
          }
          await tx.timeEntry.update({
            where: { id: targetId },
            data: {
              clockInAt: correctedClockIn,
              clockOutAt: correctedClockOut,
              isOpen: willBeOpen,
            },
          });
        };

        if (correction.timeEntryId) {
          // Only correct a time entry that belongs to this venue AND the same
          // staff member who filed the request — never a foreign entry id
          // smuggled in via the client-supplied availability blob.
          const target = await tx.timeEntry.findFirst({
            where: { id: correction.timeEntryId, venueId: request.venueId, profileId: request.profileId },
          });
          if (!target) throw new BadRequestException('Time entry not found for this request');
          await applyCorrection(target.id);
        } else {
          // No specific entry ID — find an existing entry for this profile on the
          // same venue-local calendar day and correct it. Only create a new entry
          // if none exists (the employee genuinely forgot to clock in).
          const dayIso = zonedIsoDate(venue?.timezone ?? null, correctedClockIn.getTime());
          const { start: dayStartMs, end: dayEndMs } = zonedDateBounds(
            venue?.timezone ?? null,
            dayIso,
          );
          const existing = await tx.timeEntry.findFirst({
            where: {
              profileId: request.profileId,
              venueId: request.venueId,
              clockInAt: { gte: new Date(dayStartMs), lt: new Date(dayEndMs) },
            },
          });
          if (existing) {
            await applyCorrection(existing.id);
          } else {
            if (willBeOpen) {
              const otherOpen = await tx.timeEntry.findFirst({
                where: {
                  profileId: request.profileId,
                  venueId: request.venueId,
                  isOpen: true,
                },
                select: { id: true },
              });
              if (otherOpen) {
                throw new BadRequestException(
                  'Cannot create an open correction — staff already has an open clock-in.',
                );
              }
            }
            await tx.timeEntry.create({
              data: {
                profileId: request.profileId,
                venueId: request.venueId,
                clockInAt: correctedClockIn,
                clockOutAt: correctedClockOut
                  ?? new Date(correctedClockIn.getTime() + 8 * 60 * 60 * 1000),
                clockInLat: 0,
                clockInLng: 0,
                clockInAccuracyM: 0,
                clockInMocked: false,
                clockOutLat: 0,
                clockOutLng: 0,
                clockOutAccuracyM: 0,
                clockOutMocked: false,
                // New corrections without an explicit out time default to a closed
                // 8h entry so we never collide with the one-open-punch unique index.
                isOpen: false,
              },
            });
          }
        }
      }
    }

    const updated = await tx.staffRequest.update({
      where: { id: request.id },
      data: {
        status: body.status as RequestStatus,
        reviewerId: scope.profileId,
        reviewedAt: new Date(),
        responseNotes: body.responseNotes,
      },
    });
    return { request, reviewer, updated };
    }, { venueId: scope.venueId });
    const { request, reviewer, updated } = result;

    await this.notifications.notifyProfile({
      venueId: scope.venueId,
      profileId: request.profileId,
      kind: 'request_reviewed',
      title: `Request ${body.status}`,
      body:
        body.responseNotes?.trim() ||
        `${reviewer.fullName} marked your ${request.kind.replace('_', ' ')} request ${body.status}.`,
    });
    const kindLabel = request.kind.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const statusText = body.status.charAt(0).toUpperCase() + body.status.slice(1);
    const noteText = body.responseNotes?.trim();

    void this.email.sendToProfile(request.profileId, {
      subject: `Your ${kindLabel} Request Has Been ${statusText}`,
      text:
        `Hi there,\n\n` +
        `Your ${kindLabel.toLowerCase()} request has been ${body.status} by your manager. Here are the details:\n\n` +
        `Request Review Details\n` +
        `Detail\tInfo\n` +
        `Request Type\t${kindLabel}\n` +
        `Title\t${request.title}\n` +
        `Status\t${statusText}\n` +
        `Reviewed By\t${reviewer.fullName}\n` +
        (noteText ? `Manager's Note\t${noteText}\n` : '') + '\n' +
        `Questions? support@venuewrangler.com\n\n` +
        `— The Venue Wrangler Team`,
    });

    return mapStaffRequest(updated);
  }
}
