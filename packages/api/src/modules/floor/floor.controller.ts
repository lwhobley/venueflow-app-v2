import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { canManageVenue } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { FloorService } from './floor.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';

type Scope = VenueScopedRequest['venueScope'];

const TABLE_SHAPES = ['round', 'square', 'rect', 'booth'] as const;
const TABLE_STATUSES = ['available', 'seated', 'dirty', 'reserved', 'held', 'out_of_service'] as const;
const HOLD_TYPES = ['reserved', 'held', 'seated'] as const;

class TableChairDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  rotation!: number;

  @IsString()
  @IsOptional()
  label?: string;
}

class TableDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  label!: string;

  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  width!: number;

  @IsNumber()
  height!: number;

  @IsString()
  @IsIn(TABLE_SHAPES)
  shape!: string;

  @IsString()
  @IsOptional()
  section?: string;

  @IsInt()
  @Min(1)
  capacity!: number;

  @IsString()
  @IsOptional()
  seatLabelStyle?: string;

  @IsNumber()
  @IsOptional()
  rotation?: number;

  @IsInt()
  @IsOptional()
  minSpend?: number;

  @IsOptional()
  isReservable?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TableChairDto)
  @IsOptional()
  chairs?: TableChairDto[];
}

class SaveFloorPlanDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsOptional()
  width?: number;

  @IsNumber()
  @IsOptional()
  height?: number;

  @IsString()
  @IsOptional()
  backgroundImageUrl?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TableDto)
  tables!: TableDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TableChairDto)
  @IsOptional()
  chairs?: TableChairDto[];
}

class AddWaitlistDto {
  @IsString()
  guestName!: string;

  @IsInt()
  @Min(1)
  partySize!: number;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

class TableStatusDto {
  @IsString()
  @IsIn(TABLE_STATUSES)
  status!: string;
}

class AssignReservationDto {
  @IsString()
  reservationId!: string;

  @IsArray()
  @IsString({ each: true })
  tableIds!: string[];

  @IsString()
  @IsIn(HOLD_TYPES)
  @IsOptional()
  holdType?: string;

  @IsNumber()
  @IsOptional()
  startsAt?: number;

  @IsNumber()
  @IsOptional()
  endsAt?: number;
}

class AssignWaitlistDto {
  @IsString()
  waitlistId!: string;

  @IsArray()
  @IsString({ each: true })
  tableIds!: string[];

  @IsString()
  @IsIn(HOLD_TYPES)
  @IsOptional()
  holdType?: string;

  @IsNumber()
  @IsOptional()
  startsAt?: number;

  @IsNumber()
  @IsOptional()
  endsAt?: number;
}

class MergeTablesDto {
  @IsArray()
  @IsString({ each: true })
  tableIds!: string[];

  @IsInt()
  @Min(1)
  @IsOptional()
  partySize?: number;
}

function requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
  if (!scope || !canManageVenue(scope.role, scope.allAccess)) throw new ForbiddenException('Not authorized');
}

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/floor')
export class FloorController {
  constructor(private readonly floor: FloorService) {}

  @RequireSubscription('active')
  @Get('active')
  async getActiveFloorPlan(@VenueScope() scope: Scope) {
    if (!scope) return null;
    return this.floor.getActiveFloorPlan(scope.venueId);
  }

  @RequireSubscription('active')
  @Get('stats')
  async getFloorStats(@VenueScope() scope: Scope) {
    if (!scope) return this.floor.emptyStats();
    return this.floor.getFloorStats(scope.venueId);
  }

  @RequireSubscription('active')
  @Post()
  async saveFloorPlan(@VenueScope() scope: Scope, @Body() body: SaveFloorPlanDto) {
    requireManager(scope);
    return this.floor.saveFloorPlan(scope.venueId, body);
  }

  @RequireSubscription('active')
  @Delete()
  async clearActiveFloorPlan(@VenueScope() scope: Scope) {
    requireManager(scope);
    return this.floor.clearActiveFloorPlan(scope.venueId);
  }

  @RequireSubscription('active')
  @Get('unassigned-reservations')
  async getUnassignedReservations(@VenueScope() scope: Scope, @Query('withinMinutes') withinMinutes?: string) {
    if (!scope) return [];
    return this.floor.getUnassignedReservations(scope.venueId, withinMinutes);
  }

  @RequireSubscription('active')
  @Get('waitlist')
  async getOpenWaitlist(@VenueScope() scope: Scope) {
    if (!scope) return [];
    return this.floor.getOpenWaitlist(scope.venueId);
  }

  @RequireSubscription('active')
  @Post('waitlist')
  async addToWaitlist(@VenueScope() scope: Scope, @Body() body: AddWaitlistDto) {
    if (!scope) throw new ForbiddenException('No venue profile found');
    return this.floor.addToWaitlist(scope.venueId, body);
  }

  @RequireSubscription('active')
  @Delete('waitlist/:id')
  async removeFromWaitlist(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope) throw new ForbiddenException('No venue profile found');
    return this.floor.removeFromWaitlist(scope.venueId, id);
  }

  @RequireSubscription('active')
  @Patch('waitlist/:id/ready')
  async markWaitlistReady(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope) throw new ForbiddenException('No venue profile found');
    return this.floor.markWaitlistReady(scope.venueId, id);
  }

  @RequireSubscription('active')
  @Patch('tables/:id/status')
  async updateTableStatus(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: TableStatusDto) {
    if (!scope) throw new ForbiddenException('No venue profile found');
    return this.floor.updateTableStatus(scope.venueId, id, body.status);
  }

  @RequireSubscription('active')
  @Post('tables/merge')
  async mergeTablesForParty(@VenueScope() scope: Scope, @Body() body: MergeTablesDto) {
    requireManager(scope);
    return this.floor.mergeTablesForParty(scope.venueId, body.tableIds, body.partySize);
  }

  @RequireSubscription('active')
  @Post('tables/merge-groups/:id/split')
  async splitMergedTables(@VenueScope() scope: Scope, @Param('id') mergeGroupId: string) {
    requireManager(scope);
    return this.floor.splitMergedTables(scope.venueId, mergeGroupId);
  }

  @RequireSubscription('active')
  @Post('assign-reservation')
  async assignReservationToTables(@VenueScope() scope: Scope, @Body() body: AssignReservationDto) {
    requireManager(scope);
    return this.floor.assignReservationToTables(scope.venueId, body.reservationId, body.tableIds, body);
  }

  @RequireSubscription('active')
  @Post('assign-waitlist')
  async assignWaitlistToTables(@VenueScope() scope: Scope, @Body() body: AssignWaitlistDto) {
    requireManager(scope);
    return this.floor.assignWaitlistToTables(scope.venueId, body);
  }

  @RequireSubscription('active')
  @Delete('assignments/:id')
  async releaseAssignment(@VenueScope() scope: Scope, @Param('id') id: string) {
    requireManager(scope);
    return this.floor.releaseAssignment(scope.venueId, id);
  }
}
