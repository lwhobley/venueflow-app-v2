-- POS Aggregator Channels: manager-configured routing entries for the
-- aggregator's channel matrix (zone terminals -> primary/fallback provider).
-- Replaces a hardcoded, non-venue-scoped fixture the API previously returned
-- for every venue identically.

CREATE TABLE "PosAggregatorChannel" (
  "id" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "zoneLabel" TEXT NOT NULL,
  "primaryProvider" "PosProvider" NOT NULL,
  "fallbackProvider" "PosProvider" NOT NULL,
  "terminalCount" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PosAggregatorChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosAggregatorChannel_venueId_name_key" ON "PosAggregatorChannel"("venueId", "name");
CREATE INDEX "PosAggregatorChannel_venueId_active_idx" ON "PosAggregatorChannel"("venueId", "active");

ALTER TABLE "PosAggregatorChannel" ADD CONSTRAINT "PosAggregatorChannel_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- This server-owned table is not a Supabase Data API surface.
ALTER TABLE "PosAggregatorChannel" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "PosAggregatorChannel" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "PosAggregatorChannel" FROM authenticated;
  END IF;
END
$$;
