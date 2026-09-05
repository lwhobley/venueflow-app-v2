import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AsyncWriteModule } from './async-write.module';

/**
 * Dedicated minimal application context module for high-volume queue worker.
 * Omits ScheduleModule, controllers, and background cron jobs so worker replicas
 * do not run recurring background tasks.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['packages/api/.env.local', 'packages/api/.env', '.env.local', '.env'],
    }),
    PrismaModule,
    AsyncWriteModule,
  ],
})
export class WorkerModule {}
