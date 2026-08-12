import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface EnterpriseWebhookPayload {
  eventId: string;
  eventType: 'suite.beo.confirmed' | 'suite.beo.closed_invoiced';
  organizationId: string;
  facilityId: string;
  beoNumber: string;
  subVenueId: string;
  totalCents: number;
  lineItems: Record<string, unknown>[];
  timestamp: string;
}

@Injectable()
export class EnterpriseWebhookService {
  private readonly logger = new Logger(EnterpriseWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  async emitSuiteBeoWebhook(payload: EnterpriseWebhookPayload): Promise<{ success: boolean; targetSystem: string; responseCode: number }> {
    // Provider integrations are intentionally not fabricated. Until an
    // authenticated adapter exists, retain an auditable manual-export record.
    const targetSystem = 'manual_csv_export';
    this.logger.warn(`Queued ${payload.eventType} for manual enterprise export; no provider adapter is configured.`);

    await this.prisma.enterpriseWebhookLog.create({
      data: {
        organizationId: payload.organizationId,
        eventType: payload.eventType,
        targetSystem,
        payload: payload as any,
        responseCode: 0,
        status: 'pending_manual_export',
      },
    });

    return {
      success: false,
      targetSystem,
      responseCode: 0,
    };
  }
}
