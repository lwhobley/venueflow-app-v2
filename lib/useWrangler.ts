import { useMemo } from 'react';
import { apiRequest, useApiMutation, useApiQuery } from './api-client';
import { asArray } from './format';

export type WranglerSeverity = 'info' | 'watch' | 'warning' | 'critical';
export type WranglerStatus = 'clear' | 'watch' | 'attention' | 'critical';
export type WranglerServicePhase = 'pre_service' | 'active' | 'closing' | 'closed';
export type WranglerAction = { id: string; type: 'NAVIGATE' | 'ACKNOWLEDGE' | 'REASSIGN_RESERVATION' | 'NOTIFY_STAFF'; label: string; route: '/reservations' | '/staff' | '/schedule' | '/bar-stock' | '/reports' | '/floor'; requiresConfirmation: boolean; payload?: Record<string, string | number | boolean | null> };
export type WranglerPriority = { id: string; kind: 'event' | 'coverage' | 'requests' | 'stock' | 'floor' | 'steady'; tone: 'good' | 'warn' | 'neutral'; severity: WranglerSeverity; title: string; body: string; reason: string; cta: string; route: WranglerAction['route']; actions: WranglerAction[] };
export type WranglerSummary = { covers: number; reservations: number; vipArrivals: number; scheduledStaff: number; openShifts: number; lowStockItems: number; eightySixItems: number; pendingStaffRequests: number; seatedTables: number };
export type WranglerSnapshot = { venue: { _id: string; name: string }; generatedAt: number; date: string; status: WranglerStatus; servicePhase: WranglerServicePhase; servicePhaseLabel: string; summary: WranglerSummary; priorities: WranglerPriority[]; recap: { headline: string; metrics: Array<{ label: string; value: number }>; unresolved: Array<{ id: string; title: string; severity: WranglerSeverity; reason: string }>; tomorrow: string[] }; patterns: Array<{ id: string; title: string; detail: string; confidence: 'live' | 'emerging' }> };

export type WranglerOperatorRisk = 'read' | 'low_risk_write' | 'operational_write' | 'sensitive_write';
export type WranglerOperatorPlan = { tool: string; args: Record<string, unknown>; summary: string; risk: WranglerOperatorRisk };
export type WranglerOperatorResponse =
  | { status: 'executed'; tool: string; risk: WranglerOperatorRisk; summary: string; result: unknown }
  | { status: 'confirmation_required'; tool: string; risk: WranglerOperatorRisk; summary: string; preview: string[]; plan: WranglerOperatorPlan };

export type WranglerAiUsage = {
  month: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  budget: {
    budgetUsd: number;
    warningPercent: number;
    percentUsed: number;
    remainingUsd: number | null;
    status: 'healthy' | 'warning' | 'over_budget' | 'unlimited';
  };
  breakdown: Array<{
    feature: string;
    model: string;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>;
};

const EMPTY_WRANGLER_SUMMARY: WranglerSummary = {
  covers: 0, reservations: 0, vipArrivals: 0, scheduledStaff: 0, openShifts: 0,
  lowStockItems: 0, eightySixItems: 0, pendingStaffRequests: 0, seatedTables: 0,
};

/**
 * Home, the Wrangler screen, and the shift story all read this snapshot
 * field-by-field without runtime validation, so a partial payload used to
 * throw and take those screens down. Fill the shape in once, here, so a
 * degraded response renders as an empty service picture instead.
 */
function normalizeWranglerSnapshot(raw: WranglerSnapshot | undefined): WranglerSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return {
    ...raw,
    venue: raw.venue ?? { _id: '', name: '' },
    status: raw.status ?? 'clear',
    servicePhase: raw.servicePhase ?? 'pre_service',
    servicePhaseLabel: raw.servicePhaseLabel ?? '',
    summary: { ...EMPTY_WRANGLER_SUMMARY, ...(raw.summary ?? {}) },
    priorities: asArray<WranglerPriority>(raw.priorities).map((priority) => ({
      ...priority,
      actions: asArray<WranglerAction>(priority?.actions),
    })),
    recap: {
      ...(raw.recap ?? {}),
      headline: raw.recap?.headline ?? '',
      metrics: asArray(raw.recap?.metrics),
      unresolved: asArray(raw.recap?.unresolved),
      tomorrow: asArray(raw.recap?.tomorrow),
    },
    patterns: asArray(raw.patterns),
  };
}

export function useWrangler(enabled = true) {
  const query = useApiQuery<WranglerSnapshot>(['operations', 'wrangler'], '/v1/operations/wrangler', enabled);
  const data = useMemo(() => normalizeWranglerSnapshot(query.data), [query.data]);
  return { ...query, data };
}
export function useWranglerAiUsage(enabled = true) { return useApiQuery<WranglerAiUsage>(['operations', 'wrangler', 'ai-usage'], '/v1/operations/wrangler/ai-usage', enabled); }
export function useAskWrangler() { return useApiMutation<{ question: string }, { answer: string; sources: string[] }>((body) => apiRequest('/v1/operations/wrangler/ask', { method: 'POST', body }), []); }
export function useWranglerOperatorPlan() { return useApiMutation<{ command: string }, WranglerOperatorResponse>((body) => apiRequest('/v1/operations/wrangler/operator/plan', { method: 'POST', body }), []); }
export function useWranglerOperatorExecute() {
  return useApiMutation<{ plan: WranglerOperatorPlan }, { ok: true; tool: string; risk: WranglerOperatorRisk; result: unknown }>(
    (body) => apiRequest('/v1/operations/wrangler/operator/execute', { method: 'POST', body }),
    [['operations', 'wrangler'], ['operations', 'getManagerDashboard'], ['reservations', 'getReservationsPage'], ['scheduling', 'getManagerSchedule'], ['app', 'getClockBoard'], ['app', 'listVenueStaff']],
  );
}
export function useExecuteWranglerAction() {
  return useApiMutation<
    | { type: 'REASSIGN_RESERVATION'; reservationId: string; tableId: string }
    | { type: 'NOTIFY_STAFF' }
    | { type: 'CREATE_FOLLOW_UP'; priorityId: string },
    { ok: true; type: string; reservationId?: string; tableId?: string; notified?: string; openShifts?: number; followUpId?: string; title?: string; existing?: boolean }
  >((body) => apiRequest('/v1/operations/wrangler/actions', { method: 'POST', body }), [['operations', 'wrangler'], ['operations', 'getManagerDashboard'], ['floor', 'getActiveFloorPlan'], ['floor', 'getFloorStats'], ['reservations', 'getReservationsPage']]);
}
