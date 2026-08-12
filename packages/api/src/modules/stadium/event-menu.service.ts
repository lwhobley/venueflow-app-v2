import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { EventPresetType } from '@prisma/client';

export interface CreateMenuOverlayDto {
  organizationId: string;
  facilityId: string;
  eventId?: string;
  name: string;
  presetType: EventPresetType;
  alcoholDisabled?: boolean;
  surchargePercentage?: number;
  appliedOutletTypes?: string[];
}

@Injectable()
export class EventMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: SuiteHospitalityGateway,
  ) {}

  async listOverlays(facilityId: string, eventId?: string) {
    return this.prisma.eventMenuOverlay.findMany({
      where: {
        facilityId,
        ...(eventId ? { eventId } : {}),
        active: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createMenuOverlay(dto: CreateMenuOverlayDto) {
    // If Family Event preset, automatically force alcoholDisabled = true
    let alcoholDisabled = dto.alcoholDisabled ?? false;
    let surchargePercentage = dto.surchargePercentage ?? 0.0;
    let appliedOutletTypes = dto.appliedOutletTypes ?? [];

    if (dto.presetType === 'family_event') {
      alcoholDisabled = true;
      if (!appliedOutletTypes.length) {
        appliedOutletTypes = ['fixed_concourse_stand', 'grab_and_go_kiosk', 'mobile_cart', 'hawker_vendor', 'concession_stand'];
      }
    } else if (dto.presetType === 'concert_mode') {
      surchargePercentage = surchargePercentage || 15.0;
      if (!appliedOutletTypes.length) {
        appliedOutletTypes = ['mobile_cart', 'portable_cart', 'beer_cart'];
      }
    }

    const overlay = await this.prisma.eventMenuOverlay.create({
      data: {
        organizationId: dto.organizationId,
        facilityId: dto.facilityId,
        eventId: dto.eventId ?? null,
        name: dto.name,
        presetType: dto.presetType,
        alcoholDisabled,
        surchargePercentage,
        appliedOutletTypes,
        active: true,
      },
    });

    // Broadcast menu update to terminals
    this.wsGateway.broadcastBeoUpdate(dto.facilityId, 'global', {
      type: 'menu_overlay_updated',
      overlay,
    });

    return overlay;
  }

  async toggleOverlay(id: string, active: boolean) {
    const existing = await this.prisma.eventMenuOverlay.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Event menu overlay not found.');

    const updated = await this.prisma.eventMenuOverlay.update({
      where: { id },
      data: { active },
    });

    this.wsGateway.broadcastBeoUpdate(existing.facilityId, 'global', {
      type: 'menu_overlay_updated',
      overlay: updated,
    });

    return updated;
  }

  async calculateTerminalPrice(itemPriceCents: number, isAlcohol: boolean, outletType: string, activeOverlays: any[]) {
    let priceCents = itemPriceCents;
    let disabled = false;

    for (const overlay of activeOverlays) {
      if (!overlay.active) continue;
      const appliesToOutlet = !overlay.appliedOutletTypes?.length || overlay.appliedOutletTypes.includes(outletType);

      if (appliesToOutlet) {
        if (overlay.alcoholDisabled && isAlcohol) {
          disabled = true;
        }
        if (overlay.surchargePercentage > 0) {
          priceCents = Math.round(priceCents * (1 + overlay.surchargePercentage / 100.0));
        }
      }
    }

    return {
      originalPriceCents: itemPriceCents,
      finalPriceCents: priceCents,
      disabled,
    };
  }
}
