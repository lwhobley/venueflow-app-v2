import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACILITY_ID_WILDCARD_MODELS, FACILITY_SCOPED_MODELS, isVenueScoped, scopeArgs, scopeFieldForModel, scopeIdForField, shouldScopeOperation, VENUE_SCOPED_MODELS } from './tenant-scope';

function readSchema(): string {
  const prismaDir = join(__dirname, '..', '..', 'prisma');
  return readdirSync(prismaDir)
    .filter((file) => file.endsWith('.prisma'))
    .map((file) => readFileSync(join(prismaDir, file), 'utf8'))
    .join('\n');
}

const VENUE = 'venue-1';

describe('isVenueScoped', () => {
  it('recognises models with a venueId column', () => {
    expect(isVenueScoped('ScheduleShift')).toBe(true);
    expect(isVenueScoped('BarInventoryItem')).toBe(true);
    expect(isVenueScoped('Profile')).toBe(true);
    expect(isVenueScoped('VenueDocument')).toBe(true);
  });

  it('recognises the models added for the ops (daily-brief/staff-readiness) feature', () => {
    // Regression check: these three shipped after the isolation extension was
    // built and were never added to VENUE_SCOPED_MODELS — meaning the DB-layer
    // backstop was inert for them despite the flag being enabled in production.
    expect(isVenueScoped('AuditLog')).toBe(true);
    expect(isVenueScoped('PrepBoardItem')).toBe(true);
    expect(isVenueScoped('StaffOnboardingTask')).toBe(true);
  });

  it('excludes global models and the tenant root', () => {
    expect(isVenueScoped('User')).toBe(false);
    expect(isVenueScoped('Session')).toBe(false);
    expect(isVenueScoped('Venue')).toBe(false);
    expect(isVenueScoped(undefined)).toBe(false);
    expect(isVenueScoped(null)).toBe(false);
  });

  it('recognises facility-scoped stadium operational models', () => {
    expect(FACILITY_SCOPED_MODELS.has('SuiteBeoOrder')).toBe(true);
    expect(scopeFieldForModel('InventoryTransferRequest')).toBe('facilityId');
    expect(isVenueScoped('ShiftPunch')).toBe(true);
  });

  it('covers a representative slice of the scoped set', () => {
    expect(VENUE_SCOPED_MODELS.size).toBeGreaterThan(40);
  });
});

describe('VENUE_SCOPED_MODELS drift guard', () => {
  it('exactly matches every model across prisma/*.prisma that carries a direct venueId column', () => {
    // Prevents the exact bug this test was written after: a new venue-scoped
    // model (AuditLog, PrepBoardItem, StaffOnboardingTask) shipped without
    // being added here, silently leaving the DB-layer isolation backstop
    // inert for it even while the extension was active in production. Fails
    // loudly the next time this happens instead of relying on someone
    // remembering to update the hardcoded set. Reads every .prisma file in the
    // schema folder — AiUsageEvent lives in ai-usage.prisma and was missed by
    // the single-file version of this guard.
    const schema = readSchema();
    const modelBlockPattern = /^model (\w+) \{([\s\S]*?)^\}/gm;
    const actualVenueScopedModels = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = modelBlockPattern.exec(schema))) {
      const [, modelName, body] = match;
      if (/^\s*venueId\s+String\b/m.test(body)) {
        actualVenueScopedModels.add(modelName);
      }
    }

    expect(actualVenueScopedModels.size).toBeGreaterThan(40); // sanity: the parser actually found models
    expect([...VENUE_SCOPED_MODELS].sort()).toEqual([...actualVenueScopedModels].sort());
  });
});

describe('FACILITY_SCOPED_MODELS drift guard', () => {
  it('exactly matches every model with a mandatory facilityId column, once wildcard models are excluded', () => {
    // Same bug class as the VENUE_SCOPED_MODELS guard above, caught before it
    // shipped: FacilityZone, Outlet, SubVenue, and Terminal all carry a
    // mandatory facilityId column but were absent from FACILITY_SCOPED_MODELS,
    // leaving the DB-layer isolation backstop inert for them.
    //
    // ScopeAssignment and EnterpriseSsoGroupRoleMapping are deliberately
    // excluded even though they carry a facilityId column: it is optional,
    // and `null` is a load-bearing wildcard meaning "applies to every
    // facility" (see FACILITY_ID_WILDCARD_MODELS). Auto-scoping them would
    // AND a concrete facilityId into every query, making that wildcard
    // permanently unmatched once a tenant context is bound — silently
    // breaking facility-wide grants rather than protecting a tenant boundary.
    const schema = readSchema();
    const modelBlockPattern = /^model (\w+) \{([\s\S]*?)^\}/gm;
    const mandatoryFacilityIdModels = new Set<string>();
    const nullableFacilityIdModels = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = modelBlockPattern.exec(schema))) {
      const [, modelName, body] = match;
      const facilityIdField = /^\s*facilityId\s+String(\?)?(?=\s|$)/m.exec(body);
      if (!facilityIdField) continue;
      if (facilityIdField[1] === '?') nullableFacilityIdModels.add(modelName);
      else mandatoryFacilityIdModels.add(modelName);
    }

    expect(mandatoryFacilityIdModels.size).toBeGreaterThan(5); // sanity: the parser actually found models
    expect([...FACILITY_SCOPED_MODELS].sort()).toEqual([...mandatoryFacilityIdModels].sort());
    // Every nullable-facilityId model must be an explicitly reviewed wildcard,
    // not a silent gap — this fails loudly if a new one is added without
    // either fixing its nullability or adding it here on purpose.
    expect([...nullableFacilityIdModels].sort()).toEqual([...FACILITY_ID_WILDCARD_MODELS].sort());
  });
});

