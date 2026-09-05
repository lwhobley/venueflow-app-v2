-- CreateEnum
CREATE TYPE "KitchenTicketStatus" AS ENUM ('waiting', 'firing', 'ready', 'overdue_pickup', 'picked_up', 'cancelled');

-- CreateEnum
CREATE TYPE "KitchenTicketPriority" AS ENUM ('normal', 'high', 'urgent');

-- CreateTable
CREATE TABLE "KitchenFulfillmentTicket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "eventId" TEXT,
    "beoId" TEXT,
    "zoneId" TEXT,
    "serviceAreaId" TEXT,
    "serviceAreaName" TEXT NOT NULL,
    "kitchenId" TEXT NOT NULL,
    "kitchenName" TEXT NOT NULL,
    "distroLocationId" TEXT,
    "distroLocationName" TEXT,
    "requestedByUserId" TEXT,
    "assignedToUserId" TEXT,
    "status" "KitchenTicketStatus" NOT NULL DEFAULT 'waiting',
    "priority" "KitchenTicketPriority" NOT NULL DEFAULT 'normal',
    "itemName" TEXT NOT NULL,
    "itemDescription" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitOfMeasure" TEXT,
    "notes" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "pickedUpByUserId" TEXT,
    "pickedUpByName" TEXT,
    "overdueAt" TIMESTAMP(3),
    "wasOverdue" BOOLEAN NOT NULL DEFAULT false,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenFulfillmentTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenFulfillmentStatusHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromStatus" "KitchenTicketStatus",
    "toStatus" "KitchenTicketStatus" NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KitchenFulfillmentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KitchenFulfillmentTicket_organizationId_facilityId_status_idx" ON "KitchenFulfillmentTicket"("organizationId", "facilityId", "status");

-- CreateIndex
CREATE INDEX "KitchenFulfillmentTicket_facilityId_kitchenId_status_idx" ON "KitchenFulfillmentTicket"("facilityId", "kitchenId", "status");

-- CreateIndex
CREATE INDEX "KitchenFulfillmentTicket_facilityId_serviceAreaId_status_idx" ON "KitchenFulfillmentTicket"("facilityId", "serviceAreaId", "status");

-- CreateIndex
CREATE INDEX "KitchenFulfillmentTicket_facilityId_readyAt_idx" ON "KitchenFulfillmentTicket"("facilityId", "readyAt");

-- CreateIndex
CREATE INDEX "KitchenFulfillmentTicket_beoId_idx" ON "KitchenFulfillmentTicket"("beoId");

-- CreateIndex
CREATE INDEX "KitchenFulfillmentStatusHistory_ticketId_timestamp_idx" ON "KitchenFulfillmentStatusHistory"("ticketId", "timestamp");

-- CreateIndex
CREATE INDEX "KitchenFulfillmentStatusHistory_organizationId_facilityId_idx" ON "KitchenFulfillmentStatusHistory"("organizationId", "facilityId");

-- AddForeignKey
ALTER TABLE "KitchenFulfillmentTicket" ADD CONSTRAINT "KitchenFulfillmentTicket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenFulfillmentTicket" ADD CONSTRAINT "KitchenFulfillmentTicket_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenFulfillmentStatusHistory" ADD CONSTRAINT "KitchenFulfillmentStatusHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenFulfillmentStatusHistory" ADD CONSTRAINT "KitchenFulfillmentStatusHistory_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenFulfillmentStatusHistory" ADD CONSTRAINT "KitchenFulfillmentStatusHistory_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "KitchenFulfillmentTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security for KitchenFulfillmentTicket
ALTER TABLE "KitchenFulfillmentTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KitchenFulfillmentTicket" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    EXECUTE 'CREATE POLICY kitchen_fulfillment_ticket_read_scope ON "KitchenFulfillmentTicket" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")))';
    EXECUTE 'CREATE POLICY kitchen_fulfillment_ticket_write_scope ON "KitchenFulfillmentTicket" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId"))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")))';
  END IF;
END $$;

-- Row-Level Security for KitchenFulfillmentStatusHistory
ALTER TABLE "KitchenFulfillmentStatusHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KitchenFulfillmentStatusHistory" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    EXECUTE 'CREATE POLICY kitchen_fulfillment_history_read_scope ON "KitchenFulfillmentStatusHistory" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
    EXECUTE 'CREATE POLICY kitchen_fulfillment_history_write_scope ON "KitchenFulfillmentStatusHistory" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))';
  END IF;
END $$;

REVOKE ALL ON "KitchenFulfillmentTicket" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON "KitchenFulfillmentStatusHistory" FROM PUBLIC, anon, authenticated;
