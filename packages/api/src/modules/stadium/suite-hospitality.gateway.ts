import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

const REDIS_CHANNEL = 'stadium:realtime:events';

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
          this.emitLocal(parsed.facilityId, parsed.zoneId, parsed.payload);
        } catch {
          // ignore malformed pub/sub message
        }
      });
    } catch (error) {
      this.logger.warn(`Redis pub/sub initialization skipped: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  createTicket(payload: StreamTicketPayload): string {
    const ticketId = randomUUID();
    this.tickets.set(ticketId, payload);
    return ticketId;
  }

  verifyAndConsumeTicket(ticketId: string): StreamTicketPayload | null {
    const payload = this.tickets.get(ticketId);
    if (!payload) return null;
    this.tickets.delete(ticketId); // Single-use consumption
    if (payload.expiresAt < Date.now()) return null;
    return payload;
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

  broadcastBeoUpdate(facilityId: string, zoneId: string, beoOrder: Record<string, unknown>) {
    this.sequence += 1;
    const timestamp = new Date().toISOString();
    const item: BufferedStadiumEvent = {
      seq: this.sequence,
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
    const payload = { event: 'suite_beo_updated', data: beoOrder, seq: this.sequence, timestamp };
    this.publishCrossReplica(facilityId, zoneId, payload);
    this.logger.log(`Broadcasted suite_beo_updated for BEO ${(beoOrder as any).beoNumber} (seq: ${this.sequence}) to zone:${zoneId}`);
  }

  broadcastReplenishment(facilityId: string, zoneId: string, replenishment: Record<string, unknown>) {
    this.sequence += 1;
    const timestamp = new Date().toISOString();
    const item: BufferedStadiumEvent = {
      seq: this.sequence,
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
    const payload = { event: 'replenishment_requested', data: replenishment, seq: this.sequence, timestamp };
    this.publishCrossReplica(facilityId, zoneId, payload);
    this.logger.log(`Broadcasted replenishment_requested (seq: ${this.sequence}) to zone:${zoneId}`);
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}

