export const DEFAULT_CORS_ORIGINS = [
  'https://www.venuewrangler.com',
  'https://venuewrangler.com',
  'https://www.stadiumwrangler.com',
  'https://stadiumwrangler.com',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
];

const PRODUCTION_HOSTS = ['venuewrangler.com', 'stadiumwrangler.com'];

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
