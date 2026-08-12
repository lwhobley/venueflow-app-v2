import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UnionComplianceService } from './union-compliance.service';
import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class RosterImportRow {
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsOptional() @IsString()
  agencyCode?: string;
  @IsOptional() @IsString()
  unionMemberId?: string;
  @IsOptional() @IsBoolean()
  certFoodSafety?: boolean;
  @IsOptional() @IsBoolean()
  certAlcohol?: boolean;
  @IsOptional() @IsDateString()
  certAlcoholExpiry?: string;
}

export interface KioskCheckInResult {
  status: 'GREEN' | 'YELLOW' | 'RED';
  message: string;
  worker: {
    id: string;
    fullName: string;
    unionMemberId?: string;
    agencyName?: string;
    assignedOutlet?: string;
  };
}

@Injectable()
export class TempStaffingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unionCompliance: UnionComplianceService,
  ) {}

  async bulkImportRoster(organizationId: string, facilityId: string, agencyCode: string, rows: RosterImportRow[]) {
    let agency = await this.prisma.tempAgency.findUnique({
      where: { organizationId_facilityId_code: { organizationId, facilityId, code: agencyCode } },
    });

    if (!agency) {
      agency = await this.prisma.tempAgency.create({
        data: {
          organizationId,
          facilityId,
          code: agencyCode,
          name: `Agency ${agencyCode.toUpperCase()}`,
          billingRateMultiplier: 1.35,
        },
      });
    }

    const createdWorkers = [];
    let pinCounter = 100000 + (await this.prisma.workerProfile.count({ where: { facilityId } }));

    for (const row of rows) {
      const pinCode = String(pinCounter++).padStart(6, '0');
      const qrCodeIdentifier = `QR-STADIUM-${facilityId}-${pinCode}`;

      const worker = await this.prisma.workerProfile.create({
        data: {
          organizationId,
          facilityId,
          agencyId: agency.id,
          unionMemberId: row.unionMemberId ?? `LOCAL226-${pinCode}`,
          firstName: row.firstName,
          lastName: row.lastName,
          pinCode,
          qrCodeIdentifier,
          certFoodSafety: row.certFoodSafety ?? true,
          certAlcohol: row.certAlcohol ?? true,
          certAlcoholExpiry: row.certAlcoholExpiry ? new Date(row.certAlcoholExpiry) : new Date(Date.now() + 180 * 86400000),
          active: true,
        },
      });
      createdWorkers.push(worker);
    }

    return {
      agencyId: agency.id,
      agencyName: agency.name,
      importedCount: createdWorkers.length,
      sampleWorker: createdWorkers[0],
    };
  }

  async kioskCheckIn(facilityId: string, credential: string, outletId?: string): Promise<KioskCheckInResult> {
    // Match by PIN or QR Code Identifier
    const worker = await this.prisma.workerProfile.findFirst({
      where: {
        facilityId,
        OR: [
          { pinCode: credential },
          { qrCodeIdentifier: credential },
        ],
      },
      include: { agency: true },
    });

    if (!worker) {
      throw new NotFoundException('Worker credential not recognized.');
    }

    // Evaluate RED condition: Expired Alcohol Cert or Active = false
    const now = new Date();
    const isAlcoholExpired = worker.certAlcoholExpiry && new Date(worker.certAlcoholExpiry) < now;

    if (!worker.active || !worker.certFoodSafety || isAlcoholExpired) {
      return {
        status: 'RED',
        message: 'CHECK-IN BLOCKED: Expired Alcohol/Food Safety Certification or Union Barred.',
        worker: {
          id: worker.id,
          fullName: `${worker.firstName} ${worker.lastName}`,
          unionMemberId: worker.unionMemberId ?? undefined,
          agencyName: worker.agency?.name,
        },
      };
    }

    // Record Shift IN Punch
    await this.unionCompliance.recordPunch(
      worker.organizationId,
      worker.facilityId,
      worker.id,
      'IN',
      credential.startsWith('QR-') ? 'qr_scan' : 'pin_entry',
      undefined,
      outletId,
    );

    // Evaluate GREEN vs YELLOW condition
    if (outletId) {
      return {
        status: 'GREEN',
        message: `CHECKED-IN: Assigned to Outlet ${outletId}.`,
        worker: {
          id: worker.id,
          fullName: `${worker.firstName} ${worker.lastName}`,
          unionMemberId: worker.unionMemberId ?? undefined,
          agencyName: worker.agency?.name,
          assignedOutlet: outletId,
        },
      };
    }

    return {
      status: 'YELLOW',
      message: 'CHECKED-IN: Unassigned / Pending Supervisor Placement.',
      worker: {
        id: worker.id,
        fullName: `${worker.firstName} ${worker.lastName}`,
        unionMemberId: worker.unionMemberId ?? undefined,
        agencyName: worker.agency?.name,
      },
    };
  }

  async seedTempAgencyAndWorkers(organizationId: string, facilityId: string) {
    const rows: RosterImportRow[] = [];
    for (let i = 1; i <= 200; i++) {
      rows.push({
        firstName: `TempWorker`,
        lastName: `${i}`,
        unionMemberId: `LOCAL226-${100000 + i}`,
        certFoodSafety: true,
        certAlcohol: i !== 13, // Worker 13 has expired alcohol cert for RED test
        certAlcoholExpiry: i === 13 ? '2025-01-01T00:00:00.000Z' : '2027-12-31T00:00:00.000Z',
      });
    }

    return this.bulkImportRoster(organizationId, facilityId, 'INSTAWORK-01', rows);
  }
}
