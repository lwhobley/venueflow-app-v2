import { afterEach, expect, it, vi } from 'vitest';
import { BillingController } from './billing.controller';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

function makeController(secret?: string) {
  const config = { get: vi.fn().mockReturnValue(secret) } as any;
  return new BillingController({} as any, config);
}

it('returns enterprise response for revenuecat webhook without a configured secret', async () => {
  const controller = makeController(undefined);
  const res = await controller.handleRevenueCatWebhook({}, {});
  expect(res).toEqual({ received: true, mode: 'enterprise' });
});

it('returns enterprise response for stripe webhook without a configured secret', async () => {
  const controller = makeController(undefined);
  const res = await controller.handleStripeWebhook({}, {}, { rawBody: Buffer.from('{}') } as any);
  expect(res).toEqual({ received: true, mode: 'enterprise' });
});

it('rejects a revenuecat webhook with an invalid bearer secret', async () => {
  const controller = makeController('expected-secret');
  await expect(controller.handleRevenueCatWebhook({}, { authorization: 'Bearer wrong' })).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
});

it('rejects a stripe webhook with an invalid signature', async () => {
  const controller = makeController('expected-secret');
  await expect(
    controller.handleStripeWebhook({}, { 'stripe-signature': 't=1,v1=deadbeef' }, { rawBody: Buffer.from('{}') } as any),
  ).rejects.toBeInstanceOf(BadRequestException);
});

it('accepts a revenuecat webhook with a matching bearer secret', async () => {
  const controller = makeController('expected-secret');
  const res = await controller.handleRevenueCatWebhook({}, { authorization: 'Bearer expected-secret' });
  expect(res).toEqual({ received: true, mode: 'enterprise' });
});

it('rejects an unconfigured revenuecat webhook in production instead of accepting unauthenticated requests', async () => {
  process.env.NODE_ENV = 'production';
  const controller = makeController(undefined);
  await expect(controller.handleRevenueCatWebhook({}, {})).rejects.toBeInstanceOf(UnauthorizedException);
});

it('rejects an unconfigured stripe webhook in production instead of accepting unauthenticated requests', async () => {
  process.env.NODE_ENV = 'production';
  const controller = makeController(undefined);
  await expect(
    controller.handleStripeWebhook({}, {}, { rawBody: Buffer.from('{}') } as any),
  ).rejects.toBeInstanceOf(UnauthorizedException);
});