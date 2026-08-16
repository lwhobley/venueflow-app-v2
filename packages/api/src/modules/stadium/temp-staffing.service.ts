import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { applyTenantSessionSettings } from '../../prisma/tenant-transaction';
import { UnionComplianceService } from './union-compliance.service';
import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';
import { createHmac, pbkdf2, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);
const CREDENTIAL_ITERATIONS = 600_000;
const CREDENTIAL_KEY_LENGTH = 32;

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

type IssuedCredential = { workerId: string; pinCode: string; qrToken: string };

@Injectable()
export class TempStaffingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unionCompliance: UnionComplianceService,
  ) {}

  private pepper() {
    const value = process.env.WORKER_CREDENTIAL_PEPPER;
    if (!value || value.length < 32) {
      throw new ServiceUnavailableException('Worker credential service is not configured. Set WORKER_CREDENTIAL_PEPPER.');
    }
    return value;
  }

  private lookupTag(facilityId: string, kind: 'pin' | 'qr', credential: string) {
    return createHmac('sha256', this.pepper()).update(`${facilityId}:${kind}:${credential}`).digest('hex');
  }

  private async hashCredential(value: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = await pbkdf2Async(value, salt, CREDENTIAL_ITERATIONS, CREDENTIAL_KEY_LENGTH, 'sha256') as Buffer;
    return { salt, hash: hash.toString('hex') };
  }

  private async credentialsFor(facilityId: string): Promise<{ pinCode: string; qrToken: string; pinLookupTag: string; qrLookupTag: string; pinSalt: string; pinHash: string; qrSalt: string; qrHash: string }> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pinCode = String(randomInt(100_000, 1_000_000));
      const qrToken = `QR-${randomBytes(24).toString('base64url')}`;
      const pinLookupTag = this.lookupTag(facilityId, 'pin', pinCode);
      const qrLookupTag = this.lookupTag(facilityId, 'qr', qrToken);
      const existing = await this.prisma.workerProfile.findFirst({
        where: { facilityId, OR: [{ pinLookupTag }, { qrLookupTag }] },
        select: { id: true },
      });
      if (existing) continue;
      const [pin, qr] = await Promise.all([this.hashCredential(pinCode), this.hashCredential(qrToken)]);
      return { pinCode, qrToken, pinLookupTag, qrLookupTag, pinSalt: pin.salt, pinHash: pin.hash, qrSalt: qr.salt, qrHash: qr.hash };
    }
    throw new ServiceUnavailableException('Unable to issue a unique worker credential. Please retry the import.');
  }

  async bulkImportRoster(organizationId: string, facilityId: string, agencyCode: string, rows: RosterImportRow[]) {
    const normalizedAgencyCode = agencyCode.trim().toUpperCase();
    if (!normalizedAgencyCode) throw new BadRequestException('Agency code is required.');
    let agency = await this.prisma.tempAgency.findUnique({
      where: { organizationId_facilityId_code: { organizationId, facilityId, code: normalizedAgencyCode } },
    });
    if (!agency) {
      agency = await this.prisma.tempAgency.create({
        data: { organizationId, facilityId, code: normalizedAgencyCode, name: `Agency ${normalizedAgencyCode}`, billingRateMultiplier: 1.35 },
      });
    }

    const prepared = await Promise.all(rows.map(async (row) => ({ row, credential: await this.credentialsFor(facilityId) })));
    const created = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, {
        organizationId,
        facilityId,
        venueId: facilityId,
      });
      return Promise.all(prepared.map(async ({ row, credential }) => {
        const worker = await tx.workerProfile.create({
          data: {
            organizationId,
            facilityId,
            agencyId: agency!.id,
            unionMemberId: row.unionMemberId?.trim() || `TEMP-${randomBytes(8).toString('hex').toUpperCase()}`,
            firstName: row.firstName.trim(),
            lastName: row.lastName.trim(),
            pinLookupTag: credential.pinLookupTag,
            pinSalt: credential.pinSalt,
            pinHash: credential.pinHash,
            qrLookupTag: credential.qrLookupTag,
            qrSalt: credential.qrSalt,
            qrHash: credential.qrHash,
            credentialsIssuedAt: new Date(),
            // Missing certifications are never assumed true.
            certFoodSafety: row.certFoodSafety === true,
            certAlcohol: row.certAlcohol === true,
            certAlcoholExpiry: row.certAlcoholExpiry ? new Date(row.certAlcoholExpiry) : null,
            active: true,
          },
          select: { id: true },
        });
        return { worker, credential };
      }));
    });

    // Raw credentials are returned only in this provisioning response. They are
    // not stored, logged, or present in later roster responses.
    const issuedCredentials: IssuedCredential[] = created.map(({ worker, credential }) => ({
      workerId: worker.id,
      pinCode: credential.pinCode,
      qrToken: credential.qrToken,
    }));
    return { agencyId: agency.id, agencyName: agency.name, importedCount: created.length, issuedCredentials };
  }

  private async verifyCredential(value: string, salt: string | null, expectedHash: string | null) {
    if (!salt || !expectedHash) return false;
    const derived = await pbkdf2Async(value, salt, CREDENTIAL_ITERATIONS, CREDENTIAL_KEY_LENGTH, 'sha256') as Buffer;
    const expected = Buffer.from(expectedHash, 'hex');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }

  async kioskCheckIn(facilityId: string, credential: string, outletId?: string, idempotencyKey?: string): Promise<KioskCheckInResult> {
    const normalized = credential.trim();
    const kind = /^\d{6}$/.test(normalized) ? 'pin' : 'qr';
    const lookupTag = this.lookupTag(facilityId, kind, normalized);
    const worker = await this.prisma.workerProfile.findFirst({
      where: kind === 'pin' ? { facilityId, pinLookupTag: lookupTag } : { facilityId, qrLookupTag: lookupTag },
      include: { agency: true },
    });
    if (!worker) throw new NotFoundException('Worker credential not recognized.');
    const verified = kind === 'pin'
      ? await this.verifyCredential(normalized, worker.pinSalt, worker.pinHash)
      : await this.verifyCredential(normalized, worker.qrSalt, worker.qrHash);
    if (!verified) throw new NotFoundException('Worker credential not recognized.');

    const now = new Date();
    const alcoholAuthorized = worker.certAlcohol && (!worker.certAlcoholExpiry || worker.certAlcoholExpiry >= now);
    if (!worker.active || !worker.certFoodSafety || !alcoholAuthorized) {
      return {
        status: 'RED',
        message: 'CHECK-IN BLOCKED: active food-safety and alcohol certifications are required.',
        worker: { id: worker.id, fullName: `${worker.firstName} ${worker.lastName}`, unionMemberId: worker.unionMemberId ?? undefined, agencyName: worker.agency?.name },
      };
    }

    await this.unionCompliance.recordPunch(
      worker.organizationId,
      worker.facilityId,
      worker.id,
      'IN',
      kind === 'qr' ? 'qr_scan' : 'pin_entry',
      undefined,
      outletId,
      undefined,
      idempotencyKey,
    );

    return outletId
      ? { status: 'GREEN', message: `CHECKED-IN: Assigned to Outlet ${outletId}.`, worker: { id: worker.id, fullName: `${worker.firstName} ${worker.lastName}`, unionMemberId: worker.unionMemberId ?? undefined, agencyName: worker.agency?.name, assignedOutlet: outletId } }
      : { status: 'YELLOW', message: 'CHECKED-IN: Unassigned / Pending Supervisor Placement.', worker: { id: worker.id, fullName: `${worker.firstName} ${worker.lastName}`, unionMemberId: worker.unionMemberId ?? undefined, agencyName: worker.agency?.name } };
  }

  async seedTempAgencyAndWorkers(organizationId: string, facilityId: string) {
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException('Demo workforce seeding is disabled in production.');
    const rows: RosterImportRow[] = Array.from({ length: 200 }, (_, index) => ({
      firstName: 'TempWorker',
      lastName: String(index + 1),
      unionMemberId: `LOCAL226-DEMO-${index + 1}`,
      certFoodSafety: true,
      certAlcohol: index !== 12,
      certAlcoholExpiry: index === 12 ? '2025-01-01T00:00:00.000Z' : '2027-12-31T00:00:00.000Z',
    }));
    return this.bulkImportRoster(organizationId, facilityId, 'INSTAWORK-01', rows);
  }
}
