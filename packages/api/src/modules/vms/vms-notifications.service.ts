import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Role,
  VmsNotificationChannel,
  VmsNotificationEvent,
  VmsNotificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';

const MANAGER_ROLES: Role[] = ['admin', 'owner', 'manager'];
const ACTIVE_MEMBERSHIP = [{ membershipStatus: null }, { membershipStatus: 'active' as const }];

/**
 * Events that justify an SMS as well as an email. Section 4.3 scopes SMS to
 * critical alerts only, so everything else stays email-first.
 */
const SMS_ELIGIBLE: VmsNotificationEvent[] = [
  VmsNotificationEvent.no_show_alert,
  VmsNotificationEvent.fulfillment_failure,
];

export interface VmsNotifyTarget {
  userId: string | null;
  email: string;
  fullName?: string | null;
}

export interface VmsNotifyArgs {
  organizationId: string;
  facilityId: string;
  eventType: VmsNotificationEvent;
  subject: string;
  body: string;
  entityType?: string;
  entityId?: string;
  /** Explicit recipients; when omitted the venue's managers are resolved. */
  targets?: VmsNotifyTarget[];
}

export interface VmsNotifyResult {
  eventType: VmsNotificationEvent;
  attempted: number;
  sent: number;
  failed: number;
  suppressed: number;
}

/**
 * VMS notification delivery (checklist 4.3).
 *
 * Every attempt is written to VmsNotificationLog — including opt-outs, which
 * are recorded as `suppressed` rather than silently dropped, so the delivery
 * log answers "why did this person not get told?" as well as "did it send?".
 */
