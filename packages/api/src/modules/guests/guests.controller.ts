import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { canManageVenue } from '../../auth/roles';
import { Public } from '../../auth/public.decorator';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { getClientIp } from '../../common/http';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { generateWebhookSecret, secretsMatch } from '../../common/webhook-auth';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];
const LEADS_WEBHOOK_RATE_LIMIT_MAX = 120;
const LEADS_WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;

class UpsertGuestDto {
  @IsString()
  @IsOptional()
  guestId?: string;

  @IsString()
  fullName!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  lifecycleStage?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsString()
  @IsOptional()
  birthday?: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsBoolean()
  @IsOptional()
  marketingOptIn?: boolean;

  @IsString()
  @IsOptional()
  favoriteTable?: string;

  @IsString()
  @IsOptional()
  preferredServer?: string;

  @IsString()
  @IsOptional()
  dietaryNotes?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}

class LeadDto {
  @IsString()
  fullName!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

class IngestLeadsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeadDto)
  leads!: LeadDto[];
}

class GuestListQueryDto {
  @IsString()
  @IsOptional()
  q?: string;

  @Type(() => Number)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsOptional()
  limit?: number;
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function cleanTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean))).slice(0, 12);
}

function mergeTags(existing: string[], incoming: string[]): string[] {
  return cleanTags([...existing, ...incoming]);
}

@Controller('v1/guests')
export class GuestsController {
  constructor(private readonly prisma: PrismaService) {}

