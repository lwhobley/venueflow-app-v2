-- RLS cutover — Phase 0: provision database principals (one-time, as SUPERUSER).
--
-- Run this ONCE per environment against the target database, connected as a
-- superuser (or the Supabase `postgres` role). It is idempotent. It does NOT
-- switch the application over — the API keeps using its current role until you
-- change DATABASE_URL (see phase-final-cutover notes in rls-cutover-runbook.md).
--
-- Roles:
--   stadium_migrator — schema owner used ONLY by release/migration jobs (CI /
--                      Cloud Run Job), never by the API image.
--   stadium_api      — API runtime role: LOGIN, NOBYPASSRLS, no DDL. Tenant
--                      isolation is enforced against THIS role by the policies
--                      in migrations 20260903120000 / 20260903130000.
--
-- Set the two psql variables before running, e.g.:
--   psql "$DATABASE_DIRECT_URL" \
--     -v db_name="$(psql "$DATABASE_DIRECT_URL" -tAc 'select current_database()')" \
--     -v stadium_api_password="'<STRONG-SECRET>'" \
--     -f scripts/rls-cutover/phase0-roles.sql
-- The password value must be quoted (it is injected as a SQL literal).

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_migrator') THEN
    CREATE ROLE stadium_migrator NOINHERIT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    -- Password is provided via :stadium_api_password (a quoted SQL literal).
    EXECUTE format(
      'CREATE ROLE stadium_api LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD %s',
      :'stadium_api_password'
    );
  ELSE
    -- Ensure the security-critical attributes are correct even if the role
    -- pre-exists from an earlier partial run.
    ALTER ROLE stadium_api LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- Runtime grants: DML only, no DDL. RLS policies do the tenant scoping.
GRANT CONNECT ON DATABASE :"db_name" TO stadium_api;
GRANT USAGE ON SCHEMA public TO stadium_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO stadium_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO stadium_api;
GRANT USAGE ON SCHEMA app_private TO stadium_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO stadium_api;

-- Future tables/sequences created by the migrator inherit the same runtime grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stadium_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO stadium_api;

-- Verify posture.
DO $$
DECLARE r record;
BEGIN
  SELECT rolcanlogin, rolbypassrls, rolsuper INTO r FROM pg_roles WHERE rolname = 'stadium_api';
  IF r.rolbypassrls OR r.rolsuper OR NOT r.rolcanlogin THEN
    RAISE EXCEPTION 'stadium_api posture wrong: canlogin=% bypassrls=% super=%',
      r.rolcanlogin, r.rolbypassrls, r.rolsuper;
  END IF;
  RAISE NOTICE 'stadium_api provisioned: LOGIN, NOBYPASSRLS, NOSUPERUSER — OK';
END
$$;
