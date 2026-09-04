import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DailyRosterType } from '@prisma/client';

export const VALID_ATTENDANCE_STATUSES = [
  'scheduled',
  'checked_in',
  'checked_out',
  'no_show',
  'excused',
] as const;

export type AttendanceStatus = typeof VALID_ATTENDANCE_STATUSES[number];

export class CreateDailyRosterDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'operationalDate must be YYYY-MM-DD' })
  operationalDate!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(DailyRosterType)
  @IsOptional()
  rosterType?: DailyRosterType;

  @IsString()
  @IsNotEmpty()
  staffingSource!: string;

  @IsOptional()
  @IsString()
  agencyId?: string;

  @IsString()
  @IsNotEmpty()
  departmentId!: string;

  @IsOptional()
  @IsString()
  serviceAreaId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AssignRosterWorkerDto {
  @IsOptional()
  @IsString()
  workerProfileId?: string;

  @IsString()
  @IsNotEmpty()
  workerName!: string;

  @IsString()
  @IsNotEmpty()
  workerRole!: string;

  @IsOptional()
  @IsString()
  assignedOutletId?: string;

  @IsOptional()
  @IsDateString()
  shiftStartTime?: string;

  @IsOptional()
  @IsDateString()
  shiftEndTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  hourlyRateCents?: number;

  @IsOptional()
  @IsIn(VALID_ATTENDANCE_STATUSES)
  attendanceStatus?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateRosterWorkerDto {
  @IsOptional()
  @IsDateString()
  checkedInAt?: string;

  @IsOptional()
  @IsDateString()
  checkedOutAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hoursWorked?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  breakMinutes?: number;

  @IsOptional()
  @IsIn(VALID_ATTENDANCE_STATUSES)
  attendanceStatus?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class WorkerAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  workerId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hoursWorked?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  breakMinutes?: number;

  @IsOptional()
  @IsIn(VALID_ATTENDANCE_STATUSES)
  attendanceStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class AdjustRosterDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkerAdjustmentDto)
  workerUpdates?: WorkerAdjustmentDto[];
}
