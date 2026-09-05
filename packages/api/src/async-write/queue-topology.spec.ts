import { describe, expect, it, vi } from 'vitest';
import { assertQueueTopology, deliveryAttempt, MAX_DELIVERY_RETRIES, HIGH_VOLUME_RETRY_QUEUE, HIGH_VOLUME_WRITE_EXCHANGE } from './queue-topology';

describe('bounded delayed write delivery', () => {
  it('uses the explicit attempt header, never the brokers boolean redelivery flag', () => {
    expect(deliveryAttempt()).toBe(0);
    for (let n = 1; n <= MAX_DELIVERY_RETRIES; n++) expect(deliveryAttempt({ 'x-write-attempt': n })).toBe(n);
    expect(deliveryAttempt({ 'x-write-attempt': 'invalid' })).toBe(MAX_DELIVERY_RETRIES);
  });
  it('returns delayed messages to the work exchange after a bounded wait', async () => {
    const channel = { assertExchange: vi.fn(), assertQueue: vi.fn(), bindQueue: vi.fn() };
    await assertQueueTopology(channel);
    expect(channel.assertQueue).toHaveBeenCalledWith(HIGH_VOLUME_RETRY_QUEUE, {
      durable: true, messageTtl: 5000, deadLetterExchange: HIGH_VOLUME_WRITE_EXCHANGE, deadLetterRoutingKey: 'write',
    });
  });
});
