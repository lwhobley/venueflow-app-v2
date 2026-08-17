import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Role, TableStatus, CrmLeadStatus } from '@prisma/client';
import { canManageRole } from '../../../auth/roles';
import { callAiJson, resolveAiApiKey, resolveAiModel } from '../../../common/ai-json-parse';
import { weekStartFor } from '../../../common/pay-period';
import { syncTeamMemberCount } from '../../../common/team-sync';
import { zonedDateBounds, zonedIsoDate } from '../../../common/venue-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { runWithoutTenant } from '../../../prisma/tenant-context';

const DEFAULT_MODEL = 'gemini-flash-latest';
const ALLOWED_TOOLS = [
  'FIND_RESERVATION',
  'CREATE_RESERVATION',
  'UPDATE_RESERVATION',
  'CANCEL_RESERVATION',
  'LIST_SCHEDULE',
  'CREATE_SHIFT',
  'UPDATE_SHIFT',
  'ASSIGN_SHIFT',
  'CLEAR_TABLE',
  'UPDATE_TABLE_STATUS',
  'LIST_WAITLIST',
  'ADD_WAITLIST',
  'FIND_CRM_LEAD',
  'CREATE_CRM_LEAD',
  'UPDATE_CRM_LEAD',
  'SEARCH_CHAT',
  'POST_CHAT_ANNOUNCEMENT',
  'LIST_INVENTORY',
  'UPDATE_ITEM_86',
  'UPDATE_BAR_STOCK',
  'GET_SALES_PULSE',
  'LIST_INTEGRATIONS',
  'FIND_STAFF',
  'ADD_STAFF',
  'REMOVE_STAFF',
  'LIST_CLOCKS',
  'CORRECT_PUNCH',
] as const;

type OperatorTool = (typeof ALLOWED_TOOLS)[number];
type OperatorRisk = 'read' | 'low_risk_write' | 'operational_write' | 'sensitive_write';
type OperatorPlan = { tool: OperatorTool; args: Record<string, unknown>; summary: string; risk: OperatorRisk; preview?: string[] };
type OperatorExecutionResponse = { ok: true; tool: OperatorTool; risk: OperatorRisk; result: unknown };

type Actor = {
  profileId: string;
  fullName: string;
  role: string;
  allAccess: boolean;
};

const PROMPT = `You are the command parser for Venue Wrangler, a hospitality operations platform.
Convert the manager's natural-language command into exactly one approved tool call across all 9 venue domains (Scheduling, Reservations, Floor, CRM, Chat, Inventory, Sales, Integrations, Users).
Return STRICT JSON only: {"tool":"TOOL_NAME","args":{...},"summary":"short confirmation-friendly sentence"}.

Approved tools and argument shapes:
FIND_RESERVATION: {guestName?:string, date?:"YYYY-MM-DD"}
CREATE_RESERVATION: {guestName:string, partySize:number, reservationTime:string ISO-8601, durationMinutes?:number, notes?:string}
UPDATE_RESERVATION: {reservationId?:string, guestName?:string, date?:"YYYY-MM-DD", reservationTime?:string ISO-8601, partySize?:number, notes?:string, status?:"requested"|"confirmed"|"checked_in"|"seated"|"completed"|"no_show"|"cancelled"}
CANCEL_RESERVATION: {reservationId?:string, guestName?:string, date?:"YYYY-MM-DD"}

LIST_SCHEDULE: {date?:"YYYY-MM-DD", staffName?:string}
CREATE_SHIFT: {staffName?:string, date:"YYYY-MM-DD", startMinutes:number, endMinutes:number, jobTitle?:string, station?:string}
UPDATE_SHIFT: {shiftId?:string, staffName?:string, date?:"YYYY-MM-DD", startMinutes?:number, endMinutes?:number, jobTitle?:string, station?:string}
ASSIGN_SHIFT: {shiftId?:string, staffName:string, date?:"YYYY-MM-DD", jobTitle?:string}

CLEAR_TABLE: {tableLabel:string, status?:"available"|"dirty"|"out_of_service"}
UPDATE_TABLE_STATUS: {tableLabel:string, status:"available"|"seated"|"dirty"|"reserved"|"held"|"out_of_service"}
LIST_WAITLIST: {}
ADD_WAITLIST: {guestName:string, partySize:number, phone?:string, notes?:string}

FIND_CRM_LEAD: {name?:string, status?:string}
CREATE_CRM_LEAD: {fullName:string, email?:string, phone?:string, company?:string, notes?:string}
UPDATE_CRM_LEAD: {leadId?:string, name?:string, status?:"new"|"contacted"|"qualified"|"proposal_sent"|"negotiating"|"won"|"lost"|"unqualified"|"on_hold", notes?:string}

SEARCH_CHAT: {query?:string, channelName?:string}
POST_CHAT_ANNOUNCEMENT: {channelName?:string, text:string}

LIST_INVENTORY: {lowStockOnly?:boolean, eightySixOnly?:boolean}
UPDATE_ITEM_86: {itemName:string, isEightySix:boolean}
UPDATE_BAR_STOCK: {itemName:string, onHand:number}

GET_SALES_PULSE: {date?:"YYYY-MM-DD"}
LIST_INTEGRATIONS: {}

FIND_STAFF: {staffName?:string, jobTitle?:string}
ADD_STAFF: {fullName:string, email:string, jobTitle:string, role?:"manager"|"server"|"staff"}
REMOVE_STAFF: {staffName:string}
LIST_CLOCKS: {staffName?:string, date?:"YYYY-MM-DD"}
CORRECT_PUNCH: {staffName:string, date:"YYYY-MM-DD", clockInAt?:string ISO-8601, clockOutAt?:string ISO-8601}

Rules:
- Use current venue date supplied in context for today/tomorrow/tonight or day names.
- Convert 12-hour times to startMinutes/endMinutes from midnight (0–1440). E.g., 3pm = 900, 12am midnight = 1440.
- Return one tool only. No prose outside JSON.`;

