import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GuestsController } from './guests.controller';
import { generateWebhookSecret, hashWebhookSecret } from '../../common/webhook-auth';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

import { assertWithinSharedRateLimit } from '../../common/rate-limit';

function makeController() {
  const prisma: any = {
    guest: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'guest-new' }),
      update: vi.fn().mockResolvedValue({ id: 'guest-updated' }),
    },
    reservation: {
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
    posCheck: {
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
    venue: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation((arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(prisma);
    }),
  };
  const controller = new GuestsController(prisma);
  return { controller, prisma };
}

const managerScope = { venueId: 'venue-1', profileId: 'manager-1', role: 'manager', allAccess: false } as any;
const staffScope = { venueId: 'venue-1', profileId: 'staff-1', role: 'staff', allAccess: false } as any;

function makeGuestRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'guest-1',
    venueId: 'venue-1',
    fullName: 'Alex Guest',
    phone: null,
    email: null,
    lifecycleStage: null,
    source: null,
    birthday: null,
    company: null,
    marketingOptIn: null,
    favoriteTable: null,
    preferredServer: null,
    dietaryNotes: null,
    tags: [],
    notes: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-02T00:00:00Z'),
    ...overrides,
  };
}

function makeRequest(ip = '203.0.113.5') {
  return { ip } as any;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GuestsController', () => {
  describe('authorization', () => {
    it('rejects staff from listing guests', async () => {
      const { controller } = makeController();
      await expect(controller.listGuests(staffScope, {})).rejects.toThrow(ForbiddenException);
    });

    it('rejects a missing scope from upserting a guest', async () => {
      const { controller } = makeController();
      await expect(controller.upsertGuest(undefined as any, { fullName: 'New Guest' } as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects staff from removing a guest', async () => {
      const { controller } = makeController();
      await expect(controller.removeGuest(staffScope, 'guest-1')).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from ingesting leads', async () => {
      const { controller } = makeController();
      await expect(controller.ingestLeads(staffScope, { leads: [] } as any)).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from rotating the leads webhook secret', async () => {
      const { controller } = makeController();
      await expect(controller.rotateLeadsWebhookSecret(staffScope)).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from reading a guest profile', async () => {
      const { controller } = makeController();
      await expect(controller.getGuestProfile(staffScope, 'guest-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listGuests', () => {
    it('scopes the query to the venue and excludes soft-deleted guests', async () => {
      const { controller, prisma } = makeController();

      await controller.listGuests(managerScope, {});

      expect(prisma.guest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { venueId: 'venue-1', deletedAt: null } }),
      );
      expect(prisma.guest.count).toHaveBeenCalledWith({ where: { venueId: 'venue-1', deletedAt: null } });
    });

    it('adds a case-insensitive search filter across name, email, and phone', async () => {
      const { controller, prisma } = makeController();

      await controller.listGuests(managerScope, { q: '  Alex  ' });

      const where = prisma.guest.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { nameLower: { contains: 'alex' } },
        { email: { contains: 'alex', mode: 'insensitive' } },
        { phone: { contains: 'alex' } },
      ]);
    });

    it('ignores a blank search term', async () => {
      const { controller, prisma } = makeController();

      await controller.listGuests(managerScope, { q: '   ' });

      const where = prisma.guest.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });

    it('clamps negative pages and over-limit page sizes', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.listGuests(managerScope, { page: -5, limit: 5000 });

      expect(result.page).toBe(0);
      expect(result.limit).toBe(200);
      expect(prisma.guest.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 200 }));
    });

    it('clamps a zero or negative limit up to 1', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.listGuests(managerScope, { page: 2, limit: 0 });

      expect(result.limit).toBe(1);
      expect(prisma.guest.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 2, take: 1 }));
    });

    it('maps guest rows to the response shape with defaults for null fields', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findMany.mockResolvedValue([makeGuestRow()]);
      prisma.guest.count.mockResolvedValue(1);

      const result = await controller.listGuests(managerScope, {});

      expect(result.guests).toEqual([
        expect.objectContaining({
          // Both keys are populated: _id is what the mobile client's GuestRow
          // type reads (a prior mismatch here left the guest list unable to
          // render — FlatList's keyExtractor collapsed every row onto the
          // same "undefined" key), id is kept for callers using the REST
          // convention directly.
          _id: 'guest-1',
          id: 'guest-1',
          lifecycleStage: 'lead',
          marketingOptIn: false,
          phone: null,
          email: null,
          tags: [],
        }),
      ]);
      expect(result.totalCount).toBe(1);
    });

    it('defaults CRM stats to zero/null when a guest has no reservations or checks', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findMany.mockResolvedValue([makeGuestRow()]);
      prisma.guest.count.mockResolvedValue(1);

      const result = await controller.listGuests(managerScope, {});

      expect(result.guests[0]).toEqual(
        expect.objectContaining({
          reservationCount: 0,
          visitCount: 0,
          lastVisitAt: null,
          upcomingReservationAt: null,
          totalSpendCents: 0,
          averageSpendCents: 0,
          daysSinceLastVisit: null,
        }),
      );
    });

    it('merges per-guest visit and spend stats from the groupBy aggregates', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findMany.mockResolvedValue([makeGuestRow()]);
      prisma.guest.count.mockResolvedValue(1);
      const lastVisit = new Date('2026-07-15T18:00:00Z');
      const nextVisit = new Date('2026-08-20T18:00:00Z');
      prisma.reservation.groupBy
        .mockResolvedValueOnce([{ guestId: 'guest-1', _count: { _all: 5 } }]) // total
        .mockResolvedValueOnce([{ guestId: 'guest-1', _count: { _all: 3 }, _max: { reservationTime: lastVisit } }]) // past visits
        .mockResolvedValueOnce([{ guestId: 'guest-1', _min: { reservationTime: nextVisit } }]); // upcoming
      prisma.posCheck.groupBy.mockResolvedValue([
        { guestId: 'guest-1', _sum: { totalCents: 30_000 }, _count: { _all: 3 } },
      ]);

      const result = await controller.listGuests(managerScope, {});

      expect(result.guests[0]).toEqual(
        expect.objectContaining({
          reservationCount: 5,
          visitCount: 3,
          lastVisitAt: lastVisit.getTime(),
          upcomingReservationAt: nextVisit.getTime(),
          totalSpendCents: 30_000,
          averageSpendCents: 10_000,
        }),
      );
    });

    it('returns an empty list when the venue has no guests', async () => {
      const { controller } = makeController();

      const result = await controller.listGuests(managerScope, {});

      expect(result.guests).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('does not query stats at all when the page has no guests', async () => {
      const { controller, prisma } = makeController();

      await controller.listGuests(managerScope, {});

      expect(prisma.reservation.groupBy).not.toHaveBeenCalled();
      expect(prisma.posCheck.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('getGuestProfile', () => {
    it('throws NotFoundException when the guest does not exist in this venue', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findFirst.mockResolvedValue(null);

      await expect(controller.getGuestProfile(managerScope, 'guest-missing')).rejects.toThrow('Guest not found');
    });

    it('scopes the guest lookup to the venue and excludes soft-deleted guests', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findFirst.mockResolvedValue(makeGuestRow());

      await controller.getGuestProfile(managerScope, 'guest-1');

      expect(prisma.guest.findFirst).toHaveBeenCalledWith({
        where: { id: 'guest-1', venueId: 'venue-1', deletedAt: null },
      });
    });

    it('returns the guest, reservations, and checks in the shape the mobile client expects', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findFirst.mockResolvedValue(makeGuestRow());
      prisma.reservation.findMany.mockResolvedValue([
        {
          id: 'res-1',
          partySize: 4,
          reservationTime: new Date('2026-07-15T18:00:00Z'),
          status: 'completed',
          tags: ['anniversary'],
          notes: null,
          isPrivateEvent: false,
          eventName: null,
          eventStatus: null,
          eventSpace: null,
          setupStyle: null,
          menuNotes: null,
          beverageNotes: null,
          billingNotes: null,
          estimatedValueCents: null,
          depositDueCents: null,
        },
      ]);
      prisma.posCheck.findMany.mockResolvedValue([
        {
          id: 'check-1',
          provider: 'toast',
          openedAt: new Date('2026-07-15T18:05:00Z'),
          closedAt: new Date('2026-07-15T19:30:00Z'),
          totalCents: 12_000,
          tipCents: 2_000,
          status: 'paid',
          revenueCenter: 'Dining Room',
          tenderType: 'card',
          guestCount: 4,
          menuItems: [{ name: 'Ribeye', category: 'Entree', quantity: 1, priceCents: 6000 }],
        },
      ]);

      const result = await controller.getGuestProfile(managerScope, 'guest-1');

      expect(result.guest).toEqual(expect.objectContaining({ _id: 'guest-1', id: 'guest-1' }));
      expect(result.reservations).toEqual([
        expect.objectContaining({ _id: 'res-1', partySize: 4, status: 'completed', tags: ['anniversary'] }),
      ]);
      expect(result.checks).toEqual([
        expect.objectContaining({
          _id: 'check-1',
          totalCents: 12_000,
          menuItems: [{ name: 'Ribeye', category: 'Entree', quantity: 1, priceCents: 6000 }],
        }),
      ]);
    });

    it('defaults a check with no menu items to an empty array, not null', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findFirst.mockResolvedValue(makeGuestRow());
      prisma.posCheck.findMany.mockResolvedValue([
        {
          id: 'check-1',
          provider: 'toast',
          openedAt: new Date('2026-07-15T18:05:00Z'),
          closedAt: null,
          totalCents: 5_000,
          tipCents: 0,
          status: 'open',
          revenueCenter: null,
          tenderType: null,
          guestCount: null,
          menuItems: null,
        },
      ]);

      const result = await controller.getGuestProfile(managerScope, 'guest-1');

      expect(result.checks[0].menuItems).toEqual([]);
    });
  });

  describe('upsertGuest', () => {
    it('rejects a blank guest name', async () => {
      const { controller } = makeController();
      await expect(controller.upsertGuest(managerScope, { fullName: '   ' } as any)).rejects.toThrow(
        'Guest name is required',
      );
    });

    it('creates a new guest scoped to the venue with cleaned, deduped tags', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.upsertGuest(managerScope, {
        fullName: '  New Guest  ',
        email: 'New@Example.com',
        tags: [' vip ', 'vip', 'regular', ''],
      } as any);

      expect(prisma.guest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          venueId: 'venue-1',
          fullName: 'New Guest',
          nameLower: 'new guest',
          email: 'new@example.com',
          marketingOptIn: false,
          tags: ['vip', 'regular'],
        }),
      });
      expect(result).toEqual({ id: 'guest-new' });
    });

    it('caps tags at 12 entries', async () => {
      const { controller, prisma } = makeController();
      const tags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);

      await controller.upsertGuest(managerScope, { fullName: 'Tag Guest', tags } as any);

      const data = prisma.guest.create.mock.calls[0][0].data;
      expect(data.tags).toHaveLength(12);
    });

    it('rejects updating a guest that does not exist in this venue', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findFirst.mockResolvedValue(null);

      await expect(
        controller.upsertGuest(managerScope, { guestId: 'missing-guest', fullName: 'Ghost' } as any),
      ).rejects.toThrow('Guest not found');
    });

    it('updates an existing guest scoped by venue when guestId is given', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findFirst.mockResolvedValue(makeGuestRow({ id: 'guest-1' }));
      prisma.guest.update.mockResolvedValue({ id: 'guest-1' });

      const result = await controller.upsertGuest(managerScope, {
        guestId: 'guest-1',
        fullName: 'Updated Name',
      } as any);

      expect(prisma.guest.findFirst).toHaveBeenCalledWith({ where: { id: 'guest-1', venueId: 'venue-1' } });
      expect(prisma.guest.update).toHaveBeenCalledWith({
        where: { id: 'guest-1' },
        data: expect.objectContaining({ fullName: 'Updated Name' }),
      });
      expect(result).toEqual({ id: 'guest-1' });
    });
  });

  describe('removeGuest', () => {
    it('rejects removing a guest that does not exist in this venue', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findFirst.mockResolvedValue(null);

      await expect(controller.removeGuest(managerScope, 'missing-guest')).rejects.toThrow('Guest not found');
    });

    it('soft-deletes a guest scoped to the venue', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findFirst.mockResolvedValue(makeGuestRow({ id: 'guest-1' }));

      const result = await controller.removeGuest(managerScope, 'guest-1');

      expect(prisma.guest.findFirst).toHaveBeenCalledWith({ where: { id: 'guest-1', venueId: 'venue-1' } });
      expect(prisma.guest.update).toHaveBeenCalledWith({
        where: { id: 'guest-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result).toEqual({ ok: true });
    });
  });

  describe('ingestLeads / lead ingestion logic', () => {
    it('creates a new lead guest when no existing match is found', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findMany.mockResolvedValue([]);
      prisma.guest.create.mockResolvedValue({ id: 'guest-new', email: 'new@x.com', phone: null, nameLower: 'new lead' });

      const result = await controller.ingestLeads(managerScope, {
        leads: [{ fullName: 'New Lead', email: 'New@X.com', tags: ['vip'] }],
      } as any);

      expect(prisma.guest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ venueId: 'venue-1', deletedAt: null }) }),
      );
      expect(prisma.guest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          venueId: 'venue-1',
          fullName: 'New Lead',
          email: 'new@x.com',
          lifecycleStage: 'lead',
          tags: ['vip', 'lead'],
        }),
      });
      expect(result).toEqual({ created: 1, updated: 0, skipped: 0, guestIds: ['guest-new'] });
    });

    it('updates and merges tags for an existing guest matched by email', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findMany.mockResolvedValue([
        {
          id: 'guest-1',
          email: 'match@x.com',
          phone: null,
          nameLower: 'existing name',
          tags: ['loyal'],
          lifecycleStage: 'regular',
          source: 'walkin',
        },
      ]);

      const result = await controller.ingestLeads(managerScope, {
        leads: [{ fullName: 'Existing Name', email: 'match@x.com', tags: ['vip'] }],
      } as any);

      expect(prisma.guest.update).toHaveBeenCalledWith({
        where: { id: 'guest-1' },
        data: expect.objectContaining({
          fullName: 'Existing Name',
          lifecycleStage: 'regular',
          source: 'walkin',
          tags: expect.arrayContaining(['loyal', 'vip', 'lead']),
        }),
      });
      expect(result).toEqual({ created: 0, updated: 1, skipped: 0, guestIds: ['guest-1'] });
    });

    it('dedupes leads within the same batch that share an email', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findMany.mockResolvedValue([]);
      prisma.guest.create.mockResolvedValue({ id: 'guest-new', email: 'dup@x.com', phone: null, nameLower: 'a' });

      const result = await controller.ingestLeads(managerScope, {
        leads: [
          { fullName: 'A', email: 'dup@x.com' },
          { fullName: 'B', email: 'dup@x.com' },
        ],
      } as any);

      expect(prisma.guest.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ created: 1, updated: 0, skipped: 1, guestIds: ['guest-new'] });
    });

    it('skips leads with a blank name after trimming', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findMany.mockResolvedValue([]);
      prisma.guest.create.mockResolvedValue({ id: 'guest-new', email: null, phone: null, nameLower: 'valid lead' });

      const result = await controller.ingestLeads(managerScope, {
        leads: [{ fullName: '   ' }, { fullName: 'Valid Lead' }],
      } as any);

      expect(prisma.guest.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ created: 1, updated: 0, skipped: 1, guestIds: ['guest-new'] });
    });

    it('returns zero counts for an empty leads batch', async () => {
      const { controller } = makeController();

      const result = await controller.ingestLeads(managerScope, { leads: [] } as any);

      expect(result).toEqual({ created: 0, updated: 0, skipped: 0, guestIds: [] });
    });
  });

  describe('leadsWebhook', () => {
    it('verifies the webhook secret before touching the rate limiter', async () => {
      const { controller, prisma } = makeController();
      prisma.venue.findUnique.mockResolvedValue(null);

      await expect(
        controller.leadsWebhook(makeRequest(), 'venue-1', 'secret', { leads: [] } as any),
      ).rejects.toThrow(UnauthorizedException);

      // An unauthenticated spray of random venueIds must not churn buckets.
      expect(assertWithinSharedRateLimit).not.toHaveBeenCalled();
    });

    it('applies a per-venue, per-IP rate limit once the secret is verified', async () => {
      const { controller, prisma } = makeController();
      prisma.venue.findUnique.mockResolvedValue({ leadsWebhookSecret: hashWebhookSecret('secret') });

      await controller.leadsWebhook(makeRequest(), 'venue-1', 'secret', { leads: [] } as any);

      expect(assertWithinSharedRateLimit).toHaveBeenCalledWith(
        prisma,
        'leads-webhook:venue-1:203.0.113.5',
        120,
        60_000,
        'Too many webhook requests.',
      );
    });

    it('rejects when the venue has no webhook secret configured', async () => {
      const { controller, prisma } = makeController();
      prisma.venue.findUnique.mockResolvedValue({ leadsWebhookSecret: null });

      await expect(
        controller.leadsWebhook(makeRequest(), 'venue-1', 'any-secret', { leads: [] } as any),
      ).rejects.toThrow('Invalid webhook secret');
    });

    it('rejects a webhook secret that does not match the stored hash', async () => {
      const { controller, prisma } = makeController();
      const { hashedSecret } = generateWebhookSecret();
      prisma.venue.findUnique.mockResolvedValue({ leadsWebhookSecret: hashedSecret });

      await expect(
        controller.leadsWebhook(makeRequest(), 'venue-1', 'wrong-secret', { leads: [] } as any),
      ).rejects.toThrow('Invalid webhook secret');
    });

    it('ingests leads scoped to the venue in the URL when the secret matches', async () => {
      const { controller, prisma } = makeController();
      const { secret, hashedSecret } = generateWebhookSecret();
      prisma.venue.findUnique.mockResolvedValue({ leadsWebhookSecret: hashedSecret });
      prisma.guest.findMany.mockResolvedValue([]);
      prisma.guest.create.mockResolvedValue({ id: 'guest-new', email: 'lead@x.com', phone: null, nameLower: 'web lead' });

      const result = await controller.leadsWebhook(makeRequest(), 'venue-1', secret, {
        leads: [{ fullName: 'Web Lead', email: 'lead@x.com' }],
      } as any);

      expect(prisma.guest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ venueId: 'venue-1' }) }),
      );
      expect(result).toEqual({ created: 1, updated: 0, skipped: 0, guestIds: ['guest-new'] });
    });
  });

  describe('rotateLeadsWebhookSecret', () => {
    it('persists a hashed secret scoped to the venue and returns the plaintext once', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.rotateLeadsWebhookSecret(managerScope);

      expect(prisma.venue.update).toHaveBeenCalledWith({
        where: { id: 'venue-1' },
        data: { leadsWebhookSecret: expect.stringMatching(/^sha256:/) },
      });
      expect(result.webhookSecret).toEqual(expect.any(String));
      expect(result.webhookSecret).not.toMatch(/^sha256:/);
    });
  });
});
