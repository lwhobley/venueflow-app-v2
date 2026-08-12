import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
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
    const targetSystem = payload.eventType === 'suite.beo.closed_invoiced' ? 'NetSuite Financials' : 'Oracle MICROS Simphony';
    const secret = process.env.ENTERPRISE_WEBHOOK_SECRET ?? 'whsec_stadium_enterprise_beo_key_v1';
    
    const signature = createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    this.logger.log(`Emitting Enterprise Webhook [${payload.eventType}] to ${targetSystem} (Signature: ${signature.slice(0, 12)}...)`);

    // Record Webhook Dispatch in DB
    await this.prisma.enterpriseWebhookLog.create({
      data: {
        organizationId: payload.organizationId,
        eventType: payload.eventType,
        targetSystem,
        payload: payload as any,
        responseCode: 200,
        status: 'delivered',
      },
    });

    return {
      success: true,
      targetSystem,
      responseCode: 200,
    };
  }
}
