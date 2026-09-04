import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VmsNotificationEvent, VmsOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VmsService } from './vms.service';
import { VmsNotificationsService } from './vms-notifications.service';

/**
 * Certification expiry warning window (checklist 1.2: "renewal alerts 30 days
 * before expiry").
 */
const CERT_WARNING_DAYS = 30;

/** Escalate unfilled orders inside this window (checklist 1.4). */
const ESCALATION_WINDOW_HOURS = 48;

/** Shift reminders go out this far ahead of the shift date (checklist 4.3). */
const SHIFT_REMINDER_HOURS = 24;

interface FacilityRef {
  organizationId: string;
  id: string;
}

/**
 * Scheduled VMS jobs.
 *
 * The detection logic already existed as manually-triggered endpoints; without
 * a scheduler nothing ran unless a manager remembered to press a button, which
 * is why sections 1.4 and 4.3 stayed unmet across four review passes. These
 * crons run the same service methods on a timer and route the results through
 * the notification layer.
 *
 * Cron methods run outside a request, so there is no bound tenant context —
 * each job enumerates facilities and passes the scope explicitly, exactly as
 * the reservation reminder cron does.
 */
@Injectable()
export class VmsSchedulerService {
  private readonly logger = new Logger(VmsSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vms: VmsService,
    private readonly notifications: VmsNotificationsService,
  ) {}

