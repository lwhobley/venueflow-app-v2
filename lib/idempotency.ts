/**
 * Produce a stable identifier before an event-day mutation is attempted. The
 * caller must persist and reuse this value through retries; generating it at
 * the transport layer is too late to protect a committed-but-unanswered
 * request.
 */
export function createIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  // Expo/Hermes and modern browsers expose getRandomValues. This retains
  // cryptographic entropy without coupling the universal request layer to a
  // native module that cannot be loaded in Node test environments.
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('Secure random UUID generation is unavailable on this device.');
}

const FNV_PRIME = 0x100000001b3n;
const FNV_OFFSET = 0xcbf29ce484222325n;

function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
  }
  return hash;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/**
 * Deterministic idempotency key derived from the request fingerprint. Retries
 * of the same logical operation (React Query replay or offline-queue flush)
 * reuse the same key, so a committed-but-unanswered request is deduplicated on
 * the server instead of applied twice.
 */
export async function createStableIdempotencyKey(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
    const bytes = Array.from(new Uint8Array(digest));
    return `m_${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return `m_${fnv1a64(input).toString(16).padStart(16, '0')}${fnv1a64(`salt:${input}`).toString(16).padStart(16, '0')}`;
}
