import { Body, Controller, Post, Query } from '@nestjs/common';
import { TempStaffingService, RosterImportRow } from './temp-staffing.service';
import { Public } from '../../auth/public.decorator';

@Controller('v1/stadium/temp-staffing')
export class TempStaffingController {
  constructor(private readonly service: TempStaffingService) {}

  @Public()
  @Post('import-public')
  async bulkImportPublic(
    @Body() body: { organizationId?: string; facilityId?: string; agencyCode: string; rows: RosterImportRow[] },
  ) {
    return this.service.bulkImportRoster(
      body.organizationId ?? 'org-stadium-1',
      body.facilityId ?? 'facility-1',
      body.agencyCode,
      body.rows,
    );
  }

  @Public()
  @Post('kiosk-checkin-public')
  async kioskCheckInPublic(@Body() body: { facilityId?: string; credential: string; outletId?: string }) {
    return this.service.kioskCheckIn(
      body.facilityId ?? 'facility-1',
      body.credential,
      body.outletId,
    );
  }

  @Public()
  @Post('seed-200')
  async seed200Workers(@Body() body: { organizationId?: string; facilityId?: string }) {
    return this.service.seedTempAgencyAndWorkers(
      body.organizationId ?? 'org-stadium-1',
      body.facilityId ?? 'facility-1',
    );
  }
}
