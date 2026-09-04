import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VmsSyncSystem } from '@prisma/client';

export interface ShiftSupplyItem {
  sku: string;
  name: string;
  category: 'uniform' | 'equipment' | 'ppe' | 'cutlery' | 'disposable';
  allocatedQuantity: number;
  consumedQuantity: number;
  remainingStock: number;
  unitCostCents: number;
}

export interface InventorySyncResult {
  system: VmsSyncSystem;
  syncType: string;
  itemsSynced: number;
  status: 'success' | 'partial' | 'failed' | 'demo_mode';
  message: string;
  supplies: ShiftSupplyItem[];
}

export interface AdpPayrollRow {
  coCode: string;
  batchId: string;
  fileNumber: string;
  employeeName: string;
  earningsCode: 'REG' | 'OT' | 'DT' | 'MEAL_PENALTY';
  hours: number;
  rateCents: number;
  totalPayCents: number;
  shiftDate: string;
}

export interface GustoPayrollRecord {
  employeeId: string;
  employeeName: string;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  hourlyRate: number;
  grossPay: number;
  periodStart: string;
  periodEnd: string;
}

/** Live-sync transport tuning. */
const SYNC_TIMEOUT_MS = 5000;
const SYNC_MAX_ATTEMPTS = 2;
const SYNC_RETRY_DELAY_MS = 500;

const SUPPLY_CATEGORIES = ['uniform', 'equipment', 'ppe', 'cutlery', 'disposable'] as const;

@Injectable()
export class VmsIntegrationsService {
  private readonly logger = new Logger(VmsIntegrationsService.name);

  /**
   * Reads an inventory payload from a live sync response. Accepts either a bare
   * array or `{ items: [...] }`, and drops any entry that does not carry the
   * minimum a stock line needs, so a malformed remote row degrades to "not
   * imported" rather than to a zero-quantity phantom.
   */
  private async parseRemoteInventory(res: Response): Promise<ShiftSupplyItem[] | null> {
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      return null;
    }

    const raw = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && Array.isArray((payload as any).items)
      ? (payload as any).items
      : null;
    if (!raw) return null;

    const items: ShiftSupplyItem[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;
      const sku = typeof row.sku === 'string' ? row.sku : null;
      const name = typeof row.name === 'string' ? row.name : null;
      if (!sku || !name) continue;

      const category = SUPPLY_CATEGORIES.includes(row.category as any)
        ? (row.category as ShiftSupplyItem['category'])
        : 'equipment';

      items.push({
        sku,
        name,
        category,
        allocatedQuantity: this.numberOr(row.allocatedQuantity, 0),
        consumedQuantity: this.numberOr(row.consumedQuantity, 0),
        remainingStock: this.numberOr(row.remainingStock ?? row.quantityOnHand, 0),
        unitCostCents: this.numberOr(row.unitCostCents ?? row.unitCost, 0),
      });
    }

