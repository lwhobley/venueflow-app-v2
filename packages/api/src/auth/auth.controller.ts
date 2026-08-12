import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Role } from "@prisma/client";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from "class-validator";
import type { Request } from "express";
import {
  createHash,
  pbkdf2,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "crypto";
import { promisify } from "util";
import { hashInviteToken } from "../common/invite-token";

const pbkdf2Async = promisify(pbkdf2);
import { Public } from "./public.decorator";
import { CurrentUser } from "./current-user.decorator";
import type { AuthUser } from "./auth.guard";
import { getClientIp } from "../common/http";
import { assertWithinSharedRateLimit } from "../common/rate-limit";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
// Matches the JWT's 30-day expiry so a session and its token expire together.
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 600_000;
// Applies to newly-set passwords (signup, change, reset). Sign-in keeps the
// DTO's lower MinLength(6) floor so existing users with a shorter legacy
// password are not locked out.
const MIN_NEW_PASSWORD_LENGTH = 8;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = "sha256";
// Keep the unknown-user path computationally indistinguishable from a normal
// password check. This is a fixed hash for a non-secret, impossible account.
const DUMMY_PASSWORD_SALT = "not-a-real-user-salt";
const DUMMY_PASSWORD_HASH =
  "fbe490be8a0cbd07dcd5c3ec11d5525f878fa649e84c17864ad9d3e016700f20";
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 12;
const MAX_FAILED_SIGN_INS = 8;
const VERIFY_EMAIL_RATE_LIMIT_MAX = 10;

class PasswordAuthDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @Matches(/^\d{6}$/)
  pin!: string;

  // Retained only for the unreachable legacy signup branch below while it is
  // removed in a follow-up cleanup. It is not accepted by the PIN endpoint.
  @IsString()
  @IsOptional()
  password!: string;

  // Kept temporarily so older clients receive an explicit upgrade message;
  // only managed, PIN-based sign-in is supported by Stadium Wrangler.
  @IsIn(["signIn"])
  flow!: "signIn";

  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  inviteToken?: string;

  @IsBoolean()
  @IsOptional()
  termsAccepted?: boolean;
}

class ChangePasswordDto {
  @IsString()
  @IsOptional()
  currentPassword?: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

class VerifyEmailDto {
  @IsString()
  @Matches(/^\d{8}$/)
  code!: string;
}

class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^\d{8}$/)
  code!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

