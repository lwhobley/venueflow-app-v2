import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { KitchenTicketPriority, KitchenTicketStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { canManageAssignedScope, canManageVenue, canViewPilotHealth } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { KitchenDistroFulfillmentService } from './kitchen-distro-fulfillment.service';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

export class CreateTicketDto {
  @IsOptional() @IsString() eventId?: string;
  @IsOptional() @IsString() beoId?: string;
  @IsOptional() @IsString() zoneId?: string;
  @IsOptional() @IsString() serviceAreaId?: string;
  @IsString() @MaxLength(120) serviceAreaName!: string;
  @IsString() @MaxLength(100) kitchenId!: string;
  @IsString() @MaxLength(120) kitchenName!: string;
  @IsOptional() @IsString() @MaxLength(100) distroLocationId?: string;
  @IsOptional() @IsString() @MaxLength(120) distroLocationName?: string;
  @IsString() @MaxLength(150) itemName!: string;
  @IsOptional() @IsString() @MaxLength(500) itemDescription?: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsOptional() @IsString() @MaxLength(50) unitOfMeasure?: string;
  @IsOptional() @IsIn(['normal', 'high', 'urgent']) priority?: KitchenTicketPriority;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class GenerateFromBeoDto {
  @IsString() @MaxLength(100) kitchenId!: string;
  @IsString() @MaxLength(120) kitchenName!: string;
  @IsOptional() @IsString() @MaxLength(100) distroLocationId?: string;
  @IsOptional() @IsString() @MaxLength(120) distroLocationName?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) lineItemCodes?: string[];
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class MarkReadyRequestDto {
  @IsOptional() @IsString() @MaxLength(100) distroLocationId?: string;
  @IsOptional() @IsString() @MaxLength(120) distroLocationName?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class RewindFireRequestDto {
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class MarkPickedUpRequestDto {
  @IsOptional() @IsString() @MaxLength(100) runnerName?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class CancelTicketRequestDto {
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/stadium/distro-tickets')
@RequireSubscription()
export class KitchenDistroFulfillmentController {
  constructor(
    private readonly service: KitchenDistroFulfillmentService,
    private readonly prisma: PrismaService,
  ) {}

  private async assertOperator(scope: Scope, zoneId?: string) {
    if (canManageVenue(scope.role, scope.allAccess)) return;
    if (canManageAssignedScope(scope.role) || canViewPilotHealth(scope.role, scope.allAccess)) {
      const venue = await this.prisma.venue.findUniqueOrThrow({
        where: { id: scope.venueId },
        select: { organizationId: true },
      });
      const assignment = await this.prisma.scopeAssignment.findFirst({
        where: {
          organizationId: venue.organizationId,
          active: true,
          membership: { userId: scope.userId, status: 'active' },
          AND: [
            { OR: [{ facilityId: null }, { facilityId: scope.venueId }] },
            zoneId ? { OR: [{ zoneId: null }, { zoneId }] } : { zoneId: null },
          ],
        },
        select: { id: true },
      });
      if (!assignment) {
        throw new ForbiddenException('This operational action is outside your assigned facility or zone.');
      }
      return;
    }
    throw new ForbiddenException('Operational stadium access is required.');
  }

  @Get()
  async listTickets(
    @VenueScope() scope: Scope,
    @Query('kitchenId') kitchenId?: string,
    @Query('serviceAreaId') serviceAreaId?: string,
    @Query('zoneId') zoneId?: string,
    @Query('beoId') beoId?: string,
    @Query('eventId') eventId?: string,
    @Query('status') status?: KitchenTicketStatus | 'active',
  ) {
    await this.assertOperator(scope, zoneId);
    return this.service.listTickets(scope.venueId, {
      kitchenId,
      serviceAreaId,
      zoneId,
      beoId,
      eventId,
      status,
    });
  }

  @Get(':id')
  async getTicket(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
  ) {
    await this.assertOperator(scope);
    return this.service.getTicketById(scope.venueId, id);
  }

  @Post()
  async createTicket(
    @VenueScope() scope: Scope,
    @Body() dto: CreateTicketDto,
  ) {
    await this.assertOperator(scope, dto.zoneId);
    return this.service.createTicket(
      scope.venueId,
      dto,
      { userId: scope.userId, userName: scope.role, role: scope.role },
    );
  }

  @Post('from-beo/:beoId')
  async createTicketsFromBeo(
    @VenueScope() scope: Scope,
    @Param('beoId') beoId: string,
    @Body() dto: GenerateFromBeoDto,
  ) {
    await this.assertOperator(scope);
    return this.service.createTicketsFromBeo(
      scope.venueId,
      beoId,
      dto,
      { userId: scope.userId, userName: scope.role, role: scope.role },
    );
  }

  @Post(':id/fire')
  async fireTicket(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
  ) {
    await this.assertOperator(scope);
    return this.service.fireTicket(
      scope.venueId,
      id,
      { userId: scope.userId, userName: scope.role, role: scope.role },
    );
  }

  @Post(':id/ready')
  async markReady(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() dto: MarkReadyRequestDto,
  ) {
    await this.assertOperator(scope);
    return this.service.markReady(
      scope.venueId,
      id,
      dto,
      { userId: scope.userId, userName: scope.role, role: scope.role },
    );
  }

  @Post(':id/rewind-fire')
  async rewindToFiring(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() dto: RewindFireRequestDto,
  ) {
    await this.assertOperator(scope);
    return this.service.rewindToFiring(
      scope.venueId,
      id,
      dto,
      { userId: scope.userId, userName: scope.role, role: scope.role },
    );
  }

  @Post(':id/pickup')
  async markPickedUp(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() dto: MarkPickedUpRequestDto,
  ) {
    await this.assertOperator(scope);
    return this.service.markPickedUp(
      scope.venueId,
      id,
      dto,
      { userId: scope.userId, userName: scope.role, role: scope.role },
    );
  }

  @Post(':id/cancel')
  async cancelTicket(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() dto: CancelTicketRequestDto,
  ) {
    await this.assertOperator(scope);
    return this.service.cancelTicket(
      scope.venueId,
      id,
      dto,
      { userId: scope.userId, userName: scope.role, role: scope.role },
    );
  }

  @Post('check-overdue')
  async reconcileOverdue(
    @VenueScope() scope: Scope,
  ) {
    await this.assertOperator(scope);
    const count = await this.service.reconcileOverdueTickets(scope.venueId);
    return { reconciled: count };
  }
}
