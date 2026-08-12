-- Close tenant-isolation gaps in stadium operational tables.
DROP INDEX IF EXISTS "SuiteBeoOrder_beoNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SuiteBeoOrder_organizationId_facilityId_beoNumber_key"
  ON "SuiteBeoOrder"("organizationId", "facilityId", "beoNumber");

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "SuiteBeoOrder", "SuiteBeoStatusLog", "SuiteBeoReplenishmentRequest", "EnterpriseWebhookLog",
  "StandSheet", "InventoryTransferRequest", "HawkerVendorSession", "EventMenuOverlay",
  "TempAgency", "WorkerProfile", "ShiftPunch", "UnionRuleConfig", "UnionComplianceViolation"
TO stadium_api;

ALTER TABLE "SuiteBeoOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SuiteBeoOrder" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SuiteBeoStatusLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SuiteBeoStatusLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SuiteBeoReplenishmentRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SuiteBeoReplenishmentRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EnterpriseWebhookLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EnterpriseWebhookLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "StandSheet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StandSheet" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransferRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransferRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "HawkerVendorSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HawkerVendorSession" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EventMenuOverlay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventMenuOverlay" FORCE ROW LEVEL SECURITY;
ALTER TABLE "TempAgency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TempAgency" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WorkerProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkerProfile" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ShiftPunch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftPunch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "UnionRuleConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UnionRuleConfig" FORCE ROW LEVEL SECURITY;
ALTER TABLE "UnionComplianceViolation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UnionComplianceViolation" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suite_beo_order_read_scope ON "SuiteBeoOrder";
DROP POLICY IF EXISTS suite_beo_order_write_scope ON "SuiteBeoOrder";
CREATE POLICY suite_beo_order_scope ON "SuiteBeoOrder" FOR ALL TO stadium_api
  USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")))
  WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));

CREATE POLICY suite_beo_status_log_scope ON "SuiteBeoStatusLog" FOR ALL TO stadium_api
  USING (EXISTS (SELECT 1 FROM "SuiteBeoOrder" b WHERE b."id" = "SuiteBeoStatusLog"."beoOrderId" AND (SELECT app_private.scope_matches(b."organizationId", b."facilityId", b."zoneId"))))
  WITH CHECK (EXISTS (SELECT 1 FROM "SuiteBeoOrder" b WHERE b."id" = "SuiteBeoStatusLog"."beoOrderId" AND (SELECT app_private.scope_matches(b."organizationId", b."facilityId", b."zoneId"))));
CREATE POLICY suite_beo_replenishment_scope ON "SuiteBeoReplenishmentRequest" FOR ALL TO stadium_api
  USING (EXISTS (SELECT 1 FROM "SuiteBeoOrder" b WHERE b."id" = "SuiteBeoReplenishmentRequest"."beoOrderId" AND (SELECT app_private.scope_matches(b."organizationId", b."facilityId", b."zoneId"))))
  WITH CHECK (EXISTS (SELECT 1 FROM "SuiteBeoOrder" b WHERE b."id" = "SuiteBeoReplenishmentRequest"."beoOrderId" AND (SELECT app_private.scope_matches(b."organizationId", b."facilityId", b."zoneId"))));
CREATE POLICY enterprise_webhook_log_scope ON "EnterpriseWebhookLog" FOR ALL TO stadium_api
  USING ((SELECT app_private.scope_matches("organizationId", NULL, NULL)))
  WITH CHECK ((SELECT app_private.scope_matches("organizationId", NULL, NULL)));

DROP POLICY IF EXISTS stand_sheet_read_scope ON "StandSheet";
DROP POLICY IF EXISTS stand_sheet_write_scope ON "StandSheet";
CREATE POLICY stand_sheet_scope ON "StandSheet" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId"))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
CREATE POLICY inventory_transfer_scope ON "InventoryTransferRequest" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)));
CREATE POLICY hawker_session_scope ON "HawkerVendorSession" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)));
CREATE POLICY event_menu_overlay_scope ON "EventMenuOverlay" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)));

DROP POLICY IF EXISTS temp_agency_read_scope ON "TempAgency";
DROP POLICY IF EXISTS worker_profile_read_scope ON "WorkerProfile";
DROP POLICY IF EXISTS shift_punch_read_scope ON "ShiftPunch";
CREATE POLICY temp_agency_scope ON "TempAgency" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)));
CREATE POLICY worker_profile_scope ON "WorkerProfile" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)));
CREATE POLICY shift_punch_scope ON "ShiftPunch" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId"))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
CREATE POLICY union_rule_config_scope ON "UnionRuleConfig" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)));
CREATE POLICY union_violation_scope ON "UnionComplianceViolation" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)));
