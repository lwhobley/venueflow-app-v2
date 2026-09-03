import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

const REDIS_CHANNEL = 'stadium:realtime:events';
const REDIS_SEQUENCE_KEY = 'stadium:realtime:seq';

export interface BufferedStadiumEvent {
  seq: number;
  facilityId: string;
  zoneId: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface StreamTicketPayload {
  venueId: string;
  role: string;
  allAccess: boolean;
  facilityId: string;
  zoneId?: string;
  expiresAt: number;
}

@Injectable()
export class SuiteHospitalityGateway implements OnModuleDestroy {
  private readonly logger = new Logger(SuiteHospitalityGateway.name);
  private readonly emitter = new EventEmitter();
  private readonly instanceId = randomUUID();
  private pubClient?: Redis;
  private subClient?: Redis;
  private sequence = 0;
  private readonly eventBuffer: BufferedStadiumEvent[] = [];
  private readonly MAX_BUFFER = 1000;
  private readonly tickets = new Map<string, StreamTicketPayload>();

  constructor() {
    this.emitter.setMaxListeners(100);
    this.initRedis();
  }

  private initRedis() {
    const redisUrl = process.env.REDIS_URL?.replace(/^\uFEFF/, '').trim();
    if (!redisUrl) return;
    try {
      this.pubClient = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
      this.subClient = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
      this.pubClient.on('error', (err) => this.logger.warn(`Redis pub client error: ${err.message}`));
      this.subClient.on('error', (err) => this.logger.warn(`Redis sub client error: ${err.message}`));
      this.subClient.subscribe(REDIS_CHANNEL, (err) => {
        if (err) this.logger.warn(`Redis subscribe error: ${err.message}`);
      });
      this.subClient.on('message', (_channel, message) => {
        try {
          const parsed = JSON.parse(message) as { instanceId: string; facilityId: string; zoneId: string; payload: Record<string, unknown> };
          if (parsed.instanceId === this.instanceId) return; // Already emitted locally

          // Replicate into local ring buffer for cross-replica gap recovery
          const eventSeq = typeof parsed.payload.seq === 'number' ? parsed.payload.seq : ++this.sequence;
          this.sequence = Math.max(this.sequence, eventSeq);
          const bufferedItem: BufferedStadiumEvent = {
            seq: eventSeq,
            facilityId: parsed.facilityId,
            zoneId: parsed.zoneId,
            event: typeof parsed.payload.event === 'string' ? parsed.payload.event : 'message',
            data: typeof parsed.payload.data === 'object' && parsed.payload.data !== null ? (parsed.payload.data as Record<string, unknown>) : {},
            timestamp: typeof parsed.payload.timestamp === 'string' ? parsed.payload.timestamp : new Date().toISOString(),
          };
          this.eventBuffer.push(bufferedItem);
          if (this.eventBuffer.length > this.MAX_BUFFER) {
            this.eventBuffer.shift();
          }

          this.emitLocal(parsed.facilityId, parsed.zoneId, parsed.payload);
        } catch {
          // ignore malformed pub/sub message
        }
      });
    } catch (error) {
      this.logger.warn(`Redis pub/sub initialization skipped: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createTicket(payload: StreamTicketPayload): Promise<string> {
    // A ticket that is issued but never consumed (client backgrounds, loses
    // connectivity, or never connects) previously stayed in this Map forever
    // — only the Redis copy had a TTL. Sweep expired entries on every write
    // so the in-process map cannot grow unbounded over a long-lived instance.
    this.evictExpiredTickets();
    const ticketId = randomUUID();
    this.tickets.set(ticketId, payload);
    if (this.pubClient) {
      const redisKey = `stadium:ticket:${ticketId}`;
      await this.pubClient.set(redisKey, JSON.stringify(payload), 'PX', 60_000).catch(() => undefined);
    }
    return ticketId;
  }

  private evictExpiredTickets(now = Date.now()): void {
    for (const [id, payload] of this.tickets) {
      if (payload.expiresAt < now) this.tickets.delete(id);
    }
  }

  /**
   * Assigns the next sequence number. With Redis configured (multi-replica
   * deployments), this is a shared INCR — a per-instance counter would let
   * two replicas broadcasting concurrently assign the same seq to different
   * events, and getEventsSince's `seq <= lastSeq` gap-recovery filter would
   * then silently skip whichever event a reconnecting client saw as "already
   * delivered". Falls back to the local counter if Redis is unavailable or
   * the INCR fails, so a broadcast never blocks on a Redis outage.
   */
  private async nextSequence(): Promise<number> {
    if (this.pubClient) {
      try {
        const next = await this.pubClient.incr(REDIS_SEQUENCE_KEY);
        this.sequence = Math.max(this.sequence, next);
        return next;
      } catch (error) {
        this.logger.warn(`Redis sequence INCR failed, falling back to local counter: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    this.sequence += 1;
    return this.sequence;
  }

  async verifyAndConsumeTicket(ticketId: string): Promise<StreamTicketPayload | null> {
    // 1. Check local memory
    const local = this.tickets.get(ticketId);
    if (local) {
      this.tickets.delete(ticketId);
      if (this.pubClient) {
        this.pubClient.del(`stadium:ticket:${ticketId}`).catch(() => undefined);
      }
      if (local.expiresAt < Date.now()) return null;
      return local;
    }

    // 2. Check Redis for cross-replica ticket consumption
    if (this.pubClient) {
      try {
        const redisKey = `stadium:ticket:${ticketId}`;
        const raw = await this.pubClient.get(redisKey);
        if (raw) {
          await this.pubClient.del(redisKey).catch(() => undefined);
          const parsed = JSON.parse(raw) as StreamTicketPayload;
          if (parsed.expiresAt < Date.now()) return null;
          return parsed;
        }
      } catch {
        // Redis fallback
      }
    }

    return null;
  }

  getEventsSince(facilityId: string, lastSeq: number, zoneId?: string): BufferedStadiumEvent[] {
    return this.eventBuffer.filter((item) => {
      if (item.seq <= lastSeq) return false;
      if (item.facilityId !== facilityId) return false;
      if (zoneId && item.zoneId !== zoneId) return false;
      return true;
    });
  }

  private emitLocal(facilityId: string, zoneId: string, payload: Record<string, unknown>) {
    this.emitter.emit(`zone:${zoneId}`, payload);
    this.emitter.emit(`facility:${facilityId}`, payload);
    this.emitter.emit('global', payload);
  }

  private publishCrossReplica(facilityId: string, zoneId: string, payload: Record<string, unknown>) {
    this.emitLocal(facilityId, zoneId, payload);
    if (this.pubClient) {
      const message = JSON.stringify({ instanceId: this.instanceId, facilityId, zoneId, payload });
      this.pubClient.publish(REDIS_CHANNEL, message).catch(() => undefined);
    }
  }

  on(event: string, listener: (...args: any[]) => void) {
    this.emitter.on(event, listener);
  }

  off(event: string, listener: (...args: any[]) => void) {
    this.emitter.off(event, listener);
  }

  async broadcastBeoUpdate(facilityId: string, zoneId: string, beoOrder: Record<string, unknown>) {
    const seq = await this.nextSequence();
    const timestamp = new Date().toISOString();
    const item: BufferedStadiumEvent = {
      seq,
      facilityId,
      zoneId,
      event: 'suite_beo_updated',
      data: beoOrder,
      timestamp,
    };
    this.eventBuffer.push(item);
    if (this.eventBuffer.length > this.MAX_BUFFER) {
      this.eventBuffer.shift();
    }
    const payload = { event: 'suite_beo_updated', data: beoOrder, seq, timestamp };
    this.publishCrossReplica(facilityId, zoneId, payload);
    this.logger.log(`Broadcasted suite_beo_updated for BEO ${(beoOrder as any).beoNumber} (seq: ${seq}) to zone:${zoneId}`);
  }

  async broadcastReplenishment(facilityId: string, zoneId: string, replenishment: Record<string, unknown>) {
    const seq = await this.nextSequence();
    const timestamp = new Date().toISOString();
    const item: BufferedStadiumEvent = {
      seq,
      facilityId,
      zoneId,
      event: 'replenishment_requested',
      data: replenishment,
      timestamp,
    };
    this.eventBuffer.push(item);
    if (this.eventBuffer.length > this.MAX_BUFFER) {
      this.eventBuffer.shift();
    }
    const payload = { event: 'replenishment_requested', data: replenishment, seq, timestamp };
    this.publishCrossReplica(facilityId, zoneId, payload);
    this.logger.log(`Broadcasted replenishment_requested (seq: ${seq}) to zone:${zoneId}`);
  }

  async broadcastDistroPickupUpdate(
    facilityId: string,
    zoneId: string,
    ticket: Record<string, unknown>,
    eventName = 'distro_pickup_updated',
  ) {
    const seq = await this.nextSequence();
    const timestamp = new Date().toISOString();
    const item: BufferedStadiumEvent = {
      seq,
      facilityId,
      zoneId: zoneId || 'global',
      event: eventName,
      data: ticket,
      timestamp,
    };
    this.eventBuffer.push(item);
    if (this.eventBuffer.length > this.MAX_BUFFER) {
      this.eventBuffer.shift();
    }
    const payload = { event: eventName, data: ticket, seq, timestamp };
    this.publishCrossReplica(facilityId, zoneId || 'global', payload);
    this.logger.log(`Broadcasted ${eventName} for ticket ${(ticket as any).id ?? 'item'} (seq: ${seq}) to zone:${zoneId || 'facility'}`);
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}

