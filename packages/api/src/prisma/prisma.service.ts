import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { tenantIsolationExtension } from './tenant-isolation.extension';
import { tenantIsolationEnforced } from './tenant-isolation-config';

export const DEFAULT_DATABASE_POOL_SIZE = process.env['NODE_ENV'] === 'production' ? 3 : 5;
export const DEFAULT_DATABASE_POOL_TIMEOUT_SECONDS = 10;

/**
 * Returns true when the tenant-isolation Prisma extension should be applied.
 *
 * Enforced by default (fail-closed): every venue-scoped query is AND-scoped to
 * the request's tenant as a database-layer backstop to the manual
 * `where: { venueId }` filters throughout the app. The flag may be disabled
 * only outside production for local diagnosis; production always fails closed.
 */
export function databasePoolSize(raw = process.env['DATABASE_POOL_SIZE']): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DATABASE_POOL_SIZE;
}

/** Add conservative Prisma pool controls without overriding an operator value. */
export function resolveDatabaseUrl(url = process.env['DATABASE_URL']): string | undefined {
  if (!url) return undefined;
  const params: Array<[string, string]> = [];
  if (!/(?:[?&])connection_limit=/i.test(url)) {
    params.push(['connection_limit', String(databasePoolSize())]);
  }
  if (!/(?:[?&])pool_timeout=/i.test(url)) {
    params.push(['pool_timeout', String(DEFAULT_DATABASE_POOL_TIMEOUT_SECONDS)]);
  }
  if (params.length === 0) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${params.map(([key, value]) => `${key}=${value}`).join('&')}`;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const resolvedUrl = resolveDatabaseUrl();
    super({
      ...(resolvedUrl ? { datasourceUrl: resolvedUrl } : {}),
      log: process.env['NODE_ENV'] === 'production' ? ['error', 'warn'] : ['error', 'warn', 'query'],
    });

    if (!tenantIsolationEnforced()) return;

    // prisma.$extends() returns a NEW client (it never mutates the base), so to
    // keep the PrismaService injection token unchanged across the codebase we
    // wrap `this` in a Proxy that delegates everything Prisma-related to the
    // extended client. Nest lifecycle methods (onModuleInit/Destroy) stay on the
    // wrapper. Inside the extended client, $transaction's tx callback also has
    // the extension applied, so transactions are scoped too.
    const extended = this.$extends(tenantIsolationExtension()) as unknown as PrismaClient;
    Logger.log('Tenant isolation Prisma extension applied', 'PrismaService');

    return new Proxy(this, {
      get(target, prop, receiver) {
        // Keep Nest lifecycle hooks (and the constructor symbol) on the wrapper.
        if (prop === 'onModuleInit' || prop === 'onModuleDestroy' || prop === 'constructor') {
          return Reflect.get(target, prop, receiver);
        }
        // runRawTenantTransaction must run against the UNEXTENDED base client
        // (target), not `extended`. Bind explicitly to `target` rather than
        // relying on implicit `this` from the call site: unlike the lifecycle
        // hooks above, this method's own body calls `this.$transaction`, and
        // if `this` resolved back to the Proxy that call would re-enter this
        // same trap and land on `extended.$transaction` instead of the raw one
        // — defeating the whole point (see runRawTenantTransaction's doc).
        if (prop === 'runRawTenantTransaction') {
          return (target as unknown as Record<string, Function>)[prop].bind(target);
        }
        const value = (extended as unknown as Record<string | symbol, unknown>)[prop as string];
        if (typeof value === 'function') return (value as Function).bind(extended);
        return value;
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Run `fn` in a transaction on the RAW (non-tenant-extended) client and
   * return its result.
   *
   * Why raw: TenantRequestTransactionInterceptor binds the resulting `tx` in
   * tenant-request-transaction.ts's AsyncLocalStorage so the tenant-isolation
   * extension's $allOperations hook can redirect arbitrary model calls
   * (`this.prisma.reservation.findMany()` etc. from anywhere in the app) to
   * this SAME already-GUC-bound transaction with zero call-site changes. If
   * `tx` here carried the extension too, that redirect would call back into
   * the extension on `tx` itself and recurse forever. Called through the Proxy
   * above, which binds `this` to the unextended base client for this one
   * method only.
   */
  async runRawTenantTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T> {
    return this.$transaction(fn, options);
  }
}
