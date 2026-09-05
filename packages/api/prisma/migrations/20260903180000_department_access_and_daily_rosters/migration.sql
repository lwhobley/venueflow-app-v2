-- CreateEnum
CREATE TYPE "OperationalAreaType" AS ENUM ('suite', 'club', 'catering', 'concession', 'culinary', 'kitchen', 'distro', 'maintenance', 'engineering', 'security', 'custodial', 'administrative', 'shared', 'other');

-- CreateEnum
CREATE TYPE "DepartmentVisibilityScope" AS ENUM ('isolated', 'broad', 'operational');

-- CreateEnum
CREATE TYPE "DailyRosterType" AS ENUM ('temporary', 'npo');

-- CreateEnum
CREATE TYPE "DailyRosterStatus" AS ENUM ('draft', 'submitted', 'approved', 'closed');

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "defaultRoute" TEXT NOT NULL,
    "visibilityScope" "DepartmentVisibilityScope" NOT NULL DEFAULT 'isolated',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "role" "Role",
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentAreaRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "areaType" "OperationalAreaType" NOT NULL,
    "zoneId" TEXT,
    "subVenueId" TEXT,
    "outletId" TEXT,
    "actionScope" TEXT NOT NULL DEFAULT 'read_write',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentAreaRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAreaOverride" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "departmentId" TEXT,
    "areaType" "OperationalAreaType" NOT NULL,
    "zoneId" TEXT,
    "subVenueId" TEXT,
    "outletId" TEXT,
    "eventId" TEXT,
    "reason" TEXT NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAreaOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyTemporaryRoster" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "operationalDate" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rosterType" "DailyRosterType" NOT NULL DEFAULT 'temporary',
    "staffingSource" TEXT NOT NULL,
    "agencyId" TEXT,
    "departmentId" TEXT NOT NULL,
    "serviceAreaId" TEXT,
    "status" "DailyRosterStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyTemporaryRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyTemporaryRosterWorker" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "workerProfileId" TEXT,
    "workerName" TEXT NOT NULL,
    "workerRole" TEXT NOT NULL,
    "assignedOutletId" TEXT,
    "shiftStartTime" TIMESTAMP(3),
    "shiftEndTime" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "hoursWorked" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "hourlyRateCents" INTEGER NOT NULL DEFAULT 0,
    "attendanceStatus" TEXT NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyTemporaryRosterWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyTemporaryRosterHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyTemporaryRosterHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_organizationId_facilityId_code_key" ON "Department"("organizationId", "facilityId", "code");