  private async activeFacilities(): Promise<FacilityRef[]> {
    try {
      return await this.prisma.facility.findMany({
        where: { active: true },
        select: { organizationId: true, id: true },
      });
    } catch (err) {
      this.logger.error(
        `VMS scheduler could not enumerate facilities: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Every 15 minutes: flag staff who never reported for a confirmed shift and
   * alert managers. Replaces "someone opens the screen and presses a button".
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async runNoShowSweep(): Promise<{ facilities: number; flagged: number }> {
    const facilities = await this.activeFacilities();
    let flagged = 0;

    for (const facility of facilities) {
      try {
        const result = await this.vms.detectNoShows(facility.organizationId, facility.id);
        if (result.flaggedNoShows.length === 0) continue;
        flagged += result.flaggedNoShows.length;

        const lines = result.flaggedNoShows
          .map((n) => `• ${n.role} — order ${n.orderId} (${n.reason})`)
          .join('\n');

        await this.notifications.notify({
          organizationId: facility.organizationId,
          facilityId: facility.id,
          eventType: VmsNotificationEvent.no_show_alert,
          subject: `${result.flaggedNoShows.length} staff no-show(s) detected`,
          body:
            `The following scheduled shifts have passed their start time plus grace period without a clock-in:\n\n` +
            `${lines}\n\n` +
            `Review the Time & Attendance tab to reassign or escalate with the vendor.`,
          entityType: 'VmsTimeAttendance',
        });
      } catch (err) {
        this.logger.error(
          `No-show sweep failed for facility ${facility.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (flagged > 0) this.logger.warn(`VMS no-show sweep flagged ${flagged} shift(s)`);
    return { facilities: facilities.length, flagged };
  }

  /**
   * Hourly: escalate orders inside the 48-hour window that are still short of
   * their requested headcount (checklist 1.4).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runFulfillmentEscalation(): Promise<{ facilities: number; escalated: number }> {
    const facilities = await this.activeFacilities();
    let escalated = 0;

    for (const facility of facilities) {
      try {
        const orders = await this.vms.getUnfilledOrdersNeedingEscalation(
          facility.organizationId,
          facility.id,
        );
        const shortfalls = orders.filter((o) => o.quantityFulfilled < o.quantityRequested);
        if (shortfalls.length === 0) continue;
        escalated += shortfalls.length;

        const lines = shortfalls
          .map(
            (o) =>
              `• ${o.orderNumber} — ${o.roleRequired}: ${o.quantityFulfilled}/${o.quantityRequested} confirmed for ${o.shiftDate} ${o.startTime}`,
          )
          .join('\n');

        await this.notifications.notify({
          organizationId: facility.organizationId,
          facilityId: facility.id,
          eventType: VmsNotificationEvent.fulfillment_failure,
          subject: `${shortfalls.length} order(s) unfilled inside ${ESCALATION_WINDOW_HOURS}h`,
          body:
            `These staffing orders start within ${ESCALATION_WINDOW_HOURS} hours and are still short of the requested headcount:\n\n` +
            `${lines}\n\n` +
            `Route them to additional vendors or reduce scope before the shift.`,
          entityType: 'VmsStaffingOrder',
        });
      } catch (err) {
        this.logger.error(
          `Escalation sweep failed for facility ${facility.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { facilities: facilities.length, escalated };
  }

  /**
   * Daily: warn on certifications expiring inside the 30-day window
   * (checklist 1.2).
   */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async runCertificationExpiryCheck(): Promise<{ facilities: number; expiring: number }> {
    const facilities = await this.activeFacilities();
    let expiring = 0;

    for (const facility of facilities) {
      try {
        const due = await this.vms.listExpiringCertifications(
          facility.organizationId,
          facility.id,
          CERT_WARNING_DAYS,
        );
        if (due.length === 0) continue;
        expiring += due.length;

        const lines = due
          .map((c) => `• ${c.staffName} — ${c.certification} expires ${c.expiresOn} (${c.daysRemaining}d)`)
          .join('\n');

        await this.notifications.notify({
          organizationId: facility.organizationId,
          facilityId: facility.id,
          eventType: VmsNotificationEvent.certification_expiring,
          subject: `${due.length} certification(s) expiring within ${CERT_WARNING_DAYS} days`,
          body:
            `These worker certifications lapse soon and will block assignment once expired:\n\n` +
            `${lines}\n\n` +
            `Collect renewals before the expiry date to keep these workers schedulable.`,
          entityType: 'VmsStaffMember',
        });
      } catch (err) {
        this.logger.error(
          `Certification sweep failed for facility ${facility.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { facilities: facilities.length, expiring };
  }

  /**
   * Daily: remind assigned staff about tomorrow's shifts (checklist 4.3).
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async runShiftReminders(): Promise<{ facilities: number; reminded: number }> {
    const facilities = await this.activeFacilities();
    const targetDate = new Date(Date.now() + SHIFT_REMINDER_HOURS * 3600 * 1000)
      .toISOString()
      .split('T')[0];
    let reminded = 0;

    for (const facility of facilities) {
      try {
        const assignments = await this.prisma.vmsStaffAssignment.findMany({
          where: {
            organizationId: facility.organizationId,
            facilityId: facility.id,
            status: { in: ['assigned', 'confirmed'] },
            order: {
              shiftDate: targetDate,
              status: { in: [VmsOrderStatus.confirmed, VmsOrderStatus.booked] },
            },
          },
          include: {
            order: { select: { orderNumber: true, roleRequired: true, shiftDate: true, startTime: true } },
            staffMember: { select: { firstName: true, lastName: true, email: true } },
          },
        });

        for (const assignment of assignments) {
          if (!assignment.staffMember.email) continue;
          reminded += 1;
          await this.notifications.notify({
            organizationId: facility.organizationId,
            facilityId: facility.id,
            eventType: VmsNotificationEvent.shift_reminder,
            subject: `Shift reminder — ${assignment.order.shiftDate} at ${assignment.order.startTime}`,
            body:
              `You are scheduled as ${assignment.order.roleRequired} on ${assignment.order.shiftDate}, ` +
              `starting ${assignment.order.startTime} (order ${assignment.order.orderNumber}).\n\n` +
              `Please clock in at the kiosk with your PIN or badge when you arrive.`,
            entityType: 'VmsStaffAssignment',
            entityId: assignment.id,
            targets: [
              {
                userId: null,
                email: assignment.staffMember.email,
                fullName: `${assignment.staffMember.firstName} ${assignment.staffMember.lastName}`,
              },
            ],
          });
        }
      } catch (err) {
        this.logger.error(
          `Shift reminder sweep failed for facility ${facility.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { facilities: facilities.length, reminded };
  }
}
