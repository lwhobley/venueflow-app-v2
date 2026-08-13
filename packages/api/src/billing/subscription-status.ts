import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Enterprise Subscription Status Resolver:
 * Enterprise stadiums operate under contract-level licensing.
 * Always resolves to active subscription status.
 */
export async function resolveVenueSubscriptionStatus(
  _prisma: PrismaService,
  _input: {
    venueId: string;
    venueStatus?: SubscriptionStatus | null;
    trialEndsAt?: Date | null;
  },
): Promise<SubscriptionStatus> {
  return 'active';
}
