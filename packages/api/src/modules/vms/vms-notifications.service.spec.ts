import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VmsNotificationEvent, VmsNotificationStatus } from '@prisma/client';
import { VmsNotificationsService } from './vms-notifications.service';

const ORG = 'org-1';
const FACILITY = 'facility-1';

describe('VmsNotificationsService (checklist 4.3)', () => {
  let prisma: any;
  let email: any;
  let config: any;
  let service: VmsNotificationsService;

  beforeEach(() => {
    prisma = {
      venue: { findUnique: vi.fn().mockResolvedValue({ name: 'Rose Bowl' }) },
      profile: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'user-1', email: 'manager@venue.test', fullName: 'Dana Reed' },
        ]),
      },
      vmsNotificationPreference: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      vmsNotificationLog: {
        create: vi.fn().mockResolvedValue({ id: 'log-1' }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    email = { sendOrThrow: vi.fn().mockResolvedValue(undefined) };
    config = { get: vi.fn().mockReturnValue(undefined) };
    service = new VmsNotificationsService(prisma, email, config);
  });

  it('sends to venue managers and records a sent delivery row', async () => {
    const result = await service.notify({
      organizationId: ORG,
      facilityId: FACILITY,
      eventType: VmsNotificationEvent.order_submitted,
      subject: 'Staffing order ORD-1 submitted',
      body: 'A new staffing order has been raised.',
    });

    expect(result.sent).toBe(1);
    expect(result.suppressed).toBe(0);
    expect(email.sendOrThrow).toHaveBeenCalledTimes(1);

    const sent = email.sendOrThrow.mock.calls[0][0];
    expect(sent.to).toBe('manager@venue.test');
    // Venue branding prefixes the subject.
    expect(sent.subject).toBe('Rose Bowl — Staffing order ORD-1 submitted');
    expect(sent.text).toContain('Hi Dana,');

    expect(prisma.vmsNotificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: VmsNotificationStatus.sent }),
      }),
    );
  });

  it('honours an opt-out and records it as suppressed rather than dropping it', async () => {
    prisma.vmsNotificationPreference.findMany.mockResolvedValue([
      { userId: 'user-1', emailEnabled: false, smsEnabled: false },
    ]);

    const result = await service.notify({
      organizationId: ORG,
      facilityId: FACILITY,
      eventType: VmsNotificationEvent.order_submitted,
      subject: 'Staffing order ORD-1 submitted',
      body: 'body',
    });

    expect(result.sent).toBe(0);
    expect(result.suppressed).toBe(1);
    expect(email.sendOrThrow).not.toHaveBeenCalled();
    expect(prisma.vmsNotificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: VmsNotificationStatus.suppressed,
          errorMessage: expect.stringContaining('opted out'),
        }),
      }),
    );
  });

  it('treats a missing preference row as opted in', async () => {
    prisma.vmsNotificationPreference.findMany.mockResolvedValue([]);

    const result = await service.notify({
      organizationId: ORG,
      facilityId: FACILITY,
      eventType: VmsNotificationEvent.shift_reminder,
      subject: 'Shift reminder',
      body: 'body',
    });

    expect(result.sent).toBe(1);
  });

  it('records a failed delivery instead of throwing into the caller', async () => {
    email.sendOrThrow.mockRejectedValue(new Error('provider timeout'));

    const result = await service.notify({
      organizationId: ORG,
      facilityId: FACILITY,
      eventType: VmsNotificationEvent.no_show_alert,
      subject: 'No-show detected',
      body: 'body',
    });

    expect(result.failed).toBe(1);
    expect(prisma.vmsNotificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: VmsNotificationStatus.failed,
          errorMessage: 'provider timeout',
        }),
      }),
    );
  });

  it('marks SMS as suppressed when no provider is configured', async () => {
    prisma.vmsNotificationPreference.findMany.mockResolvedValue([
      { userId: 'user-1', emailEnabled: true, smsEnabled: true },
    ]);

    await service.notify({
      organizationId: ORG,
      facilityId: FACILITY,
      eventType: VmsNotificationEvent.no_show_alert,
      subject: 'No-show detected',
      body: 'body',
    });

    const smsRow = prisma.vmsNotificationLog.create.mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => d.channel === 'sms');

    expect(smsRow.status).toBe(VmsNotificationStatus.suppressed);
    expect(smsRow.errorMessage).toContain('not configured');
  });

  it('does not attempt SMS for non-critical events even when opted in', async () => {
    prisma.vmsNotificationPreference.findMany.mockResolvedValue([
      { userId: 'user-1', emailEnabled: true, smsEnabled: true },
    ]);

    await service.notify({
      organizationId: ORG,
      facilityId: FACILITY,
      eventType: VmsNotificationEvent.shift_reminder,
      subject: 'Shift reminder',
      body: 'body',
    });

    const channels = prisma.vmsNotificationLog.create.mock.calls.map((c: any[]) => c[0].data.channel);
    expect(channels).not.toContain('sms');
  });

  it('sends to explicit targets when given, bypassing manager resolution', async () => {
    await service.notify({
      organizationId: ORG,
      facilityId: FACILITY,
      eventType: VmsNotificationEvent.shift_reminder,
      subject: 'Shift reminder',
      body: 'body',
      targets: [{ userId: null, email: 'worker@test.io', fullName: 'Rosa Klein' }],
    });

    expect(prisma.profile.findMany).not.toHaveBeenCalled();
    expect(email.sendOrThrow.mock.calls[0][0].to).toBe('worker@test.io');
  });

  it('returns a zero result when there is nobody to notify', async () => {
    prisma.profile.findMany.mockResolvedValue([]);

    const result = await service.notify({
      organizationId: ORG,
      facilityId: FACILITY,
      eventType: VmsNotificationEvent.order_submitted,
      subject: 'subject',
      body: 'body',
    });

    expect(result.attempted).toBe(0);
    expect(email.sendOrThrow).not.toHaveBeenCalled();
  });
});
