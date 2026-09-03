import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { DailyRosterType } from '@prisma/client';

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
  @IsString()
  attendanceStatus?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AdjustRosterDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  workerUpdates?: Array<{
    workerId: string;
    hoursWorked?: number;
    breakMinutes?: number;
    attendanceStatus?: string;
    notes?: string;
  }>;
}
