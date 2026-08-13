import { Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { TempStaffingService, RosterImportRow } from './temp-staffing.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { canManageVenue } from '../../auth/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;
class BulkImportRosterDto {
  @IsString() agencyCode!: string;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => RosterImportRow) rows!: RosterImportRow[];
}
class KioskCheckInDto {
  @IsString() @Matches(/^(?:\d{6}|QR-[A-Za-z0-9_-]{16,})$/) credential!: string;
  @IsOptional() @IsString() outletId?: string;
}

@Controller('v1/stadium/temp-staffing')
@RequireSubscription()
export class TempStaffingController {
  constructor(private readonly service: TempStaffingService, private readonly prisma: PrismaService) {}

  private assertManager(scope: Scope) {
    if (!canManageVenue(scope.role, scope.allAccess)) throw new ForbiddenException('Workforce manager access is required.');
  }

  private async organizationIdFor(facilityId: string) {
    return (await this.prisma.venue.findUniqueOrThrow({ where: { id: facilityId }, select: { organizationId: true } })).organizationId;
  }

  @Post('import')
  async bulkImport(@VenueScope() scope: Scope, @Body() body: BulkImportRosterDto) {
    this.assertManager(scope);
    return this.service.bulkImportRoster(
      await this.organizationIdFor(scope.venueId),
      scope.venueId,
      body.agencyCode,
      body.rows,
    );
  }

  @Post('kiosk-checkin')
  async kioskCheckIn(@VenueScope() scope: Scope, @Body() body: KioskCheckInDto, @Headers('idempotency-key') idempotencyKey?: string) {
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{16,200}$/.test(idempotencyKey)) {
      throw new ForbiddenException('A valid Idempotency-Key is required for kiosk check-in.');
    }
    return this.service.kioskCheckIn(scope.venueId, body.credential, body.outletId, idempotencyKey);
  }

  @Post('seed-200')
  async seed200Workers(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    return this.service.seedTempAgencyAndWorkers(
      await this.organizationIdFor(scope.venueId),
      scope.venueId,
    );
  }
}
