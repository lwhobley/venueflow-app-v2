-- VMS: staff assignments, availability windows, order templates, notification
-- delivery tracking, durable punch lockout, and audit-log immutability.
--
-- Context: the VMS module had no link between a staff member and the order they
-- were expected to work, which forced no-show detection to guess an attributed
-- worker (review finding Q1) and left the vendor scorecard blind to
-- unattributed no-shows (Q2). VmsStaffAssignment supplies that link. The
-- remaining tables close the availability (1.2), template (1.3), notification
-- (4.3) and cross-replica lockout (P5) gaps, and the trigger at the end makes
-- VmsAuditLog append-only as section 5.3 requires.

-- CreateEnum
CREATE TYPE "VmsAssignmentStatus" AS ENUM ('assigned', 'confirmed', 'released', 'no_show', 'completed');
CREATE TYPE "VmsNotificationEvent" AS ENUM ('order_submitted', 'bid_received', 'order_confirmed', 'shift_reminder', 'time_deviation', 'no_show_alert', 'fulfillment_failure', 'certification_expiring');
CREATE TYPE "VmsNotificationChannel" AS ENUM ('email', 'sms', 'push');
CREATE TYPE "VmsNotificationStatus" AS ENUM ('sent', 'failed', 'suppressed');

-- CreateTable
CREATE TABLE "VmsStaffAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "fulfillmentId" TEXT,
    "status" "VmsAssignmentStatus" NOT NULL DEFAULT 'assigned',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmsStaffAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VmsStaffAvailability" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmsStaffAvailability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VmsOrderTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleRequired" TEXT NOT NULL,
    "quantityRequested" INTEGER NOT NULL DEFAULT 1,
    "startTime" TEXT NOT NULL DEFAULT '16:00',
    "endTime" TEXT NOT NULL DEFAULT '22:00',
    "durationHours" DOUBLE PRECISION NOT NULL DEFAULT 4.0,
    "budgetCents" INTEGER NOT NULL DEFAULT 0,
    "specialRequirements" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmsOrderTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VmsNotificationPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" "VmsNotificationEvent" NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmsNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VmsNotificationLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "eventType" "VmsNotificationEvent" NOT NULL,
    "channel" "VmsNotificationChannel" NOT NULL DEFAULT 'email',
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "status" "VmsNotificationStatus" NOT NULL DEFAULT 'sent',
    "errorMessage" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VmsNotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VmsPunchLockout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmsPunchLockout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VmsStaffAssignment_orderId_staffMemberId_key" ON "VmsStaffAssignment"("orderId", "staffMemberId");
CREATE INDEX "VmsStaffAssignment_organizationId_facilityId_status_idx" ON "VmsStaffAssignment"("organizationId", "facilityId", "status");
CREATE INDEX "VmsStaffAssignment_staffMemberId_status_idx" ON "VmsStaffAssignment"("staffMemberId", "status");

CREATE INDEX "VmsStaffAvailability_org_facility_start_end_idx" ON "VmsStaffAvailability"("organizationId", "facilityId", "startDate", "endDate");
CREATE INDEX "VmsStaffAvailability_staffMemberId_startDate_idx" ON "VmsStaffAvailability"("staffMemberId", "startDate");

CREATE UNIQUE INDEX "VmsOrderTemplate_organizationId_facilityId_name_key" ON "VmsOrderTemplate"("organizationId", "facilityId", "name");
CREATE INDEX "VmsOrderTemplate_organizationId_facilityId_idx" ON "VmsOrderTemplate"("organizationId", "facilityId");

CREATE UNIQUE INDEX "VmsNotificationPreference_facilityId_userId_eventType_key" ON "VmsNotificationPreference"("facilityId", "userId", "eventType");
CREATE INDEX "VmsNotificationPreference_organizationId_facilityId_idx" ON "VmsNotificationPreference"("organizationId", "facilityId");

