import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ConcourseInventoryService, CreateStandSheetDto, RecordCountOutDto, CreateTransferDto, HawkerCheckoutDto, HawkerSettleDto } from './concourse-inventory.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { Public } from '../../auth/public.decorator';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

@Controller('v1/stadium/concourse')
export class ConcourseInventoryController {
  constructor(private readonly service: ConcourseInventoryService) {}

  @Get('stand-sheets')
  async listStandSheets(@VenueScope() scope: Scope, @Query('zoneId') zoneId?: string, @Query('outletId') outletId?: string) {
    return this.service.listStandSheets(scope.venueId, zoneId, outletId);
  }

  @Public()
  @Get('stand-sheets-public')
  async listStandSheetsPublic(@Query('facilityId') facilityId: string, @Query('zoneId') zoneId?: string, @Query('outletId') outletId?: string) {
    return this.service.listStandSheets(facilityId || 'facility-1', zoneId, outletId);
  }

  @Post('stand-sheets')
  async createStandSheet(@VenueScope() scope: Scope, @Body() body: CreateStandSheetDto) {
    return this.service.createStandSheet({ ...body, facilityId: scope.venueId });
  }

  @Public()
  @Post('stand-sheets-public')
  async createStandSheetPublic(@Body() body: CreateStandSheetDto) {
    return this.service.createStandSheet(body);
  }

  @Post('stand-sheets/:id/reconcile')
  async reconcileStandSheet(@Param('id') id: string, @Body() body: RecordCountOutDto) {
    return this.service.reconcileStandSheet(id, body);
  }

  @Get('transfers')
  async listTransfers(@VenueScope() scope: Scope) {
    return this.service.listTransfers(scope.venueId);
  }

  @Public()
  @Get('transfers-public')
  async listTransfersPublic(@Query('facilityId') facilityId: string) {
    return this.service.listTransfers(facilityId || 'facility-1');
  }

  @Post('transfers')
  async submitTransferRequest(@Body() body: CreateTransferDto) {
    return this.service.submitTransferRequest(body);
  }

  @Patch('transfers/:id/status')
  async updateTransferStatus(@Param('id') id: string, @Body() body: { status: 'approved' | 'in_transit' | 'completed' | 'rejected' }) {
    return this.service.updateTransferStatus(id, body.status);
  }

  @Post('hawkers/checkout')
  async checkoutHawkerInventory(@Body() body: HawkerCheckoutDto) {
    return this.service.checkoutHawkerInventory(body);
  }

  @Post('hawkers/:id/settle')
  async settleHawkerSession(@Param('id') id: string, @Body() body: HawkerSettleDto) {
    return this.service.settleHawkerSession(id, body);
  }

  @Public()
  @Post('seed-outlets')
  async seedOutlets(@Body() body: { facilityId?: string; organizationId?: string; zoneId?: string }) {
    return this.service.seedConcourseOutletsAndWarehouse(
      body.facilityId ?? 'facility-1',
      body.organizationId ?? 'org-stadium-1',
      body.zoneId ?? 'zone-north',
    );
  }
}
