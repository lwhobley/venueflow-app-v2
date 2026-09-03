import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

function makeController() {
  const prisma = {
    crmLead: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'lead-new', ...data })),
      update: vi.fn().mockResolvedValue({}),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    crmNote: {
      create: vi.fn().mockResolvedValue({ id: 'note-1' }),
    },
    crmBeo: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'beo-new', ...data })),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'beo-1', ...data })),
    },
    crmContract: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'contract-new', ...data })),
      update: vi.fn().mockResolvedValue({}),
    },
    crmActivityLog: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    profile: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    venue: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Test Venue' }),
    },
    emailTemplate: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'template-new', ...data })),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'template-1', ...data })),
      delete: vi.fn().mockResolvedValue({}),
    },
    reservationHold: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    reservation: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'reservation-new' }),
      update: vi.fn().mockResolvedValue({ id: 'reservation-existing' }),
    },
    $transaction: vi.fn().mockImplementation((arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    ),
  } as any;

  const email = { sendOrThrow: vi.fn().mockResolvedValue(undefined) };
  const templates = { renderTemplate: vi.fn().mockResolvedValue({ subject: 'Hi', body: 'Body' }) };
  const executionAutopilot = { ensureWorkspace: vi.fn().mockResolvedValue({ id: 'workspace-1' }) };

  const controller = new CrmController(prisma, email as any, templates as any, executionAutopilot as any);
  return { controller, prisma, email, templates, executionAutopilot };
}

