import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
} from '@nestjs/common';
import { IsBoolean, IsNumber, IsString, IsIn, Max, Min } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { assertWithinGeofence } from '../../common/geofence';
import { parseTimeBreaks, unpaidBreakMs } from '../../common/break-duration';
import { todayInZone, weekStartFor } from '../../common/pay-period';
import { mapClockEntry, minutesToTime } from '../../common/mappers';
import { zonedDayOfWeek, zonedMinutesOfDay, zonedDayBounds } from '../../common/venue-time';
import { PrismaService } from '../../prisma/prisma.service';
import { AsyncWriteService } from '../../async-write/async-write.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

class ClockPunchDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsNumber()
  @Min(0)
  accuracy!: number;

  @IsBoolean()
  mocked!: boolean;
}

class BreakStartDto {
  @IsString()
  @IsIn(['paid', 'unpaid'])
  type!: 'paid' | 'unpaid';
}

@Controller('v1/time-clock')
export class TimeClockController {
  constructor(private readonly prisma: PrismaService, private readonly asyncWrites: AsyncWriteService) {}

  @RequireSubscription()
  @Get('board')
  async getClockBoard(@VenueScope() scope: Scope) {
    if (!scope) return null;
    const managerView = isAdminRole(scope.role);
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) return null;

    // The board only surfaces open entries and alerts derived from them, so we
    // never need the venue's full (unbounded) time-entry history.
    const entries = await this.prisma.timeEntry.findMany({
      where: { venueId: venue.id, isOpen: true },
      include: { profile: true },
    });

    const myRawEntry = entries.find((entry) => entry.isOpen && entry.profileId === scope.profileId && entry.profile);
    const myOpenEntry = myRawEntry ? mapClockEntry(myRawEntry, myRawEntry.profile!, venue) : null;
    const activeClockEntries = managerView
      ? entries.flatMap((entry) => (entry.isOpen && entry.profile ? [mapClockEntry(entry, entry.profile, venue, { includeLocation: false })] : []))
      : myOpenEntry
        ? [myOpenEntry]
        : [];

    const managerAlerts: Array<{
      kind: 'late_clock_in' | 'missed_clock_out';
      severity: 'warning' | 'danger';
      profileId: string;
      memberName: string;
      detail: string;
    }> = [];

    if (isAdminRole(scope.role)) {
      const now = Date.now();
      const tz = venue.timezone ?? null;
      const today = zonedDayOfWeek(tz, now);
      const minutesNow = zonedMinutesOfDay(tz, now);
      const weekStart = weekStartFor(todayInZone(tz));
      const openByProfile = new Set(
        entries.filter((entry) => entry.isOpen).map((entry) => entry.profileId),
      );
      const shifts = await this.prisma.scheduleShift.findMany({
        where: { venueId: venue.id, weekStart },
        include: { profile: true },
      });
      for (const shift of shifts) {
        if (shift.dayIndex !== today || !shift.profileId || shift.status === 'open') continue;
        if (
          minutesNow >= shift.startMinutes + 15 &&
          minutesNow <= shift.endMinutes &&
          !openByProfile.has(shift.profileId) &&
          shift.profile
        ) {
          managerAlerts.push({
            kind: 'late_clock_in',
            severity: 'warning',
            profileId: shift.profile.id,
            memberName: shift.profile.fullName,
            detail: `${shift.jobTitle} was scheduled at ${minutesToTime(shift.startMinutes)} and is not clocked in.`,
          });
        }
      }
      for (const entry of entries) {
        if (!entry.isOpen || now - entry.clockInAt.getTime() < 10 * 60 * 60 * 1000) continue;
        if (entry.profile) {
          managerAlerts.push({
            kind: 'missed_clock_out',
            severity: 'danger',
            profileId: entry.profile.id,
            memberName: entry.profile.fullName,
            detail: `Clocked in since ${entry.clockInAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`,
          });
        }
      }
    }

