import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, pbkdf2, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { hashInviteToken } from '../common/invite-token';

const pbkdf2Async = promisify(pbkdf2);
const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hashBuffer = (await pbkdf2Async(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)) as Buffer;
    return { salt, hash: hashBuffer.toString('hex') };
  }

  async verifyPassword(password: string, salt: string, iterations: number, hash: string) {
    const derived = (await pbkdf2Async(password, salt, iterations, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)) as Buffer;
    const expected = Buffer.from(hash, 'hex');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }

  generateOneTimeCode() {
    return Array.from({ length: 8 }, () => randomInt(0, 10)).join('');
  }

  hashOneTimeCode(code: string) {
    return createHash('sha256').update(code.trim()).digest('hex');
  }

  /** Constant-time comparison of two one-time-code hashes (both fixed-length hex digests). */
  oneTimeCodeHashesMatch(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }

  async issueSession(userId: string, email: string, fullName?: string, inviteToken?: string, rawPhone?: string) {
    const trialEndsAt = new Date(Date.now() + TRIAL_DURATION_MS);
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    const emailVerified = Boolean(account?.emailVerifiedAt);
    
    const inviteValue = inviteToken?.trim();
    const invite = inviteValue
      ? emailVerified
      ? await this.prisma.invite.findFirst({
          where: {
            OR: [{ tokenHash: hashInviteToken(inviteValue) }, { code: { equals: inviteValue, mode: 'insensitive' } }],
            usedBy: null,
            expiresAt: { gt: new Date() },
          },
        })
      : null
      : null;

    if (invite?.email && invite.email.toLowerCase() !== email) {
      throw new UnauthorizedException('This invite was sent to a different email address.');
    }
    const phone = rawPhone?.trim().replace(/[\s\-().+]/g, '') || undefined;
    if (!invite?.email && invite?.phone && invite.phone !== phone) {
      throw new UnauthorizedException('This invite was sent to a different mobile number.');
    }
    const trimmedFullName = fullName?.trim();
    const profile = await this.prisma.$transaction(async (tx) => {
      let activeInvite = invite;
      if (invite) {
        const claimed = await tx.invite.updateMany({
          where: { id: invite.id, usedBy: null },
          data: { usedBy: `pending:${userId}` },
        });
        if (claimed.count === 0) activeInvite = null;
      }

      const grant = activeInvite
        ? { venueId: activeInvite.venueId, role: activeInvite.role, jobTitle: activeInvite.jobTitle }
        : null;

      const existingProfileForVenue = grant?.venueId
        ? await tx.profile.findFirst({
            where: { userId, venueId: grant.venueId },
            include: { venue: true },
          })
        : null;

      const existingByUser =
        existingProfileForVenue ||
        (await tx.profile.findFirst({
          where: { userId },
          include: { venue: true },
          orderBy: { createdAt: 'asc' },
        }));

      let result;
      if (existingByUser && (!grant?.venueId || existingByUser.venueId === grant.venueId)) {
        const adoptableProfile = emailVerified
          ? await tx.profile.findFirst({
              where: { userId: null, email: { equals: email, mode: 'insensitive' }, venueId: { not: null } },
              orderBy: { createdAt: 'asc' },
              include: { venue: true },
            })
          : null;

        if (adoptableProfile && (!existingByUser.venueId || existingByUser.venueId === adoptableProfile.venueId)) {
          await tx.profile.delete({ where: { id: existingByUser.id } });
          result = await tx.profile.update({
            where: { id: adoptableProfile.id },
            data: { userId },
            include: { venue: true },
          });
          await this.logProfileAdoption(tx, result);
        } else {
          result = await tx.profile.update({
            where: { id: existingByUser.id },
            data: {
              email,
              ...(trimmedFullName ? { fullName: trimmedFullName } : {}),
              ...(grant ?? {}),
              ...(existingByUser.trialEndsAt ? {} : { trialEndsAt }),
            },
            include: { venue: true },
          });
        }
      } else if (grant?.venueId) {
        // User belongs to another venue and is joining this venue via invite -> create new profile for this venue
        result = await tx.profile.create({
          data: {
            userId,
            email,
            fullName: trimmedFullName || existingByUser?.fullName || email.split('@')[0] || 'Team Member',
            role: grant.role,
            jobTitle: grant.jobTitle,
            venueId: grant.venueId,
            trialEndsAt,
          },
          include: { venue: true },
        });
      } else {
        const adoptableProfile = emailVerified
          ? (grant
              ? await tx.profile.findFirst({
                  where: { userId: null, venueId: grant.venueId, email: { equals: email, mode: 'insensitive' } },
                  orderBy: { createdAt: 'asc' },
                  include: { venue: true },
                })
              : await tx.profile.findFirst({
                  where: { userId: null, email: { equals: email, mode: 'insensitive' }, venueId: { not: null } },
                  orderBy: { createdAt: 'asc' },
                  include: { venue: true },
                }))
          : null;
        if (adoptableProfile) {
          result = await tx.profile.update({
            where: { id: adoptableProfile.id },
            data: {
              userId,
              email,
              fullName: trimmedFullName || adoptableProfile.fullName,
              role: grant?.role ?? adoptableProfile.role,
              jobTitle: grant?.jobTitle ?? adoptableProfile.jobTitle,
              venueId: grant?.venueId ?? adoptableProfile.venueId,
              trialEndsAt: adoptableProfile.trialEndsAt ?? trialEndsAt,
            },
            include: { venue: true },
          });
          await this.logProfileAdoption(tx, result);
        } else {
          result = await tx.profile.create({
            data: {
              userId,
              email,
              fullName: trimmedFullName || email.split('@')[0] || 'Team Member',
              role: grant?.role ?? 'staff',
              jobTitle: grant?.jobTitle ?? 'Staff',
              venueId: grant?.venueId ?? undefined,
              trialEndsAt,
            },
            include: { venue: true },
          });
        }
      }

      if (activeInvite) {
        await tx.invite.update({ where: { id: activeInvite.id }, data: { usedBy: result.id } });
      }
      return result;
    });

    const session = await this.prisma.session.create({
      data: { userId, expiresAt: new Date(Date.now() + SESSION_DURATION_MS) },
    });
    return { session, profile };
  }

  /**
   * Adoption links a sign-in to a pre-existing venue-owned profile purely by
   * verified-email match — there's no invite-token confirmation on this path.
   * Record it so a manager reviewing the venue's audit log can catch a
   * mis-typed roster email or a mis-bind, rather than it happening silently.
   */
  private async logProfileAdoption(
    tx: Prisma.TransactionClient,
    profile: { id: string; fullName: string; role: Role; venueId: string | null },
  ) {
    if (!profile.venueId) return;
    await tx.auditLog.create({
      data: {
        venueId: profile.venueId,
        actorProfileId: null,
        actorName: profile.fullName,
        actorRole: profile.role,
        targetProfileId: profile.id,
        targetName: profile.fullName,
        targetRole: profile.role,
        entityType: 'profile',
        entityId: profile.id,
        action: 'profile_adopted',
        summary: `${profile.fullName} signed in and was linked to this venue by matching verified email.`,
      },
    });
  }
}
