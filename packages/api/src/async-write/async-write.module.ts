import { Module } from '@nestjs/common';
import { AsyncWriteService } from './async-write.service';
@Module({ providers: [AsyncWriteService], exports: [AsyncWriteService] })
export class AsyncWriteModule {}
