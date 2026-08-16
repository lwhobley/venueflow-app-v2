/**
 * Venue Wrangler Enterprise logo shown after the lasso in SportsBrandIntro.
 *
 * Prefer the enterprise badge JPEG when present in assets/; otherwise fall
 * back to the shipped stadium-wrangler logo mark.
 *
 * To use the full Enterprise badge from product marketing:
 * 1. Add assets/venue-wrangler-enterprise-logo.jpg (from design)
 * 2. Switch the export below to the data-URI module or require() of that file.
 */
// Metro static require — works offline and in Expo web export
// eslint-disable-next-line @typescript-eslint/no-var-requires
const logo = require('../assets/stadium-wrangler-logo.png');

/** ImageSource for <Image source={...} /> */
export const VENUE_WRANGLER_ENTERPRISE_LOGO_SOURCE = logo;

/** @deprecated Prefer VENUE_WRANGLER_ENTERPRISE_LOGO_SOURCE for require() assets */
export const VENUE_WRANGLER_ENTERPRISE_LOGO_URI: string | null = null;
