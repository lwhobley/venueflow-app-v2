import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { QueryKey } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, getApiBaseUrl } from './api-client';
import { useAuthStore } from './auth-store';

/**
 * Pushes live updates from the stadium ops SSE endpoint
 * (`/v1/stadium/facilities/:id/live-stream`, packages/api's
 * StadiumRealtimeController) into React Query, instead of waiting for the
 * next poll tick.
 *
 * The endpoint exists and already broadcasts `suite_beo_updated` and
 * `replenishment_requested` — the KDS and suite-runner screens' headers even
 * say "LIVE WEBSOCKET SYNC" — but nothing in the app ever connected to it.
 * Both screens polled `apiRequest` on a `setInterval` instead.
 *
 * Scoped to web only: the endpoint is Server-Sent Events, and browsers ship a
 * native `EventSource`; React Native does not, and no SSE client is in this
 * project's dependencies. Native keeps polling via `useApiQuery`'s
 * `refetchIntervalMs`, unchanged. This hook only shortens the wait on web by
 * invalidating the given query keys as events arrive — the poll interval
 * passed to `useApiQuery` stays in place everywhere as the fallback if the
 * stream never connects (offline, proxy strips SSE, etc).
 *
 * Auth: EventSource can't set an Authorization header, so the flow is a
 * short-lived, single-use ticket minted over the authenticated REST API
 * (POST .../ticket) and passed as a query param — the same pattern the
 * server-side controller expects. A dropped connection mints a fresh ticket
 * before reconnecting, since each ticket is single-use.
 */
export function useStadiumLiveStream(params: {
  zoneId?: string;
  events: readonly string[];
  invalidate: QueryKey[];
  enabled?: boolean;
}) {
  const { zoneId, events, invalidate, enabled = true } = params;
  const queryClient = useQueryClient();
  const facilityId = useAuthStore((state) => state.venue?.id ?? null);
  const token = useAuthStore((state) => state.token);
  // Keep the latest invalidate list available to the effect's event handler
  // without retriggering the connect/disconnect cycle on every render.
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || !facilityId || !token) return undefined;
    if (typeof EventSource === 'undefined') return undefined;

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let backoffMs = 1000;

    const invalidateAll = () => {
      for (const key of invalidateRef.current) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    };

    const connect = async () => {
      if (cancelled) return;
      try {
        const { ticket } = await apiRequest<{ ticket: string; expiresInSeconds: number }>(
          `/v1/stadium/facilities/${encodeURIComponent(facilityId)}/ticket${zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : ''}`,
          { method: 'POST' },
        );
        if (cancelled) return;

        const url = new URL(`${getApiBaseUrl()}/v1/stadium/facilities/${encodeURIComponent(facilityId)}/live-stream`);
        if (zoneId) url.searchParams.set('zoneId', zoneId);
        url.searchParams.set('ticket', ticket);

        source = new EventSource(url.toString());
        backoffMs = 1000;

        for (const eventName of events) {
          source.addEventListener(eventName, invalidateAll);
        }

        source.onerror = () => {
          source?.close();
          source = null;
          if (cancelled) return;
          // A fresh ticket is required per connection attempt — tickets are
          // single-use and expire in 60s, so EventSource's own built-in retry
          // (which just re-requests the same URL) would fail forever here.
          reconnectTimer = setTimeout(() => void connect(), backoffMs);
          backoffMs = Math.min(backoffMs * 2, 30_000);
        };
      } catch {
        if (cancelled) return;
        reconnectTimer = setTimeout(() => void connect(), backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
    // `events` and `invalidate` are read through refs/closed over by identity
    // of their contents at mount; the effect intentionally reconnects only on
    // the params that change the subscription itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, facilityId, token, zoneId, queryClient]);
}
