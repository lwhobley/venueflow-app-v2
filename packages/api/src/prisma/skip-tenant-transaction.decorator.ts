import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_TRANSACTION_KEY = 'skipTenantTransaction';

/**
 * Opt a route out of TenantRequestTransactionInterceptor even though its
 * controller has the interceptor applied. Use on routes that make a slow
 * external call (AI provider, S3, Stripe, an outbound webhook) partway through
 * the handler — those must NOT hold an open database transaction (and a pool
 * connection) for the duration of that call. See the interceptor's doc for why
 * this matters.
 */
export const SkipTenantTransaction = () => SetMetadata(SKIP_TENANT_TRANSACTION_KEY, true);
