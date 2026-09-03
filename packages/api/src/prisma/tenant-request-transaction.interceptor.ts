import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { defer, firstValueFrom, type Observable } from 'rxjs';
import { defaultIfEmpty } from 'rxjs/operators';
import { PrismaService } from './prisma.service';
import { tenantIsolationEnforced } from './tenant-isolation-config';
import { getTenantContext } from './tenant-context';
import { applyTenantSessionSettings } from './tenant-transaction';
import { runWithTenantTx } from './tenant-request-transaction';
import { SKIP_TENANT_TRANSACTION_KEY } from './skip-tenant-transaction.decorator';

/**
 * Wraps one request in a single database transaction with PostgreSQL's
 * `app.*` tenant GUCs bound (via SET LOCAL — see tenant-transaction.ts), then
 * binds that transaction so the tenant-isolation Prisma extension redirects
 * every `this.prisma.<model>.<op>()` call anywhere downstream — controllers,
 * services, other interceptors — onto it automatically. No call site needs to
 * change. This is what makes a future NOBYPASSRLS `stadium_api` runtime role
 * actually enforce isolation for ordinary (non-explicitly-transactional)
 * reads and writes; see docs/rls-cutover-runbook.md.
 *
 * Deliberately NOT registered globally (APP_INTERCEPTOR). Apply it per
 * controller with `@UseInterceptors(TenantRequestTransactionInterceptor)` as
 * modules are rolled over — see scripts/rls-cutover/README.md for the
 * incremental plan. Reason: this holds one pool connection open for the whole
 * request. A route that makes a slow external call mid-handler (an AI
 * provider, S3, Stripe, an outbound webhook) would hold that connection idle
 * for the external call's duration, and the production pool is only 3
 * connections — a handful of concurrent AI/S3 requests could starve every
 * other request on the same replica. Only apply this to controllers with no
 * such call in the request path, or mark the specific route
 * `@SkipTenantTransaction()`.
 *
 * A handler that does not touch the database at all (or explicitly manages
 * its own transaction, e.g. via withTenantTransaction) is unaffected either
 * way: an unused transaction just commits a no-op, and an explicit nested
 * INTERACTIVE `$transaction(async (tx) => {...})` call opens its own separate
 * transaction on another pooled connection exactly as it does today.
 *
 * One real caveat: the ARRAY/batch form, `this.prisma.$transaction([queryA,
 * queryB])`, is not a callback — `queryA`/`queryB` are already-constructed
 * PrismaPromises, meaning each one already went through this extension's
 * $allOperations redirect (and ran against the bound tx) at the point they
 * were CONSTRUCTED, before `$transaction([...])` ever sees them. Under this
 * interceptor, an array-form call still returns correct data (each query
 * still runs, against the same request-scoped transaction, so results are
 * consistent with each other) but loses Prisma's own separate atomicity
 * guarantee for that batch — moot for read-only batches like a paginated list
 * + its count (see GuestsController.listGuests, covered by
 * guests-tenant-request-transaction.integration.spec.ts), but do not add a
 * multi-write array-form batch to a controller carrying this interceptor
 * without checking this.
 */
@Injectable()
export class TenantRequestTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_TRANSACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip || context.getType() !== 'http') return next.handle();

    // Mirrors AuthGuard's own gating: no tenant context bound means auth
    // flows, webhooks, or a venueless system task — nothing to scope.
    const tenantContext = getTenantContext();
    if (!tenantIsolationEnforced() || !tenantContext.venueId) return next.handle();

    return defer(() =>
      this.prisma.runRawTenantTransaction(
        async (tx) => {
          await applyTenantSessionSettings(tx, tenantContext);
          // Await inside the bound callback (not just return the promise) so
          // the AsyncLocalStorage-bound tx stays attached through the whole
          // downstream call chain — same convention as tenant-context.ts's
          // own callers (see tenant-isolation.integration.spec.ts).
          return runWithTenantTx(tx, async () => await firstValueFrom(next.handle().pipe(defaultIfEmpty(undefined))));
        },
        // Default interactive-transaction timeout (5s) is tight for a full
        // HTTP handler that may run several sequential queries; give it real
        // request-scale headroom while still bounding worst-case connection
        // hold time if a handler hangs.
        { timeout: 15_000, maxWait: 5_000 },
      ),
    );
  }
}
