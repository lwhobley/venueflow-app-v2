import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';
import { EmailModule } from '../../email/email.module';
import { VmsController } from './vms.controller';
import { VmsService } from './vms.service';
import { VmsAiService } from './vms-ai.service';
import { VmsIntegrationsService } from './vms-integrations.service';
import { VmsWorkforceService } from './vms-workforce.service';
import { VmsNotificationsService } from './vms-notifications.service';
import { VmsSchedulerService } from './vms-scheduler.service';

@Module({
  imports: [PrismaModule, BillingModule, EmailModule],
  controllers: [VmsController],
  providers: [
    VmsService,
    VmsAiService,
    VmsIntegrationsService,
    VmsWorkforceService,
    VmsNotificationsService,
    VmsSchedulerService,
  ],
  exports: [
    VmsService,
    VmsAiService,
    VmsIntegrationsService,
    VmsWorkforceService,
    VmsNotificationsService,
  ],
})
export class VmsModule {}