@Controller("v1/auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly authService: AuthService,
  ) {}

  @Public()
  @Post("password")
  async password(@Req() request: Request, @Body() body: PasswordAuthDto) {
    const email = body.email.trim().toLowerCase();
    if (!email || !body.pin)
      throw new BadRequestException("Enter your email and six-digit PIN.");
    await assertWithinSharedRateLimit(
      this.prisma,
      `auth:ip:${getClientIp(request)}`,
      AUTH_RATE_LIMIT_MAX,
      AUTH_RATE_LIMIT_WINDOW_MS,
    );
    if (body.flow !== "signIn")
      throw new BadRequestException(
        "Public account creation is not available. Ask your Stadium Wrangler administrator for access.",
      );

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        password: true,
        profiles: { select: { role: true, allAccess: true } },
      },
    });
    if (body.flow === "signIn") {
      const credential = user?.password;
      const passwordMatches = credential
        ? await this.authService.verifyPassword(
            body.pin,
            credential.salt,
            credential.iterations,
            credential.passwordHash,
          )
        : await this.authService.verifyPassword(
            body.pin,
            DUMMY_PASSWORD_SALT,
            PASSWORD_ITERATIONS,
            DUMMY_PASSWORD_HASH,
          );
      if (!credential || !passwordMatches) {
        // Apply the account-level limiter only after password verification so
        // a valid credential can always clear an attacker-induced lockout.
        await assertWithinSharedRateLimit(
          this.prisma,
          `auth:email:${email}`,
          AUTH_RATE_LIMIT_MAX,
          AUTH_RATE_LIMIT_WINDOW_MS,
        );
        if (user) {
          await this.recordFailedSignIn(user.id);
        }
        throw new UnauthorizedException("Invalid email or password.");
      }
      const canSignIn = (user.profiles ?? []).some(
        (profile) =>
          profile.allAccess ||
          ["owner", "admin", "platform_admin", "organization_admin"].includes(
            profile.role,
          ),
      );
      if (!canSignIn) {
        throw new UnauthorizedException(
          "This account does not have administrator access. Contact your venue owner.",
        );
      }
      if (user.failedSignInCount > 0 || user.lockedUntil) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedSignInCount: 0, lockedUntil: null },
        });
      }
      // Transparently upgrade hash strength on login when the stored iteration
      // count is below the current target.
      if (credential.iterations < PASSWORD_ITERATIONS) {
        try {
          const upgraded = await this.authService.hashPassword(body.pin);
          await this.prisma.passwordCredential.update({
            where: { userId: user.id },
            data: {
              salt: upgraded.salt,
              passwordHash: upgraded.hash,
              iterations: PASSWORD_ITERATIONS,
            },
          });
        } catch (err: any) {
          this.logger.warn(
            `Failed to upgrade password hash strength for user ${user.id}: ${err?.message ?? String(err)}`,
          );
        }
      }
      return this.issueSession(
        user.id,
        email,
        body.fullName,
        body.inviteToken,
        body.phone,
      );
    }

    // Reject signup whenever a password already exists, regardless of
    // verification state. Unverified accounts must use resend-verification or
    // password-reset to recover — allowing signup to overwrite an existing
    // password would let an attacker hijack unverified accounts.
    if (user?.password) {
      throw new BadRequestException(
        "We couldn't create your account. Check your details or try signing in.",
      );
    }
    // The DTO's MinLength(6) is a floor shared with sign-in (existing users may
    // have shorter legacy passwords); new passwords must meet the current bar.
    if (body.password.length < MIN_NEW_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_NEW_PASSWORD_LENGTH} characters.`,
      );
    }
    if (body.termsAccepted !== true) {
      throw new BadRequestException(
        "Accept the Terms of Service and Privacy Policy to create an account.",
      );
    }

    // Build the display name from fullName (legacy) or firstName + lastName.
    const resolvedFullName =
      body.fullName?.trim() ||
      [body.firstName, body.lastName].filter(Boolean).join(" ").trim() ||
      undefined;

    const phone = body.phone?.trim().replace(/[\s\-().+]/g, "") || undefined;

    // Possession of the long, single-use token delivered to this exact inbox
    // proves control of the invited email — but only for invites that are
    // NEVER handed back to a human in an API response (workforce.controller's
    // legacy-roster mint, which always leaves `code: null`). Manager-created
    // invites (app.controller's createInvite) always set `code` and return the
    // raw token/inviteUrl to the manager, who could forward it to someone
    // other than the invited address; auto-verifying those would let that
    // person claim the invited email without ever controlling the inbox.
    const emailInvite = body.inviteToken?.trim()
      ? await this.prisma.invite.findFirst({
          where: {
            tokenHash: hashInviteToken(body.inviteToken.trim()),
            email: { equals: email, mode: "insensitive" },
            usedBy: null,
            expiresAt: { gt: new Date() },
            code: null,
          },
          select: { id: true },
        })
      : null;

    const result = await this.authService.hashPassword(body.password);
    let nextUserId: string;
    try {
      nextUserId = await this.prisma.$transaction(async (tx) => {
        const nextUser = await tx.user.upsert({
          where: { email },
          update: {
            ...(phone ? { phone } : {}),
            ...(emailInvite
              ? {
                  emailVerifiedAt: new Date(),
                  emailVerificationCodeHash: null,
                  emailVerificationSentAt: null,
                }
              : {}),
            termsAcceptedAt: new Date(),
            failedSignInCount: 0,
            lockedUntil: null,
          },
          create: {
            email,
            phone,
            termsAcceptedAt: new Date(),
            ...(emailInvite ? { emailVerifiedAt: new Date() } : {}),
          },
        });
        await tx.passwordCredential.upsert({
          where: { userId: nextUser.id },
          update: {
            salt: result.salt,
            passwordHash: result.hash,
            iterations: PASSWORD_ITERATIONS,
          },
          create: {
            userId: nextUser.id,
            salt: result.salt,
            passwordHash: result.hash,
            iterations: PASSWORD_ITERATIONS,
          },
        });
        return nextUser.id;
      });
    } catch (error: any) {
      // Unique violation on userId: the concurrent signup won the race.
      if (error?.code === "P2002") {
        throw new BadRequestException(
          "An account already exists for this email. Sign in instead.",
        );
      }
      throw error;
    }
    const session = await this.issueSession(
      nextUserId,
      email,
      resolvedFullName,
      body.inviteToken,
      body.phone,
    );
    // Swallow delivery errors: the account is already created and the session
    // token is ready to return. The user can request a new code from the
    // verify-email screen if the email didn't arrive.
    if (!emailInvite) {
      try {
        await this.sendVerificationEmail(
          nextUserId,
          email,
          session.profile.fullName,
        );
      } catch (err: any) {
        this.logger.error(
          `Verification email failed for ${email}: ${err?.message ?? String(err)}`,
        );
      }
    }
    const isElevated =
      session.profile.role === "admin" ||
      session.profile.role === "owner" ||
      session.profile.role === "manager";

    if (isElevated) {
      void this.email.send({
        to: email,
        subject:
          "Welcome to Venue Wrangler — Your Hospitality Command Center is Ready",
        text:
          `Hi ${session.profile.fullName},\n\n` +
          `Welcome to Venue Wrangler — the luxury hospitality operations platform built to give you full control over your venue, your team, and your events, all in one place.\n\n` +
          `Your account is set up and ready to go. Here's a quick overview of everything at your fingertips:\n\n` +
          `🏢 Venue & Floor Plan Management\n` +
          `Set up your venue spaces, configure floor plans, and manage room/section assignments. Everything is laid out visually so you always know your venue's capacity and layout at a glance.\n\n` +
          `📅 Event Sales Inbox\n` +
          `Receive, qualify, and respond to event inquiries directly in the app. Track leads from first contact through proposal, booking, and confirmation — no more lost emails or missed opportunities.\n\n` +
          `🗓️ Staff Scheduling\n` +
          `Build and publish staff schedules with ease. Approve or deny unavailable-day requests, handle open shift postings, and process shift swaps — all in one workflow modeled for speed and clarity.\n\n` +
          `👥 Team Management\n` +
          `Add and manage your entire staff roster. Assign roles (admin, manager, staff), control what each member can see and do, and keep your org structure clean as your team grows.\n\n` +
          `⏱️ Clock In / Clock Out & Timekeeping\n` +
          `Staff can clock in and out directly from the app. You get a real-time view of who's on the floor, track hours worked, and pull timekeeping data for payroll prep.\n\n` +
          `📋 Requests & Approvals\n` +
          `All time-off, schedule change, and shift swap requests are routed to you for approval. Review, approve, or deny with a single tap — your team stays informed automatically.\n\n` +
          `📊 Operations Dashboard\n` +
          `Get a live snapshot of your venue's operational health — active shifts, upcoming events, pending requests, and staff status — from one central dashboard built for decision-makers.\n\n` +
          `🔔 Notifications & Alerts\n` +
          `Stay informed without being glued to your screen. Real-time push notifications keep you updated on schedule changes, new requests, event confirmations, and more.\n\n` +
          `You have full administrative access. If you need to add team members, configure your venue, or adjust permissions, head to Settings to get started.\n\n` +
          `Questions? Reach us at support@venuewrangler.com\n\n` +
          `Let's wrangle. 🤘\n\n` +
          `— The Venue Wrangler Team`,
      });
    } else {
      void this.email.send({
        to: email,
        subject:
          "Welcome to Venue Wrangler — Here's Everything You Need to Know",
        text:
          `Hi ${session.profile.fullName},\n\n` +
          `Welcome to Venue Wrangler! Your manager has added you to the team. This is the app your venue uses to manage schedules, shifts, and day-to-day operations. Here's how to get the most out of it:\n\n` +
          `📆 View Your Schedule\n` +
          `See your upcoming shifts at any time, right from the app. Your schedule is updated in real time — the moment your manager publishes or makes changes, you'll see it instantly.\n\n` +
          `🏖️ Request Unavailable Days\n` +
          `Need a day off? Submit a time-off request directly through the app. You'll get notified as soon as your manager reviews it — no chasing anyone down.\n\n` +
          `🔄 Shift Swaps & Open Shifts\n` +
          `Life happens. If you need to swap a shift with a coworker or pick up extra hours, you can request swaps and claim open shifts — all subject to manager approval.\n\n` +
          `⏱️ Clock In & Clock Out\n` +
          `When you arrive for your shift, clock in directly from the app. Clock out when you're done. It's fast, accurate, and keeps your hours logged automatically.\n\n` +
          `🔔 Stay in the Loop\n` +
          `Push notifications will keep you updated on schedule changes, request approvals, and any important updates from your manager — so you're never caught off guard.\n\n` +
          `🏢 Venue & Ops Visibility\n` +
          `Get a read-only view of venue operations so you always know what's happening around you — active events, floor plans, and shift context relevant to your role.\n\n` +
          `Getting started is simple:\n\n` +
          `Download Venue Wrangler from the App Store or Google Play\n\n` +
          `Sign in with the email your manager used to add you\n\n` +
          `Review your schedule and submit any unavailable-day requests\n\n` +
          `Questions? Ask your manager or reach us at support@venuewrangler.com\n\n` +
          `We're glad you're here. 👋\n\n` +
          `— The Venue Wrangler Team`,
      });
    }
    return session;
  }

  // Authenticated (not @Public): the global AuthGuard requires a valid bearer
  // token. Lets a signed-in user rotate their password; also lets a user who
  // signed up via OAuth set one for the first time.
  @Post("change-password")
  async changePassword(
    @Req() request: Request,
    @CurrentUser() user: AuthUser,
    @Body() body: ChangePasswordDto,
  ) {
    await assertWithinSharedRateLimit(
      this.prisma,
      `change-password:${user.sub}`,
      AUTH_RATE_LIMIT_MAX,
      AUTH_RATE_LIMIT_WINDOW_MS,
    );
    if (body.newPassword.length < MIN_NEW_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_NEW_PASSWORD_LENGTH} characters.`,
      );
    }
    const existing = await this.prisma.passwordCredential.findUnique({
      where: { userId: user.sub },
    });
    if (existing) {
      const ok = await this.authService.verifyPassword(
        body.currentPassword ?? "",
        existing.salt,
        existing.iterations,
        existing.passwordHash,
      );
      if (!ok)
        throw new UnauthorizedException("Current password is incorrect.");
    }
    const next = await this.authService.hashPassword(body.newPassword);
    await this.prisma.passwordCredential.upsert({
      where: { userId: user.sub },
      update: {
        salt: next.salt,
        passwordHash: next.hash,
        iterations: PASSWORD_ITERATIONS,
      },
      create: {
        userId: user.sub,
        salt: next.salt,
        passwordHash: next.hash,
        iterations: PASSWORD_ITERATIONS,
      },
    });
    // Revoke every other session so a leaked/old token can't survive a password
    // change; the caller's current session (if any) stays valid.
    await this.prisma.session.deleteMany({
      where: {
        userId: user.sub,
        ...(user.sid ? { NOT: { id: user.sid } } : {}),
      },
    });
    const account = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { email: true },
    });
    if (account?.email) {
      void this.email.send({
        to: account.email,
        subject:
          "Security Alert: Your Venue Wrangler Password Has Been Changed",
        text:
          `Hi there,\n\n` +
          `Your Venue Wrangler account password was successfully changed.\n\n` +
          `If you did not make this change, please reset your password immediately in the app and contact our support team at support@venuewrangler.com to secure your account.\n\n` +
          `Questions? support@venuewrangler.com\n\n` +
          `— The Venue Wrangler Team`,
      });
    }
    return { ok: true };
  }

  @Post("verify-email/send")
  async resendVerification(@CurrentUser() user: AuthUser) {
    const account = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!account?.email)
      throw new BadRequestException(
        "No email address is available for this account.",
      );
    if (account.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    await assertWithinSharedRateLimit(
      this.prisma,
      `verify-email:${user.sub}`,
      5,
      AUTH_RATE_LIMIT_WINDOW_MS,
    );
    await this.sendVerificationEmail(user.sub, account.email, user.name);
    return { ok: true };
  }

  @Post("verify-email")
  async verifyEmail(
    @Req() request: Request,
    @CurrentUser() user: AuthUser,
    @Body() body: VerifyEmailDto,
  ) {
    await assertWithinSharedRateLimit(
      this.prisma,
      `verify-email:ip:${getClientIp(request)}`,
      VERIFY_EMAIL_RATE_LIMIT_MAX,
      AUTH_RATE_LIMIT_WINDOW_MS,
    );
    await assertWithinSharedRateLimit(
      this.prisma,
      `verify-email:user:${user.sub}`,
      VERIFY_EMAIL_RATE_LIMIT_MAX,
      AUTH_RATE_LIMIT_WINDOW_MS,
    );
    const account = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        emailVerificationCodeHash: true,
        emailVerificationSentAt: true,
        emailVerifiedAt: true,
      },
    });
    if (!account) throw new UnauthorizedException("Account not found.");
    if (account.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    if (
      !account.emailVerificationCodeHash ||
      !account.emailVerificationSentAt
    ) {
      throw new BadRequestException(
        "Request a new verification code and try again.",
      );
    }
    if (
      account.emailVerificationSentAt.getTime() + EMAIL_CODE_TTL_MS <
      Date.now()
    ) {
      throw new BadRequestException(
        "That verification code has expired. Request a new code.",
      );
    }
    if (
      !this.authService.oneTimeCodeHashesMatch(
        account.emailVerificationCodeHash,
        this.authService.hashOneTimeCode(body.code),
      )
    ) {
      throw new BadRequestException("That verification code is not valid.");
    }
    await this.prisma.user.update({
      where: { id: user.sub },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationCodeHash: null,
        emailVerificationSentAt: null,
      },
    });
    return { ok: true };
  }

  @Public()
  @Post("forgot-password")
  async forgotPassword(
    @Req() request: Request,
    @Body() body: ForgotPasswordDto,
  ) {
    const email = body.email.trim().toLowerCase();
    await assertWithinSharedRateLimit(
      this.prisma,
      `forgot-password:ip:${getClientIp(request)}`,
      8,
      AUTH_RATE_LIMIT_WINDOW_MS,
    );
    await assertWithinSharedRateLimit(
      this.prisma,
      `forgot-password:email:${email}`,
      5,
      AUTH_RATE_LIMIT_WINDOW_MS,
    );

    const account = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        profiles: { select: { fullName: true }, take: 1 },
      },
    });
    if (account?.email) {
      const code = this.authService.generateOneTimeCode();
      await this.prisma.user.update({
        where: { id: account.id },
        data: {
          passwordResetCodeHash: this.authService.hashOneTimeCode(code),
          passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
          passwordResetSentAt: new Date(),
        },
      });
      try {
        await this.email.sendOrThrow({
          to: account.email,
          subject: "Reset Your Venue Wrangler Password",
          text:
            `Hi ${account.profiles?.[0]?.fullName ?? "there"},\n\n` +
            `We received a request to reset the password for your Venue Wrangler account.\n\n` +
            `To complete your password reset, enter the following code when prompted in the app:\n\n` +
            `   ${code}\n\n` +
            `Note: This code is valid for 60 minutes. If you did not request a password reset, you can safely ignore this email — your account remains secure.\n\n` +
            `Questions? support@venuewrangler.com\n\n` +
            `— The Venue Wrangler Team`,
        });
      } catch (error: any) {
        // Keep the public response identical for existing and unknown accounts;
        // otherwise a provider outage becomes an account-enumeration oracle.
        this.logger.error(
          `Password reset email failed for user ${account.id}: ${error?.message ?? String(error)}`,
        );
      }
    }
    return { ok: true };
  }

  @Public()
  @Post("reset-password")
  async resetPassword(@Req() request: Request, @Body() body: ResetPasswordDto) {
    const email = body.email.trim().toLowerCase();
    if (body.newPassword.length < MIN_NEW_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_NEW_PASSWORD_LENGTH} characters.`,
      );
    }
    await assertWithinSharedRateLimit(
      this.prisma,
      `reset-password:ip:${getClientIp(request)}`,
      8,
      AUTH_RATE_LIMIT_WINDOW_MS,
    );
    await assertWithinSharedRateLimit(
      this.prisma,
      `reset-password:email:${email}`,
      8,
      AUTH_RATE_LIMIT_WINDOW_MS,
    );

    // Reject invalid requests before running the expensive password KDF. The
    // transaction below repeats this check while holding the account lock so
    // concurrent requests cannot redeem the same one-time code twice.
    const candidateCodeHash = this.authService.hashOneTimeCode(body.code);
    const candidateAccount = await this.prisma.user.findUnique({
      where: { email },
      select: { passwordResetCodeHash: true, passwordResetExpiresAt: true },
    });
    if (
      !candidateAccount?.passwordResetCodeHash ||
      !candidateAccount.passwordResetExpiresAt ||
      candidateAccount.passwordResetExpiresAt.getTime() < Date.now() ||
      !this.authService.oneTimeCodeHashesMatch(
        candidateAccount.passwordResetCodeHash,
        candidateCodeHash,
      )
    ) {
      throw new BadRequestException(
        "That password reset code is invalid or expired.",
      );
    }

    const next = await this.authService.hashPassword(body.newPassword);
    await this.prisma.$transaction(async (tx) => {
      // Serialize attempts for this account and validate only after acquiring
      // the lock, so the same one-time code cannot win two concurrent resets.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`password-reset:${email}`}))`;
      const account = await tx.user.findUnique({
        where: { email },
        select: {
          id: true,
          passwordResetCodeHash: true,
          passwordResetExpiresAt: true,
        },
      });
      if (
        !account?.passwordResetCodeHash ||
        !account.passwordResetExpiresAt ||
        account.passwordResetExpiresAt.getTime() < Date.now() ||
        !this.authService.oneTimeCodeHashesMatch(
          account.passwordResetCodeHash,
          this.authService.hashOneTimeCode(body.code),
        )
      ) {
        throw new BadRequestException(
          "That password reset code is invalid or expired.",
        );
      }

      await tx.passwordCredential.upsert({
        where: { userId: account.id },
        update: {
          salt: next.salt,
          passwordHash: next.hash,
          iterations: PASSWORD_ITERATIONS,
        },
        create: {
          userId: account.id,
          salt: next.salt,
          passwordHash: next.hash,
          iterations: PASSWORD_ITERATIONS,
        },
      });
      await tx.user.update({
        where: { id: account.id },
        data: {
          passwordResetCodeHash: null,
          passwordResetExpiresAt: null,
          passwordResetSentAt: null,
          failedSignInCount: 0,
          lockedUntil: null,
        },
      });
      await tx.session.deleteMany({ where: { userId: account.id } });
    });
    return { ok: true };
  }

  // Revoke the current session (this device). The bearer token stops working
  // immediately on the next request.
  @Post("logout")
  async logout(@CurrentUser() user: AuthUser) {
    if (user.sid) {
      await this.prisma.$transaction([
        this.prisma.session.deleteMany({ where: { id: user.sid } }),
        ...(user.profileId
          ? [
              this.prisma.pushToken.deleteMany({
                where: { profileId: user.profileId },
              }),
            ]
          : []),
      ]);
    }
    return { ok: true };
  }

  // Revoke every session for the account (all devices).
  @Post("logout-all")
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.prisma.$transaction([
      this.prisma.session.deleteMany({ where: { userId: user.sub } }),
      ...(user.profileId
        ? [
            this.prisma.pushToken.deleteMany({
              where: { profileId: user.profileId },
            }),
          ]
        : []),
    ]);
    return { ok: true };
  }

  private async issueSession(
    userId: string,
    email: string,
    fullName?: string,
    inviteToken?: string,
    rawPhone?: string,
  ) {
    const { session, profile } = await this.authService.issueSession(
      userId,
      email,
      fullName,
      inviteToken,
      rawPhone,
    );
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    const emailVerified = Boolean(account?.emailVerifiedAt);
    const token = await this.jwt.signAsync({
      sub: userId,
      email,
      name: profile.fullName,
      sid: session.id,
      profileId: profile.id,
      venueId: profile.venueId,
      venueName: profile.venue?.name ?? null,
      role: profile.role,
      allAccess: profile.allAccess,
      trialEndsAt: profile.trialEndsAt?.toISOString() ?? null,
      venueStatus: profile.venue?.subscriptionStatus ?? null,
    });
    await this.prisma.session.update({
      where: { id: session.id },
      data: { tokenHash: createHash("sha256").update(token).digest("hex") },
    });
    const userProfiles =
      typeof this.prisma.profile?.findMany === "function"
        ? await this.prisma.profile.findMany({
            where: {
              userId,
              venueId: { not: null },
              OR: [{ membershipStatus: null }, { membershipStatus: "active" }],
            },
            include: { venue: { select: { id: true, name: true } } },
            orderBy: { createdAt: "asc" },
          })
        : [];
    const venues = userProfiles
      .filter((p) => p.venue)
      .map((p) => ({
        id: p.venue!.id,
        name: p.venue!.name,
        role: p.role,
        profileId: p.id,
      }));

    return {
      token,
      profile: mapProfile(profile, emailVerified),
      venue: profile.venue ? mapVenue(profile.venue) : null,
      venues,
    };
  }

  private async recordFailedSignIn(userId: string) {
    await this.prisma.$transaction(async (transaction) => {
      // Serialize failures for one account. A plain read/increment/write lets
      // concurrent password attempts overwrite one another and bypass lockout.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-failed-sign-in:${userId}`}))`;
      const current = await transaction.user.findUnique({
        where: { id: userId },
        select: { failedSignInCount: true, lockedUntil: true },
      });
      if (
        !current ||
        (current.lockedUntil && current.lockedUntil.getTime() > Date.now())
      )
        return;

      const nextCount =
        (current.lockedUntil ? 0 : current.failedSignInCount) + 1;
      await transaction.user.update({
        where: { id: userId },
        data: {
          failedSignInCount: nextCount >= MAX_FAILED_SIGN_INS ? 0 : nextCount,
          lockedUntil:
            nextCount >= MAX_FAILED_SIGN_INS
              ? new Date(Date.now() + AUTH_RATE_LIMIT_WINDOW_MS)
              : null,
        },
      });
    });
  }

  private async sendVerificationEmail(
    userId: string,
    email: string,
    fullName?: string,
  ) {
    const code = this.authService.generateOneTimeCode();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerificationCodeHash: this.authService.hashOneTimeCode(code),
        emailVerificationSentAt: new Date(),
      },
    });
    await this.email.sendOrThrow({
      to: email,
      subject: "Verify Your Venue Wrangler Email Address",
      text:
        `Hi ${fullName?.trim() || "there"},\n\n` +
        `Thank you for signing up for Venue Wrangler!\n\n` +
        `To complete your registration and verify your email address, please enter the following verification code in the app:\n\n` +
        `   ${code}\n\n` +
        `Note: This verification code is valid for 24 hours.\n\n` +
        `Questions? support@venuewrangler.com\n\n` +
        `— The Venue Wrangler Team`,
    });
  }
}

