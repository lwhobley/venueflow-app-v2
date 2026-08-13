import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertEventTransition, legacyStatusForState } from './event-state';

describe('event operational state machine', () => {
  it('allows the planned forward path', () => {
    expect(() => assertEventTransition('planning', 'approved')).not.toThrow();
    expect(() => assertEventTransition('live', 'closing')).not.toThrow();
    expect(legacyStatusForState('pre_open')).toBe('ready');
  });

  it('permits only explicit, authorized recovery transitions after approval', () => {
    expect(() => assertEventTransition('approved', 'planning')).toThrow(BadRequestException);
    expect(() => assertEventTransition('live', 'archived')).toThrow(BadRequestException);
    expect(() => assertEventTransition('live', 'archived', 'Event cancelled by venue security')).toThrow(BadRequestException);
    expect(() => assertEventTransition('approved', 'planning', { reason: 'Forecast withdrawal', canOverride: true })).not.toThrow();
    expect(() => assertEventTransition('archived', 'live', { reason: 'No longer cancelled', canOverride: true })).toThrow(BadRequestException);
  });
});
