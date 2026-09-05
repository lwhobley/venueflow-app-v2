import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const decode = createRequire(import.meta.url)('./safe-uri-decode.cjs');
describe('router URI decoding', () => {
  it('decodes normal route parameters and Unicode', () => {
    expect(decode('Club%20Level%20%E2%9C%93')).toBe('Club Level ✓');
    expect(decode('%2Fvenue%3Fid%3D1')).toBe('/venue?id=1');
  });
  it('keeps malformed input literal without recursive repair', () => {
    const malformed = '%C0%AF'.repeat(10000) + '%';
    expect(decode(malformed)).toBe(malformed);
    expect(decode('%invalid')).toBe('%invalid');
  });
});
