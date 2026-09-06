import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, type EventBeoReportTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withTenantTransaction } from '../../prisma/tenant-transaction';

/**
 * The event BEO report: one published document per event holding the suite BEO
 * list and every department's run of service in chronological order.
 *
 * It is assembled from the records the venue already keeps — suite BEO orders,
 * execution tasks, the run of show, vendor calls and outlet readiness — rather
 * than being authored separately, so publishing cannot drift from operations.
 * Each publish writes a new immutable version; the copy a suite host or a
 * department head was handed stays exactly as it was handed over.
 */

/** Departments a line can belong to, in the order they read on the report. */
export const REPORT_DEPARTMENTS = [
  'premium_hospitality',
  'culinary_production',
  'catering_banquets',
  'concessions',
  'beverage_operations',
  'retail_fnb',
  'vendor_partners',
  'unassigned',
] as const;

export type ReportDepartment = (typeof REPORT_DEPARTMENTS)[number];

const DEPARTMENT_LABELS: Record<ReportDepartment, string> = {
  premium_hospitality: 'Premium Hospitality & Suites',
  culinary_production: 'Culinary Production',
  catering_banquets: 'Catering & Banquets',
  concessions: 'Concessions & Stands',
  beverage_operations: 'Beverage Operations',
  retail_fnb: 'Retail F&B',
  vendor_partners: 'Vendor Partners',
  unassigned: 'Unassigned',
};

/**
 * Free-text departments on execution tasks are whatever the template author
 * typed. Fold the ones we recognise onto the F&B departments so a task lands in
 * the same section as the outlets it concerns instead of its own singleton.
 */
const TASK_DEPARTMENT_ALIASES: Record<string, ReportDepartment> = {
  suites: 'premium_hospitality',
  suite: 'premium_hospitality',
  premium: 'premium_hospitality',
  hospitality: 'premium_hospitality',
  premium_hospitality: 'premium_hospitality',
  kitchen: 'culinary_production',
  culinary: 'culinary_production',
  commissary: 'culinary_production',
  culinary_production: 'culinary_production',
  catering: 'catering_banquets',
  banquets: 'catering_banquets',
  catering_banquets: 'catering_banquets',
  concessions: 'concessions',
  stands: 'concessions',
  bar: 'beverage_operations',
  beverage: 'beverage_operations',
  beverage_operations: 'beverage_operations',
  retail: 'retail_fnb',
  retail_fnb: 'retail_fnb',
  vendor: 'vendor_partners',
  vendors: 'vendor_partners',
  vendor_partners: 'vendor_partners',
};

export function normalizeDepartment(value: string | null | undefined): ReportDepartment {
  if (!value) return 'unassigned';
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return TASK_DEPARTMENT_ALIASES[key] ?? 'unassigned';
}

export type ReportLineKind = 'suite_delivery' | 'task' | 'run_of_show' | 'vendor' | 'outlet_readiness';

export interface ReportLine {
  id: string;
  kind: ReportLineKind;
  /** ISO timestamp this line is due, or null when the source carries no time. */
  at: string | null;
  title: string;
  detail: string | null;
  status: string;
  reference: string | null;
}

export interface ReportDepartmentSection {
  code: ReportDepartment;
  label: string;
  lineCount: number;
  openCount: number;
  /** Chronological. Lines with no time sort last, in a stable order. */
  lines: ReportLine[];
}

/** The sales BEO an operational suite order fulfils, when one is linked. */
export interface SalesBeoRef {
  id: string;
  eventName: string;
  eventDate: string | null;
  status: string;
  fbMinimumCents: number | null;
  depositCents: number | null;
}

export interface SuiteBeoReportRow {
  id: string;
  beoNumber: string;
  /** Null when the suite order was raised without a sales document behind it. */
  salesBeo: SalesBeoRef | null;
  suiteCode: string;
  suiteName: string;
  zoneName: string;
  hostName: string;
  hostPhone: string | null;
  hostEmail: string | null;
  guestCount: number;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  status: string;
  specialInstructions: string | null;
  totalCents: number;
  lineItems: { code: string; name: string; quantity: number; unitPriceCents: number; category: string }[];
}

