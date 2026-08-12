-- Mass Temp Staffing & Union Compliance Migration

CREATE TYPE "PunchType" AS ENUM ('IN', 'OUT', 'MEAL_START', 'MEAL_END');
CREATE TYPE "PunchVerification" AS ENUM ('qr_scan', 'pin_entry', 'supervisor_override');
CREATE TYPE "ComplianceViolationType" AS ENUM ('missed_meal_break', 'late_meal_break', 'excessive_overtime', 'unauthorized_double_time');

CREATE TABLE "TempAgency" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "billingRateMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.35,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TempAgency_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkerProfile" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "agencyId" TEXT,
  "unionMemberId" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "pinCode" TEXT NOT NULL,
  "qrCodeIdentifier" TEXT NOT NULL,
  "certFoodSafety" BOOLEAN NOT NULL DEFAULT true,
  "certAlcohol" BOOLEAN NOT NULL DEFAULT true,
  "certAlcoholExpiry" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkerProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShiftPunch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "zoneId" TEXT,
  "outletId" TEXT,
  "workerId" TEXT NOT NULL,
  "punchType" "PunchType" NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedVia" "PunchVerification" NOT NULL DEFAULT 'pin_entry',
  "overrideReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShiftPunch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UnionRuleConfig" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Standard Culinary Union Local 226',
  "maxContinuousWorkHours" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  "mandatoryMealBreakMinutes" INTEGER NOT NULL DEFAULT 30,
  "mealBreakWindowHours" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  "overtimeThresholdHours" DOUBLE PRECISION NOT NULL DEFAULT 8.0,
  "dailyDoubleTimeThreshold" DOUBLE PRECISION NOT NULL DEFAULT 12.0,
  "premiumPayMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  "mealPenaltyPayCents" INTEGER NOT NULL DEFAULT 2500,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UnionRuleConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UnionComplianceViolation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "shiftPunchId" TEXT,
  "violationType" "ComplianceViolationType" NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'warning',
  "penaltyAmountCents" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnionComplianceViolation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TempAgency_organizationId_facilityId_code_key" ON "TempAgency"("organizationId", "facilityId", "code");
CREATE INDEX "TempAgency_organizationId_facilityId_active_idx" ON "TempAgency"("organizationId", "facilityId", "active");

CREATE UNIQUE INDEX "WorkerProfile_qrCodeIdentifier_key" ON "WorkerProfile"("qrCodeIdentifier");
CREATE UNIQUE INDEX "WorkerProfile_organizationId_facilityId_pinCode_key" ON "WorkerProfile"("organizationId", "facilityId", "pinCode");
CREATE INDEX "WorkerProfile_organizationId_facilityId_active_idx" ON "WorkerProfile"("organizationId", "facilityId", "active");

CREATE INDEX "ShiftPunch_organizationId_facilityId_workerId_timestamp_idx" ON "ShiftPunch"("organizationId", "facilityId", "workerId", "timestamp");
CREATE INDEX "ShiftPunch_workerId_punchType_idx" ON "ShiftPunch"("workerId", "punchType");

CREATE INDEX "UnionRuleConfig_organizationId_facilityId_active_idx" ON "UnionRuleConfig"("organizationId", "facilityId", "active");

CREATE INDEX "UnionComplianceViolation_organizationId_facilityId_workerId_idx" ON "UnionComplianceViolation"("organizationId", "facilityId", "workerId");
CREATE INDEX "UnionComplianceViolation_violationType_resolved_idx" ON "UnionComplianceViolation"("violationType", "resolved");

ALTER TABLE "TempAgency" ADD CONSTRAINT "TempAgency_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TempAgency" ADD CONSTRAINT "TempAgency_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkerProfile" ADD CONSTRAINT "WorkerProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkerProfile" ADD CONSTRAINT "WorkerProfile_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkerProfile" ADD CONSTRAINT "WorkerProfile_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "TempAgency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShiftPunch" ADD CONSTRAINT "ShiftPunch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftPunch" ADD CONSTRAINT "ShiftPunch_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftPunch" ADD CONSTRAINT "ShiftPunch_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UnionRuleConfig" ADD CONSTRAINT "UnionRuleConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnionRuleConfig" ADD CONSTRAINT "UnionRuleConfig_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UnionComplianceViolation" ADD CONSTRAINT "UnionComplianceViolation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnionComplianceViolation" ADD CONSTRAINT "UnionComplianceViolation_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnionComplianceViolation" ADD CONSTRAINT "UnionComplianceViolation_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnionComplianceViolation" ADD CONSTRAINT "UnionComplianceViolation_shiftPunchId_fkey" FOREIGN KEY ("shiftPunchId") REFERENCES "ShiftPunch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security Policies
ALTER TABLE "TempAgency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkerProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftPunch" ENABLE ROW LEVEL SECURITY;

CREATE POLICY temp_agency_read_scope ON "TempAgency" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)));
CREATE POLICY worker_profile_read_scope ON "WorkerProfile" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)));
CREATE POLICY shift_punch_read_scope ON "ShiftPunch" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