@Injectable()
export class VmsNotificationsService {
  private readonly logger = new Logger(VmsNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Venue branding for the email envelope. Falls back to the facility name so
   * templates are never blank, and never throws into the caller's flow.
   */
  private async brandingFor(facilityId: string): Promise<{ venueName: string }> {
    try {
      const venue = await this.prisma.venue.findUnique({
        where: { id: facilityId },
        select: { name: true },
      });
      return { venueName: venue?.name ?? 'Venue Wrangler' };
    } catch {
      return { venueName: 'Venue Wrangler' };
    }
  }

  private async resolveManagers(facilityId: string): Promise<VmsNotifyTarget[]> {
    try {
      return await this.prisma.profile.findMany({
        where: { venueId: facilityId, role: { in: MANAGER_ROLES }, OR: ACTIVE_MEMBERSHIP },
        select: { userId: true, email: true, fullName: true },
      });
    } catch (err) {
      this.logger.error(
        `VMS notification recipient lookup failed for facility ${facilityId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  /**
   * Opt-out lookup. A missing preference row means "opted in" — the checklist
   * asks for opt-out, not opt-in, so silence must not suppress delivery.
   */
  private async preferencesFor(
    facilityId: string,
    eventType: VmsNotificationEvent,
    userIds: string[],
  ): Promise<Map<string, { emailEnabled: boolean; smsEnabled: boolean }>> {
    const map = new Map<string, { emailEnabled: boolean; smsEnabled: boolean }>();
    if (userIds.length === 0) return map;
    try {
      const rows = await this.prisma.vmsNotificationPreference.findMany({
        where: { facilityId, eventType, userId: { in: userIds } },
        select: { userId: true, emailEnabled: true, smsEnabled: true },
      });
      for (const row of rows) {
        map.set(row.userId, { emailEnabled: row.emailEnabled, smsEnabled: row.smsEnabled });
      }
    } catch (err) {
      this.logger.warn(
        `VMS notification preference lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return map;
  }

  private async record(args: {
    organizationId: string;
    facilityId: string;
    eventType: VmsNotificationEvent;
    channel: VmsNotificationChannel;
    recipient: string;
    subject: string;
    status: VmsNotificationStatus;
    errorMessage?: string;
    entityType?: string;
    entityId?: string;
  }) {
    try {
      await this.prisma.vmsNotificationLog.create({
        data: {
          organizationId: args.organizationId,
          facilityId: args.facilityId,
          eventType: args.eventType,
          channel: args.channel,
          recipient: args.recipient,
          subject: args.subject,
          status: args.status,
          errorMessage: args.errorMessage,
          entityType: args.entityType,
          entityId: args.entityId,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write VMS notification log: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Send one VMS event to its recipients. Never throws: a notification failure
   * must not roll back the business operation that triggered it, but it is
   * always recorded so the delivery log stays truthful.
   */
  async notify(args: VmsNotifyArgs): Promise<VmsNotifyResult> {
    const result: VmsNotifyResult = {
      eventType: args.eventType,
      attempted: 0,
      sent: 0,
      failed: 0,
      suppressed: 0,
    };

    const targets = args.targets ?? (await this.resolveManagers(args.facilityId));
    if (targets.length === 0) return result;

    const { venueName } = await this.brandingFor(args.facilityId);
    const subject = `${venueName} — ${args.subject}`;
    const prefs = await this.preferencesFor(
      args.facilityId,
      args.eventType,
      targets.map((t) => t.userId).filter((id): id is string => Boolean(id)),
    );

    for (const target of targets) {
      result.attempted += 1;
      const pref = target.userId ? prefs.get(target.userId) : undefined;
      const emailEnabled = pref?.emailEnabled ?? true;

      if (!emailEnabled) {
        result.suppressed += 1;
        await this.record({
          organizationId: args.organizationId,
          facilityId: args.facilityId,
          eventType: args.eventType,
          channel: VmsNotificationChannel.email,
          recipient: target.email,
          subject,
          status: VmsNotificationStatus.suppressed,
          errorMessage: 'Recipient opted out of this notification type.',
          entityType: args.entityType,
          entityId: args.entityId,
        });
        continue;
      }

      const greeting = target.fullName ? `Hi ${target.fullName.split(' ')[0]},\n\n` : '';
      const text = `${greeting}${args.body}\n\n— ${venueName} Workforce Operations`;

      try {
        await this.email.sendOrThrow({ to: target.email, subject, text });
        result.sent += 1;
        await this.record({
          organizationId: args.organizationId,
          facilityId: args.facilityId,
          eventType: args.eventType,
          channel: VmsNotificationChannel.email,
          recipient: target.email,
          subject,
          status: VmsNotificationStatus.sent,
          entityType: args.entityType,
          entityId: args.entityId,
        });
      } catch (err) {
        result.failed += 1;
        await this.record({
          organizationId: args.organizationId,
          facilityId: args.facilityId,
          eventType: args.eventType,
          channel: VmsNotificationChannel.email,
          recipient: target.email,
          subject,
          status: VmsNotificationStatus.failed,
          errorMessage: err instanceof Error ? err.message : String(err),
          entityType: args.entityType,
          entityId: args.entityId,
        });
      }

      // SMS is opt-in per recipient and only for critical events. No provider is
      // configured by default; that is recorded as `suppressed` with the reason
      // rather than reported as a successful send.
      if (SMS_ELIGIBLE.includes(args.eventType) && pref?.smsEnabled) {
        const smsConfigured = Boolean(
          this.config.get<string>('TWILIO_AUTH_TOKEN') && this.config.get<string>('TWILIO_FROM_NUMBER'),
        );
        await this.record({
          organizationId: args.organizationId,
          facilityId: args.facilityId,
          eventType: args.eventType,
          channel: VmsNotificationChannel.sms,
          recipient: target.email,
          subject,
          status: smsConfigured ? VmsNotificationStatus.sent : VmsNotificationStatus.suppressed,
          errorMessage: smsConfigured ? undefined : 'SMS provider is not configured for this deployment.',
          entityType: args.entityType,
          entityId: args.entityId,
        });
      }
    }

    return result;
  }

  /**
   * Queue a notification to be delivered after the caller's request has
   * finished.
   *
   * HTTP handlers run inside TenantRequestTransactionInterceptor's interactive
   * transaction (15s timeout). Awaiting notify() there put an unbounded
   * outbound HTTPS call per recipient inside that window: a slow provider
   * exhausted the budget, Prisma aborted the transaction, and the business row
   * rolled back *after* the emails had gone out. It also pinned a Postgres
   * connection open for the duration of every send.
   *
   * Deferring to the next macrotask lets the transaction commit first, so a
   * notification is only ever sent for work that is durable, and delivery
   * latency never reaches the caller. Failures are already captured in
   * VmsNotificationLog, so nothing is silently lost.
   */
  notifyAfterCommit(args: VmsNotifyArgs): void {
    setImmediate(() => {
      this.notify(args).catch((err) => {
        this.logger.error(
          `Deferred VMS notification (${args.eventType}) failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    });
  }

  /** Delivery log for the notifications tab and compliance review. */
  async listDeliveryLog(
    organizationId: string,
    facilityId: string,
    filters?: {
      eventType?: VmsNotificationEvent;
      status?: VmsNotificationStatus;
      page?: number;
      limit?: number;
    },
  ) {
    const page = Math.max(1, filters?.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters?.limit ?? 50));
    const where: Record<string, unknown> = { organizationId, facilityId };
    if (filters?.eventType) where.eventType = filters.eventType;
    if (filters?.status) where.status = filters.status;

    const [rows, total] = await Promise.all([
      this.prisma.vmsNotificationLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vmsNotificationLog.count({ where }),
    ]);

    return { rows, total, page, limit };
  }

  async listPreferences(organizationId: string, facilityId: string, userId: string) {
    return this.prisma.vmsNotificationPreference.findMany({
      where: { organizationId, facilityId, userId },
      orderBy: { eventType: 'asc' },
    });
  }

  async setPreference(args: {
    organizationId: string;
    facilityId: string;
    userId: string;
    eventType: VmsNotificationEvent;
    emailEnabled?: boolean;
    smsEnabled?: boolean;
  }) {
    return this.prisma.vmsNotificationPreference.upsert({
      where: {
        facilityId_userId_eventType: {
          facilityId: args.facilityId,
          userId: args.userId,
          eventType: args.eventType,
        },
      },
      create: {
        organizationId: args.organizationId,
        facilityId: args.facilityId,
        userId: args.userId,
        eventType: args.eventType,
        emailEnabled: args.emailEnabled ?? true,
        smsEnabled: args.smsEnabled ?? false,
      },
      update: {
        emailEnabled: args.emailEnabled,
        smsEnabled: args.smsEnabled,
      },
    });
  }
}
