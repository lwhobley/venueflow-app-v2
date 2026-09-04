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
import { canAccessResource, ResourceAction } from '../../auth/access-control.helper';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import {
  deriveTicketOperationalArea,
  KitchenDistroFulfillmentService,
} from './kitchen-distro-fulfillment.service';

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

export class ReopenTicketRequestDto {
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

  /**
   * Evaluates operational area boundaries, department access rules, and action granularity (F-01, F-11).
   */
  private async assertTicketAccess(
    scope: Scope,
    action: ResourceAction,
    ticketOrArea: {
      serviceAreaName?: string | null;
      notes?: string | null;
      beoId?: string | null;
      zoneId?: string | null;
    } | string,
  ) {
    const zoneId = typeof ticketOrArea === 'object' ? ticketOrArea.zoneId ?? undefined : undefined;
    await this.assertOperator(scope, zoneId);

    const operationalAreaType = typeof ticketOrArea === 'string'
      ? ticketOrArea
      : deriveTicketOperationalArea(ticketOrArea);

    const venue = await this.prisma.venue.findUniqueOrThrow({
      where: { id: scope.venueId },
      select: { organizationId: true },
    });

    const decision = await canAccessResource({
      userId: scope.userId,
      organizationId: venue.organizationId,
      venueId: scope.venueId,
      operationalAreaType,
      resourceType: 'kitchen_fulfillment_ticket',
      action,
      prisma: this.prisma,
    });

    if (!decision.allowed) {
      throw new ForbiddenException(decision.reason || 'Access denied for this operational area');
    }
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
    const tickets = await this.service.listTickets(scope.venueId, {
      kitchenId,
      serviceAreaId,
      zoneId,
      beoId,
      eventId,
      status,
    });

    // F-01: Filter visible tickets through department area authorization
    const venue = await this.prisma.venue.findUniqueOrThrow({
      where: { id: scope.venueId },
      select: { organizationId: true },
    });

    const areaDecisions = new Map<string, boolean>();
    const visibleTickets: typeof tickets = [];

    for (const ticket of tickets) {
      const area = deriveTicketOperationalArea(ticket);
      let allowed = areaDecisions.get(area);
      if (allowed === undefined) {
        const decision = await canAccessResource({
          userId: scope.userId,
          organizationId: venue.organizationId,
          venueId: scope.venueId,
          operationalAreaType: area,
          resourceType: 'kitchen_fulfillment_ticket',
          action: 'view',
          prisma: this.prisma,
        });
        allowed = decision.allowed;
        areaDecisions.set(area, allowed);
      }

      if (allowed) {
        visibleTickets.push(ticket);
      }
    }

    return visibleTickets;
  }

  @Get(':id')
  async getTicket(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
  ) {
    const ticket = await this.service.getTicketById(scope.venueId, id);
    await this.assertTicketAccess(scope, 'view', ticket);
    return ticket;
  }

  @Post()
  async createTicket(
    @VenueScope() scope: Scope,
    @Body() dto: CreateTicketDto,
  ) {
    await this.assertTicketAccess(scope, 'create', dto);
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
    await this.assertTicketAccess(scope, 'create', 'catering');
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
    const ticket = await this.service.getTicketById(scope.venueId, id);
    await this.assertTicketAccess(scope, 'fire', ticket);
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
    const ticket = await this.service.getTicketById(scope.venueId, id);
    await this.assertTicketAccess(scope, 'ready', ticket);
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
    const ticket = await this.service.getTicketById(scope.venueId, id);
    await this.assertTicketAccess(scope, 'hold', ticket);
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
    const ticket = await this.service.getTicketById(scope.venueId, id);
    await this.assertTicketAccess(scope, 'pickup', ticket);
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
    const ticket = await this.service.getTicketById(scope.venueId, id);
    await this.assertTicketAccess(scope, 'cancel', ticket);
    return this.service.cancelTicket(
      scope.venueId,
      id,
      dto,
      { userId: scope.userId, userName: scope.role, role: scope.role },
    );
  }

  @Post(':id/reopen')
  async reopenTicket(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() dto: ReopenTicketRequestDto,
  ) {
    const ticket = await this.service.getTicketById(scope.venueId, id);
    await this.assertTicketAccess(scope, 'reopen', ticket);
    return this.service.reopenTicket(
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
