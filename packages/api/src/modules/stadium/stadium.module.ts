import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
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

@Module({
  imports: [PrismaModule],
  controllers: [
    StadiumController,
    SuiteHospitalityController,
    ConcourseInventoryController,
    EventMenuController,
    TempStaffingController,
    UnionComplianceController,
  ],
  providers: [
    SuiteHospitalityService,
    SuiteHospitalityGateway,
    EnterpriseWebhookService,
    ConcourseInventoryService,
    EventMenuService,
    TempStaffingService,
    UnionComplianceService,
  ],
  exports: [
    SuiteHospitalityService,
    SuiteHospitalityGateway,
    EnterpriseWebhookService,
    ConcourseInventoryService,
    EventMenuService,
    TempStaffingService,
    UnionComplianceService,
  ],
})
export class StadiumModule {}
