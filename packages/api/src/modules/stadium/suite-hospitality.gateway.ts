import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

const REDIS_CHANNEL = 'stadium:realtime:events';
const REDIS_SEQUENCE_KEY = 'stadium:realtime:seq';

export interface BufferedStadiumEvent {
  seq: number;
  organizationId: string;
  facilityId: string;
  zoneId?: string | null;
  operationalAreaType?: string | null;
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface StreamTicketPayload {
  venueId: string;
  role: string;
  allAccess: boolean;
  facilityId: string;
  organizationId?: string;
  zoneId?: string;
  allowedAreas?: string[];
  expiresAt: number;
}

export function getChannelKeys(params: {
  organizationId: string;
  facilityId: string;
  zoneId?: string | null;
  allowedAreas?: Set<string> | string[] | null;
}): string[] {
  const { organizationId, facilityId, zoneId, allowedAreas } = params;
  const cleanZone = zoneId && zoneId !== 'global' ? zoneId : null;
  const channels: string[] = [];

  if (cleanZone) {
    channels.push(`${organizationId}:${facilityId}:zone:${cleanZone}`);
    if (allowedAreas) {
      for (const area of allowedAreas) {
        channels.push(`${organizationId}:${facilityId}:zone:${cleanZone}:area:${area.toLowerCase()}`);
      }
    }
  } else {
    channels.push(`${organizationId}:${facilityId}`);
    if (allowedAreas) {
      for (const area of allowedAreas) {
        channels.push(`${organizationId}:${facilityId}:area:${area.toLowerCase()}`);
      }
    }
  }

  return channels;
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
          const parsed = JSON.parse(message) as {
            instanceId: string;
            organizationId?: string;
            facilityId: string;
            zoneId?: string | null;
            operationalAreaType?: string | null;
            payload: Record<string, unknown>;
          };
          if (parsed.instanceId === this.instanceId) return; // Already emitted locally

          const orgId = parsed.organizationId || 'default-org';
          const cleanZone = parsed.zoneId && parsed.zoneId !== 'global' ? parsed.zoneId : null;
          const areaType = parsed.operationalAreaType || null;

          // Replicate into local ring buffer for cross-replica gap recovery
          const eventSeq = typeof parsed.payload.seq === 'number' ? parsed.payload.seq : ++this.sequence;
          this.sequence = Math.max(this.sequence, eventSeq);
          const bufferedItem: BufferedStadiumEvent = {
            seq: eventSeq,
            organizationId: orgId,
            facilityId: parsed.facilityId,
            zoneId: cleanZone,
            operationalAreaType: areaType,
            event: typeof parsed.payload.event === 'string' ? parsed.payload.event : 'message',
            data: typeof parsed.payload.data === 'object' && parsed.payload.data !== null ? (parsed.payload.data as Record<string, unknown>) : {},
            timestamp: typeof parsed.payload.timestamp === 'string' ? parsed.payload.timestamp : new Date().toISOString(),
          };
          this.eventBuffer.push(bufferedItem);
          if (this.eventBuffer.length > this.MAX_BUFFER) {
            this.eventBuffer.shift();
          }

          this.emitLocal(orgId, parsed.facilityId, cleanZone, parsed.payload, areaType);
        } catch {
          // ignore malformed pub/sub message
        }
      });
    } catch (error) {
      this.logger.warn(`Redis pub/sub initialization skipped: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createTicket(payload: StreamTicketPayload): Promise<string> {
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
    const local = this.tickets.get(ticketId);
    if (local) {
      this.tickets.delete(ticketId);
      if (this.pubClient) {
        this.pubClient.del(`stadium:ticket:${ticketId}`).catch(() => undefined);
      }
      if (local.expiresAt < Date.now()) return null;
      return local;
    }

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

  getEventsSince(
    organizationId: string,
    facilityId: string,
    lastSeq: number,
    zoneId?: string | null,
    allowedAreas?: Set<string> | string[] | null,
  ): BufferedStadiumEvent[];
  getEventsSince(
    facilityId: string,
    lastSeq: number,
    zoneId?: string | null,
  ): BufferedStadiumEvent[];
  getEventsSince(
    arg1: string,
    arg2: string | number,
    arg3?: number | string | null,
    arg4?: string | null | Set<string> | string[],
    arg5?: Set<string> | string[] | null,
  ): BufferedStadiumEvent[] {
    let organizationId: string | null = null;
    let facilityId: string;
    let lastSeq: number;
    let zoneId: string | null = null;
    let allowedAreas: Set<string> | string[] | null = null;

    if (typeof arg2 === 'number') {
      facilityId = arg1;
      lastSeq = arg2;
      zoneId = typeof arg3 === 'string' ? arg3 : null;
    } else {
      organizationId = arg1;
      facilityId = arg2 as string;
      lastSeq = typeof arg3 === 'number' ? arg3 : 0;
      zoneId = typeof arg4 === 'string' ? arg4 : null;
      allowedAreas = (arg5 || (arg4 instanceof Set || Array.isArray(arg4) ? arg4 : null)) as any;
    }

    const cleanZone = zoneId && zoneId !== 'global' ? zoneId : null;
    const areaSet = allowedAreas ? new Set(Array.from(allowedAreas).map((a) => a.toLowerCase())) : null;

    return this.eventBuffer.filter((item) => {
      if (item.seq <= lastSeq) return false;
      if (organizationId && item.organizationId && item.organizationId !== organizationId) return false;
      if (item.facilityId !== facilityId) return false;
      if (cleanZone && item.zoneId && item.zoneId !== cleanZone) return false;
      if (item.operationalAreaType && areaSet && !areaSet.has(item.operationalAreaType.toLowerCase())) {
        return false;
      }
      return true;
    });
  }

  private emitLocal(
    organizationId: string,
    facilityId: string,
    zoneId: string | null | undefined,
    payload: Record<string, unknown>,
    operationalAreaType?: string | null,
  ) {
    const cleanZone = zoneId && zoneId !== 'global' ? zoneId : null;
    const cleanArea = operationalAreaType ? operationalAreaType.toLowerCase() : null;

    if (cleanArea) {
      this.emitter.emit(`${organizationId}:${facilityId}:area:${cleanArea}`, payload);
      if (cleanZone) {
        this.emitter.emit(`${organizationId}:${facilityId}:zone:${cleanZone}:area:${cleanArea}`, payload);
      }
    } else {
      this.emitter.emit(`${organizationId}:${facilityId}`, payload);
      if (cleanZone) {
        this.emitter.emit(`${organizationId}:${facilityId}:zone:${cleanZone}`, payload);
      }
    }
  }

  private publishCrossReplica(
    organizationId: string,
    facilityId: string,
    zoneId: string | null | undefined,
    payload: Record<string, unknown>,
    operationalAreaType?: string | null,
  ) {
    this.emitLocal(organizationId, facilityId, zoneId, payload, operationalAreaType);
    if (this.pubClient) {
      const cleanZone = zoneId && zoneId !== 'global' ? zoneId : null;
      const message = JSON.stringify({
        instanceId: this.instanceId,
        organizationId,
        facilityId,
        zoneId: cleanZone,
        operationalAreaType,
        payload,
      });
      this.pubClient.publish(REDIS_CHANNEL, message).catch(() => undefined);
    }
  }

  on(event: string, listener: (...args: any[]) => void) {
    this.emitter.on(event, listener);
  }

  off(event: string, listener: (...args: any[]) => void) {
    this.emitter.off(event, listener);
  }

  async broadcastBeoUpdate(
    organizationId: string,
    facilityId: string,
    zoneId: string | null | undefined,
    beoOrder: Record<string, unknown>,
  ): Promise<void>;
  async broadcastBeoUpdate(
    facilityId: string,
    zoneId: string | null | undefined,
    beoOrder: Record<string, unknown>,
  ): Promise<void>;
  async broadcastBeoUpdate(
    arg1: string,
    arg2: string,
    arg3: string | null | undefined | Record<string, unknown>,
    arg4?: Record<string, unknown>,
  ): Promise<void> {
    let organizationId = 'default-org';
    let facilityId: string;
    let zoneId: string | null | undefined;
    let beoOrder: Record<string, unknown>;

    if (typeof arg3 === 'object' && arg3 !== null && arg4 === undefined) {
      facilityId = arg1;
      zoneId = arg2;
      beoOrder = arg3 as Record<string, unknown>;
    } else {
      organizationId = arg1;
      facilityId = arg2;
      zoneId = typeof arg3 === 'string' ? arg3 : null;
      beoOrder = arg4 ?? {};
    }

    const cleanZone = zoneId && zoneId !== 'global' ? zoneId : null;
    const seq = await this.nextSequence();
    const timestamp = new Date().toISOString();
    const item: BufferedStadiumEvent = {
      seq,
      organizationId,
      facilityId,
      zoneId: cleanZone,
      event: 'suite_beo_updated',
      data: beoOrder,
      timestamp,
    };
    this.eventBuffer.push(item);
    if (this.eventBuffer.length > this.MAX_BUFFER) {
      this.eventBuffer.shift();
    }
    const payload = { event: 'suite_beo_updated', data: beoOrder, seq, timestamp };
    this.publishCrossReplica(organizationId, facilityId, cleanZone, payload);
    this.logger.log(`Broadcasted suite_beo_updated for BEO ${(beoOrder as any).beoNumber} (seq: ${seq}) to ${organizationId}:${facilityId}${cleanZone ? `:zone:${cleanZone}` : ''}`);
  }

  async broadcastReplenishment(
    organizationId: string,
    facilityId: string,
    zoneId: string | null | undefined,
    replenishment: Record<string, unknown>,
  ): Promise<void>;
  async broadcastReplenishment(
    facilityId: string,
    zoneId: string | null | undefined,
    replenishment: Record<string, unknown>,
  ): Promise<void>;
  async broadcastReplenishment(
    arg1: string,
    arg2: string,
    arg3: string | null | undefined | Record<string, unknown>,
    arg4?: Record<string, unknown>,
  ): Promise<void> {
    let organizationId = 'default-org';
    let facilityId: string;
    let zoneId: string | null | undefined;
    let replenishment: Record<string, unknown>;

    if (typeof arg3 === 'object' && arg3 !== null && arg4 === undefined) {
      facilityId = arg1;
      zoneId = arg2;
      replenishment = arg3 as Record<string, unknown>;
    } else {
      organizationId = arg1;
      facilityId = arg2;
      zoneId = typeof arg3 === 'string' ? arg3 : null;
      replenishment = arg4 ?? {};
    }

    const cleanZone = zoneId && zoneId !== 'global' ? zoneId : null;
    const seq = await this.nextSequence();
    const timestamp = new Date().toISOString();
    const item: BufferedStadiumEvent = {
      seq,
      organizationId,
      facilityId,
      zoneId: cleanZone,
      event: 'replenishment_requested',
      data: replenishment,
      timestamp,
    };
    this.eventBuffer.push(item);
    if (this.eventBuffer.length > this.MAX_BUFFER) {
      this.eventBuffer.shift();
    }
    const payload = { event: 'replenishment_requested', data: replenishment, seq, timestamp };
    this.publishCrossReplica(organizationId, facilityId, cleanZone, payload);
    this.logger.log(`Broadcasted replenishment_requested (seq: ${seq}) to ${organizationId}:${facilityId}${cleanZone ? `:zone:${cleanZone}` : ''}`);
  }

  async broadcastDistroPickupUpdate(
    organizationId: string,
    facilityId: string,
    zoneId: string | null | undefined,
    ticket: Record<string, unknown>,
    eventName?: string,
  ): Promise<void>;
  async broadcastDistroPickupUpdate(
    facilityId: string,
    zoneId: string | null | undefined,
    ticket: Record<string, unknown>,
    eventName?: string,
  ): Promise<void>;
  async broadcastDistroPickupUpdate(
    arg1: string,
    arg2: string,
    arg3: string | null | undefined | Record<string, unknown>,
    arg4?: Record<string, unknown> | string,
    arg5?: string,
  ): Promise<void> {
    let organizationId = 'default-org';
    let facilityId: string;
    let zoneId: string | null | undefined;
    let ticket: Record<string, unknown>;
    let eventName = 'distro_pickup_updated';

    if (typeof arg3 === 'object' && arg3 !== null) {
      facilityId = arg1;
      zoneId = arg2;
      ticket = arg3 as Record<string, unknown>;
      if (typeof arg4 === 'string') eventName = arg4;
    } else {
      organizationId = arg1;
      facilityId = arg2;
      zoneId = typeof arg3 === 'string' ? arg3 : null;
      ticket = (arg4 && typeof arg4 === 'object' ? arg4 : {}) as Record<string, unknown>;
      if (typeof arg5 === 'string') eventName = arg5;
    }

    const cleanZone = zoneId && zoneId !== 'global' ? zoneId : null;
    const operationalAreaType =
      (ticket.operationalAreaType as string) || (ticket['operationalAreaType'] as string) || null;

    const seq = await this.nextSequence();
    const timestamp = new Date().toISOString();
    const item: BufferedStadiumEvent = {
      seq,
      organizationId,
      facilityId,
      zoneId: cleanZone,
      operationalAreaType,
      event: eventName,
      data: ticket,
      timestamp,
    };
    this.eventBuffer.push(item);
    if (this.eventBuffer.length > this.MAX_BUFFER) {
      this.eventBuffer.shift();
    }
    const payload = { event: eventName, data: ticket, seq, timestamp };
    this.publishCrossReplica(organizationId, facilityId, cleanZone, payload, operationalAreaType);
    this.logger.log(
      `Broadcasted ${eventName} for ticket ${(ticket as any).id ?? 'item'} (seq: ${seq}) to ${organizationId}:${facilityId}${cleanZone ? `:zone:${cleanZone}` : ''}${operationalAreaType ? `:area:${operationalAreaType}` : ''}`,
    );
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