@Injectable()
export class WranglerOperatorService {
  private readonly logger = new Logger(WranglerOperatorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async plan(input: { venueId: string; timezone?: string | null; command: string; actor: Actor }) {
    const command = input.command.trim();
    if (command.length < 2) throw new BadRequestException('Enter an operations command');
    if (!this.canManage(input.actor)) throw new ForbiddenException('Manager access required for Wrangler operator actions');

    const parsed = await this.parseCommand(command, input.timezone);
    const risk = this.riskFor(parsed.tool);

    if (risk === 'read') {
      const result = await this.executeRead(input.venueId, input.timezone, parsed.tool, parsed.args);
      return { status: 'executed' as const, tool: parsed.tool, risk, summary: parsed.summary, result };
    }

    const normalized = await this.resolveWritePlan(input.venueId, input.timezone, { ...parsed, risk });

    if (risk === 'operational_write') {
      const result = await this.executeWrite(input.venueId, input.timezone, input.actor, normalized);
      await this.writeAudit(input.venueId, input.actor, normalized, result);
      return { status: 'executed' as const, tool: normalized.tool, risk, summary: normalized.summary, result };
    }

    return {
      status: 'confirmation_required' as const,
      tool: normalized.tool,
      risk,
      summary: normalized.summary,
      preview: normalized.preview ?? [],
      plan: { tool: normalized.tool, args: normalized.args, summary: normalized.summary, risk },
    };
  }

  async execute(input: { venueId: string; timezone?: string | null; actor: Actor; plan: OperatorPlan }): Promise<OperatorExecutionResponse> {
    if (!this.canManage(input.actor)) throw new ForbiddenException('Manager access required for Wrangler operator actions');
    if (!ALLOWED_TOOLS.includes(input.plan.tool)) throw new BadRequestException('Unsupported Wrangler operator tool');
    const risk = this.riskFor(input.plan.tool);
    if (risk === 'read') {
      const result = await this.executeRead(input.venueId, input.timezone, input.plan.tool, input.plan.args);
      return { ok: true, tool: input.plan.tool, risk, result };
    }

    const normalized = await this.resolveWritePlan(input.venueId, input.timezone, { ...input.plan, risk });
    const result = await this.executeWrite(input.venueId, input.timezone, input.actor, normalized);
    await this.writeAudit(input.venueId, input.actor, normalized, result);
    return { ok: true, tool: normalized.tool, risk, result };
  }

  private async parseCommand(command: string, timezone?: string | null): Promise<{ tool: OperatorTool; args: Record<string, unknown>; summary: string }> {
    const apiKey = resolveAiApiKey();
    if (!apiKey) return this.fallbackParse(command);
    const today = zonedIsoDate(timezone, Date.now());
    const parsed = await callAiJson({
      apiKey,
      model: resolveAiModel(process.env.GEMINI_WRANGLER_OPERATOR_MODEL, DEFAULT_MODEL),
      prompt: PROMPT,
      userText: `Venue timezone: ${timezone ?? 'unknown'}\nCurrent venue date: ${today}\nCurrent server time: ${new Date().toISOString()}\nManager command: ${command}`,
      feature: 'wrangler_operator',
    });
    if (!parsed || typeof parsed !== 'object') throw new BadRequestException('Wrangler could not understand that command');
    const raw = parsed as Record<string, unknown>;
    const tool = typeof raw.tool === 'string' && ALLOWED_TOOLS.includes(raw.tool as OperatorTool) ? raw.tool as OperatorTool : null;
    if (!tool) throw new BadRequestException('Wrangler returned an unsupported operation');
    const args = raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args) ? raw.args as Record<string, unknown> : {};
    const summary = this.cleanText(raw.summary) ?? this.defaultSummary(tool);
    return { tool, args, summary };
  }

  private fallbackParse(command: string): { tool: OperatorTool; args: Record<string, unknown>; summary: string } {
    const text = command.trim();
    const lower = text.toLowerCase();

    if (lower.includes('clear table') || lower.startsWith('bus ')) {
      const target = text.replace(/^(?:clear|bus|reset|clean)\s+(?:table\b\s*)?/i, '').trim();
      const tableLabel = /^[a-z0-9_-]+$/i.test(target) ? target : undefined;
      return { tool: 'CLEAR_TABLE', args: tableLabel ? { tableLabel } : {}, summary: tableLabel ? `Clear table ${tableLabel}.` : 'Clear the requested table.' };
    }
    if (lower.includes('waitlist')) {
      if (lower.includes('add') || lower.includes('put')) {
        const match = lower.match(/(?:add|put)\s+([a-z\s]+?)\s+(?:party of\s+)?(\d+)?/i);
        return { tool: 'ADD_WAITLIST', args: { guestName: match?.[1]?.trim(), partySize: match?.[2] ? Number(match[2]) : undefined }, summary: 'Add party to waitlist.' };
      }
      return { tool: 'LIST_WAITLIST', args: {}, summary: 'Show active waitlist.' };
    }
    if (lower.includes('sales') || lower.includes('revenue') || lower.includes('pulse') || lower.includes('totals')) {
      return { tool: 'GET_SALES_PULSE', args: {}, summary: 'Show current sales pulse.' };
    }
    if (lower.includes('integration') || lower.includes('pos status') || lower.includes('connections')) {
      return { tool: 'LIST_INTEGRATIONS', args: {}, summary: 'Check integration connections.' };
    }
    if (lower.includes('crm') || lower.includes('lead')) {
      if (lower.includes('add') || lower.includes('create')) {
        const name = text.replace(/.*?(?:add|create)\s+(?:lead\s+)?/i, '').trim();
        return { tool: 'CREATE_CRM_LEAD', args: name ? { fullName: name } : {}, summary: `Create CRM lead ${name}.` };
      }
      return { tool: 'FIND_CRM_LEAD', args: {}, summary: 'Search CRM leads.' };
    }
    if (lower.includes('chat') || lower.includes('announcement') || lower.includes('broadcast')) {
      if (lower.includes('post') || lower.includes('send') || lower.includes('announce')) {
        const textMsg = text.replace(/.*?(?:announce|send|post)\s+/i, '').trim();
        return { tool: 'POST_CHAT_ANNOUNCEMENT', args: { text: textMsg }, summary: 'Post team announcement.' };
      }
      return { tool: 'SEARCH_CHAT', args: { query: text }, summary: 'Search chat messages.' };
    }
    if (lower.includes('stock') || lower.includes('inventory') || lower.includes('86')) {
      if (lower.startsWith('86 ') || lower.includes('mark 86')) {
        const item = text.replace(/.*?(?:86|mark 86)\s+/i, '').trim();
        return { tool: 'UPDATE_ITEM_86', args: { itemName: item, isEightySix: true }, summary: `86 item ${item}.` };
      }
      return { tool: 'LIST_INVENTORY', args: {}, summary: 'List inventory and 86 items.' };
    }
    if (lower.includes('add') && lower.includes('schedule')) {
      const addShiftMatch = lower.match(/(?:add|schedule|create)\s+([a-z\s]+?)\s+(?:to|on)\s+(?:the\s+)?schedule/i);
      const name = addShiftMatch ? addShiftMatch[1].trim() : '';
      return { tool: 'CREATE_SHIFT', args: name ? { staffName: name } : {}, summary: `Add shift for ${name || 'staff'}.` };
    }
    if (lower.includes('reservation') || lower.startsWith('find ')) {
      const findReservation = lower.match(/(?:find|look up|lookup|show)\s+(?:the\s+)?(?:reservation\s+(?:for\s+)?)?(.+)/i);
      return { tool: 'FIND_RESERVATION', args: { guestName: findReservation ? findReservation[1].replace(/\breservation\b/gi, '').trim() : '' }, summary: 'Find reservation.' };
    }
    if (lower.includes('clock') || lower.includes('punch')) {
      return { tool: 'LIST_CLOCKS', args: {}, summary: 'Look up clock records.' };
    }
    if (lower.includes('working') || lower.includes('schedule')) return { tool: 'LIST_SCHEDULE', args: {}, summary: 'Show schedule.' };
    if (lower.includes('staff') || lower.includes('bartender') || lower.includes('server')) return { tool: 'FIND_STAFF', args: {}, summary: 'Search staff roster.' };
    throw new BadRequestException('AI operator requires GEMINI_API_KEY for write commands and complex requests');
  }

