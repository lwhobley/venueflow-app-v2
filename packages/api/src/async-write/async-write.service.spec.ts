import { afterEach, describe, expect, it, vi } from 'vitest';
const cache = vi.hoisted(() => ({ status: 'wait', on: vi.fn(), connect: vi.fn(), eval: vi.fn().mockResolvedValue('OK'), set: vi.fn(), get: vi.fn(), quit: vi.fn() }));
vi.mock('ioredis', () => ({ default: class { constructor() { return cache; } } }));
import { AsyncWriteService } from './async-write.service';

describe('dedicated worker result storage', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('initializes Redis for completion even when this process never enqueued', async () => {
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379');
    const service = new AsyncWriteService();
    await service.markResult('clock_in', 'venue', 'operation-12345678', { status: 'completed' });
    expect(cache.connect).toHaveBeenCalled();
    expect(cache.eval).toHaveBeenCalledWith(expect.stringContaining("value.status == 'completed'"), 1, 'stadium:write:venue:clock_in:operation-12345678', '{"status":"completed"}', 604800);
  });
});