const managerScope = { venueId: 'venue-1', profileId: 'manager-1', role: 'manager', allAccess: false } as any;
const staffScope = { venueId: 'venue-1', profileId: 'staff-1', role: 'staff', allAccess: false } as any;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('CrmController', () => {
  // ============================================================
  // Authorization: every endpoint uses the same requireManager()
  // guard. We verify rejection across a spread of endpoints (list,
  // write, aggregate) plus the "no scope" case; success-through-the-
  // guard is exercised implicitly by every other test using managerScope.
  // ============================================================
  describe('authorization', () => {
    it('rejects staff from listing leads', async () => {
      const { controller } = makeController();
      await expect(controller.listLeads(staffScope, {})).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from creating a lead', async () => {
      const { controller } = makeController();
      await expect(controller.saveLead(staffScope, { fullName: 'Jo' } as any)).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from saving a BEO', async () => {
      const { controller } = makeController();
      await expect(controller.saveBeo(staffScope, { eventName: 'Party' } as any)).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from the pipeline forecast', async () => {
      const { controller } = makeController();
      await expect(controller.getPipelineForecast(staffScope)).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from deleting a template', async () => {
      const { controller } = makeController();
      await expect(controller.deleteTemplate(staffScope, 'tpl-1')).rejects.toThrow(ForbiddenException);
    });

    it('rejects a missing scope', async () => {
      const { controller } = makeController();
      await expect(controller.listLeads(undefined as any, {})).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================
  // Leads
  // ============================================================
  describe('listLeads', () => {
    it('scopes the query to the venue and excludes soft-deleted leads', async () => {
      const { controller, prisma } = makeController();

      await controller.listLeads(managerScope, {});

      expect(prisma.crmLead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { venueId: 'venue-1', deletedAt: null } }),
      );
    });

    it('adds an OR search filter across name, company, email, phone and tags', async () => {
      const { controller, prisma } = makeController();

      await controller.listLeads(managerScope, { search: '  Acme  ' } as any);

      expect(prisma.crmLead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { fullName: { contains: 'Acme', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });

    it('clamps the page size to a maximum of 200', async () => {
      const { controller, prisma } = makeController();

      await controller.listLeads(managerScope, { limit: 5000 } as any);

      expect(prisma.crmLead.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
    });

    it('resolves assignee names for leads with an assignedToId', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findMany.mockResolvedValue([
        {
          id: 'lead-1', venueId: 'venue-1', fullName: 'Jo Diner', email: null, phone: null, company: null,
          source: null, status: 'new', tags: [], assignedToId: 'staff-1', estimatedValueCents: null,
          lastActivityAt: null, createdAt: new Date(), updatedAt: new Date(),
        },
      ]);
      prisma.crmLead.count.mockResolvedValue(1);
      prisma.profile.findMany.mockResolvedValue([{ id: 'staff-1', fullName: 'Alex Server' }]);

      const result = await controller.listLeads(managerScope, {});

      expect(prisma.profile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['staff-1'] } } }),
      );
      expect(result.leads[0]).toEqual(expect.objectContaining({ assignedToId: 'staff-1', assignedToName: 'Alex Server' }));
      expect(result.totalCount).toBe(1);
    });

    it('skips the profile lookup when no leads have an assignee', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findMany.mockResolvedValue([
        {
          id: 'lead-1', venueId: 'venue-1', fullName: 'Jo Diner', email: null, phone: null, company: null,
          source: null, status: 'new', tags: [], assignedToId: null, estimatedValueCents: null,
          lastActivityAt: null, createdAt: new Date(), updatedAt: new Date(),
        },
      ]);

      await controller.listLeads(managerScope, {});

      expect(prisma.profile.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getLead', () => {
    it('throws NotFoundException when the lead does not exist in the venue', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findFirst.mockResolvedValue(null);

      await expect(controller.getLead(managerScope, 'lead-1')).rejects.toThrow(NotFoundException);
      expect(prisma.crmLead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lead-1', venueId: 'venue-1', deletedAt: null } }),
      );
    });

    it('returns the lead with mapped notes, beos and contracts', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findFirst.mockResolvedValue({
        id: 'lead-1', venueId: 'venue-1', fullName: 'Jo Diner', email: null, phone: null, company: null,
        source: null, status: 'new', tags: [], assignedToId: null, estimatedValueCents: null,
        lastActivityAt: null, createdAt: new Date(), updatedAt: new Date(),
        notes: [{ id: 'note-1', text: 'Called', authorId: 'manager-1', author: { fullName: 'Manager One' }, createdAt: new Date() }],
        beos: [], contracts: [],
      });

      const result = await controller.getLead(managerScope, 'lead-1');

      expect(result.lead.id).toBe('lead-1');
      expect(result.notes[0]).toEqual(expect.objectContaining({ text: 'Called', authorName: 'Manager One' }));
    });

    it('falls back to "Former Staff" when the note author was deleted', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findFirst.mockResolvedValue({
        id: 'lead-1', venueId: 'venue-1', fullName: 'Jo Diner', email: null, phone: null, company: null,
        source: null, status: 'new', tags: [], assignedToId: null, estimatedValueCents: null,
        lastActivityAt: null, createdAt: new Date(), updatedAt: new Date(),
        notes: [{ id: 'note-1', text: 'Called', authorId: null, author: null, createdAt: new Date() }],
        beos: [], contracts: [],
      });

      const result = await controller.getLead(managerScope, 'lead-1');

      expect(result.notes[0].authorName).toBe('Former Staff');
    });
  });

  describe('saveLead', () => {
    it('rejects an assignee that is not an active member of the venue', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findFirst.mockResolvedValue(null);

      await expect(
        controller.saveLead(managerScope, { fullName: 'Jo Diner', assignedToId: 'other-venue-profile' } as any),
      ).rejects.toThrow('Lead assignee must be an active member of this venue.');
      expect(prisma.crmLead.create).not.toHaveBeenCalled();
    });

    it('persists a validated venue assignee', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findFirst.mockResolvedValue({ id: 'staff-1' });

      await controller.saveLead(managerScope, { fullName: 'Jo Diner', assignedToId: 'staff-1' } as any);

      expect(prisma.profile.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'staff-1',
          venueId: 'venue-1',
          OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
        },
        select: { id: true },
      });
      expect(prisma.crmLead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assignedToId: 'staff-1' }) }),
      );
    });
    it('throws NotFoundException when updating a lead outside the venue', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findFirst.mockResolvedValue(null);

      await expect(controller.saveLead(managerScope, { leadId: 'lead-1', fullName: 'Jo' } as any))
        .rejects.toThrow(NotFoundException);
    });

    it('creates a new lead defaulting status to "new" and logs a lead_created activity', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.saveLead(managerScope, { fullName: 'Jo Diner', source: 'Instagram' } as any);

      expect(prisma.crmLead.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ venueId: 'venue-1', fullName: 'Jo Diner', status: 'new', tags: [] }),
      }));
      expect(prisma.crmActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ leadId: 'lead-new', kind: 'lead_created', detail: 'Source: Instagram' }),
      }));
      expect(result).toEqual({ leadId: 'lead-new' });
    });

    it('logs a status_changed activity only when status actually changes', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findFirst.mockResolvedValue({ id: 'lead-1', venueId: 'venue-1', status: 'new' });

      await controller.saveLead(managerScope, { leadId: 'lead-1', fullName: 'Jo', status: 'qualified' } as any);

      expect(prisma.crmActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ kind: 'status_changed', detail: 'new -> qualified' }),
      }));
    });

    it('does not log an activity when the status is unchanged', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findFirst.mockResolvedValue({ id: 'lead-1', venueId: 'venue-1', status: 'qualified' });

      await controller.saveLead(managerScope, { leadId: 'lead-1', fullName: 'Jo', status: 'qualified' } as any);

      expect(prisma.crmActivityLog.create).not.toHaveBeenCalled();
    });

    it('does not let a failing activity log block lead creation (best-effort)', async () => {
      const { controller, prisma } = makeController();
      prisma.crmActivityLog.create.mockRejectedValue(new Error('db down'));

      const result = await controller.saveLead(managerScope, { fullName: 'Jo Diner' } as any);

      expect(result).toEqual({ leadId: 'lead-new' });
    });
  });

  describe('addNote', () => {
    it('throws NotFoundException for a lead outside the venue', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findFirst.mockResolvedValue(null);

      await expect(controller.addNote(managerScope, 'lead-1', { text: 'Hi' })).rejects.toThrow(NotFoundException);
    });

    it('rejects blank note text', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findFirst.mockResolvedValue({ id: 'lead-1' });

      await expect(controller.addNote(managerScope, 'lead-1', { text: '   ' })).rejects.toThrow(BadRequestException);
      expect(prisma.crmNote.create).not.toHaveBeenCalled();
    });

    it('creates the note, bumps lastActivityAt, and logs a truncated activity entry', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findFirst.mockResolvedValue({ id: 'lead-1' });
      const longText = 'x'.repeat(200);

      const result = await controller.addNote(managerScope, 'lead-1', { text: longText });

      expect(prisma.crmNote.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ venueId: 'venue-1', leadId: 'lead-1', authorId: 'manager-1', text: longText }),
      }));
      expect(prisma.crmLead.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'lead-1' },
        data: expect.objectContaining({ lastActivityAt: expect.any(Date) }),
      }));
      expect(prisma.crmActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ kind: 'note_added', detail: longText.slice(0, 120) }),
      }));
      expect(result).toEqual({ noteId: 'note-1' });
    });
  });

  // ============================================================
  // BEOs
  // ============================================================
  describe('listBeos', () => {
    it('scopes to the venue and enriches with the lead name', async () => {
      const { controller, prisma } = makeController();
      prisma.crmBeo.findMany.mockResolvedValue([
        {
          id: 'beo-1', venueId: 'venue-1', leadId: 'lead-1', eventName: 'Wedding', eventDate: null, eventType: null,
          guestCount: null, venueSpace: null, setupStyle: null, fbMinimumCents: null, depositCents: null,
          depositDueDate: null, menuAppetizers: null, menuEntrees: null, menuDesserts: null, menuBarPackage: null,
          specialRequirements: null, internalNotes: null, assignedRepId: null, status: 'draft',
          createdAt: new Date(), updatedAt: new Date(), lead: { fullName: 'Jo Diner' },
        },
      ]);

      const result = await controller.listBeos(managerScope, {});

      expect(prisma.crmBeo.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { venueId: 'venue-1' } }));
      expect(result[0]).toEqual(expect.objectContaining({ leadName: 'Jo Diner' }));
    });
  });

  describe('saveBeo', () => {
    it('throws NotFoundException when the referenced lead is outside the venue', async () => {
      const { controller } = makeController();

      await expect(controller.saveBeo(managerScope, { leadId: 'lead-1', eventName: 'Party' } as any))
        .rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when updating a BEO outside the venue', async () => {
      const { controller } = makeController();

      await expect(controller.saveBeo(managerScope, { beoId: 'beo-1', eventName: 'Party' } as any))
        .rejects.toThrow(NotFoundException);
    });

    it('creates a draft BEO without syncing a reservation', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.saveBeo(managerScope, { eventName: 'Tasting' } as any);

      expect(prisma.crmBeo.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ venueId: 'venue-1', status: 'draft', eventName: 'Tasting' }),
      }));
      expect(prisma.reservation.create).not.toHaveBeenCalled();
      expect(result).toEqual({ beoId: 'beo-new' });
    });

    it('syncs a confirmed BEO with an event date to a new blocking reservation', async () => {
      const { controller, prisma, executionAutopilot } = makeController();
      const eventDate = Date.parse('2026-08-01T18:00:00.000Z');

      const result = await controller.saveBeo(managerScope, {
        eventName: 'Gala', eventDate, guestCount: 80, venueSpace: 'Ballroom', status: 'confirmed',
      } as any);

      expect(prisma.reservation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          venueId: 'venue-1', guestName: 'Gala', partySize: 80, durationMinutes: 240,
          isPrivateEvent: true, status: 'confirmed', tags: [`beo:beo-new`, 'private_event'],
        }),
      }));
      expect(executionAutopilot.ensureWorkspace).toHaveBeenCalledWith(expect.objectContaining({
        venueId: 'venue-1', sourceType: 'beo', sourceId: 'beo-new', title: 'Gala',
      }), prisma);
      expect(result).toEqual({ beoId: 'beo-new' });
    });

    it('updates the existing reservation instead of creating a duplicate when one already exists for the BEO', async () => {
      const { controller, prisma } = makeController();
      prisma.reservation.findFirst.mockResolvedValue({ id: 'reservation-existing' });
      const eventDate = Date.parse('2026-08-01T18:00:00.000Z');

      await controller.saveBeo(managerScope, { eventName: 'Gala', eventDate, status: 'confirmed' } as any);

      expect(prisma.reservation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'reservation-existing' } }));
      expect(prisma.reservation.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException and does not create a reservation when a hold conflicts with the event window', async () => {
      const { controller, prisma } = makeController();
      prisma.reservationHold.findFirst.mockResolvedValue({ reason: 'Private buyout' });
      const eventDate = Date.parse('2026-08-01T18:00:00.000Z');

      await expect(controller.saveBeo(managerScope, { eventName: 'Gala', eventDate, status: 'confirmed' } as any))
        .rejects.toThrow('Cannot sync BEO to reservation - time conflicts with a hold: Private buyout');
      expect(prisma.reservation.create).not.toHaveBeenCalled();
    });

    it('logs beo_status_changed and re-syncs the reservation when an existing BEO transitions to confirmed', async () => {
      const { controller, prisma } = makeController();
      const eventDate = Date.parse('2026-08-01T18:00:00.000Z');
      prisma.crmBeo.findFirst.mockResolvedValue({
        id: 'beo-1', leadId: 'lead-1', status: 'draft', eventName: 'Gala', eventDate: new Date(eventDate),
      });

      await controller.saveBeo(managerScope, { beoId: 'beo-1', eventName: 'Gala', eventDate, status: 'confirmed' } as any);

      expect(prisma.crmActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ leadId: 'lead-1', kind: 'beo_status_changed', detail: 'draft -> confirmed' }),
      }));
      expect(prisma.reservation.create).toHaveBeenCalled();
    });

    it('does not re-sync an already-confirmed BEO when no reservation-relevant field changed', async () => {
      const { controller, prisma } = makeController();
      const eventDate = Date.parse('2026-08-01T18:00:00.000Z');
      prisma.crmBeo.findFirst.mockResolvedValue({
        id: 'beo-1', leadId: 'lead-1', status: 'confirmed', eventName: 'Gala', eventDate: new Date(eventDate),
      });

      await controller.saveBeo(managerScope, { beoId: 'beo-1', internalNotes: 'vip guest' } as any);

      expect(prisma.reservation.create).not.toHaveBeenCalled();
      expect(prisma.reservation.update).not.toHaveBeenCalled();
    });
  });

  describe('convertBeoToContract', () => {
    it('throws NotFoundException when the BEO is outside the venue', async () => {
      const { controller } = makeController();

      await expect(controller.convertBeoToContract(managerScope, 'beo-1')).rejects.toThrow(NotFoundException);
    });

    it('creates a draft contract with a formatted contract number and a deposit payment schedule', async () => {
      const { controller, prisma } = makeController();
      prisma.crmBeo.findFirst.mockResolvedValue({
        id: 'beo-1', leadId: 'lead-1', eventName: 'Gala', eventDate: new Date('2026-08-01T18:00:00.000Z'),
        guestCount: 80, venueSpace: 'Ballroom', fbMinimumCents: 500000, depositCents: 100000, depositDueDate: null,
      });

      const result = await controller.convertBeoToContract(managerScope, 'beo-1');

      expect(prisma.crmContract.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          venueId: 'venue-1', leadId: 'lead-1', beoId: 'beo-1', status: 'draft',
          contractNumber: expect.stringMatching(/^C-[0-9A-F]{9}$/),
          paymentSchedule: [expect.objectContaining({ amountCents: 100000, type: 'deposit' })],
        }),
      }));
      expect(result).toEqual({ contractId: 'contract-new' });
    });

    it('leaves the payment schedule empty when the BEO has no deposit', async () => {
      const { controller, prisma } = makeController();
      prisma.crmBeo.findFirst.mockResolvedValue({
        id: 'beo-1', leadId: null, eventName: 'Gala', eventDate: null, guestCount: null, venueSpace: null,
        fbMinimumCents: null, depositCents: null, depositDueDate: null,
      });

      await controller.convertBeoToContract(managerScope, 'beo-1');

      expect(prisma.crmContract.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ paymentSchedule: [] }),
      }));
    });
  });

  // ============================================================
  // Contracts
  // ============================================================
  describe('listContracts', () => {
    it('scopes to the venue and enriches with the lead name', async () => {
      const { controller, prisma } = makeController();
      prisma.crmContract.findMany.mockResolvedValue([
        {
          id: 'contract-1', venueId: 'venue-1', leadId: 'lead-1', beoId: null, contractNumber: 'C-ABC',
          contractDate: new Date(), eventName: 'Gala', eventDate: null, guestCount: null, venueSpace: null,
          fbMinimumCents: null, paymentSchedule: [], cancellationPolicy: null, forceMajeure: false,
          liabilityWaiver: false, customClauses: [], clientSignatureName: null, clientSignatureDate: null,
          status: 'draft', createdAt: new Date(), updatedAt: new Date(), lead: { fullName: 'Jo Diner' },
        },
      ]);

      const result = await controller.listContracts(managerScope, {});

      expect(prisma.crmContract.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { venueId: 'venue-1' } }));
      expect(result[0]).toEqual(expect.objectContaining({ leadName: 'Jo Diner' }));
    });
  });

  describe('saveContract', () => {
    it('throws NotFoundException when the referenced lead is outside the venue', async () => {
      const { controller } = makeController();

      await expect(controller.saveContract(managerScope, { leadId: 'lead-1' } as any)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the referenced BEO is outside the venue', async () => {
      const { controller } = makeController();

      await expect(controller.saveContract(managerScope, { beoId: 'beo-1' } as any)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when updating a contract outside the venue', async () => {
      const { controller } = makeController();

      await expect(controller.saveContract(managerScope, { contractId: 'contract-1' } as any)).rejects.toThrow(NotFoundException);
    });

    it('creates a new contract and bumps the lead activity timestamp', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findFirst.mockResolvedValue({ id: 'lead-1' });

      const result = await controller.saveContract(managerScope, { leadId: 'lead-1', eventName: 'Gala' } as any);

      expect(prisma.crmContract.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ venueId: 'venue-1', leadId: 'lead-1', status: 'draft' }),
      }));
      expect(prisma.crmLead.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'lead-1' } }));
      expect(result).toEqual({ contractId: 'contract-new' });
    });

    it('patches only the provided fields on an existing contract', async () => {
      const { controller, prisma } = makeController();
      prisma.crmContract.findFirst.mockResolvedValue({ id: 'contract-1', venueId: 'venue-1' });

      const result = await controller.saveContract(managerScope, { contractId: 'contract-1', status: 'sent' } as any);

      expect(prisma.crmContract.update).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
        data: expect.objectContaining({ status: 'sent' }),
      });
      expect(result).toEqual({ contractId: 'contract-1' });
    });
  });

  // ============================================================
  // Analytics
  // ============================================================
  describe('getPipelineForecast', () => {
    it('weights pipeline value by stage probability and totals won revenue separately', async () => {
      const { controller, prisma } = makeController();
      // Aggregation now happens in Postgres via groupBy, so the mock returns
      // pre-aggregated per-status rows rather than individual lead records.
      prisma.crmLead.groupBy.mockResolvedValue([
        { status: 'qualified', _count: { _all: 1 }, _sum: { estimatedValueCents: 10000 } },
        { status: 'won', _count: { _all: 1 }, _sum: { estimatedValueCents: 5000 } },
        { status: 'lost', _count: { _all: 1 }, _sum: { estimatedValueCents: 2000 } },
      ]);

      const result = await controller.getPipelineForecast(managerScope);

      expect(prisma.crmLead.groupBy).toHaveBeenCalledWith(expect.objectContaining({
        by: ['status'],
        where: { venueId: 'venue-1', deletedAt: null },
      }));
      expect(result.byStage).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: 'qualified', probability: 0.3, count: 1, rawValueCents: 10000, weightedValueCents: 3000 }),
        expect.objectContaining({ stage: 'won', probability: 1, weightedValueCents: 5000 }),
        expect.objectContaining({ stage: 'lost', probability: 0, weightedValueCents: 0 }),
      ]));
      expect(result.totals).toEqual({
        leadCount: 3, rawValueCents: 17000, weightedValueCents: 8000, wonCount: 1, wonValueCents: 5000,
      });
    });
  });

  describe('getSourceRoi', () => {
    it('computes win rate and sorts sources by won revenue descending', async () => {
      const { controller, prisma } = makeController();
      // Aggregation now happens in Postgres via groupBy(source, status), so
      // the mock returns pre-aggregated per-(source,status) rows.
      prisma.crmLead.groupBy.mockResolvedValue([
        { source: 'Instagram', status: 'won', _count: { _all: 1 }, _sum: { estimatedValueCents: 3000 } },
        { source: 'Instagram', status: 'lost', _count: { _all: 1 }, _sum: { estimatedValueCents: 1000 } },
        { source: 'Referral', status: 'won', _count: { _all: 1 }, _sum: { estimatedValueCents: 8000 } },
        { source: null, status: 'new', _count: { _all: 1 }, _sum: { estimatedValueCents: 500 } },
      ]);

      const result = await controller.getSourceRoi(managerScope);

      expect(result[0]).toEqual(expect.objectContaining({ source: 'Referral', wonValueCents: 8000 }));
      const instagram = result.find((r) => r.source === 'Instagram')!;
      expect(instagram.winRate).toBe(0.5);
      expect(result.some((r) => r.source === '(unspecified)')).toBe(true);
    });
  });

  describe('getStaleLeads', () => {
    it('clamps the threshold between 1 and 60 days and filters to active stages', async () => {
      const { controller, prisma } = makeController();

      await controller.getStaleLeads(managerScope, '9999');

      expect(prisma.crmLead.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          venueId: 'venue-1',
          status: { in: ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiating'] },
        }),
      }));
    });

    it('defaults to 5 days when the query param is not a number', async () => {
      const { controller } = makeController();

      const result = await controller.getStaleLeads(managerScope, 'not-a-number');

      expect(result.thresholdDays).toBe(5);
    });
  });

  describe('getLeadActivity', () => {
    it('throws NotFoundException for a lead outside the venue', async () => {
      const { controller } = makeController();

      await expect(controller.getLeadActivity(managerScope, 'lead-1')).rejects.toThrow(NotFoundException);
    });

    it('resolves actor names for activity rows', async () => {
      const { controller, prisma } = makeController();
      prisma.crmLead.findFirst.mockResolvedValue({ id: 'lead-1' });
      prisma.crmActivityLog.findMany.mockResolvedValue([
        { id: 'act-1', kind: 'note_added', detail: 'Hi', actorId: 'manager-1', createdAt: new Date() },
      ]);
      prisma.profile.findMany.mockResolvedValue([{ id: 'manager-1', fullName: 'Manager One' }]);

      const result = await controller.getLeadActivity(managerScope, 'lead-1');

      expect(result[0]).toEqual(expect.objectContaining({ actorName: 'Manager One' }));
    });
  });

  // ============================================================
  // Email
  // ============================================================
  describe('emailBeo', () => {
    it('throws NotFoundException for a BEO outside the venue', async () => {
      const { controller } = makeController();

      await expect(controller.emailBeo(managerScope, 'beo-1', { toEmail: 'a@b.com' })).rejects.toThrow(NotFoundException);
    });

    it('sends the rendered BEO and logs an activity entry when the BEO has a lead', async () => {
      const { controller, prisma, email } = makeController();
      prisma.crmBeo.findFirst.mockResolvedValue({
        id: 'beo-1', leadId: 'lead-1', eventName: 'Gala', eventDate: null, eventType: null, guestCount: null,
        venueSpace: null, setupStyle: null, fbMinimumCents: null, depositCents: null, depositDueDate: null,
        menuAppetizers: null, menuEntrees: null, menuDesserts: null, menuBarPackage: null, specialRequirements: null,
        lead: { fullName: 'Jo Diner', email: 'jo@example.com' },
      });

      const result = await controller.emailBeo(managerScope, 'beo-1', { toEmail: 'jo@example.com', message: 'See attached' });

      expect(email.sendOrThrow).toHaveBeenCalledWith(expect.objectContaining({
        to: 'jo@example.com',
        subject: 'Test Venue - Banquet Event Order: Gala',
      }));
      expect(assertWithinSharedRateLimit).toHaveBeenNthCalledWith(
        1, prisma, 'crm-beo-email:manager:manager-1', 20, 15 * 60 * 1000, 'Too many BEO emails. Try again later.',
      );
      expect(assertWithinSharedRateLimit).toHaveBeenNthCalledWith(
        2, prisma, 'crm-beo-email:venue:venue-1', 100, 60 * 60 * 1000, 'This venue has sent too many BEO emails. Try again later.',
      );
      expect(prisma.crmActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ leadId: 'lead-1', kind: 'beo_emailed', detail: '-> jo@example.com' }),
      }));
      expect(result).toEqual({ ok: true });
    });

    it('does not log an activity when the BEO has no lead', async () => {
      const { controller, prisma } = makeController();
      prisma.crmBeo.findFirst.mockResolvedValue({
        id: 'beo-1', leadId: null, eventName: 'Gala', eventDate: null, eventType: null, guestCount: null,
        venueSpace: null, setupStyle: null, fbMinimumCents: null, depositCents: null, depositDueDate: null,
        menuAppetizers: null, menuEntrees: null, menuDesserts: null, menuBarPackage: null, specialRequirements: null,
        lead: null,
      });

      await controller.emailBeo(managerScope, 'beo-1', { toEmail: 'jo@example.com' });

      expect(prisma.crmActivityLog.create).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Email templates (representative coverage - listTemplates is a
  // trivial passthrough getter and is intentionally not covered here).
  // ============================================================
  describe('saveTemplate', () => {
    it('rejects a blank template name', async () => {
      const { controller, prisma } = makeController();

      await expect(controller.saveTemplate(managerScope, { name: '   ', subject: 'Hi', body: 'Body' } as any))
        .rejects.toThrow(BadRequestException);
      expect(prisma.emailTemplate.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when updating a template outside the venue', async () => {
      const { controller } = makeController();

      await expect(controller.saveTemplate(managerScope, { templateId: 'tpl-1', name: 'A', subject: 'Hi', body: 'Body' } as any))
        .rejects.toThrow(NotFoundException);
    });

    it('creates a new template scoped to the venue', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.saveTemplate(managerScope, { name: 'Welcome', subject: 'Hi', body: 'Body' } as any);

      expect(prisma.emailTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ venueId: 'venue-1', name: 'Welcome' }),
      }));
      expect(result).toEqual({ templateId: 'template-new' });
    });
  });

  describe('deleteTemplate', () => {
    it('throws NotFoundException for a template outside the venue', async () => {
      const { controller } = makeController();

      await expect(controller.deleteTemplate(managerScope, 'tpl-1')).rejects.toThrow(NotFoundException);
    });

    it('deletes an existing template', async () => {
      const { controller, prisma } = makeController();
      prisma.emailTemplate.findFirst.mockResolvedValue({ id: 'tpl-1' });

      const result = await controller.deleteTemplate(managerScope, 'tpl-1');

      expect(prisma.emailTemplate.delete).toHaveBeenCalledWith({ where: { id: 'tpl-1' } });
      expect(result).toEqual({ ok: true });
    });
  });

  describe('renderTemplate', () => {
    it('throws NotFoundException for a template outside the venue', async () => {
      const { controller } = makeController();

      await expect(controller.renderTemplate(managerScope, 'tpl-1', {})).rejects.toThrow(NotFoundException);
    });

    it('delegates rendering to the template service with venue/lead/beo context', async () => {
      const { controller, prisma, templates } = makeController();
      prisma.emailTemplate.findFirst.mockResolvedValue({ id: 'tpl-1', name: 'Welcome' });

      const result = await controller.renderTemplate(managerScope, 'tpl-1', { leadId: 'lead-1', beoId: 'beo-1' });

      expect(templates.renderTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tpl-1' }), 'venue-1', 'lead-1', 'beo-1',
      );
      expect(result).toEqual({ subject: 'Hi', body: 'Body' });
    });
  });
});