function mapVenue(venue: {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
}) {
  return {
    _id: venue.id,
    id: venue.id,
    name: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    geofenceRadiusM: venue.geofenceRadiusM,
    geofence_radius_m: venue.geofenceRadiusM,
  };
}

function mapProfile(
  profile: {
    id: string;
    email: string;
    fullName: string;
    role: Role;
    jobTitle: string;
    venueId: string | null;
    allAccess: boolean;
    trialEndsAt?: Date | null;
    phone?: string | null;
    altPhone?: string | null;
    address?: string | null;
    dateOfBirth?: Date | null;
    certifications?: string[];
  },
  emailVerified: boolean,
) {
  return {
    _id: profile.id,
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    full_name: profile.fullName,
    role: profile.role,
    jobTitle: profile.jobTitle,
    job_title: profile.jobTitle,
    venueId: profile.venueId,
    venue_id: profile.venueId,
    allAccess: profile.allAccess,
    all_access: profile.allAccess,
    emailVerified,
    email_verified: emailVerified,
    trialEndsAt: profile.trialEndsAt?.getTime() ?? null,
    phone: profile.phone ?? null,
    altPhone: profile.altPhone ?? null,
    address: profile.address ?? null,
    dateOfBirth: profile.dateOfBirth?.toISOString() ?? null,
    certifications: profile.certifications ?? [],
  };
}
