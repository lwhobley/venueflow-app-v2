import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma, ShiftStatus } from '@prisma/client';
import { Type, plainToInstance } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
  Min,
  Max,
  validateSync,
} from 'class-validator';
import { canManageVenue, isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { dayLabel, minutesToTime } from '../../common/mappers';
import { ACTIVE_MEMBERSHIP } from '../../common/membership';
import {
  addDays,
  isIsoDate,
  todayInZone,
  weekStartFor,
} from '../../common/pay-period';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { withSerializableRetry } from '../../common/tx-retry';
import { zonedDateBounds } from '../../common/venue-time';
import { buildLaborForecast } from './labor-forecast';
import { EmailService } from '../../email/email.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { SchedulingAssignmentService } from './scheduling-assignment.service';
import { AiSchedulerService } from './ai-scheduler.service';

type Scope = VenueScopedRequest['venueScope'];

const SHIFT_STATUSES = ['scheduled', 'open', 'covered'];
const SWAP_STATUSES = ['proposed', 'accepted', 'declined', 'approved', 'denied', 'cancelled'];
const AI_SCHEDULE_RATE_LIMIT_MAX = 20;
const AI_SCHEDULE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

class BlackoutDto {
  @IsString()
  startDate!: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsString()
  reason!: string;
}

class ScheduleMemoryNoteDto {
  @IsString()
  title!: string;

  @IsString()
  detail!: string;

  @IsString()
  @IsOptional()
  weekStart?: string;
}

class ShiftDto {
  @IsString()
  @IsOptional()
  weekStart?: string;

  @IsInt()
  dayIndex!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  startMinutes!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  endMinutes!: number;

  @IsString()
  jobTitle!: string;

  @IsString()
  station!: string;

  @IsString()
  @IsOptional()
  profileId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

class AssignShiftDto {
  @IsString()
  @IsOptional()
  profileId?: string;
}

class LaborBudgetDto {
  @IsInt()
  @Min(0)
  @IsOptional()
  weeklyLaborBudgetHours?: number;
}

class TemplateDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  weekStart?: string;
}

class TemplateShiftDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayIndex!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  startMinutes!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  endMinutes!: number;

  @IsString()
  jobTitle!: string;

  @IsString()
  station!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

class ApplyTemplateDto {
  @IsBoolean()
  replace!: boolean;

  @IsString()
  @IsOptional()
  weekStart?: string;
}

class CopyDayDto {
  @IsString()
  @IsOptional()
  weekStart?: string;

  @IsInt()
  @Min(0)
  @Max(6)
  fromDay!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  toDays!: number[];
}

class RestoreShiftDto extends ShiftDto {
  @IsString()
  @IsIn(SHIFT_STATUSES)
  status!: ShiftStatus;
}

class RestoreShiftsDto {
  @IsString()
  @IsOptional()
  weekStart?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestoreShiftDto)
  shifts!: RestoreShiftDto[];
}

class WeekDto {
  @IsString()
  @IsOptional()
  weekStart?: string;
}

class AutoScheduleAssignmentDto {
  @IsString()
  shiftId!: string;

  @IsString()
  profileId!: string;
}

class ApplyAutoScheduleDto {
  @IsString()
  @IsOptional()
  weekStartDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutoScheduleAssignmentDto)
  assignments!: AutoScheduleAssignmentDto[];
}

class AiProposedShiftDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayIndex!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  startMinutes!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  endMinutes!: number;

  @IsString()
  jobTitle!: string;

  @IsString()
  station!: string;

  @IsString()
  @IsOptional()
  profileId?: string;
}

class CommitAiScheduleDto {
  @IsString()
  @IsOptional()
  weekStartDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiProposedShiftDto)
  shifts!: AiProposedShiftDto[];
}

class ProposeSwapDto {
  @IsString()
  myShiftId!: string;

  @IsString()
  targetProfileId!: string;

  @IsString()
  @IsOptional()
  targetShiftId?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

class RespondSwapDto {
  @IsBoolean()
  accept!: boolean;
}

class ReviewSwapDto {
  @IsBoolean()
  approve!: boolean;
}

function ensureValidShiftWindow(dayIndex: number, startMinutes: number, endMinutes: number) {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    throw new BadRequestException('dayIndex must be between 0 and 6');
  }
  if (!Number.isInteger(startMinutes) || startMinutes < 0 || startMinutes > 1440) {
    throw new BadRequestException('Invalid start time');
  }
  if (!Number.isInteger(endMinutes) || endMinutes < 0 || endMinutes > 1440 || endMinutes <= startMinutes) {
    throw new BadRequestException('End time must be after start time');
  }
}

function schedulePublishState(venue: {
  schedulePublishedAt: Date | null;
  scheduleUpdatedAfterPublishAt: Date | null;
}) {
  const publishedAt = venue.schedulePublishedAt?.getTime() ?? null;
  const updatedAfterPublishAt = venue.scheduleUpdatedAfterPublishAt?.getTime() ?? null;
  return {
    status: !publishedAt ? 'draft' : updatedAfterPublishAt && updatedAfterPublishAt > publishedAt ? 'edited_after_publish' : 'published',
    publishedAt,
    updatedAfterPublishAt,
  };
}

type ShiftWithProfile = {
  id: string;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  jobTitle: string;
  station: string;
  notes: string | null;
  status: ShiftStatus;
  profileId: string | null;
  profile?: { fullName: string } | null;
};

type TemplateShiftSlot = {
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  jobTitle: string;
  station: string;
  notes?: string | null;
};

type AvailabilityWindow = { dayIndex: number; startMinutes: number; endMinutes: number; available: boolean };

function availabilityCovers(rows: AvailabilityWindow[] | undefined, shift: { dayIndex: number; startMinutes: number; endMinutes: number }) {
  const dayRows = (rows ?? []).filter((row) => row.dayIndex === shift.dayIndex);
  // Availability is request-driven: no approved unavailable-day request means
  // the employee can be scheduled. Legacy positive rows are ignored.
  const blocked = dayRows.some((row) =>
    !row.available &&
    row.startMinutes < shift.endMinutes &&
    row.endMinutes > shift.startMinutes,
  );
  return !blocked;
}

@Controller('v1/scheduling')
export class SchedulingController {
  private readonly logger = new Logger(SchedulingController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly assignments: SchedulingAssignmentService,
    private readonly aiScheduler: AiSchedulerService,
  ) {}

  @RequireSubscription()
  @Get('blackouts')
  async listBlackouts(@VenueScope() scope: Scope) {
    if (!scope) return [];
    const rows = await this.prisma.blackoutDate.findMany({
      where: { venueId: scope.venueId },
      orderBy: { startDate: 'asc' },
    });
    return rows.map((row) => ({
      _id: row.id,
      startDate: row.startDate.toISOString().split('T')[0],
      endDate: row.endDate.toISOString().split('T')[0],
      reason: row.reason,
    }));
  }

