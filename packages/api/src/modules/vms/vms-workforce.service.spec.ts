import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VmsWorkforceService, parseCsv, csvCell } from './vms-workforce.service';

const ORG = 'org-1';
const FACILITY = 'facility-1';

describe('parseCsv', () => {
  it('handles quoted fields, embedded commas and escaped quotes', () => {
    const rows = parseCsv('name,note\n"Acme, Inc.","He said ""hi"""\n');
    expect(rows).toEqual([
      ['name', 'note'],
      ['Acme, Inc.', 'He said "hi"'],
    ]);
  });

  it('drops fully blank lines rather than emitting empty records', () => {
    const rows = parseCsv('a,b\n1,2\n\n3,4\n');
    expect(rows).toHaveLength(3);
  });

  it('round-trips values that contain quotes through csvCell', () => {
    const encoded = ['O"Brien', 'plain'].map(csvCell).join(',');
    expect(parseCsv('h1,h2\n' + encoded)[1]).toEqual(['O"Brien', 'plain']);
  });
});

describe('VmsWorkforceService', () => {
  let prisma: any;
  let service: VmsWorkforceService;

  beforeEach(() => {
    prisma = {
      vmsStaffAvailability: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      vmsStaffAssignment: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        upsert: vi.fn().mockResolvedValue({ id: 'assign-1' }),
        update: vi.fn(),
      },
      vmsStaffingOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'order-1',
          shiftDate: '2026-09-10',
          status: 'confirmed',
        }),
      },
      vmsStaffMember: {
        findFirst: vi.fn().mockResolvedValue({ id: 'staff-1' }),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      vmsVendor: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      vmsOrderTemplate: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    };
    service = new VmsWorkforceService(prisma);
  });

  describe('assignment conflicts (checklist 1.2)', () => {
    it('reports an unavailable window as a conflict', async () => {
      prisma.vmsStaffAvailability.findMany.mockResolvedValue([
        {
          startDate: new Date('2026-09-09T00:00:00Z'),
          endDate: new Date('2026-09-12T00:00:00Z'),
          reason: 'Annual leave',
        },
      ]);

      const conflicts = await service.findAssignmentConflicts({
        organizationId: ORG,
        facilityId: FACILITY,
        staffMemberId: 'staff-1',
        shiftDate: '2026-09-10',
      });

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].kind).toBe('unavailable_window');
      expect(conflicts[0].detail).toContain('Annual leave');
    });

    it('reports a same-day double booking as a conflict', async () => {
      prisma.vmsStaffAssignment.findMany.mockResolvedValue([
        {
          order: { id: 'order-9', orderNumber: 'ORD-9', startTime: '16:00', endTime: '22:00' },
        },
      ]);

      const conflicts = await service.findAssignmentConflicts({
        organizationId: ORG,
        facilityId: FACILITY,
        staffMemberId: 'staff-1',
        shiftDate: '2026-09-10',
      });

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].kind).toBe('overlapping_shift');
      expect(conflicts[0].conflictingOrderId).toBe('order-9');
    });

    it('refuses the assignment when a conflict exists and force is not set', async () => {
      prisma.vmsStaffAvailability.findMany.mockResolvedValue([
        {
          startDate: new Date('2026-09-09T00:00:00Z'),
          endDate: new Date('2026-09-12T00:00:00Z'),
          reason: 'Annual leave',
        },
      ]);

      await expect(
        service.assignStaffToOrder({
          organizationId: ORG,
          facilityId: FACILITY,
          orderId: 'order-1',
          staffMemberId: 'staff-1',
        }),
      ).rejects.toThrow(/force=true to override/);
    });

    it('records the override in notes when forced through a conflict', async () => {
      prisma.vmsStaffAvailability.findMany.mockResolvedValue([
        {
          startDate: new Date('2026-09-09T00:00:00Z'),
          endDate: new Date('2026-09-12T00:00:00Z'),
          reason: 'Annual leave',
        },
      ]);

      await service.assignStaffToOrder({
        organizationId: ORG,
        facilityId: FACILITY,
        orderId: 'order-1',
        staffMemberId: 'staff-1',
        force: true,
      });

      const call = prisma.vmsStaffAssignment.upsert.mock.calls[0][0];
      expect(call.create.notes).toContain('[override]');
    });

    it('refuses to staff a cancelled order', async () => {
      prisma.vmsStaffingOrder.findFirst.mockResolvedValue({
        id: 'order-1',
        shiftDate: '2026-09-10',
        status: 'cancelled',
      });

      await expect(
        service.assignStaffToOrder({
          organizationId: ORG,
          facilityId: FACILITY,
          orderId: 'order-1',
          staffMemberId: 'staff-1',
        }),
      ).rejects.toThrow(/cancelled order/);
    });
  });

  describe('certification expiry (checklist 1.2)', () => {
    it('flags certifications inside the 30-day window from an array payload', async () => {
      const soon = new Date(Date.now() + 10 * 86400 * 1000).toISOString();
      prisma.vmsStaffMember.findMany.mockResolvedValue([
        {
          id: 'staff-1',
          firstName: 'Rosa',
          lastName: 'Klein',
          certifications: [{ name: 'TIPS', expiresAt: soon }],
        },
      ]);

      const due = await service.listExpiringCertifications(ORG, FACILITY, 30);

      expect(due).toHaveLength(1);
      expect(due[0].certification).toBe('TIPS');
      expect(due[0].staffName).toBe('Rosa Klein');
      expect(due[0].expired).toBe(false);
      expect(due[0].daysRemaining).toBeLessThanOrEqual(10);
    });

    it('accepts the object-map payload shape as well', async () => {
      const soon = new Date(Date.now() + 5 * 86400 * 1000).toISOString();
      prisma.vmsStaffMember.findMany.mockResolvedValue([
        { id: 'staff-2', firstName: 'A', lastName: 'B', certifications: { 'Food Handler': soon } },
      ]);

      const due = await service.listExpiringCertifications(ORG, FACILITY, 30);
      expect(due[0].certification).toBe('Food Handler');
    });

    it('marks an already-lapsed certification as expired', async () => {
      const past = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
      prisma.vmsStaffMember.findMany.mockResolvedValue([
        { id: 'staff-3', firstName: 'C', lastName: 'D', certifications: [{ name: 'TIPS', expiresAt: past }] },
      ]);

      const due = await service.listExpiringCertifications(ORG, FACILITY, 30);
      expect(due[0].expired).toBe(true);
      expect(due[0].daysRemaining).toBeLessThan(0);
    });

    it('ignores certifications beyond the window and unparseable dates', async () => {
      const far = new Date(Date.now() + 200 * 86400 * 1000).toISOString();
      prisma.vmsStaffMember.findMany.mockResolvedValue([
        {
          id: 'staff-4',
          firstName: 'E',
          lastName: 'F',
          certifications: [{ name: 'Far', expiresAt: far }, { name: 'Bad', expiresAt: 'not-a-date' }],
        },
      ]);

      const due = await service.listExpiringCertifications(ORG, FACILITY, 30);
      expect(due).toHaveLength(0);
    });
  });

  describe('CSV import (checklist 1.1, 1.2)', () => {
    it('imports vendors and skips codes that already exist', async () => {
      prisma.vmsVendor.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing' });

      const result = await service.importVendorsCsv(
        ORG,
        FACILITY,
        'name,code,contactEmail\nApex Staffing,APEX,ops@apex.test\nDuplicate Co,APEX,dup@apex.test\n',
      );

      expect(result.parsed).toBe(2);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.errors[0].reason).toContain('already exists');
    });

    it('rejects a CSV without the required header columns', async () => {
      await expect(
        service.importVendorsCsv(ORG, FACILITY, 'foo,bar\n1,2\n'),
      ).rejects.toThrow(/must include at least/);
    });

    it('imports staff, splitting skills and resolving the vendor code', async () => {
      prisma.vmsStaffMember.findFirst.mockResolvedValue(null);
      prisma.vmsVendor.findUnique.mockResolvedValue({ id: 'vendor-99' });

      const result = await service.importStaffCsv(
        ORG,
        FACILITY,
        'firstName,lastName,email,skills,hourlyRateCents,vendorCode\nRosa,Klein,rosa@test.io,Bartender;TIPS,3200,APEX\n',
      );

      expect(result.imported).toBe(1);
      const created = prisma.vmsStaffMember.create.mock.calls[0][0].data;
      expect(created.skills).toEqual(['Bartender', 'TIPS']);
      expect(created.hourlyRateCents).toBe(3200);
      expect(created.vendorId).toBe('vendor-99');
    });

    it('does not duplicate staff on a repeated import of the same file', async () => {
      prisma.vmsStaffMember.findFirst.mockResolvedValue({ id: 'already-there' });

      const result = await service.importStaffCsv(
        ORG,
        FACILITY,
        'firstName,lastName,email\nRosa,Klein,rosa@test.io\n',
      );

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(prisma.vmsStaffMember.create).not.toHaveBeenCalled();
    });

    it('skips a staff row whose vendor code cannot be resolved', async () => {
      prisma.vmsStaffMember.findFirst.mockResolvedValue(null);
      prisma.vmsVendor.findUnique.mockResolvedValue(null);

      const result = await service.importStaffCsv(
        ORG,
        FACILITY,
        'firstName,lastName,vendorCode\nRosa,Klein,GHOST\n',
      );

      expect(result.imported).toBe(0);
      expect(result.errors[0].reason).toContain('Unknown vendor code');
    });
  });

  describe('CSV export (checklist 1.1, 1.2)', () => {
    it('never emits credential columns on the staff roster export', async () => {
      prisma.vmsStaffMember.findMany.mockResolvedValue([
        {
          firstName: 'Rosa',
          lastName: 'Klein',
          email: 'rosa@test.io',
          phone: null,
          workforceType: 'agency_temp',
          status: 'active',
          skills: ['Bartender'],
          hourlyRateCents: 3200,
          badgeNumber: 'B-1',
          pinHash: 'super-secret-hash',
          pinSalt: 'super-secret-salt',
          vendor: { name: 'Apex', code: 'APEX' },
        },
      ]);

      const csv = await service.exportStaffCsv(ORG, FACILITY);

      expect(csv).toContain('Rosa');
      expect(csv).not.toContain('super-secret-hash');
      expect(csv).not.toContain('super-secret-salt');
    });

    it('exports the vendor directory with service types flattened', async () => {
      prisma.vmsVendor.findMany.mockResolvedValue([
        {
          name: 'Apex Staffing',
          code: 'APEX',
          vendorType: 'staffing_agency',
          status: 'active',
          contactName: 'Dana',
          contactEmail: 'ops@apex.test',
          contactPhone: null,
          rating: 4.8,
          billingRateMultiplier: 1.35,
          taxId: null,
          insuranceExpiry: null,
          services: [{ serviceType: 'Bartender' }, { serviceType: 'Server' }],
          _count: { staffMembers: 12, orderFulfillments: 4 },
        },
      ]);

      const csv = await service.exportVendorsCsv(ORG, FACILITY);
      const rows = parseCsv(csv);

      expect(rows[0][0]).toBe('Name');
      expect(rows[1][0]).toBe('Apex Staffing');
      expect(rows[1]).toContain('Bartender; Server');
    });
  });
});
