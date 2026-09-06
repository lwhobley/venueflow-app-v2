import { describe, expect, it, vi } from 'vitest';
import { StadiumController } from './stadium.controller';

describe('closeout append-only checkpoints', () => {
  it('saves drafts repeatedly, appends finalization, and never updates a revision', async () => {
    let closeout: any = null;
    const revisions: any[] = [];
    const tx: any = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      venueEvent: { findFirst: vi.fn().mockResolvedValue({ id: 'event' }) },
      venue: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'venue', organizationId: 'org' }) },
      facility: { findUnique: vi.fn().mockResolvedValue({ id: 'venue' }), create: vi.fn() },
      eventCloseout: {
        findUnique: vi.fn(async () => closeout),
        findUniqueOrThrow: vi.fn(async () => ({ ...closeout, revisions })),
        upsert: vi.fn(async ({ create, update }) => closeout = closeout ? { ...closeout, ...update } : { id: 'closeout', ...create }),
      },
      eventCloseoutRevision: {
        findFirst: vi.fn(async () => revisions.at(-1) ?? null),
        create: vi.fn(async ({ data }) => { const row = { id: `r${data.version}`, ...data }; revisions.push(row); return row; }),
        update: vi.fn(() => { throw new Error('Immutable ledger'); }),
      },
      eventAuditLog: { create: vi.fn() },
    };
    tx.$transaction = (fn: any) => fn(tx);
    const controller = new StadiumController(tx);
    const scope: any = { venueId: 'venue', profileId: 'profile', role: 'organization_admin', allAccess: true };
    await controller.upsertEventCloseout(scope, 'event', { actualSalesCents: 100 });
    await controller.upsertEventCloseout(scope, 'event', { actualSalesCents: 200 });
    await controller.upsertEventCloseout(scope, 'event', { status: 'finalized' });
    expect(revisions.map((r) => r.version)).toEqual([1, 2, 3]);
    expect(revisions[1].parentRevisionId).toBe('r1');
    expect(revisions[2].parentRevisionId).toBe('r2');
    expect(revisions[0].actualSalesCents).toBe(100);
    expect(closeout.currentVersion).toBe(3);
    expect(tx.eventCloseoutRevision.update).not.toHaveBeenCalled();
    await expect(controller.upsertEventCloseout(scope, 'event', { actualSalesCents: 300 })).rejects.toThrow('immutable revisions');
  });
});
