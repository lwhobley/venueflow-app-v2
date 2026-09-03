import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma, CrmLeadStatus, BeoStatus, ContractStatus, ReservationSource, ReservationStatus } from '@prisma/client';
import { canManageVenue } from '../../auth/roles';
import { ACTIVE_MEMBERSHIP } from '../../common/membership';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { SkipTenantTransaction } from '../../prisma/skip-tenant-transaction.decorator';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { randomUUID } from 'crypto';
import { CrmTemplateService } from './crm-template.service';
import { ExecutionAutopilotService } from '../operations/execution-autopilot.service';

type Scope = VenueScopedRequest['venueScope'];

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiating', 'won', 'lost', 'unqualified', 'on_hold'] as const;
const BEO_STATUSES = ['draft', 'sent', 'reviewed', 'confirmed', 'amended', 'cancelled'] as const;
const CONTRACT_STATUSES = ['draft', 'sent', 'viewed', 'partially_signed', 'fully_signed', 'expired', 'cancelled', 'disputed'] as const;
const BEO_EMAIL_MANAGER_LIMIT_MAX = 20;
const BEO_EMAIL_MANAGER_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const BEO_EMAIL_VENUE_LIMIT_MAX = 100;
const BEO_EMAIL_VENUE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

class SaveLeadDto {
  @IsString()
  @IsOptional()
  leadId?: string;

  @IsString()
  fullName!: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsString()
  @IsIn(LEAD_STATUSES)
  @IsOptional()
  status?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  assignedToId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  estimatedValueCents?: number;
}

class AddNoteDto {
  @IsString()
  text!: string;
}

class SaveBeoDto {
  @IsString()
  @IsOptional()
  beoId?: string;

  @IsString()
  @IsOptional()
  leadId?: string;

  @IsString()
  eventName!: string;

  @IsNumber()
  @IsOptional()
  eventDate?: number;

  @IsString()
  @IsOptional()
  eventType?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  guestCount?: number;

  @IsString()
  @IsOptional()
  venueSpace?: string;

  @IsString()
  @IsOptional()
  setupStyle?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  fbMinimumCents?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  depositCents?: number;

  @IsNumber()
  @IsOptional()
  depositDueDate?: number;

  @IsString()
  @IsOptional()
  menuAppetizers?: string;

  @IsString()
  @IsOptional()
  menuEntrees?: string;

  @IsString()
  @IsOptional()
  menuDesserts?: string;

  @IsString()
  @IsOptional()
  menuBarPackage?: string;

  @IsString()
  @IsOptional()
  specialRequirements?: string;

  @IsString()
  @IsOptional()
  internalNotes?: string;

  @IsString()
  @IsOptional()
  assignedRepId?: string;

  @IsString()
  @IsIn(BEO_STATUSES)
  @IsOptional()
  status?: string;
}

class SaveContractDto {
  @IsString()
  @IsOptional()
  contractId?: string;

  @IsString()
  @IsOptional()
  leadId?: string;

  @IsString()
  @IsOptional()
  beoId?: string;

  @IsString()
  @IsOptional()
  eventName?: string;

  @IsNumber()
  @IsOptional()
  eventDate?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  guestCount?: number;

  @IsString()
  @IsOptional()
  venueSpace?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  fbMinimumCents?: number;

  @IsString()
  @IsOptional()
  cancellationPolicy?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  customClauses?: string[];

  @IsString()
  @IsOptional()
  clientSignatureName?: string;

  @IsString()
  @IsIn(CONTRACT_STATUSES)
  @IsOptional()
  status?: string;
}

class CrmListQueryDto {
  @IsString()
  @IsOptional()
  search?: string;

  @Type(() => Number)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsOptional()
  limit?: number;
}

function requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
  if (!scope || !canManageVenue(scope.role, scope.allAccess)) throw new ForbiddenException('Not authorized');
}

function toMs(date: Date | null | undefined): number | null {
  return date ? date.getTime() : null;
}

function makeContractNumber(): string {
  // Use a UUID-derived suffix for collision resistance. The previous
  // Date.now() approach could collide within the same millisecond.
  const uuid = randomUUID().replace(/-/g, '');
  return `C-${uuid.slice(0, 9).toUpperCase()}`;
}

// Weighted probabilities used for the pipeline forecast. Tuned to industry
// norms - early stages discount more, won is realized revenue.
const STAGE_PROBABILITY: Record<string, number> = {
  new: 0.05,
  contacted: 0.15,
  qualified: 0.3,
  proposal_sent: 0.5,
  negotiating: 0.7,
  won: 1.0,
  lost: 0,
  unqualified: 0,
  on_hold: 0.1,
};

// Stages we expect to move within a reasonable window. Won/lost/unqualified
// are terminal; on_hold is intentionally parked.
const ACTIVE_STAGES: CrmLeadStatus[] = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiating'];

class EmailBeoDto {
  @IsEmail({}, { message: 'toEmail must be a valid email address' })
  toEmail!: string;

  @IsString()
  @IsOptional()
  message?: string;
}

class SaveTemplateDto {
  @IsString()
  @IsOptional()
  templateId?: string;

  @IsString()
  name!: string;

  @IsString()
  subject!: string;

  @IsString()
  body!: string;

  @IsString()
  @IsOptional()
  variables?: string;
}

class RenderTemplateDto {
  @IsString()
  @IsOptional()
  leadId?: string;

  @IsString()
  @IsOptional()
  beoId?: string;
}


