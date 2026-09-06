-- Link an operational suite BEO order to the sales BEO it fulfils.
--
-- Nullable: a suite order can be raised on event day with no sales document
-- behind it. ON DELETE SET NULL rather than CASCADE: deleting a draft contract
-- must never delete the catering a suite is actually owed.
ALTER TABLE "SuiteBeoOrder" ADD COLUMN "crmBeoId" TEXT;

CREATE INDEX "SuiteBeoOrder_crmBeoId_idx" ON "SuiteBeoOrder"("crmBeoId");

ALTER TABLE "SuiteBeoOrder" ADD CONSTRAINT "SuiteBeoOrder_crmBeoId_fkey"
  FOREIGN KEY ("crmBeoId") REFERENCES "CrmBeo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The two tables are scoped differently — SuiteBeoOrder by (organizationId,
-- facilityId), CrmBeo by venueId — and Venue and Facility deliberately share an
-- id. Enforce that a link never crosses venues, which no foreign key can say.
CREATE OR REPLACE FUNCTION app_private.suite_beo_crm_beo_same_venue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW."crmBeoId" IS NULL THEN
    RETURN NEW;
  END IF;
  -- SECURITY INVOKER on purpose: under RLS a CrmBeo outside the caller's scope
  -- is simply not visible here, so a cross-tenant link fails the same check.
  IF NOT EXISTS (
    SELECT 1 FROM public."CrmBeo" b
    WHERE b.id = NEW."crmBeoId" AND b."venueId" = NEW."facilityId"
  ) THEN
    RAISE EXCEPTION 'CrmBeo % does not belong to facility %', NEW."crmBeoId", NEW."facilityId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER suite_beo_crm_beo_same_venue
  BEFORE INSERT OR UPDATE OF "crmBeoId" ON "SuiteBeoOrder"
  FOR EACH ROW EXECUTE FUNCTION app_private.suite_beo_crm_beo_same_venue();