  @RequireSubscription()
  @Post('blackouts')
  async addBlackout(@VenueScope() scope: Scope, @Body() body: BlackoutDto) {
    this.requireManager(scope);
    const startDate = body.startDate.trim();
    const endDate = body.endDate?.trim() || startDate;
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      throw new BadRequestException('Dates must be in YYYY-MM-DD format');
    }
    if (endDate < startDate) throw new BadRequestException('End date must be on or after the start date');
    const row = await this.prisma.blackoutDate.create({
      data: {
        venueId: scope!.venueId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason: body.reason.trim() || 'Blackout',
        createdBy: scope!.profileId,
      },
    });
    return row.id;
  }

  @RequireSubscription()
  @Delete('blackouts/:id')
  async removeBlackout(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    const row = await this.prisma.blackoutDate.findFirst({ where: { id, venueId: scope!.venueId } });
    if (!row) throw new NotFoundException('Blackout not found');
    await this.prisma.blackoutDate.delete({ where: { id: row.id } });
    return { ok: true };
  }

  @RequireSubscription()
  @Get('manager')
  async getManagerSchedule(@VenueScope() scope: Scope, @Query('weekStart') requestedWeekStart?: string) {
    this.requireManager(scope);
    const selectedWeekStart = await this.resolveAvailabilityWeekStart(scope!.venueId, requestedWeekStart);
    const [venue, shifts, staff] = await Promise.all([
      this.prisma.venue.findUniqueOrThrow({ where: { id: scope!.venueId } }),
      this.prisma.scheduleShift.findMany({
        where: { venueId: scope!.venueId, weekStart: selectedWeekStart },
        include: { profile: true },
        orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
      }),
      this.prisma.profile.findMany({
        where: { venueId: scope!.venueId, OR: ACTIVE_MEMBERSHIP },
        orderBy: { fullName: 'asc' },
      }),
    ]);
    const approvedUnavailable = await this.unavailableRequests(scope!.venueId, selectedWeekStart);
    const availability = this.unavailableByProfile(approvedUnavailable, selectedWeekStart);
    const availabilityByProfile = availability;
    const selectedAvailabilityWeekByProfile = new Map<string, string>();
    for (const profileId of availability.keys()) {
      selectedAvailabilityWeekByProfile.set(profileId, selectedWeekStart);
    }
    const weeklyMinutes = new Map<string, number>();
    for (const shift of shifts) {
      if (!shift.profileId) continue;
      weeklyMinutes.set(shift.profileId, (weeklyMinutes.get(shift.profileId) ?? 0) + Math.max(0, shift.endMinutes - shift.startMinutes));
    }
    const totalScheduledMinutes = shifts.reduce((sum, shift) => sum + Math.max(0, shift.endMinutes - shift.startMinutes), 0);
    return {
      shifts: shifts.map((shift) => {
        const rows = shift.profileId ? availabilityByProfile.get(shift.profileId) : undefined;
        return this.mapManagerShift(shift, rows && rows.length > 0 ? !availabilityCovers(rows, shift) : false);
      }),
      staff: staff.map((member) => {
        const mins = weeklyMinutes.get(member.id) ?? 0;
        return {
          _id: member.id,
          fullName: member.fullName,
          role: member.role,
          jobTitle: member.jobTitle,
          weeklyHours: Math.round((mins / 60) * 10) / 10,
          overtime: mins > 40 * 60,
          availabilityWeekStart: selectedAvailabilityWeekByProfile.get(member.id) ?? null,
          availability: (availabilityByProfile.get(member.id) ?? []).map((row) => ({
            dayIndex: row.dayIndex,
            startMinutes: row.startMinutes,
            endMinutes: row.endMinutes,
            available: row.available,
          })),
        };
      }),
      laborBudgetHours: venue.weeklyLaborBudgetHours ?? null,
      totalScheduledHours: Math.round((totalScheduledMinutes / 60) * 10) / 10,
      weekStart: selectedWeekStart,
      publishState: schedulePublishState(venue),
    };
  }

  @RequireSubscription()
  @Get('labor-forecast')
  async getLaborForecast(@VenueScope() scope: Scope, @Query('weekStart') requestedWeekStart?: string) {
    this.requireManager(scope);
    const venue = await this.prisma.venue.findUnique({
      where: { id: scope!.venueId },
      select: { timezone: true, weeklyLaborBudgetHours: true },
    });
    const tz = venue?.timezone ?? null;
    const selectedWeekStart = await this.resolveAvailabilityWeekStart(scope!.venueId, requestedWeekStart);
    const now = new Date(zonedDateBounds(tz, selectedWeekStart).start);
    const weekEnd = new Date(zonedDateBounds(tz, addDays(selectedWeekStart, 7)).start);
    const [shifts, reservations, venueEvents, profiles] = await Promise.all([
      this.prisma.scheduleShift.findMany({ where: { venueId: scope!.venueId, weekStart: selectedWeekStart } }),
      this.prisma.reservation.findMany({
        where: {
          venueId: scope!.venueId,
          deletedAt: null,
          reservationTime: { gte: now, lt: weekEnd },
          status: { notIn: ['cancelled', 'no_show'] },
        },
        select: { reservationTime: true, partySize: true, isPrivateEvent: true },
      }),
      this.prisma.venueEvent.findMany({
        where: {
          venueId: scope!.venueId,
          startsAt: { gte: now, lt: weekEnd },
        },
        select: { startsAt: true, expectedGuests: true },
      }),
      this.prisma.profile.findMany({
        where: { venueId: scope!.venueId, OR: ACTIVE_MEMBERSHIP },
        select: { id: true, fullName: true },
      }),
    ]);

    const forecast = buildLaborForecast({
      tz,
      now,
      shifts: shifts.map((s) => ({ dayIndex: s.dayIndex, startMinutes: s.startMinutes, endMinutes: s.endMinutes, profileId: s.profileId })),
      reservations: reservations.map((r) => ({ ts: r.reservationTime.getTime(), partySize: r.partySize, isPrivateEvent: Boolean(r.isPrivateEvent) })),
      events: venueEvents.map((e) => ({ ts: e.startsAt.getTime(), expectedGuests: e.expectedGuests })),
      nameById: new Map(profiles.map((p) => [p.id, p.fullName])),
    });

    // Surface the venue's weekly labor budget here so callers (e.g. the Reports
    // efficiency card) don't have to fetch the full manager schedule for it.
    return { ...forecast, laborBudgetHours: venue?.weeklyLaborBudgetHours ?? null };
  }

  @RequireSubscription()
  @Get('memory')
  async listScheduleMemory(@VenueScope() scope: Scope, @Query('limit') limitRaw?: string) {
    this.requireManager(scope);
    const limit = Math.min(20, Math.max(1, Number(limitRaw) || 8));
    const notes = await this.prisma.scheduleMemoryNote.findMany({
      where: { venueId: scope!.venueId },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
    });
    return {
      notes: notes.map((note) => ({
        _id: note.id,
        title: note.title,
        detail: note.detail,
        weekStart: note.weekStart,
        createdAt: note.createdAt.getTime(),
      })),
    };
  }

  @RequireSubscription()
  @Post('memory')
  async addScheduleMemoryNote(@VenueScope() scope: Scope, @Body() body: ScheduleMemoryNoteDto) {
    this.requireManager(scope);
    const title = body.title.trim();
    const detail = body.detail.trim();
    if (!title) throw new BadRequestException('Memory title is required');
    if (!detail) throw new BadRequestException('Memory detail is required');
    const venue = await this.prisma.venue.findUnique({
      where: { id: scope!.venueId },
      select: { timezone: true },
    });
    const weekStart = body.weekStart?.trim() || weekStartFor(todayInZone(venue?.timezone ?? null));
    const note = await this.prisma.scheduleMemoryNote.create({
      data: {
        venueId: scope!.venueId,
        weekStart,
        title,
        detail,
        createdByProfileId: scope!.profileId,
      },
    });
    return {
      _id: note.id,
      title: note.title,
      detail: note.detail,
      weekStart: note.weekStart,
      createdAt: note.createdAt.getTime(),
    };
  }

  @RequireSubscription()
  @Post('shifts')
  async createShift(@VenueScope() scope: Scope, @Body() body: ShiftDto) {
    this.requireManager(scope);
    ensureValidShiftWindow(body.dayIndex, body.startMinutes, body.endMinutes);
    const weekStart = await this.resolveAvailabilityWeekStart(scope!.venueId, body.weekStart);
    const shift = await this.assignments.createShift({
      venueId: scope!.venueId,
      weekStart,
      profileId: body.profileId,
      dayIndex: body.dayIndex,
      startMinutes: body.startMinutes,
      endMinutes: body.endMinutes,
      jobTitle: body.jobTitle,
      station: body.station,
      notes: body.notes,
    });
    if (body.profileId) {
      await this.notifications.notifyProfile({
        venueId: scope!.venueId,
        profileId: body.profileId,
        kind: 'shift_assigned',
        title: 'New shift assigned',
        body: `${dayLabel(body.dayIndex)} ${minutesToTime(body.startMinutes)}-${minutesToTime(body.endMinutes)} - ${body.jobTitle}`,
      });
      void this.sendScheduleUpdateEmail(body.profileId, 'Added', undefined, {
        dayIndex: body.dayIndex,
        startMinutes: body.startMinutes,
        endMinutes: body.endMinutes,
        station: body.station,
      });
    }
    return shift.id;
  }

  @RequireSubscription()
  @Patch('shifts/:id')
  async updateShift(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: ShiftDto) {
    this.requireManager(scope);
    ensureValidShiftWindow(body.dayIndex, body.startMinutes, body.endMinutes);
    const shift = await this.assignments.updateShift({
      venueId: scope!.venueId,
      shiftId: id,
      dayIndex: body.dayIndex,
      startMinutes: body.startMinutes,
      endMinutes: body.endMinutes,
      jobTitle: body.jobTitle,
      station: body.station,
      notes: body.notes,
    });
    if (shift.profileId) {
      void this.sendScheduleUpdateEmail(shift.profileId, 'Edited', {
        dayIndex: shift.dayIndex,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        station: shift.station,
      }, {
        dayIndex: body.dayIndex,
        startMinutes: body.startMinutes,
        endMinutes: body.endMinutes,
        station: body.station,
      });
    }
    return { ok: true };
  }

  @RequireSubscription()
  @Patch('shifts/:id/assign')
  async assignShift(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: AssignShiftDto) {
    this.requireManager(scope);
    const { shift, nextProfileId } = await this.assignments.assignShift({
      venueId: scope!.venueId,
      shiftId: id,
      profileId: body.profileId,
    });
    if (nextProfileId && shift.profileId !== nextProfileId) {
      void this.sendScheduleUpdateEmail(nextProfileId, 'Added', undefined, {
        dayIndex: shift.dayIndex,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        station: shift.station,
      });
    }
    if (!nextProfileId && shift.profileId) {
      void this.sendScheduleUpdateEmail(shift.profileId, 'Removed', {
        dayIndex: shift.dayIndex,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        station: shift.station,
      }, undefined);
    }
    if (nextProfileId && shift.profileId && shift.profileId !== nextProfileId) {
      void this.sendScheduleUpdateEmail(shift.profileId, 'Removed', {
        dayIndex: shift.dayIndex,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        station: shift.station,
      }, undefined);
    }
    return { ok: true };
  }

  @RequireSubscription()
  @Delete('shifts/:id')
  async deleteShift(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    const shift = await this.assignments.deleteShift({
      venueId: scope!.venueId,
      shiftId: id,
    });
    if (shift.profileId) {
      void this.sendScheduleUpdateEmail(shift.profileId, 'Removed', {
        dayIndex: shift.dayIndex,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        station: shift.station,
      }, undefined);
    }
    return {
      dayIndex: shift.dayIndex,
      startMinutes: shift.startMinutes,
      endMinutes: shift.endMinutes,
      jobTitle: shift.jobTitle,
      station: shift.station,
      status: shift.status,
      profileId: shift.profileId,
      notes: shift.notes,
    };
  }

  @RequireSubscription()
  @Get('me')
  async getMySchedule(@VenueScope() scope: Scope) {
    if (!scope) return { mine: [], open: [], roster: [] };
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId }, select: { timezone: true } });
    const weekStart = weekStartFor(todayInZone(venue?.timezone ?? null));
    const shifts = await this.prisma.scheduleShift.findMany({
      where: { venueId: scope.venueId, weekStart },
      include: { profile: true },
      orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
    });
    const unavailableByProfile = this.unavailableByProfile(
      await this.unavailableRequests(scope.venueId, weekStart),
      weekStart,
    );
    const mine = shifts.filter((shift) => shift.profileId === scope.profileId);
    const open = shifts.filter((shift) => shift.status === 'open' && !shift.profileId);
    const roster = [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => ({
      dayIndex,
      dayLabel: dayLabel(dayIndex),
      coworkers: shifts
        .filter((shift) => shift.dayIndex === dayIndex && shift.profileId && shift.profileId !== scope.profileId)
        .map((shift) => ({
          shiftId: shift.id,
          profileId: shift.profileId,
          name: shift.profile?.fullName ?? 'Teammate',
          memberName: shift.profile?.fullName ?? 'Teammate',
          jobTitle: shift.jobTitle,
          station: shift.station,
          dayIndex: shift.dayIndex,
          startMinutes: shift.startMinutes,
          endMinutes: shift.endMinutes,
          startTime: minutesToTime(shift.startMinutes),
          endTime: minutesToTime(shift.endMinutes),
          withMe: mine.some((myShift) =>
            myShift.dayIndex === shift.dayIndex &&
            myShift.startMinutes < shift.endMinutes &&
            myShift.endMinutes > shift.startMinutes,
          ),
        })),
    }));
    return {
      mine: mine.map((shift) => this.mapEmployeeShift(shift, true, !availabilityCovers(unavailableByProfile.get(scope.profileId), shift))),
      open: open.map((shift) => this.mapEmployeeShift(shift, false, false)),
      roster,
    };
  }

  @RequireSubscription()
  @Post('shifts/:id/claim')
  async claimOpenShift(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope) throw new ForbiddenException('Profile does not belong to a venue');
    const shift = await this.assignments.claimOpenShift({
      venueId: scope.venueId,
      profileId: scope.profileId,
      shiftId: id,
    });
    await this.notifications.notifyManagers({
      venueId: scope.venueId,
      kind: 'shift_assigned',
      title: 'Open shift covered',
      body: `${scope.fullName} picked up ${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)}.`,
    });
    void this.email.sendToVenueManagers(scope.venueId, {
      subject: 'Open shift covered',
      text: `${scope.fullName} picked up ${this.shiftLabel(shift)}.\n\n${shift.jobTitle} at ${shift.station}`,
    });
    return { ok: true };
  }

  @RequireSubscription()
  @Post('publish')
  async publishSchedule(@VenueScope() scope: Scope, @Body() body: WeekDto) {
    this.requireManager(scope);
    const selectedWeekStart = await this.resolveAvailabilityWeekStart(scope!.venueId, body.weekStart);
    const shifts = await this.prisma.scheduleShift.findMany({ where: { venueId: scope!.venueId, weekStart: selectedWeekStart } });
    const assigned = shifts.filter((shift) => shift.profileId).length;
    const open = shifts.filter((shift) => shift.status === 'open').length;
    await this.prisma.venue.update({
      where: { id: scope!.venueId },
      data: {
        schedulePublishedAt: new Date(),
        schedulePublishedById: scope!.profileId,
        scheduleUpdatedAfterPublishAt: null,
      },
    });
    await this.notifications.notifyStaff({
      venueId: scope!.venueId,
      kind: 'schedule_published',
      title: 'Schedule posted',
      body: `${assigned} shift${assigned === 1 ? '' : 's'} scheduled${open > 0 ? `, ${open} open to pick up` : ''}.`,
    });
    const venue = await this.prisma.venue.findUnique({
      where: { id: scope!.venueId },
      select: { timezone: true, name: true },
    });
    const tz = venue?.timezone ?? null;
    const sunday = selectedWeekStart;
    const saturday = addDays(sunday, 6);

    const formatDateMD = (dateStr: string) => {
      const [y, m, d] = dateStr.split('-');
      return `${m}/${d}`;
    };

    const formatDateMDY = (dateStr: string) => {
      const [y, m, d] = dateStr.split('-');
      return `${m}/${d}/${y}`;
    };
    const weekLabel = `${formatDateMD(sunday)} - ${formatDateMD(saturday)}`;
    const periodLabel = `${formatDateMDY(sunday)} - ${formatDateMDY(saturday)}`;

    const totalShifts = shifts.length;
    const staffScheduled = new Set(shifts.map((s) => s.profileId).filter(Boolean)).size;
    const openShifts = shifts.filter((s) => s.status === 'open').length;
    const pendingApprovals = await this.prisma.shiftSwap.count({
      where: { venueId: scope!.venueId, status: { in: ['proposed', 'accepted'] } },
    });

    // Email 1: Send to the publishing manager
    void this.email.sendToProfile(scope!.profileId, {
      subject: `Schedule Published - Your Team's Shifts Are Live`,
      text:
        `Hi ${scope!.fullName},\n\n` +
        `Your schedule for Week of ${weekLabel} has been successfully published. Your team has been notified and can view their shifts immediately in the Venue Wrangler app.\n\n` +
        `What Happens Next\n` +
        `Staff are notified via push notification the moment a schedule is published\n` +
        `Shifts are visible to each employee as soon as they open the app\n` +
        `Approved unavailable-day conflicts, if any, are flagged in your dashboard for review\n\n` +
        `Schedule Summary\n` +
        `Detail\tInfo\n` +
        `Schedule Period\t${periodLabel}\n` +
        `Total Shifts\t${totalShifts}\n` +
        `Staff Scheduled\t${staffScheduled}\n` +
        `Open Shifts\t${openShifts}\n` +
        `Pending Approvals\t${pendingApprovals}\n\n` +
        `Making Updates After Publishing\n` +
        `Edit a shift - Select the shift and tap Edit. Changes push to the employee instantly.\n` +
        `Add a shift - Tap an open slot and assign a team member or post as an open shift.\n` +
        `Remove a shift - Select the shift and tap Delete. The employee is notified automatically.\n` +
        `Handle swap requests - Swap requests appear in your Requests & Approvals queue.\n\n` +
        `Pro Tips\n` +
        `Publish schedules at least 72 hours in advance\n` +
        `Use open shifts to fill gaps without manual assignment\n` +
        `Check the Operations Dashboard for a real-time view of who's clocked in\n\n` +
        `Questions? support@venuewrangler.com\n\n` +
        `Let's wrangle.\n\n` +
        `- The Venue Wrangler Team`,
    });

    // Email 2: Send to all assigned staff members
    const assignedProfiles = await this.prisma.profile.findMany({
      where: {
        venueId: scope!.venueId,
        id: { in: shifts.map((s) => s.profileId).filter(Boolean) as string[] },
      },
    });

    for (const staff of assignedProfiles) {
      const staffShifts = shifts.filter((s) => s.profileId === staff.id);
      const shiftRows = staffShifts
        .map((s) => {
          const dayName = dayLabel(s.dayIndex);
          const dateMD = formatDateMD(addDays(sunday, s.dayIndex));
          const startTime = minutesToTime(s.startMinutes);
          const endTime = minutesToTime(s.endMinutes);
          const area = s.station || 'Floor';
          return `${dayName}\t${dateMD}\t${startTime}\t${endTime}\t${area}`;
        })
        .join('\n');

      void this.email.sendToProfile(staff.id, {
        subject: `Your Schedule Is Live for Week of ${weekLabel}`,
        text:
          `Hi ${staff.fullName},\n\n` +
          `Your manager just published the schedule for Week of ${weekLabel}. Your shifts are ready to view now in the Venue Wrangler app.\n\n` +
          `Your Upcoming Shifts\n` +
          `Day\tDate\tStart\tEnd\tLocation/Section\n` +
          `${shiftRows}\n\n` +
          `Log in to the app to see your full schedule.\n\n` +
          `Need to Make a Change?\n` +
          `Request time off - Submit a request and your manager is notified right away\n` +
          `Swap a shift - Request a swap and it goes to your manager for approval\n` +
          `Pick up an open shift - Check the Open Shifts board for extra hours\n\n` +
          `Reminders\n` +
          `Clock in using the app when your shift starts\n` +
          `You'll always be notified if your schedule changes\n` +
          `Reach out to your manager through the app for any conflicts\n\n` +
          `Questions? support@venuewrangler.com\n\n` +
          `See you on the floor.\n\n` +
          `- The Venue Wrangler Team`,
      });
    }
    return { notified: assigned };
  }

  @RequireSubscription()
  @Patch('labor-budget')
  async setLaborBudget(@VenueScope() scope: Scope, @Body() body: LaborBudgetDto) {
    this.requireManager(scope);
    if (body.weeklyLaborBudgetHours !== undefined && body.weeklyLaborBudgetHours < 0) {
      throw new BadRequestException('Weekly labor budget cannot be negative.');
    }
    await this.prisma.venue.update({
      where: { id: scope!.venueId },
      data: { weeklyLaborBudgetHours: body.weeklyLaborBudgetHours ?? null },
    });
    return { ok: true };
  }

  @RequireSubscription()
  @Get('templates')
  async listScheduleTemplates(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const rows = await this.prisma.scheduleTemplate.findMany({
      where: { venueId: scope!.venueId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      _id: row.id,
      name: row.name,
      shiftCount: Array.isArray(row.shifts) ? row.shifts.length : 0,
      createdAt: row.createdAt.getTime(),
    }));
  }

  @RequireSubscription()
  @Post('templates')
  async saveScheduleTemplate(@VenueScope() scope: Scope, @Body() body: TemplateDto) {
    this.requireManager(scope);
    const name = body.name.trim();
    if (!name) throw new BadRequestException('Enter a template name');
    const weekStart = await this.resolveAvailabilityWeekStart(scope!.venueId, body.weekStart);
    const shifts = await this.prisma.scheduleShift.findMany({ where: { venueId: scope!.venueId, weekStart } });
    if (shifts.length === 0) throw new BadRequestException('Create at least one shift before saving a template.');
    const row = await this.prisma.scheduleTemplate.create({
      data: {
        venueId: scope!.venueId,
        name,
        shifts: shifts.map((shift) => ({
          dayIndex: shift.dayIndex,
          startMinutes: shift.startMinutes,
          endMinutes: shift.endMinutes,
          jobTitle: shift.jobTitle,
          station: shift.station,
          notes: shift.notes,
        })) as Prisma.InputJsonValue,
      },
    });
    return row.id;
  }

  @RequireSubscription()
  @Post('templates/:id/apply')
  async applyScheduleTemplate(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: ApplyTemplateDto) {
    this.requireManager(scope);
    const template = await this.prisma.scheduleTemplate.findFirst({ where: { id, venueId: scope!.venueId } });
    if (!template) throw new NotFoundException('Template not found');
    const slots = this.parseTemplateSlots(template.shifts);
    if (slots.length === 0) throw new BadRequestException('This template has no shifts to apply.');
    return this.assignments.applyTemplate({
      venueId: scope!.venueId,
      weekStart: await this.resolveAvailabilityWeekStart(scope!.venueId, body.weekStart),
      replace: body.replace,
      slots,
    });
  }

  @RequireSubscription()
  @Delete('templates/:id')
  async deleteScheduleTemplate(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    const template = await this.prisma.scheduleTemplate.findFirst({ where: { id, venueId: scope!.venueId } });
    if (!template) throw new NotFoundException('Template not found');
    await this.prisma.scheduleTemplate.delete({ where: { id: template.id } });
    return { ok: true };
  }

  @RequireSubscription()
  @Post('copy-day')
  async copyDayShifts(@VenueScope() scope: Scope, @Body() body: CopyDayDto) {
    this.requireManager(scope);
    if (!Number.isInteger(body.fromDay) || body.fromDay < 0 || body.fromDay > 6) {
      throw new BadRequestException('fromDay must be between 0 and 6.');
    }
    if (
      !Array.isArray(body.toDays) ||
      body.toDays.length === 0 ||
      body.toDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    ) {
      throw new BadRequestException('toDays must contain days between 0 and 6.');
    }
    return this.assignments.copyDayShifts({
      venueId: scope!.venueId,
      weekStart: await this.resolveAvailabilityWeekStart(scope!.venueId, body.weekStart),
      fromDay: body.fromDay,
      toDays: [...new Set(body.toDays)],
    });
  }

  @RequireSubscription()
  @Post('clear-week')
  async clearWeek(@VenueScope() scope: Scope, @Body() body: WeekDto) {
    this.requireManager(scope);
    return this.assignments.clearWeek({
      venueId: scope!.venueId,
      weekStart: await this.resolveAvailabilityWeekStart(scope!.venueId, body.weekStart),
    });
  }

  @RequireSubscription()
  @Post('restore-shifts')
  async restoreShifts(@VenueScope() scope: Scope, @Body() body: RestoreShiftsDto) {
    this.requireManager(scope);
    for (const shift of body.shifts) {
      ensureValidShiftWindow(shift.dayIndex, shift.startMinutes, shift.endMinutes);
    }
    return this.assignments.restoreShifts({
      venueId: scope!.venueId,
      weekStart: await this.resolveAvailabilityWeekStart(scope!.venueId, body.weekStart),
      shifts: body.shifts,
    });
  }

  @RequireSubscription()
  @Get('auto-schedule/preview')
  async previewAutoSchedule(@VenueScope() scope: Scope, @Query('weekStartDate') weekStartDate?: string) {
    this.requireManager(scope);
    const availabilityWeekStart = await this.resolveAvailabilityWeekStart(scope!.venueId, weekStartDate);
    const [shifts, staff, requests] = await Promise.all([
      this.prisma.scheduleShift.findMany({
        where: { venueId: scope!.venueId, weekStart: availabilityWeekStart },
        include: { profile: true },
        orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
      }),
      this.prisma.profile.findMany({
        where: { venueId: scope!.venueId, OR: ACTIVE_MEMBERSHIP },
        orderBy: { fullName: 'asc' },
      }),
      this.unavailableRequests(scope!.venueId, availabilityWeekStart),
    ]);
    const availabilityByProfile = this.unavailableByProfile(requests, availabilityWeekStart);
    const openShifts = shifts.filter((shift) => shift.status === 'open' && !shift.profileId);
    const assignments = new Map<string, number>();
    const proposals = openShifts.map((shift) => {
      let sawRoleMatch = false;
      let sawAvailable = false;
      let sawFree = false;
      const candidate = staff.find((member) => {
        const assignedMinutes = assignments.get(member.id) ?? 0;
        const roleMatch =
          member.jobTitle.toLowerCase().includes(shift.jobTitle.toLowerCase()) ||
          shift.jobTitle.toLowerCase().includes(member.jobTitle.toLowerCase()) ||
          member.role === 'staff' ||
          member.role === 'server';
        if (!roleMatch) return false;
        sawRoleMatch = true;
        const hasAvailability = availabilityCovers(availabilityByProfile.get(member.id), shift);
        if (!hasAvailability) return false;
        sawAvailable = true;
        const overlaps = shifts.some((other) =>
          other.profileId === member.id &&
          other.dayIndex === shift.dayIndex &&
          other.startMinutes < shift.endMinutes &&
          other.endMinutes > shift.startMinutes,
        );
        if (overlaps) return false;
        sawFree = true;
        return assignedMinutes < 40 * 60;
      });
      if (candidate) assignments.set(candidate.id, (assignments.get(candidate.id) ?? 0) + Math.max(0, shift.endMinutes - shift.startMinutes));
      return {
        shiftId: shift.id,
        dayLabel: dayLabel(shift.dayIndex),
        startTime: minutesToTime(shift.startMinutes),
        endTime: minutesToTime(shift.endMinutes),
        jobTitle: shift.jobTitle,
        profileId: candidate?.id ?? null,
        reason: candidate ? 'assigned' : !sawRoleMatch ? 'no_role_match' : !sawAvailable ? 'no_availability' : !sawFree ? 'all_double_booked' : 'labor_cap',
      };
    });
    const filled = proposals.filter((proposal) => proposal.profileId).length;
    return {
      openCount: openShifts.length,
      filled,
      unfilled: openShifts.length - filled,
      weekStart: availabilityWeekStart,
      proposals,
    };
  }

  @RequireSubscription()
  @Post('auto-schedule/apply')
  async applyAutoSchedule(@VenueScope() scope: Scope, @Body() body: ApplyAutoScheduleDto) {
    this.requireManager(scope);
    const availabilityWeekStart = await this.resolveAvailabilityWeekStart(scope!.venueId, body.weekStartDate);
    const availabilityByProfile = this.unavailableByProfile(await this.unavailableRequests(scope!.venueId, availabilityWeekStart), availabilityWeekStart);
    const { assigned, skipped, assignedShifts } = await this.assignments.applyOpenAssignments({
      venueId: scope!.venueId,
      assignments: body.assignments,
      canAssign: ({ shift, profileId }) =>
        availabilityCovers(availabilityByProfile.get(profileId), shift),
    });
    const assignedByProfile = new Map<string, typeof assignedShifts>();
    for (const assignedShift of assignedShifts) {
      const profileAssignments = assignedByProfile.get(assignedShift.profileId) ?? [];
      profileAssignments.push(assignedShift);
      assignedByProfile.set(assignedShift.profileId, profileAssignments);
    }
    const assignedProfiles = assignedByProfile.size
      ? await this.prisma.profile.findMany({
          where: { id: { in: Array.from(assignedByProfile.keys()) } },
          select: { id: true, email: true },
        })
      : [];
    for (const profile of assignedProfiles) {
      const profileAssignments = assignedByProfile.get(profile.id) ?? [];
      void this.email.send({
        to: profile.email,
        subject: profileAssignments.length === 1 ? 'New shift assigned' : 'New shifts assigned',
        text: `You were assigned ${profileAssignments.length === 1 ? 'a new shift' : 'new shifts'}:\n\n${profileAssignments
          .map((shift) => `${this.shiftLabel(shift)}\n${shift.jobTitle} at ${shift.station}`)
          .join('\n\n')}`,
      });
    }
    return { assigned, skipped };
  }

  // AI schedule builder: generates NEW shift proposals from demand (covers,
  // private events) and the labor budget, distinct from auto-schedule/*
  // above which only assigns staff to shifts that already exist.
  @RequireSubscription()
  @Get('ai-schedule/preview')
  async previewAiSchedule(@VenueScope() scope: Scope, @Query('weekStartDate') weekStartDate?: string) {
    this.requireManager(scope);
    const venueId = scope!.venueId;
    await assertWithinSharedRateLimit(
      this.prisma,
      `ai-parse:ai-schedule:${venueId}`,
      AI_SCHEDULE_RATE_LIMIT_MAX,
      AI_SCHEDULE_RATE_LIMIT_WINDOW_MS,
      'Too many AI schedule requests. Try again in a few minutes.',
    );
    const availabilityWeekStart = await this.resolveAvailabilityWeekStart(venueId, weekStartDate);
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: { timezone: true, weeklyLaborBudgetHours: true } });
    const timezone = venue?.timezone ?? null;
    const weekStartDayUtc = new Date(zonedDateBounds(timezone, availabilityWeekStart).start);
    const nextWeekStart = addDays(availabilityWeekStart, 7);
    const weekEndDayUtc = new Date(zonedDateBounds(timezone, nextWeekStart).start);

    const [shifts, staff, unavailableRequests, reservations, venueEvents, memoryNotes] = await Promise.all([
      this.prisma.scheduleShift.findMany({ where: { venueId, weekStart: availabilityWeekStart } }),
      this.prisma.profile.findMany({
        where: { venueId, OR: ACTIVE_MEMBERSHIP },
        orderBy: { fullName: 'asc' },
      }),
      this.unavailableRequests(venueId, availabilityWeekStart),
      this.prisma.reservation.findMany({
        where: {
          venueId,
          deletedAt: null,
          reservationTime: { gte: weekStartDayUtc, lt: weekEndDayUtc },
          status: { notIn: ['cancelled', 'no_show'] },
        },
        select: { reservationTime: true, partySize: true, isPrivateEvent: true },
      }),
      this.prisma.venueEvent.findMany({
        where: { venueId, startsAt: { gte: weekStartDayUtc, lt: weekEndDayUtc } },
        select: { startsAt: true, expectedGuests: true },
      }),
      this.prisma.scheduleMemoryNote.findMany({
        where: { venueId },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    const laborForecast = buildLaborForecast({
      tz: venue?.timezone ?? null,
      now: weekStartDayUtc,
      shifts: shifts.map((s) => ({ dayIndex: s.dayIndex, startMinutes: s.startMinutes, endMinutes: s.endMinutes, profileId: s.profileId })),
      reservations: reservations.map((r) => ({ ts: r.reservationTime.getTime(), partySize: r.partySize, isPrivateEvent: Boolean(r.isPrivateEvent) })),
      events: venueEvents.map((e) => ({ ts: e.startsAt.getTime(), expectedGuests: e.expectedGuests })),
      nameById: new Map(staff.map((p) => [p.id, p.fullName])),
    });

    const draft = await this.aiScheduler.generateDraft({
      weekStart: availabilityWeekStart,
      laborForecast,
      laborBudgetHours: venue?.weeklyLaborBudgetHours ?? null,
      staff: staff.map((p) => ({ id: p.id, fullName: p.fullName, jobTitle: p.jobTitle, role: p.role })),
      availabilityByProfile: this.unavailableByProfile(unavailableRequests, availabilityWeekStart),
      existingShifts: shifts.map((s) => ({ dayIndex: s.dayIndex, startMinutes: s.startMinutes, endMinutes: s.endMinutes, jobTitle: s.jobTitle, profileId: s.profileId })),
      memoryNotes: memoryNotes.map((note) => ({ weekStart: note.weekStart, title: note.title, detail: note.detail })),
    });

    const nameById = new Map(staff.map((p) => [p.id, p.fullName]));
    return {
      weekStart: availabilityWeekStart,
      shifts: draft.shifts.map((shift) => ({
        ...shift,
        dayLabel: dayLabel(shift.dayIndex),
        startTime: minutesToTime(shift.startMinutes),
        endTime: minutesToTime(shift.endMinutes),
        memberName: shift.profileId ? nameById.get(shift.profileId) ?? null : null,
      })),
    };
  }

  @RequireSubscription()
  @Post('ai-schedule/commit')
  async commitAiSchedule(@VenueScope() scope: Scope, @Body() body: CommitAiScheduleDto) {
    this.requireManager(scope);
    const venueId = scope!.venueId;
    // Re-check availability server-side rather than trusting the AI's
    // proposed assignment — mirrors auto-schedule/apply's canAssign guard.
    const availabilityWeekStart = await this.resolveAvailabilityWeekStart(venueId, body.weekStartDate);
    const availabilityByProfile = this.unavailableByProfile(await this.unavailableRequests(venueId, availabilityWeekStart), availabilityWeekStart);

    let created = 0;
    const failed: Array<{ shift: string; error: string }> = [];
    const staff = await this.prisma.profile.findMany({
      where: { venueId, deletedAt: null, OR: ACTIVE_MEMBERSHIP },
      select: { id: true, fullName: true },
    });
    const nameById = new Map(staff.map((p) => [p.id, p.fullName]));
    for (const shift of body.shifts) {
      try {
        ensureValidShiftWindow(shift.dayIndex, shift.startMinutes, shift.endMinutes);
        const proposedProfileId = shift.profileId || undefined;
        if (proposedProfileId && !availabilityCovers(availabilityByProfile.get(proposedProfileId), shift)) {
          failed.push({
            shift: this.shiftLabel(shift),
            error: `${nameById.get(proposedProfileId) ?? 'Staff member'} is unavailable for this shift.`,
          });
          continue;
        }
        await this.assignments.createShift({
          venueId,
          weekStart: availabilityWeekStart,
          profileId: proposedProfileId,
          dayIndex: shift.dayIndex,
          startMinutes: shift.startMinutes,
          endMinutes: shift.endMinutes,
          jobTitle: shift.jobTitle,
          station: shift.station,
          notes: 'Created by AI schedule builder',
        });
        created += 1;
      } catch (error) {
        failed.push({ shift: this.shiftLabel(shift), error: error instanceof Error ? error.message : 'Could not create shift' });
      }
    }
    return { created, failed };
  }

  @RequireSubscription()
  @Post('swaps')
  async proposeShiftSwap(@VenueScope() scope: Scope, @Body() body: ProposeSwapDto) {
    if (!scope) throw new ForbiddenException('Profile does not belong to a venue');
    const { swap, requesterShift, target } = await this.assignments.proposeSwap({
      venueId: scope.venueId,
      requesterProfileId: scope.profileId,
      requesterShiftId: body.myShiftId,
      targetProfileId: body.targetProfileId,
      targetShiftId: body.targetShiftId,
      note: body.note,
    });
    await this.notifications.notifyProfile({
      venueId: scope.venueId,
      profileId: target.id,
      kind: 'swap_proposed',
      title: 'Shift swap proposed',
      body: `${scope.fullName} wants to swap ${this.shiftLabel(requesterShift)}.`,
    });
    void this.email.sendToProfile(target.id, {
      subject: 'Shift swap proposed',
      text: `${scope.fullName} wants to swap ${this.shiftLabel(requesterShift)}.${body.note?.trim() ? `\n\nNote: ${body.note.trim()}` : ''}`,
    });
    return swap.id;
  }

  @RequireSubscription()
  @Patch('swaps/:id/respond')
  async respondToShiftSwap(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: RespondSwapDto) {
    if (!scope) throw new ForbiddenException('Profile does not belong to a venue');
    const swap = await this.assignments.respondToSwap({
      venueId: scope.venueId,
      swapId: id,
      profileId: scope.profileId,
      accept: body.accept,
    });
    if (body.accept) {
      await this.notifications.notifyManagers({
        venueId: scope.venueId,
        kind: 'swap_proposed',
        title: 'Swap needs approval',
        body: `${scope.fullName} accepted a shift swap. Approve it in the schedule.`,
      });
      void this.sendManagerSwapApprovalEmail(scope.venueId, swap.id);
    }
    return { ok: true };
  }

  @RequireSubscription()
  @Patch('swaps/:id/review')
  async reviewShiftSwap(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: ReviewSwapDto) {
    this.requireManager(scope);
    const swap = await this.assignments.reviewSwap({
      venueId: scope!.venueId,
      swapId: id,
      approve: body.approve,
    });
    await this.notifications.notifyProfile({
      venueId: scope!.venueId,
      profileId: swap.requesterProfileId,
      kind: 'swap_reviewed',
      title: `Swap ${body.approve ? 'approved' : 'denied'}`,
      body: `Your shift swap was ${body.approve ? 'approved' : 'denied'}.`,
    });
    void this.sendStaffSwapReviewedEmail(scope!.venueId, swap.id, body.approve);
    await this.notifications.notifyProfile({
      venueId: scope!.venueId,
      profileId: swap.targetProfileId,
      kind: 'swap_reviewed',
      title: `Swap ${body.approve ? 'approved' : 'denied'}`,
      body: `A shift swap was ${body.approve ? 'approved' : 'denied'}.`,
    });
    return { ok: true };
  }

  @RequireSubscription()
  @Get('swaps/me')
  async getMyShiftSwaps(@VenueScope() scope: Scope) {
    if (!scope) return [];
    const swaps = await this.prisma.shiftSwap.findMany({
      where: {
        venueId: scope.venueId,
        OR: [{ requesterProfileId: scope.profileId }, { targetProfileId: scope.profileId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return this.mapSwaps(scope.venueId, swaps, scope.profileId);
  }

  @RequireSubscription()
  @Get('swaps')
  async listShiftSwaps(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const swaps = await this.prisma.shiftSwap.findMany({
      where: { venueId: scope!.venueId, status: { in: ['proposed', 'accepted'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return this.mapSwaps(scope!.venueId, swaps, null);
  }

  private requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
    if (!scope || !canManageVenue(scope.role, scope.allAccess)) throw new ForbiddenException('Not authorized');
  }

  private resolveAvailabilityWeekStart(venueId: string, weekStartDate?: string) {
    if (weekStartDate) {
      if (!isIsoDate(weekStartDate)) throw new BadRequestException('weekStartDate must be a YYYY-MM-DD date');
      return Promise.resolve(weekStartFor(weekStartDate));
    }
    return this.prisma.venue.findUnique({ where: { id: venueId }, select: { timezone: true } })
      .then((venue) => weekStartFor(todayInZone(venue?.timezone ?? null)));
  }

  private async unavailableRequests(venueId: string, weekStart: string) {
    const weekEnd = this.dateForWeekDay(weekStart, 6);
    return this.prisma.staffRequest.findMany({
      where: {
        venueId, status: 'approved', kind: { in: ['time_off', 'sick_leave'] },
        OR: [
          { requestedRangeStart: { lte: weekEnd }, requestedRangeEnd: { gte: weekStart } },
          { requestedForDate: { gte: weekStart, lte: weekEnd } },
        ],
      },
      select: { profileId: true, requestedForDate: true, requestedRangeStart: true, requestedRangeEnd: true },
    });
  }

  private unavailableByProfile(requests: Array<{ profileId: string; requestedForDate: string | null; requestedRangeStart: string | null; requestedRangeEnd: string | null }>, weekStart: string) {
    const byProfile = new Map<string, AvailabilityWindow[]>();
    for (const request of requests) {
      const start = request.requestedRangeStart ?? request.requestedForDate;
      const end = request.requestedRangeEnd ?? request.requestedForDate ?? start;
      if (!start || !end) continue;
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const date = this.dateForWeekDay(weekStart, dayIndex);
        if (date < start || date > end) continue;
        const rows = byProfile.get(request.profileId) ?? [];
        rows.push({ dayIndex, startMinutes: 0, endMinutes: 1440, available: false });
        byProfile.set(request.profileId, rows);
      }
    }
    return byProfile;
  }

  private dateForWeekDay(weekStart: string, dayIndex: number) {
    const date = new Date(`${weekStart}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + dayIndex);
    return date.toISOString().slice(0, 10);
  }

  private mapManagerShift(shift: ShiftWithProfile, conflict = false) {
    return {
      _id: shift.id,
      dayIndex: shift.dayIndex,
      dayLabel: dayLabel(shift.dayIndex),
      startMinutes: shift.startMinutes,
      endMinutes: shift.endMinutes,
      startTime: minutesToTime(shift.startMinutes),
      endTime: minutesToTime(shift.endMinutes),
      jobTitle: shift.jobTitle,
      station: shift.station,
      notes: shift.notes,
      status: shift.status,
      profileId: shift.profileId,
      memberName: shift.profileId ? shift.profile?.fullName ?? null : null,
      conflict,
    };
  }

  private mapEmployeeShift(shift: ShiftWithProfile, mine: boolean, conflict = false) {
    return {
      _id: shift.id,
      dayIndex: shift.dayIndex,
      dayLabel: dayLabel(shift.dayIndex),
      startMinutes: shift.startMinutes,
      endMinutes: shift.endMinutes,
      startTime: minutesToTime(shift.startMinutes),
      endTime: minutesToTime(shift.endMinutes),
      memberId: shift.profileId,
      memberName: shift.profile?.fullName ?? null,
      jobTitle: shift.jobTitle,
      station: shift.station,
      status: shift.status,
      notes: shift.notes ?? undefined,
      mine,
      conflict,
    };
  }

  private parseTemplateSlots(value: Prisma.JsonValue): TemplateShiftSlot[] {
    if (!Array.isArray(value)) return [];
    return value.map((slot) => {
      const parsed = plainToInstance(TemplateShiftDto, slot);
      const errors = validateSync(parsed, { whitelist: true, forbidNonWhitelisted: true });
      if (errors.length > 0) {
        throw new BadRequestException('Template contains an invalid shift.');
      }
      ensureValidShiftWindow(parsed.dayIndex, parsed.startMinutes, parsed.endMinutes);
      return parsed as TemplateShiftSlot;
    });
  }

  private shiftLabel(shift: { dayIndex: number; startMinutes: number; endMinutes: number }) {
    return `${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)}`;
  }

  private async mapSwaps(venueId: string, swaps: Array<{ id: string; status: string; note: string | null; requesterProfileId: string; targetProfileId: string; requesterShiftId: string; targetShiftId: string | null; createdAt: Date }>, meId: string | null) {
    const [staff, shifts] = await Promise.all([
      this.prisma.profile.findMany({ where: { venueId, OR: ACTIVE_MEMBERSHIP } }),
      this.prisma.scheduleShift.findMany({ where: { venueId } }),
    ]);
    const nameById = new Map(staff.map((member) => [member.id, member.fullName]));
    const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
    return swaps
      .filter((swap) => SWAP_STATUSES.includes(swap.status))
      .map((swap) => ({
        _id: swap.id,
        status: swap.status,
        note: swap.note,
        requesterName: nameById.get(swap.requesterProfileId) ?? 'Teammate',
        targetName: nameById.get(swap.targetProfileId) ?? 'Teammate',
        requesterShift: this.shiftLabel(shiftById.get(swap.requesterShiftId) ?? { dayIndex: 0, startMinutes: 0, endMinutes: 0 }),
        targetShift: swap.targetShiftId && shiftById.get(swap.targetShiftId) ? this.shiftLabel(shiftById.get(swap.targetShiftId)!) : null,
        direction: meId === swap.targetProfileId ? 'incoming' : meId === swap.requesterProfileId ? 'outgoing' : 'other',
        createdAt: swap.createdAt.getTime(),
      }));
  }
  private sendScheduleUpdateEmail(
    profileId: string,
    changeType: 'Added' | 'Edited' | 'Removed',
    before?: { dayIndex: number; startMinutes: number; endMinutes: number; station: string },
    after?: { dayIndex: number; startMinutes: number; endMinutes: number; station: string },
  ) {
    void this.sendScheduleUpdateEmailInBackground(profileId, changeType, before, after).catch((error) => {
      this.logBackgroundFailure('schedule update email', error);
    });
  }

  private async sendScheduleUpdateEmailInBackground(
    profileId: string,
    changeType: 'Added' | 'Edited' | 'Removed',
    before?: { dayIndex: number; startMinutes: number; endMinutes: number; station: string },
    after?: { dayIndex: number; startMinutes: number; endMinutes: number; station: string },
  ) {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) return;

    const venue = await this.prisma.venue.findUnique({
      where: { id: profile.venueId! },
      select: { timezone: true },
    });
    const tz = venue?.timezone ?? null;
    const today = todayInZone(tz);
    const sunday = weekStartFor(today);

    const formatDateMDY = (dayIdx: number) => {
      const dateStr = addDays(sunday, dayIdx);
      const [y, m, d] = dateStr.split('-');
      return `${m}/${d}/${y}`;
    };

    const formatTime = (minutes: number) => minutesToTime(minutes);
    const beforeDate = before ? formatDateMDY(before.dayIndex) : '-';
    const beforeTime = before ? `${formatTime(before.startMinutes)} - ${formatTime(before.endMinutes)}` : '-';
    const beforeArea = before ? (before.station || 'Floor') : '-';
    const afterDate = after ? formatDateMDY(after.dayIndex) : '-';
    const afterTime = after ? `${formatTime(after.startMinutes)} - ${formatTime(after.endMinutes)}` : '-';
    const afterArea = after ? (after.station || 'Floor') : '-';

    void this.email.sendToProfile(profileId, {
      subject: 'Schedule Update - A Change Has Been Made to Your Shift',
      text:
        `Hi ${profile.fullName},\n\n` +
        `Your manager has made an update to your schedule. Please review the change below.\n\n` +
        `What Changed\n` +
        `Detail\tBefore\tAfter\n` +
        `Date\t${beforeDate}\t${afterDate}\n` +
        `Shift Time\t${beforeTime}\t${afterTime}\n` +
        `Location/Section\t${beforeArea}\t${afterArea}\n` +
        `Change Type\t-\t${changeType}\n\n` +
        `What to Do\n` +
        `No action required unless you have a conflict\n` +
        `Reach out to your manager through the app to discuss the change\n` +
        `Submit a swap or time-off request if needed\n\n` +
        `Questions? support@venuewrangler.com\n\n` +
        `- The Venue Wrangler Team`,
    });
  }

  private sendManagerSwapApprovalEmail(venueId: string, swapId: string) {
    void this.sendManagerSwapApprovalEmailInBackground(venueId, swapId).catch((error) => {
      this.logBackgroundFailure('manager swap approval email', error);
    });
  }

  private async sendManagerSwapApprovalEmailInBackground(venueId: string, swapId: string) {
    const swap = await this.prisma.shiftSwap.findUnique({ where: { id: swapId } });
    if (!swap) return;

    const [requester, target, reqShift, tarShift] = await Promise.all([
      this.prisma.profile.findUnique({ where: { id: swap.requesterProfileId } }),
      this.prisma.profile.findUnique({ where: { id: swap.targetProfileId } }),
      this.prisma.scheduleShift.findUnique({ where: { id: swap.requesterShiftId } }),
      swap.targetShiftId ? this.prisma.scheduleShift.findUnique({ where: { id: swap.targetShiftId } }) : Promise.resolve(null),
    ]);

    if (!requester || !target || !reqShift) return;

    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { timezone: true, name: true },
    });
    const tz = venue?.timezone ?? null;
    const today = todayInZone(tz);
    const sunday = weekStartFor(today);

    const formatDateMDY = (dayIdx: number) => {
      const dateStr = addDays(sunday, dayIdx);
      const [y, m, d] = dateStr.split('-');
      return `${m}/${d}/${y}`;
    };

    const formatTime = (minutes: number) => minutesToTime(minutes);

    const reqDate = formatDateMDY(reqShift.dayIndex);
    const reqTime = `${formatTime(reqShift.startMinutes)} - ${formatTime(reqShift.endMinutes)}`;
    const tarDate = tarShift ? formatDateMDY(tarShift.dayIndex) : '-';
    const tarTime = tarShift ? `${formatTime(tarShift.startMinutes)} - ${formatTime(tarShift.endMinutes)}` : '-';

    // Format submitted timestamp (createdAt)
    const submittedStr = swap.createdAt.toLocaleString('en-US', {
      timeZone: tz || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    // Send to all managers at the venue
    const managers = await this.prisma.profile.findMany({
      where: {
        venueId,
        role: { in: ['admin', 'owner', 'manager'] },
      },
    });

    for (const manager of managers) {
      void this.email.send({
        to: manager.email,
        subject: 'Shift Swap Request - Action Required',
        text:
          `Hi ${manager.fullName},\n\n` +
          `${requester.fullName} has submitted a shift swap request. Please review and take action in the Venue Wrangler app.\n\n` +
          `Swap Request Details\n` +
          `Detail\tRequestor\tSwap Partner\n` +
          `Employee\t${requester.fullName}\t${target.fullName}\n` +
          `Date\t${reqDate}\t${tarDate}\n` +
          `Shift Time\t${reqTime}\t${tarTime}\n` +
          `Submitted\t${submittedStr}\t-\n\n` +
          `How to Respond\n` +
          `1. Open the Venue Wrangler app\n` +
          `2. Go to Requests & Approvals\n` +
          `3. Select the swap request\n` +
          `4. Tap Approve or Deny - both employees are notified instantly\n\n` +
          `Pending requests can also be managed from your Operations Dashboard.\n\n` +
          `Questions? support@venuewrangler.com\n\n` +
          `- The Venue Wrangler Team`,
      });
    }
  }

  private sendStaffSwapReviewedEmail(venueId: string, swapId: string, approve: boolean) {
    void this.sendStaffSwapReviewedEmailInBackground(venueId, swapId, approve).catch((error) => {
      this.logBackgroundFailure('staff swap review email', error);
    });
  }

  private async sendStaffSwapReviewedEmailInBackground(venueId: string, swapId: string, approve: boolean) {
    const swap = await this.prisma.shiftSwap.findUnique({ where: { id: swapId } });
    if (!swap) return;

    const [requester, target, reqShift, tarShift] = await Promise.all([
      this.prisma.profile.findUnique({ where: { id: swap.requesterProfileId } }),
      this.prisma.profile.findUnique({ where: { id: swap.targetProfileId } }),
      this.prisma.scheduleShift.findUnique({ where: { id: swap.requesterShiftId } }),
      swap.targetShiftId ? this.prisma.scheduleShift.findUnique({ where: { id: swap.targetShiftId } }) : Promise.resolve(null),
    ]);

    if (!requester || !target || !reqShift) return;

    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { timezone: true },
    });
    const tz = venue?.timezone ?? null;
    const today = todayInZone(tz);
    const sunday = weekStartFor(today);

    const formatDateMDY = (dayIdx: number) => {
      const dateStr = addDays(sunday, dayIdx);
      const [y, m, d] = dateStr.split('-');
      return `${m}/${d}/${y}`;
    };

    const formatTime = (minutes: number) => minutesToTime(minutes);

    const reqDate = formatDateMDY(reqShift.dayIndex);
    const reqTime = `${formatTime(reqShift.startMinutes)} - ${formatTime(reqShift.endMinutes)}`;
    const tarDate = tarShift ? formatDateMDY(tarShift.dayIndex) : '-';
    const tarTime = tarShift ? `${formatTime(tarShift.startMinutes)} - ${formatTime(tarShift.endMinutes)}` : '-';

    const statusText = approve ? 'Approved' : 'Denied';

    const sendEmail = (recipient: typeof requester, coworker: typeof target, isRequester: boolean) => {
      void this.email.send({
        to: recipient.email,
        subject: `Your Shift Swap Request Has Been ${statusText}`,
        text:
          `Hi ${recipient.fullName},\n\n` +
          `Your shift swap request has been ${statusText} by your manager. Here are the details:\n\n` +
          `Swap Details\n` +
          `Detail\tYour Shift\tCoworker's Shift\n` +
          `Employee\t${recipient.fullName}\t${coworker.fullName}\n` +
          `Date\t${isRequester ? reqDate : tarDate}\t${isRequester ? tarDate : reqDate}\n` +
          `Shift Time\t${isRequester ? reqTime : tarTime}\t${isRequester ? tarTime : reqTime}\n` +
          `Status\t${statusText}\t${statusText}\n\n` +
          (approve
            ? `If Approved\n` +
              `Your schedule has been updated automatically\n` +
              `Both you and your coworker will see the updated shifts in the app\n` +
              `Make sure to clock in for your new shift on time\n\n`
            : `If Denied\n` +
              `Your original shift remains on your schedule\n` +
              `Reach out to your manager through the app if you have questions or need further assistance\n\n`) +
          `Questions? support@venuewrangler.com\n\n` +
          `- The Venue Wrangler Team`,
      });
    };

    // Send to both employees
    sendEmail(requester, target, true);
    sendEmail(target, requester, false);
  }

  private logBackgroundFailure(label: string, error: unknown) {
    this.logger.error(
      `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}
