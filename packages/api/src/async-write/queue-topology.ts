import type { Options } from 'amqplib';

export const HIGH_VOLUME_WRITE_EXCHANGE = 'stadium.writes';
export const HIGH_VOLUME_WRITE_DLX = 'stadium.writes.dlx';
export const HIGH_VOLUME_WRITE_QUEUE = 'stadium.high-volume-writes.v1';
export const HIGH_VOLUME_WRITE_DLQ = 'stadium.high-volume-writes.dlq.v1';

/** Kept in one module so producer and worker cannot redeclare a queue differently. */
export const HIGH_VOLUME_WRITE_QUEUE_OPTIONS: Options.AssertQueue = {
  durable: true,
  deadLetterExchange: HIGH_VOLUME_WRITE_DLX,
  deadLetterRoutingKey: 'failed',
};

export async function assertQueueTopology(channel: {
  assertExchange: (exchange: string, type: string, options?: Options.AssertExchange) => Promise<unknown>;
  assertQueue: (queue: string, options?: Options.AssertQueue) => Promise<unknown>;
  bindQueue: (queue: string, source: string, pattern: string, args?: unknown) => Promise<unknown>;
}) {
  await channel.assertExchange(HIGH_VOLUME_WRITE_EXCHANGE, 'direct', { durable: true });
  await channel.assertExchange(HIGH_VOLUME_WRITE_DLX, 'direct', { durable: true });
  await channel.assertQueue(HIGH_VOLUME_WRITE_QUEUE, HIGH_VOLUME_WRITE_QUEUE_OPTIONS);
  await channel.assertQueue(HIGH_VOLUME_WRITE_DLQ, { durable: true });
  await channel.bindQueue(HIGH_VOLUME_WRITE_QUEUE, HIGH_VOLUME_WRITE_EXCHANGE, 'write');
  await channel.bindQueue(HIGH_VOLUME_WRITE_DLQ, HIGH_VOLUME_WRITE_DLX, 'failed');
}


