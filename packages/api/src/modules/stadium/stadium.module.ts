import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { StadiumController } from './stadium.controller';
import { SuiteHospitalityController } from './suite-hospitality.controller';
import { SuiteHospitalityService } from './suite-hospitality.service';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { EnterpriseWebhookService } from '../integrations/enterprise-webhook.service';
import { ConcourseInventoryController } from './concourse-inventory.controller';
import { ConcourseInventoryService } from './concourse-inventory.service';
import { EventMenuController } from './event-menu.controller';
import { EventMenuService } from './event-menu.service';
import { TempStaffingController } from './temp-staffing.controller';
import { TempStaffingService } from './temp-staffing.service';
import { UnionComplianceController } from './union-compliance.controller';
import { UnionComplianceService } from './union-compliance.service';
import { StadiumRealtimeController } from './stadium-realtime.controller';
import { KitchenDistroFulfillmentController } from './kitchen-distro-fulfillment.controller';
import { KitchenDistroFulfillmentService } from './kitchen-distro-fulfillment.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [
    StadiumController,
    StadiumRealtimeController,
    SuiteHospitalityController,
    ConcourseInventoryController,
    EventMenuController,
    TempStaffingController,
    UnionComplianceController,
    KitchenDistroFulfillmentController,
  ],
  providers: [
    SuiteHospitalityService,
    SuiteHospitalityGateway,
    EnterpriseWebhookService,
    ConcourseInventoryService,
    EventMenuService,
    TempStaffingService,
    UnionComplianceService,
    KitchenDistroFulfillmentService,
  ],
  exports: [
    SuiteHospitalityService,
    SuiteHospitalityGateway,
    EnterpriseWebhookService,
    ConcourseInventoryService,
    EventMenuService,
    TempStaffingService,
    UnionComplianceService,
    KitchenDistroFulfillmentService,
  ],
})
export class StadiumModule {}
