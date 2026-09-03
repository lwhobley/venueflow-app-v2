import { BadRequestException, Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { canManageVenue, isAdminRole } from '../../../auth/roles';
import { RequireSubscription } from '../../../billing/require-subscription.decorator';
import { aiBudgetWarningPercent, monthlyAiBudgetUsd } from '../../../common/ai-json-parse';
import { zonedIsoDate } from '../../../common/venue-time';
import { NotificationsService } from '../../../notifications/notifications.service';
import { VenueScope } from '../../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../../venue/venue-scope.interceptor';
import { PrismaService } from '../../../prisma/prisma.service';
import { WranglerHistoryService } from './wrangler-history.service';
import { WranglerService } from './wrangler.service';

type Scope = VenueScopedRequest['venueScope'];
class ExecuteWranglerActionDto { @IsString() @IsIn(['REASSIGN_RESERVATION', 'NOTIFY_STAFF', 'CREATE_FOLLOW_UP']) type!: 'REASSIGN_RESERVATION' | 'NOTIFY_STAFF' | 'CREATE_FOLLOW_UP'; @IsOptional() @IsString() reservationId?: string; @IsOptional() @IsString() tableId?: string; @IsOptional() @IsString() priorityId?: string; }
class AskWranglerDto { @IsString() @MinLength(2) @MaxLength(500) question!: string; }

@Controller('v1/operations/wrangler')
export class WranglerController {
  constructor(private readonly prisma: PrismaService, private readonly wrangler: WranglerService, private readonly notifications: NotificationsService, private readonly history: WranglerHistoryService) {}

  @RequireSubscription('active') @Get()
  async getWrangler(@VenueScope() scope: Scope) {
    if (!scope) return null;
    if (!canManageVenue(scope.role, scope.allAccess)) throw new ForbiddenException('Manager access required to view Wrangler');
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId }, select: { id: true, name: true, timezone: true } });
    if (!venue) return null;
    const snapshot = await this.wrangler.getSnapshot(venue.id, venue.timezone);
    const historicalPatterns = await this.history.getPatterns({ venueId: venue.id, timezone: venue.timezone, nowMs: snapshot.generatedAt, todayCovers: snapshot.summary.covers, todayReservations: snapshot.summary.reservations });
    return { venue: { _id: venue.id, name: venue.name }, ...snapshot, patterns: [...snapshot.patterns, ...historicalPatterns].slice(0, 6) };
  }

  @RequireSubscription('active') @Get('ai-usage')
  async getAiUsage(@VenueScope() scope: Scope) {
    if (!scope) return null;
    if (!isAdminRole(scope.role)) throw new ForbiddenException('Manager access required to view AI usage');
    const rows = await this.prisma.$queryRaw<Array<{ feature: string; model: string; requests: bigint; promptTokens: bigint; completionTokens: bigint; cachedTokens: bigint; totalTokens: bigint; estimatedCostMicros: bigint }>>`
      SELECT "feature", "model", COUNT(*)::bigint AS requests, COALESCE(SUM("promptTokens"),0)::bigint AS "promptTokens", COALESCE(SUM("completionTokens"),0)::bigint AS "completionTokens", COALESCE(SUM("cachedTokens"),0)::bigint AS "cachedTokens", COALESCE(SUM("totalTokens"),0)::bigint AS "totalTokens", COALESCE(SUM("estimatedCostMicros"),0)::bigint AS "estimatedCostMicros" FROM "AiUsageEvent" WHERE "venueId" = ${scope.venueId} AND "createdAt" >= date_trunc('month', NOW()) GROUP BY "feature", "model" ORDER BY "estimatedCostMicros" DESC
    `;
    const breakdown = rows.map((row) => ({ feature: row.feature, model: row.model, requests: Number(row.requests), promptTokens: Number(row.promptTokens), completionTokens: Number(row.completionTokens), totalTokens: Number(row.totalTokens), estimatedCostUsd: Number(row.estimatedCostMicros) / 1_000_000 }));
    const requests = breakdown.reduce((sum, row) => sum + row.requests, 0);
    const promptTokens = rows.reduce((sum, row) => sum + Number(row.promptTokens), 0);
    const completionTokens = rows.reduce((sum, row) => sum + Number(row.completionTokens), 0);
    const cachedTokens = rows.reduce((sum, row) => sum + Number(row.cachedTokens), 0);
    const totalTokens = breakdown.reduce((sum, row) => sum + row.totalTokens, 0);
    const estimatedCostUsd = breakdown.reduce((sum, row) => sum + row.estimatedCostUsd, 0);
    const budgetUsd = monthlyAiBudgetUsd();
    const warningPercent = aiBudgetWarningPercent();
    const percentUsed = budgetUsd > 0 ? Math.round((estimatedCostUsd / budgetUsd) * 1000) / 10 : 0;
    const status = budgetUsd <= 0 ? 'unlimited' : estimatedCostUsd >= budgetUsd ? 'over_budget' : percentUsed >= warningPercent ? 'warning' : 'healthy';
    return {
      month: new Date().toISOString().slice(0, 7),
      requests,
      promptTokens,
      completionTokens,
      cachedTokens,
      totalTokens,
      estimatedCostUsd,
      budget: { budgetUsd, warningPercent, percentUsed, remainingUsd: budgetUsd > 0 ? Math.max(0, budgetUsd - estimatedCostUsd) : null, status },
      breakdown,
    };
  }

  @RequireSubscription('active') @Post('ask')
  async askWrangler(@VenueScope() scope: Scope, @Body() body: AskWranglerDto) { if (!scope) return null; if (!canManageVenue(scope.role, scope.allAccess)) throw new ForbiddenException('Manager access required to ask Wrangler'); const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId }, select: { timezone: true } }); if (!venue) return null; return this.wrangler.ask(scope.venueId, venue.timezone, body.question); }

  @RequireSubscription('active') @Post('actions')
  async executeAction(@VenueScope() scope: Scope, @Body() body: ExecuteWranglerActionDto) {
    if (!scope) return null;
    if (!isAdminRole(scope.role)) throw new ForbiddenException('Manager access required to execute Wrangler actions');
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId }, select: { timezone: true } });
    if (!venue) throw new BadRequestException('Venue not found');
    if (body.type === 'NOTIFY_STAFF') { const snapshot = await this.wrangler.getSnapshot(scope.venueId, venue.timezone); if (snapshot.summary.openShifts <= 0) throw new BadRequestException('No open shifts currently need coverage'); const count = snapshot.summary.openShifts; await this.notifications.notifyStaff({ venueId: scope.venueId, kind: 'wrangler_coverage', title: 'Open shifts need coverage', body: `${count} open shift${count === 1 ? '' : 's'} still need coverage. Check Venue Wrangler for available shifts.` }); return { ok: true, type: body.type, notified: 'staff', openShifts: count }; }
    if (body.type === 'CREATE_FOLLOW_UP') {
      if (!body.priorityId) throw new BadRequestException('priorityId is required');
      const snapshot = await this.wrangler.getSnapshot(scope.venueId, venue.timezone); const priority = snapshot.priorities.find((item) => item.id === body.priorityId); if (!priority || priority.kind === 'steady') throw new BadRequestException('Wrangler priority is no longer active');
      const targetDate = zonedIsoDate(venue.timezone, Date.now()); const title = `Wrangler: ${priority.title}`; const existing = await this.prisma.managerGoal.findFirst({ where: { venueId: scope.venueId, title, targetDate, status: 'open' }, select: { id: true, title: true } }); if (existing) return { ok: true, type: body.type, followUpId: existing.id, title: existing.title, existing: true };
      const created = await this.prisma.managerGoal.create({ data: { venueId: scope.venueId, title, details: `${priority.reason} Recommended move: ${priority.cta}.`, period: 'day', targetDate, status: 'open', createdBy: scope.profileId }, select: { id: true, title: true } });
      await this.prisma.auditLog.create({ data: { venueId: scope.venueId, actorProfileId: scope.profileId, actorName: scope.fullName, actorRole: scope.role, entityType: 'manager_goal', entityId: created.id, action: 'wrangler_follow_up_created', summary: `Created follow-up from Wrangler priority: ${priority.title}` } });
      return { ok: true, type: body.type, followUpId: created.id, title: created.title, existing: false };
    }
    return this.wrangler.executeAction(scope.venueId, { type: body.type, reservationId: body.reservationId, tableId: body.tableId });
  }
}
