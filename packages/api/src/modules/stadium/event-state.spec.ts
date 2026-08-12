import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertEventTransition, legacyStatusForState } from './event-state';

describe('event operational state machine', () => {
  it('allows the planned forward path', () => {
    expect(() => assertEventTransition('planning', 'approved')).not.toThrow();
    expect(() => assertEventTransition('live', 'closing')).not.toThrow();
    expect(legacyStatusForState('pre_open')).toBe('ready');
  });

  it('requires a reason for a post-approval rollback or unsupported override', () => {
    expect(() => assertEventTransition('approved', 'planning')).toThrow(BadRequestException);
    expect(() => assertEventTransition('live', 'archived')).toThrow(BadRequestException);
    expect(() => assertEventTransition('live', 'archived', 'Event cancelled by venue security')).not.toThrow();
  });
});
