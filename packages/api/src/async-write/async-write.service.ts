import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { connect, ChannelModel, ConfirmChannel } from 'amqplib';
import Redis from 'ioredis';

export type AsyncWriteKind = 'inventory_decrement' | 'clock_in';
export interface AsyncWriteMessage { id: string; kind: AsyncWriteKind; idempotencyKey: string; payload: Record<string, unknown>; createdAt: string; }
const QUEUE = 'stadium.high-volume-writes.v1';
const cleanConnectionUrl = (value: string) => value.replace(/^\uFEFF/, '').trim();

@Injectable()
export class AsyncWriteService {
  private readonly logger = new Logger(AsyncWriteService.name);
  private redis?: Redis; private connection?: ChannelModel; private channel?: ConfirmChannel;
  isEnabled() { return process.env.HIGH_VOLUME_QUEUE_ENABLED === 'true'; }
  private async clients() {
    if (!this.isEnabled()) throw new ServiceUnavailableException('High-volume queue is not enabled');
    if (!process.env.REDIS_URL || !process.env.RABBITMQ_URL) throw new ServiceUnavailableException('High-volume queue is not configured');
    if (!this.redis) this.redis = new Redis(cleanConnectionUrl(process.env.REDIS_URL), { maxRetriesPerRequest: 1 });
    if (!this.channel) {
      this.connection = await connect(cleanConnectionUrl(process.env.RABBITMQ_URL)); this.channel = await this.connection.createConfirmChannel();
      await this.channel.assertExchange('stadium.writes', 'direct', { durable: true });
      await this.channel.assertExchange('stadium.writes.dlx', 'direct', { durable: true });
      await this.channel.assertQueue(QUEUE, { durable: true, deadLetterExchange: 'stadium.writes.dlx', deadLetterRoutingKey: 'failed' });
      await this.channel.assertQueue('stadium.high-volume-writes.dlq.v1', { durable: true });
      await this.channel.bindQueue(QUEUE, 'stadium.writes', 'write'); await this.channel.bindQueue('stadium.high-volume-writes.dlq.v1', 'stadium.writes.dlx', 'failed');
    }
    return { redis: this.redis, channel: this.channel };
  }
  async enqueue(kind: AsyncWriteKind, idempotencyKey: string, payload: Record<string, unknown>) {
    if (!/^[A-Za-z0-9._:-]{16,200}$/.test(idempotencyKey)) throw new ServiceUnavailableException('A 16–200 character Idempotency-Key is required for queued writes');
    const { redis, channel } = await this.clients(); const key = `stadium:write:${idempotencyKey}`; const existing = await redis.get(key);
    if (existing) return JSON.parse(existing);
    const message: AsyncWriteMessage = { id: crypto.randomUUID(), kind, idempotencyKey, payload, createdAt: new Date().toISOString() };
    const accepted = { accepted: true, queueId: message.id, status: 'queued' };
    if (!await redis.set(key, JSON.stringify(accepted), 'EX', 86400, 'NX')) return JSON.parse((await redis.get(key))!);
    try { channel.publish('stadium.writes', 'write', Buffer.from(JSON.stringify(message)), { persistent: true, messageId: message.id, correlationId: idempotencyKey }); await channel.waitForConfirms(); return accepted; }
    catch (error) { await redis.del(key); this.logger.error('Queue publish failed', error instanceof Error ? error.stack : undefined); throw new ServiceUnavailableException('High-volume queue is temporarily unavailable'); }
  }
  async markResult(idempotencyKey: string, result: Record<string, unknown>) { const { redis } = await this.clients(); await redis.set(`stadium:write:${idempotencyKey}`, JSON.stringify(result), 'EX', 604800); }
}
