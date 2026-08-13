import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import Redis from 'ioredis';
import {
  HIGH_VOLUME_WRITE_DLX,
  HIGH_VOLUME_WRITE_DLQ,
  HIGH_VOLUME_WRITE_EXCHANGE,
  HIGH_VOLUME_WRITE_QUEUE,
  HIGH_VOLUME_WRITE_QUEUE_OPTIONS,
} from './queue-topology';

export type AsyncWriteKind = 'inventory_decrement' | 'clock_in';
export interface AsyncWriteMessage {
  id: string;
  kind: AsyncWriteKind;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const cleanConnectionUrl = (value: string) => value.replace(/^\uFEFF/, '').trim();

@Injectable()
export class AsyncWriteService implements OnModuleDestroy {
  private readonly logger = new Logger(AsyncWriteService.name);
  private redis?: Redis;
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private clientsPromise?: Promise<{ redis: Redis; channel: ConfirmChannel }>;

  isEnabled() {
    return process.env.HIGH_VOLUME_QUEUE_ENABLED === 'true';
  }

  private cacheKey(kind: AsyncWriteKind, venueId: string, idempotencyKey: string) {
    return `stadium:write:${venueId}:${kind}:${idempotencyKey}`;
  }

  private resetChannel(reason: string) {
    this.logger.warn(`Resetting high-volume queue connection: ${reason}`);
    this.channel = undefined;
    this.connection = undefined;
    this.clientsPromise = undefined;
  }

  private async clients() {
    if (!this.isEnabled()) throw new ServiceUnavailableException('High-volume queue is not enabled');
    if (!process.env.REDIS_URL || !process.env.RABBITMQ_URL) {
      throw new ServiceUnavailableException('High-volume queue is not configured');
    }
    if (this.channel && this.redis) return { redis: this.redis, channel: this.channel };
    if (!this.clientsPromise) {
      this.clientsPromise = (async () => {
        if (!this.redis) {
          this.redis = new Redis(cleanConnectionUrl(process.env.REDIS_URL!), { maxRetriesPerRequest: 1, enableOfflineQueue: false });
          this.redis.on('error', (error) => this.logger.warn(`Redis cache unavailable: ${error.message}`));
        }
        const connection = await connect(cleanConnectionUrl(process.env.RABBITMQ_URL!));
        connection.on('error', (error) => this.resetChannel(`AMQP error: ${error.message}`));
        connection.on('close', () => this.resetChannel('AMQP connection closed'));
        const channel = await connection.createConfirmChannel();
        channel.on('error', (error) => this.resetChannel(`AMQP channel error: ${error.message}`));
        channel.on('close', () => this.resetChannel('AMQP channel closed'));
        await channel.assertExchange(HIGH_VOLUME_WRITE_EXCHANGE, 'direct', { durable: true });
        await channel.assertExchange(HIGH_VOLUME_WRITE_DLX, 'direct', { durable: true });
        await channel.assertQueue(HIGH_VOLUME_WRITE_QUEUE, HIGH_VOLUME_WRITE_QUEUE_OPTIONS);
        await channel.assertQueue(HIGH_VOLUME_WRITE_DLQ, { durable: true });
        await channel.bindQueue(HIGH_VOLUME_WRITE_QUEUE, HIGH_VOLUME_WRITE_EXCHANGE, 'write');
        await channel.bindQueue(HIGH_VOLUME_WRITE_DLQ, HIGH_VOLUME_WRITE_DLX, 'failed');
        this.connection = connection;
        this.channel = channel;
        return { redis: this.redis!, channel };
      })().catch((error) => {
        this.resetChannel('initial connection failed');
        throw error;
      });
    }
    return this.clientsPromise;
  }

  private async publish(channel: ConfirmChannel, message: AsyncWriteMessage) {
    await new Promise<void>((resolve, reject) => {
      const published = channel.publish(
        HIGH_VOLUME_WRITE_EXCHANGE,
        'write',
        Buffer.from(JSON.stringify(message)),
        {
          persistent: true,
          messageId: message.id,
          correlationId: message.idempotencyKey,
          contentType: 'application/json',
        },
        (error) => error ? reject(error) : resolve(),
      );
      if (!published) channel.once('drain', () => undefined);
    });
  }

  async enqueue(kind: AsyncWriteKind, idempotencyKey: string, payload: Record<string, unknown>) {
    if (!/^[A-Za-z0-9._:-]{16,200}$/.test(idempotencyKey)) {
      throw new ServiceUnavailableException('A 16-200 character Idempotency-Key is required for queued writes');
    }
    const venueId = typeof payload.venueId === 'string' ? payload.venueId : '';
    if (!venueId) throw new ServiceUnavailableException('Queued writes require a verified venue scope');
    const { redis, channel } = await this.clients();
    const key = this.cacheKey(kind, venueId, idempotencyKey);
    const existing = await redis.get(key).catch(() => null);
    if (existing) return JSON.parse(existing);

    const message: AsyncWriteMessage = {
      id: crypto.randomUUID(),
      kind,
      idempotencyKey,
      payload,
      createdAt: new Date().toISOString(),
    };
    const accepted = { accepted: true, queueId: message.id, status: 'queued' };

    // Redis is deliberately not a pre-publish lock. The durable receipt in the
    // worker is the authority, avoiding the lost-write window on process death.
    try {
      await this.publish(channel, message);
      await redis.set(key, JSON.stringify(accepted), 'EX', 7 * 86400).catch(() => undefined);
      return accepted;
    } catch (error) {
      this.resetChannel('publish confirmation failed');
      this.logger.error('Queue publish failed', error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException('High-volume queue is temporarily unavailable');
    }
  }

  async markResult(kind: AsyncWriteKind, venueId: string, idempotencyKey: string, result: Record<string, unknown>) {
    if (!this.redis) return;
    await this.redis.set(this.cacheKey(kind, venueId, idempotencyKey), JSON.stringify(result), 'EX', 7 * 86400).catch(() => undefined);
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.channel?.close(), this.connection?.close(), this.redis?.quit()]);
  }
}
