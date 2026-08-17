import { describe, expect, it } from 'vitest';
import { DEFAULT_CORS_ORIGINS, isAllowedOrigin } from './cors-origin';

describe('CORS origin allowlist', () => {
  it.each([
    'https://stadiumwrangler.com',
    'https://app.stadiumwrangler.com',
    'https://venuewrangler.com',
    'https://venuewrangler.org',
    'https://app.venuewrangler.org',
    'https://desktop-web.venue-wrangler.pages.dev',
    'https://venueflow-desktop-web.pages.dev',
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    'http://localhost:3000',
  ])('allows a trusted production or local preview origin: %s', (origin) => {
    expect(isAllowedOrigin(origin, true)).toBe(true);
  });

  it.each([
    'https://stadiumwrangler.com.attacker.example',
    'https://6716c575.venue-wrangler.pages.dev',
    'https://attacker.example',
    'file:///tmp/index.html',
  ])('rejects an untrusted production origin: %s', (origin) => {
    expect(isAllowedOrigin(origin, true)).toBe(false);
  });

  it('keeps the local Expo preview in the default middleware allowlist', () => {
    expect(DEFAULT_CORS_ORIGINS).toContain('http://localhost:8081');
    expect(DEFAULT_CORS_ORIGINS).toContain('https://desktop-web.venue-wrangler.pages.dev');
  });

  it.each([
    'https://attacker.example',
    'https://www.attacker.com',
    'https://app.venuewrangler.com.attacker.example',
  ])('still rejects arbitrary internet origins outside production: %s', (origin) => {
    expect(isAllowedOrigin(origin, false)).toBe(false);
  });

  it('permits loopback origins in development for local tooling', () => {
    expect(isAllowedOrigin('http://localhost:8081', false)).toBe(true);
    expect(isAllowedOrigin('https://localhost:8443', false)).toBe(true);
  });
});
