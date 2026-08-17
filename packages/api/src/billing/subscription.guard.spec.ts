import { describe, expect, it, vi } from 'vitest';
import { SubscriptionGuard } from './subscription.guard';

function makeContext(user?: unknown) {
  const request = { venueScope: undefined, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

function makeGuard() {
  return new SubscriptionGuard();
}

describe('SubscriptionGuard', () => {
  it('allows authenticated enterprise venue members through', async () => {
    const guard = makeGuard();
    await expect(guard.canActivate(makeContext({ sub: 'u1' }))).resolves.toBe(true);
  });

  it('rejects unauthenticated requests', async () => {
    const guard = makeGuard();
    await expect(guard.canActivate(makeContext(undefined))).rejects.toMatchObject({
      name: 'UnauthorizedException',
    });
  });

  it('does not fabricate venue scope or role claims', async () => {
    const guard = makeGuard();
    const request = { venueScope: undefined, user: { sub: 'u1', role: 'staff', allAccess: false } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
    await guard.canActivate(context);
    expect(request.venueScope).toBeUndefined();
  });
});