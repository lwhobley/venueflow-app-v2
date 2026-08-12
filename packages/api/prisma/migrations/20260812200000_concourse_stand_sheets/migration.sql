-- Concourse Outlets, Stand Sheets, Restock Transfers, Hawker Sessions, and Event Menu Overlays Migration

ALTER TYPE "FnbOperationType" ADD VALUE IF NOT EXISTS 'fixed_concourse_stand';
ALTER TYPE "FnbOperationType" ADD VALUE IF NOT EXISTS 'grab_and_go_kiosk';
ALTER TYPE "FnbOperationType" ADD VALUE IF NOT EXISTS 'mobile_cart';
ALTER TYPE "FnbOperationType" ADD VALUE IF NOT EXISTS 'hawker_vendor';

CREATE TYPE "StandSheetStatus" AS ENUM ('draft', 'count_in_recorded', 'active_event', 'count_out_recorded', 'reconciled');
CREATE TYPE "TransferStatus" AS ENUM ('pending', 'approved', 'in_transit', 'completed', 'rejected');
CREATE TYPE "HawkerSessionStatus" AS ENUM ('active', 'checked_in', 'settled');
CREATE TYPE "EventPresetType" AS ENUM ('family_event', 'concert_mode', 'custom');

CREATE TABLE "StandSheet" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "outletId" TEXT NOT NULL,
  "eventId" TEXT,
  "supervisorId" TEXT,
  "supervisorName" TEXT,
  "status" "StandSheetStatus" NOT NULL DEFAULT 'draft',
  "countIn" JSONB NOT NULL,
  "restocks" JSONB NOT NULL,
  "countOut" JSONB NOT NULL,
  "wasteCount" JSONB NOT NULL,
  "posItemsSold" JSONB NOT NULL,
  "expectedSalesRevenueCents" INTEGER NOT NULL DEFAULT 0,
  "actualPosRevenueCents" INTEGER NOT NULL DEFAULT 0,
  "varianceAmountCents" INTEGER NOT NULL DEFAULT 0,
  "inventoryVariance" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StandSheet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryTransferRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "fromOutletId" TEXT NOT NULL,
  "toOutletId" TEXT NOT NULL,
  "eventId" TEXT,
  "requestedBy" TEXT,
  "status" "TransferStatus" NOT NULL DEFAULT 'pending',
  "items" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "InventoryTransferRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HawkerVendorSession" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "hawkerId" TEXT NOT NULL,
  "hawkerName" TEXT NOT NULL,
  "eventId" TEXT,
  "itemsCheckedOut" JSONB NOT NULL,
  "itemsCheckedIn" JSONB,
  "itemsSold" JSONB,
  "cashCollectedCents" INTEGER NOT NULL DEFAULT 0,
  "cardCollectedCents" INTEGER NOT NULL DEFAULT 0,
  "grossSalesCents" INTEGER NOT NULL DEFAULT 0,
  "commissionRateBps" INTEGER NOT NULL DEFAULT 1500,
  "commissionPayoutCents" INTEGER NOT NULL DEFAULT 0,
  "status" "HawkerSessionStatus" NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "HawkerVendorSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventMenuOverlay" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "eventId" TEXT,
  "name" TEXT NOT NULL,
  "presetType" "EventPresetType" NOT NULL,
  "alcoholDisabled" BOOLEAN NOT NULL DEFAULT false,
  "surchargePercentage" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "appliedOutletTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventMenuOverlay_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StandSheet_organizationId_facilityId_zoneId_status_idx" ON "StandSheet"("organizationId", "facilityId", "zoneId", "status");
CREATE INDEX "StandSheet_outletId_createdAt_idx" ON "StandSheet"("outletId", "createdAt");
CREATE INDEX "StandSheet_eventId_status_idx" ON "StandSheet"("eventId", "status");

CREATE INDEX "InventoryTransferRequest_organizationId_facilityId_status_idx" ON "InventoryTransferRequest"("organizationId", "facilityId", "status");
CREATE INDEX "InventoryTransferRequest_toOutletId_createdAt_idx" ON "InventoryTransferRequest"("toOutletId", "createdAt");

CREATE INDEX "HawkerVendorSession_organizationId_facilityId_status_idx" ON "HawkerVendorSession"("organizationId", "facilityId", "status");
CREATE INDEX "HawkerVendorSession_hawkerId_createdAt_idx" ON "HawkerVendorSession"("hawkerId", "createdAt");

CREATE INDEX "EventMenuOverlay_organizationId_facilityId_active_idx" ON "EventMenuOverlay"("organizationId", "facilityId", "active");
CREATE INDEX "EventMenuOverlay_eventId_active_idx" ON "EventMenuOverlay"("eventId", "active");

ALTER TABLE "StandSheet" ADD CONSTRAINT "StandSheet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StandSheet" ADD CONSTRAINT "StandSheet_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StandSheet" ADD CONSTRAINT "StandSheet_organizationId_facilityId_zoneId_fkey" FOREIGN KEY ("organizationId", "facilityId", "zoneId") REFERENCES "FacilityZone"("organizationId", "facilityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StandSheet" ADD CONSTRAINT "StandSheet_organizationId_facilityId_zoneId_outletId_fkey" FOREIGN KEY ("organizationId", "facilityId", "zoneId", "outletId") REFERENCES "Outlet"("organizationId", "facilityId", "zoneId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryTransferRequest" ADD CONSTRAINT "InventoryTransferRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransferRequest" ADD CONSTRAINT "InventoryTransferRequest_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HawkerVendorSession" ADD CONSTRAINT "HawkerVendorSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HawkerVendorSession" ADD CONSTRAINT "HawkerVendorSession_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventMenuOverlay" ADD CONSTRAINT "EventMenuOverlay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventMenuOverlay" ADD CONSTRAINT "EventMenuOverlay_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security Policies
ALTER TABLE "StandSheet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StandSheet" FORCE ROW LEVEL SECURITY;
CREATE POLICY stand_sheet_read_scope ON "StandSheet" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
CREATE POLICY stand_sheet_write_scope ON "StandSheet" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId"))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