    return items.length > 0 ? items : null;
  }

  private numberOr(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Two-way Yellow Dog & Inventory Management Sync:
   * Syncs shift supplies, tracking equipment, uniforms, and PPE consumption.
   */
  async syncInventory(params: {
    organizationId: string;
    facilityId: string;
    system?: VmsSyncSystem;
    syncType?: string;
    customItems?: Array<{ sku: string; name: string; quantity: number }>;
  }): Promise<InventorySyncResult> {
    const system = params.system || VmsSyncSystem.yellow_dog;
    const syncType = params.syncType || 'shift_supplies';

    // Baseline catalog of stadium workforce gear and equipment tracked in Yellow Dog
    const defaultCatalog: ShiftSupplyItem[] = [
      {
        sku: 'YD-UNI-STAD-01',
        name: 'Stadium Staff Polo (Black - Unisex)',
        category: 'uniform',
        allocatedQuantity: 140,
        consumedQuantity: 132,
        remainingStock: 420,
        unitCostCents: 1850,
      },
      {
        sku: 'YD-UNI-APRON-02',
        name: 'Culinary Bistro Apron (Embroidery)',
        category: 'uniform',
        allocatedQuantity: 65,
        consumedQuantity: 60,
        remainingStock: 180,
        unitCostCents: 1200,
      },
      {
        sku: 'YD-EQ-POS-MOB-09',
        name: 'Handheld Mobile Concession POS Device',
        category: 'equipment',
        allocatedQuantity: 45,
        consumedQuantity: 45,
        remainingStock: 60,
        unitCostCents: 45000,
      },
      {
        sku: 'YD-EQ-RADIO-VHF',
        name: 'Motorola CP200d Stadium Two-Way Radio',
        category: 'equipment',
        allocatedQuantity: 30,
        consumedQuantity: 30,
        remainingStock: 50,
        unitCostCents: 28000,
      },
      {
        sku: 'YD-PPE-GLOVE-NITRILE',
        name: 'Food Grade Nitrile Gloves Box (L)',
        category: 'ppe',
        allocatedQuantity: 25,
        consumedQuantity: 22,
        remainingStock: 340,
        unitCostCents: 950,
      },
      {
        sku: 'YD-PPE-EAR-PRO',
        name: 'High-Decibel Concert Ear Plugs (Pairs)',
        category: 'ppe',
        allocatedQuantity: 100,
        consumedQuantity: 95,
        remainingStock: 800,
        unitCostCents: 150,
      },
    ];

    let syncStatus: 'success' | 'partial' | 'failed' | 'demo_mode' = 'demo_mode';
    let syncMessage = `Demonstration sync completed for ${defaultCatalog.length} items (using baseline inventory catalog). Configure live integration endpoint for direct cloud push.`;

    const remoteUrl = process.env.YELLOW_DOG_API_URL;
    const remoteKey = process.env.YELLOW_DOG_API_KEY;

    // Items returned by the remote system, when the sync is live. Kept separate
    // from the baseline catalog so a demo run can never be mistaken for real
    // stock levels.
    let remoteSupplies: ShiftSupplyItem[] | null = null;

    if (remoteUrl && remoteKey) {
      const outbound = params.customItems || defaultCatalog;

      // Transient failures get one retry with a short backoff; a non-2xx
      // response is a decision by the remote system and is not retried.
      for (let attempt = 1; attempt <= SYNC_MAX_ATTEMPTS; attempt++) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
          const res = await fetch(`${remoteUrl}/v1/inventory/sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${remoteKey}`,
            },
            body: JSON.stringify({ facilityId: params.facilityId, items: outbound }),
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));

          if (res.ok) {
            // Inbound half of the two-way sync: adopt the remote's stock levels
            // when it returns them, rather than discarding the response and
            // reporting our own outbound payload back as if it were truth.
            remoteSupplies = await this.parseRemoteInventory(res);
            syncStatus = 'success';
            syncMessage = remoteSupplies
              ? `Live sync with ${system.toUpperCase()} completed; imported ${remoteSupplies.length} stock line item(s).`
              : `Live sync with ${system.toUpperCase()} completed (${res.status}); remote returned no inventory payload.`;
            break;
          }

          syncStatus = 'failed';
          syncMessage = `${system.toUpperCase()} API returned error status ${res.status}: ${res.statusText}`;
          break;
        } catch (err: any) {
          syncStatus = 'failed';
          syncMessage = `${system.toUpperCase()} integration connection failed: ${err.message || String(err)}`;
          if (attempt < SYNC_MAX_ATTEMPTS) {
            this.logger.warn(
              `${system} sync attempt ${attempt} failed, retrying: ${err.message || String(err)}`,
            );
            await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_DELAY_MS));
          }
        }
      }
    }

    const supplies = remoteSupplies
      ? remoteSupplies
      : params.customItems
      ? params.customItems.map((item, idx) => ({
          sku: item.sku || `YD-CUSTOM-${idx + 1}`,
          name: item.name,
          category: 'equipment' as const,
          allocatedQuantity: item.quantity,
          consumedQuantity: Math.round(item.quantity * 0.9),
          remainingStock: 100,
          unitCostCents: 2000,
        }))
      : defaultCatalog;

    // Record sync log in database
    await this.prisma.vmsInventorySyncLog.create({
      data: {
        organizationId: params.organizationId,
        facilityId: params.facilityId,
        system,
        syncType,
        status: syncStatus,
        itemsSyncedCount: supplies.length,
        details: syncStatus === 'success'
          ? `Successfully synchronized ${supplies.length} stock line items with ${system}.`
          : syncStatus === 'failed'
          ? `Failed live synchronization with ${system}: ${syncMessage}`
          : `Demonstration sync performed for ${supplies.length} stock line items (${system} live URL/API key not configured).`,
        metadata: {
          timestamp: new Date().toISOString(),
          catalogSnapshot: supplies as any,
        },
      },
    });

    this.logger.log(`Synced ${supplies.length} items with ${system} for facility ${params.facilityId} (status=${syncStatus})`);

    return {
      system,
      syncType,
      itemsSynced: supplies.length,
      status: syncStatus,
      message: syncMessage,
      supplies,
    };
  }

  /**
   * Pure read query for the latest inventory snapshot without writing a sync log.
   */
  async getLatestInventorySnapshot(params: {
    organizationId: string;
    facilityId: string;
  }): Promise<{ supplies: ShiftSupplyItem[]; lastSyncTime: Date | null; status: string }> {
    const latestLog = await this.prisma.vmsInventorySyncLog.findFirst({
      where: { organizationId: params.organizationId, facilityId: params.facilityId },
      orderBy: { createdAt: 'desc' },
    });

    if (latestLog?.metadata && typeof latestLog.metadata === 'object') {
      const meta = latestLog.metadata as any;
      if (Array.isArray(meta.catalogSnapshot)) {
        return {
          supplies: meta.catalogSnapshot,
          lastSyncTime: latestLog.createdAt,
          status: latestLog.status,
        };
      }
    }

    return {
      supplies: [],
      lastSyncTime: latestLog?.createdAt ?? null,
      status: 'no_sync_history',
    };
  }

  /**
   * Generates standard ADP Workforce Now payroll export CSV.
   */
  generateAdpExportCsv(
    attendances: Array<{
      id: string;
      staffMember: { id: string; firstName: string; lastName: string };
      clockIn: Date;
      hoursWorked: number;
      billedRateCents: number;
      deviationFlags: string[];
    }>,
    companyCode = 'VNW',
  ): { csvContent: string; rowCount: number; rows: AdpPayrollRow[] } {
    const rows: AdpPayrollRow[] = [];

    for (const a of attendances) {
      const regularHours = Math.min(8.0, a.hoursWorked);
      const overtimeHours = Math.max(0, Math.min(4.0, a.hoursWorked - 8.0));
      const doubleTimeHours = Math.max(0, a.hoursWorked - 12.0);
      const hasMealPenalty = a.deviationFlags.includes('meal_break_penalty');

      const dateStr = new Date(a.clockIn).toISOString().split('T')[0];
      const fullName = `${a.staffMember.lastName}, ${a.staffMember.firstName}`;

      if (regularHours > 0) {
        rows.push({
          coCode: companyCode,
          batchId: `BATCH-${dateStr}`,
          fileNumber: a.staffMember.id.slice(-6).toUpperCase(),
          employeeName: fullName,
          earningsCode: 'REG',
          hours: regularHours,
          rateCents: a.billedRateCents,
          totalPayCents: Math.round(regularHours * a.billedRateCents),
          shiftDate: dateStr,
        });
      }

      if (overtimeHours > 0) {
        const otRate = Math.round(a.billedRateCents * 1.5);
        rows.push({
          coCode: companyCode,
          batchId: `BATCH-${dateStr}`,
          fileNumber: a.staffMember.id.slice(-6).toUpperCase(),
          employeeName: fullName,
          earningsCode: 'OT',
          hours: overtimeHours,
          rateCents: otRate,
          totalPayCents: Math.round(overtimeHours * otRate),
          shiftDate: dateStr,
        });
      }

      if (doubleTimeHours > 0) {
        const dtRate = Math.round(a.billedRateCents * 2.0);
        rows.push({
          coCode: companyCode,
          batchId: `BATCH-${dateStr}`,
          fileNumber: a.staffMember.id.slice(-6).toUpperCase(),
          employeeName: fullName,
          earningsCode: 'DT',
          hours: doubleTimeHours,
          rateCents: dtRate,
          totalPayCents: Math.round(doubleTimeHours * dtRate),
          shiftDate: dateStr,
        });
      }

      if (hasMealPenalty) {
        rows.push({
          coCode: companyCode,
          batchId: `BATCH-${dateStr}`,
          fileNumber: a.staffMember.id.slice(-6).toUpperCase(),
          employeeName: fullName,
          earningsCode: 'MEAL_PENALTY',
          hours: 1.0,
          rateCents: a.billedRateCents,
          totalPayCents: a.billedRateCents,
          shiftDate: dateStr,
        });
      }
    }

    const headers = [
      'Co Code',
      'Batch ID',
      'File Number',
      'Employee Name',
      'Earnings Code',
      'Hours',
      'Hourly Rate',
      'Total Pay',
      'Shift Date',
    ];

    const csvLines = [headers.join(',')];
    for (const r of rows) {
      csvLines.push(
        [
          r.coCode,
          r.batchId,
          r.fileNumber,
          `"${r.employeeName}"`,
          r.earningsCode,
          r.hours.toFixed(2),
          `$${(r.rateCents / 100).toFixed(2)}`,
          `$${(r.totalPayCents / 100).toFixed(2)}`,
          r.shiftDate,
        ].join(','),
      );
    }

    return {
      csvContent: csvLines.join('\n'),
      rowCount: rows.length,
      rows,
    };
  }

  /**
   * Generates Gusto-compatible payroll JSON export.
   */
  generateGustoExportJson(
    attendances: Array<{
      id: string;
      staffMember: { id: string; firstName: string; lastName: string };
      clockIn: Date;
      hoursWorked: number;
      billedRateCents: number;
    }>,
    periodStart: string,
    periodEnd: string,
  ): { records: GustoPayrollRecord[]; totalHours: number; totalGrossPayCents: number } {
    let totalHours = 0;
    let totalGrossPayCents = 0;

    const records: GustoPayrollRecord[] = attendances.map((a) => {
      const regHours = Math.min(8.0, a.hoursWorked);
      const otHours = Math.max(0, Math.min(4.0, a.hoursWorked - 8.0));
      const dtHours = Math.max(0, a.hoursWorked - 12.0);

      const payCents =
        regHours * a.billedRateCents +
        otHours * Math.round(a.billedRateCents * 1.5) +
        dtHours * Math.round(a.billedRateCents * 2.0);

      totalHours += a.hoursWorked;
      totalGrossPayCents += Math.round(payCents);

      return {
        employeeId: a.staffMember.id,
        employeeName: `${a.staffMember.firstName} ${a.staffMember.lastName}`,
        regularHours: Number(regHours.toFixed(2)),
        overtimeHours: Number(otHours.toFixed(2)),
        doubleTimeHours: Number(dtHours.toFixed(2)),
        hourlyRate: a.billedRateCents / 100,
        grossPay: Number((payCents / 100).toFixed(2)),
        periodStart,
        periodEnd,
      };
    });

    return {
      records,
      totalHours: Number(totalHours.toFixed(2)),
      totalGrossPayCents,
    };
  }
}