  private riskFor(tool: OperatorTool): OperatorRisk {
    if ([
      'FIND_RESERVATION', 'LIST_SCHEDULE', 'FIND_STAFF', 'LIST_CLOCKS',
      'LIST_WAITLIST', 'FIND_CRM_LEAD', 'SEARCH_CHAT', 'LIST_INVENTORY',
      'GET_SALES_PULSE', 'LIST_INTEGRATIONS',
    ].includes(tool)) return 'read';
    
    if ([
      'ADD_STAFF', 'CREATE_SHIFT', 'CLEAR_TABLE', 'UPDATE_TABLE_STATUS',
      'ADD_WAITLIST', 'CREATE_CRM_LEAD', 'POST_CHAT_ANNOUNCEMENT',
      'UPDATE_ITEM_86', 'UPDATE_BAR_STOCK', 'CREATE_RESERVATION',
      'UPDATE_RESERVATION', 'UPDATE_SHIFT', 'ASSIGN_SHIFT',
    ].includes(tool)) return 'operational_write';

    if (['REMOVE_STAFF', 'CORRECT_PUNCH', 'CANCEL_RESERVATION', 'UPDATE_CRM_LEAD'].includes(tool)) return 'sensitive_write';
    return 'operational_write';
  }

  private async executeRead(venueId: string, timezone: string | null | undefined, tool: OperatorTool, args: Record<string, unknown>) {
    if (tool === 'FIND_RESERVATION') {
      const guestName = this.cleanText(args.guestName);
      const where: any = { venueId, deletedAt: null, ...(guestName ? { guestName: { contains: guestName, mode: 'insensitive' } } : {}) };
      const date = this.cleanText(args.date);
      if (date) { const bounds = this.dateBounds(timezone, date); where.reservationTime = { gte: bounds.start, lt: bounds.end }; }
      const rows = await this.prisma.reservation.findMany({ where, orderBy: { reservationTime: 'asc' }, take: 20 });
      return rows.map((row) => ({ id: row.id, guestName: row.guestName, partySize: row.partySize, reservationTime: row.reservationTime.getTime(), status: row.status, source: row.source, notes: row.notes ?? null }));
    }

    if (tool === 'LIST_WAITLIST') {
      const entries = await this.prisma.waitlist.findMany({
        where: { venueId, status: 'waiting' },
        orderBy: { requestedAt: 'asc' },
        take: 50,
      });
      return entries.map((entry) => ({ id: entry.id, guestName: entry.guestName, partySize: entry.partySize, requestedAt: entry.requestedAt.getTime(), phone: entry.guestPhone ?? null, notes: entry.notes ?? null }));
    }

    if (tool === 'FIND_CRM_LEAD') {
      const name = this.cleanText(args.name);
      const status = this.cleanText(args.status);
      const rows = await this.prisma.crmLead.findMany({
        where: {
          venueId, deletedAt: null,
          ...(name ? { fullName: { contains: name, mode: 'insensitive' } } : {}),
          ...(status ? { status: status as CrmLeadStatus } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      });
      return rows.map((r) => ({ id: r.id, fullName: r.fullName, email: r.email, company: r.company, status: r.status, estimatedValueCents: r.estimatedValueCents }));
    }

    if (tool === 'SEARCH_CHAT') {
      const query = this.cleanText(args.query);
      const convs = await this.prisma.conversation.findMany({
        where: { venueId },
        take: 20,
      });
      const convIds = convs.map((c) => c.id);
      const messages = await this.prisma.message.findMany({
        where: {
          conversationId: { in: convIds },
          ...(query ? { text: { contains: query, mode: 'insensitive' } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      return messages.map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt.getTime(), conversationId: m.conversationId }));
    }

    if (tool === 'LIST_INVENTORY') {
      const lowStockOnly = Boolean(args.lowStockOnly);
      const barItems = await this.prisma.barInventoryItem.findMany({
        where: { venueId },
        orderBy: { name: 'asc' },
        take: 200,
      });
      const prep86 = await this.prisma.prepBoardItem.findMany({
        where: { venueId, kind: 'eighty_six', status: 'open' },
        take: 100,
      });
      let result = barItems.map((item) => ({ id: item.id, name: item.name, category: item.category, onHand: item.onHand, parLevel: item.parLevel, isLow: item.onHand <= item.parLevel }));
      if (lowStockOnly) result = result.filter((i) => i.isLow);
      return {
        inventory: result,
        eightySixItems: prep86.map((p) => ({ id: p.id, title: p.title, station: p.station })),
      };
    }

    if (tool === 'GET_SALES_PULSE') {
      const date = this.cleanText(args.date) ?? zonedIsoDate(timezone, Date.now());
      const bounds = this.dateBounds(timezone, date);
      const checks = await this.prisma.posCheck.findMany({
        where: { venueId, openedAt: { gte: bounds.start, lt: bounds.end } },
      });
      const totalSalesCents = checks.reduce((sum, c) => sum + (c.totalCents ?? 0), 0);
      const openCount = checks.filter((c) => c.status === 'open').length;
      const paidCount = checks.filter((c) => c.status === 'paid').length;
      return { date, totalSalesCents, totalChecks: checks.length, openChecks: openCount, paidChecks: paidCount };
    }

    if (tool === 'LIST_INTEGRATIONS') {
      const pos = await this.prisma.posConnection.findMany({ where: { venueId } });
      const res = await this.prisma.reservationConnection.findMany({ where: { venueId } });
      return {
        posConnections: pos.map((p) => ({ provider: p.provider, status: p.status, lastSyncAt: p.lastSyncAt?.getTime() ?? null })),
        reservationConnections: res.map((r) => ({ provider: r.provider, status: r.status, lastSyncAt: r.lastSyncAt?.getTime() ?? null })),
      };
    }

    if (tool === 'FIND_STAFF') {
      const staffName = this.cleanText(args.staffName);
      const jobTitle = this.cleanText(args.jobTitle);
      const rows = await this.prisma.profile.findMany({
        where: { venueId, OR: [{ membershipStatus: null }, { membershipStatus: 'active' }], ...(staffName ? { fullName: { contains: staffName, mode: 'insensitive' } } : {}), ...(jobTitle ? { jobTitle: { contains: jobTitle, mode: 'insensitive' } } : {}) } as any,
        orderBy: { fullName: 'asc' }, take: 100,
      });
      return rows.map((row) => ({ id: row.id, fullName: row.fullName, email: row.email, role: row.role, jobTitle: row.jobTitle, membershipStatus: row.membershipStatus }));
    }

    if (tool === 'LIST_SCHEDULE') {
      const date = this.cleanText(args.date) ?? zonedIsoDate(timezone, Date.now());
      const weekStart = weekStartFor(date);
      const dayIndex = this.dayIndex(date);
      const staffName = this.cleanText(args.staffName);
      let profileIds: string[] | undefined;
      if (staffName) profileIds = (await this.findProfiles(venueId, staffName)).map((p) => p.id);
      const shifts = await this.prisma.scheduleShift.findMany({
        where: { venueId, weekStart, dayIndex, ...(profileIds ? { profileId: { in: profileIds } } : {}) },
        include: { profile: { select: { id: true, fullName: true } } }, orderBy: { startMinutes: 'asc' }, take: 200,
      });
      return shifts.map((shift) => ({ id: shift.id, date, startMinutes: shift.startMinutes, endMinutes: shift.endMinutes, jobTitle: shift.jobTitle, station: shift.station, status: shift.status, profileId: shift.profileId, staffName: shift.profile?.fullName ?? null }));
    }

    if (tool === 'LIST_CLOCKS') {
      const date = this.cleanText(args.date) ?? zonedIsoDate(timezone, Date.now());
      const bounds = this.dateBounds(timezone, date);
      const staffName = this.cleanText(args.staffName);
      let profileIds: string[] | undefined;
      if (staffName) profileIds = (await this.findProfiles(venueId, staffName)).map((p) => p.id);
      const rows = await this.prisma.timeEntry.findMany({
        where: { venueId, clockInAt: { gte: bounds.start, lt: bounds.end }, ...(profileIds ? { profileId: { in: profileIds } } : {}) },
        include: { profile: { select: { id: true, fullName: true } } }, orderBy: { clockInAt: 'asc' }, take: 200,
      });
      return rows.map((row) => ({ id: row.id, profileId: row.profileId, staffName: row.profile?.fullName ?? null, clockInAt: row.clockInAt.getTime(), clockOutAt: row.clockOutAt?.getTime() ?? null, isOpen: row.isOpen, breaks: row.breaks }));
    }

    throw new BadRequestException('That operation is not a read command');
  }

  private async resolveWritePlan(venueId: string, timezone: string | null | undefined, plan: OperatorPlan): Promise<OperatorPlan> {
    const args = { ...plan.args };
    const preview: string[] = [];

    if (plan.tool === 'CLEAR_TABLE' || plan.tool === 'UPDATE_TABLE_STATUS') {
      const tableLabel = this.requiredText(args.tableLabel, 'Tell Wrangler which table to update');
      const targetStatus = this.tableStatus(args.status, plan.tool === 'CLEAR_TABLE' ? 'available' : 'seated');
      const table = await this.resolveTable(venueId, tableLabel);
      args.tableId = table.id;
      args.tableLabel = table.label;
      args.status = targetStatus;
      const state = await this.prisma.tableState.findFirst({ where: { venueId, tableId: table.id } });
      preview.push(`Table ${table.label} (currently ${state?.status ?? 'unknown'})`);
      preview.push(`Set status to ${targetStatus}`);
    }

    if (plan.tool === 'ADD_WAITLIST') {
      const guestName = this.requiredText(args.guestName, 'Guest name is required');
      const partySize = this.positiveInt(args.partySize, 'partySize');
      args.guestName = guestName; args.partySize = partySize;
      args.phone = this.cleanText(args.phone); args.notes = this.cleanText(args.notes);
      preview.push(`Add ${guestName} (party of ${partySize}) to waitlist`);
    }

    if (plan.tool === 'CREATE_CRM_LEAD') {
      const fullName = this.requiredText(args.fullName, 'Lead name is required');
      args.fullName = fullName;
      args.email = this.cleanText(args.email); args.company = this.cleanText(args.company);
      preview.push(`Create CRM lead for ${fullName}`);
    }

    if (plan.tool === 'UPDATE_CRM_LEAD') {
      const name = this.cleanText(args.name);
      const leadId = this.cleanText(args.leadId);
      if (!leadId && !name) throw new BadRequestException('Lead name or leadId required');
      let target: any = null;
      if (leadId) target = await this.prisma.crmLead.findFirst({ where: { id: leadId, venueId } });
      else if (name) target = (await this.prisma.crmLead.findMany({ where: { venueId, fullName: { contains: name, mode: 'insensitive' } }, take: 1 }))[0];
      if (!target) throw new NotFoundException('CRM lead not found');
      args.leadId = target.id;
      if (args.status != null) args.status = this.crmLeadStatus(args.status);
      preview.push(`Update lead ${target.fullName} (${target.status} → ${args.status ?? target.status})`);
    }

    if (plan.tool === 'POST_CHAT_ANNOUNCEMENT') {
      const text = this.requiredText(args.text, 'Announcement text is required');
      args.text = text;
      preview.push(`Post announcement to staff chat: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
    }

    if (plan.tool === 'UPDATE_ITEM_86') {
      const itemName = this.requiredText(args.itemName, 'Item name is required');
      const isEightySix = args.isEightySix !== false;
      args.itemName = itemName; args.isEightySix = isEightySix;
      preview.push(isEightySix ? `Flag "${itemName}" as 86'd` : `Remove 86 flag from "${itemName}"`);
    }

    if (plan.tool === 'UPDATE_BAR_STOCK') {
      const itemName = this.requiredText(args.itemName, 'Item name is required');
      const onHand = Number(args.onHand);
      if (!Number.isFinite(onHand) || onHand < 0) throw new BadRequestException('onHand must be a finite non-negative number');
      args.itemName = itemName; args.onHand = onHand;
      preview.push(`Set bar inventory count for "${itemName}" to ${onHand}`);
    }

    if (plan.tool === 'CREATE_SHIFT') {
      const date = this.requiredText(args.date, 'Shift date is required (YYYY-MM-DD)');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Date must be YYYY-MM-DD');
      const startMinutes = this.minuteValue(args.startMinutes, 'startMinutes');
      const endMinutes = this.minuteValue(args.endMinutes, 'endMinutes');
      if (endMinutes <= startMinutes) throw new BadRequestException('Shift end must be after shift start');
      const staffName = this.cleanText(args.staffName);
      let profile: any = null;
      if (staffName) {
        profile = await this.resolveProfile(venueId, staffName);
        args.profileId = profile.id;
        args.staffName = profile.fullName;
      }
      args.date = date;
      args.startMinutes = startMinutes;
      args.endMinutes = endMinutes;
      args.jobTitle = this.cleanText(args.jobTitle) ?? profile?.jobTitle ?? 'Server';
      args.station = this.cleanText(args.station);
      preview.push(`Add ${args.jobTitle} shift on ${date} (${this.minutesLabel(startMinutes)}–${this.minutesLabel(endMinutes)})`);
      preview.push(profile ? `Assigned to ${profile.fullName}` : 'Shift will be created as open coverage');
    }

    if (['UPDATE_RESERVATION', 'CANCEL_RESERVATION'].includes(plan.tool)) {
      const reservation = await this.resolveReservation(venueId, timezone, args);
      args.reservationId = reservation.id;
      preview.push(`${reservation.guestName}, party of ${reservation.partySize}, currently ${reservation.reservationTime.toLocaleString()}`);
      if (plan.tool === 'UPDATE_RESERVATION') {
        const newTime = this.optionalDate(args.reservationTime, 'reservationTime');
        if (newTime) preview.push(`New reservation time: ${newTime.toLocaleString()}`);
        if (args.partySize != null) preview.push(`New party size: ${this.positiveInt(args.partySize, 'partySize')}`);
        if (this.cleanText(args.status)) preview.push(`New status: ${this.cleanText(args.status)}`);
      } else preview.push('This reservation will be cancelled, not hard-deleted.');
    }

    if (plan.tool === 'CREATE_RESERVATION') {
      const guestName = this.requiredText(args.guestName, 'Guest name is required');
      const partySize = this.positiveInt(args.partySize, 'partySize');
      const reservationTime = this.requiredDate(args.reservationTime, 'Reservation time is required');
      args.guestName = guestName; args.partySize = partySize; args.reservationTime = reservationTime.toISOString();
      preview.push(`${guestName}, party of ${partySize}`);
      preview.push(`Reservation time: ${reservationTime.toLocaleString()}`);
    }

    if (['UPDATE_SHIFT', 'ASSIGN_SHIFT'].includes(plan.tool)) {
      const shift = await this.resolveShift(venueId, timezone, args);
      args.shiftId = shift.id;
      preview.push(`${shift.jobTitle} shift ${this.minutesLabel(shift.startMinutes)}–${this.minutesLabel(shift.endMinutes)}${shift.profile?.fullName ? ` assigned to ${shift.profile.fullName}` : ' currently open'}`);
      if (plan.tool === 'UPDATE_SHIFT') {
        if (args.startMinutes != null) preview.push(`New start: ${this.minutesLabel(this.minuteValue(args.startMinutes, 'startMinutes'))}`);
        if (args.endMinutes != null) preview.push(`New end: ${this.minutesLabel(this.minuteValue(args.endMinutes, 'endMinutes'))}`);
      } else {
        const staffName = this.requiredText(args.staffName, 'Tell Wrangler which staff member should take the shift');
        const profile = await this.resolveProfile(venueId, staffName);
        args.profileId = profile.id;
        preview.push(`Assign to ${profile.fullName} (${profile.jobTitle})`);
      }
    }

    if (plan.tool === 'ADD_STAFF') {
      const fullName = this.requiredText(args.fullName, 'Full name is required');
      const email = this.requiredText(args.email, 'Email is required').toLowerCase();
      const jobTitle = this.requiredText(args.jobTitle, 'Job title is required');
      const role = this.cleanText(args.role) ?? 'staff';
      if (!['manager', 'server', 'staff'].includes(role)) throw new BadRequestException('Role must be manager, server, or staff');
      args.fullName = fullName; args.email = email; args.jobTitle = jobTitle; args.role = role;
      preview.push(`Add ${fullName} as ${jobTitle} (${role})`);
      preview.push(`Account email: ${email}`);
    }

    if (plan.tool === 'REMOVE_STAFF') {
      const staffName = this.requiredText(args.staffName, 'Tell Wrangler which staff member to remove');
      const profile = await this.resolveProfile(venueId, staffName);
      args.profileId = profile.id;
      preview.push(`Deactivate ${profile.fullName} (${profile.jobTitle})`);
      preview.push('Historical shifts, punches, and audit history will be preserved.');
    }

    if (plan.tool === 'CORRECT_PUNCH') {
      const staffName = this.requiredText(args.staffName, 'Tell Wrangler whose punch should be corrected');
      const date = this.requiredText(args.date, 'Punch correction date is required');
      const profile = await this.resolveProfile(venueId, staffName);
      const bounds = this.dateBounds(timezone, date);
      const entries = await this.prisma.timeEntry.findMany({ where: { venueId, profileId: profile.id, clockInAt: { gte: bounds.start, lt: bounds.end } }, orderBy: { clockInAt: 'asc' }, take: 5 });
      if (entries.length === 0) throw new NotFoundException(`No time entry found for ${profile.fullName} on ${date}`);
      if (entries.length > 1) throw new ConflictException(`Multiple time entries exist for ${profile.fullName} on ${date}. Open the time clock to choose the exact entry.`);
      const entry = entries[0];
      args.entryId = entry.id; args.profileId = profile.id;
      const newIn = this.optionalDate(args.clockInAt, 'clockInAt');
      const newOut = this.optionalDate(args.clockOutAt, 'clockOutAt');
      if (!newIn && !newOut) throw new BadRequestException('Provide a corrected clock-in or clock-out time');
      const finalIn = newIn ?? entry.clockInAt;
      const finalOut = newOut ?? entry.clockOutAt;
      if (finalOut && finalOut <= finalIn) throw new BadRequestException('Clock-out must be after clock-in');
      preview.push(`${profile.fullName}: ${entry.clockInAt.toLocaleString()} → ${entry.clockOutAt?.toLocaleString() ?? 'OPEN'}`);
      preview.push(`Corrected: ${finalIn.toLocaleString()} → ${finalOut?.toLocaleString() ?? 'OPEN'}`);
    }

    return { ...plan, args, preview };
  }

  private async executeWrite(venueId: string, timezone: string | null | undefined, actor: Actor, plan: OperatorPlan) {
    const args = plan.args;

    if (plan.tool === 'CLEAR_TABLE' || plan.tool === 'UPDATE_TABLE_STATUS') {
      const tableId = this.requiredText(args.tableId, 'tableId is required');
      const targetStatus = (args.status as TableStatus) ?? (plan.tool === 'CLEAR_TABLE' ? 'available' : 'seated');
      const tableState = await this.prisma.tableState.findFirst({ where: { venueId, tableId } });
      if (tableState) {
        await this.prisma.tableState.update({
          where: { id: tableState.id },
          data: {
            status: targetStatus,
            ...(targetStatus === 'available' ? { partySize: null, seatedAt: null } : {}),
            lastActivityAt: new Date(),
          },
        });
      }
      if (targetStatus === 'available') {
        await this.prisma.tableAssignment.updateMany({
          where: { venueId, tableId, releasedAt: null },
          data: { releasedAt: new Date() },
        });
      }
      return { id: tableId, label: String(args.tableLabel ?? tableId), status: targetStatus };
    }

    if (plan.tool === 'ADD_WAITLIST') {
      const guestName = String(args.guestName);
      const partySize = Number(args.partySize);
      const row = await this.prisma.waitlist.create({
        data: {
          venueId,
          guestName,
          partySize,
          source: 'wrangler_operator',
          status: 'waiting',
          requestedAt: new Date(),
          guestPhone: this.cleanText(args.phone) ?? null,
          notes: this.cleanText(args.notes) ?? null,
        },
      });
      return { id: row.id, guestName: row.guestName, partySize: row.partySize, status: row.status };
    }

    if (plan.tool === 'CREATE_CRM_LEAD') {
      const row = await this.prisma.crmLead.create({
        data: {
          venueId,
          fullName: String(args.fullName),
          email: this.cleanText(args.email) ?? null,
          phone: this.cleanText(args.phone) ?? null,
          company: this.cleanText(args.company) ?? null,
          status: 'new',
          source: 'wrangler_operator',
        },
      });
      return { id: row.id, fullName: row.fullName, status: row.status };
    }

    if (plan.tool === 'UPDATE_CRM_LEAD') {
      const id = this.requiredText(args.leadId, 'leadId is required');
      const data: any = {};
      if (args.status) data.status = String(args.status);
      const row = await this.prisma.crmLead.update({ where: { id }, data });
      if (args.notes) {
        await this.prisma.crmNote.create({
          data: { venueId, leadId: row.id, authorId: actor.profileId, text: String(args.notes) },
        });
      }
      return { id: row.id, fullName: row.fullName, status: row.status };
    }

    if (plan.tool === 'POST_CHAT_ANNOUNCEMENT') {
      const text = String(args.text);
      let conv = await this.prisma.conversation.findFirst({ where: { venueId, isSystem: true } });
      if (!conv) {
        conv = await this.prisma.conversation.create({
          data: { venueId, type: 'general', name: 'Announcements', memberIds: [actor.profileId], isSystem: true },
        });
      }
      const msg = await this.prisma.message.create({
        data: {
          conversationId: conv.id,
          venueId,
          senderId: actor.profileId,
          text: `[Announcement] ${text}`,
        },
      });
      return { id: msg.id, conversationId: conv.id, text: msg.text };
    }

    if (plan.tool === 'UPDATE_ITEM_86') {
      const itemName = String(args.itemName);
      const isEightySix = Boolean(args.isEightySix);
      if (isEightySix) {
        const row = await this.prisma.prepBoardItem.create({
          data: {
            venueId,
            kind: 'eighty_six',
            title: itemName,
            status: 'open',
            createdBy: actor.fullName,
          },
        });
        return { id: row.id, itemName, isEightySix: true };
      } else {
        await this.prisma.prepBoardItem.updateMany({
          where: { venueId, kind: 'eighty_six', title: { contains: itemName, mode: 'insensitive' } },
          data: { status: 'completed', completedBy: actor.fullName, completedAt: new Date() },
        });
        return { itemName, isEightySix: false };
      }
    }

    if (plan.tool === 'UPDATE_BAR_STOCK') {
      const itemName = String(args.itemName);
      const onHand = Number(args.onHand);
      const item = await this.prisma.barInventoryItem.findFirst({
        where: { venueId, name: { contains: itemName, mode: 'insensitive' } },
      });
      if (!item) throw new NotFoundException(`Inventory item "${itemName}" not found`);
      const row = await this.prisma.barInventoryItem.update({
        where: { id: item.id },
        data: { onHand, lastCountedAt: new Date() },
      });
      return { id: row.id, name: row.name, onHand: row.onHand, parLevel: row.parLevel };
    }

    if (plan.tool === 'CREATE_SHIFT') {
      const date = this.requiredText(args.date, 'date is required');
      const startMinutes = this.minuteValue(args.startMinutes, 'startMinutes');
      const endMinutes = this.minuteValue(args.endMinutes, 'endMinutes');
      if (endMinutes <= startMinutes) throw new BadRequestException('Shift end must be after shift start');
      const weekStart = weekStartFor(date);
      const dayIndex = this.dayIndex(date);
      const profileId = this.cleanText(args.profileId);
      if (profileId) {
        await this.assertNoShiftOverlap(venueId, profileId, weekStart, dayIndex, startMinutes, endMinutes);
      }
      const row = await this.prisma.scheduleShift.create({
        data: {
          venueId,
          weekStart,
          dayIndex,
          startMinutes,
          endMinutes,
          profileId: profileId ?? null,
          jobTitle: String(args.jobTitle ?? 'Server'),
          station: this.cleanText(args.station) ?? 'Floor',
          status: profileId ? 'scheduled' : 'open',
        },
      });
      await this.markScheduleEdited(venueId);
      return {
        id: row.id,
        date,
        weekStart,
        dayIndex,
        startMinutes: row.startMinutes,
        endMinutes: row.endMinutes,
        profileId: row.profileId,
        staffName: this.cleanText(args.staffName) ?? null,
        status: row.status,
      };
    }

    if (plan.tool === 'CREATE_RESERVATION') {
      const row = await this.prisma.reservation.create({
        data: {
          venueId,
          guestName: String(args.guestName),
          partySize: Number(args.partySize),
          reservationTime: new Date(String(args.reservationTime)),
          durationMinutes: args.durationMinutes != null ? this.positiveInt(args.durationMinutes, 'durationMinutes') : 90,
          status: 'confirmed',
          source: 'direct',
          notes: this.cleanText(args.notes) ?? null,
        },
      });
      return { id: row.id, guestName: row.guestName, partySize: row.partySize, reservationTime: row.reservationTime.getTime(), status: row.status };
    }

    if (plan.tool === 'UPDATE_RESERVATION') {
      const id = this.requiredText(args.reservationId, 'reservationId is required');
      const existing = await this.prisma.reservation.findFirst({ where: { id, venueId, deletedAt: null } });
      if (!existing) throw new NotFoundException('Reservation no longer exists');
      const data: any = {};
      if (args.reservationTime != null) data.reservationTime = this.requiredDate(args.reservationTime, 'Invalid reservation time');
      if (args.partySize != null) data.partySize = this.positiveInt(args.partySize, 'partySize');
      if (args.notes != null) data.notes = this.cleanText(args.notes) ?? null;
      if (args.status != null) {
        const status = this.cleanText(args.status);
        if (!['requested', 'confirmed', 'checked_in', 'seated', 'completed', 'no_show', 'cancelled'].includes(status ?? '')) throw new BadRequestException('Invalid reservation status');
        data.status = status;
      }
      const row = await this.prisma.reservation.update({ where: { id }, data });
      return { id: row.id, guestName: row.guestName, partySize: row.partySize, reservationTime: row.reservationTime.getTime(), status: row.status };
    }

    if (plan.tool === 'CANCEL_RESERVATION') {
      const id = this.requiredText(args.reservationId, 'reservationId is required');
      const row = await this.prisma.reservation.update({ where: { id }, data: { status: 'cancelled' } });
      return { id: row.id, guestName: row.guestName, status: row.status };
    }

    if (plan.tool === 'UPDATE_SHIFT') {
      const id = this.requiredText(args.shiftId, 'shiftId is required');
      const existing = await this.prisma.scheduleShift.findFirst({ where: { id, venueId } });
      if (!existing) throw new NotFoundException('Shift no longer exists');
      const startMinutes = args.startMinutes != null ? this.minuteValue(args.startMinutes, 'startMinutes') : existing.startMinutes;
      const endMinutes = args.endMinutes != null ? this.minuteValue(args.endMinutes, 'endMinutes') : existing.endMinutes;
      if (endMinutes <= startMinutes) throw new BadRequestException('Shift end must be after shift start');
      const weekStart = existing.weekStart ?? weekStartFor(zonedIsoDate(timezone, Date.now()));
      if (existing.profileId) {
        await this.assertNoShiftOverlap(venueId, existing.profileId, weekStart, existing.dayIndex, startMinutes, endMinutes, existing.id);
        await this.assertAssignmentAllowed(venueId, existing.profileId, weekStart, existing.dayIndex, startMinutes, endMinutes);
      }
      const row = await this.prisma.scheduleShift.update({ where: { id }, data: { startMinutes, endMinutes, ...(args.jobTitle != null ? { jobTitle: this.requiredText(args.jobTitle, 'jobTitle') } : {}), ...(args.station != null ? { station: this.requiredText(args.station, 'station') } : {}) } });
      await this.markScheduleEdited(venueId);
      return { id: row.id, startMinutes: row.startMinutes, endMinutes: row.endMinutes, profileId: row.profileId, status: row.status };
    }

    if (plan.tool === 'ASSIGN_SHIFT') {
      const id = this.requiredText(args.shiftId, 'shiftId is required');
      const profileId = this.requiredText(args.profileId, 'profileId is required');
      const shift = await this.prisma.scheduleShift.findFirst({ where: { id, venueId } });
      if (!shift) throw new NotFoundException('Shift no longer exists');
      const profile = await this.prisma.profile.findFirst({ where: { id: profileId, venueId } });
      if (!profile) throw new NotFoundException('Staff member no longer exists');
      const weekStart = shift.weekStart ?? weekStartFor(zonedIsoDate(timezone, Date.now()));
      await this.assertNoShiftOverlap(venueId, profile.id, weekStart, shift.dayIndex, shift.startMinutes, shift.endMinutes, shift.id);
      await this.assertAssignmentAllowed(venueId, profile.id, weekStart, shift.dayIndex, shift.startMinutes, shift.endMinutes);
      const row = await this.prisma.scheduleShift.update({ where: { id }, data: { profileId: profile.id, status: 'scheduled' } });
      await this.markScheduleEdited(venueId);
      return { id: row.id, profileId: profile.id, staffName: profile.fullName, status: row.status };
    }

    if (plan.tool === 'ADD_STAFF') {
      const email = String(args.email).toLowerCase();
      const existing = await this.prisma.profile.findFirst({ where: { venueId, email } });
      if (existing) throw new ConflictException(`${existing.fullName} already has a profile at this venue`);
      const role = String(args.role ?? 'staff') as Role;
      if (role === 'manager' && !(actor.role === 'owner' || actor.role === 'admin' || actor.allAccess)) throw new ForbiddenException('Only an owner or admin can add another manager');
      const row = await this.prisma.profile.create({ data: { venueId, email, fullName: String(args.fullName), role, jobTitle: String(args.jobTitle) } });
      return { id: row.id, fullName: row.fullName, email: row.email, role: row.role, jobTitle: row.jobTitle };
    }

    if (plan.tool === 'REMOVE_STAFF') {
      const profileId = this.requiredText(args.profileId, 'profileId is required');
      if (profileId === actor.profileId) throw new BadRequestException('Wrangler will not deactivate your own active profile');
      const target = await this.prisma.profile.findFirst({ where: { id: profileId, venueId } });
      if (!target) throw new NotFoundException('Staff member no longer exists');
      if (!canManageRole(actor.role, target.role, actor.allAccess)) {
        throw new ForbiddenException('You cannot deactivate a staff member with equal or higher access');
      }
      await runWithoutTenant(() => this.prisma.$transaction(async (tx) => {
        await tx.profile.update({ where: { id: target.id }, data: { membershipStatus: 'revoked' } as any });
        if (target.userId) {
          const activeElsewhere = await tx.profile.count({
            where: {
              userId: target.userId,
              venueId: { not: venueId },
              OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
            },
          });
          if (activeElsewhere === 0) await tx.session.deleteMany({ where: { userId: target.userId } });
        }
        await tx.scheduleShift.updateMany({ where: { venueId, profileId: target.id, weekStart: { gte: weekStartFor(zonedIsoDate(timezone, Date.now())) } }, data: { profileId: null, status: 'open' } });
        await syncTeamMemberCount(tx, venueId);
      }));
      await this.markScheduleEdited(venueId);
      return { id: target.id, fullName: target.fullName, membershipStatus: 'revoked' };
    }

    if (plan.tool === 'CORRECT_PUNCH') {
      const entryId = this.requiredText(args.entryId, 'entryId is required');
      const entry = await this.prisma.timeEntry.findFirst({ where: { id: entryId, venueId } });
      if (!entry) throw new NotFoundException('Time entry no longer exists');
      const clockInAt = args.clockInAt != null ? this.requiredDate(args.clockInAt, 'Invalid clock-in') : entry.clockInAt;
      const clockOutAt = args.clockOutAt != null ? this.requiredDate(args.clockOutAt, 'Invalid clock-out') : entry.clockOutAt;
      if (clockOutAt && clockOutAt <= clockInAt) throw new BadRequestException('Clock-out must be after clock-in');
      const row = await this.prisma.timeEntry.update({ where: { id: entry.id }, data: { clockInAt, clockOutAt, isOpen: clockOutAt == null } });
      return { id: row.id, profileId: row.profileId, clockInAt: row.clockInAt.getTime(), clockOutAt: row.clockOutAt?.getTime() ?? null, isOpen: row.isOpen };
    }

    throw new BadRequestException('Unsupported Wrangler write action');
  }

  private async resolveTable(venueId: string, label: string) {
    const activePlan = await this.prisma.floorPlan.findFirst({ where: { venueId, isActive: true } });
    const tables = await this.prisma.floorTable.findMany({
      where: {
        floorPlanId: activePlan?.id ?? undefined,
        label: { contains: label, mode: 'insensitive' },
      },
      take: 10,
    });
    if (tables.length === 0) {
      const allTables = await this.prisma.floorTable.findMany({
        where: { floorPlan: { venueId }, label: { contains: label, mode: 'insensitive' } },
        take: 10,
      });
      if (allTables.length === 0) throw new NotFoundException(`No table found matching "${label}"`);
      if (allTables.length > 1) {
        const exact = allTables.find((t) => t.label.toLowerCase() === label.toLowerCase() || t.label.toLowerCase() === `table ${label.toLowerCase()}`);
        if (exact) return exact;
        throw new ConflictException(`Found multiple tables matching "${label}". Specify the exact table label.`);
      }
      return allTables[0];
    }
    if (tables.length > 1) {
      const exact = tables.find((t) => t.label.toLowerCase() === label.toLowerCase() || t.label.toLowerCase() === `table ${label.toLowerCase()}`);
      if (exact) return exact;
      throw new ConflictException(`Found multiple tables matching "${label}". Specify the exact table label.`);
    }
    return tables[0];
  }

  private async resolveReservation(venueId: string, timezone: string | null | undefined, args: Record<string, unknown>) {
    const reservationId = this.cleanText(args.reservationId);
    if (reservationId) {
      const row = await this.prisma.reservation.findFirst({ where: { id: reservationId, venueId, deletedAt: null } });
      if (!row) throw new NotFoundException('Reservation not found');
      return row;
    }
    const guestName = this.requiredText(args.guestName, 'Tell Wrangler which reservation to change');
    const where: any = { venueId, deletedAt: null, guestName: { contains: guestName, mode: 'insensitive' }, status: { notIn: ['cancelled', 'completed'] } };
    const date = this.cleanText(args.date);
    if (date) { const bounds = this.dateBounds(timezone, date); where.reservationTime = { gte: bounds.start, lt: bounds.end }; }
    const rows = await this.prisma.reservation.findMany({ where, orderBy: { reservationTime: 'asc' }, take: 5 });
    if (rows.length === 0) throw new NotFoundException(`No active reservation found for ${guestName}`);
    if (rows.length > 1) throw new ConflictException(`I found ${rows.length} active reservations matching ${guestName}. Be more specific with the date or open Reservations to choose one.`);
    return rows[0];
  }

  private async resolveShift(venueId: string, timezone: string | null | undefined, args: Record<string, unknown>) {
    const shiftId = this.cleanText(args.shiftId);
    if (shiftId) {
      const row = await this.prisma.scheduleShift.findFirst({ where: { id: shiftId, venueId }, include: { profile: { select: { fullName: true } } } });
      if (!row) throw new NotFoundException('Shift not found');
      return row;
    }
    const date = this.cleanText(args.date) ?? zonedIsoDate(timezone, Date.now());
    const weekStart = weekStartFor(date);
    const dayIndex = this.dayIndex(date);
    const staffName = this.cleanText(args.staffName);
    let profileIds: string[] | undefined;
    if (staffName) profileIds = (await this.findProfiles(venueId, staffName)).map((p) => p.id);
    const jobTitle = this.cleanText(args.jobTitle);
    const rows = await this.prisma.scheduleShift.findMany({ where: { venueId, weekStart, dayIndex, ...(profileIds ? { profileId: { in: profileIds } } : {}), ...(jobTitle ? { jobTitle: { contains: jobTitle, mode: 'insensitive' } } : {}) } as any, include: { profile: { select: { fullName: true } } }, orderBy: { startMinutes: 'asc' }, take: 10 });
    if (rows.length === 0) throw new NotFoundException('No matching shift found');
    if (rows.length > 1) throw new ConflictException(`I found ${rows.length} matching shifts. Include the staff name, role, or exact shift in your command.`);
    return rows[0];
  }

  private async resolveProfile(venueId: string, name: string) {
    const rows = await this.findProfiles(venueId, name);
    if (rows.length === 0) throw new NotFoundException(`No staff member found matching ${name}`);
    if (rows.length > 1) throw new ConflictException(`I found ${rows.length} staff members matching ${name}. Use the full name.`);
    return rows[0];
  }

  private findProfiles(venueId: string, name: string) {
    return this.prisma.profile.findMany({ where: { venueId, OR: [{ membershipStatus: null }, { membershipStatus: 'active' }], fullName: { contains: name, mode: 'insensitive' } } as any, orderBy: { fullName: 'asc' }, take: 10 });
  }

  private async assertNoShiftOverlap(venueId: string, profileId: string, weekStart: string, dayIndex: number, startMinutes: number, endMinutes: number, excludeShiftId?: string) {
    const conflict = await this.prisma.scheduleShift.findFirst({ where: { venueId, profileId, weekStart, dayIndex, status: { in: ['scheduled', 'covered'] }, startMinutes: { lt: endMinutes }, endMinutes: { gt: startMinutes }, ...(excludeShiftId ? { id: { not: excludeShiftId } } : {}) } });
    if (conflict) throw new ConflictException('That staff member already has an overlapping shift');
  }

  // Mirrors the scheduling module's availability gate: an approved time-off or
  // sick-leave request blocks assignment for the covered day, so Wrangler
  // commands cannot schedule someone into a day they are approved to be off.
  private async assertAssignmentAllowed(venueId: string, profileId: string, weekStart: string, dayIndex: number, startMinutes: number, endMinutes: number) {
    const weekEnd = this.dateAtOffset(weekStart, 6);
    const requests = await this.prisma.staffRequest.findMany({
      where: {
        venueId,
        profileId,
        status: 'approved',
        kind: { in: ['time_off', 'sick_leave'] },
        OR: [
          { requestedRangeStart: { lte: weekEnd }, requestedRangeEnd: { gte: weekStart } },
          { requestedForDate: { gte: weekStart, lte: weekEnd } },
        ],
      },
      select: { requestedForDate: true, requestedRangeStart: true, requestedRangeEnd: true },
    });
    const dayDate = this.dateAtOffset(weekStart, dayIndex);
    const blocked = requests.some((request) => {
      const start = request.requestedRangeStart ?? request.requestedForDate;
      const end = request.requestedRangeEnd ?? request.requestedForDate ?? start;
      return Boolean(start && end && dayDate >= start && dayDate <= end);
    });
    if (blocked) throw new BadRequestException('That staff member has approved time off covering this shift.');
  }

  private dateAtOffset(weekStart: string, dayIndex: number) {
    const date = new Date(`${weekStart}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + dayIndex);
    return date.toISOString().slice(0, 10);
  }

  private async markScheduleEdited(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: { schedulePublishedAt: true } });
    if (venue?.schedulePublishedAt) await this.prisma.venue.update({ where: { id: venueId }, data: { scheduleUpdatedAfterPublishAt: new Date() } });
  }

  private async writeAudit(venueId: string, actor: Actor, plan: OperatorPlan, result: unknown) {
    try {
      await this.prisma.auditLog.create({
        data: {
          venueId,
          actorProfileId: actor.profileId,
          actorName: actor.fullName,
          actorRole: actor.role,
          entityType: 'wrangler_operator',
          entityId: String((result as { id?: unknown } | null)?.id ?? (plan.args.reservationId ?? plan.args.shiftId ?? plan.args.profileId ?? plan.args.entryId ?? plan.tool)),
          action: `wrangler_operator_${plan.tool.toLowerCase()}`,
          summary: plan.summary,
          metadata: { tool: plan.tool, risk: plan.risk, args: this.auditArgs(plan.args) } as any,
        },
      });
    } catch (error) {
      // The operation has already completed; surfacing an audit failure would invite a duplicate retry.
      this.logger.error(`Wrangler operator audit failed for ${plan.tool}`, error);
    }
  }

  private canManage(actor: Actor) { return actor.allAccess || ['owner', 'admin', 'manager'].includes(actor.role); }
  private cleanText(value: unknown) { const text = typeof value === 'string' ? value.trim() : ''; return text || undefined; }
  private requiredText(value: unknown, message: string) { const text = this.cleanText(value); if (!text) throw new BadRequestException(message); return text; }
  private positiveInt(value: unknown, field: string) { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw new BadRequestException(`${field} must be a positive whole number`); return n; }
  private minuteValue(value: unknown, field: string) { const n = Number(value); if (!Number.isInteger(n) || n < 0 || n > 1440) throw new BadRequestException(`${field} must be between 0 and 1440`); return n; }
  private tableStatus(value: unknown, fallback: TableStatus) { const status = this.cleanText(value) ?? fallback; if (!['available', 'seated', 'dirty', 'reserved', 'held', 'out_of_service'].includes(status)) throw new BadRequestException('Invalid table status'); return status as TableStatus; }
  private crmLeadStatus(value: unknown) { const status = this.requiredText(value, 'Invalid CRM lead status'); if (!['new', 'contacted', 'qualified', 'proposal_sent', 'negotiating', 'won', 'lost', 'unqualified', 'on_hold'].includes(status)) throw new BadRequestException('Invalid CRM lead status'); return status as CrmLeadStatus; }
  private requiredDate(value: unknown, message: string) { const date = this.optionalDate(value, message); if (!date) throw new BadRequestException(message); return date; }
  private optionalDate(value: unknown, field: string) { if (value == null || value === '') return undefined; const date = new Date(String(value)); if (Number.isNaN(date.getTime())) throw new BadRequestException(`Invalid ${field}`); return date; }
  private dateBounds(timezone: string | null | undefined, date: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Date must be YYYY-MM-DD'); const bounds = zonedDateBounds(timezone, date); return { start: new Date(bounds.start), end: new Date(bounds.end) }; }
  private dayIndex(date: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Date must be YYYY-MM-DD'); return new Date(`${date}T12:00:00Z`).getUTCDay(); }
  private minutesLabel(minutes: number) { const hour = Math.floor(minutes / 60); const min = minutes % 60; const h = hour % 12 || 12; return `${h}:${String(min).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`; }
  private defaultSummary(tool: OperatorTool) { return tool.toLowerCase().replaceAll('_', ' '); }
  private auditArgs(args: Record<string, unknown>) { const safe = { ...args }; delete safe.email; delete safe.notes; delete safe.staffName; delete safe.guestName; return safe; }
}
