import { describe, expect, it, beforeEach, vi } from 'vitest';
import { VmsService } from './vms.service';
import { VmsAiService } from './vms-ai.service';
import { VmsIntegrationsService } from './vms-integrations.service';
import {
  VmsAttendanceStatus,
  VmsFulfillmentStatus,
  VmsOrderStatus,
  VmsVendorStatus,
  VmsVendorType,
} from '@prisma/client';

describe('VmsService', () => {
  let service: VmsService;
  let aiService: VmsAiService;
  let integrationsService: VmsIntegrationsService;
  let prisma: any;

  const mockOrgId = 'org-1';
  const mockFacilityId = 'facility-1';
  const mockUserId = 'user-mgr-1';

  beforeEach(() => {
    prisma = {
      vmsVendor: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      vmsVendorService: {
        create: vi.fn(),
      },
      vmsStaffMember: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      vmsStaffingOrder: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      vmsOrderFulfillment: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      facility: {
        findUnique: vi.fn(),
      },
      vmsTimeAttendance: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      vmsInventorySyncLog: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      vmsAuditLog: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(prisma)),
    };

    aiService = new VmsAiService();
    integrationsService = new VmsIntegrationsService(prisma);
    service = new VmsService(prisma, aiService, integrationsService);
  });

  describe('Vendor Directory', () => {
    it('creates a new vendor and writes audit log', async () => {
      prisma.vmsVendor.findUnique.mockResolvedValue(null);
      prisma.vmsVendor.create.mockResolvedValue({
        id: 'vendor-1',
        name: 'AllStar Hospitality',
        code: 'ALLSTAR',
        vendorType: VmsVendorType.staffing_agency,
        rating: 5.0,
        status: VmsVendorStatus.active,
      });

      const result = await service.createVendor(
        mockOrgId,
        mockFacilityId,
        {
          name: 'AllStar Hospitality',
          code: 'ALLSTAR',
          contactName: 'Alice Smith',
          contactEmail: 'alice@allstar.com',
        },
        mockUserId,
      );

      expect(result.id).toBe('vendor-1');
      expect(prisma.vmsVendor.create).toHaveBeenCalled();
      expect(prisma.vmsAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CREATE',
            entityType: 'VmsVendor',
          }),
        }),
      );
    });

    it('rejects duplicate vendor code in the same facility', async () => {
      prisma.vmsVendor.findUnique.mockResolvedValue({ id: 'existing-v' });

      await expect(
        service.createVendor(
          mockOrgId,
          mockFacilityId,
          { name: 'Duplicate Vendor', code: 'ALLSTAR' },
          mockUserId,
        ),
      ).rejects.toThrow('Vendor with code ALLSTAR already exists');
    });

    it('adds a service rate card to a vendor', async () => {
      prisma.vmsVendor.findFirst.mockResolvedValue({ id: 'vendor-1' });
      prisma.vmsVendorService.create.mockResolvedValue({
        id: 'vs-1',
        vendorId: 'vendor-1',
        serviceType: 'Bartender',
        hourlyRateCents: 3200,
      });

      const res = await service.addVendorService('vendor-1', mockOrgId, mockFacilityId, {
        serviceType: 'Bartender',
        hourlyRateCents: 3200,
      });

      expect(res.serviceType).toBe('Bartender');
      expect(prisma.vmsVendorService.create).toHaveBeenCalled();
    });
  });

  describe('Staffing Orders & Fulfillment', () => {
    it('creates a staffing order requisition and assigns draft/requested status', async () => {
      prisma.vmsStaffingOrder.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-123456-789',
        title: 'Championship Game Day Suite Staff',
        roleRequired: 'Suite Attendant',
        quantityRequested: 8,
        status: VmsOrderStatus.requested,
      });

      const order = await service.createOrder(
        mockOrgId,
        mockFacilityId,
        {
          title: 'Championship Game Day Suite Staff',
          roleRequired: 'Suite Attendant',
          quantityRequested: 8,
          shiftDate: '2026-09-20',
          startTime: '15:00',
          endTime: '23:00',
          durationHours: 8,
        },
        mockUserId,
      );

      expect(order.id).toBe('order-1');
      expect(prisma.vmsStaffingOrder.create).toHaveBeenCalled();
    });

    it('submits a vendor bid and calculates total bid cents correctly', async () => {
      prisma.vmsStaffingOrder.findFirst.mockResolvedValue({
        id: 'order-1',
        facilityId: mockFacilityId,
        durationHours: 5.0,
      });
      prisma.vmsVendor.findFirst.mockResolvedValue({
        id: 'v-1',
        name: 'Apex Staffing',
        organizationId: mockOrgId,
        facilityId: mockFacilityId,
      });
      prisma.vmsOrderFulfillment.create.mockResolvedValue({
        id: 'ful-1',
        orderId: 'order-1',
        vendorId: 'v-1',
        staffCountAssigned: 4,
        bidHourlyRateCents: 3000,
        totalBidCents: 60000, // 4 staff * 5h * $30 = $600.00
        status: VmsFulfillmentStatus.bid_submitted,
      });

      const bid = await service.submitOrderBid('order-1', mockOrgId, mockFacilityId, {
        vendorId: 'v-1',
        staffCountAssigned: 4,
        bidHourlyRateCents: 3000,
      });

      expect(bid.id).toBe('ful-1');
      expect(prisma.vmsOrderFulfillment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalBidCents: 60000,
          }),
        }),
      );
    });

    it('rejects cross-tenant vendor bid', async () => {
      prisma.vmsStaffingOrder.findFirst.mockResolvedValue({
        id: 'order-1',
        facilityId: mockFacilityId,
        durationHours: 5.0,
      });
      prisma.vmsVendor.findFirst.mockResolvedValue(null); // Vendor not in tenant/facility

      await expect(
        service.submitOrderBid('order-1', mockOrgId, mockFacilityId, {
          vendorId: 'foreign-vendor',
          staffCountAssigned: 4,
          bidHourlyRateCents: 3000,
        }),
      ).rejects.toThrow('Vendor not found');
    });

    it('confirms order bid and updates order fulfilled quantity transactionally', async () => {
      prisma.vmsOrderFulfillment.findUnique.mockResolvedValue({
        id: 'ful-1',
        orderId: 'order-1',
        vendorId: 'v-1',
        staffCountAssigned: 5,
        totalBidCents: 75000,
        order: { facilityId: mockFacilityId, quantityRequested: 5 },
      });
      prisma.vmsOrderFulfillment.update.mockResolvedValue({
        id: 'ful-1',
        status: VmsFulfillmentStatus.confirmed,
      });
      prisma.vmsOrderFulfillment.findMany.mockResolvedValue([
        { staffCountAssigned: 5, totalBidCents: 75000 },
      ]);
      prisma.vmsStaffingOrder.update.mockResolvedValue({
        id: 'order-1',
        status: VmsOrderStatus.confirmed,
        quantityFulfilled: 5,
      });

      const confirmed = await service.confirmOrderBid('ful-1', mockOrgId, mockFacilityId, mockUserId);

      expect(confirmed.status).toBe(VmsFulfillmentStatus.confirmed);
      expect(prisma.vmsStaffingOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            quantityFulfilled: 5,
            status: VmsOrderStatus.confirmed,
          }),
        }),
      );
    });
  });

  describe('Time & Attendance Tracking', () => {
    it('clocks in a staff member', async () => {
      prisma.vmsStaffMember.findFirst.mockResolvedValue({
        id: 'staff-1',
        hourlyRateCents: 2800,
      });
      prisma.vmsTimeAttendance.findFirst.mockResolvedValue(null);
      prisma.vmsTimeAttendance.create.mockResolvedValue({
        id: 'att-1',
        staffMemberId: 'staff-1',
        status: VmsAttendanceStatus.clocked_in,
        billedRateCents: 2800,
      });

      const res = await service.clockIn(mockOrgId, mockFacilityId, {
        staffMemberId: 'staff-1',
      });

      expect(res.id).toBe('att-1');
      expect(res.status).toBe(VmsAttendanceStatus.clocked_in);
    });

    it('clocks out a staff member, calculates hours, and flags meal break exception if missing', async () => {
      const clockInTime = new Date(Date.now() - 6 * 3600 * 1000); // 6 hours ago
      prisma.vmsTimeAttendance.findFirst.mockResolvedValue({
        id: 'att-1',
        staffMemberId: 'staff-1',
        clockIn: clockInTime,
        status: VmsAttendanceStatus.clocked_in,
        billedRateCents: 2500,
        staffMember: { id: 'staff-1', pinHash: null, pinSalt: null, badgeNumber: null },
      });
      prisma.vmsTimeAttendance.update.mockImplementation((args: any) => Promise.resolve(args.data));

      const res = await service.clockOut(mockOrgId, mockFacilityId, {
        attendanceId: 'att-1',
        breakMinutes: 10, // < 30m after 6h
      });

      expect(res.deviationFlags).toContain('meal_break_penalty');
      expect(res.status).toBe(VmsAttendanceStatus.flagged_exception);
      expect(res.billableHours).toBeGreaterThanOrEqual(5.8);
    });

    it('approves attendance record and writes audit trail', async () => {
      prisma.vmsTimeAttendance.findFirst.mockResolvedValue({ id: 'att-1' });
      prisma.vmsTimeAttendance.update.mockResolvedValue({
        id: 'att-1',
        status: VmsAttendanceStatus.approved,
        billableHours: 6.0,
        totalBilledCents: 15000,
      });

      const approved = await service.approveAttendance(
        'att-1',
        mockOrgId,
        mockFacilityId,
        mockUserId,
      );

      expect(approved.status).toBe(VmsAttendanceStatus.approved);
      expect(prisma.vmsAuditLog.create).toHaveBeenCalled();
    });
  });

  describe('Integrations & Scorecards', () => {
    it('generates ADP payroll CSV export with overtime and meal penalties', async () => {
      prisma.vmsTimeAttendance.findMany.mockResolvedValue([
        {
          id: 'att-1',
          staffMember: { id: 'sm-101', firstName: 'John', lastName: 'Doe' },
          clockIn: new Date('2026-09-01T14:00:00Z'),
          hoursWorked: 9.5, // 8 reg + 1.5 OT
          billedRateCents: 3000,
          deviationFlags: ['meal_break_penalty'],
        },
      ]);

      const res = await service.exportPayrollAdp(mockOrgId, mockFacilityId);

      expect(res.rowCount).toBeGreaterThanOrEqual(2); // REG + OT + MEAL_PENALTY
      expect(res.csvContent).toContain('REG');
      expect(res.csvContent).toContain('OT');
      expect(res.csvContent).toContain('MEAL_PENALTY');
      expect(res.csvContent).toContain('Doe, John');
    });

    it('generates Gusto payroll JSON export', async () => {
      prisma.vmsTimeAttendance.findMany.mockResolvedValue([
        {
          id: 'att-1',
          staffMember: { id: 'sm-101', firstName: 'John', lastName: 'Doe' },
          clockIn: new Date('2026-09-01T14:00:00Z'),
          hoursWorked: 8.0,
          billedRateCents: 2500,
        },
      ]);

      const res = await service.exportPayrollGusto(mockOrgId, mockFacilityId);

      expect(res.records).toHaveLength(1);
      expect(res.records[0].regularHours).toBe(8.0);
      expect(res.records[0].grossPay).toBe(200.0);
    });

    it('calculates vendor scorecard metrics', async () => {
      prisma.vmsVendor.findMany.mockResolvedValue([
        {
          id: 'v-1',
          name: 'Apex Staffing',
          code: 'APEX',
          rating: 4.8,
          orderFulfillments: [
            { status: VmsFulfillmentStatus.confirmed },
            { status: VmsFulfillmentStatus.confirmed },
          ],
          staffMembers: [
            {
              attendances: [
                { totalBilledCents: 25000, deviationFlags: [] },
                { totalBilledCents: 25000, deviationFlags: [] },
              ],
            },
          ],
        },
      ]);

      const scorecard = await service.getVendorScorecard(mockOrgId, mockFacilityId);

      expect(scorecard).toHaveLength(1);
      expect(scorecard[0].vendorName).toBe('Apex Staffing');
      expect(scorecard[0].fulfillmentRatePercent).toBe(100);
      expect(scorecard[0].onTimeRatePercent).toBe(100);
      expect(scorecard[0].tierStatus).toBe('Tier 1 Preferred');
    });

    it('triggers Yellow Dog inventory sync', async () => {
      const res = await service.syncInventory(mockOrgId, mockFacilityId);

      expect(['success', 'demo_mode']).toContain(res.status);
      expect(res.itemsSynced).toBeGreaterThan(0);
      expect(res.supplies.length).toBeGreaterThan(0);
      expect(prisma.vmsInventorySyncLog.create).toHaveBeenCalled();
    });

    it('reads inventory status without inserting new sync logs', async () => {
      prisma.vmsInventorySyncLog.findMany.mockResolvedValue([
        { id: 'log-1', system: 'yellow_dog', createdAt: new Date() },
      ]);
      prisma.vmsInventorySyncLog.findFirst.mockResolvedValue({
        id: 'log-1',
        createdAt: new Date(),
        status: 'success',
        metadata: { catalogSnapshot: [{ sku: 'YD-UNI-1', remainingStock: 50 }] },
      });
      prisma.vmsInventorySyncLog.create.mockClear();

      const status = await service.getInventoryStatus(mockOrgId, mockFacilityId);

      expect(status.supplies).toHaveLength(1);
      expect(prisma.vmsInventorySyncLog.create).not.toHaveBeenCalled();
    });

    it('guards vendor deletion against active fulfillments', async () => {
      prisma.vmsVendor.findFirst.mockResolvedValue({ id: 'v-1', name: 'Busy Vendor' });
      prisma.vmsOrderFulfillment.count.mockResolvedValue(2);

      await expect(
        service.deleteVendor('v-1', mockOrgId, mockFacilityId, mockUserId),
      ).rejects.toThrow('Cannot delete vendor');
    });

    it('soft deactivates vendor successfully', async () => {
      prisma.vmsVendor.findFirst.mockResolvedValue({ id: 'v-1', name: 'Vendor To Pause', status: VmsVendorStatus.active });
      prisma.vmsVendor.update.mockResolvedValue({ id: 'v-1', status: VmsVendorStatus.inactive });

      const res = await service.deactivateVendor('v-1', mockOrgId, mockFacilityId, mockUserId, 'Seasonal end');
      expect(res.status).toBe(VmsVendorStatus.inactive);
      expect(prisma.vmsVendor.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VmsVendorStatus.inactive } }),
      );
    });

    it('detects off-site punch when GPS exceeds 500m geofence', async () => {
      prisma.vmsStaffMember.findFirst.mockResolvedValue({
        id: 'staff-1',
        hourlyRateCents: 2500,
      });
      prisma.vmsTimeAttendance.findFirst.mockResolvedValue(null);
      prisma.facility.findUnique.mockResolvedValue({
        latitude: 37.7749, // San Francisco
        longitude: -122.4194,
      });
      prisma.vmsTimeAttendance.create.mockImplementation((args: any) => Promise.resolve(args.data));

      const punch = await service.clockIn(mockOrgId, mockFacilityId, {
        staffMemberId: 'staff-1',
        gpsLatitude: 37.8049, // ~3.3km away (out of 500m geofence)
        gpsLongitude: -122.4194,
      }, { isManager: true });

      expect(punch.isWithinGeofence).toBe(false);
      expect(punch.deviationFlags).toContain('off_site_punch');
    });

    it('rejects clock-out when break minutes exceed shift hours', async () => {
      const clockInTime = new Date(Date.now() - 2 * 3600 * 1000); // 2 hours ago
      prisma.vmsTimeAttendance.findFirst.mockResolvedValue({
        id: 'att-1',
        staffMember: { id: 'staff-1' },
        clockIn: clockInTime,
        status: VmsAttendanceStatus.clocked_in,
        billedRateCents: 2500,
        deviationFlags: [],
      });

      await expect(
        service.clockOut(mockOrgId, mockFacilityId, {
          attendanceId: 'att-1',
          breakMinutes: 180, // 3 hours break on a 2 hour shift!
        }, { isManager: true }),
      ).rejects.toThrow('Break minutes cannot exceed total shift duration');
    });

    it('returns explicit null without fabricated fallback when vendor has 0 punches', async () => {
      prisma.vmsVendor.findMany.mockResolvedValue([
        {
          id: 'v-new',
          name: 'Brand New Vendor',
          code: 'NEW',
          rating: 5.0,
          orderFulfillments: [],
          staffMembers: [],
        },
      ]);

      const scorecard = await service.getVendorScorecard(mockOrgId, mockFacilityId);

      expect(scorecard).toHaveLength(1);
      expect(scorecard[0].onTimeRatePercent).toBeNull();
      expect(scorecard[0].fulfillmentRatePercent).toBeNull();
      expect(scorecard[0].hasData).toBe(false);
    });
  });
});
