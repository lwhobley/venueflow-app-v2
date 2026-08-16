-- Phase 1 of RLS cutover: app_private helpers only.
-- Safe to apply before stadium_api role exists and before FORCE RLS.
-- See docs/rls-cutover-runbook.md and docs/stadium-hierarchy-rls.sql.

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

-- Do not grant to anon/authenticated; NestJS uses a dedicated role.

CREATE OR REPLACE FUNCTION app_private.current_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_private.current_organization_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_private.current_facility_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.facility_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_private.current_venue_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.venue_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_private.current_zone_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.zone_id', true), '')
$$;

-- Returns true when the row's hierarchy columns match the bound session GUCs.
-- Empty GUC means "not bound" and fails closed for policy use.
CREATE OR REPLACE FUNCTION app_private.scope_matches(
  row_organization_id text,
  row_facility_id text DEFAULT NULL,
  row_zone_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    COALESCE(row_organization_id, '') = COALESCE(app_private.current_organization_id(), '')
    AND (
      row_facility_id IS NULL
      OR COALESCE(row_facility_id, '') = COALESCE(app_private.current_facility_id(), '')
      OR COALESCE(row_facility_id, '') = COALESCE(app_private.current_venue_id(), '')
    )
    AND (
      row_zone_id IS NULL
      OR COALESCE(row_zone_id, '') = COALESCE(app_private.current_zone_id(), '')
    );
$$;

-- Placeholder capability checks; refine after membership tables are live under RLS.
CREATE OR REPLACE FUNCTION app_private.can_manage_memberships()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.current_user_id() IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION app_private.can_operate_scope()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.current_user_id() IS NOT NULL
$$;

COMMENT ON SCHEMA app_private IS 'Request-scoped helpers for RLS policies. Values come from SET LOCAL app.* inside withTenantTransaction.';