function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEventDate(date: Date | null): string {
  return date
    ? date.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'TBD';
}

function formatMoneyCents(cents: number | null | undefined): string {
  return cents != null ? `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'TBD';
}

type BeoRenderInput = {
  eventName: string;
  eventDate: Date | null;
  eventType: string | null;
  guestCount: number | null;
  venueSpace: string | null;
  setupStyle: string | null;
  fbMinimumCents: number | null;
  depositCents: number | null;
  depositDueDate: Date | null;
  menuAppetizers: string | null;
  menuEntrees: string | null;
  menuDesserts: string | null;
  menuBarPackage: string | null;
  specialRequirements: string | null;
  lead?: { fullName: string; email: string | null } | null;
};

function renderBeoText(beo: BeoRenderInput, venueName: string, message?: string): string {
  const rows: string[][] = [
    ['Event', beo.eventName],
    ['Date / Time', formatEventDate(beo.eventDate)],
    ['Guest count', String(beo.guestCount ?? 'TBD')],
    ['Space', beo.venueSpace ?? 'TBD'],
    ['Setup', beo.setupStyle ?? 'TBD'],
    ['F&B minimum', formatMoneyCents(beo.fbMinimumCents)],
    ['Deposit', formatMoneyCents(beo.depositCents)],
    ['Deposit due', beo.depositDueDate ? beo.depositDueDate.toLocaleDateString('en-US') : 'TBD'],
    ['Appetizers', beo.menuAppetizers ?? '-'],
    ['Entrees', beo.menuEntrees ?? '-'],
    ['Desserts', beo.menuDesserts ?? '-'],
    ['Bar', beo.menuBarPackage ?? '-'],
    ['Special requirements', beo.specialRequirements ?? '-'],
  ];
  const greeting = beo.lead?.fullName ? `Hi ${beo.lead.fullName.split(' ')[0]},\n\n` : '';
  const intro = message ? `${message}\n\n` : `Please review the event details below for ${venueName}.\n\n`;
  const tableHeader = `Event Details\nDetail\tInfo\n`;
  const lines = rows.map(([k, v]) => `${k}\t${v}`).join('\n');
  return `${greeting}${intro}${tableHeader}${lines}\n\nThank you,\n${venueName}\n`;
}

function renderBeoHtml(beo: BeoRenderInput, venueName: string, message?: string): string {
  const rows: Array<[string, string]> = [
    ['Event', beo.eventName],
    ['Date / Time', formatEventDate(beo.eventDate)],
    ['Guest count', String(beo.guestCount ?? 'TBD')],
    ['Space', beo.venueSpace ?? 'TBD'],
    ['Setup', beo.setupStyle ?? 'TBD'],
    ['F&B minimum', formatMoneyCents(beo.fbMinimumCents)],
    ['Deposit', formatMoneyCents(beo.depositCents)],
    ['Deposit due', beo.depositDueDate ? beo.depositDueDate.toLocaleDateString('en-US') : 'TBD'],
    ['Appetizers', beo.menuAppetizers ?? '-'],
    ['Entrees', beo.menuEntrees ?? '-'],
    ['Desserts', beo.menuDesserts ?? '-'],
    ['Bar', beo.menuBarPackage ?? '-'],
    ['Special requirements', beo.specialRequirements ?? '-'],
  ];
  const tableRows = rows
    .map(([k, v]) => `<tr><td style="padding:6px 12px;color:#6F6A5F;border-bottom:1px solid #eee;font-weight:600;">${htmlEscape(k)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;">${htmlEscape(v)}</td></tr>`)
    .join('');
  const greeting = beo.lead?.fullName ? `<p>Hi ${htmlEscape(beo.lead.fullName.split(' ')[0])},</p>` : '';
  const intro = message ? `<p>${htmlEscape(message)}</p>` : `<p>Please review the event details below for <strong>${htmlEscape(venueName)}</strong>.</p>`;
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#23241F;max-width:600px;margin:0 auto;padding:24px;">
<h2 style="color:#2F7D46;margin:0 0 16px;">${htmlEscape(venueName)} - Banquet Event Order</h2>
${greeting}
${intro}
<table style="width:100%;border-collapse:collapse;margin:16px 0;">${tableRows}</table>
<p style="color:#6F6A5F;font-size:13px;">Thank you,<br/>${htmlEscape(venueName)}</p>
</body></html>`;
}

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/crm')
export class CrmController {
  private readonly logger = new Logger(CrmController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly templates: CrmTemplateService,
    @Optional() private readonly executionAutopilot?: ExecutionAutopilotService,
  ) {}

  @RequireSubscription('active')
  @Get('leads')
  async listLeads(@VenueScope() scope: Scope, @Query() query: CrmListQueryDto) {
    requireManager(scope);
    const page = Math.max(0, Math.floor(query.page ?? 0));
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 100)), 200);
    const search = query.search?.trim();
    const where = {
      venueId: scope.venueId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { company: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search } },
              { tags: { hasSome: [search] } },
            ],
          }
        : {}),
    };

    const [leads, totalCount] = await this.prisma.$transaction([
      this.prisma.crmLead.findMany({
        where,
        orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
        skip: page * limit,
        take: limit,
      }),
      this.prisma.crmLead.count({ where }),
    ]);

    const assigneeIds = [...new Set(leads.map((l) => l.assignedToId).filter((id): id is string => Boolean(id)))];
    const assignees = assigneeIds.length
      ? await this.prisma.profile.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, fullName: true } })
      : [];
    const assigneeMap = new Map(assignees.map((a) => [a.id, a.fullName]));

    return {
      leads: leads.map((l) => ({
        _id: l.id,
        id: l.id,
        venueId: l.venueId,
        fullName: l.fullName,
        email: l.email ?? null,
        phone: l.phone ?? null,
        company: l.company ?? null,
        source: l.source ?? null,
        status: l.status,
        tags: l.tags,
        assignedToId: l.assignedToId ?? null,
        assignedToName: l.assignedToId ? (assigneeMap.get(l.assignedToId) ?? null) : null,
        estimatedValueCents: l.estimatedValueCents ?? null,
        lastActivityAt: toMs(l.lastActivityAt),
        createdAt: l.createdAt.getTime(),
        updatedAt: l.updatedAt.getTime(),
      })),
      totalCount,
      page,
      limit,
    };
  }

  @RequireSubscription('active')
  @Get('leads/:id')
  async getLead(@VenueScope() scope: Scope, @Param('id') id: string) {
    requireManager(scope);

    const lead = await this.prisma.crmLead.findFirst({
      where: { id, venueId: scope.venueId, deletedAt: null },
      include: {
        notes: { orderBy: { createdAt: 'desc' }, take: 50, include: { author: { select: { fullName: true } } } },
        beos: { orderBy: { createdAt: 'desc' }, take: 25 },
        contracts: { orderBy: { createdAt: 'desc' }, take: 25 },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    return {
      lead: {
        _id: lead.id,
        id: lead.id,
        venueId: lead.venueId,
        fullName: lead.fullName,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        company: lead.company ?? null,
        source: lead.source ?? null,
        status: lead.status,
        tags: lead.tags,
        assignedToId: lead.assignedToId ?? null,
        estimatedValueCents: lead.estimatedValueCents ?? null,
        lastActivityAt: toMs(lead.lastActivityAt),
        createdAt: lead.createdAt.getTime(),
        updatedAt: lead.updatedAt.getTime(),
      },
      notes: lead.notes.map((n) => ({
        _id: n.id,
        id: n.id,
        text: n.text,
        authorId: n.authorId ?? null,
        authorName: n.author?.fullName ?? 'Former Staff',
        createdAt: n.createdAt.getTime(),
      })),
      beos: lead.beos.map((b) => this.mapBeo(b)),
      contracts: lead.contracts.map((c) => this.mapContract(c)),
    };
  }

  @RequireSubscription('active')
  @Post('leads')
  async saveLead(@VenueScope() scope: Scope, @Body() body: SaveLeadDto) {
    requireManager(scope);
    const now = new Date();
    const assignedToId = await this.resolveVenueMemberId(scope.venueId, body.assignedToId, 'Lead assignee');

    if (body.leadId) {
      const existing = await this.prisma.crmLead.findFirst({
        where: { id: body.leadId, venueId: scope.venueId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Lead not found');

      const patch: Record<string, any> = { updatedAt: now, lastActivityAt: now };
      if (body.fullName !== undefined) patch.fullName = body.fullName;
      if (body.email !== undefined) patch.email = body.email;
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.company !== undefined) patch.company = body.company;
      if (body.source !== undefined) patch.source = body.source;
      if (body.status !== undefined) patch.status = body.status as CrmLeadStatus;
      if (body.tags !== undefined) patch.tags = body.tags;
      if (body.assignedToId !== undefined) patch.assignedToId = assignedToId;
      if (body.estimatedValueCents !== undefined) patch.estimatedValueCents = body.estimatedValueCents;

      await this.prisma.crmLead.update({ where: { id: body.leadId }, data: patch });
      // Record status changes specifically - they're the most useful timeline
      // event. Generic field edits would just be noise.
      if (body.status !== undefined && body.status !== existing.status) {
        await this.logActivity(scope.venueId, body.leadId, scope.profileId, 'status_changed', `${existing.status} -> ${body.status}`);
      }
      return { leadId: body.leadId };
    }

    const lead = await this.prisma.crmLead.create({
      data: {
        venueId: scope.venueId,
        fullName: body.fullName,
        email: body.email ?? null,
        phone: body.phone ?? null,
        company: body.company ?? null,
        source: body.source ?? null,
        status: (body.status ?? 'new') as CrmLeadStatus,
        tags: body.tags ?? [],
        assignedToId: assignedToId ?? null,
        estimatedValueCents: body.estimatedValueCents ?? null,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    await this.logActivity(scope.venueId, lead.id, scope.profileId, 'lead_created', body.source ? `Source: ${body.source}` : null);
    return { leadId: lead.id };
  }

  @RequireSubscription('active')
  @Post('leads/:id/notes')
  async addNote(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: AddNoteDto) {
    requireManager(scope);

    const lead = await this.prisma.crmLead.findFirst({
      where: { id, venueId: scope.venueId, deletedAt: null },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    const text = body.text.trim();
    if (!text) throw new BadRequestException('Note text is required');

    const now = new Date();
    const note = await this.prisma.crmNote.create({
      data: {
        venueId: scope.venueId,
        leadId: lead.id,
        authorId: scope.profileId,
        text,
      },
    });

    await this.prisma.crmLead.update({
      where: { id: lead.id },
      data: { lastActivityAt: now, updatedAt: now },
    });
    await this.logActivity(scope.venueId, lead.id, scope.profileId, 'note_added', text.slice(0, 120));
    return { noteId: note.id };
  }

  @RequireSubscription('active')
  @Get('beos')
  async listBeos(@VenueScope() scope: Scope, @Query() query: CrmListQueryDto) {
    requireManager(scope);
    const page = Math.max(0, Math.floor(query.page ?? 0));
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 100)), 200);

    const beos = await this.prisma.crmBeo.findMany({
      where: { venueId: scope.venueId },
      orderBy: { createdAt: 'desc' },
      skip: page * limit,
      take: limit,
      include: { lead: { select: { fullName: true } } },
    });

    return beos.map((b) => ({
      ...this.mapBeo(b),
      leadName: b.lead?.fullName ?? null,
    }));
  }

  @RequireSubscription('active')
  @Post('beos')
  async saveBeo(@VenueScope() scope: Scope, @Body() body: SaveBeoDto) {
    requireManager(scope);
    const now = new Date();
    const assignedRepId = await this.resolveVenueMemberId(scope.venueId, body.assignedRepId, 'Assigned representative');

    if (body.leadId) {
      const lead = await this.prisma.crmLead.findFirst({
        where: { id: body.leadId, venueId: scope.venueId, deletedAt: null },
      });
      if (!lead) throw new NotFoundException('Lead not found');
    }

    const fields = {
      leadId: body.leadId ?? null,
      eventName: body.eventName,
      eventDate: body.eventDate ? new Date(body.eventDate) : null,
      eventType: body.eventType ?? null,
      guestCount: body.guestCount ?? null,
      venueSpace: body.venueSpace ?? null,
      setupStyle: body.setupStyle ?? null,
      fbMinimumCents: body.fbMinimumCents ?? null,
      depositCents: body.depositCents ?? null,
      depositDueDate: body.depositDueDate ? new Date(body.depositDueDate) : null,
      menuAppetizers: body.menuAppetizers ?? null,
      menuEntrees: body.menuEntrees ?? null,
      menuDesserts: body.menuDesserts ?? null,
      menuBarPackage: body.menuBarPackage ?? null,
      specialRequirements: body.specialRequirements ?? null,
      internalNotes: body.internalNotes ?? null,
      assignedRepId: assignedRepId ?? null,
      updatedAt: now,
    };

    if (body.beoId) {
      const existing = await this.prisma.crmBeo.findFirst({
        where: { id: body.beoId, venueId: scope.venueId },
      });
      if (!existing) throw new NotFoundException('BEO not found');

      const patch: Record<string, any> = { ...fields };
      if (body.status !== undefined) patch.status = body.status as BeoStatus;
      // Update the BEO and sync its reservation atomically. A hold conflict
      // throws inside syncBeoToReservation, which rolls back the BEO update so
      // we never leave a confirmed BEO without its blocking reservation.
      const updated = await this.prisma.$transaction(async (tx) => {
        const u = await tx.crmBeo.update({ where: { id: body.beoId }, data: patch });
        // Sync confirmed BEOs to a reservation so private events block the
        // floor plan instead of letting another booking overlap the same space.
        // Only re-sync when the status just flipped to confirmed OR when a
        // reservation-relevant field actually changed on an already-confirmed BEO.
        const becameConfirmed = body.status === 'confirmed' && existing.status !== 'confirmed';
        const relevantFieldChanged =
          u.status === 'confirmed' &&
          (body.eventDate !== undefined ||
           body.guestCount !== undefined ||
           body.venueSpace !== undefined);
        if ((becameConfirmed || relevantFieldChanged) && u.eventDate) {
          await this.syncBeoToReservation(tx, scope.venueId, u);
        }
        if (u.status === 'confirmed' && u.eventDate) {
          await this.ensureBeoExecutionWorkspace(tx, scope.venueId, u);
        }
        return u;
      });
      if (existing.leadId && body.status !== undefined && body.status !== existing.status) {
        await this.logActivity(scope.venueId, existing.leadId, scope.profileId, 'beo_status_changed', `${existing.status} -> ${body.status}`);
      }
      return { beoId: body.beoId };
    }

    // Create the BEO and (if confirmed) its blocking reservation atomically so
    // a hold conflict can't leave an orphaned confirmed BEO behind.
    const beo = await this.prisma.$transaction(async (tx) => {
      const created = await tx.crmBeo.create({
        data: {
          ...fields,
          venueId: scope.venueId,
          status: (body.status ?? 'draft') as BeoStatus,
          createdAt: now,
        },
      });
      if (created.status === 'confirmed' && created.eventDate) {
        await this.syncBeoToReservation(tx, scope.venueId, created);
        await this.ensureBeoExecutionWorkspace(tx, scope.venueId, created);
      }
      return created;
    });

    if (body.leadId) {
      await this.prisma.crmLead.update({
        where: { id: body.leadId },
        data: { lastActivityAt: now, updatedAt: now },
      });
      await this.logActivity(scope.venueId, body.leadId, scope.profileId, 'beo_created', beo.eventName);
    }
    return { beoId: beo.id };
  }

  @RequireSubscription('active')
  @Post('beos/:id/convert')
  async convertBeoToContract(@VenueScope() scope: Scope, @Param('id') id: string) {
    requireManager(scope);

    const beo = await this.prisma.crmBeo.findFirst({
      where: { id, venueId: scope.venueId },
    });
    if (!beo) throw new NotFoundException('BEO not found');

    const now = new Date();
    const contractNumber = makeContractNumber();

    const contract = await this.prisma.crmContract.create({
      data: {
        venueId: scope.venueId,
        leadId: beo.leadId ?? null,
        beoId: beo.id,
        contractNumber,
        contractDate: now,
        eventName: beo.eventName,
        eventDate: beo.eventDate ?? null,
        guestCount: beo.guestCount ?? null,
        venueSpace: beo.venueSpace ?? null,
        fbMinimumCents: beo.fbMinimumCents ?? null,
        paymentSchedule:
          beo.depositCents
            ? [{ amountCents: beo.depositCents, dueDate: beo.depositDueDate?.getTime() ?? now.getTime(), type: 'deposit' }]
            : [],
        cancellationPolicy: null,
        forceMajeure: false,
        liabilityWaiver: false,
        customClauses: [],
        status: 'draft' as ContractStatus,
        createdAt: now,
        updatedAt: now,
      },
    });

    return { contractId: contract.id };
  }

  @RequireSubscription('active')
  @Get('contracts')
  async listContracts(@VenueScope() scope: Scope, @Query() query: CrmListQueryDto) {
    requireManager(scope);
    const page = Math.max(0, Math.floor(query.page ?? 0));
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 100)), 200);

    const contracts = await this.prisma.crmContract.findMany({
      where: { venueId: scope.venueId },
      orderBy: { createdAt: 'desc' },
      skip: page * limit,
      take: limit,
      include: { lead: { select: { fullName: true } } },
    });

    return contracts.map((c) => ({
      ...this.mapContract(c),
      leadName: c.lead?.fullName ?? null,
    }));
  }

  @RequireSubscription('active')
  @Post('contracts')
  async saveContract(@VenueScope() scope: Scope, @Body() body: SaveContractDto) {
    requireManager(scope);
    const now = new Date();

    if (body.leadId) {
      const lead = await this.prisma.crmLead.findFirst({
        where: { id: body.leadId, venueId: scope.venueId, deletedAt: null },
      });
      if (!lead) throw new NotFoundException('Lead not found');
    }

    if (body.beoId) {
      const beo = await this.prisma.crmBeo.findFirst({
        where: { id: body.beoId, venueId: scope.venueId },
      });
      if (!beo) throw new NotFoundException('BEO not found');
    }

    if (body.contractId) {
      const existing = await this.prisma.crmContract.findFirst({
        where: { id: body.contractId, venueId: scope.venueId },
      });
      if (!existing) throw new NotFoundException('Contract not found');

      const patch: Record<string, any> = { updatedAt: now };
      if (body.eventName !== undefined) patch.eventName = body.eventName;
      if (body.eventDate !== undefined) patch.eventDate = new Date(body.eventDate);
      if (body.guestCount !== undefined) patch.guestCount = body.guestCount;
      if (body.venueSpace !== undefined) patch.venueSpace = body.venueSpace;
      if (body.fbMinimumCents !== undefined) patch.fbMinimumCents = body.fbMinimumCents;
      if (body.cancellationPolicy !== undefined) patch.cancellationPolicy = body.cancellationPolicy;
      if (body.customClauses !== undefined) patch.customClauses = body.customClauses;
      if (body.clientSignatureName !== undefined) patch.clientSignatureName = body.clientSignatureName;
      if (body.status !== undefined) patch.status = body.status as ContractStatus;

      await this.prisma.crmContract.update({ where: { id: body.contractId }, data: patch });
      return { contractId: body.contractId };
    }

    const contractNumber = makeContractNumber();
    const contract = await this.prisma.crmContract.create({
      data: {
        venueId: scope.venueId,
        leadId: body.leadId ?? null,
        beoId: body.beoId ?? null,
        contractNumber,
        contractDate: now,
        eventName: body.eventName ?? null,
        eventDate: body.eventDate ? new Date(body.eventDate) : null,
        guestCount: body.guestCount ?? null,
        venueSpace: body.venueSpace ?? null,
        fbMinimumCents: body.fbMinimumCents ?? null,
        paymentSchedule: [],
        cancellationPolicy: body.cancellationPolicy ?? null,
        forceMajeure: false,
        liabilityWaiver: false,
        customClauses: body.customClauses ?? [],
        clientSignatureName: body.clientSignatureName ?? null,
        status: (body.status ?? 'draft') as ContractStatus,
        createdAt: now,
        updatedAt: now,
      },
    });

    if (body.leadId) {
      await this.prisma.crmLead.update({
        where: { id: body.leadId },
        data: { lastActivityAt: now, updatedAt: now },
      });
    }

    return { contractId: contract.id };
  }

  // ============================================================
  // Pipeline forecast - weighted by stage probability.
  // ============================================================
  @RequireSubscription('active')
  @Get('forecast')
  async getPipelineForecast(@VenueScope() scope: Scope) {
    requireManager(scope);
    // Aggregate in Postgres rather than pulling every lead row: only the
    // per-status count/sum crosses the wire, so this stays flat as the venue's
    // lead history grows instead of scaling with it on every dashboard load.
    const rows = await this.prisma.crmLead.groupBy({
      by: ['status'],
      where: { venueId: scope.venueId, deletedAt: null },
      _count: { _all: true },
      _sum: { estimatedValueCents: true },
    });

    let totalWeighted = 0;
    let totalRaw = 0;
    let wonCount = 0;
    let wonValueCents = 0;
    const byStage = rows.map((row) => {
      const stage = row.status as string;
      const count = row._count._all;
      const rawValueCents = row._sum.estimatedValueCents ?? 0;
      const probability = STAGE_PROBABILITY[stage] ?? 0;
      // Rounding once per stage (not once per lead) is equivalent here since
      // probability is constant within a stage: round(p * sum(v_i)) tracks
      // sum(round(p * v_i)) to within a cent, which is immaterial for a
      // forecast estimate.
      const weightedValueCents = Math.round(rawValueCents * probability);
      totalRaw += rawValueCents;
      totalWeighted += weightedValueCents;
      if (stage === 'won') {
        wonCount += count;
        wonValueCents += rawValueCents;
      }
      return { stage, probability, count, rawValueCents, weightedValueCents };
    });

    return {
      byStage,
      totals: {
        leadCount: byStage.reduce((sum, row) => sum + row.count, 0),
        rawValueCents: totalRaw,
        weightedValueCents: totalWeighted,
        wonCount,
        wonValueCents,
      },
    };
  }

  // ============================================================
  // Lead source ROI: counts, won-rate, and revenue by source.
  // ============================================================
  @RequireSubscription('active')
  @Get('source-roi')
  async getSourceRoi(@VenueScope() scope: Scope) {
    requireManager(scope);
    // Aggregate in Postgres rather than pulling every lead row (see
    // getPipelineForecast above for the same rationale). Grouping by
    // (source, status) keeps the win/loss counts separable per source while
    // still avoiding a per-lead round trip.
    const rows = await this.prisma.crmLead.groupBy({
      by: ['source', 'status'],
      where: { venueId: scope.venueId, deletedAt: null },
      _count: { _all: true },
      _sum: { estimatedValueCents: true },
    });
    const bySource = new Map<string, { source: string; leadCount: number; wonCount: number; lostCount: number; pipelineValueCents: number; wonValueCents: number }>();
    for (const group of rows) {
      const source = group.source ?? '(unspecified)';
      const row = bySource.get(source) ?? { source, leadCount: 0, wonCount: 0, lostCount: 0, pipelineValueCents: 0, wonValueCents: 0 };
      const count = group._count._all;
      const value = group._sum.estimatedValueCents ?? 0;
      row.leadCount += count;
      row.pipelineValueCents += value;
      if (group.status === 'won') {
        row.wonCount += count;
        row.wonValueCents += value;
      } else if (group.status === 'lost' || group.status === 'unqualified') {
        row.lostCount += count;
      }
      bySource.set(source, row);
    }
    return Array.from(bySource.values())
      .map((row) => ({
        ...row,
        winRate: row.leadCount > 0 ? row.wonCount / row.leadCount : 0,
      }))
      .sort((a, b) => b.wonValueCents - a.wonValueCents);
  }

  // ============================================================
  // Stale leads: active-stage leads with no activity for N days.
  // ============================================================
  @RequireSubscription('active')
  @Get('stale-leads')
  async getStaleLeads(@VenueScope() scope: Scope, @Query('days') daysQuery?: string) {
    requireManager(scope);
    const days = Math.max(1, Math.min(60, Number(daysQuery) || 5));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const leads = await this.prisma.crmLead.findMany({
      where: {
        venueId: scope.venueId,
        deletedAt: null,
        status: { in: ACTIVE_STAGES },
        OR: [{ lastActivityAt: { lt: cutoff } }, { lastActivityAt: null }],
      },
      orderBy: [{ lastActivityAt: 'asc' }, { createdAt: 'asc' }],
      take: 50,
    });
    return {
      thresholdDays: days,
      leads: leads.map((l) => ({
        id: l.id,
        fullName: l.fullName,
        status: l.status,
        email: l.email,
        phone: l.phone,
        lastActivityAt: toMs(l.lastActivityAt),
        estimatedValueCents: l.estimatedValueCents ?? 0,
        daysSinceActivity: Math.floor((Date.now() - (l.lastActivityAt ?? l.createdAt).getTime()) / (24 * 60 * 60 * 1000)),
      })),
    };
  }

  // ============================================================
  // Activity timeline for a lead.
  // ============================================================
  @RequireSubscription('active')
  @Get('leads/:id/activity')
  async getLeadActivity(@VenueScope() scope: Scope, @Param('id') id: string) {
    requireManager(scope);
    const lead = await this.prisma.crmLead.findFirst({
      where: { id, venueId: scope.venueId, deletedAt: null },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    const rows = await this.prisma.crmActivityLog.findMany({
      where: { venueId: scope.venueId, leadId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => Boolean(id)))];
    const actors = actorIds.length
      ? await this.prisma.profile.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } })
      : [];
    const actorMap = new Map(actors.map((a) => [a.id, a.fullName]));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      detail: row.detail,
      actorId: row.actorId,
      actorName: row.actorId ? actorMap.get(row.actorId) ?? null : null,
      createdAt: row.createdAt.getTime(),
    }));
  }

  // ============================================================
  // Email BEO to a recipient with the rendered event details.
  // ============================================================
  @RequireSubscription('active')
  // Awaits EmailService.sendOrThrow (blocking) — must not hold the request
  // transaction open for that external call. See TenantRequestTransactionInterceptor's doc.
  @SkipTenantTransaction()
  @Post('beos/:id/email')
  async emailBeo(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: EmailBeoDto) {
    requireManager(scope);
    await assertWithinSharedRateLimit(
      this.prisma,
      `crm-beo-email:manager:${scope.profileId}`,
      BEO_EMAIL_MANAGER_LIMIT_MAX,
      BEO_EMAIL_MANAGER_LIMIT_WINDOW_MS,
      'Too many BEO emails. Try again later.',
    );
    await assertWithinSharedRateLimit(
      this.prisma,
      `crm-beo-email:venue:${scope.venueId}`,
      BEO_EMAIL_VENUE_LIMIT_MAX,
      BEO_EMAIL_VENUE_LIMIT_WINDOW_MS,
      'This venue has sent too many BEO emails. Try again later.',
    );
    const [beo, venue] = await Promise.all([
      this.prisma.crmBeo.findFirst({
        where: { id, venueId: scope.venueId },
        include: { lead: { select: { fullName: true, email: true } } },
      }),
      this.prisma.venue.findUnique({ where: { id: scope.venueId }, select: { name: true } }),
    ]);
    if (!beo) throw new NotFoundException('BEO not found');
    const venueName = venue?.name ?? 'Venue';
    const subject = `${venueName} - Banquet Event Order: ${beo.eventName}`;
    const text = renderBeoText(beo, venueName, body.message);
    const html = renderBeoHtml(beo, venueName, body.message);
    await this.email.sendOrThrow({ to: body.toEmail, subject, text, html });
    if (beo.leadId) {
      await this.logActivity(scope.venueId, beo.leadId, scope.profileId, 'beo_emailed', `-> ${body.toEmail}`);
    }
    return { ok: true };
  }

  // ============================================================
  // Email templates: CRUD + render with substitution.
  // ============================================================
  @RequireSubscription('active')
  @Get('templates')
  async listTemplates(@VenueScope() scope: Scope) {
    requireManager(scope);
    const rows = await this.prisma.emailTemplate.findMany({
      where: { venueId: scope.venueId },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      subject: row.subject,
      body: row.body,
      variables: row.variables ? row.variables.split(',').map((v) => v.trim()).filter(Boolean) : [],
      updatedAt: row.updatedAt.getTime(),
    }));
  }

  @RequireSubscription('active')
  @Post('templates')
  async saveTemplate(@VenueScope() scope: Scope, @Body() body: SaveTemplateDto) {
    requireManager(scope);
    const data = {
      venueId: scope.venueId,
      name: body.name.trim(),
      subject: body.subject,
      body: body.body,
      variables: body.variables ?? null,
    };
    if (!data.name) throw new BadRequestException('Template name is required');
    if (body.templateId) {
      const existing = await this.prisma.emailTemplate.findFirst({ where: { id: body.templateId, venueId: scope.venueId } });
      if (!existing) throw new NotFoundException('Template not found');
      const updated = await this.prisma.emailTemplate.update({ where: { id: body.templateId }, data });
      return { templateId: updated.id };
    }
    const created = await this.prisma.emailTemplate.create({ data });
    return { templateId: created.id };
  }

  @RequireSubscription('active')
  @Delete('templates/:id')
  async deleteTemplate(@VenueScope() scope: Scope, @Param('id') id: string) {
    requireManager(scope);
    const existing = await this.prisma.emailTemplate.findFirst({ where: { id, venueId: scope.venueId } });
    if (!existing) throw new NotFoundException('Template not found');
    await this.prisma.emailTemplate.delete({ where: { id } });
    return { ok: true };
  }

  // Render a template's subject + body against lead/BEO context. Used by the
  // UI to preview what an email will look like before sending.
  @RequireSubscription('active')
  @Post('templates/:id/render')
  async renderTemplate(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: RenderTemplateDto) {
    requireManager(scope);
    const template = await this.prisma.emailTemplate.findFirst({ where: { id, venueId: scope.venueId } });
    if (!template) throw new NotFoundException('Template not found');
    return this.templates.renderTemplate(template, scope.venueId, body.leadId, body.beoId);
  }

  // ============================================================
  // Helpers
  // ============================================================
  private async resolveVenueMemberId(
    venueId: string,
    rawProfileId: string | undefined,
    label: string,
  ): Promise<string | null | undefined> {
    if (rawProfileId === undefined) return undefined;
    const profileId = rawProfileId.trim();
    if (!profileId) return null;
    const member = await this.prisma.profile.findFirst({
      where: { id: profileId, venueId, OR: ACTIVE_MEMBERSHIP },
      select: { id: true },
    });
    if (!member) throw new BadRequestException(`${label} must be an active member of this venue.`);
    return member.id;
  }

  private async logActivity(venueId: string, leadId: string, actorId: string | null, kind: string, detail: string | null) {
    try {
      await this.prisma.crmActivityLog.create({
        data: { venueId, leadId, actorId, kind, detail: detail ?? null },
      });
    } catch (error: any) {
      // Activity log is best-effort; never block the calling mutation.
      this.logger.warn(`CRM activity log failed for lead ${leadId}: ${error?.message ?? String(error)}`);
    }
  }

  private async ensureBeoExecutionWorkspace(db: Prisma.TransactionClient, venueId: string, beo: {
    id: string;
    eventName: string;
    eventDate: Date | null;
    setupStyle: string | null;
    venueSpace: string | null;
  }) {
    if (!this.executionAutopilot || !beo.eventDate) return;
    await this.executionAutopilot.ensureWorkspace({
      venueId,
      sourceType: 'beo',
      sourceId: beo.id,
      title: beo.eventName,
      startsAt: beo.eventDate,
      endsAt: new Date(beo.eventDate.getTime() + 4 * 60 * 60_000),
      setupStyle: beo.setupStyle ?? beo.venueSpace,
    }, db);
  }

  private async syncBeoToReservation(db: Prisma.TransactionClient, venueId: string, beo: {
    id: string;
    leadId: string | null;
    eventName: string;
    eventDate: Date | null;
    guestCount: number | null;
    venueSpace: string | null;
    setupStyle: string | null;
    menuAppetizers: string | null;
    menuEntrees: string | null;
  }) {
    if (!beo.eventDate) return;

    // Block BEO-to-reservation sync if the event window overlaps a
    // manager-imposed hold - same guard that saveReservation uses.
    const eventDurationMs = 240 * 60 * 1000; // 4 hours, same as durationMinutes below
    const eventEnd = new Date(beo.eventDate.getTime() + eventDurationMs);
    const hold = await db.reservationHold.findFirst({
      where: {
        venueId,
        startsAt: { lt: eventEnd },
        endsAt: { gt: beo.eventDate },
      },
      select: { reason: true },
    });
    if (hold) {
      throw new BadRequestException(
        `Cannot sync BEO to reservation - time conflicts with a hold: ${hold.reason}`,
      );
    }

    const lead = beo.leadId
      ? await db.crmLead.findFirst({ where: { id: beo.leadId, venueId }, select: { fullName: true, phone: true, email: true, company: true } })
      : null;
    // We tag the reservation with the BEO id so subsequent edits update the
    // same row instead of creating duplicates. Uses tags[] since there's no
    // dedicated FK column.
    const beoTag = `beo:${beo.id}`;
    const existing = await db.reservation.findFirst({
      where: { venueId, deletedAt: null, tags: { has: beoTag } },
    });
    const menuNotes = [beo.menuAppetizers, beo.menuEntrees].filter(Boolean).join(' / ') || null;
    const data = {
      venueId,
      guestName: lead?.fullName ?? beo.eventName,
      guestPhone: lead?.phone ?? null,
      guestEmail: lead?.email ?? null,
      guestCompany: lead?.company ?? null,
      partySize: beo.guestCount ?? 1,
      reservationTime: beo.eventDate,
      durationMinutes: 240,
      source: ReservationSource.direct,
      status: ReservationStatus.confirmed,
      isPrivateEvent: true,
      eventName: beo.eventName,
      eventStatus: 'confirmed',
      eventSpace: beo.venueSpace,
      setupStyle: beo.setupStyle,
      menuNotes,
      tags: [beoTag, 'private_event'],
    };
    if (existing) {
      await db.reservation.update({ where: { id: existing.id }, data });
    } else {
      await db.reservation.create({ data });
    }
  }


  private mapBeo(b: {
    id: string;
    venueId: string;
    leadId: string | null;
    eventName: string;
    eventDate: Date | null;
    eventType: string | null;
    guestCount: number | null;
    venueSpace: string | null;
    setupStyle: string | null;
    fbMinimumCents: number | null;
    depositCents: number | null;
    depositDueDate: Date | null;
    menuAppetizers: string | null;
    menuEntrees: string | null;
    menuDesserts: string | null;
    menuBarPackage: string | null;
    specialRequirements: string | null;
    internalNotes: string | null;
    assignedRepId: string | null;
    status: BeoStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      _id: b.id,
      id: b.id,
      venueId: b.venueId,
      leadId: b.leadId ?? null,
      eventName: b.eventName,
      eventDate: toMs(b.eventDate),
      eventType: b.eventType ?? null,
      guestCount: b.guestCount ?? null,
      venueSpace: b.venueSpace ?? null,
      setupStyle: b.setupStyle ?? null,
      fbMinimumCents: b.fbMinimumCents ?? null,
      depositCents: b.depositCents ?? null,
      depositDueDate: toMs(b.depositDueDate),
      menuAppetizers: b.menuAppetizers ?? null,
      menuEntrees: b.menuEntrees ?? null,
      menuDesserts: b.menuDesserts ?? null,
      menuBarPackage: b.menuBarPackage ?? null,
      specialRequirements: b.specialRequirements ?? null,
      internalNotes: b.internalNotes ?? null,
      assignedRepId: b.assignedRepId ?? null,
      status: b.status,
      createdAt: b.createdAt.getTime(),
      updatedAt: b.updatedAt.getTime(),
    };
  }

  private mapContract(c: {
    id: string;
    venueId: string;
    leadId: string | null;
    beoId: string | null;
    contractNumber: string;
    contractDate: Date | null;
    eventName: string | null;
    eventDate: Date | null;
    guestCount: number | null;
    venueSpace: string | null;
    fbMinimumCents: number | null;
    paymentSchedule: any;
    cancellationPolicy: string | null;
    forceMajeure: boolean | null;
    liabilityWaiver: boolean | null;
    customClauses: string[];
    clientSignatureName: string | null;
    clientSignatureDate: Date | null;
    status: ContractStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      _id: c.id,
      id: c.id,
      venueId: c.venueId,
      leadId: c.leadId ?? null,
      beoId: c.beoId ?? null,
      contractNumber: c.contractNumber,
      contractDate: toMs(c.contractDate),
      eventName: c.eventName ?? null,
      eventDate: toMs(c.eventDate),
      guestCount: c.guestCount ?? null,
      venueSpace: c.venueSpace ?? null,
      fbMinimumCents: c.fbMinimumCents ?? null,
      paymentSchedule: c.paymentSchedule,
      cancellationPolicy: c.cancellationPolicy ?? null,
      forceMajeure: c.forceMajeure ?? false,
      liabilityWaiver: c.liabilityWaiver ?? false,
      customClauses: c.customClauses,
      clientSignatureName: c.clientSignatureName ?? null,
      clientSignatureDate: toMs(c.clientSignatureDate),
      status: c.status,
      createdAt: c.createdAt.getTime(),
      updatedAt: c.updatedAt.getTime(),
    };
  }
}