export interface EventBeoReportDocument {
  reportType: 'event_beo_report';
  version: number;
  publishedAt: string;
  trigger: EventBeoReportTrigger;
  venue: { id: string; name: string };
  event: {
    id: string;
    title: string;
    eventCode: string | null;
    eventType: string;
    status: string;
    startsAt: string;
    gatesOpenAt: string | null;
    endsAt: string | null;
    expectedGuests: number | null;
    opponentOrHeadliner: string | null;
  };
  suites: {
    beoCount: number;
    guestCount: number;
    revenueCents: number;
    /** Suite orders carrying a link to their sales BEO. */
    linkedToSalesCount: number;
    /** Chronological by delivery window. */
    rows: SuiteBeoReportRow[];
  };
  departments: ReportDepartmentSection[];
  totals: { lineCount: number; openLineCount: number; departmentCount: number };
  dataGaps: string[];
}

/** Sorts chronologically, with untimed lines last and ties broken by title. */
function byTimeThenTitle(a: ReportLine, b: ReportLine): number {
  if (a.at && b.at) {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  } else if (a.at) {
    return -1;
  } else if (b.at) {
    return 1;
  }
  return a.title.localeCompare(b.title);
}

function parseLineItems(value: Prisma.JsonValue | null): SuiteBeoReportRow['lineItems'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name : null;
    if (!name) return [];
    return [
      {
        code: typeof item.code === 'string' ? item.code : '',
        name,
        quantity: typeof item.quantity === 'number' ? item.quantity : 1,
        unitPriceCents: typeof item.unitPriceCents === 'number' ? item.unitPriceCents : 0,
        category: typeof item.category === 'string' ? item.category : 'other',
      },
    ];
  });
}

