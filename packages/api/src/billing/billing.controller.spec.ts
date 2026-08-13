import { describe, expect, it } from 'vitest';
import { BillingController } from './billing.controller';

describe('BillingController', () => {
  it('returns enterprise response for revenuecat webhook', async () => {
    const controller = new BillingController({} as any);
    const res = await controller.handleRevenueCatWebhook({}, {});
    expect(res).toEqual({ received: true, mode: 'enterprise' });
  });

  it('returns enterprise response for stripe webhook', async () => {
    const controller = new BillingController({} as any);
    const res = await controller.handleStripeWebhook({}, {});
    expect(res).toEqual({ received: true, mode: 'enterprise' });
  });
});
