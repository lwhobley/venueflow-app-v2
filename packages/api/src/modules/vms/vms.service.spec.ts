import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { VmsService, hashPin } from './vms.service';
import { VmsAiService } from './vms-ai.service';
import { VmsIntegrationsService } from './vms-integrations.service';
import { VmsWorkforceService } from './vms-workforce.service';
import { VmsNotificationsService } from './vms-notifications.service';
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
  let workforceService: VmsWorkforceService;
  let notificationsService: VmsNotificationsService;
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
        groupBy: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      facility: {
        findUnique: vi.fn().mockResolvedValue({ timezone: 'UTC' }),
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
      vmsStaffAssignment: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      vmsStaffAvailability: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      vmsOrderTemplate: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
      vmsNotificationPreference: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      vmsNotificationLog: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      vmsPunchLockout: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
      venue: {
        findUnique: vi.fn().mockResolvedValue({ name: 'Test Stadium' }),
      },
      profile: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (cb) => cb(prisma)),
    };

    aiService = new VmsAiService();
    integrationsService = new VmsIntegrationsService(prisma);
    workforceService = new VmsWorkforceService(prisma);
    notificationsService = new VmsNotificationsService(
      prisma,
      { send: vi.fn(), sendOrThrow: vi.fn() } as any,
      { get: vi.fn().mockReturnValue(undefined) } as any,
    );
    service = new VmsService(
      prisma,
      aiService,
      integrationsService,
      workforceService,
      notificationsService,
    );
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

      const res = await service.clockIn(
        mockOrgId,
        mockFacilityId,
        { staffMemberId: 'staff-1' },
        { isManager: true },
      );

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

      const res = await service.clockOut(
        mockOrgId,
        mockFacilityId,
        {
          attendanceId: 'att-1',
          breakMinutes: 10, // < 30m after 6h
        },
        { isManager: true },
      );

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

    it('calculates vendor scorecard metrics from database aggregates (F9)', async () => {
      prisma.vmsVendor.findMany.mockResolvedValue([
        { id: 'v-1', name: 'Apex Staffing', code: 'APEX', rating: 4.8 },
      ]);
      prisma.vmsOrderFulfillment.groupBy.mockResolvedValue([
        { vendorId: 'v-1', status: VmsFulfillmentStatus.confirmed, _count: { _all: 2 } },
      ]);
      prisma.$queryRaw.mockResolvedValue([
        {
          vendorId: 'v-1',
          totalPunches: BigInt(2),
          offTargetPunches: BigInt(0),
          totalBilledCents: BigInt(50000),
        },
      ]);

      const scorecard = await service.getVendorScorecard(mockOrgId, mockFacilityId);

      expect(scorecard).toHaveLength(1);
      expect(scorecard[0].vendorName).toBe('Apex Staffing');
      expect(scorecard[0].fulfillmentRatePercent).toBe(100);
      expect(scorecard[0].onTimeRatePercent).toBe(100);
      expect(scorecard[0].totalBilledCents).toBe(50000);
      expect(scorecard[0].tierStatus).toBe('Tier 1 Preferred');

      // The aggregate must be computed in the database, not by loading every
      // staff member and attendance row into memory.
      expect(prisma.vmsOrderFulfillment.groupBy).toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalled();
      const vendorQuery = prisma.vmsVendor.findMany.mock.calls[0][0];
      expect(vendorQuery.include).toBeUndefined();
    });

    it('counts unattributed no-shows against the fulfilling vendor (Q2)', async () => {
      prisma.vmsVendor.findMany.mockResolvedValue([
        { id: 'v-empty', name: 'No-Show Staffing', code: 'NOSHOW', rating: 3.0 },
      ]);
      prisma.vmsOrderFulfillment.groupBy.mockResolvedValue([
        { vendorId: 'v-empty', status: VmsFulfillmentStatus.confirmed, _count: { _all: 1 } },
      ]);
      // Two slots the vendor confirmed and never staffed: no staff member, so
      // attribution comes through the order's fulfillment instead.
      prisma.$queryRaw.mockResolvedValue([
        {
          vendorId: 'v-empty',
          totalPunches: BigInt(2),
          offTargetPunches: BigInt(2),
          totalBilledCents: BigInt(0),
        },
      ]);

      const scorecard = await service.getVendorScorecard(mockOrgId, mockFacilityId);

      expect(scorecard[0].onTimeRatePercent).toBe(0);
      expect(scorecard[0].noShowCount).toBe(2);
      expect(scorecard[0].hasData).toBe(true);
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
        { id: 'v-new', name: 'Brand New Vendor', code: 'NEW', rating: 5.0 },
      ]);
      prisma.vmsOrderFulfillment.groupBy.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);

      const scorecard = await service.getVendorScorecard(mockOrgId, mockFacilityId);

      expect(scorecard).toHaveLength(1);
      expect(scorecard[0].onTimeRatePercent).toBeNull();
      expect(scorecard[0].fulfillmentRatePercent).toBeNull();
      expect(scorecard[0].hasData).toBe(false);
    });

    it('rejects non-manager clock-in when worker has no credential on file (N5)', async () => {
      prisma.vmsStaffMember.findFirst.mockResolvedValue({
        id: 'staff-no-cred',
        pinHash: null,
        pinSalt: null,
        badgeNumber: null,
      });

      await expect(
        service.clockIn(mockOrgId, mockFacilityId, { staffMemberId: 'staff-no-cred' }),
      ).rejects.toThrow('Staff member has no PIN or badge credential configured on file');
    });

    it('verifies worker PIN using scrypt and rejects invalid PIN (N3)', async () => {
      const salt = 'aabbccdd11223344';
      const correctHash = hashPin('4321', salt);

      prisma.vmsStaffMember.findFirst.mockResolvedValue({
        id: 'staff-pin',
        pinHash: correctHash,
        pinSalt: salt,
        hourlyRateCents: 2500,
      });

      // Wrong PIN
      await expect(
        service.clockIn(mockOrgId, mockFacilityId, { staffMemberId: 'staff-pin', pin: '9999' }),
      ).rejects.toThrow('Invalid worker PIN');

      // Correct PIN
      prisma.vmsTimeAttendance.findFirst.mockResolvedValue(null);
      prisma.vmsTimeAttendance.create.mockResolvedValue({
        id: 'att-valid',
        status: VmsAttendanceStatus.clocked_in,
        staffMember: { id: 'staff-pin', pinHash: correctHash, pinSalt: salt },
      });

      const res = await service.clockIn(
        mockOrgId,
        mockFacilityId,
        { staffMemberId: 'staff-pin', pin: '4321' },
      );
      expect(res.id).toBe('att-valid');
      // Credential omission (N2)
      expect((res.staffMember as any)?.pinHash).toBeUndefined();
      expect((res.staffMember as any)?.pinSalt).toBeUndefined();
    });

    it('rejects clock-in when worker has an open punch with clockOut: null (N4)', async () => {
      prisma.vmsStaffMember.findFirst.mockResolvedValue({
        id: 'staff-open',
        badgeNumber: 'BADGE-1',
        hourlyRateCents: 2500,
      });

      // Previous punch had status flagged_exception, but clockOut was null!
      prisma.vmsTimeAttendance.findFirst.mockResolvedValue({
        id: 'att-open-1',
        status: VmsAttendanceStatus.flagged_exception,
        clockOut: null,
      });

      await expect(
        service.clockIn(
          mockOrgId,
          mockFacilityId,
          { staffMemberId: 'staff-open', badgeCode: 'BADGE-1' },
        ),
      ).rejects.toThrow('Staff member already has an active clock-in without clock-out');
    });

    it('flags geofence_unconfigured when facility coordinates are null (N9)', async () => {
      prisma.vmsStaffMember.findFirst.mockResolvedValue({
        id: 'staff-1',
        badgeNumber: 'B-1',
        hourlyRateCents: 2500,
      });
      prisma.vmsTimeAttendance.findFirst.mockResolvedValue(null);
      prisma.facility.findUnique.mockResolvedValue({ latitude: null, longitude: null });
      prisma.vmsTimeAttendance.create.mockImplementation((args: any) => Promise.resolve(args.data));

      const punch = await service.clockIn(
        mockOrgId,
        mockFacilityId,
        { staffMemberId: 'staff-1', badgeCode: 'B-1', gpsLatitude: 37.77, gpsLongitude: -122.41 },
      );

      expect(punch.deviationFlags).toContain('geofence_unconfigured');
    });

    it('bounds unfilled escalation query by shiftDate lower bound (N8)', async () => {
      prisma.vmsStaffingOrder.findMany.mockResolvedValue([]);

      await service.getUnfilledOrdersNeedingEscalation(mockOrgId, mockFacilityId);

      expect(prisma.vmsStaffingOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            shiftDate: expect.objectContaining({
              gte: expect.any(String),
              lte: expect.any(String),
            }),
          }),
        }),
      );
    });

    it('attributes no-shows to the assigned worker, not an arbitrary one (Q1)', async () => {
      const pastShiftDate = new Date(Date.now() - 2 * 3600 * 1000).toISOString().split('T')[0];
      prisma.vmsStaffingOrder.findMany.mockResolvedValue([
        {
          id: 'order-noshow-1',
          orderNumber: 'ORD-NS-01',
          roleRequired: 'Bartender',
          shiftDate: pastShiftDate,
          startTime: '06:00',
          quantityFulfilled: 1,
          fulfillments: [{ id: 'f-1', vendorId: 'v-1' }],
          assignments: [
            {
              id: 'assign-1',
              status: 'assigned',
              staffMemberId: 'staff-rostered',
              staffMember: {
                id: 'staff-rostered',
                firstName: 'Rosa',
                lastName: 'Klein',
                vendorId: 'v-1',
              },
            },
          ],
          attendances: [],
        },
      ]);
      prisma.vmsTimeAttendance.create.mockResolvedValue({ id: 'att-ns-1' });

      const res = await service.detectNoShows(mockOrgId, mockFacilityId, 30);

      expect(res.flaggedNoShowsCount).toBe(1);
      expect(res.flaggedNoShows[0].staffMemberId).toBe('staff-rostered');
      expect(res.flaggedNoShows[0].staffName).toBe('Rosa Klein');
      expect(prisma.vmsTimeAttendance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            staffMemberId: 'staff-rostered',
            status: VmsAttendanceStatus.flagged_exception,
            deviationFlags: expect.arrayContaining(['no_show']),
          }),
        }),
      );
      // The assignment itself is marked so the roster reflects the absence.
      expect(prisma.vmsStaffAssignment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'assign-1' } }),
      );
    });

    describe('venue-local shift times', () => {
      // Fixed clock so the assertion does not depend on when the suite runs.
      // 2026-09-12T19:00Z is 12:00 in Los Angeles (PDT, UTC-7).
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-12T19:00:00Z'));
        prisma.facility.findUnique.mockResolvedValue({ timezone: 'America/Los_Angeles' });
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      const laOrder = (startTime: string) => [
        {
          id: 'order-tz',
          orderNumber: 'ORD-TZ',
          roleRequired: 'Bartender',
          shiftDate: '2026-09-12',
          startTime,
          quantityFulfilled: 1,
          fulfillments: [{ id: 'f-1', vendorId: 'v-1' }],
          assignments: [
            {
              id: 'assign-tz',
              status: 'assigned',
              staffMemberId: 'staff-tz',
              staffMember: { id: 'staff-tz', firstName: 'T', lastName: 'Z', vendorId: 'v-1' },
            },
          ],
          attendances: [],
        },
      ];

      it('does not flag a shift that has not started in the venue timezone', async () => {
        // 17:00 in Los Angeles is 00:00Z the next day, so at 19:00Z the shift is
        // still five hours away. Read as UTC it looks 90 minutes overdue, which
        // is what made the sweep invent absences before anyone was due.
        prisma.vmsStaffingOrder.findMany.mockResolvedValue(laOrder('17:00'));

        const res = await service.detectNoShows(mockOrgId, mockFacilityId, 30);

        expect(res.flaggedNoShowsCount).toBe(0);
        expect(prisma.vmsTimeAttendance.create).not.toHaveBeenCalled();
      });

      it('still flags a shift that is genuinely overdue in the venue timezone', async () => {
        // 04:00 Los Angeles is 11:00Z — eight hours before the fixed clock — so
        // this one really has passed its grace period.
        prisma.vmsStaffingOrder.findMany.mockResolvedValue(laOrder('04:00'));
        prisma.vmsTimeAttendance.create.mockResolvedValue({ id: 'att-tz' });

        const res = await service.detectNoShows(mockOrgId, mockFacilityId, 30);

        expect(res.flaggedNoShowsCount).toBe(1);
        expect(res.flaggedNoShows[0].staffMemberId).toBe('staff-tz');
      });
    });

    it('records an unstaffed confirmed slot against the vendor with no worker (Q1)', async () => {
      const pastShiftDate = new Date(Date.now() - 2 * 3600 * 1000).toISOString().split('T')[0];
      prisma.vmsStaffingOrder.findMany.mockResolvedValue([
        {
          id: 'order-noshow-2',
          orderNumber: 'ORD-NS-02',
          roleRequired: 'Bartender',
          shiftDate: pastShiftDate,
          startTime: '06:00',
          quantityFulfilled: 2,
          fulfillments: [{ id: 'f-1', vendorId: 'v-1' }],
          assignments: [], // vendor confirmed 2 but named nobody
          attendances: [],
        },
      ]);
      prisma.vmsTimeAttendance.create.mockResolvedValue({ id: 'att-ns-2' });

      const res = await service.detectNoShows(mockOrgId, mockFacilityId, 30);

      expect(res.flaggedNoShowsCount).toBe(2);
      expect(res.flaggedNoShows.every((n: any) => n.staffMemberId === null)).toBe(true);
      expect(res.flaggedNoShows.every((n: any) => n.vendorId === 'v-1')).toBe(true);
      expect(prisma.vmsTimeAttendance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            staffMemberId: null,
            deviationFlags: expect.arrayContaining(['no_show', 'unfilled_shift']),
          }),
        }),
      );
    });

    it('is idempotent once the first sweep has resolved the assignment (P3)', async () => {
      const pastShiftDate = new Date(Date.now() - 2 * 3600 * 1000).toISOString().split('T')[0];
      prisma.vmsStaffingOrder.findMany.mockResolvedValue([
        {
          id: 'order-noshow-3',
          orderNumber: 'ORD-NS-03',
          roleRequired: 'Bartender',
          shiftDate: pastShiftDate,
          startTime: '06:00',
          quantityFulfilled: 2,
          fulfillments: [{ id: 'f-1', vendorId: 'v-1' }],
          assignments: [
            {
              id: 'assign-1',
              status: 'no_show',
              staffMemberId: 'staff-a',
              staffMember: { id: 'staff-a', firstName: 'A', lastName: 'One', vendorId: 'v-1' },
            },
          ],
          // State after sweep 1: the absentee is flagged and their assignment
          // has moved to no_show, and the unstaffed slot is recorded. A second
          // sweep must add nothing — the earlier implementation dropped the
          // resolved assignment from its slot arithmetic and invented a fresh
          // unfilled_shift row here.
          attendances: [
            { id: 'att-1', staffMemberId: 'staff-a', deviationFlags: ['no_show'] },
            { id: 'att-2', staffMemberId: null, deviationFlags: ['no_show', 'unfilled_shift'] },
          ],
        },
      ]);

      const res = await service.detectNoShows(mockOrgId, mockFacilityId, 30);

      expect(res.flaggedNoShowsCount).toBe(0);
      expect(prisma.vmsTimeAttendance.create).not.toHaveBeenCalled();
    });

    it('sanitizes pinHash and pinSalt from getVendor staffMembers (P4)', async () => {
      prisma.vmsVendor.findFirst.mockResolvedValue({
        id: 'v-1',
        name: 'Apex Staffing',
        staffMembers: [
          {
            id: 'staff-1',
            firstName: 'Jane',
            lastName: 'Doe',
            pinHash: 'secret-hash-value',
            pinSalt: 'secret-salt-value',
          },
        ],
      });

      const vendor = await service.getVendor('v-1', mockOrgId, mockFacilityId);
      expect(vendor.id).toBe('v-1');
      expect((vendor.staffMembers[0] as any).pinHash).toBeUndefined();
      expect((vendor.staffMembers[0] as any).pinSalt).toBeUndefined();
    });

    it('exports audit logs in CSV and JSON formats (F6)', async () => {
      prisma.vmsAuditLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          timestamp: new Date('2026-09-04T12:00:00Z'),
          entityType: 'VmsVendor',
          entityId: 'v-1',
          action: 'CREATE',
          performedByUserId: 'user-1',
          changes: { name: 'Acme Staffing' },
        },
      ]);

      const jsonLogs = await service.exportAuditLogs(mockOrgId, mockFacilityId, { format: 'json' });
      expect(Array.isArray(jsonLogs)).toBe(true);

      const csvLogs = await service.exportAuditLogs(mockOrgId, mockFacilityId, { format: 'csv' });
      expect(typeof csvLogs).toBe('string');
      expect(csvLogs).toContain('Timestamp,Entity Type,Entity ID,Action,Performed By,Changes');
      expect(csvLogs).toContain('VmsVendor,v-1,CREATE,user-1');
    });
  });
});
