import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  VmsAttendanceStatus,
  VmsFulfillmentStatus,
  VmsOrderStatus,
  VmsNotificationEvent,
  VmsSyncSystem,
  VmsVendorStatus,
  VmsVendorType,
  VmsWorkforceType,
} from '@prisma/client';

export class CreateVendorDto {
  @IsString()
  name!: string;

  @IsString()
  code!: string;

  @IsEnum(VmsVendorType)
  @IsOptional()
  vendorType?: VmsVendorType;

  @IsString()
  @IsOptional()
  contactName?: string;

  @IsString()
  @IsOptional()
  contactEmail?: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;

  @IsNumber()
  @IsOptional()
  @Min(1.0)
  billingRateMultiplier?: number;

  @IsString()
  @IsOptional()
  taxId?: string;

  @IsDateString()
  @IsOptional()
  insuranceExpiry?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateVendorDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(VmsVendorType)
  @IsOptional()
  vendorType?: VmsVendorType;

  @IsEnum(VmsVendorStatus)
  @IsOptional()
  status?: VmsVendorStatus;

  @IsString()
  @IsOptional()
  contactName?: string;

  @IsString()
  @IsOptional()
  contactEmail?: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;

  @IsNumber()
  @IsOptional()
  @Min(1.0)
  rating?: number;

  @IsNumber()
  @IsOptional()
  @Min(1.0)
  billingRateMultiplier?: number;

  @IsString()
  @IsOptional()
  taxId?: string;

  @IsDateString()
  @IsOptional()
  insuranceExpiry?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class CreateVendorServiceDto {
  @IsString()
  serviceType!: string;

  @IsInt()
  @Min(0)
  hourlyRateCents!: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  overtimeRateCents?: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  minimumNoticeHours?: number;

  @IsOptional()
  availabilityJson?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

export class CreateVmsStaffMemberDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsString()
  @IsOptional()
  vendorId?: string;

  @IsEnum(VmsWorkforceType)
  @IsOptional()
  workforceType?: VmsWorkforceType;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  skills?: string[];

  @IsOptional()
  certifications?: Record<string, unknown>;

  @IsInt()
  @Min(0)
  @IsOptional()
  hourlyRateCents?: number;

  @IsString()
  @IsOptional()
  badgeNumber?: string;

  @IsString()
  @IsOptional()
  pin?: string;
}

export class CreateStaffingOrderDto {
  @IsString()
  title!: string;

  @IsString()
  roleRequired!: string;

  @IsInt()
  @Min(1)
  quantityRequested!: number;

  @IsString()
  shiftDate!: string; // YYYY-MM-DD

  @IsString()
  startTime!: string; // HH:mm

  @IsString()
  endTime!: string; // HH:mm

  @IsNumber()
  @Min(0.5)
  @IsOptional()
  durationHours?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  budgetCents?: number;

  @IsString()
  @IsOptional()
  specialRequirements?: string;

  @IsString()
  @IsOptional()
  templateName?: string;

  @IsString()
  @IsOptional()
  eventId?: string;
}

export class UpdateOrderStatusDto {
  @IsEnum(VmsOrderStatus)
  status!: VmsOrderStatus;

  @IsString()
  @IsOptional()
  cancellationReason?: string;
}

export class SubmitOrderBidDto {
  @IsString()
  vendorId!: string;

  @IsInt()
  @Min(1)
  staffCountAssigned!: number;

  @IsInt()
  @Min(0)
  bidHourlyRateCents!: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateFulfillmentStatusDto {
  @IsEnum(VmsFulfillmentStatus)
  status!: VmsFulfillmentStatus;
}

export class AuthorizePunchDto {
  @IsString()
  staffMemberId!: string;

  @IsString()
  action!: 'clock_in' | 'clock_out';

  @IsString()
  @IsOptional()
  attendanceId?: string;

  @IsString()
  @IsOptional()
  pin?: string;

  @IsString()
  @IsOptional()
  badgeCode?: string;
}

export class ClockInDto {
  @IsString()
  staffMemberId!: string;

  @IsString()
  @IsOptional()
  pin?: string;

  @IsString()
  @IsOptional()
  badgeCode?: string;

  @IsString()
  @IsOptional()
  punchAuthToken?: string;

  @IsString()
  @IsOptional()
  clientMutationId?: string;

  @IsString()
  @IsOptional()
  orderId?: string;

  @IsString()
  @IsOptional()
  deviceInfo?: string;

  @IsNumber()
  @IsOptional()
  gpsLatitude?: number;

  @IsNumber()
  @IsOptional()
  gpsLongitude?: number;
}

export class ClockOutDto {
  @IsString()
  attendanceId!: string;

  @IsString()
  @IsOptional()
  pin?: string;

  @IsString()
  @IsOptional()
  badgeCode?: string;

  @IsString()
  @IsOptional()
  punchAuthToken?: string;

  @IsString()
  @IsOptional()
  clientMutationId?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  breakMinutes?: number;

  @IsString()
  @IsOptional()
  deviceInfo?: string;
}

export class PaginationQueryDto {
  @IsInt()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}

export class ApproveAttendanceDto {
  @IsString()
  @IsOptional()
  managerNotes?: string;
}

export class AiParseOrderDto {
  @IsString()
  naturalLanguagePrompt!: string;
}

export class TriggerInventorySyncDto {
  @IsEnum(VmsSyncSystem)
  @IsOptional()
  system?: VmsSyncSystem;

  @IsString()
  @IsOptional()
  syncType?: string;

  @IsOptional()
  items?: Array<{ sku: string; name: string; quantity: number }>;
}

export class AssignStaffDto {
  @IsString()
  staffMemberId!: string;

  @IsString()
  @IsOptional()
  fulfillmentId?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  force?: boolean;
}

export class SetAvailabilityDto {
  @IsString()
  staffMemberId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsBoolean()
  available!: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class CreateOrderTemplateDto {
  @IsString()
  name!: string;

  @IsString()
  roleRequired!: string;

  @IsInt()
  @Min(1)
  quantityRequested!: number;

  @IsString()
  @IsOptional()
  startTime?: string;

  @IsString()
  @IsOptional()
  endTime?: string;

  @IsNumber()
  @IsOptional()
  @Min(0.5)
  durationHours?: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  budgetCents?: number;

  @IsString()
  @IsOptional()
  specialRequirements?: string;
}

export class CreateOrderFromTemplateDto {
  @IsString()
  templateId!: string;

  @IsString()
  shiftDate!: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  eventId?: string;
}

export class CsvImportDto {
  @IsString()
  csv!: string;
}

export class SetNotificationPreferenceDto {
  @IsEnum(VmsNotificationEvent)
  eventType!: VmsNotificationEvent;

  @IsBoolean()
  @IsOptional()
  emailEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  smsEnabled?: boolean;
}
