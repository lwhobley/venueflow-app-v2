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

export class ClockInDto {
  @IsString()
  staffMemberId!: string;

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

  @IsInt()
  @IsOptional()
  @Min(0)
  breakMinutes?: number;

  @IsString()
  @IsOptional()
  deviceInfo?: string;
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
