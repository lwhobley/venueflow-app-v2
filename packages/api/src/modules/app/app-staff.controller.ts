import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { Prisma, Role } from "@prisma/client";
import { AuthGuard } from "../../auth/auth.guard";
import { AuthService } from "../../auth/auth.service";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { AuthUser } from "../../auth/auth.guard";
import { canManageRole, isOwnerOrAdminRole } from "../../auth/roles";
import { RequireSubscription } from "../../billing/require-subscription.decorator";
import { EmailService } from "../../email/email.service";
import { assertWithinSharedRateLimit } from "../../common/rate-limit";
import { syncTeamMemberCount } from "../../common/team-sync";
import { PrismaService } from "../../prisma/prisma.service";
import { runWithoutTenant } from "../../prisma/tenant-context";
import { mapProfile } from "./app-mappers";
import { ProfileService } from "./profile.service";
import { StaffImportParserService } from "./staff-import-parser.service";

const MAX_STAFF_IMPORT_ROWS = 100;
const AI_PARSE_RATE_LIMIT_MAX = 20;
const AI_PARSE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

class StaffDto {
  @IsString()
  @IsOptional()
  staffId?: string;

  @IsString()
  venueId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  fullName!: string;

  @IsIn(["admin", "owner", "manager", "server", "staff"])
  role!: Role;

  @IsString()
  jobTitle!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  altPhone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  certifications?: string[];

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  onboardingPin?: string;
}

class ParseStaffImportDto {
  @IsString()
  text!: string;
}

class StaffImportRowDto {
  @IsEmail()
  email!: string;

  @IsString()
  fullName!: string;

  @IsIn(["manager", "staff"])
  role!: "manager" | "staff";

  @IsString()
  jobTitle!: string;

  @IsString()
  @IsOptional()
  phone?: string;
}

class CommitStaffImportDto {
  @IsString()
  venueId!: string;

  @IsArray()
  @ArrayMaxSize(MAX_STAFF_IMPORT_ROWS)
  @ValidateNested({ each: true })
  @Type(() => StaffImportRowDto)
  items!: StaffImportRowDto[];
}

const ONBOARDING_TASK_STATUSES = ["open", "done", "cancelled"] as const;

class UpdateOnboardingTaskDto {
  @IsIn(ONBOARDING_TASK_STATUSES)
  status!: (typeof ONBOARDING_TASK_STATUSES)[number];
}

const DEFAULT_ONBOARDING_TASKS = [
  {
    title: "Confirm profile details",
    category: "profile",
    details: "Verify name, phone, emergency contact, and job title.",
  },
  {
    title: "Collect required certifications",
    category: "compliance",
    details: "Add food handler, alcohol server, safety, or local permits.",
  },
  {
    title: "Review handbook and policies",
    category: "training",
    details:
      "Confirm workplace expectations, scheduling rules, and conduct policies.",
  },
  {
    title: "Train on clock-in and scheduling",
    category: "training",
    details:
      "Show the staff member how to clock in and request unavailable days or shift changes.",
  },
  {
    title: "First shift readiness check",
    category: "service",
    details:
      "Confirm uniform, station assignment, POS access, and opening checklist.",
  },
] as const;

