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

-- psql substitutes :'var' textually in ordinary top-level SQL, but NOT inside
-- a dollar-quoted DO $$ ... $$ body (that text is sent to the server as an
-- opaque string) — a DO block using :'stadium_api_password' inside format()
-- fails with "syntax error at or near ':'" because the literal `:'...'` text
-- reaches the server unexpanded. \gexec is the standard psql idiom for
-- conditional DDL that needs a client-side variable: run a query that
-- PRODUCES the DDL text (substitution happens here, in ordinary SQL), then
-- \gexec executes whatever it returned.
SELECT 'CREATE ROLE stadium_api LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD ' || quote_literal(:'stadium_api_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api')
\gexec

-- Ensure the security-critical attributes are correct even if the role
-- pre-exists from an earlier partial run (no-op on a freshly created role).
ALTER ROLE stadium_api LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;

-- Runtime grants: DML only, no DDL. RLS policies do the tenant scoping.
GRANT CONNECT ON DATABASE :"db_name" TO stadium_api;
GRANT USAGE ON SCHEMA public TO stadium_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO stadium_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO stadium_api;
GRANT USAGE ON SCHEMA app_private TO stadium_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO stadium_api;

-- app_private was explicitly locked down to PUBLIC (REVOKE ALL ... FROM
-- PUBLIC, see migration 20260903120000) when it was created, and that
-- REVOKE predates stadium_migrator existing. Once the ownership reassignment
-- below makes stadium_migrator the OWNER of every app_private function, its
-- SECURITY DEFINER functions run "as stadium_migrator" — and a SECURITY
-- DEFINER function's body calling ANOTHER function in the same schema (e.g.
-- venue_matches() calling current_venue_id()) still needs the schema-level
-- USAGE grant for whichever role it's executing as, regardless of ownership.
-- Verified locally: every stadium_api call into venue_matches() failed with
-- "permission denied for schema app_private" until this grant was added.
GRANT USAGE ON SCHEMA app_private TO stadium_migrator;

-- Future tables/sequences created by the migrator inherit the same runtime grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stadium_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO stadium_api;

-- Reassign ownership of every EXISTING table/sequence/function to
-- stadium_migrator. This is not optional: PostgreSQL exempts a table's OWNER
-- from RLS whenever the table isn't FORCE ROW LEVEL SECURITY (none of ours
-- are — see docs/rls-cutover-runbook.md), and the auth-bootstrap SECURITY
-- DEFINER functions (migration 20260903140000) rely on exactly that exemption
-- to read Session/User/Profile/Venue before any tenant GUC can exist. On a
-- database whose tables predate this script (i.e. every real deploy so far,
-- created under whatever the deploy credential was — typically `postgres`),
-- those functions would otherwise hit `permission denied for table X` the
-- first time this migrator role differs from the table's actual owner.
-- Verified locally: this failed exactly this way until ownership was
-- reassigned. Idempotent — reassigning an already-stadium_migrator-owned
-- object is a no-op.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'app_private')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO stadium_migrator', r.schemaname, r.tablename);
  END LOOP;
  FOR r IN SELECT schemaname, sequencename FROM pg_sequences WHERE schemaname IN ('public', 'app_private')
  LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO stadium_migrator', r.schemaname, r.sequencename);
  END LOOP;
  FOR r IN
    SELECT n.nspname AS schemaname, p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO stadium_migrator', r.signature);
  END LOOP;
END
$$;

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
