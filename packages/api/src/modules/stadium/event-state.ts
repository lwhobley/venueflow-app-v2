import { BadRequestException } from '@nestjs/common';

export const EVENT_OPERATIONAL_STATES = ['draft', 'planning', 'approved', 'pre_open', 'live', 'closing', 'closed', 'archived'] as const;
export type EventOperationalState = (typeof EVENT_OPERATIONAL_STATES)[number];

const TRANSITIONS: Record<EventOperationalState, readonly EventOperationalState[]> = {
  draft: ['planning', 'archived'],
  planning: ['draft', 'approved', 'archived'],
  approved: ['pre_open', 'planning', 'archived'],
  pre_open: ['live', 'planning', 'archived'],
  live: ['closing'],
  closing: ['closed'],
  closed: ['archived'],
  archived: [],
};

export function assertEventTransition(from: EventOperationalState, to: EventOperationalState, reason?: string | null) {
  if (from === to) return;
  const permitted = TRANSITIONS[from].includes(to);
  const postApproval = ['approved', 'pre_open', 'live', 'closing', 'closed'].includes(from);
  if (!permitted && !reason?.trim()) {
    throw new BadRequestException(`A reason is required to override ${from} → ${to}.`);
  }
  if (permitted && postApproval && ['planning', 'archived'].includes(to) && !reason?.trim()) {
    throw new BadRequestException(`A reason is required to change an event after approval.`);
  }
}

export function legacyStatusForState(state: EventOperationalState) {
  if (state === 'draft') return 'draft' as const;
  if (state === 'planning' || state === 'approved') return 'planning' as const;
  if (state === 'pre_open') return 'ready' as const;
  if (state === 'live' || state === 'closing') return 'live' as const;
  if (state === 'closed') return 'completed' as const;
  return 'cancelled' as const;
}
