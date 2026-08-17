import { describe, expect, it } from 'vitest';
import { haversineMeters, isWithinGeofence } from './geo';

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0);
  });

  it('approximates a known short distance (~111m per 0.001 lat)', () => {
    const meters = haversineMeters(37.0, -122.0, 37.001, -122.0);
    expect(meters).toBeGreaterThan(105);
    expect(meters).toBeLessThan(115);
  });

  it('is symmetric', () => {
    const a = haversineMeters(40.0, -73.0, 41.0, -74.0);
    const b = haversineMeters(41.0, -74.0, 40.0, -73.0);
    expect(Math.abs(a - b)).toBeLessThan(1e-6);
  });

  it('returns a finite half-earth distance for antipodal points (no NaN)', () => {
    const meters = haversineMeters(0, 0, 0, 180);
    expect(Number.isFinite(meters)).toBe(true);
    expect(meters).toBeGreaterThan(20_000_000);
    expect(meters).toBeLessThan(20_100_000);
  });
});

describe('isWithinGeofence (clock-in anti-fraud)', () => {
  const venue = { latitude: 37.7749, longitude: -122.4194, geofenceRadiusM: 120 };

  it('allows an accurate, real fix inside the radius', () => {
    expect(
      isWithinGeofence({ latitude: 37.7749, longitude: -122.4194, accuracy: 10, mocked: false }, venue),
    ).toBe(true);
  });

  it('rejects mocked locations even when inside the radius', () => {
    expect(
      isWithinGeofence({ latitude: 37.7749, longitude: -122.4194, accuracy: 5, mocked: true }, venue),
    ).toBe(false);
  });

  it('rejects low-accuracy fixes (accuracy worse than threshold)', () => {
    expect(
      isWithinGeofence({ latitude: 37.7749, longitude: -122.4194, accuracy: 80, mocked: false }, venue),
    ).toBe(false);
  });

  it('rejects positions outside the geofence radius', () => {
    expect(
      isWithinGeofence({ latitude: 37.78, longitude: -122.43, accuracy: 10, mocked: false }, venue),
    ).toBe(false);
  });

  it('treats the radius edge as inclusive', () => {
    // ~111m north of venue, within the 120m radius.
    expect(
      isWithinGeofence({ latitude: 37.7749 + 0.001, longitude: -122.4194, accuracy: 10, mocked: false }, venue),
    ).toBe(true);
  });
});