    return {
      venue: {
        _id: venue.id,
        name: venue.name,
        latitude: venue.latitude,
        longitude: venue.longitude,
        geofenceRadiusM: venue.geofenceRadiusM,
        subscriptionStatus: venue.subscriptionStatus ?? null,
        subscriptionPlatform: venue.subscriptionPlatform ?? null,
      },
      activeClockEntries,
      employeeEntry: myOpenEntry,
      managerAlerts: managerAlerts.slice(0, 8),
    };
  }

  @RequireSubscription()
  @Get('me')
  async getMyTimeClock(@CurrentUser() user: AuthUser, @VenueScope() scope: Scope) {
    const venueId = scope?.venueId ?? user.venueId;
    const profile = await this.prisma.profile.findFirst({
      where: { userId: user.sub, ...(venueId ? { venueId } : {}) },
      include: { venue: { select: { timezone: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!profile) return null;

    // Only today's punches and the last week of hours are reported, so bound
    // the query to the last 8 days (plus any still-open entry) instead of the
    // profile's entire history.
    const windowStart = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const all = await this.prisma.timeEntry.findMany({
      where: { profileId: profile.id, OR: [{ isOpen: true }, { clockInAt: { gte: windowStart } }] },
    });
    const open = all.filter((entry) => entry.isOpen);
    const closed = all.filter((entry) => !entry.isOpen);

    const tz = profile.venue?.timezone ?? null;
    const startOfToday = zonedDayBounds(tz, 0).start;
    const now = Date.now();
    const punches: { type: 'in' | 'out'; at: number }[] = [];
    for (const entry of all) {
      const inAt = entry.clockInAt.getTime();
      if (inAt >= startOfToday) punches.push({ type: 'in', at: inAt });
      const outAt = entry.clockOutAt?.getTime();
      if (outAt && outAt >= startOfToday) punches.push({ type: 'out', at: outAt });
    }
    punches.sort((a, b) => a.at - b.at);

    const weekMs = 1000 * 60 * 60 * 24 * 7;
    const regularHours = closed.reduce((sum, entry) => {
      const outAt = entry.clockOutAt?.getTime();
      if (!outAt || now - outAt > weekMs) return sum;
      let durationMs = outAt - entry.clockInAt.getTime();
      const breaks = parseTimeBreaks(entry.breaks);
      for (const b of breaks) {
        if (b.type === 'unpaid' && b.startAt && b.endAt) {
          durationMs -= unpaidBreakMs(b.startAt, b.endAt);
        }
      }
      return sum + Math.max(0, durationMs) / 3600000;
    }, 0);
    const round1 = (n: number) => Math.round(n * 10) / 10;

    return {
      isClockedIn: open.length > 0,
      openSince: open[0]?.clockInAt.getTime() ?? null,
      regularHours: round1(regularHours),
      sickHours: profile.sickHoursAccrued,
      ptoHours: profile.ptoHoursAccrued,
      totalHours: round1(regularHours),
      punches,
    };
  }

  @RequireSubscription()
  @Post('clock-in')
  async clockIn(@VenueScope() scope: Scope, @Body() body: ClockPunchDto, @Headers('idempotency-key') idempotencyKey?: string) {
    if (!scope) throw new BadRequestException('Profile is not initialized');
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) throw new BadRequestException('Assigned venue not found');
    assertWithinGeofence(body.lat, body.lng, body.accuracy, body.mocked, venue);

    const active = await this.prisma.timeEntry.findFirst({
      where: { profileId: scope.profileId, isOpen: true },
    });
    if (active) throw new BadRequestException('Already clocked in');

    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { id: scope.profileId } });

    if (!isAdminRole(scope.role)) {
      const nowMs = Date.now();
      const today = zonedDayOfWeek(venue.timezone, nowMs);
      const minutesNow = zonedMinutesOfDay(venue.timezone, nowMs);
      const weekStart = weekStartFor(todayInZone(venue.timezone));
      const shift = await this.prisma.scheduleShift.findFirst({
        where: {
          venueId: venue.id,
          profileId: profile.id,
          weekStart,
          dayIndex: today,
          status: { in: ['scheduled', 'covered'] },
        },
        orderBy: { startMinutes: 'asc' },
      });
      if (shift) {
        const earlyWindow = venue.earlyClockInWindowMin ?? 10;
        if (minutesNow < shift.startMinutes - earlyWindow) {
          const formattedStart = minutesToTime(shift.startMinutes);
          throw new BadRequestException(
            `Too early to clock in. Your shift starts at ${formattedStart}. You can clock in starting ${earlyWindow} minutes prior.`
          );
        }
      }
    }

    if (this.asyncWrites.isEnabled()) {
      return this.asyncWrites.enqueue('clock_in', idempotencyKey ?? '', {
        profileId: scope.profileId, venueId: venue.id, lat: body.lat, lng: body.lng,
        accuracy: body.accuracy, mocked: body.mocked, clockInAt: new Date().toISOString(),
      });
    }

    try {
      const entry = await this.prisma.timeEntry.create({
        data: {
          profileId: scope.profileId,
          venueId: venue.id,
          clockInAt: new Date(),
          clockInLat: body.lat,
          clockInLng: body.lng,
          clockInAccuracyM: body.accuracy,
          clockInMocked: body.mocked,
          isOpen: true,
        },
      });
      return mapClockEntry(entry, profile, venue);
    } catch (error: any) {
      // Partial unique index (one open entry per profile) — a concurrent
      // double-tap loses the race here instead of creating a second open entry.
      if (error?.code === 'P2002') throw new BadRequestException('Already clocked in');
      throw error;
    }
  }

  @RequireSubscription()
  @Post('clock-out')
  async clockOut(@VenueScope() scope: Scope, @Body() body: ClockPunchDto) {
    if (!scope) throw new BadRequestException('Profile is not initialized');
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) throw new BadRequestException('Assigned venue not found');
    assertWithinGeofence(body.lat, body.lng, body.accuracy, body.mocked, venue);

    const active = await this.prisma.timeEntry.findFirst({
      where: { profileId: scope.profileId, isOpen: true },
    });
    if (!active) throw new BadRequestException('No active clock-in found');

    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { id: scope.profileId } });
    const count = await this.prisma.timeEntry.updateMany({
      where: { id: active.id, isOpen: true, updatedAt: active.updatedAt },
      data: {
        clockOutAt: new Date(),
        clockOutLat: body.lat,
        clockOutLng: body.lng,
        clockOutAccuracyM: body.accuracy,
        clockOutMocked: body.mocked,
        isOpen: false,
      },
    });
    if (count.count === 0) throw new BadRequestException('Clock-out state changed. Refresh and try again.');
    const entry = await this.prisma.timeEntry.findUniqueOrThrow({ where: { id: active.id } });
    return mapClockEntry(entry, profile, venue);
  }

  @RequireSubscription()
  @Post('break-start')
  async startBreak(@VenueScope() scope: Scope, @Body() body: BreakStartDto) {
    if (!scope) throw new BadRequestException('Profile is not initialized');
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) throw new BadRequestException('Assigned venue not found');

    const entry = await this.prisma.timeEntry.findFirst({
      where: { profileId: scope.profileId, isOpen: true },
    });
    if (!entry) throw new BadRequestException('No active clock-in found');

    const breaks = parseTimeBreaks(entry.breaks);
    const activeBreak = breaks.find((breakRow) => breakRow.endAt === null);
    if (activeBreak) throw new BadRequestException('Already on a break');

    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { id: scope.profileId } });
    const newBreaks = [...breaks, { startAt: Date.now(), endAt: null, type: body.type }];
    const count = await this.prisma.timeEntry.updateMany({
      where: { id: entry.id, isOpen: true, updatedAt: entry.updatedAt },
      data: { breaks: newBreaks },
    });
    if (count.count === 0) throw new BadRequestException('Break state changed. Refresh and try again.');
    const updated = await this.prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    return mapClockEntry(updated, profile, venue);
  }

  @RequireSubscription()
  @Post('break-end')
  async endBreak(@VenueScope() scope: Scope) {
    if (!scope) throw new BadRequestException('Profile is not initialized');
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) throw new BadRequestException('Assigned venue not found');

    const entry = await this.prisma.timeEntry.findFirst({
      where: { profileId: scope.profileId, isOpen: true },
    });
    if (!entry) throw new BadRequestException('No active clock-in found');

    const breaks = parseTimeBreaks(entry.breaks);
    const activeBreakIndex = breaks.findIndex((breakRow) => breakRow.endAt === null);
    if (activeBreakIndex === -1) throw new BadRequestException('Not currently on a break');

    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { id: scope.profileId } });
    const newBreaks = [...breaks];
    newBreaks[activeBreakIndex] = {
      ...newBreaks[activeBreakIndex],
      endAt: Date.now(),
    };

    const count = await this.prisma.timeEntry.updateMany({
      where: { id: entry.id, isOpen: true, updatedAt: entry.updatedAt },
      data: { breaks: newBreaks },
    });
    if (count.count === 0) throw new BadRequestException('Break state changed. Refresh and try again.');
    const updated = await this.prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    return mapClockEntry(updated, profile, venue);
  }
}
