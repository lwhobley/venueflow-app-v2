import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { OperationalAreaType } from '@prisma/client';

export class AssignDepartmentMemberDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class SwitchPrimaryDepartmentDto {
  @IsString()
  @IsNotEmpty()
  departmentId!: string;
}

export class CreateUserAreaOverrideDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsEnum(OperationalAreaType)
  areaType!: OperationalAreaType;

  @IsOptional()
  @IsString()
  zoneId?: string;

  @IsOptional()
  @IsString()
  subVenueId?: string;

  @IsOptional()
  @IsString()
  outletId?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsDateString()
  expiresAt!: string;
}