CREATE INDEX "VmsNotificationLog_facilityId_eventType_createdAt_idx" ON "VmsNotificationLog"("facilityId", "eventType", "createdAt");
CREATE INDEX "VmsNotificationLog_facilityId_status_createdAt_idx" ON "VmsNotificationLog"("facilityId", "status", "createdAt");

CREATE UNIQUE INDEX "VmsPunchLockout_staffMemberId_key" ON "VmsPunchLockout"("staffMemberId");
CREATE INDEX "VmsPunchLockout_facilityId_lockedUntil_idx" ON "VmsPunchLockout"("facilityId", "lockedUntil");

-- AddForeignKey
ALTER TABLE "VmsStaffAssignment" ADD CONSTRAINT "VmsStaffAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmsStaffAssignment" ADD CONSTRAINT "VmsStaffAssignment_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VmsStaffAssignment" ADD CONSTRAINT "VmsStaffAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "VmsStaffingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VmsStaffAssignment" ADD CONSTRAINT "VmsStaffAssignment_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "VmsStaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VmsStaffAssignment" ADD CONSTRAINT "VmsStaffAssignment_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "VmsOrderFulfillment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VmsStaffAvailability" ADD CONSTRAINT "VmsStaffAvailability_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmsStaffAvailability" ADD CONSTRAINT "VmsStaffAvailability_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VmsStaffAvailability" ADD CONSTRAINT "VmsStaffAvailability_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "VmsStaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VmsOrderTemplate" ADD CONSTRAINT "VmsOrderTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmsOrderTemplate" ADD CONSTRAINT "VmsOrderTemplate_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VmsNotificationPreference" ADD CONSTRAINT "VmsNotificationPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmsNotificationPreference" ADD CONSTRAINT "VmsNotificationPreference_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VmsNotificationLog" ADD CONSTRAINT "VmsNotificationLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmsNotificationLog" ADD CONSTRAINT "VmsNotificationLog_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VmsPunchLockout" ADD CONSTRAINT "VmsPunchLockout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmsPunchLockout" ADD CONSTRAINT "VmsPunchLockout_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "VmsStaffAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsStaffAssignment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VmsStaffAvailability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsStaffAvailability" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VmsOrderTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsOrderTemplate" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VmsNotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsNotificationPreference" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VmsNotificationLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsNotificationLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VmsPunchLockout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VmsPunchLockout" FORCE ROW LEVEL SECURITY;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    EXECUTE 'CREATE POLICY vms_staff_assignment_scope ON "VmsStaffAssignment" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
    EXECUTE 'CREATE POLICY vms_staff_availability_scope ON "VmsStaffAvailability" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
    EXECUTE 'CREATE POLICY vms_order_template_scope ON "VmsOrderTemplate" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
    EXECUTE 'CREATE POLICY vms_notification_preference_scope ON "VmsNotificationPreference" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
    EXECUTE 'CREATE POLICY vms_notification_log_scope ON "VmsNotificationLog" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
    EXECUTE 'CREATE POLICY vms_punch_lockout_scope ON "VmsPunchLockout" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
  END IF;
END
$do$;

REVOKE ALL ON "VmsStaffAssignment" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "VmsStaffAvailability" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "VmsOrderTemplate" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "VmsNotificationPreference" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "VmsNotificationLog" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "VmsPunchLockout" FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "VmsStaffAssignment", "VmsStaffAvailability", "VmsOrderTemplate",
  "VmsNotificationPreference", "VmsNotificationLog", "VmsPunchLockout"
TO stadium_api;

-- Audit-log immutability (section 5.3: "append-only, no deletion of logs").
-- Mirrors the EventCloseoutRevision ledger guard in 20260813150000.
CREATE OR REPLACE FUNCTION app_private.enforce_vms_audit_log_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  RAISE EXCEPTION 'VmsAuditLog records are immutable and cannot be updated or deleted.';
END;
$fn$;

DROP TRIGGER IF EXISTS enforce_vms_audit_log_immutability ON "VmsAuditLog";
CREATE TRIGGER enforce_vms_audit_log_immutability
  BEFORE UPDATE OR DELETE ON "VmsAuditLog"
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_vms_audit_log_immutability();
