-- Make VmsAuditLog append-only through privileges rather than a DELETE trigger.
--
-- Migration 20260904170000 added a BEFORE UPDATE OR DELETE trigger that raised
-- unconditionally. That made the log immutable, but it also made it impossible
-- to delete a Facility or Organization that had ever produced a VMS audit row:
-- the cascade from Facility -> VmsAuditLog fires the trigger and the whole
-- statement aborts. Venue teardown, tenant offboarding and the integration
-- suite all break on it.
--
-- The protection belongs at the privilege layer instead. stadium_api is the
-- runtime role, and it keeps SELECT and INSERT only, so nothing the application
-- can do will ever amend or remove an audit entry - which is what section 5.3
-- actually asks for. The table owner retains DELETE so that a legitimate
-- lifecycle operation (dropping a facility, erasing a tenant) can still cascade.
--
-- UPDATE stays trigger-guarded for everyone including the owner: there is no
-- legitimate reason to rewrite an audit row, and unlike DELETE it is never
-- reached by a cascade.

CREATE OR REPLACE FUNCTION app_private.enforce_vms_audit_log_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  RAISE EXCEPTION 'VmsAuditLog records are immutable and cannot be amended.';
END;
$fn$;

DROP TRIGGER IF EXISTS enforce_vms_audit_log_immutability ON "VmsAuditLog";
CREATE TRIGGER enforce_vms_audit_log_immutability
  BEFORE UPDATE ON "VmsAuditLog"
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_vms_audit_log_immutability();

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    -- Withdraw the blanket DML grant 20260904170000 issued for this table and
    -- re-grant only what an append-only log needs.
    EXECUTE 'REVOKE UPDATE, DELETE ON "VmsAuditLog" FROM stadium_api';
    EXECUTE 'GRANT SELECT, INSERT ON "VmsAuditLog" TO stadium_api';
  END IF;
END
$do$;