CREATE UNIQUE INDEX "Department_organizationId_facilityId_id_key" ON "Department"("organizationId", "facilityId", "id");
CREATE INDEX "Department_organizationId_facilityId_active_idx" ON "Department"("organizationId", "facilityId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentMembership_organizationId_facilityId_departmentId_userId_key" ON "DepartmentMembership"("organizationId", "facilityId", "departmentId", "userId");
CREATE INDEX "DepartmentMembership_facilityId_userId_isActive_idx" ON "DepartmentMembership"("facilityId", "userId", "isActive");
CREATE INDEX "DepartmentMembership_facilityId_isPrimary_idx" ON "DepartmentMembership"("facilityId", "isPrimary");

-- CreateIndex
CREATE INDEX "DepartmentAreaRule_organizationId_facilityId_departmentId_areaType_idx" ON "DepartmentAreaRule"("organizationId", "facilityId", "departmentId", "areaType");

-- CreateIndex
CREATE INDEX "UserAreaOverride_facilityId_userId_active_expiresAt_idx" ON "UserAreaOverride"("facilityId", "userId", "active", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyTemporaryRoster_organizationId_facilityId_operationalDate_name_key" ON "DailyTemporaryRoster"("organizationId", "facilityId", "operationalDate", "name");
CREATE UNIQUE INDEX "DailyTemporaryRoster_organizationId_facilityId_id_key" ON "DailyTemporaryRoster"("organizationId", "facilityId", "id");
CREATE INDEX "DailyTemporaryRoster_facilityId_operationalDate_departmentId_status_idx" ON "DailyTemporaryRoster"("facilityId", "operationalDate", "departmentId", "status");

-- CreateIndex
CREATE INDEX "DailyTemporaryRosterWorker_rosterId_attendanceStatus_idx" ON "DailyTemporaryRosterWorker"("rosterId", "attendanceStatus");
CREATE INDEX "DailyTemporaryRosterWorker_facilityId_workerProfileId_idx" ON "DailyTemporaryRosterWorker"("facilityId", "workerProfileId");

-- CreateIndex
CREATE INDEX "DailyTemporaryRosterHistory_rosterId_version_idx" ON "DailyTemporaryRosterHistory"("rosterId", "version");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Department" ADD CONSTRAINT "Department_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentMembership" ADD CONSTRAINT "DepartmentMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DepartmentMembership" ADD CONSTRAINT "DepartmentMembership_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DepartmentMembership" ADD CONSTRAINT "DepartmentMembership_organizationId_facilityId_departmentId_fkey" FOREIGN KEY ("organizationId", "facilityId", "departmentId") REFERENCES "Department"("organizationId", "facilityId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DepartmentMembership" ADD CONSTRAINT "DepartmentMembership_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DepartmentMembership" ADD CONSTRAINT "DepartmentMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentAreaRule" ADD CONSTRAINT "DepartmentAreaRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DepartmentAreaRule" ADD CONSTRAINT "DepartmentAreaRule_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DepartmentAreaRule" ADD CONSTRAINT "DepartmentAreaRule_organizationId_facilityId_departmentId_fkey" FOREIGN KEY ("organizationId", "facilityId", "departmentId") REFERENCES "Department"("organizationId", "facilityId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAreaOverride" ADD CONSTRAINT "UserAreaOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserAreaOverride" ADD CONSTRAINT "UserAreaOverride_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAreaOverride" ADD CONSTRAINT "UserAreaOverride_organizationId_facilityId_departmentId_fkey" FOREIGN KEY ("organizationId", "facilityId", "departmentId") REFERENCES "Department"("organizationId", "facilityId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserAreaOverride" ADD CONSTRAINT "UserAreaOverride_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAreaOverride" ADD CONSTRAINT "UserAreaOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTemporaryRoster" ADD CONSTRAINT "DailyTemporaryRoster_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyTemporaryRoster" ADD CONSTRAINT "DailyTemporaryRoster_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyTemporaryRoster" ADD CONSTRAINT "DailyTemporaryRoster_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "TempAgency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DailyTemporaryRoster" ADD CONSTRAINT "DailyTemporaryRoster_organizationId_facilityId_departmentId_fkey" FOREIGN KEY ("organizationId", "facilityId", "departmentId") REFERENCES "Department"("organizationId", "facilityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTemporaryRosterWorker" ADD CONSTRAINT "DailyTemporaryRosterWorker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyTemporaryRosterWorker" ADD CONSTRAINT "DailyTemporaryRosterWorker_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyTemporaryRosterWorker" ADD CONSTRAINT "DailyTemporaryRosterWorker_organizationId_facilityId_rosterId_fkey" FOREIGN KEY ("organizationId", "facilityId", "rosterId") REFERENCES "DailyTemporaryRoster"("organizationId", "facilityId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyTemporaryRosterWorker" ADD CONSTRAINT "DailyTemporaryRosterWorker_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTemporaryRosterHistory" ADD CONSTRAINT "DailyTemporaryRosterHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyTemporaryRosterHistory" ADD CONSTRAINT "DailyTemporaryRosterHistory_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyTemporaryRosterHistory" ADD CONSTRAINT "DailyTemporaryRosterHistory_organizationId_facilityId_rosterId_fkey" FOREIGN KEY ("organizationId", "facilityId", "rosterId") REFERENCES "DailyTemporaryRoster"("organizationId", "facilityId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (RLS) Configuration
ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department" FORCE ROW LEVEL SECURITY;

ALTER TABLE "DepartmentMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DepartmentMembership" FORCE ROW LEVEL SECURITY;

ALTER TABLE "DepartmentAreaRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DepartmentAreaRule" FORCE ROW LEVEL SECURITY;

ALTER TABLE "UserAreaOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserAreaOverride" FORCE ROW LEVEL SECURITY;

ALTER TABLE "DailyTemporaryRoster" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyTemporaryRoster" FORCE ROW LEVEL SECURITY;

ALTER TABLE "DailyTemporaryRosterWorker" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyTemporaryRosterWorker" FORCE ROW LEVEL SECURITY;

ALTER TABLE "DailyTemporaryRosterHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyTemporaryRosterHistory" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    -- Department
    EXECUTE 'CREATE POLICY department_read_scope ON "Department" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
    EXECUTE 'CREATE POLICY department_write_scope ON "Department" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';

    -- DepartmentMembership
    EXECUTE 'CREATE POLICY department_membership_read_scope ON "DepartmentMembership" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
    EXECUTE 'CREATE POLICY department_membership_write_scope ON "DepartmentMembership" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';

    -- DepartmentAreaRule
    EXECUTE 'CREATE POLICY department_area_rule_read_scope ON "DepartmentAreaRule" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")))';
    EXECUTE 'CREATE POLICY department_area_rule_write_scope ON "DepartmentAreaRule" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId"))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")))';

    -- UserAreaOverride
    EXECUTE 'CREATE POLICY user_area_override_read_scope ON "UserAreaOverride" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")))';
    EXECUTE 'CREATE POLICY user_area_override_write_scope ON "UserAreaOverride" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId"))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")))';

    -- DailyTemporaryRoster
    EXECUTE 'CREATE POLICY daily_temporary_roster_read_scope ON "DailyTemporaryRoster" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
    EXECUTE 'CREATE POLICY daily_temporary_roster_write_scope ON "DailyTemporaryRoster" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';

    -- DailyTemporaryRosterWorker
    EXECUTE 'CREATE POLICY daily_temporary_roster_worker_read_scope ON "DailyTemporaryRosterWorker" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
    EXECUTE 'CREATE POLICY daily_temporary_roster_worker_write_scope ON "DailyTemporaryRosterWorker" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';

    -- DailyTemporaryRosterHistory
    EXECUTE 'CREATE POLICY daily_temporary_roster_history_read_scope ON "DailyTemporaryRosterHistory" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
    EXECUTE 'CREATE POLICY daily_temporary_roster_history_write_scope ON "DailyTemporaryRosterHistory" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
  END IF;
END $$;

REVOKE ALL ON "Department" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "DepartmentMembership" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "DepartmentAreaRule" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "UserAreaOverride" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "DailyTemporaryRoster" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "DailyTemporaryRosterWorker" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "DailyTemporaryRosterHistory" FROM PUBLIC, anon, authenticated;
