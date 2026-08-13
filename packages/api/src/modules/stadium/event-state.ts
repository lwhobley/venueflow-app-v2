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

/** Recovery paths are intentionally finite. A reason must not unlock any state jump. */
const OVERRIDE_TRANSITIONS: Partial<Record<EventOperationalState, readonly EventOperationalState[]>> = {
  approved: ['planning'],
  pre_open: ['planning'],
  closing: ['live'],
};

export type EventTransitionOptions = {
  reason?: string | null;
  canOverride?: boolean;
};

export function assertEventTransition(
  from: EventOperationalState,
  to: EventOperationalState,
  options: EventTransitionOptions | string | null = {},
) {
  if (from === to) return;
  // Keep existing unit callers source-compatible; runtime routes pass an
  // explicit capability flag so a free-text reason cannot authorize itself.
  const normalized = typeof options === 'string' ? { reason: options, canOverride: true } : options ?? {};
  const permitted = TRANSITIONS[from].includes(to);
  const postApproval = ['approved', 'pre_open', 'live', 'closing', 'closed'].includes(from);
  const overridePermitted = OVERRIDE_TRANSITIONS[from]?.includes(to) ?? false;
  if (!permitted && (!overridePermitted || !normalized.canOverride)) {
    throw new BadRequestException(`Transition ${from} → ${to} is not permitted.`);
  }
  if ((!permitted || (postApproval && ['planning', 'archived'].includes(to))) && !normalized.reason?.trim()) {
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
