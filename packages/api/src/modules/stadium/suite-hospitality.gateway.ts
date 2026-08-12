import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

@Injectable()
export class SuiteHospitalityGateway {
  private readonly logger = new Logger(SuiteHospitalityGateway.name);
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  on(event: string, listener: (...args: any[]) => void) {
    this.emitter.on(event, listener);
  }

  off(event: string, listener: (...args: any[]) => void) {
    this.emitter.off(event, listener);
  }

  broadcastBeoUpdate(facilityId: string, zoneId: string, beoOrder: Record<string, unknown>) {
    const payload = { event: 'suite_beo_updated', data: beoOrder, timestamp: new Date().toISOString() };
    this.emitter.emit(`zone:${zoneId}`, payload);
    this.emitter.emit(`facility:${facilityId}`, payload);
    this.emitter.emit('global', payload);
    this.logger.log(`Broadcasted suite_beo_updated for BEO ${(beoOrder as any).beoNumber} to zone:${zoneId}`);
  }

  broadcastReplenishment(facilityId: string, zoneId: string, replenishment: Record<string, unknown>) {
    const payload = { event: 'replenishment_requested', data: replenishment, timestamp: new Date().toISOString() };
    this.emitter.emit(`zone:${zoneId}`, payload);
    this.emitter.emit(`facility:${facilityId}`, payload);
    this.emitter.emit('global', payload);
    this.logger.log(`Broadcasted replenishment_requested to zone:${zoneId}`);
  }
}
