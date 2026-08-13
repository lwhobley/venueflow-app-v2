// Enterprise stub: Direct consumer Stripe API client is decommissioned.

export async function stripeRequest<T = any>(
  _secretKey: string,
  _method: 'GET' | 'POST',
  _path: string,
  _params?: Record<string, unknown>,
  _idempotencyKey?: string,
): Promise<T> {
  return {} as T;
}
