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
