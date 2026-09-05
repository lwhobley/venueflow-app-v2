// Centralized runtime feature flags.
//
// Billing is OFF by default for local development. Production builds enable it
// through EAS env so the subscription gate is active for App Store review.

function readEnvFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return value === 'true' || value === '1';
}

export const config = {
  billingEnabled: readEnvFlag(process.env.EXPO_PUBLIC_BILLING_ENABLED, false),
};
