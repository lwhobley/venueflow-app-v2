import type { Prisma, PrismaClient } from '@prisma/client';
import { getTenantContext, type TenantContext } from './tenant-context';

type TxClient = Prisma.TransactionClient;

/**
 * Bind PostgreSQL request settings that future FORCE RLS policies read via
 * app_private.current_*() helpers. Must run inside a transaction so SET LOCAL
 * cannot leak across pooled connections.
 */
export async function applyTenantSessionSettings(
  tx: TxClient,
  context: TenantContext = getTenantContext(),
): Promise<void> {
  const userId = context.userId ?? '';
  const organizationId = context.organizationId ?? '';
  const facilityId = context.facilityId ?? context.venueId ?? '';
  const venueId = context.venueId ?? '';

  // set_config(..., true) is transaction-local (equivalent to SET LOCAL).
  await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.facility_id', ${facilityId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.venue_id', ${venueId}, true)`;
}

/**
 * Run work in a transaction with tenant GUCs bound. Prefer this for any write
 * path that must remain correct after the stadium_api NOBYPASSRLS cutover.
 */
export async function withTenantTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: TxClient) => Promise<T>,
  context: TenantContext = getTenantContext(),
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await applyTenantSessionSettings(tx, context);
    return fn(tx);
  });
}
