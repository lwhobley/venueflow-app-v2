#!/usr/bin/env bash
# RLS cutover — Phase 4 gate: prove tenant isolation under the NOBYPASSRLS
# runtime role BEFORE switching production DATABASE_URL to stadium_api.
#
# It seeds two isolated tenants using an admin/migrator connection, then runs a
# battery of assertions connected AS stadium_api (which must be NOBYPASSRLS),
# and finally removes the fixtures. Any failed assertion exits non-zero.
#
# Usage:
#   ADMIN_URL='postgresql://<superuser-or-migrator>@host:5432/db' \
#   API_URL='postgresql://stadium_api@host:5432/db' \
#   scripts/rls-cutover/verify-tenant-isolation.sh
#
# ADMIN_URL must be able to write fixtures (bypass or table owner). API_URL must
# be the stadium_api runtime role. Both point at the SAME database.
set -Eeuo pipefail

: "${ADMIN_URL:?set ADMIN_URL to an admin/migrator connection string}"
: "${API_URL:?set API_URL to the stadium_api connection string}"

PSQL_ADMIN=(psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -tA)
PSQL_API=(psql "$API_URL" -tA)
RID="rlschk_$(date +%s)_$$"
TS='2026-01-01 00:00:00'
fail=0

pass() { echo "  PASS  $1"; }
bad()  { echo "  FAIL  $1"; fail=1; }

echo "== RLS isolation gate (fixtures prefix: $RID) =="

# 0. stadium_api must be NOBYPASSRLS or the whole test is meaningless.
bypass="$("${PSQL_API[@]}" -c "select rolbypassrls from pg_roles where rolname=current_user;")"
[ "$bypass" = "f" ] && pass "runtime role is NOBYPASSRLS" || bad "runtime role has BYPASSRLS (=$bypass) — cutover unsafe"

