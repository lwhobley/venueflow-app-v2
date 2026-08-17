export const DEFAULT_CORS_ORIGINS = [
  'https://www.venuewrangler.com',
  'https://venuewrangler.com',
  'https://www.venuewrangler.org',
  'https://venuewrangler.org',
  'https://www.stadiumwrangler.com',
  'https://stadiumwrangler.com',
  'https://desktop-web.venue-wrangler.pages.dev',
  'https://venue-wrangler.pages.dev',
  'https://venueflow-desktop-web.pages.dev',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const PAGES_DEV_ORIGINS = [
  'desktop-web.venue-wrangler.pages.dev',
  'venue-wrangler.pages.dev',
  'venueflow-desktop-web.pages.dev',
];

const PRODUCTION_HOSTS = ['venuewrangler.com', 'venuewrangler.org', 'stadiumwrangler.com'];

export function isAllowedOrigin(origin: string, isProduction: boolean): boolean {
  if (!/^https?:\/\//i.test(origin)) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const isPinnedPagesDev = PAGES_DEV_ORIGINS.includes(host);
    const isProductHost = PRODUCTION_HOSTS.some((root) => host === root || host.endsWith(`.${root}`));
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isPinnedPagesDev || isProductHost) return true;
    // Loopback origins are trusted in every environment (Expo/Webpack dev
    // servers bind localhost). In production restrict to http to match the
    // default allowlist; in dev also permit https loopback used by local
    // tooling. Arbitrary internet origins are always rejected, even outside
    // production, so a non-prod deployment cannot act as a credentialed proxy.
    if (!isLoopback) return false;
    return isProduction ? url.protocol === 'http:' : true;
  } catch {
    return false;
  }
}
