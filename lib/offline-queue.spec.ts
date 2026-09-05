import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: { id: 'a' }, venue: { id: 'venue' } }));
const request = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-sqlite', () => ({}));
vi.mock('./auth-store', () => ({ useAuthStore: { getState: () => state } }));
vi.mock('./api-client', () => ({ apiRequest: request, ApiError: class extends Error {} }));

describe('offline queue owner and ordering safety', () => {
  beforeEach(() => { vi.resetModules(); request.mockReset().mockResolvedValue({}); state.user.id = 'a'; });
  it('keeps another users queued writes until their owner returns', async () => {
    const queue = await import('./offline-queue');
    await queue.enqueueOfflineMutation({ path: '/test', method: 'POST', entityKey: 'item', idempotencyKey: 'a-unique-operation-1' });
    state.user.id = 'b';
    await queue.flushOfflineQueue();
    expect(request).not.toHaveBeenCalled();
    expect(queue.offlineQueueSize()).toBe(0);
    state.user.id = 'a';
    expect(queue.offlineQueueSize()).toBe(1);
    await queue.flushOfflineQueue();
    expect(request).toHaveBeenCalledTimes(1);
    expect(queue.offlineQueueSize()).toBe(0);
  });
  it('does not let later writes pass a resource waiting for retry', async () => {
    const queue = await import('./offline-queue');
    for (const id of ['first-operation-1', 'second-operation-2']) await queue.enqueueOfflineMutation({ path: '/test', method: 'PATCH', entityKey: 'item', idempotencyKey: id });
    request.mockRejectedValue(new Error('network unavailable'));
    await queue.flushOfflineQueue();
    expect(request).toHaveBeenCalledTimes(1);
    await queue.flushOfflineQueue();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