cleanup() {
  "${PSQL_ADMIN[@]}" -c "
    delete from \"AuditLog\"    where \"id\"      like '${RID}%';
    delete from \"Reservation\" where \"id\"      like '${RID}%';
    delete from \"Profile\"     where \"id\"      like '${RID}%';
    delete from \"OrganizationMembership\" where \"id\" like '${RID}%';
    delete from \"Venue\"        where \"id\"     like '${RID}%';
    delete from \"Organization\" where \"id\"     like '${RID}%';
    delete from \"User\"         where \"id\"     like '${RID}%';
  " >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 1. Seed two isolated tenants A and B.
"${PSQL_ADMIN[@]}" -c "
  insert into \"User\"(\"id\") values ('${RID}_uA'),('${RID}_uB');
  insert into \"Organization\"(\"id\",\"name\",\"code\",\"updatedAt\")
    values ('${RID}_oA','A','${RID}A','$TS'),('${RID}_oB','B','${RID}B','$TS');
  insert into \"Venue\"(\"id\",\"name\",\"latitude\",\"longitude\",\"geofenceRadiusM\",\"code\",\"organizationId\",\"updatedAt\")
    values ('${RID}_vA','A',0,0,100,'${RID}VA','${RID}_oA','$TS'),
           ('${RID}_vB','B',0,0,100,'${RID}VB','${RID}_oB','$TS');
  insert into \"OrganizationMembership\"(\"id\",\"organizationId\",\"userId\",\"role\",\"updatedAt\")
    values ('${RID}_mA','${RID}_oA','${RID}_uA','owner','$TS'),
           ('${RID}_mB','${RID}_oB','${RID}_uB','owner','$TS');
  insert into \"Profile\"(\"id\",\"email\",\"fullName\",\"role\",\"jobTitle\",\"userId\",\"venueId\",\"updatedAt\")
    values ('${RID}_pA','${RID}a@x','A','manager','m','${RID}_uA','${RID}_vA','$TS'),
           ('${RID}_pB','${RID}b@x','B','manager','m','${RID}_uB','${RID}_vB','$TS');
  insert into \"Reservation\"(\"id\",\"venueId\",\"guestName\",\"partySize\",\"reservationTime\",\"durationMinutes\",\"source\",\"status\",\"updatedAt\")
    values ('${RID}_rA','${RID}_vA','GA',2,'$TS',90,'direct','confirmed','$TS'),
           ('${RID}_rB','${RID}_vB','GB',2,'$TS',90,'direct','confirmed','$TS');
  insert into \"AuditLog\"(\"id\",\"venueId\",\"entityType\",\"action\",\"summary\")
    values ('${RID}_alA','${RID}_vA','x','y','A'),('${RID}_alB','${RID}_vB','x','y','B');
" >/dev/null
pass "seeded two tenants"

# helper: run a query as stadium_api with tenant GUCs set for (user,venue)
as_api() { # $1=user $2=venue $3=sql  -> prints last line
  "${PSQL_API[@]}" -c "select set_config('app.user_id','$1',false),set_config('app.venue_id','$2',false); $3" | tail -1
}

# 2. Read isolation: A sees only its own reservation.
[ "$(as_api "${RID}_uA" "${RID}_vA" "select coalesce(string_agg(id,','),'') from \"Reservation\" where id like '${RID}%';")" = "${RID}_rA" ] \
  && pass "userA/venueA reads only its Reservation" || bad "userA/venueA read isolation"
[ "$(as_api "${RID}_uB" "${RID}_vB" "select coalesce(string_agg(id,','),'') from \"Reservation\" where id like '${RID}%';")" = "${RID}_rB" ] \
  && pass "userB/venueB reads only its Reservation" || bad "userB/venueB read isolation"

# 3. Fail-closed: no GUCs -> zero rows.
[ "$("${PSQL_API[@]}" -c "select count(*) from \"Reservation\" where id like '${RID}%';")" = "0" ] \
  && pass "no tenant context -> 0 rows (fail-closed)" || bad "missing GUCs did NOT fail closed"

# 4. Cross-tenant read attempt returns nothing.
[ "$(as_api "${RID}_uA" "${RID}_vA" "select count(*) from \"Reservation\" where \"venueId\"='${RID}_vB';")" = "0" ] \
  && pass "userA cannot read venueB rows" || bad "cross-tenant read leaked"

# write_as: run an INSERT as stadium_api with tenant GUCs; return combined output.
write_as() { # $1=user $2=venue $3=insert-sql
  { "${PSQL_API[@]}" -c "select set_config('app.user_id','$1',false),set_config('app.venue_id','$2',false); $3"; } 2>&1
}

# 5. Cross-tenant write rejected by WITH CHECK.
r5="$(write_as "${RID}_uA" "${RID}_vA" "insert into \"Reservation\"(\"id\",\"venueId\",\"guestName\",\"partySize\",\"reservationTime\",\"durationMinutes\",\"source\",\"status\",\"updatedAt\") values ('${RID}_evil','${RID}_vB','E',1,'$TS',1,'direct','confirmed','$TS');")" || true
echo "$r5" | grep -qi "row-level security" \
  && pass "userA INSERT into venueB rejected by WITH CHECK" || bad "cross-tenant INSERT was NOT rejected"

# 6. Legit own-venue write succeeds.
r6="$(write_as "${RID}_uA" "${RID}_vA" "insert into \"Reservation\"(\"id\",\"venueId\",\"guestName\",\"partySize\",\"reservationTime\",\"durationMinutes\",\"source\",\"status\",\"updatedAt\") values ('${RID}_ok','${RID}_vA','L',1,'$TS',1,'direct','confirmed','$TS');")" || true
echo "$r6" | grep -qi "INSERT 0 1" \
  && pass "userA INSERT into own venueA succeeds" || bad "legitimate own-venue INSERT failed"

# 7. A generated-policy table (AuditLog) isolates too.
[ "$(as_api "${RID}_uA" "${RID}_vA" "select coalesce(string_agg(id,','),'') from \"AuditLog\" where id like '${RID}%';")" = "${RID}_alA" ] \
  && pass "generated policy isolates AuditLog" || bad "AuditLog isolation"

echo ""
if [ "$fail" = "0" ]; then echo "RESULT: PASS — tenant isolation holds under stadium_api"; else echo "RESULT: FAIL — do NOT cut over"; fi
exit $fail
