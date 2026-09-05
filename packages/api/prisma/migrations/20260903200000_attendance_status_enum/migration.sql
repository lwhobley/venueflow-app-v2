-- F-14 (database half): constrain DailyTemporaryRosterWorker.attendanceStatus.
--
-- The column was `TEXT NOT NULL DEFAULT 'scheduled'` -- free text with no enum
-- and no CHECK, so any string was a valid attendance state at the database
-- layer. The DTO half was already guarded by @IsIn(VALID_ATTENDANCE_STATUSES),
-- but that only covers requests that go through the DTOs; direct writes,
-- scripts, and any future non-DTO code path were unconstrained, letting typos
-- silently create states that reports cannot bucket.
--
-- This converts the column to a Postgres enum, matching the pattern already
-- used by DailyRosterStatus and KitchenTicketStatus in this same feature.

CREATE TYPE "AttendanceStatus" AS ENUM (
  'scheduled',
  'checked_in',
  'checked_out',
  'no_show',
  'excused'
);

-- Refuse to convert rather than silently rewrite unrecognized values. These
-- rows sit alongside hoursWorked / breakMinutes / hourlyRateCents, so they are
-- payroll-adjacent: coercing an unknown status to 'scheduled' would destroy
-- information about a worker's actual attendance. If this aborts, reconcile the
-- offending rows deliberately and re-run.
DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(DISTINCT quote_literal("attendanceStatus"), ', ')
  INTO offending
  FROM "DailyTemporaryRosterWorker"
  WHERE "attendanceStatus" NOT IN (
    'scheduled', 'checked_in', 'checked_out', 'no_show', 'excused'
  );

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot convert "DailyTemporaryRosterWorker"."attendanceStatus" to the AttendanceStatus enum: unrecognized value(s) present: %. Reconcile these rows before re-running this migration.',
      offending;
  END IF;
END
$$;

ALTER TABLE "DailyTemporaryRosterWorker"
  ALTER COLUMN "attendanceStatus" DROP DEFAULT,
  ALTER COLUMN "attendanceStatus" TYPE "AttendanceStatus"
    USING "attendanceStatus"::"AttendanceStatus",
  ALTER COLUMN "attendanceStatus" SET DEFAULT 'scheduled';
