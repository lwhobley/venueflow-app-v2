export const DEFAULT_CORS_ORIGINS = [
  'https://www.venuewrangler.com',
  'https://venuewrangler.com',
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

const PRODUCTION_HOSTS = ['venuewrangler.com', 'stadiumwrangler.com', 'pages.dev'];

export function isAllowedOrigin(origin: string, isProduction: boolean): boolean {
  if (!/^https?:\/\//i.test(origin)) return false;
  if (!isProduction) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const isProductHost = PRODUCTION_HOSTS.some((root) => host === root || host.endsWith(`.${root}`));
    const isLocalPreview = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(host);
    return isProductHost || isLocalPreview;
  } catch {
    return false;
  }
}