// Venue-staff roster CRUD for /v1/app/staff*. Split out of AppController;
// routes, role checks, and response shapes are unchanged. Subscription-gated
// at the class level (matching the sibling /v1/staff StaffController) so an
// expired venue can't keep reading staff PII / mutating the roster.
@RequireSubscription()
@Controller("v1/app")
export class AppStaffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly profiles: ProfileService,
    private readonly staffImportParser: StaffImportParserService,
    private readonly auth: AuthService,
  ) {}

  @UseGuards(AuthGuard)
  @Get("staff")
  async listVenueStaff(@CurrentUser() user: AuthUser) {
    const profile = await this.profiles.requireManagerProfile(user);
    return this.prisma.profile
      .findMany({
        where: {
          venueId: profile.venueId!,
          OR: [{ membershipStatus: null }, { membershipStatus: "active" }],
        },
        orderBy: { fullName: "asc" },
      })
      .then((rows) => rows.map((row) => mapProfile(row)));
  }

  @UseGuards(AuthGuard)
  @Get("staff/onboarding")
  async listOnboardingTasks(
    @CurrentUser() user: AuthUser,
    @Query("profileId") profileId?: string,
  ) {
    const viewer = await this.profiles.requireManagerProfile(user);
    const venueId = viewer.venueId!;
    const profiles = await this.prisma.profile.findMany({
      where: {
        venueId,
        ...(profileId ? { id: profileId } : {}),
        OR: [{ membershipStatus: null }, { membershipStatus: "active" }],
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        jobTitle: true,
      },
      orderBy: { fullName: "asc" },
      take: profileId ? 1 : 200,
    });
    await this.ensureOnboardingTasksForProfiles(
      venueId,
      profiles.map((profile) => profile.id),
    );
    const tasks = await this.prisma.staffOnboardingTask.findMany({
      where: { venueId, ...(profileId ? { profileId } : {}) },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: 1000,
    });
    const tasksByProfile = new Map<string, typeof tasks>();
    for (const task of tasks) {
      const list = tasksByProfile.get(task.profileId) ?? [];
      list.push(task);
      tasksByProfile.set(task.profileId, list);
    }
    return {
      staff: profiles.map((profile) => {
        const profileTasks = tasksByProfile.get(profile.id) ?? [];
        return {
          _id: profile.id,
          fullName: profile.fullName,
          email: profile.email,
          role: profile.role,
          jobTitle: profile.jobTitle,
          completedCount: profileTasks.filter((task) => task.status === "done")
            .length,
          totalCount: profileTasks.filter((task) => task.status !== "cancelled")
            .length,
          tasks: profileTasks.map(mapOnboardingTask),
        };
      }),
    };
  }

  @UseGuards(AuthGuard)
  @Patch("staff/onboarding/:id")
  async updateOnboardingTask(
    @CurrentUser() user: AuthUser,
    @Param("id") taskId: string,
    @Body() body: UpdateOnboardingTaskDto,
  ) {
    const viewer = await this.profiles.requireManagerProfile(user);
    const venueId = viewer.venueId!;
    const task = await this.prisma.staffOnboardingTask.findFirst({
      where: { id: taskId, venueId },
    });
    if (!task) throw new NotFoundException("Onboarding task not found");
    const target = await this.prisma.profile.findFirst({
      where: { id: task.profileId, venueId },
    });
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.staffOnboardingTask.update({
        where: { id: task.id },
        data: {
          status: body.status,
          completedBy: body.status === "done" ? viewer.id : null,
          completedAt: body.status === "done" ? now : null,
          updatedAt: now,
        },
      });
      await this.writeAuditLog(
        {
          venueId,
          actor: viewer,
          target,
          entityType: "onboarding_task",
          entityId: task.id,
          action:
            body.status === "done"
              ? "onboarding_task_completed"
              : "onboarding_task_updated",
          summary: `${viewer.fullName} marked "${task.title}" ${body.status}${target ? ` for ${target.fullName}` : ""}.`,
          metadata: {
            taskTitle: task.title,
            previousStatus: task.status,
            nextStatus: body.status,
          },
        },
        tx,
      );
      return updatedTask;
    });
    return mapOnboardingTask(updated);
  }

  @UseGuards(AuthGuard)
  @Get("staff/audit-log")
  async listAuditLog(@CurrentUser() user: AuthUser) {
    const viewer = await this.profiles.requireManagerProfile(user);
    const rows = await this.prisma.auditLog.findMany({
      where: { venueId: viewer.venueId! },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { entries: rows.map(mapAuditLog) };
  }

  @UseGuards(AuthGuard)
  @Post("staff")
  async upsertVenueStaff(
    @CurrentUser() user: AuthUser,
    @Body() body: StaffDto,
  ) {
    const viewer = await this.profiles.requireManagerProfile(user);
    if (viewer.venueId !== body.venueId)
      throw new ForbiddenException("Not authorized");
    const isAdministrator =
      viewer.allAccess ||
      ["owner", "admin", "platform_admin", "organization_admin"].includes(
        viewer.role,
      );
    // Every staff member signs in with email + a 6-digit PIN — there is no
    // separate email/password flow. Any administrator can assign or reset a
    // teammate's PIN regardless of that teammate's own role.
    if (body.onboardingPin && !isAdministrator) {
      throw new ForbiddenException(
        "Only venue administrators can assign access PINs.",
      );
    }
    const row = await this.upsertOneStaffMember(viewer, body);
    return mapProfile(row);
  }

  @UseGuards(AuthGuard)
  @Post("staff/import/parse")
  async parseStaffImport(
    @CurrentUser() user: AuthUser,
    @Body() body: ParseStaffImportDto,
  ) {
    const profile = await this.profiles.requireManagerProfile(user);
    await assertWithinSharedRateLimit(
      this.prisma,
      `ai-parse:staff-import:${profile.venueId}`,
      AI_PARSE_RATE_LIMIT_MAX,
      AI_PARSE_RATE_LIMIT_WINDOW_MS,
      "Too many AI parse requests. Try again in a few minutes.",
    );
    return this.staffImportParser.parse(body.text);
  }

  @UseGuards(AuthGuard)
  @Post("staff/import/commit")
  async commitStaffImport(
    @CurrentUser() user: AuthUser,
    @Body() body: CommitStaffImportDto,
  ) {
    const viewer = await this.profiles.requireManagerProfile(user);
    if (viewer.venueId !== body.venueId)
      throw new ForbiddenException("Not authorized");
    const created: string[] = [];
    const updated: string[] = [];
    const failed: Array<{ email: string; error: string }> = [];
    for (const item of body.items) {
      try {
        const existingBefore = await this.prisma.profile.findFirst({
          where: { venueId: body.venueId, email: item.email.toLowerCase() },
          select: { id: true },
        });
        const row = await this.upsertOneStaffMember(viewer, {
          venueId: body.venueId,
          email: item.email,
          fullName: item.fullName,
          role: item.role,
          jobTitle: item.jobTitle,
          phone: item.phone,
        });
        (existingBefore ? updated : created).push(row.email);
      } catch (error) {
        failed.push({
          email: item.email,
          error: error instanceof Error ? error.message : "Import failed",
        });
      }
    }
    return { created: created.length, updated: updated.length, failed };
  }

  /** Core create-or-update logic for a single roster row, shared by the single-staff endpoint and bulk import. */
  private async upsertOneStaffMember(
    viewer: {
      id: string;
      role: Role;
      allAccess: boolean;
      venueId: string | null;
      fullName: string;
      venue?: { name: string } | null;
    },
    body: Pick<
      StaffDto,
      | "venueId"
      | "staffId"
      | "email"
      | "fullName"
      | "role"
      | "jobTitle"
      | "phone"
      | "altPhone"
      | "address"
      | "dateOfBirth"
      | "certifications"
      | "onboardingPin"
    >,
  ) {
    let existing;
    if (body.staffId) {
      existing = await this.prisma.profile.findFirst({
        where: { id: body.staffId, venueId: body.venueId },
      });
      if (!existing) throw new NotFoundException("Staff member not found");
    } else {
      existing = await this.prisma.profile.findFirst({
        where: { venueId: body.venueId, email: body.email.toLowerCase() },
      });
    }
    // Managers cannot grant roles at or above their own level. Only applies
    // when the role is actually changing — resubmitting a member's existing
    // role (e.g. a manager editing their own phone number) is not a grant and
    // must not be blocked here.
    const viewerIsOwnerOrAdmin =
      viewer.role === "owner" || viewer.role === "admin" || viewer.allAccess;
    const roleChanged = !existing || existing.role !== body.role;
    if (
      !viewerIsOwnerOrAdmin &&
      roleChanged &&
      ["admin", "owner", "manager"].includes(body.role)
    ) {
      throw new ForbiddenException(
        "Managers cannot assign admin, owner, or manager roles",
      );
    }
    const employeeFields = {
      phone: body.phone?.trim() || null,
      altPhone: body.altPhone?.trim() || null,
      address: body.address?.trim() || null,
      dateOfBirth: body.dateOfBirth ? parseDateOfBirth(body.dateOfBirth) : null,
      certifications: body.certifications ?? [],
    };
    const pinCredential = body.onboardingPin
      ? await this.auth.hashPassword(body.onboardingPin)
      : null;
    const row = await this.prisma.$transaction(async (tx) => {
      let created;
      if (existing) {
        const isDemoting =
          isOwnerOrAdminRole(existing.role) && !isOwnerOrAdminRole(body.role);
        await this.assertCanManageLegacyStaffTarget(
          viewer,
          existing,
          isDemoting,
          tx,
        );
        created = await tx.profile.update({
          where: { id: existing.id },
          data: {
            email: body.email.toLowerCase(),
            fullName: body.fullName,
            role: body.role,
            jobTitle: body.jobTitle,
            venueId: body.venueId,
            ...employeeFields,
          },
        });
      } else {
        created = await tx.profile.create({
          data: {
            email: body.email.toLowerCase(),
            fullName: body.fullName,
            role: body.role,
            jobTitle: body.jobTitle,
            venueId: body.venueId,
            ...employeeFields,
          },
        });
        await this.ensureOnboardingTasks(body.venueId, created.id, tx);
      }
      if (pinCredential) {
        const account = created.userId
          ? await tx.user.findUniqueOrThrow({ where: { id: created.userId } })
          : await tx.user.upsert({
              where: { email: created.email },
              update: {},
              create: { email: created.email },
            });
        await tx.passwordCredential.upsert({
          where: { userId: account.id },
          update: {
            salt: pinCredential.salt,
            passwordHash: pinCredential.hash,
            iterations: 600_000,
          },
          create: {
            userId: account.id,
            salt: pinCredential.salt,
            passwordHash: pinCredential.hash,
            iterations: 600_000,
          },
        });
        if (!created.userId)
          created = await tx.profile.update({
            where: { id: created.id },
            data: { userId: account.id },
          });
      }
      await this.writeAuditLog(
        {
          venueId: body.venueId,
          actor: viewer,
          target: created,
          entityType: "profile",
          entityId: created.id,
          action: existing ? "staff_updated" : "staff_created",
          summary: existing
            ? `${viewer.fullName} updated ${created.fullName}${existing.role !== created.role ? ` from ${existing.role} to ${created.role}` : ""}.`
            : `${viewer.fullName} added ${created.fullName} as ${created.role}.`,
          metadata: existing
            ? {
                previousRole: existing.role,
                nextRole: created.role,
                previousJobTitle: existing.jobTitle,
                nextJobTitle: created.jobTitle,
                onboardingPinAssigned: Boolean(pinCredential),
              }
            : {
                role: created.role,
                jobTitle: created.jobTitle,
                onboardingPinAssigned: Boolean(pinCredential),
              },
        },
        tx,
      );
      return created;
    });
    const venueName = viewer.venue?.name ?? "your venue";
    void this.email.send({
      to: row.email,
      subject: existing
        ? "Your Venue Wrangler Profile Has Been Updated"
        : `Invitation: Join the Team at ${venueName} on Venue Wrangler`,
      text: existing
        ? `Hi ${row.fullName},\n\n` +
          `Your team profile for ${venueName} was updated. Here are your current profile details:\n\n` +
          `Updated Profile Details\n` +
          `Detail\tInfo\n` +
          `Name\t${row.fullName}\n` +
          `Role\t${row.role}\n` +
          `Job Title\t${row.jobTitle}\n\n` +
          `If you did not request these changes or have any questions, please contact your venue administrator.\n\n` +
          `Questions? support@venuewrangler.com\n\n` +
          `— The Venue Wrangler Team`
        : `Hi ${row.fullName},\n\n` +
          `Welcome! You have been added to the team at ${venueName} as a ${row.jobTitle}.\n\n` +
          (pinCredential
            ? `Sign in with your email (${row.email}) and the 6-digit PIN your administrator assigned you.\n\n`
            : `Your administrator will give you a 6-digit sign-in PIN to use with your email (${row.email}).\n\n`) +
          `We're excited to have you on board!\n\n` +
          `Questions? support@venuewrangler.com\n\n` +
          `— The Venue Wrangler Team`,
    });
    return row;
  }

  @UseGuards(AuthGuard)
  @Delete("staff/:id")
  async deactivateVenueStaff(
    @CurrentUser() user: AuthUser,
    @Param("id") staffId: string,
  ) {
    const viewer = await this.profiles.requireManagerProfile(user);
    const staff = await this.prisma.profile.findFirst({
      where: { id: staffId, venueId: viewer.venueId! },
    });
    if (!staff) throw new NotFoundException("Staff member not found");
    const updated = await runWithoutTenant(() =>
      this.prisma.$transaction(async (tx) => {
        await this.assertCanManageLegacyStaffTarget(viewer, staff, true, tx);
        const u = await tx.profile.update({
          where: { id: staff.id },
          data: { membershipStatus: "revoked" },
        });
        if (staff.userId) {
          const activeElsewhere = await tx.profile.count({
            where: {
              userId: staff.userId,
              venueId: { not: viewer.venueId! },
              OR: [{ membershipStatus: null }, { membershipStatus: "active" }],
            },
          });
          if (activeElsewhere === 0)
            await tx.session.deleteMany({ where: { userId: staff.userId } });
        }
        await this.writeAuditLog(
          {
            venueId: viewer.venueId!,
            actor: viewer,
            target: staff,
            entityType: "profile",
            entityId: staff.id,
            action: "staff_deactivated",
            summary: `${viewer.fullName} deactivated ${staff.fullName}.`,
            metadata: { role: staff.role, jobTitle: staff.jobTitle },
          },
          tx,
        );
        await syncTeamMemberCount(tx, viewer.venueId);
        return u;
      }),
    );
    return mapProfile(updated);
  }

  private async assertCanManageLegacyStaffTarget(
    viewer: {
      id: string;
      role: Role;
      allAccess: boolean;
      venueId: string | null;
    },
    target: { id: string; role: Role; venueId: string | null },
    demotingOrRemoving = false,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    // Editing your own profile is always allowed; the last-owner guard below
    // still prevents a sole owner from self-demoting out of access.
    if (
      target.id !== viewer.id &&
      !canManageRole(viewer.role, target.role, viewer.allAccess)
    ) {
      throw new ForbiddenException("You cannot modify this staff member");
    }
    // Only enforce the last-owner/admin guard when the operation would actually
    // remove or demote the target. Harmless edits (name, phone, job title) on
    // the sole owner/admin are safe and should not be blocked.
    if (demotingOrRemoving && isOwnerOrAdminRole(target.role)) {
      // Advisory-lock the venue so two concurrent demotions/removals can't both
      // read the same pre-write count and both pass the guard.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`venue-admin-count:${viewer.venueId}`}))`;
      const ownerAdminCount = await db.profile.count({
        where: { venueId: viewer.venueId, role: { in: ["owner", "admin"] } },
      });
      if (ownerAdminCount <= 1) {
        throw new ForbiddenException(
          "You cannot remove the last owner or admin from the venue",
        );
      }
    }
  }

  /**
   * Seeds onboarding tasks for whichever of the given profiles don't already
   * have any, in a single existence check + single batched insert — instead of
   * one createMany round-trip per profile, which made every GET
   * /staff/onboarding load do up to 200 DB writes even when nothing changed.
   */
  private async ensureOnboardingTasksForProfiles(
    venueId: string,
    profileIds: string[],
  ) {
    if (profileIds.length === 0) return;
    const existing = await this.prisma.staffOnboardingTask.findMany({
      where: { venueId, profileId: { in: profileIds } },
      select: { profileId: true },
      distinct: ["profileId"],
    });
    const seeded = new Set(existing.map((row) => row.profileId));
    const missing = profileIds.filter((id) => !seeded.has(id));
    if (missing.length === 0) return;
    const now = new Date();
    await this.prisma.staffOnboardingTask.createMany({
      data: missing.flatMap((profileId) =>
        DEFAULT_ONBOARDING_TASKS.map((task) => ({
          venueId,
          profileId,
          title: task.title,
          details: task.details,
          category: task.category,
          status: "open",
          createdAt: now,
          updatedAt: now,
        })),
      ),
      skipDuplicates: true,
    });
  }

  private async ensureOnboardingTasks(
    venueId: string,
    profileId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const now = new Date();
    await tx.staffOnboardingTask.createMany({
      data: DEFAULT_ONBOARDING_TASKS.map((task) => ({
        venueId,
        profileId,
        title: task.title,
        details: task.details,
        category: task.category,
        status: "open",
        createdAt: now,
        updatedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  private async writeAuditLog(
    args: {
      venueId: string;
      actor: { id: string; fullName: string; role: Role };
      target: { id: string; fullName: string; role: Role } | null;
      entityType: string;
      entityId?: string | null;
      action: string;
      summary: string;
      metadata?: Prisma.InputJsonObject;
    },
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    await tx.auditLog.create({
      data: {
        venueId: args.venueId,
        actorProfileId: args.actor.id,
        actorName: args.actor.fullName,
        actorRole: args.actor.role,
        targetProfileId: args.target?.id ?? null,
        targetName: args.target?.fullName ?? null,
        targetRole: args.target?.role ?? null,
        entityType: args.entityType,
        entityId: args.entityId ?? null,
        action: args.action,
        summary: args.summary,
        metadata: args.metadata ?? undefined,
      },
    });
  }
}

/** Accept only YYYY-MM-DD and store as noon UTC to avoid timezone day-shift. */
function parseDateOfBirth(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException("dateOfBirth must be in YYYY-MM-DD format.");
  }
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException("dateOfBirth is not a valid date.");
  }
  return date;
}

function mapOnboardingTask(task: {
  id: string;
  profileId: string;
  title: string;
  details: string | null;
  category: string;
  dueDate: string | null;
  status: string;
  completedBy: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: task.id,
    profileId: task.profileId,
    title: task.title,
    details: task.details,
    category: task.category,
    dueDate: task.dueDate,
    status: task.status,
    completedBy: task.completedBy,
    completedAt: task.completedAt?.getTime() ?? null,
    createdAt: task.createdAt.getTime(),
    updatedAt: task.updatedAt.getTime(),
  };
}

function mapAuditLog(entry: {
  id: string;
  actorName: string | null;
  actorRole: string | null;
  targetName: string | null;
  targetRole: string | null;
  entityType: string;
  action: string;
  summary: string;
  createdAt: Date;
}) {
  return {
    _id: entry.id,
    actorName: entry.actorName,
    actorRole: entry.actorRole,
    targetName: entry.targetName,
    targetRole: entry.targetRole,
    entityType: entry.entityType,
    action: entry.action,
    summary: entry.summary,
    createdAt: entry.createdAt.getTime(),
  };
}
