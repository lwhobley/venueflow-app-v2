import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { canManageVenue } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { csvCell } from '../../common/csv';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

class RecordPayrollExportDto {
  @IsString()
  provider!: string;

  @IsString()
  periodStart!: string;

  @IsString()
  periodEnd!: string;

  @IsInt()
  @IsOptional()
  rowCount?: number;

  @IsNumber()
  @IsOptional()
  totalHours?: number;
}

function parseDateParam(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(`${value}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? fallback : d;
}

function parsePeriodEndParam(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(`${value}T23:59:59.999Z`);
  return isNaN(d.getTime()) ? fallback : d;
}

async function buildPayrollRows(
  prisma: PrismaService,
  venueId: string,
  periodStart: Date,
  periodEnd: Date,
) {
  const [staff, entries] = await Promise.all([
    prisma.profile.findMany({
      where: { venueId },
      orderBy: { fullName: 'asc' },
    }),
    prisma.timeEntry.findMany({
      where: {
        venueId,
        clockInAt: { lte: periodEnd },
        clockOutAt: { not: null, gte: periodStart },
      },
      orderBy: { clockInAt: 'asc' },
    }),
  ]);

  const inPeriod = (e: (typeof entries)[number]) => {
    if (!e.clockOutAt) return false;
    const end = e.clockOutAt.getTime();
    return end >= periodStart.getTime() && e.clockInAt.getTime() <= periodEnd.getTime();
  };
  const hoursOf = (rows: typeof entries) =>
    rows.reduce((sum, e) => {
      if (!e.clockOutAt) return sum;
      const start = Math.max(e.clockInAt.getTime(), periodStart.getTime());
      const end = Math.min(e.clockOutAt.getTime(), periodEnd.getTime());
      let durationMs = Math.max(0, end - start);
      const breaks = (e.breaks as any[]) || [];
      for (const b of breaks) {
        if (b.type !== 'unpaid' || !b.startAt || !b.endAt) continue;
        const breakStart = Math.max(start, Number(b.startAt));
        const breakEnd = Math.min(end, Number(b.endAt));
        if (!Number.isFinite(breakStart) || !Number.isFinite(breakEnd)) continue;
        durationMs -= Math.max(0, breakEnd - breakStart);
      }
      return sum + Math.max(0, durationMs) / 3600000;
    }, 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Build a profileId → entries index in O(N) so each staff member lookup is O(1).
  // This replaces the previous O(N×M) entries.filter() inside staff.map().
  const entriesByProfile = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (!entry.profileId || !inPeriod(entry)) continue;
    const list = entriesByProfile.get(entry.profileId) ?? [];
    list.push(entry);
    entriesByProfile.set(entry.profileId, list);
  }

  const rows = staff.map((member) => ({
    profileId: member.id as string | null,
    employeeName: member.fullName,
    role: member.role as string,
    jobTitle: member.jobTitle,
    regularHours: round2(hoursOf(entriesByProfile.get(member.id) ?? [])),
  })).map((row) => ({
    ...row,
    totalHours: row.regularHours,
  }));

  // Wage records retained after account deletion (profileId is null) still
  // belong on payroll — group them by the snapshotted name.
  const formerByName = new Map<string, typeof entries>();
  for (const e of entries) {
    if (e.profileId !== null || !inPeriod(e)) continue;
    const name = e.profileFullName ?? 'Former staff';
    formerByName.set(name, [...(formerByName.get(name) ?? []), e]);
  }
  for (const [name, rowsForName] of formerByName) {
      rows.push({
        profileId: null,
        employeeName: name,
        role: 'staff',
        jobTitle: 'Former staff',
        regularHours: round2(hoursOf(rowsForName)),
        totalHours: round2(hoursOf(rowsForName)),
      });
    }

  return rows;
}

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/payroll')
export class PayrollController {
  constructor(private readonly prisma: PrismaService) {}

  private requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
    if (!scope || !canManageVenue(scope.role, scope.allAccess)) throw new ForbiddenException('Not authorized');
  }

  @RequireSubscription('paid')
  @Get('summary')
  async getPayrollSummary(
    @VenueScope() scope: Scope,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    this.requireManager(scope);
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const periodStart = parseDateParam(startDate, twoWeeksAgo);
    const periodEnd = parsePeriodEndParam(endDate, now);

    const rows = await buildPayrollRows(this.prisma, scope.venueId, periodStart, periodEnd);
    const totalHours = Math.round(rows.reduce((sum, r) => sum + r.totalHours, 0) * 100) / 100;

    return {
      byEmployee: rows,
      totals: {
        totalHours,
        employeeCount: rows.filter((r) => r.totalHours > 0).length,
        periodStart: periodStart.getTime(),
        periodEnd: periodEnd.getTime(),
      },
    };
  }

  @RequireSubscription('paid')
  @Get('export-csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="payroll.csv"')
  async exportPayrollCsv(
    @VenueScope() scope: Scope,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    this.requireManager(scope);
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const periodStart = parseDateParam(startDate, twoWeeksAgo);
    const periodEnd = parsePeriodEndParam(endDate, now);

    const rows = await buildPayrollRows(this.prisma, scope.venueId, periodStart, periodEnd);
    const headers = ['Employee', 'Role', 'Regular Hours', 'Total Hours', 'Start Date', 'End Date'];
    const csvRows = [headers.map(csvCell).join(',')];
    for (const row of rows) {
      csvRows.push([
        csvCell(row.employeeName),
        csvCell(row.role),
        csvCell((row as { regularHours?: number }).regularHours ?? row.totalHours),
        csvCell(row.totalHours),
        csvCell(periodStart.toISOString().slice(0, 10)),
        csvCell(periodEnd.toISOString().slice(0, 10)),
      ].join(','));
    }
    return csvRows.join('\n');
  }

  @RequireSubscription('paid')
  @Post('record-export')
  async recordPayrollExport(@VenueScope() scope: Scope, @Body() body: RecordPayrollExportDto) {
    this.requireManager(scope);
    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      throw new BadRequestException('Invalid period dates');
    }
    const record = await this.prisma.payrollExport.create({
      data: {
        venueId: scope.venueId,
        provider: body.provider,
        periodStart,
        periodEnd,
        rowCount: body.rowCount ?? 0,
        totalHours: body.totalHours ?? 0,
        createdBy: scope.profileId,
      },
    });
    return { id: record.id };
  }
}
