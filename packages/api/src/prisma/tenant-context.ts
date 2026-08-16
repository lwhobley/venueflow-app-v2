import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped tenant context. Holds the authenticated scope so the Prisma
 * tenant-isolation extension can scope queries without every call site passing
 * venueId by hand, and so transactional helpers can SET LOCAL app.* GUCs for a
 * future PostgreSQL RLS runtime role.
 *
 * Set once per request (e.g. from AuthGuard after the JWT is verified) via
 * `enterTenant(...)`; read by the extension via `getTenantVenueId()` / `getTenantContext()`.
 * When no context is set (auth flows, webhooks, system tasks, tests) the
 * extension is a no-op, so this is purely additive defense-in-depth.
 */
export type TenantContext = {
  venueId?: string;
  /** Same as venueId for stadium hierarchy tables that use facilityId. */
  facilityId?: string;
  organizationId?: string;
  userId?: string;
};

const storage = new AsyncLocalStorage<TenantContext>();

/** Run `fn` with the tenant context bound. Preferred for background/system tasks. */
export function runWithTenant<T>(venueId: string, fn: () => T): T;
export function runWithTenant<T>(context: TenantContext, fn: () => T): T;
export function runWithTenant<T>(venueIdOrContext: string | TenantContext, fn: () => T): T {
  const context: TenantContext =
    typeof venueIdOrContext === 'string'
      ? { venueId: venueIdOrContext, facilityId: venueIdOrContext }
      : {
          ...venueIdOrContext,
          facilityId: venueIdOrContext.facilityId ?? venueIdOrContext.venueId,
        };
  return storage.run(context, fn);
}

/**
 * Run a narrowly scoped, explicitly trusted cross-tenant operation. Callers
 * must still constrain every query by a user/account identifier. This exists
 * for membership discovery and account lifecycle work that cannot operate
 * correctly after a single venue has been bound to the request.
 */
export function runWithoutTenant<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/**
 * Bind the tenant context for the remainder of the current async execution.
 * Use from a guard/interceptor where wrapping the downstream call isn't practical.
 */
export function enterTenant(venueIdOrContext: string | TenantContext): void {
  const context: TenantContext =
    typeof venueIdOrContext === 'string'
      ? { venueId: venueIdOrContext, facilityId: venueIdOrContext }
      : {
          ...venueIdOrContext,
          facilityId: venueIdOrContext.facilityId ?? venueIdOrContext.venueId,
        };
  storage.enterWith(context);
}

/** The venueId bound to the current async context, if any. */
export function getTenantVenueId(): string | undefined {
  return storage.getStore()?.venueId;
}

/** Full tenant context for RLS GUC binding and diagnostics. */
export function getTenantContext(): TenantContext {
  return storage.getStore() ?? {};
}
