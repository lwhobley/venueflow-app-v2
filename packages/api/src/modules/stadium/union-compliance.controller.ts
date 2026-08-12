import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { UnionComplianceService } from './union-compliance.service';
import { Public } from '../../auth/public.decorator';
import { PunchType, PunchVerification } from '@prisma/client';

@Controller('v1/stadium/union-compliance')
export class UnionComplianceController {
  constructor(private readonly service: UnionComplianceService) {}

  @Public()
  @Get('shift-summary-public')
  async getShiftSummaryPublic(@Query('workerId') workerId: string, @Query('facilityId') facilityId?: string) {
    return this.service.calculateWorkerShiftSummary(workerId, facilityId ?? 'facility-1');
  }

  @Public()
  @Post('punch-public')
  async recordPunchPublic(
    @Body() body: {
      organizationId?: string;
      facilityId?: string;
      workerId: string;
      punchType: PunchType;
      verifiedVia?: PunchVerification;
      zoneId?: string;
      outletId?: string;
      overrideReason?: string;
    },
  ) {
    return this.service.recordPunch(
      body.organizationId ?? 'org-stadium-1',
      body.facilityId ?? 'facility-1',
      body.workerId,
      body.punchType,
      body.verifiedVia ?? 'pin_entry',
      body.zoneId,
      body.outletId,
      body.overrideReason,
    );
  }
}
