/**
 * Pure, DB-free logic for the tenant-isolation Prisma extension. Kept separate
 * from the extension wiring so the security-critical behaviour is exhaustively
 * unit-testable without a database (see tenant-scope.spec.ts).
 */

/**
 * Every model that carries a direct `venueId` column (derived from ALL files in
 * the prisma/ schema folder — including ai-usage.prisma — by the drift-guard
 * spec). Global models (User, Session, AuthAccount, PasswordCredential) and the
 * tenant root (Venue) are intentionally absent - they are never auto-scoped.
 */
export const VENUE_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'AiBudgetReservation', 'AiUsageEvent', 'AuditLog', 'Availability', 'BarInventoryItem', 'BarInventoryMovement', 'BlackoutDate',
  'ChatImage', 'ChecklistCompletion', 'ChecklistTemplateItem', 'Conversation', 'ConversationRead',
  'CrmActivityLog', 'CrmBeo', 'CrmContract', 'CrmLead', 'CrmNote', 'EmailTemplate', 'EventFnbReadiness', 'FloorChair',
  'FloorPlan', 'FnbOperationUnit', 'FnbPartner', 'Guest', 'Invite', 'Invoice', 'LogbookEntry', 'ManagerGoal', 'Message', 'NotificationEvent',
  'NotificationRead', 'PaymentMethod', 'PayrollExport', 'PosCheck', 'PosConnection',
  'PosLaborPunch', 'PrepBoardItem', 'Profile', 'PushToken', 'Reservation', 'ReservationConnection',
  'ReservationHold', 'ReservationSetting', 'ReservationSyncEvent', 'ScheduleEmailEvent',
  'ScheduleMemoryNote', 'ScheduleShift', 'ScheduleTemplate', 'ShiftSwap', 'StaffOnboardingTask', 'StaffRequest', 'Subscription',
  'SubscriptionEvent', 'TableAssignment', 'TableState', 'TableStateHistory', 'Team',
  'TimeEntry', 'VenueDocument', 'VenueEvent', 'VenueRole', 'Waitlist', 'WorkplaceJoinRequest',
  'EventExecutionWorkspace', 'EventExecutionTask', 'EventExecutionTimelineItem', 'EventExecutionVendor', 'EventExecutionIncident',
  'EventIssue', 'EventAuditLog',
]);

/** Stadium operational models use the newer `facilityId` tenant key. */
export const FACILITY_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'SuiteBeoOrder', 'StandSheet', 'InventoryTransferRequest', 'HawkerVendorSession',
  'EventMenuOverlay', 'TempAgency', 'WorkerProfile', 'ShiftPunch',
  'UnionRuleConfig', 'UnionComplianceViolation',
]);

export function scopeFieldForModel(model: string | undefined | null): 'venueId' | 'facilityId' | null {
  if (!model) return null;
  if (VENUE_SCOPED_MODELS.has(model)) return 'venueId';
  if (FACILITY_SCOPED_MODELS.has(model)) return 'facilityId';
  return null;
}

/**
 * Operations whose `where` accepts arbitrary (non-unique) filters, so we can
 * safely AND a venueId predicate into them.
 */
const FILTERABLE_OPERATIONS: ReadonlySet<string> = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany',
]);

/**
 * Prisma's extended unique filters permit additional non-unique predicates
 * alongside an id/unique selector, so unique-keyed operations can be tenant
 * scoped as well. This prevents a future call site from bypassing isolation by
 * using a client-supplied id directly.
 */
export function isVenueScoped(model: string | undefined | null): boolean {
  return scopeFieldForModel(model) !== null;
}

export function shouldScopeOperation(operation: string): boolean {
  return FILTERABLE_OPERATIONS.has(operation)
    || operation === 'create'
    || operation === 'createMany'
    || UNIQUE_KEYED_OPERATIONS.has(operation);
}

const UNIQUE_KEYED_OPERATIONS: ReadonlySet<string> = new Set([
  'findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert',
]);

/**
 * Return a new args object with the tenant predicate enforced. The original is
 * never mutated. For filterable reads/writes the venueId is AND-ed into `where`
 * so a caller-supplied venueId cannot widen scope (a mismatching venueId simply
 * yields no rows). For creates, venueId is forced onto the row(s).
 */
export function scopeArgs<T extends Record<string, any> | undefined>(
  operation: string,
  args: T,
  scopeId: string,
  scopeField: 'venueId' | 'facilityId' = 'venueId',
): T {
  const next: Record<string, any> = args ? { ...args } : {};

  if (FILTERABLE_OPERATIONS.has(operation)) {
    next.where = mergeScopeWhere(next.where, scopeId, scopeField);
    return next as T;
  }

  if (UNIQUE_KEYED_OPERATIONS.has(operation)) {
    next.where = mergeUniqueScopeWhere(next.where, scopeId, scopeField);
    if (operation === 'upsert' && next.create) {
      next.create = forceScope(next.create, scopeId, scopeField);
    }
    return next as T;
  }

  if (operation === 'create') {
    next.data = forceScope(next.data, scopeId, scopeField);
    return next as T;
  }

  if (operation === 'createMany') {
    if (Array.isArray(next.data)) {
      next.data = next.data.map((row) => forceScope(row, scopeId, scopeField));
    } else {
      next.data = forceScope(next.data, scopeId, scopeField);
    }
    return next as T;
  }

  // Unique-keyed and other operations pass through unchanged.
  return next as T;
}

function mergeScopeWhere(where: unknown, scopeId: string, scopeField: string): Record<string, any> {
  if (where == null) return { [scopeField]: scopeId };
  // AND so an existing predicate (including a hostile venueId) can only narrow,
  // never widen, the result set.
  return { AND: [{ [scopeField]: scopeId }, where] };
}

function mergeUniqueScopeWhere(where: unknown, scopeId: string, scopeField: string): Record<string, any> {
  // Do not wrap this in AND: Prisma requires the unique selector to remain at
  // the top level of a WhereUniqueInput. Extended unique filtering then applies
  // venueId as an additional narrowing predicate.
  return { ...(where as Record<string, any> | undefined), [scopeField]: scopeId };
}

function forceScope(data: unknown, scopeId: string, scopeField: string): Record<string, any> {
  // Caller-provided venueId is overridden, not merged after — a create can never
  // write into another tenant.
  return { ...(data as Record<string, any> | undefined), [scopeField]: scopeId };
}
