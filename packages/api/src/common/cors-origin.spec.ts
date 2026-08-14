import { describe, expect, it } from 'vitest';
import { DEFAULT_CORS_ORIGINS, isAllowedOrigin } from './cors-origin';

describe('CORS origin allowlist', () => {
  it.each([
    'https://stadiumwrangler.com',
    'https://app.stadiumwrangler.com',
    'https://venuewrangler.com',
    'https://desktop-web.venue-wrangler.pages.dev',
    'https://6716c575.venue-wrangler.pages.dev',
    'https://venueflow-desktop-web.pages.dev',
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    'http://localhost:3000',
  ])('allows a trusted production or local preview origin: %s', (origin) => {
    expect(isAllowedOrigin(origin, true)).toBe(true);
  });

  it.each([
    'https://stadiumwrangler.com.attacker.example',
    'https://attacker.example',
    'file:///tmp/index.html',
  ])('rejects an untrusted production origin: %s', (origin) => {
    expect(isAllowedOrigin(origin, true)).toBe(false);
  });

  it('keeps the local Expo preview in the default middleware allowlist', () => {
    expect(DEFAULT_CORS_ORIGINS).toContain('http://localhost:8081');
    expect(DEFAULT_CORS_ORIGINS).toContain('https://desktop-web.venue-wrangler.pages.dev');
  });
});
