import { NestFactory } from '@nestjs/core';
import { connect, type ChannelModel } from 'amqplib';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { WorkerModule } from './worker.module';
import { PrismaService } from '../prisma/prisma.service';
import { runWithTenant } from '../prisma/tenant-context';
import { applyTenantSessionSettings } from '../prisma/tenant-transaction';
import { AsyncWriteMessage, AsyncWriteService } from './async-write.service';
import { assertQueueTopology, HIGH_VOLUME_WRITE_QUEUE, HIGH_VOLUME_RETRY_QUEUE, MAX_DELIVERY_RETRIES, deliveryAttempt } from './queue-topology';

function payloadHash(payload: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function messageVenueId(message: AsyncWriteMessage) {
  const venueId = message.payload.venueId;
  if (typeof venueId !== 'string' || !venueId) throw new Error('Queued write is missing venueId.');
  return venueId;
}

async function apply(prisma: PrismaService, message: AsyncWriteMessage): Promise<Record<string, unknown>> {
  const venueId = messageVenueId(message);
  const hash = payloadHash(message.payload);
  
  return runWithTenant(venueId, async () => {
    return prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, { venueId });
      const claimed = await tx.asyncWriteReceipt.upsert({
        where: { venueId_kind_idempotencyKey: { venueId, kind: message.kind, idempotencyKey: message.idempotencyKey } },
        create: { venueId, kind: message.kind, idempotencyKey: message.idempotencyKey, payloadHash: hash },
        update: {},
        select: { id: true },
      });
      await tx.$queryRaw`SELECT "id" FROM "AsyncWriteReceipt" WHERE "id" = ${claimed.id} FOR UPDATE`;
      const receipt = await tx.asyncWriteReceipt.findUniqueOrThrow({ where: { id: claimed.id } });
      if (receipt.payloadHash !== hash) throw new Error('Idempotency-Key was reused with a different payload.');
      if (receipt.status === 'completed') return (receipt.result ?? { accepted: true, status: 'completed' }) as Record<string, unknown>;
      if (receipt.status === 'failed_permanent') throw new Error('Queued write was previously rejected as permanent.');

      const payload = message.payload as Record<string, any>;
      let result: Record<string, unknown>;
      if (message.kind === 'clock_in') {
        try {
          const timeEntry = await tx.timeEntry.create({
            data: {
              profileId: payload.profileId,
              venueId,
              clockInAt: new Date(payload.clockInAt),
              clockInLat: payload.lat,
              clockInLng: payload.lng,
              clockInAccuracyM: payload.accuracy,
              clockInMocked: payload.mocked,
              isOpen: true,
            },
            select: { id: true, clockInAt: true },
          });
          result = { accepted: true, status: 'completed', timeEntryId: timeEntry.id, clockInAt: timeEntry.clockInAt.toISOString() };
        } catch (error: any) {
          if (error?.code !== 'P2002') throw error;
          const existing = await tx.timeEntry.findFirst({
            where: { profileId: payload.profileId, venueId, isOpen: true },
            select: { id: true, clockInAt: true },
          });
          if (!existing) throw error;
          result = { accepted: true, status: 'completed', timeEntryId: existing.id, clockInAt: existing.clockInAt.toISOString() };
        }
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bar-inventory-${payload.itemId}`}))`;
        const item = await tx.barInventoryItem.findFirstOrThrow({ where: { id: payload.itemId, venueId } });
        const requestedQuantity = Number(payload.quantity);
        if (!Number.isFinite(requestedQuantity) || requestedQuantity >= 0) throw new Error('Queued inventory decrement must be negative.');
        const nextOnHand = Math.max(0, item.onHand + requestedQuantity);
        const appliedQuantity = nextOnHand - item.onHand;
        await tx.barInventoryItem.update({ where: { id: item.id }, data: { onHand: nextOnHand } });
        const movement = await tx.barInventoryMovement.create({
          data: {
            venueId,
            itemId: item.id,
            movementType: payload.movementType,
            quantity: appliedQuantity,
            requestedQuantity,
            appliedQuantity,
            previousOnHand: item.onHand,
            nextOnHand,
            notes: payload.notes ?? null,
            createdBy: payload.createdBy,
          },
          select: { id: true },
        });
        result = { accepted: true, status: 'completed', movementId: movement.id, requestedQuantity, appliedQuantity, nextOnHand };
      }

      await tx.asyncWriteReceipt.update({
        where: { id: receipt.id },
        data: { status: 'completed', result: result as Prisma.InputJsonValue, completedAt: new Date() },
      });
      return result;
    }, { isolationLevel: 'Serializable' });
  });
}