describe('shouldScopeOperation', () => {
  it('scopes reads, writes, and creates', () => {
    for (const op of ['findFirst', 'findMany', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy', 'update', 'delete', 'upsert', 'updateMany', 'deleteMany', 'create', 'createMany']) {
      expect(shouldScopeOperation(op)).toBe(true);
    }
  });

  it('leaves unknown operations unscoped', () => {
    expect(shouldScopeOperation('$queryRaw')).toBe(false);
  });
});

describe('scopeArgs — filterable reads', () => {
  it('injects venueId when there is no where', () => {
    expect(scopeArgs('findMany', {}, VENUE)).toEqual({ where: { venueId: VENUE } });
  });

  it('ANDs venueId with an existing where', () => {
    const out = scopeArgs('findMany', { where: { status: 'open' } }, VENUE);
    expect(out).toEqual({ where: { AND: [{ venueId: VENUE }, { status: 'open' }] } });
  });

  it('preserves other args (select, orderBy, take)', () => {
    const out = scopeArgs('findMany', { select: { id: true }, take: 10 }, VENUE);
    expect(out).toMatchObject({ select: { id: true }, take: 10, where: { venueId: VENUE } });
  });

  it.each(['findFirst', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany'])(
    'scopes the where for %s',
    (op) => {
      expect(scopeArgs(op, { where: { x: 1 } }, VENUE)).toEqual({ where: { AND: [{ venueId: VENUE }, { x: 1 }] } });
    },
  );

  it('does not mutate the original args', () => {
    const original = { where: { status: 'open' } };
    scopeArgs('findMany', original, VENUE);
    expect(original).toEqual({ where: { status: 'open' } });
  });
});

describe('scopeArgs — security invariants', () => {
  it('a hostile caller-supplied venueId cannot widen scope (AND, not replace)', () => {
    const out = scopeArgs('findMany', { where: { venueId: 'other-venue' } }, VENUE);
    // Both predicates must hold → matches nothing, so cross-tenant reads return empty.
    expect(out).toEqual({ where: { AND: [{ venueId: VENUE }, { venueId: 'other-venue' }] } });
  });

  it('a hostile facilityId cannot widen a facility-scoped query', () => {
    const out = scopeArgs('findMany', { where: { facilityId: 'other-facility' } }, VENUE, 'facilityId');
    expect(out).toEqual({ where: { AND: [{ facilityId: VENUE }, { facilityId: 'other-facility' }] } });
  });

  it('a create cannot write into another tenant — venueId is forced', () => {
    const out = scopeArgs('create', { data: { name: 'x', venueId: 'other-venue' } }, VENUE);
    expect(out.data.venueId).toBe(VENUE);
  });

  it('createMany forces venueId on every row', () => {
    const out = scopeArgs('createMany', { data: [{ name: 'a', venueId: 'evil' }, { name: 'b' }] }, VENUE);
    expect(out.data).toEqual([
      { name: 'a', venueId: VENUE },
      { name: 'b', venueId: VENUE },
    ]);
  });

  it('createMany supports a single-object data shape', () => {
    const out = scopeArgs('createMany', { data: { name: 'a' } }, VENUE);
    expect(out.data).toEqual({ name: 'a', venueId: VENUE });
  });
});

describe('scopeArgs — unique-keyed operations', () => {
  it.each(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert'])('adds venueId to %s where clauses', (op) => {
    const args = { where: { id: 'abc' }, data: { x: 1 } };
    expect(scopeArgs(op, args, VENUE)).toEqual({ ...args, where: { id: 'abc', venueId: VENUE } });
  });

  it('forces the create branch of an upsert into the bound venue', () => {
    const out = scopeArgs('upsert', {
      where: { id: 'abc' },
      create: { name: 'x', venueId: 'other-venue' },
      update: { name: 'x' },
    }, VENUE);
    expect(out).toEqual({
      where: { id: 'abc', venueId: VENUE },
      create: { name: 'x', venueId: VENUE },
      update: { name: 'x' },
    });
  });
});

describe('scopeIdForField', () => {
  it('reads venueId for a venueId-scoped model', () => {
    expect(scopeIdForField({ venueId: 'venue-1', facilityId: 'facility-9' }, 'venueId')).toBe('venue-1');
  });

  it('reads facilityId for a facilityId-scoped model, even when venueId differs', () => {
    // The regression this guards against: the extension used to always read
    // venueId regardless of which field the model actually uses. enterTenant
    // mirrors venueId onto facilityId in the normal request path, so this
    // test deliberately binds distinct values to prove the correct field is
    // read rather than one that merely happens to match today.
    expect(scopeIdForField({ venueId: 'venue-1', facilityId: 'facility-9' }, 'facilityId')).toBe('facility-9');
  });

  it('returns undefined when the matching field is not bound', () => {
    expect(scopeIdForField({ venueId: 'venue-1' }, 'facilityId')).toBeUndefined();
    expect(scopeIdForField({ facilityId: 'facility-9' }, 'venueId')).toBeUndefined();
    expect(scopeIdForField({}, 'venueId')).toBeUndefined();
  });
});
