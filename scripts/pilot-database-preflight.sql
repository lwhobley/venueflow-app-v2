-- Read-only release evidence. Execute with a reviewed database target.
-- Runtime-role checks must use the actual application role. Duplicate and
-- migration checks must also be repeated with a read-only privileged session
-- because tenant RLS may intentionally hide other facilities.
BEGIN READ ONLY;
SELECT current_user AS runtime_role, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname = current_user;

SELECT COUNT(*) AS conflicting_open_punch_groups FROM (
  SELECT "facilityId", "staffMemberId"
  FROM "VmsTimeAttendance"
  WHERE "clockOut" IS NULL AND "staffMemberId" IS NOT NULL
  GROUP BY "facilityId", "staffMemberId" HAVING COUNT(*) > 1
) conflicts;

SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
AND indexname = 'VmsTimeAttendance_facility_staff_open_key';

SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
       pg_get_userbyid(c.relowner) AS table_owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
AND c.relname IN ('VenueEvent', 'EventIssue', 'EventCloseout', 'EventCloseoutRevision', 'VmsTimeAttendance');

SELECT migration_name, finished_at IS NOT NULL AS finished,
       rolled_back_at IS NOT NULL AS rolled_back
FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 10;
ROLLBACK;
