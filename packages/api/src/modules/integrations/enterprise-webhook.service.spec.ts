import { describe, expect, it, vi } from 'vitest';
import { EnterpriseWebhookService } from './enterprise-webhook.service';

describe('EnterpriseWebhookService', () => {
  it('records a manual export without claiming an unconfigured provider delivered it', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'log-1' });
    const service = new EnterpriseWebhookService({ enterpriseWebhookLog: { create } } as any);
    const result = await service.emitSuiteBeoWebhook({
      eventId: 'event-1',
      eventType: 'suite.beo.confirmed',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      beoNumber: 'BEO-1',
      subVenueId: 'suite-1',
      totalCents: 12500,
      lineItems: [],
      timestamp: new Date().toISOString(),
    });

    expect(result).toEqual({ success: false, targetSystem: 'manual_csv_export', responseCode: 0 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending_manual_export', responseCode: 0 }),
    }));
  });
});