  private requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
    if (!scope || !canManageVenue(scope.role, scope.allAccess)) throw new ForbiddenException('Not authorized');
  }

  @RequireSubscription('active')
  @Get()
  async listGuests(@VenueScope() scope: Scope, @Query() query: GuestListQueryDto) {
    this.requireManager(scope);
    const page = Math.max(0, Math.floor(query.page ?? 0));
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 100)), 200);
    const where: Record<string, unknown> = {
      venueId: scope.venueId,
      deletedAt: null,
    };
    if (query.q?.trim()) {
      const term = query.q.trim().toLowerCase();
      where['OR'] = [
        { nameLower: { contains: term } },
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
      ];
    }
    const [guests, totalCount] = await this.prisma.$transaction([
      this.prisma.guest.findMany({
        where: where as any,
        orderBy: { updatedAt: 'desc' },
        skip: page * limit,
        take: limit,
      }),
      this.prisma.guest.count({ where: where as any }),
    ]);
    return {
      guests: guests.map((g) => ({
        id: g.id,
        venueId: g.venueId,
        fullName: g.fullName,
        phone: g.phone ?? null,
        email: g.email ?? null,
        lifecycleStage: g.lifecycleStage ?? 'lead',
        source: g.source ?? null,
        birthday: g.birthday ?? null,
        company: g.company ?? null,
        marketingOptIn: g.marketingOptIn ?? false,
        favoriteTable: g.favoriteTable ?? null,
        preferredServer: g.preferredServer ?? null,
        dietaryNotes: g.dietaryNotes ?? null,
        tags: g.tags,
        notes: g.notes ?? null,
        createdAt: g.createdAt.getTime(),
        updatedAt: g.updatedAt.getTime(),
      })),
      totalCount,
      page,
      limit,
    };
  }

  @RequireSubscription('active')
  @Post()
  async upsertGuest(@VenueScope() scope: Scope, @Body() body: UpsertGuestDto) {
    this.requireManager(scope);
    const fullName = body.fullName.trim();
    if (!fullName) throw new BadRequestException('Guest name is required');
    const now = new Date();
    const data = {
      venueId: scope.venueId,
      fullName,
      nameLower: fullName.toLowerCase(),
      phone: cleanText(body.phone) ?? null,
      email: cleanText(body.email)?.toLowerCase() ?? null,
      lifecycleStage: body.lifecycleStage ?? null,
      source: cleanText(body.source) ?? null,
      birthday: cleanText(body.birthday) ?? null,
      company: cleanText(body.company) ?? null,
      marketingOptIn: body.marketingOptIn ?? false,
      favoriteTable: cleanText(body.favoriteTable) ?? null,
      preferredServer: cleanText(body.preferredServer) ?? null,
      dietaryNotes: cleanText(body.dietaryNotes) ?? null,
      tags: cleanTags(body.tags ?? []),
      notes: cleanText(body.notes) ?? null,
      updatedAt: now,
    };

    if (body.guestId) {
      const existing = await this.prisma.guest.findFirst({
        where: { id: body.guestId, venueId: scope.venueId },
      });
      if (!existing) throw new BadRequestException('Guest not found');
      const updated = await this.prisma.guest.update({ where: { id: existing.id }, data });
      return { id: updated.id };
    }

    const created = await this.prisma.guest.create({ data: { ...data, createdAt: now } });
    return { id: created.id };
  }

  @RequireSubscription('active')
  @Delete(':id')
  async removeGuest(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    const guest = await this.prisma.guest.findFirst({ where: { id, venueId: scope.venueId } });
    if (!guest) throw new BadRequestException('Guest not found');
    await this.prisma.guest.update({
      where: { id: guest.id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Post('ingest-leads')
  async ingestLeads(@VenueScope() scope: Scope, @Body() body: IngestLeadsDto) {
    this.requireManager(scope);
    return this.ingestLeadsForVenue(scope.venueId, body.leads);
  }

  // External lead sources (web forms, ad platforms) POST here, authenticated by
  // the venue's rotatable leadsWebhookSecret rather than a user session.
  @Public()
  @Post('leads-webhook/:venueId')
  async leadsWebhook(
    @Req() request: Request,
    @Param('venueId') venueId: string,
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() body: IngestLeadsDto,
  ) {
    // Verify the webhook secret before touching the rate limiter so an
    // unauthenticated spray of random venueIds can't churn RateLimitBucket rows.
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: { leadsWebhookSecret: true } });
    if (!venue?.leadsWebhookSecret || !secretsMatch(secret, venue.leadsWebhookSecret)) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
    await assertWithinSharedRateLimit(this.prisma, `leads-webhook:${venueId}:${getClientIp(request)}`, LEADS_WEBHOOK_RATE_LIMIT_MAX, LEADS_WEBHOOK_RATE_LIMIT_WINDOW_MS, 'Too many webhook requests.');
    return this.ingestLeadsForVenue(venueId, body.leads);
  }

  private async ingestLeadsForVenue(venueId: string, rawLeads: LeadDto[]) {
    const leads = rawLeads.slice(0, 100);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const guestIds: string[] = [];
    const seen = new Set<string>();

    // Normalize + dedupe first so we can batch the existence lookups instead of
    // issuing up to three queries per lead (the original N+1).
    const normalized = leads
      .map((lead) => {
        const fullName = lead.fullName.trim();
        if (!fullName) return null;
        const phone = cleanText(lead.phone) ?? null;
        const email = cleanText(lead.email)?.toLowerCase() ?? null;
        return {
          fullName,
          nameLower: fullName.toLowerCase(),
          phone,
          email,
          tags: cleanTags([...(lead.tags ?? []), 'lead']),
          source: cleanText(lead.source) ?? null,
          key: email ?? phone ?? fullName.toLowerCase(),
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
    skipped += leads.length - normalized.length;

    const emails = [...new Set(normalized.map((l) => l.email).filter((e): e is string => !!e))];
    const phones = [...new Set(normalized.map((l) => l.phone).filter((p): p is string => !!p))];
    const existingGuests = await this.prisma.guest.findMany({
      where: {
        venueId,
        deletedAt: null,
        OR: [
          ...(emails.length ? [{ email: { in: emails } }] : []),
          ...(phones.length ? [{ phone: { in: phones } }] : []),
        ],
      },
    });
    const byEmail = new Map(existingGuests.filter((g) => g.email).map((g) => [g.email!.toLowerCase(), g]));
    const byPhone = new Map(existingGuests.filter((g) => g.phone).map((g) => [g.phone!, g]));

    await this.prisma.$transaction(async (tx) => {
      for (const lead of normalized) {
        const { fullName, phone, email, tags: incomingTags, source } = lead;
        if (seen.has(lead.key)) { skipped++; continue; }
        seen.add(lead.key);

        const existing =
          (email ? byEmail.get(email) : null) ??
          (phone ? byPhone.get(phone) : null) ??
          null;

        if (existing) {
          await tx.guest.update({
            where: { id: existing.id },
            data: {
              fullName,
              nameLower: fullName.toLowerCase(),
              phone: phone ?? existing.phone,
              email: email ?? existing.email,
              lifecycleStage: existing.lifecycleStage ?? 'lead',
              source: source ?? existing.source,
              tags: mergeTags(existing.tags, incomingTags),
            },
          });
          guestIds.push(existing.id);
          updated++;
        } else {
          const newGuest = await tx.guest.create({
            data: {
              venueId,
              fullName,
              nameLower: fullName.toLowerCase(),
              phone: phone ?? null,
              email: email ?? null,
              lifecycleStage: 'lead',
              source,
              marketingOptIn: false,
              tags: incomingTags,
            },
          });
          if (newGuest.email) byEmail.set(newGuest.email.toLowerCase(), newGuest);
          if (newGuest.phone) byPhone.set(newGuest.phone, newGuest);
          guestIds.push(newGuest.id);
          created++;
        }
      }
    });

    return { created, updated, skipped, guestIds };
  }

  @RequireSubscription('active')
  @Post('rotate-webhook-secret')
  async rotateLeadsWebhookSecret(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const { secret, hashedSecret } = generateWebhookSecret();
    await this.prisma.venue.update({
      where: { id: scope.venueId },
      data: { leadsWebhookSecret: hashedSecret },
    });
    return { webhookSecret: secret };
  }
}