@Injectable()
export class EventBeoReportService {
  private readonly logger = new Logger(EventBeoReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the report for an event without storing it. Used both for the live
   * preview a manager sees before publishing and by `publish` itself.
   */
  async buildReport(venueId: string, eventId: string): Promise<EventBeoReportDocument> {
    const event = await this.prisma.venueEvent.findFirst({
      where: { id: eventId, venueId },
      select: {
        id: true,
        title: true,
        eventCode: true,
        eventType: true,
        status: true,
        startsAt: true,
        gatesOpenAt: true,
        endsAt: true,
        expectedGuests: true,
        opponentOrHeadliner: true,
        organizationId: true,
      },
    });
    if (!event) throw new NotFoundException('Stadium event not found.');

    const [venue, suiteBeos, workspaces, readiness] = await Promise.all([
      this.prisma.venue.findUniqueOrThrow({ where: { id: venueId }, select: { id: true, name: true } }),
      this.prisma.suiteBeoOrder.findMany({
        where: { facilityId: venueId, eventId },
        orderBy: [{ deliveryWindowStart: 'asc' }, { beoNumber: 'asc' }],
        select: {
          id: true,
          beoNumber: true,
          hostName: true,
          hostPhone: true,
          hostEmail: true,
          guestCount: true,
          deliveryWindowStart: true,
          deliveryWindowEnd: true,
          specialInstructions: true,
          cateringLineItems: true,
          status: true,
          totalCents: true,
          zone: { select: { name: true } },
          subVenue: { select: { code: true, name: true } },
          crmBeo: {
            select: {
              id: true,
              eventName: true,
              eventDate: true,
              status: true,
              fbMinimumCents: true,
              depositCents: true,
            },
          },
        },
      }),
      this.prisma.eventExecutionWorkspace.findMany({
        where: { venueId, sourceType: 'venue-event', sourceId: eventId },
        select: {
          id: true,
          tasks: {
            select: { id: true, title: true, department: true, dueAt: true, status: true, critical: true },
          },
          timeline: { select: { id: true, title: true, startsAt: true, status: true } },
          vendors: { select: { id: true, name: true, dueAt: true, status: true } },
        },
      }),
      this.prisma.eventFnbReadiness.findMany({
        where: { venueId, eventId },
        select: {
          id: true,
          status: true,
          notes: true,
          checkedAt: true,
          zone: { select: { code: true, name: true, department: true } },
        },
      }),
    ]);

    const sections = new Map<ReportDepartment, ReportLine[]>();
    const pushLine = (department: ReportDepartment, line: ReportLine) => {
      const existing = sections.get(department);
      if (existing) existing.push(line);
      else sections.set(department, [line]);
    };

    const suiteRows: SuiteBeoReportRow[] = suiteBeos.map((beo) => ({
      id: beo.id,
      beoNumber: beo.beoNumber,
      salesBeo: beo.crmBeo
        ? {
            id: beo.crmBeo.id,
            eventName: beo.crmBeo.eventName,
            eventDate: beo.crmBeo.eventDate ? beo.crmBeo.eventDate.toISOString() : null,
            status: beo.crmBeo.status,
            fbMinimumCents: beo.crmBeo.fbMinimumCents,
            depositCents: beo.crmBeo.depositCents,
          }
        : null,
      suiteCode: beo.subVenue?.code ?? '',
      suiteName: beo.subVenue?.name ?? 'Suite',
      zoneName: beo.zone?.name ?? '',
      hostName: beo.hostName,
      hostPhone: beo.hostPhone,
      hostEmail: beo.hostEmail,
      guestCount: beo.guestCount ?? 0,
      deliveryWindowStart: beo.deliveryWindowStart.toISOString(),
      deliveryWindowEnd: beo.deliveryWindowEnd.toISOString(),
      status: beo.status,
      specialInstructions: beo.specialInstructions,
      totalCents: beo.totalCents,
      lineItems: parseLineItems(beo.cateringLineItems),
    }));

    // Every suite delivery is also a premium hospitality line, so the
    // department's run of service reads as one timeline with its other work.
    for (const row of suiteRows) {
      pushLine('premium_hospitality', {
        id: `suite:${row.id}`,
        kind: 'suite_delivery',
        at: row.deliveryWindowStart,
        title: `${row.suiteCode || row.suiteName} — ${row.hostName}`,
        detail: `${row.guestCount} guests · ${row.lineItems.length} catering items`,
        status: row.status,
        reference: row.beoNumber,
      });
    }

    for (const workspace of workspaces) {
      for (const task of workspace.tasks) {
        pushLine(normalizeDepartment(task.department), {
          id: `task:${task.id}`,
          kind: 'task',
          at: task.dueAt ? task.dueAt.toISOString() : null,
          title: task.title,
          detail: task.critical ? 'Critical path' : null,
          status: task.status,
          reference: null,
        });
      }
      for (const item of workspace.timeline) {
        // The run of show is shared, so it heads every department's timeline.
        pushLine('unassigned', {
          id: `timeline:${item.id}`,
          kind: 'run_of_show',
          at: item.startsAt.toISOString(),
          title: item.title,
          detail: 'Run of show',
          status: item.status,
          reference: null,
        });
      }
      for (const vendor of workspace.vendors) {
        pushLine('vendor_partners', {
          id: `vendor:${vendor.id}`,
          kind: 'vendor',
          at: vendor.dueAt ? vendor.dueAt.toISOString() : null,
          title: vendor.name,
          detail: 'Vendor arrival',
          status: vendor.status,
          reference: null,
        });
      }
    }

    for (const row of readiness) {
      pushLine(normalizeDepartment(row.zone?.department), {
        id: `readiness:${row.id}`,
        kind: 'outlet_readiness',
        at: row.checkedAt ? row.checkedAt.toISOString() : null,
        title: `${row.zone?.code ?? 'Outlet'} — ${row.zone?.name ?? 'Outlet readiness'}`,
        detail: row.notes,
        status: row.status,
        reference: row.zone?.code ?? null,
      });
    }

    const departments: ReportDepartmentSection[] = REPORT_DEPARTMENTS.flatMap((code) => {
      const lines = sections.get(code);
      if (!lines?.length) return [];
      const sorted = [...lines].sort(byTimeThenTitle);
      return [
        {
          code,
          label: DEPARTMENT_LABELS[code],
          lineCount: sorted.length,
          openCount: sorted.filter((line) => !['done', 'delivered', 'closed_invoiced', 'arrived', 'ready'].includes(line.status))
            .length,
          lines: sorted,
        },
      ];
    });

    const unlinkedSuiteCount = suiteRows.filter((row) => !row.salesBeo).length;
    const suiteGuestCount = suiteRows.reduce((total, row) => total + row.guestCount, 0);
    const suiteRevenueCents = suiteRows.reduce((total, row) => total + row.totalCents, 0);
    const lineCount = departments.reduce((total, section) => total + section.lineCount, 0);

    const dataGaps = [
      ...(suiteRows.length === 0 ? ['No suite BEOs are attached to this event.'] : []),
      ...(workspaces.length === 0 ? ['This event has no execution workspace, so no departmental run of service exists yet.'] : []),
      ...(event.expectedGuests == null ? ['Expected attendance is not set on the event.'] : []),
      ...(suiteRows.some((row) => row.totalCents === 0)
        ? ['One or more suite BEOs carry a zero total; catering charges may not be priced yet.']
        : []),
      ...(unlinkedSuiteCount
        ? [
            `${unlinkedSuiteCount} suite ${unlinkedSuiteCount === 1 ? 'BEO is' : 'BEOs are'} not linked to a sales BEO, so ${unlinkedSuiteCount === 1 ? 'its' : 'their'} contracted minimum and deposit cannot be checked against the CRM.`,
          ]
        : []),
    ];

    return {
      reportType: 'event_beo_report',
      version: 0,
      publishedAt: new Date().toISOString(),
      trigger: 'manual',
      venue: { id: venue.id, name: venue.name },
      event: {
        id: event.id,
        title: event.title,
        eventCode: event.eventCode,
        eventType: event.eventType,
        status: event.status,
        startsAt: event.startsAt.toISOString(),
        gatesOpenAt: event.gatesOpenAt ? event.gatesOpenAt.toISOString() : null,
        endsAt: event.endsAt ? event.endsAt.toISOString() : null,
        expectedGuests: event.expectedGuests,
        opponentOrHeadliner: event.opponentOrHeadliner,
      },
      suites: {
        beoCount: suiteRows.length,
        guestCount: suiteGuestCount,
        revenueCents: suiteRevenueCents,
        linkedToSalesCount: suiteRows.length - unlinkedSuiteCount,
        rows: suiteRows,
      },
      departments,
      totals: {
        lineCount,
        openLineCount: departments.reduce((total, section) => total + section.openCount, 0),
        departmentCount: departments.length,
      },
      dataGaps,
    };
  }

  /** The report a reader sees: the newest published version for the event. */
  async getPublishedReport(venueId: string, eventId: string) {
    const record = await this.prisma.eventBeoReport.findFirst({
      where: { venueId, eventId },
      orderBy: { version: 'desc' },
    });
    if (!record) return null;
    return {
      id: record.id,
      version: record.version,
      trigger: record.trigger,
      publishedAt: record.publishedAt.toISOString(),
      publishedBy: record.generatedByName ?? record.generatedBy,
      dataGaps: record.dataGaps,
      report: record.report as unknown as EventBeoReportDocument,
    };
  }

  async listVersions(venueId: string, eventId: string) {
    const rows = await this.prisma.eventBeoReport.findMany({
      where: { venueId, eventId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        trigger: true,
        publishedAt: true,
        generatedByName: true,
        suiteBeoCount: true,
        suiteRevenueCents: true,
        departmentCount: true,
        lineItemCount: true,
      },
    });
    return rows.map((row) => ({ ...row, publishedAt: row.publishedAt.toISOString() }));
  }

  /**
   * Publishes the next version of the report. Nothing is edited in place, so a
   * republish after a menu change leaves the earlier copy intact and auditable.
   */
  async publish(
    venueId: string,
    eventId: string,
    actor: { profileId: string; fullName?: string | null },
    trigger: EventBeoReportTrigger = 'manual',
  ) {
    const document = await this.buildReport(venueId, eventId);
    const event = await this.prisma.venueEvent.findFirstOrThrow({
      where: { id: eventId, venueId },
      select: { organizationId: true },
    });

    return withTenantTransaction(
      this.prisma,
      async (tx) => {
        const latest = await tx.eventBeoReport.findFirst({
          where: { eventId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const version = (latest?.version ?? 0) + 1;
        const published: EventBeoReportDocument = {
          ...document,
          version,
          trigger,
          publishedAt: new Date().toISOString(),
        };

        const record = await tx.eventBeoReport.create({
          data: {
            organizationId: event.organizationId,
            venueId,
            eventId,
            version,
            trigger,
            generatedBy: actor.profileId,
            generatedByName: actor.fullName ?? null,
            suiteBeoCount: published.suites.beoCount,
            suiteGuestCount: published.suites.guestCount,
            suiteRevenueCents: published.suites.revenueCents,
            departmentCount: published.totals.departmentCount,
            lineItemCount: published.totals.lineCount,
            dataGaps: published.dataGaps,
            report: published as unknown as Prisma.InputJsonValue,
          },
        });

        await tx.eventAuditLog.create({
          data: {
            organizationId: event.organizationId,
            venueId,
            eventId,
            actorProfileId: actor.profileId,
            entityType: 'event_beo_report',
            entityId: record.id,
            action: 'beo_report_published',
            metadata: { version, trigger, suiteBeoCount: published.suites.beoCount },
          },
        });

        return {
          id: record.id,
          version,
          trigger,
          publishedAt: record.publishedAt.toISOString(),
          publishedBy: record.generatedByName ?? record.generatedBy,
          dataGaps: record.dataGaps,
          report: published,
        };
      },
      { venueId },
    );
  }

  /**
   * Events starting within the next day that have not been published since
   * their most recent change. The day-before publish gives every department a
   * frozen copy to work from on event day.
   */
  async findEventsDueForScheduledPublish(now = new Date()) {
    const windowEnd = new Date(now.getTime() + 36 * 60 * 60 * 1000);
    const events = await this.prisma.venueEvent.findMany({
      where: {
        startsAt: { gte: now, lte: windowEnd },
        status: { notIn: ['cancelled'] },
      },
      select: { id: true, venueId: true, organizationId: true, title: true, updatedAt: true },
      take: 500,
    });
    if (!events.length) return [];

    const latest = await this.prisma.eventBeoReport.findMany({
      where: { eventId: { in: events.map((event) => event.id) } },
      orderBy: { version: 'desc' },
      distinct: ['eventId'],
      select: { eventId: true, publishedAt: true },
    });
    const publishedAt = new Map(latest.map((row) => [row.eventId, row.publishedAt]));

    // Republish when the event changed after the last publish; skip when the
    // standing copy already reflects it, so the cron does not churn versions.
    return events.filter((event) => {
      const last = publishedAt.get(event.id);
      return !last || last < event.updatedAt;
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async publishReportsForTomorrow(): Promise<void> {
    try {
      const due = await this.findEventsDueForScheduledPublish();
      for (const event of due) {
        try {
          const result = await this.publish(
            event.venueId,
            event.id,
            { profileId: 'system', fullName: 'Scheduled publish' },
            'scheduled',
          );
          this.logger.log(`Published BEO report v${result.version} for event ${event.id} (${event.title}).`);
        } catch (err) {
          this.logger.error(`BEO report publish failed for event ${event.id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`Scheduled BEO report sweep failed: ${(err as Error).message}`);
    }
  }
}
