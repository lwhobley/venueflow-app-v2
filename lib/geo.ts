// Pure geolocation helpers — no native/Expo imports, so they are safe to unit
// test under a plain Node/Vitest environment.

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type GeoFix = GeoPoint & {
  accuracy: number;
  mocked: boolean;
};

export type GeofenceRule = {
  /** Max acceptable GPS accuracy radius, in meters. */
  maxAccuracyM: number;
};

export const DEFAULT_GEOFENCE_RULE: GeofenceRule = { maxAccuracyM: 50 };

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radius = 6371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(Math.min(a, 1)));
}

/**
 * Pure clock-in eligibility check. Centralizes the anti-fraud rules so they can
 * be unit-tested and reused: reject mocked locations, low-accuracy fixes, and
 * positions outside the venue's geofence radius.
 */
export function isWithinGeofence(
  location: GeoFix,
  venue: { latitude: number; longitude: number; geofenceRadiusM: number },
  rule: GeofenceRule = DEFAULT_GEOFENCE_RULE,
): boolean {
  if (location.mocked) return false;
  if (location.accuracy > rule.maxAccuracyM) return false;
  const distance = haversineMeters(location.latitude, location.longitude, venue.latitude, venue.longitude);
  return distance <= venue.geofenceRadiusM;
}
