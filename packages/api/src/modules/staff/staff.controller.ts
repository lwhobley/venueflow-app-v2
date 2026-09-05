import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { IsArray, IsDateString, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { Prisma, Role } from '@prisma/client';
import { canManageRole, isAdminRole, isOwnerOrAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { mapProfile } from '../../common/mappers';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { withTenantTransaction } from '../../prisma/tenant-transaction';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { syncTeamMemberCount } from '../../common/team-sync';

type Scope = VenueScopedRequest['venueScope'];

const ROLES = ['admin', 'owner', 'manager', 'server', 'staff'];
const ELEVATED_ROLES = ['admin', 'owner', 'manager'];

class UpsertStaffDto {
  @IsEmail()
  email!: string;

  @IsString()
  fullName!: string;

  @IsString()
  @IsIn(ROLES)
  role!: string;

  @IsString()
  jobTitle!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  altPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  certifications?: string[];
}

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/staff')
export class StaffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @RequireSubscription()
  @Get()
  async listVenueStaff(@VenueScope() scope: Scope) {
    if (!scope || !isAdminRole(scope.role)) return [];
    const staff = await this.prisma.profile.findMany({
      where: { venueId: scope.venueId, OR: [{ membershipStatus: null }, { membershipStatus: 'active' }] },
    });
    return staff
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map(mapProfile);
  }

  @RequireSubscription()
  @Post()
  async upsertVenueStaff(@VenueScope() scope: Scope, @Body() body: UpsertStaffDto) {
    if (!scope || !isAdminRole(scope.role)) {
      throw new ForbiddenException('Not authorized');
    }

    const existing = await this.prisma.profile.findMany({
      where: { venueId: scope.venueId, OR: [{ membershipStatus: null }, { membershipStatus: 'active' }] },
    });
    const member =
      existing.find((item) => item.email.toLowerCase() === body.email.toLowerCase()) ?? null;

    // Managers cannot grant roles at or above their own level. Only applies
    // when the role is actually changing — resubmitting a member's existing
    // role (e.g. a manager editing their own phone number) is not a grant and
    // must not be blocked here.
    const viewerIsOwnerOrAdmin =
      scope.role === 'owner' || scope.role === 'admin' || scope.allAccess;
    const roleChanged = !member || member.role !== body.role;
    if (!viewerIsOwnerOrAdmin && roleChanged && ELEVATED_ROLES.includes(body.role)) {
      throw new ForbiddenException('Managers cannot assign admin, owner, or manager roles');
    }

    if (member) {
      // Only apply the last-owner guard when the role is actually being
      // changed to a non-owner/admin value (i.e. a demotion).
      const isDemoting = isOwnerOrAdminRole(member.role) && !isOwnerOrAdminRole(body.role);
      const updated = await withTenantTransaction(this.prisma, async (tx) => {
        await this.assertCanManageTarget(scope, member, isDemoting, tx);
        const u = await tx.profile.update({
          where: { id: member.id },
          data: {
            email: body.email,
            fullName: body.fullName,
            role: body.role as Role,
            jobTitle: body.jobTitle,
            venueId: scope.venueId,
            phone: body.phone ?? member.phone,
            altPhone: body.altPhone ?? member.altPhone,
            address: body.address ?? member.address,
            dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : member.dateOfBirth,
            certifications: body.certifications ?? member.certifications,
          },
        });
        if (roleChanged && member.userId) {
          await tx.session.deleteMany({ where: { userId: member.userId } });
        }
        return u;
      }, { venueId: scope.venueId });
      void this.email.send({
        to: updated.email,
        subject: 'Your Venue Wrangler Profile Has Been Updated',
        text:
          `Hi ${updated.fullName},\n\n` +
          `Your team profile at ${scope.venueName} has been updated. Here are your current profile details:\n\n` +
          `Updated Profile Details\n` +
          `Detail\tInfo\n` +
          `Name\t${updated.fullName}\n` +
          `Role\t${updated.role}\n` +
          `Job Title\t${updated.jobTitle}\n\n` +
          `If you did not request these changes or have any questions, please contact your venue administrator.\n\n` +
          `Questions? support@venuewrangler.com\n\n` +
          `— The Venue Wrangler Team`,
      });
      return mapProfile(updated);
    }

    const created = await withTenantTransaction(this.prisma, async (tx) => {
      const c = await tx.profile.create({
        data: {
          tokenIdentifier: `${body.email.toLowerCase()}:invited:${Date.now()}`,
          email: body.email.toLowerCase(),
          fullName: body.fullName,
          role: body.role as Role,
          jobTitle: body.jobTitle,
          venueId: scope.venueId,
          phone: body.phone?.trim() || null,
          altPhone: body.altPhone?.trim() || null,
          address: body.address?.trim() || null,
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
          certifications: body.certifications ?? [],
        },
      });
      await syncTeamMemberCount(tx, scope.venueId);
      return c;
    }, { venueId: scope.venueId });
    void this.email.send({
      to: created.email,
      subject: `Invitation: Join the Team at ${scope.venueName} on Venue Wrangler`,
      text:
        `Hi ${created.fullName},\n\n` +
        `Welcome! You have been added to the team at ${scope.venueName} as a ${created.jobTitle}.\n\n` +
        `To view your schedule, request unavailable days, and request shift swaps, please join the venue using the steps below:\n\n` +
        `1. Create a Venue Wrangler account or sign in using your email: ${created.email}\n` +
        `2. You will be automatically linked to the venue and can access your dashboard right away.\n\n` +
        `We're excited to have you on board!\n\n` +
        `Questions? support@venuewrangler.com\n\n` +
        `— The Venue Wrangler Team`,
    });
    return mapProfile(created);
  }

  @RequireSubscription()
  @Delete(':id')
  async deactivateVenueStaff(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope || !isAdminRole(scope.role)) {
      throw new ForbiddenException('Not authorized');
    }

    const staff = await this.prisma.profile.findUnique({ where: { id } });
    if (!staff) throw new NotFoundException('Staff member not found');
    if (staff.venueId !== scope.venueId) {
      throw new ForbiddenException('Staff member does not belong to this venue');
    }

    const updated = await withTenantTransaction(this.prisma, async (tx) => {
      await this.assertCanManageTarget(scope, staff, true, tx);
      const u = await tx.profile.update({
        where: { id: staff.id },
        data: { venueId: null },
      });
      if (staff.userId) {
        await tx.session.deleteMany({ where: { userId: staff.userId } });
      }
      await syncTeamMemberCount(tx, scope.venueId);
      return u;
    }, { venueId: scope.venueId });
    return mapProfile(updated);
  }

  private async assertCanManageTarget(
    scope: NonNullable<Scope>,
    target: { id: string; role: Role; venueId: string | null },
    demotingOrRemoving = false,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    // Editing your own profile is always allowed; the last-owner guard below
    // still prevents a sole owner from self-demoting out of access.
    if (target.id !== scope.profileId && !canManageRole(scope.role, target.role, scope.allAccess)) {
      throw new ForbiddenException('You cannot modify this staff member');
    }
    // Only enforce the last-owner/admin guard when the operation would actually
    // remove or demote the target. Harmless edits (name, phone, job title) on
    // the sole owner/admin are safe and should not be blocked.
    if (demotingOrRemoving && isOwnerOrAdminRole(target.role)) {
      // Advisory-lock the venue so two concurrent demotions/removals can't both
      // read the same pre-write count and both pass the guard.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`venue-admin-count:${scope.venueId}`}))`;
      const ownerAdminCount = await db.profile.count({
        where: { venueId: scope.venueId, role: { in: ['owner', 'admin'] } },
      });
      if (ownerAdminCount <= 1) {
        throw new ForbiddenException('You cannot remove the last owner or admin from the venue');
      }
    }
  }
}
