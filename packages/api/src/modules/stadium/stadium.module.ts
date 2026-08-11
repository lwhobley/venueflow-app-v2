import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StadiumController } from './stadium.controller';

@Module({
  imports: [PrismaModule],
  controllers: [StadiumController],
})
export class StadiumModule {}
