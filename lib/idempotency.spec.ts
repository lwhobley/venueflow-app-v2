import { describe, expect, it, vi } from 'vitest';
import { createOperationId } from './idempotency';
vi.mock('expo-crypto', () => ({ randomUUID: () => 'secure-native-uuid' }));
describe('per-action operation identifiers', () => {
  it('distinguishes identical new operations', async () => {
    expect(await createOperationId()).not.toBe(await createOperationId());
  });
  it('uses the native cryptographic provider without Web Crypto', async () => {
    vi.stubGlobal('crypto', undefined);
    try { expect(await createOperationId()).toBe('secure-native-uuid'); }
    finally { vi.unstubAllGlobals(); }
  });
});
