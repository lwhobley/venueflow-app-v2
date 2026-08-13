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

