import { Prisma } from '@prisma/client';
import { getTenantVenueId } from './tenant-context';
import { scopeArgs, scopeFieldForModel, shouldScopeOperation } from './tenant-scope';

/**
 * Prisma Client extension that enforces tenant isolation as a database-layer
 * backstop to the existing manual `where: { venueId }` filters.
 *
 * Behaviour:
 *   - No tenant context bound          → no-op (auth, webhooks, system, tests).
 *   - Model has no venueId column      → no-op.
 *   - Non-scopable operation           → no-op (see tenant-scope: unique-keyed ops).
 *   - Otherwise                        → AND the venueId into `where` / force it
 *                                        onto created rows.
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
          const venueId = getTenantVenueId();
          const scopeField = scopeFieldForModel(model);
          if (!venueId || !scopeField || !shouldScopeOperation(operation)) {
            return query(args);
          }
          return query(scopeArgs(operation, args as Record<string, any>, venueId, scopeField));
        },
      },
    },
  });
}
