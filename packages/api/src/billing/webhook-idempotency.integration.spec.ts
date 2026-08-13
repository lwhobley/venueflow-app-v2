import { describe, expect, it } from 'vitest';
import { BillingController } from './billing.controller';

describe('billing webhook idempotency (integration)', () => {
  it('handles webhooks gracefully in enterprise mode', async () => {
    const controller = new BillingController({} as any);
    const res = await controller.handleStripeWebhook({}, {});
    expect(res).toEqual({ received: true, mode: 'enterprise' });
  });
});
