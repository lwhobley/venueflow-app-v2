import { NestFactory } from '@nestjs/core';
import { connect } from 'amqplib';
import { createServer } from 'node:http';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AsyncWriteMessage, AsyncWriteService } from './async-write.service';

async function apply(prisma: PrismaService, message: AsyncWriteMessage) {
  const p = message.payload as any;
  if (message.kind === 'clock_in') { await prisma.timeEntry.create({ data: { profileId: p.profileId, venueId: p.venueId, clockInAt: new Date(p.clockInAt), clockInLat: p.lat, clockInLng: p.lng, clockInAccuracyM: p.accuracy, clockInMocked: p.mocked, isOpen: true } }); return; }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bar-inventory-${p.itemId}`}))`;
    const item = await tx.barInventoryItem.findFirstOrThrow({ where: { id: p.itemId, venueId: p.venueId } }); const nextOnHand = Math.max(0, item.onHand + p.quantity);
    await tx.barInventoryItem.update({ where: { id: item.id }, data: { onHand: nextOnHand } });
    await tx.barInventoryMovement.create({ data: { venueId: p.venueId, itemId: item.id, movementType: p.movementType, quantity: p.quantity, previousOnHand: item.onHand, nextOnHand, notes: p.notes ?? null, createdBy: p.createdBy } });
  });
}
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule); const prisma = app.get(PrismaService); const writes = app.get(AsyncWriteService);
  if (!writes.isEnabled() || !process.env.RABBITMQ_URL) throw new Error('Queue worker requires HIGH_VOLUME_QUEUE_ENABLED=true and RABBITMQ_URL');
  const connection = await connect(process.env.RABBITMQ_URL.replace(/^\uFEFF/, '').trim()); const channel = await connection.createChannel();
  await channel.prefetch(Number(process.env.QUEUE_PREFETCH ?? 50)); await channel.assertQueue('stadium.high-volume-writes.v1', { durable: true });
  await channel.consume('stadium.high-volume-writes.v1', async delivery => {
    if (!delivery) return; const message = JSON.parse(delivery.content.toString()) as AsyncWriteMessage;
    try { await apply(prisma, message); await writes.markResult(message.idempotencyKey, { accepted: true, queueId: message.id, status: 'completed' }); channel.ack(delivery); }
    catch (error: any) { const duplicate = error?.code === 'P2002'; await writes.markResult(message.idempotencyKey, { accepted: true, queueId: message.id, status: duplicate ? 'completed' : 'failed' }); channel.nack(delivery, false, !duplicate); }
  });
  // Cloud Run services require an HTTP listener even though this process is a
  // long-lived AMQP consumer. Keep it private and use it only for liveness.
  createServer((_request, response) => { response.writeHead(200); response.end('queue worker ready'); })
    .listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
}
void bootstrap();
