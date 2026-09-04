import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';
import { VmsController } from './vms.controller';
import { VmsService } from './vms.service';
import { VmsAiService } from './vms-ai.service';
import { VmsIntegrationsService } from './vms-integrations.service';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [VmsController],
  providers: [VmsService, VmsAiService, VmsIntegrationsService],
  exports: [VmsService, VmsAiService, VmsIntegrationsService],
})
export class VmsModule {}
