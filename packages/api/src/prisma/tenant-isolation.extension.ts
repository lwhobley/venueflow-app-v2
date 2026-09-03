import { Prisma } from '@prisma/client';
import { getTenantContext } from './tenant-context';
import { scopeArgs, scopeFieldForModel, scopeIdForField, shouldScopeOperation } from './tenant-scope';
import { getBoundTenantTx, modelDelegateName } from './tenant-request-transaction';

/**
 * Prisma Client extension that enforces tenant isolation as a database-layer
 * backstop to the existing manual `where: { venueId }` filters.
 *
 * Behaviour, checked in this order:
 *   1. A request-scoped raw tenant transaction is bound (see
 *      tenant-request-transaction.ts, set by TenantRequestTransactionInterceptor)
 *      → redirect the operation to that SAME transaction instead of running it
 *      on a fresh connection. That transaction already has PostgreSQL's
 *      `app.*` GUCs bound via SET LOCAL, so a future NOBYPASSRLS `stadium_api`
 *      role enforces isolation at the database itself for this call — with no
 *      change required at the call site. This is the "universal GUC binding"
 *      path; see the interceptor's doc for why it is opt-in per controller
 *      rather than global.
 *   2. No tenant context bound          → no-op (auth, webhooks, system, tests).
 *   3. Model has no venueId column      → no-op.
 *   4. Non-scopable operation           → no-op (see tenant-scope: unique-keyed ops).
 *   5. Otherwise                        → AND the venueId into `where` / force it
 *                                        onto created rows (the pre-existing
 *                                        app-layer backstop, unchanged).
 *
 * Apply with `prisma.$extends(tenantIsolationExtension())`. Because it is inert
 * without a tenant context, wiring it in is safe; it only takes effect once a
 * request binds the context (e.g. AuthGuard → enterTenant).
 */
export function tenantIsolationExtension() {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tx = getBoundTenantTx();
          if (tx) {
            const delegate = (tx as unknown as Record<string, Record<string, Function>>)[modelDelegateName(model)];
            const op = delegate?.[operation];
            if (typeof op === 'function') {
              return op(args);
            }
            // No matching delegate/operation on the raw tx (shouldn't happen
            // for a real model+operation pair, but never throw over a naming
            // mismatch) — fall through to the normal app-layer path below,
            // which still runs correctly, just outside the bound transaction.
          }

          const scopeField = scopeFieldForModel(model);
          if (!scopeField || !shouldScopeOperation(operation)) {
            return query(args);
          }
          // Read the field the model actually uses. enterTenant() currently
          // mirrors venueId into facilityId, but scoping must not assume that
          // — a facilityId-scoped model must be filtered by the tenant's
          // facilityId, not silently reuse whatever venueId happens to hold.
          const scopeId = scopeIdForField(getTenantContext(), scopeField);
          if (!scopeId) {
            return query(args);
          }
          return query(scopeArgs(operation, args as Record<string, any>, scopeId, scopeField));
        },
      },
    },
  });
}