function isPermanent(error: unknown, deliveryCount: number = 0) {
  if (deliveryCount >= MAX_DELIVERY_RETRIES) return true;
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : '';
  return ['P2002', 'P2003', 'P2025'].includes(code ?? '')
    || message.includes('missing venueId')
    || message.includes('different payload')
    || message.includes('must be negative')
    || message.includes('previously rejected');
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const prisma = app.get(PrismaService);
  const writes = app.get(AsyncWriteService);
  if (!writes.isEnabled() || !process.env.RABBITMQ_URL) {
    throw new Error('Queue worker requires HIGH_VOLUME_QUEUE_ENABLED=true and RABBITMQ_URL');
  }

  let ready = false;
  const connection = await connect(process.env.RABBITMQ_URL.replace(/^\uFEFF/, '').trim());
  const channel = await connection.createConfirmChannel();
  connection.on('close', () => { ready = false; });
  connection.on('error', () => { ready = false; });
  channel.on('close', () => { ready = false; });
  channel.on('error', () => { ready = false; });
  await assertQueueTopology(channel);
  await channel.prefetch(Math.max(1, Number(process.env.QUEUE_PREFETCH ?? 10)));

  await channel.consume(HIGH_VOLUME_WRITE_QUEUE, async (delivery) => {
    if (!delivery) return;
    let message: AsyncWriteMessage | null = null;
    const deliveryCount = deliveryAttempt(delivery.properties.headers);

    try {
      message = JSON.parse(delivery.content.toString()) as AsyncWriteMessage;
      if (!message || !message.id || !['clock_in', 'inventory_decrement'].includes(message.kind) || !message.idempotencyKey || !message.payload || typeof message.payload !== 'object') {
        message = null;
        throw new Error('Malformed async write message.');
      }
      const result = await apply(prisma, message);
      await writes.markResult(message.kind, messageVenueId(message), message.idempotencyKey, result);
      channel.ack(delivery);
    } catch (error) {
      const permanent = isPermanent(error, deliveryCount) || !message;
      if (message) {
        await writes.markResult(message.kind, typeof message.payload.venueId === 'string' ? message.payload.venueId : 'unknown', message.idempotencyKey, {
          accepted: false,
          status: permanent ? 'failed_permanent' : 'retrying',
          message: error instanceof Error ? error.message : 'Queued write failed.',
        }).catch(() => undefined);
      }
      if (permanent) {
        channel.nack(delivery, false, false);
      } else {
        try {
          await new Promise<void>((resolve, reject) => {
            channel.sendToQueue(HIGH_VOLUME_RETRY_QUEUE, delivery.content, {
              ...delivery.properties, persistent: true,
              headers: { ...delivery.properties.headers, 'x-write-attempt': deliveryCount + 1 },
            }, (err) => err ? reject(err) : resolve());
          });
          channel.ack(delivery);
        } catch {
          ready = false;
          await connection.close().catch(() => undefined);
        }
      }
    }
  });
  ready = true;

  const server = createServer((_request, response) => {
    response.writeHead(ready ? 200 : 503);
    response.end(ready ? 'queue worker ready' : 'queue worker unavailable');
  }).listen(Number(process.env.PORT ?? 8080), '0.0.0.0');

  const shutdown = async () => {
    ready = false;
    await Promise.allSettled([channel.close(), connection.close(), app.close()]);
    server.close();
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}

void bootstrap();
