-- CreateEnum
CREATE TYPE "VmsVendorType" AS ENUM ('staffing_agency', 'labor_contractor', 'equipment_supplier', 'catering_supplier', 'cleaning_services', 'security_agency', 'other');

-- CreateEnum
CREATE TYPE "VmsVendorStatus" AS ENUM ('active', 'pending_approval', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "VmsWorkforceType" AS ENUM ('internal_permanent', 'internal_part_time', 'agency_temp', 'contractor');

-- CreateEnum
CREATE TYPE "VmsStaffStatus" AS ENUM ('active', 'onboarding', 'offboarded', 'inactive');

-- CreateEnum
CREATE TYPE "VmsOrderStatus" AS ENUM ('draft', 'requested', 'quoted', 'booked', 'confirmed', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "VmsFulfillmentStatus" AS ENUM ('bid_submitted', 'bid_accepted', 'bid_rejected', 'partially_filled', 'confirmed', 'completed');

-- CreateEnum
CREATE TYPE "VmsAttendanceStatus" AS ENUM ('clocked_in', 'clocked_out', 'approved', 'flagged_exception', 'rejected');

-- CreateEnum
CREATE TYPE "VmsSyncSystem" AS ENUM ('yellow_dog', 'marginedge', 'toast', 'adp', 'gusto');

-- CreateTable
CREATE TABLE "VmsVendor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "vendorType" "VmsVendorType" NOT NULL DEFAULT 'staffing_agency',
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "status" "VmsVendorStatus" NOT NULL DEFAULT 'active',
    "taxId" TEXT,
    "insuranceExpiry" TIMESTAMP(3),
    "billingRateMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.35,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmsVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VmsVendorService" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "hourlyRateCents" INTEGER NOT NULL DEFAULT 2500,
    "overtimeRateCents" INTEGER NOT NULL DEFAULT 3750,
    "minimumNoticeHours" INTEGER NOT NULL DEFAULT 24,
    "availabilityJson" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmsVendorService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VmsStaffMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "vendorId" TEXT,
    "workforceType" "VmsWorkforceType" NOT NULL DEFAULT 'agency_temp',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "certifications" JSONB,
    "hourlyRateCents" INTEGER NOT NULL DEFAULT 2500,
    "status" "VmsStaffStatus" NOT NULL DEFAULT 'active',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "badgeNumber" TEXT,
    "pinHash" TEXT,
    "pinSalt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmsStaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VmsStaffingOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "eventId" TEXT,
    "orderNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "roleRequired" TEXT NOT NULL,
    "quantityRequested" INTEGER NOT NULL,
    "quantityFulfilled" INTEGER NOT NULL DEFAULT 0,
    "shiftDate" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "durationHours" DOUBLE PRECISION NOT NULL DEFAULT 4.0,
    "budgetCents" INTEGER NOT NULL DEFAULT 0,
    "actualCostCents" INTEGER NOT NULL DEFAULT 0,
    "specialRequirements" TEXT,
    "templateName" TEXT,
    "cancellationReason" TEXT,
    "status" "VmsOrderStatus" NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmsStaffingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VmsOrderFulfillment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "staffCountAssigned" INTEGER NOT NULL DEFAULT 0,
    "bidHourlyRateCents" INTEGER NOT NULL DEFAULT 0,
    "totalBidCents" INTEGER NOT NULL DEFAULT 0,
    "status" "VmsFulfillmentStatus" NOT NULL DEFAULT 'bid_submitted',
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmsOrderFulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VmsTimeAttendance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "orderId" TEXT,
    "clockIn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clockOut" TIMESTAMP(3),
    "hoursWorked" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "billableHours" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "billedRateCents" INTEGER NOT NULL DEFAULT 0,
    "totalBilledCents" INTEGER NOT NULL DEFAULT 0,
    "status" "VmsAttendanceStatus" NOT NULL DEFAULT 'clocked_in',
    "deviceInfo" TEXT,
    "gpsLatitude" DOUBLE PRECISION,
    "gpsLongitude" DOUBLE PRECISION,
    "isWithinGeofence" BOOLEAN NOT NULL DEFAULT true,
    "deviationFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmsTimeAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VmsInventorySyncLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "system" "VmsSyncSystem" NOT NULL DEFAULT 'yellow_dog',
    "syncType" TEXT NOT NULL DEFAULT 'stock_and_supplies',
    "status" TEXT NOT NULL DEFAULT 'success',
    "itemsSyncedCount" INTEGER NOT NULL DEFAULT 0,
    "details" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VmsInventorySyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VmsAuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performedByUserId" TEXT NOT NULL,
    "changes" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VmsAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VmsVendor_organizationId_facilityId_code_key" ON "VmsVendor"("organizationId", "facilityId", "code");
CREATE INDEX "VmsVendor_organizationId_facilityId_status_idx" ON "VmsVendor"("organizationId", "facilityId", "status");

-- CreateIndex
CREATE INDEX "VmsVendorService_vendorId_serviceType_idx" ON "VmsVendorService"("vendorId", "serviceType");

-- CreateIndex
CREATE INDEX "VmsStaffMember_organizationId_facilityId_status_idx" ON "VmsStaffMember"("organizationId", "facilityId", "status");
CREATE INDEX "VmsStaffMember_vendorId_idx" ON "VmsStaffMember"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VmsStaffingOrder_organizationId_facilityId_orderNumber_key" ON "VmsStaffingOrder"("organizationId", "facilityId", "orderNumber");
CREATE INDEX "VmsStaffingOrder_facilityId_shiftDate_status_idx" ON "VmsStaffingOrder"("facilityId", "shiftDate", "status");

-- CreateIndex
CREATE INDEX "VmsOrderFulfillment_orderId_vendorId_idx" ON "VmsOrderFulfillment"("orderId", "vendorId");

-- CreateIndex
CREATE INDEX "VmsTimeAttendance_facilityId_staffMemberId_status_idx" ON "VmsTimeAttendance"("facilityId", "staffMemberId", "status");
CREATE INDEX "VmsTimeAttendance_facilityId_clockIn_idx" ON "VmsTimeAttendance"("facilityId", "clockIn");

-- CreateIndex
CREATE INDEX "VmsInventorySyncLog_facilityId_system_createdAt_idx" ON "VmsInventorySyncLog"("facilityId", "system", "createdAt");

-- CreateIndex
CREATE INDEX "VmsAuditLog_facilityId_entityType_timestamp_idx" ON "VmsAuditLog"("facilityId", "entityType", "timestamp");

-- AddForeignKey
ALTER TABLE "VmsVendor" ADD CONSTRAINT "VmsVendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmsVendor" ADD CONSTRAINT "VmsVendor_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmsVendorService" ADD CONSTRAINT "VmsVendorService_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "VmsVendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmsStaffMember" ADD CONSTRAINT "VmsStaffMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmsStaffMember" ADD CONSTRAINT "VmsStaffMember_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VmsStaffMember" ADD CONSTRAINT "VmsStaffMember_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "VmsVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmsStaffingOrder" ADD CONSTRAINT "VmsStaffingOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmsStaffingOrder" ADD CONSTRAINT "VmsStaffingOrder_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmsOrderFulfillment" ADD CONSTRAINT "VmsOrderFulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "VmsStaffingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VmsOrderFulfillment" ADD CONSTRAINT "VmsOrderFulfillment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "VmsVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmsTimeAttendance" ADD CONSTRAINT "VmsTimeAttendance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmsTimeAttendance" ADD CONSTRAINT "VmsTimeAttendance_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VmsTimeAttendance" ADD CONSTRAINT "VmsTimeAttendance_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "VmsStaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VmsTimeAttendance" ADD CONSTRAINT "VmsTimeAttendance_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "VmsStaffingOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmsInventorySyncLog" ADD CONSTRAINT "VmsInventorySyncLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmsInventorySyncLog" ADD CONSTRAINT "VmsInventorySyncLog_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmsAuditLog" ADD CONSTRAINT "VmsAuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmsAuditLog" ADD CONSTRAINT "VmsAuditLog_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (RLS)
ALTER TABLE "VmsVendor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsVendor" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VmsVendorService" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsVendorService" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VmsStaffMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsStaffMember" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VmsStaffingOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsStaffingOrder" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VmsOrderFulfillment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsOrderFulfillment" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VmsTimeAttendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsTimeAttendance" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VmsInventorySyncLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsInventorySyncLog" FORCE ROW LEVEL SECURITY;

ALTER TABLE "VmsAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsAuditLog" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    -- VmsVendor
    EXECUTE 'CREATE POLICY vms_vendor_scope ON "VmsVendor" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';

    -- VmsVendorService
    EXECUTE 'CREATE POLICY vms_vendor_service_scope ON "VmsVendorService" FOR ALL TO stadium_api USING (EXISTS (SELECT 1 FROM "VmsVendor" v WHERE v.id = "VmsVendorService"."vendorId" AND (SELECT app_private.scope_matches(v."organizationId", v."facilityId", NULL)))) WITH CHECK (EXISTS (SELECT 1 FROM "VmsVendor" v WHERE v.id = "VmsVendorService"."vendorId" AND (SELECT app_private.scope_matches(v."organizationId", v."facilityId", NULL))))';

    -- VmsStaffMember
    EXECUTE 'CREATE POLICY vms_staff_member_scope ON "VmsStaffMember" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';

    -- VmsStaffingOrder
    EXECUTE 'CREATE POLICY vms_staffing_order_scope ON "VmsStaffingOrder" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';

    -- VmsOrderFulfillment
    EXECUTE 'CREATE POLICY vms_order_fulfillment_scope ON "VmsOrderFulfillment" FOR ALL TO stadium_api USING (EXISTS (SELECT 1 FROM "VmsStaffingOrder" o WHERE o.id = "VmsOrderFulfillment"."orderId" AND (SELECT app_private.scope_matches(o."organizationId", o."facilityId", NULL)))) WITH CHECK (EXISTS (SELECT 1 FROM "VmsStaffingOrder" o WHERE o.id = "VmsOrderFulfillment"."orderId" AND (SELECT app_private.scope_matches(o."organizationId", o."facilityId", NULL))))';

    -- VmsTimeAttendance
    EXECUTE 'CREATE POLICY vms_time_attendance_scope ON "VmsTimeAttendance" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';

    -- VmsInventorySyncLog
    EXECUTE 'CREATE POLICY vms_inventory_sync_log_scope ON "VmsInventorySyncLog" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';

    -- VmsAuditLog
    EXECUTE 'CREATE POLICY vms_audit_log_scope ON "VmsAuditLog" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
  END IF;
END $$;

REVOKE ALL ON "VmsVendor" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "VmsVendorService" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "VmsStaffMember" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "VmsStaffingOrder" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "VmsOrderFulfillment" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "VmsTimeAttendance" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "VmsInventorySyncLog" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "VmsAuditLog" FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "VmsVendor", "VmsVendorService", "VmsStaffMember", "VmsStaffingOrder",
  "VmsOrderFulfillment", "VmsTimeAttendance", "VmsInventorySyncLog", "VmsAuditLog"
TO stadium_api;

