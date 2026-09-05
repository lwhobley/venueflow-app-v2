import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { VmsController } from './vms.controller';
import { ForbiddenException } from '@nestjs/common';
import { VmsOrderStatus, VmsVendorType } from '@prisma/client';

describe('VmsController', () => {
  let controller: VmsController;
  let service: any;
  let prisma: any;
  let workforce: any;
  let notifications: any;
  let scheduler: any;

  const managerScope: any = {
    venueId: 'fac-1',
    organizationId: 'org-1',
    role: 'manager',
    allAccess: false,
    userId: 'user-mgr',
  };

  const staffScope: any = {
    venueId: 'fac-1',
    organizationId: 'org-1',
    role: 'server',
    allAccess: false,
    userId: 'user-staff',
  };

  beforeEach(() => {
    service = {
      listVendors: vi.fn().mockResolvedValue([{ id: 'v-1', name: 'Apex Staffing' }]),
      createVendor: vi.fn().mockResolvedValue({ id: 'v-1', name: 'Apex Staffing' }),
      createOrder: vi.fn().mockResolvedValue({ id: 'ord-1', title: 'Test Order' }),
      matchVendorsForOrder: vi.fn().mockResolvedValue([{ vendorId: 'v-1', fitScorePercent: 95 }]),
      clockIn: vi.fn().mockResolvedValue({ id: 'att-1', status: 'clocked_in' }),
      clockOut: vi.fn().mockResolvedValue({ id: 'att-1', status: 'clocked_out' }),
      syncInventory: vi.fn().mockResolvedValue({ status: 'success', itemsSynced: 5 }),
      exportPayrollAdp: vi.fn().mockResolvedValue({ csvContent: 'Co Code,Hours\nVNW,8.0', rowCount: 1 }),
      logAudit: vi.fn().mockResolvedValue(undefined),
      listExpiringCertifications: vi.fn().mockResolvedValue([]),
      getOrder: vi.fn().mockResolvedValue({ id: 'order-1', title: 'T', roleRequired: 'Bartender', quantityRequested: 2, shiftDate: '2026-09-10', startTime: '16:00', endTime: '22:00', durationHours: 6, budgetCents: 1000, specialRequirements: null, templateName: null }),
      detectNoShows: vi.fn().mockResolvedValue({ scannedOrdersCount: 1, flaggedNoShowsCount: 0, flaggedNoShows: [] }),
      exportAuditLogs: vi.fn().mockResolvedValue('Timestamp,Entity Type\n2026-09-04,VmsVendor'),
    };

    prisma = {
      venue: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
    };

    workforce = {
      listAssignments: vi.fn().mockResolvedValue([]),
      assignStaffToOrder: vi.fn().mockResolvedValue({ id: 'assign-1' }),
      releaseAssignment: vi.fn().mockResolvedValue({ id: 'assign-1', orderId: 'o-1', staffMemberId: 's-1' }),
      listAvailability: vi.fn().mockResolvedValue([]),
      setAvailability: vi.fn().mockResolvedValue({ id: 'avail-1' }),
      getAvailabilityCalendar: vi.fn().mockResolvedValue({ assignments: [], unavailableBlocks: [], conflicts: [] }),
      listTemplates: vi.fn().mockResolvedValue([]),
      createTemplate: vi.fn().mockResolvedValue({ id: 'tpl-1' }),
      deleteTemplate: vi.fn().mockResolvedValue({ success: true }),
      getTemplate: vi.fn().mockResolvedValue({ id: 'tpl-1', name: 'Game Day', roleRequired: 'Bartender', quantityRequested: 4, startTime: '16:00', endTime: '22:00', durationHours: 6, budgetCents: 0, specialRequirements: null }),
      importVendorsCsv: vi.fn().mockResolvedValue({ parsed: 1, imported: 1, skipped: 0, errors: [] }),
      importStaffCsv: vi.fn().mockResolvedValue({ parsed: 1, imported: 1, skipped: 0, errors: [] }),
      exportVendorsCsv: vi.fn().mockResolvedValue('Name,Code'),
      exportStaffCsv: vi.fn().mockResolvedValue('First Name,Last Name'),
    };

    notifications = {
      listDeliveryLog: vi.fn().mockResolvedValue({ rows: [], total: 0, page: 1, limit: 50 }),
      listPreferences: vi.fn().mockResolvedValue([]),
      setPreference: vi.fn().mockResolvedValue({ id: 'pref-1' }),
    };

    scheduler = {
      runNoShowSweep: vi.fn().mockResolvedValue({ facilities: 1, flagged: 0 }),
      runFulfillmentEscalation: vi.fn().mockResolvedValue({ facilities: 1, escalated: 0 }),
      runCertificationExpiryCheck: vi.fn().mockResolvedValue({ facilities: 1, expiring: 0 }),
    };

    controller = new VmsController(service, prisma, workforce, notifications, scheduler);
  });

  it('allows manager to list vendors', async () => {
    const res = await controller.listVendors(managerScope);
    expect(res).toHaveLength(1);
    expect(service.listVendors).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        facilityId: 'fac-1',
      }),
    );
  });

  it('forbids non-manager from listing vendors', async () => {
    await expect(controller.listVendors(staffScope)).rejects.toThrow(ForbiddenException);
  });

  it('allows manager to create a staffing order', async () => {
    const res = await controller.createOrder(managerScope, {
      title: 'Game Day Concessions',
      roleRequired: 'Cashier',
      quantityRequested: 10,
      shiftDate: '2026-09-25',
      startTime: '16:00',
      endTime: '22:00',
    });

    expect(res.id).toBe('ord-1');
    expect(service.createOrder).toHaveBeenCalled();
  });

  it('calls Gemini smart vendor matching endpoint', async () => {
    const matches = await controller.matchVendorsForOrder(managerScope, 'ord-1');
    expect(matches).toHaveLength(1);
    expect(matches[0].fitScorePercent).toBe(95);
    expect(service.matchVendorsForOrder).toHaveBeenCalledWith('ord-1', 'org-1', 'fac-1');
  });

  it('allows staff to clock in with credential', async () => {
    const punch = await controller.clockIn(staffScope, { staffMemberId: 'staff-123', pin: '1234' }, { ip: '127.0.0.1' });
    expect(punch.status).toBe('clocked_in');
    expect(service.clockIn).toHaveBeenCalledWith(
      'org-1',
      'fac-1',
      { staffMemberId: 'staff-123', pin: '1234' },
      expect.objectContaining({ isManager: false }),
    );
  });

  it('rejects uncredentialed self-punch from non-manager', async () => {
    await expect(
      controller.clockIn(staffScope, { staffMemberId: 'staff-123' }, { ip: '127.0.0.1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('triggers Yellow Dog inventory synchronization', async () => {
    const sync = await controller.triggerInventorySync(managerScope, {});
    expect(sync.status).toBe('success');
    expect(service.syncInventory).toHaveBeenCalled();
  });

  it('exports ADP payroll CSV for manager', async () => {
    const csv = await controller.exportPayrollAdp(managerScope);
    expect(csv).toContain('Co Code');
    expect(service.exportPayrollAdp).toHaveBeenCalledWith('org-1', 'fac-1');
  });

  it('triggers no-show detection for manager', async () => {
    const res = await controller.detectNoShows(managerScope, '30');
    expect(res.scannedOrdersCount).toBe(1);
    expect(service.detectNoShows).toHaveBeenCalledWith('org-1', 'fac-1', 30);
  });

  it('exports audit logs for manager', async () => {
    const csv = await controller.exportAuditLogs(managerScope, undefined, undefined, undefined, 'csv');
    expect(csv).toContain('Timestamp,Entity Type');
    expect(service.exportAuditLogs).toHaveBeenCalledWith('org-1', 'fac-1', expect.objectContaining({ format: 'csv' }));
  });
});

/**
 * Nest resolves routes in declaration order, so a literal segment declared
 * after a parameterised one at the same depth is unreachable — `vendors/export`
 * sitting below `vendors/:id` was silently answered by the vendor lookup with
 * id="export". This guard is static so it fails at test time rather than in a
 * browser.
 */
describe('VmsController route declaration order', () => {
  const source = readFileSync(join(__dirname, 'vms.controller.ts'), 'utf-8');

  const routes = Array.from(
    source.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/g),
  ).map((match) => ({ method: match[1], path: match[2] }));

  it('parses the controller route table', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it('never declares a literal segment behind a parameterised one', () => {
    const shadowed: string[] = [];

    routes.forEach((route, index) => {
      const segments = route.path.split('/');
      if (segments.some((s) => s.startsWith(':'))) return;

      for (let earlier = 0; earlier < index; earlier++) {
        const candidate = routes[earlier];
        if (candidate.method !== route.method) continue;

        const candidateSegments = candidate.path.split('/');
        if (candidateSegments.length !== segments.length) continue;

        const shadows = candidateSegments.every(
          (segment, i) => segment.startsWith(':') || segment === segments[i],
        );
        const hasParam = candidateSegments.some((segment) => segment.startsWith(':'));

        if (shadows && hasParam) {
          shadowed.push(`${route.method} ${route.path} is shadowed by ${candidate.path}`);
        }
      }
    });

    expect(shadowed).toEqual([]);
  });
});
