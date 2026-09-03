import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';

export type RawTenantTx = Prisma.TransactionClient;

/**
 * Holds the single raw (non-extended) Prisma transaction client bound for the
 * current request by TenantRequestTransactionInterceptor, if any.
 *
 * "Raw" matters: this must be a transaction obtained from the UNEXTENDED base
 * PrismaClient (see PrismaService.runRawTenantTransaction), never from the
 * tenant-isolation-extended client. If it were extended, redirecting a model
 * call here from inside the extension's own $allOperations hook (see
 * tenant-isolation.extension.ts) would re-enter that same hook on `tx` and
 * recurse forever.
 */
const storage = new AsyncLocalStorage<RawTenantTx>();

/** Run `fn` with `tx` bound as the request's tenant transaction. */
export function runWithTenantTx<T>(tx: RawTenantTx, fn: () => T): T {
  return storage.run(tx, fn);
}

/** The raw transaction bound for the current request, if any. */
export function getBoundTenantTx(): RawTenantTx | undefined {
  return storage.getStore();
}

/**
 * Prisma's client property for model `Foo` is always `foo` — the model name
 * with its first character lowercased, nothing else changed (verified against
 * this schema's generated client, e.g. FacilityZone -> facilityZone). This is
 * the client's own naming convention, not a heuristic guess.
 */
export function modelDelegateName(model: string): string {
  return model.length ? model[0].toLowerCase() + model.slice(1) : model;
}
