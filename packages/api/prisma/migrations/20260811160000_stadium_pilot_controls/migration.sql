-- Stadium F&B pilot controls: organization ownership, event lifecycle,
-- first-class operational issues, and append-only event audit records.
CREATE TYPE "EventOperationalState" AS ENUM ('draft', 'planning', 'approved', 'pre_open', 'live', 'closing', 'closed', 'archived');
CREATE TYPE "EventIssueSeverity" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "EventIssueStatus" AS ENUM ('open', 'acknowledged', 'resolved');

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'platform_admin';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'organization_admin';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'fnb_director';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'event_manager';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'outlet_manager';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'executive_chef';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'warehouse_manager';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'premium_manager';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'finance_viewer';

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");

ALTER TABLE "Venue" ADD COLUMN "organizationId" TEXT;
INSERT INTO "Organization" ("id", "name", "code", "updatedAt")
SELECT 'org_' || "id", "name" || ' Organization', 'org_' || "code", CURRENT_TIMESTAMP
FROM "Venue";
UPDATE "Venue" SET "organizationId" = 'org_' || "id" WHERE "organizationId" IS NULL;
ALTER TABLE "Venue" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "Venue_organizationId_idx" ON "Venue"("organizationId");
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VenueEvent"
  ADD COLUMN "operationalState" "EventOperationalState" NOT NULL DEFAULT 'draft',
  ADD COLUMN "stateChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedBy" TEXT;
UPDATE "VenueEvent" SET "operationalState" = CASE "status"
  WHEN 'draft' THEN 'draft'::"EventOperationalState"
  WHEN 'planning' THEN 'planning'::"EventOperationalState"
  WHEN 'ready' THEN 'pre_open'::"EventOperationalState"
  WHEN 'live' THEN 'live'::"EventOperationalState"
  WHEN 'completed' THEN 'closed'::"EventOperationalState"
  WHEN 'cancelled' THEN 'archived'::"EventOperationalState"
  ELSE 'draft'::"EventOperationalState"
END;
CREATE INDEX "VenueEvent_venueId_operationalState_startsAt_idx" ON "VenueEvent"("venueId", "operationalState", "startsAt");

CREATE TABLE "EventIssue" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "outletId" TEXT,
  "issueType" TEXT NOT NULL,
  "severity" "EventIssueSeverity" NOT NULL,
  "status" "EventIssueStatus" NOT NULL DEFAULT 'open',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "reportedByUserId" TEXT NOT NULL,
  "ownerUserId" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolutionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventIssue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventIssue_organizationId_venueId_eventId_status_idx" ON "EventIssue"("organizationId", "venueId", "eventId", "status");
CREATE INDEX "EventIssue_venueId_eventId_severity_status_idx" ON "EventIssue"("venueId", "eventId", "severity", "status");
CREATE INDEX "EventIssue_outletId_idx" ON "EventIssue"("outletId");
ALTER TABLE "EventIssue" ADD CONSTRAINT "EventIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventIssue" ADD CONSTRAINT "EventIssue_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventIssue" ADD CONSTRAINT "EventIssue_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "VenueEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventIssue" ADD CONSTRAINT "EventIssue_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "FnbOperationUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EventAuditLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "issueId" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorProfileId" TEXT,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventAuditLog_organizationId_venueId_eventId_createdAt_idx" ON "EventAuditLog"("organizationId", "venueId", "eventId", "createdAt");
CREATE INDEX "EventAuditLog_eventId_entityType_entityId_createdAt_idx" ON "EventAuditLog"("eventId", "entityType", "entityId", "createdAt");
ALTER TABLE "EventAuditLog" ADD CONSTRAINT "EventAuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventAuditLog" ADD CONSTRAINT "EventAuditLog_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventAuditLog" ADD CONSTRAINT "EventAuditLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "VenueEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The NestJS API is the only data path. RLS and privilege revocation prevent
-- accidental exposure through Supabase Data API.
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventIssue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventAuditLog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Organization", "EventIssue", "EventAuditLog" FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_event_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'EventAuditLog records are immutable';
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_event_audit_mutation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER "EventAuditLog_immutable"
BEFORE UPDATE OR DELETE ON "EventAuditLog"
FOR EACH ROW EXECUTE FUNCTION public.prevent_event_audit_mutation();
