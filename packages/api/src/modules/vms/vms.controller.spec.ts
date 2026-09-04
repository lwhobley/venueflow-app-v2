import { describe, expect, it, beforeEach, vi } from 'vitest';
import { VmsController } from './vms.controller';
import { ForbiddenException } from '@nestjs/common';
import { VmsOrderStatus, VmsVendorType } from '@prisma/client';

describe('VmsController', () => {
  let controller: VmsController;
  let service: any;
  let prisma: any;

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
      detectNoShows: vi.fn().mockResolvedValue({ scannedOrdersCount: 1, flaggedNoShowsCount: 0, flaggedNoShows: [] }),
      exportAuditLogs: vi.fn().mockResolvedValue('Timestamp,Entity Type\n2026-09-04,VmsVendor'),
    };

    prisma = {
      venue: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
    };

    controller = new VmsController(service, prisma);
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
