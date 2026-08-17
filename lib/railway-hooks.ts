import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation as useReactMutation, useQuery as useReactQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getApiBaseUrl } from './api-client';
import { useAuthStore } from './auth-store';
import { enqueueOfflineMutation } from './offline-queue';
import { createStableIdempotencyKey, stableStringify } from './idempotency';
import type { RailwayFunctionRef } from './railway-api';

type QueryArgs = Record<string, unknown> | 'skip' | undefined;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/* eslint-disable @typescript-eslint/no-explicit-any -- route fns are type-erased by design */
type Route = {
  path: string | ((args: any) => string);
  method?: Method;
  body?: (args: any) => any;
  invalidate?: unknown[][];
  timeoutMs?: number;
  offline?: boolean;
  /** Server uses this header to make a write exactly-once across retries. */
  idempotent?: boolean;
};

const queryRoutes: Record<string, Route> = {
  'app.getMe': { path: '/v1/app/me' },
  'app.getVenueJoinCode': { path: '/v1/app/venue/join-code' },
  'app.getDashboard': { path: '/v1/app/dashboard' },
  'app.getNotifications': { path: '/v1/app/notifications' },
  'app.getClockBoard': { path: '/v1/time-clock/board' },
  'app.getMyTimeClock': { path: '/v1/time-clock/me' },
  'app.getMyVenueBilling': { path: '/v1/app/billing' },
  'app.listVenueStaff': { path: '/v1/app/staff' },
  'app.listStaffOnboarding': { path: (args) => `/v1/app/staff/onboarding${args?.profileId ? `?profileId=${encodeURIComponent(args.profileId)}` : ''}` },
  'app.listStaffAuditLog': { path: '/v1/app/staff/audit-log' },
  'app.listStaffRequests': { path: '/v1/staff-requests' },
  'app.getManagerInsights': { path: '/v1/app/manager-insights' },
  'app.exportTimeEntriesCsv': { path: (args) => `/v1/app/time-entries/csv${args?.startDate ? `?startDate=${args.startDate}&endDate=${args.endDate ?? ''}` : ''}` },
  'staffAuth.listVenueRoles': { path: '/v1/app/venue-roles' },
  'scheduling.listBlackouts': { path: '/v1/scheduling/blackouts' },
  'scheduling.getManagerSchedule': { path: (args) => `/v1/scheduling/manager${args?.weekStart ? `?weekStart=${encodeURIComponent(args.weekStart)}` : ''}` },
  'scheduling.getLaborForecast': { path: (args) => `/v1/scheduling/labor-forecast${args?.weekStart ? `?weekStart=${encodeURIComponent(args.weekStart)}` : ''}` },
  'scheduling.listScheduleMemory': { path: (args) => `/v1/scheduling/memory${args?.limit ? `?limit=${args.limit}` : ''}` },
  'scheduling.previewAutoSchedule': { path: (args) => `/v1/scheduling/auto-schedule/preview?weekStartDate=${encodeURIComponent(args.weekStartDate ?? '')}` },
  'scheduling.listScheduleTemplates': { path: '/v1/scheduling/templates' },
  'scheduling.getMySchedule': { path: '/v1/scheduling/me' },
  'scheduling.getMyShiftSwaps': { path: '/v1/scheduling/swaps/me' },
  'scheduling.listShiftSwaps': { path: '/v1/scheduling/swaps' },
  'pos.getPosOverview': { path: '/v1/pos/overview' },
  'pos.getSalesSummaryDashboard': { path: (args) => `/v1/pos/sales/summary?windowDays=${args.windowDays ?? 7}${args.startTs ? `&startTs=${args.startTs}` : ''}${args.endTs ? `&endTs=${args.endTs}` : ''}` },
  'pos.getSalesByServer': { path: (args) => `/v1/pos/sales/by-server?windowDays=${args.windowDays ?? 7}${args.startTs ? `&startTs=${args.startTs}` : ''}${args.endTs ? `&endTs=${args.endTs}` : ''}` },
  'pos.getTopMenuItems': { path: (args) => `/v1/pos/sales/top-items?windowDays=${args.windowDays ?? 7}&limit=${args.limit ?? 30}${args.startTs ? `&startTs=${args.startTs}` : ''}${args.endTs ? `&endTs=${args.endTs}` : ''}` },
  'pos.getLaborSummary': { path: (args) => `/v1/pos/labor?windowDays=${args.windowDays ?? 7}${args.startTs ? `&startTs=${args.startTs}` : ''}${args.endTs ? `&endTs=${args.endTs}` : ''}` },
  'pos.getAggregatorStatus': { path: '/v1/pos/aggregator/status' },
  'pos.getAggregatorChannels': { path: '/v1/pos/aggregator/channels' },
  'pos.getMaster86List': { path: '/v1/pos/aggregator/86-items' },
  'pos.getAggregatorSettlement': { path: '/v1/pos/aggregator/settlement' },
  'operations.getManagerDashboard': { path: '/v1/operations/manager-dashboard' },
  'operations.getDailyBrief': { path: '/v1/operations/daily-brief' },
  'operations.getCommandCenter': { path: '/v1/operations/command-center' },
  'operations.getCommandCenterEvent': { path: (args) => `/v1/operations/command-center/events/${args.eventId ?? args.id}` },
  'stadium.getOverview': { path: '/v1/stadium/overview' },
  'stadium.listEventIssues': { path: (args) => `/v1/stadium/events/${args.eventId}/issues` },
  'stadium.listEventAudit': { path: (args) => `/v1/stadium/events/${args.eventId}/audit` },
  'stadium.getEventCloseout': { path: (args) => `/v1/stadium/events/${args.eventId}/closeout` },
  'stadium.getPilotHealth': { path: '/v1/stadium/pilot-health' },
  'stadium.getIntegrationReadiness': { path: '/v1/stadium/integration-readiness' },
  'stadium.getNflBrief': { path: (args) => `/v1/stadium/events/${args.eventId}/nfl-brief` },
  'unionCompliance.getMultiVenueOverview': { path: '/v1/stadium/union-compliance/multi-venue-overview' },
  'unionCompliance.getCrossVenueConflicts': { path: '/v1/stadium/union-compliance/cross-venue-conflicts' },
  'unionCompliance.getCertifications': { path: '/v1/stadium/union-compliance/certifications' },
  'operations.listLogbook': { path: (args) => `/v1/operations/logbook${args?.limit ? `?limit=${args.limit}` : ''}` },
  'operations.getChecklist': {
    path: (args) => `/v1/operations/checklist?kind=${encodeURIComponent(args.kind)}${args?.date ? `&date=${encodeURIComponent(args.date)}` : ''}`,
  },
  'reservations.getReservationsPage': { path: '/v1/reservations' },
  'reservations.exportReservationsCsv': { path: (args) => `/v1/reservations/export-csv${args?.startDate ? `?startDate=${args.startDate}&endDate=${args.endDate ?? ''}` : ''}` },
  'payroll.getPayrollSummary': { path: (args) => `/v1/payroll/summary${args.startDate ? `?startDate=${args.startDate}&endDate=${args.endDate ?? ''}` : ''}` },
  'payroll.exportPayrollCsv': { path: (args) => `/v1/payroll/export-csv${args.startDate ? `?startDate=${args.startDate}&endDate=${args.endDate ?? ''}` : ''}` },
  'barInventory.getBarStock': { path: '/v1/bar-inventory' },
  'barInventory.getUsageVelocity': { path: '/v1/bar-inventory/velocity' },
  'barInventory.getItemMovements': { path: (args) => `/v1/bar-inventory/${args.itemId}/movements?limit=${args.limit ?? 50}` },
  'barInventory.exportStockCsv': { path: '/v1/bar-inventory/export-csv' },
  'barInventory.exportMovementsCsv': { path: '/v1/bar-inventory/movements/export-csv' },
  'barInventory.getShrinkageReport': { path: '/v1/bar-inventory/shrinkage' },
  'barInventory.getPurchaseOrder': { path: '/v1/bar-inventory/purchase-order' },
  'barInventory.exportPurchaseOrderCsv': { path: '/v1/bar-inventory/purchase-order/export-csv' },
  'barInventory.getCostHistory': { path: (args) => `/v1/bar-inventory/cost-history/${args.itemId}` },
  'barInventory.getAgingReport': { path: '/v1/bar-inventory/aging' },
  'barInventory.listPrepBoard': { path: '/v1/bar-inventory/prep-board' },
  'cosmicInsights.getLatestInsights': { path: '/v1/insights' },
  'floor.getActiveFloorPlan': { path: '/v1/floor/active' },
  'floor.getFloorStats': { path: '/v1/floor/stats' },
  'floorBinding.getActiveFloorPlan': { path: '/v1/floor/active' },
  'floorBinding.getUnassignedReservations': { path: (args) => `/v1/floor/unassigned-reservations?withinMinutes=${args.withinMinutes ?? 120}` },
  'floorBinding.getOpenWaitlist': { path: '/v1/floor/waitlist' },
  'chat.listConversations': { path: '/v1/chat/conversations' },
  'chat.listDirectory': { path: '/v1/chat/directory' },
  'chat.getMessages': { path: (args) => `/v1/chat/conversations/${args.conversationId}/messages` },
  'guests.listGuests': {
    path: (args) =>
      `/v1/guests?page=${args.page ?? 0}&limit=${args.limit ?? 100}${args.search ? `&q=${encodeURIComponent(args.search)}` : ''}`,
  },
  'guests.getGuestProfile': { path: (args) => `/v1/guests/${args.guestId}` },
  'crm.listLeads': {
    path: (args) =>
      `/v1/crm/leads?page=${args.page ?? 0}&limit=${args.limit ?? 100}${args.search ? `&search=${encodeURIComponent(args.search)}` : ''}`,
  },
  'crm.listBeos': { path: (args) => `/v1/crm/beos?page=${args.page ?? 0}&limit=${args.limit ?? 100}` },
  'crm.listContracts': { path: (args) => `/v1/crm/contracts?page=${args.page ?? 0}&limit=${args.limit ?? 100}` },
  'crm.getLead': { path: (args) => `/v1/crm/leads/${args.leadId}` },
  'crm.getForecast': { path: '/v1/crm/forecast' },
  'crm.getSourceRoi': { path: '/v1/crm/source-roi' },
  'crm.getStaleLeads': { path: (args) => `/v1/crm/stale-leads${args?.days ? `?days=${args.days}` : ''}` },
  'crm.getLeadActivity': { path: (args) => `/v1/crm/leads/${args.leadId}/activity` },
  'crm.listTemplates': { path: '/v1/crm/templates' },
  'reservations.getCoverPacing': { path: (args) => `/v1/reservations/cover-pacing?date=${encodeURIComponent(args.date)}` },
  'reservations.guestAutofill': {
    path: (args) =>
      `/v1/reservations/guest-autofill${args?.email ? `?email=${encodeURIComponent(args.email)}` : args?.phone ? `?phone=${encodeURIComponent(args.phone)}` : ''}`,
  },
  'reservations.listHolds': { path: '/v1/reservations/holds' },
  'reservationIntegrations.getReservationIntegrationOverview': { path: '/v1/integrations/reservations' },
  'documents.list': { path: '/v1/documents' },
};

const mutationRoutes: Record<string, Route> = {
  'stadium.createZone': {
    path: '/v1/stadium/zones',
    method: 'POST',
    body: stripVenue,
    invalidate: [['stadium', 'getOverview']],
  },
  'stadium.generateEventPlan': {
    path: '/v1/stadium/event-plan',
    method: 'POST',
    body: ({ venueId, eventId, options }) => ({ venue_id: venueId, event_id: eventId, options: options ?? {} }),
  },
  'stadium.updateZoneStatus': {
    path: (args) => `/v1/stadium/zones/${args.zoneId}/status`,
    method: 'PATCH',
    body: ({ status }) => ({ status }),
    invalidate: [['stadium', 'getOverview']],
  },
  'stadium.createEvent': {
    path: '/v1/stadium/events',
    method: 'POST',
    body: stripVenue,
    invalidate: [['stadium', 'getOverview'], ['operations', 'getCommandCenter']],
  },
  'stadium.updateEventStatus': {
    path: (args) => `/v1/stadium/events/${args.eventId}/status`,
    method: 'PATCH',
    body: ({ status }) => ({ status }),
    invalidate: [['stadium', 'getOverview'], ['operations', 'getCommandCenter']],
  },
  'stadium.updateEventOperationalState': {
    path: (args) => `/v1/stadium/events/${args.eventId}/state`,
    method: 'PATCH',
    body: ({ state, reason }) => ({ state, reason }),
    invalidate: [['stadium', 'getOverview'], ['operations', 'getCommandCenter']],
  },
  'stadium.createEventIssue': {
    path: (args) => `/v1/stadium/events/${args.eventId}/issues`,
    method: 'POST',
    body: ({ outletId, issueType, severity, title, description, ownerUserId, clientMutationId }) => ({ outletId, issueType, severity, title, description, ownerUserId, clientMutationId }),
    invalidate: [['stadium', 'getOverview'], ['stadium', 'listEventIssues'], ['stadium', 'listEventAudit']],
    offline: true,
    idempotent: true,
  },
  'stadium.acknowledgeEventIssue': {
    path: (args) => `/v1/stadium/issues/${args.issueId}/acknowledge`,
    method: 'PATCH',
    body: () => ({}),
    invalidate: [['stadium', 'getOverview'], ['stadium', 'listEventIssues'], ['stadium', 'listEventAudit']],
  },
  'stadium.resolveEventIssue': {
    path: (args) => `/v1/stadium/issues/${args.issueId}/resolve`,
    method: 'PATCH',
    body: ({ resolutionNotes }) => ({ resolutionNotes }),
    invalidate: [['stadium', 'getOverview'], ['stadium', 'listEventIssues'], ['stadium', 'listEventAudit']],
  },
  'stadium.updateZoneReadiness': {
    path: (args) => `/v1/stadium/events/${args.eventId}/zones/${args.zoneId}/readiness`,
    method: 'PATCH',
    body: ({ status, notes }) => ({ status, notes }),
    invalidate: [['stadium', 'getOverview'], ['operations', 'getCommandCenter']],
    offline: true,
    idempotent: true,
  },
  'stadium.upsertEventCloseout': {
    path: (args) => `/v1/stadium/events/${args.eventId}/closeout`,
    method: 'POST',
    body: ({ actualAttendance, actualSalesCents, forecastSalesCents, laborHours, laborCostCents, inventoryVarianceCents, outletResults, inventoryResults, laborResults, notes, status, adjustmentReason }) => ({ actualAttendance, actualSalesCents, forecastSalesCents, laborHours, laborCostCents, inventoryVarianceCents, outletResults, inventoryResults, laborResults, notes, status, adjustmentReason }),
    invalidate: [['stadium', 'getEventCloseout'], ['stadium', 'listEventAudit'], ['stadium', 'getOverview']],
  },
  'stadium.submitEventCloseoutRevision': {
    path: (args) => `/v1/stadium/events/${args.eventId}/closeout/revisions`,
    method: 'POST',
    body: ({ actualAttendance, actualSalesCents, forecastSalesCents, laborHours, laborCostCents, inventoryVarianceCents, notes, adjustmentReason }) => ({ actualAttendance, actualSalesCents, forecastSalesCents, laborHours, laborCostCents, inventoryVarianceCents, notes, adjustmentReason }),
    invalidate: [['stadium', 'getEventCloseout'], ['stadium', 'listEventAudit'], ['stadium', 'getOverview']],
  },
  'stadium.upsertPartner': {
    path: '/v1/stadium/partners',
    method: 'POST',
    body: stripVenue,
    invalidate: [['stadium', 'getOverview']],
  },
  'app.markNotificationRead': {
    path: (args) => `/v1/app/notifications/${args.notificationId ?? args.id ?? args}/read`,
    method: 'POST',
    invalidate: [['app', 'getNotifications']],
  },
  'app.updateVenue': {
    path: '/v1/app/venue',
    method: 'PATCH',
    body: ({ name, latitude, longitude, geofenceRadiusM }) => ({ name, latitude, longitude, geofenceRadiusM }),
    invalidate: [['app', 'getMe'], ['app', 'getDashboard']],
  },
  'app.rotateVenueJoinCode': {
    path: '/v1/app/venue/join-code/rotate',
    method: 'POST',
    body: () => ({}),
    invalidate: [['app', 'getVenueJoinCode']],
  },
  'app.switchVenue': {
    path: '/v1/app/switch-venue',
    method: 'POST',
    body: ({ venueId }) => ({ venueId }),
    invalidate: [['app', 'getMe'], ['app', 'getDashboard']],
  },
  'app.registerVenue': {
    path: '/v1/app/register-venue',
    method: 'POST',
    body: ({ businessName, ownerName, phone, address, venueType, staffRange }) => ({ businessName, ownerName, phone, address, venueType, staffRange }),
    invalidate: [['app', 'getMe'], ['app', 'getDashboard']],
  },
  'app.deleteMyAccount': { path: '/v1/app/me', method: 'DELETE' },
  'app.clockIn': { path: '/v1/time-clock/clock-in', method: 'POST', body: locationBody, invalidate: clockInvalidations(), idempotent: true },
  'app.clockOut': { path: '/v1/time-clock/clock-out', method: 'POST', body: locationBody, invalidate: clockInvalidations(), idempotent: true },
  'app.breakStart': { path: '/v1/time-clock/break-start', method: 'POST', body: (args) => ({ type: args.type }), invalidate: clockInvalidations() },
  'app.breakEnd': { path: '/v1/time-clock/break-end', method: 'POST', body: () => ({}), invalidate: clockInvalidations() },
  'app.upsertVenueStaff': {
    path: '/v1/app/staff',
    method: 'POST',
    body: ({ venueId, staffId, email, fullName, role, jobTitle, phone, altPhone, address, dateOfBirth, certifications, onboardingPin }) => ({ venueId, staffId, email, fullName, role, jobTitle, phone, altPhone, address, dateOfBirth, certifications, onboardingPin }),
    invalidate: [['app', 'listVenueStaff'], ['app', 'listStaffOnboarding'], ['app', 'listStaffAuditLog'], ['app', 'getDashboard']],
  },
  'app.deactivateVenueStaff': {
    path: (args) => `/v1/app/staff/${args.staffId ?? args.id ?? args}`,
    method: 'DELETE',
    invalidate: [['app', 'listVenueStaff'], ['app', 'listStaffAuditLog'], ['app', 'getDashboard']],
  },
  'app.updateStaffOnboardingTask': {
    path: (args) => `/v1/app/staff/onboarding/${args.taskId ?? args.id}`,
    method: 'PATCH',
    body: ({ status }) => ({ status }),
    invalidate: [['app', 'listStaffOnboarding'], ['app', 'listStaffAuditLog']],
  },
  'staffAuth.addVenueRole': {
    path: '/v1/app/venue-roles',
    method: 'POST',
    body: ({ name }) => ({ name }),
    invalidate: [['staffAuth', 'listVenueRoles']],
  },
  'staffAuth.removeVenueRole': {
    path: (args) => `/v1/app/venue-roles/${args.roleId ?? args.id ?? args}`,
    method: 'DELETE',
    invalidate: [['staffAuth', 'listVenueRoles']],
  },
  'invites.createInvite': {
    path: '/v1/app/invites',
    method: 'POST',
    body: ({ role, jobTitle }) => ({ role, jobTitle }),
    invalidate: [['app', 'listVenueStaff'], ['app', 'getDashboard']],
  },
  'app.parseStaffImport': {
    path: '/v1/app/staff/import/parse',
    method: 'POST',
    body: ({ text }) => ({ text }),
  },
  'app.commitStaffImport': {
    path: '/v1/app/staff/import/commit',
    method: 'POST',
    body: ({ venueId, items }) => ({ venueId, items }),
    invalidate: [['app', 'listVenueStaff'], ['app', 'listStaffOnboarding'], ['app', 'listStaffAuditLog'], ['app', 'getDashboard']],
  },
  'scheduling.previewAiSchedule': {
    path: (args) => `/v1/scheduling/ai-schedule/preview?weekStartDate=${encodeURIComponent(args?.weekStartDate ?? '')}`,
    method: 'GET',
  },
  'scheduling.commitAiSchedule': {
    path: '/v1/scheduling/ai-schedule/commit',
    method: 'POST',
    // Strip the preview-only display fields (dayLabel, startTime, endTime,
    // reason, memberName) — the API's ValidationPipe rejects unknown properties.
    body: ({ shifts, weekStartDate }) => ({
      weekStartDate,
      shifts: (shifts ?? []).map((s: any) => ({
        dayIndex: s.dayIndex,
        startMinutes: s.startMinutes,
        endMinutes: s.endMinutes,
        jobTitle: s.jobTitle,
        station: s.station,
        ...(s.profileId ? { profileId: s.profileId } : {}),
      })),
    }),
    invalidate: [['scheduling', 'getManagerSchedule'], ['scheduling', 'getLaborForecast']],
  },
  'operations.addLogbookEntry': {
    path: '/v1/operations/logbook',
    method: 'POST',
    body: ({ category, body, pinned }) => ({ category, body, pinned }),
    invalidate: [['operations', 'listLogbook']],
  },
  'operations.deleteLogbookEntry': {
    path: (args) => `/v1/operations/logbook/${args.id ?? args}`,
    method: 'DELETE',
    invalidate: [['operations', 'listLogbook']],
  },
  'operations.addChecklistItem': {
    path: '/v1/operations/checklist/items',
    method: 'POST',
    body: ({ kind, title, requiresPhoto }) => ({ kind, title, requiresPhoto }),
    invalidate: [['operations', 'getChecklist']],
  },
  'operations.removeChecklistItem': {
    path: (args) => `/v1/operations/checklist/items/${args.id ?? args}`,
    method: 'DELETE',
    invalidate: [['operations', 'getChecklist']],
  },
  'operations.completeChecklistItem': {
    path: (args) => `/v1/operations/checklist/complete/${args.completionId}`,
    method: 'POST',
    body: ({ photoBase64, photoMimeType }) => ({ photoBase64, photoMimeType }),
    invalidate: [['operations', 'getChecklist']],
  },
  'operations.generateExecutionWorkspace': {
    path: (args) => `/v1/operations/command-center/events/${args.eventId ?? args.id}/generate`,
    method: 'POST',
    body: () => ({}),
    invalidate: [['operations', 'getCommandCenter'], ['operations', 'getCommandCenterEvent']],
  },
  'operations.updateExecutionTask': {
    path: (args) => `/v1/operations/command-center/tasks/${args.taskId ?? args.id}`,
    method: 'PATCH',
    body: ({ status }) => ({ status }),
    invalidate: [['operations', 'getCommandCenter'], ['operations', 'getCommandCenterEvent'], ['operations', 'getDailyBrief'], ['barInventory', 'listPrepBoard']],
  },
  'operations.updateExecutionTimeline': {
    path: (args) => `/v1/operations/command-center/timeline/${args.itemId ?? args.id}`,
    method: 'PATCH',
    body: ({ status }) => ({ status }),
    invalidate: [['operations', 'getCommandCenterEvent']],
  },
  'operations.updateExecutionVendor': {
    path: (args) => `/v1/operations/command-center/vendors/${args.vendorId ?? args.id}`,
    method: 'PATCH',
    body: ({ status }) => ({ status }),
    invalidate: [['operations', 'getCommandCenterEvent']],
  },
  'operations.createExecutionIncident': {
    path: (args) => `/v1/operations/command-center/events/${args.eventId}/incidents`,
    method: 'POST',
    body: ({ title, severity, blocksReadiness }) => ({ title, severity, blocksReadiness }),
    invalidate: [['operations', 'getCommandCenterEvent']],
  },
  'operations.resolveExecutionIncident': {
    path: (args) => `/v1/operations/command-center/incidents/${args.incidentId ?? args.id}`,
    method: 'PATCH',
    body: ({ status }) => ({ status }),
    invalidate: [['operations', 'getCommandCenterEvent']],
  },
  'app.createStaffRequest': {
    path: '/v1/staff-requests',
    method: 'POST',
    body: stripVenue,
    invalidate: [['app', 'listStaffRequests'], ['staffRequests', 'list']],
  },
  'app.reviewStaffRequest': {
    path: (args) => `/v1/staff-requests/${args.requestId ?? args.id}`,
    method: 'PATCH',
    body: ({ status, responseNotes }) => ({ status, responseNotes }),
    invalidate: [['app', 'listStaffRequests'], ['staffRequests', 'list']],
  },
  'scheduling.addBlackout': {
    path: '/v1/scheduling/blackouts',
    method: 'POST',
    body: stripVenue,
    invalidate: [['scheduling', 'listBlackouts']],
  },
  'scheduling.removeBlackout': {
    path: (args) => `/v1/scheduling/blackouts/${args.blackoutId ?? args.id ?? args}`,
    method: 'DELETE',
    invalidate: [['scheduling', 'listBlackouts']],
  },
  'scheduling.createShift': {
    path: '/v1/scheduling/shifts',
    method: 'POST',
    body: stripVenue,
    invalidate: scheduleInvalidations(),
  },
  'scheduling.updateShift': {
    path: (args) => `/v1/scheduling/shifts/${args.shiftId ?? args.id}`,
    method: 'PATCH',
    body: stripVenueAndIds,
    invalidate: scheduleInvalidations(),
  },
  'scheduling.assignShift': {
    path: (args) => `/v1/scheduling/shifts/${args.shiftId ?? args.id}/assign`,
    method: 'PATCH',
    body: ({ profileId }) => ({ profileId }),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.unassignShift': {
    path: (args) => `/v1/scheduling/shifts/${args.shiftId ?? args.id}/assign`,
    method: 'PATCH',
    body: () => ({ profileId: undefined }),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.deleteShift': {
    path: (args) => `/v1/scheduling/shifts/${args.shiftId ?? args.id ?? args}`,
    method: 'DELETE',
    invalidate: scheduleInvalidations(),
  },
  'scheduling.publishSchedule': { path: '/v1/scheduling/publish', method: 'POST', body: ({ weekStart }) => ({ weekStart }), invalidate: scheduleInvalidations() },
  'scheduling.setLaborBudget': {
    path: '/v1/scheduling/labor-budget',
    method: 'PATCH',
    body: ({ weeklyLaborBudgetHours }) => ({ weeklyLaborBudgetHours }),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.saveScheduleTemplate': {
    path: '/v1/scheduling/templates',
    method: 'POST',
    body: ({ name, weekStart }) => ({ name, weekStart }),
    invalidate: [['scheduling', 'listScheduleTemplates']],
  },
  'scheduling.applyScheduleTemplate': {
    path: (args) => `/v1/scheduling/templates/${args.templateId ?? args.id}/apply`,
    method: 'POST',
    body: ({ replace, weekStart }) => ({ replace, weekStart }),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.deleteScheduleTemplate': {
    path: (args) => `/v1/scheduling/templates/${args.templateId ?? args.id ?? args}`,
    method: 'DELETE',
    invalidate: [['scheduling', 'listScheduleTemplates']],
  },
  'scheduling.copyDayShifts': { path: '/v1/scheduling/copy-day', method: 'POST', body: stripVenue, invalidate: scheduleInvalidations() },
  'scheduling.clearWeek': { path: '/v1/scheduling/clear-week', method: 'POST', body: ({ weekStart }) => ({ weekStart }), invalidate: scheduleInvalidations() },
  'scheduling.restoreShifts': { path: '/v1/scheduling/restore-shifts', method: 'POST', body: ({ shifts, weekStart }) => ({ shifts, weekStart }), invalidate: scheduleInvalidations() },
  'scheduling.addScheduleMemoryNote': {
    path: '/v1/scheduling/memory',
    method: 'POST',
    body: ({ title, detail, weekStart }) => ({ title, detail, weekStart }),
    invalidate: [['scheduling', 'listScheduleMemory']],
  },
  'scheduling.applyAutoSchedule': {
    path: '/v1/scheduling/auto-schedule/apply',
    method: 'POST',
    body: ({ assignments, weekStartDate }) => ({ assignments, weekStartDate }),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.claimOpenShift': {
    path: (args) => `/v1/scheduling/shifts/${args.shiftId ?? args.id}/claim`,
    method: 'POST',
    body: () => ({}),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.requestDropShift': {
    path: '/v1/staff-requests',
    method: 'POST',
    body: ({ shiftId }) => ({
      kind: 'drop_shift',
      title: 'Drop shift request',
      details: 'Requesting manager approval to drop this assigned shift.',
      requestedShiftId: shiftId,
    }),
    invalidate: [['app', 'listStaffRequests'], ...scheduleInvalidations()],
  },
  'scheduling.proposeShiftSwap': { path: '/v1/scheduling/swaps', method: 'POST', body: stripVenue, invalidate: scheduleInvalidations() },
  'scheduling.respondToShiftSwap': {
    path: (args) => `/v1/scheduling/swaps/${args.swapId ?? args.id}/respond`,
    method: 'PATCH',
    body: ({ accept }) => ({ accept }),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.reviewShiftSwap': {
    path: (args) => `/v1/scheduling/swaps/${args.swapId ?? args.id}/review`,
    method: 'PATCH',
    body: ({ approve }) => ({ approve }),
    invalidate: scheduleInvalidations(),
  },
  'pos.upsertPosConnection': { path: '/v1/pos/connections', method: 'POST', body: ({ provider, externalLocationId, status }) => ({ provider, externalLocationId, status }), invalidate: [['pos', 'getPosOverview']] },
  'pos.rotatePosConnectionSecret': { path: (args) => `/v1/pos/connections/${args.connectionId ?? args.id}/rotate-secret`, method: 'POST', body: () => ({}), invalidate: [['pos', 'getPosOverview']] },
  'pos.sync86Broadcast': { path: '/v1/pos/aggregator/sync-86', method: 'POST', body: ({ itemNames, category, reason }) => ({ itemNames, category, reason }), invalidate: [['pos', 'getMaster86List'], ['pos', 'getAggregatorStatus']] },
  'reservationIntegrations.upsertReservationConnection': { path: '/v1/integrations/reservations', method: 'POST', body: stripVenue, invalidate: [['reservationIntegrations', 'getReservationIntegrationOverview'], ['reservations', 'getReservationsPage']] },
  'guests.rotateLeadsWebhookSecret': { path: '/v1/guests/rotate-webhook-secret', method: 'POST', body: () => ({}), invalidate: [['guests', 'listGuests']] },
  'operations.upsertManagerGoal': { path: '/v1/operations/manager-goal', method: 'PATCH', body: stripVenue, invalidate: [['operations', 'getManagerDashboard']] },
  'barInventory.upsertBarItem': { path: '/v1/bar-inventory', method: 'POST', body: stripVenue, invalidate: [['barInventory', 'getBarStock']] },
  'barInventory.recordBarStockMovement': { path: (args) => `/v1/bar-inventory/${args.itemId}/movement`, method: 'POST', body: ({ movementType, quantity, notes }) => ({ movementType, quantity, notes }), invalidate: [['barInventory', 'getBarStock']], idempotent: true },
  'barInventory.importParsedBarItems': { path: '/v1/bar-inventory/import', method: 'POST', body: ({ items }) => ({ items }), invalidate: [['barInventory', 'getBarStock']] },
  'barInventory.parseBarInventoryInput': { path: '/v1/bar-inventory/parse', method: 'POST', body: ({ text, imageBase64, imageMimeType }) => ({ text, imageBase64, imageMimeType }) },
  'barInventory.updateItemCost': { path: (args) => `/v1/bar-inventory/${args.itemId}/cost`, method: 'PATCH', body: ({ unitCostCents }) => ({ unitCostCents }), invalidate: [['barInventory', 'getBarStock']] },
  'barInventory.lookupBySku': { path: (args) => `/v1/bar-inventory/sku/${encodeURIComponent(args.sku)}`, method: 'GET' },
  'barInventory.sendPurchaseOrderEmail': { path: '/v1/bar-inventory/purchase-order/send-email', method: 'POST', body: () => ({}) },
  'barInventory.sendInventoryDigest': { path: '/v1/bar-inventory/send-digest', method: 'POST', body: () => ({}) },
  'barInventory.upsertPrepBoardItem': {
    path: '/v1/bar-inventory/prep-board',
    method: 'POST',
    body: ({ itemId, kind, title, quantity, unit, station, notes, dueDate, status }) => ({ itemId, kind, title, quantity, unit, station, notes, dueDate, status }),
    invalidate: [['barInventory', 'listPrepBoard'], ['operations', 'getDailyBrief']],
  },
  'barInventory.updatePrepBoardItemStatus': {
    path: (args) => `/v1/bar-inventory/prep-board/${args.itemId ?? args.id}/status`,
    method: 'PATCH',
    body: ({ status }) => ({ status }),
    invalidate: [['barInventory', 'listPrepBoard'], ['operations', 'getDailyBrief']],
  },
  'chat.ensureChatSetup': { path: '/v1/chat/setup', method: 'POST', body: () => ({}), invalidate: [['chat', 'listConversations']] },
  'chat.openDm': { path: '/v1/chat/dm', method: 'POST', body: ({ targetProfileId }) => ({ targetProfileId }), invalidate: [['chat', 'listConversations']] },
  'chat.createGroup': { path: '/v1/chat/group', method: 'POST', body: ({ name, memberIds }) => ({ name, memberIds }), invalidate: [['chat', 'listConversations']] },
  'chat.deleteConversation': { path: (args) => `/v1/chat/conversations/${args.conversationId ?? args.id ?? args}`, method: 'DELETE', invalidate: [['chat', 'listConversations']] },
  'chat.sendMessage': { path: (args) => `/v1/chat/conversations/${args.conversationId}/messages`, method: 'POST', body: (args) => ({ text: args.text, shiftId: args.shiftId, swapId: args.swapId, imageUrl: args.imageUrl }), invalidate: [['chat', 'getMessages']] },
  'chat.toggleReaction': { path: (args) => `/v1/chat/messages/${args.messageId}/react`, method: 'POST', body: ({ emoji }) => ({ emoji }), invalidate: [['chat', 'getMessages']] },
  'chat.editMessage': { path: (args) => `/v1/chat/messages/${args.messageId}`, method: 'PATCH', body: ({ text }) => ({ text }), invalidate: [['chat', 'getMessages']] },
  'chat.uploadImage': { path: '/v1/chat/images', method: 'POST', body: ({ dataBase64, mimeType }) => ({ dataBase64, mimeType }) },
  'floor.saveFloorPlan': { path: '/v1/floor', method: 'POST', body: mapFloorPlanBody, invalidate: floorInvalidations() },
  'floor.clearActiveFloorPlan': { path: '/v1/floor', method: 'DELETE', invalidate: floorInvalidations() },
  'tables.markDirty': { path: (args) => `/v1/floor/tables/${args.tableId ?? args.id ?? args}/status`, method: 'PATCH', body: () => ({ status: 'dirty' }), invalidate: floorInvalidations() },
  'tables.markClean': { path: (args) => `/v1/floor/tables/${args.tableId ?? args.id ?? args}/status`, method: 'PATCH', body: () => ({ status: 'available' }), invalidate: floorInvalidations() },
  'tables.mergeTablesForParty': { path: '/v1/floor/tables/merge', method: 'POST', body: stripVenue, invalidate: floorActiveInvalidations() },
  'tables.splitMergedTables': { path: (args) => `/v1/floor/tables/merge-groups/${args.mergeGroupId ?? args.id ?? args}/split`, method: 'POST', body: () => ({}), invalidate: floorActiveInvalidations() },
  'floorBinding.releaseAssignment': { path: (args) => `/v1/floor/assignments/${args.assignmentId ?? args.tableId ?? args.id ?? args}`, method: 'DELETE', invalidate: floorInvalidations() },
  'floorBinding.assignReservationToTables': { path: '/v1/floor/assign-reservation', method: 'POST', body: ({ reservationId, tableIds, holdType, startsAt, endsAt }) => ({ reservationId, tableIds, holdType, startsAt, endsAt }), invalidate: floorInvalidations() },
  'floorBinding.addToWaitlist': { path: '/v1/floor/waitlist', method: 'POST', body: ({ guestName, partySize, phone, guestPhone, email, notes }) => ({ guestName, partySize, phone: phone ?? guestPhone, email, notes }), invalidate: floorWaitlistInvalidations() },
  'floorBinding.markWaitlistReady': { path: (args) => `/v1/floor/waitlist/${args.waitlistId ?? args.id ?? args}/ready`, method: 'PATCH', body: () => ({}), invalidate: floorWaitlistInvalidations() },
  'floorBinding.removeFromWaitlist': { path: (args) => `/v1/floor/waitlist/${args.waitlistId ?? args.id ?? args}`, method: 'DELETE', invalidate: floorWaitlistInvalidations() },
  'floorBinding.assignWaitlistToTables': {
    path: '/v1/floor/assign-waitlist',
    method: 'POST',
    body: ({ waitlistId, tableIds, holdType, startsAt, endsAt }) => ({ waitlistId, tableIds, holdType, startsAt, endsAt }),
    invalidate: floorInvalidations(),
  },
  'guests.upsertGuest': { path: '/v1/guests', method: 'POST', body: stripVenue, invalidate: [['guests', 'listGuests']] },
  'guests.ingestLeads': { path: '/v1/guests/ingest-leads', method: 'POST', body: ({ leads }) => ({ leads }), invalidate: [['guests', 'listGuests']] },
  'guests.removeGuest': { path: (args) => `/v1/guests/${args.guestId ?? args.id ?? args}`, method: 'DELETE', invalidate: [['guests', 'listGuests']] },
  'crm.saveLead': { path: '/v1/crm/leads', method: 'POST', body: stripVenue, invalidate: [['crm', 'listLeads']] },
  'crm.saveBeo': { path: '/v1/crm/beos', method: 'POST', body: stripVenue, invalidate: [['crm', 'listBeos']] },
  'crm.saveContract': { path: '/v1/crm/contracts', method: 'POST', body: stripVenue, invalidate: [['crm', 'listContracts']] },
  'crm.convertBeoToContract': { path: (args) => `/v1/crm/beos/${args.beoId ?? args.id}/convert`, method: 'POST', body: () => ({}), invalidate: [['crm', 'listBeos'], ['crm', 'listContracts']] },
  'crm.addNote': { path: (args) => `/v1/crm/leads/${args.leadId}/notes`, method: 'POST', body: ({ text }) => ({ text }), invalidate: [['crm', 'listLeads'], ['crm', 'getLeadActivity']] },
  'crm.emailBeo': {
    path: (args) => `/v1/crm/beos/${args.beoId}/email`,
    method: 'POST',
    body: ({ toEmail, message }) => ({ toEmail, message }),
    invalidate: [['crm', 'listBeos']],
  },
  'crm.saveTemplate': {
    path: '/v1/crm/templates',
    method: 'POST',
    body: stripVenue,
    invalidate: [['crm', 'listTemplates']],
  },
  'crm.deleteTemplate': {
    path: (args) => `/v1/crm/templates/${args.templateId}`,
    method: 'DELETE',
    invalidate: [['crm', 'listTemplates']],
  },
  'crm.renderTemplate': {
    path: (args) => `/v1/crm/templates/${args.templateId}/render`,
    method: 'POST',
    body: ({ leadId, beoId }) => ({ leadId, beoId }),
  },
  'reservations.saveReservation': { path: '/v1/reservations', method: 'POST', body: mapReservationBody, invalidate: [['reservations', 'getReservationsPage']] },
  'reservations.removeReservation': { path: (args) => `/v1/reservations/${args.reservationId ?? args.id ?? args}`, method: 'DELETE', invalidate: [['reservations', 'getReservationsPage']] },
  'reservations.createHold': {
    path: '/v1/reservations/holds',
    method: 'POST',
    body: ({ startsAt, endsAt, reason }) => ({ startsAt, endsAt, reason }),
    invalidate: [['reservations', 'listHolds']],
  },
  'reservations.deleteHold': {
    path: (args) => `/v1/reservations/holds/${args.holdId}`,
    method: 'DELETE',
    invalidate: [['reservations', 'listHolds']],
  },
  'payroll.recordPayrollExport': { path: '/v1/payroll/record-export', method: 'POST', body: stripVenue },
  'push.registerPushToken': {
    path: '/v1/push/token',
    method: 'POST',
    body: ({ token, platform }) => ({ token, platform }),
  },
  'documents.upload': {
    path: '/v1/documents',
    method: 'POST',
    body: ({ title, fileName, mimeType, category, dataBase64 }) => ({ title, fileName, mimeType, category, dataBase64 }),
    invalidate: [['documents', 'list']],
    timeoutMs: 120_000,
  },
  'documents.access': {
    path: (args) => `/v1/documents/${args.documentId ?? args.id}/access`,
    method: 'POST',
    body: () => ({}),
  },
  'documents.remove': {
    path: (args) => `/v1/documents/${args.documentId ?? args.id}`,
    method: 'DELETE',
    invalidate: [['documents', 'list']],
  },
};

export function useQuery<T = any>(ref: RailwayFunctionRef, args?: QueryArgs): T | undefined {
  const key = getKey(ref);
  const route = queryRoutes[key];
  if (!route) throw new Error(`Unknown Railway query route: ${key}`);
  const authEpoch = useAuthStore((state) => state.authEpoch);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const venueId = useAuthStore((state) => state.venue?.id ?? null);
  const token = useAuthStore((state) => state.token);
  // Never fire authenticated API queries without a session token — route
  // protection must not depend on every screen remembering to gate its query.
  const enabled = args !== 'skip' && Boolean(token);
  const query = useReactQuery({
    queryKey: [...key.split('.'), args, authEpoch, userId, venueId],
    enabled,
    queryFn: ({ signal }) => requestRoute<T>(route, args, signal),
  });
  // Loading/error leave data undefined — callers must treat as T | undefined.
  // Do not cast away undefined; that hid loading races and silent failures.
  return query.data;
}

export function useQueryState<T = any>(ref: RailwayFunctionRef, args?: QueryArgs) {
  const key = getKey(ref);
  const route = queryRoutes[key];
  if (!route) throw new Error(`Unknown Railway query route: ${key}`);
  const authEpoch = useAuthStore((state) => state.authEpoch);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const venueId = useAuthStore((state) => state.venue?.id ?? null);
  const token = useAuthStore((state) => state.token);
  const enabled = args !== 'skip' && Boolean(token);
  const query = useReactQuery({
    queryKey: [...key.split('.'), args, authEpoch, userId, venueId],
    enabled,
    queryFn: ({ signal }) => requestRoute<T>(route, args, signal),
  });
  return {
    data: query.data,
    error: query.error,
    isLoading: enabled && query.isLoading,
    refetch: query.refetch,
  };
}

export function useMutation<TArgs = any, TResult = any>(
  ref: RailwayFunctionRef,
): (args: TArgs) => Promise<TResult> {
  const key = getKey(ref);
  const route = mutationRoutes[key];
  const queryClient = useQueryClient();
  const mutation = useReactMutation({
    mutationFn: async (args: TArgs) => {
      if (!route) {
        throw new Error('This feature is still being moved to the Railway API.');
      }
      return requestRoute<TResult>(route, args);
    },
    onSuccess: async () => {
      const invalidations = route?.invalidate ?? [key.split('.')];
      await Promise.all(invalidations.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
  const mutateAsync = mutation.mutateAsync;
  return useCallback((args: TArgs) => mutateAsync(args), [mutateAsync]);
}

export function useAction<TArgs = any, TResult = any>(
  ref: RailwayFunctionRef,
): (args: TArgs) => Promise<TResult> {
  return useMutation<TArgs, TResult>(ref);
}

export function useAuthActions() {
  return {
    signIn: async () => {
      throw new Error('Use Railway password auth instead.');
    },
    signOut: async () => apiRequest<{ ok: true }>('/v1/auth/logout', { method: 'POST' }),
  };
}

function getKey(ref: RailwayFunctionRef) {
  return ref.__railwayKey;
}

async function requestRoute<T>(route: Route, args: any, signal?: AbortSignal): Promise<T> {
  const path = typeof route.path === 'function' ? route.path(args ?? {}) : route.path;
  const rawBody = route.method && route.method !== 'GET' && route.method !== 'DELETE' ? route.body?.(args ?? {}) ?? args ?? {} : undefined;
  const mutationId = route.idempotent || route.offline
    ? await createStableIdempotencyKey(`${route.method}\n${path}\n${stableStringify(rawBody ?? null)}`)
    : undefined;
  const body = mutationId
    && rawBody
    && typeof rawBody === 'object'
    && !Array.isArray(rawBody)
    && Object.prototype.hasOwnProperty.call(rawBody, 'clientMutationId')
    ? { ...(rawBody as Record<string, unknown>), clientMutationId: (rawBody as Record<string, unknown>).clientMutationId ?? mutationId }
    : rawBody;
  const request = apiRequest<T>(path, {
    method: route.method ?? 'GET',
    signal,
    timeoutMs: route.timeoutMs,
    body,
    headers: mutationId ? { 'Idempotency-Key': mutationId } : undefined,
  });
  if (!route.offline) return request;
  return request.catch(async (error) => {
    const transient = !(error instanceof Error && 'status' in error && typeof (error as { status?: unknown }).status === 'number' && ((error as { status: number }).status < 500 && (error as { status: number }).status !== 408 && (error as { status: number }).status !== 429));
    if (!transient || !route.method || route.method === 'GET') throw error;
    return enqueueOfflineMutation({
      path,
      method: route.method,
      body,
      idempotencyKey: mutationId!,
      entityKey: route.path === '/v1/stadium/events' ? 'event:create' : path,
    }) as T;
  });
}

function stripVenue(args: any) {
  const { venueId, ...rest } = args ?? {};
  return rest;
}

function stripVenueAndIds(args: any) {
  const { venueId, shiftId, id, ...rest } = args ?? {};
  return rest;
}

function locationBody(args: any) {
  return {
    lat: args.lat,
    lng: args.lng,
    accuracy: args.accuracy,
    mocked: args.mocked,
  };
}

function clockInvalidations() {
  return [['app', 'getClockBoard'], ['app', 'getDashboard'], ['app', 'getMyTimeClock']];
}

function floorActiveInvalidations() {
  return [['floor', 'getActiveFloorPlan'], ['floorBinding', 'getActiveFloorPlan']];
}

function floorWaitlistInvalidations() {
  return [['floorBinding', 'getOpenWaitlist']];
}

function floorInvalidations() {
  return [...floorActiveInvalidations(), ...floorWaitlistInvalidations(), ['floor', 'getFloorStats']];
}

function scheduleInvalidations() {
  return [['scheduling', 'getManagerSchedule'], ['scheduling', 'getLaborForecast'], ['scheduling', 'getMySchedule'], ['scheduling', 'getMyShiftSwaps'], ['scheduling', 'listShiftSwaps']];
}

function normalizeReservationTimeInput(value: unknown) {
  if (typeof value === 'number') return new Date(value).toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function mapReservationBody(args: any) {
  const { venueId, guestPhone, guestEmail, phone, email, reservationTime, ...rest } = args ?? {};
  return {
    ...rest,
    reservationTime: normalizeReservationTimeInput(reservationTime),
    phone: phone ?? guestPhone,
    email: email ?? guestEmail,
  };
}

function mapFloorPlanBody(args: any) {
  const { venueId, tables, chairs, name, width, height, backgroundImageUrl } = args ?? {};
  return {
    ...(name ? { name } : {}),
    ...(typeof width === 'number' ? { width } : {}),
    ...(typeof height === 'number' ? { height } : {}),
    ...(typeof backgroundImageUrl === 'string' ? { backgroundImageUrl } : {}),
    tables: (tables ?? []).map((table: any) => ({
      id: table.id,
      label: table.label,
      x: table.x,
      y: table.y,
      width: table.width,
      height: table.height,
      shape: table.shape,
      section: table.section,
      capacity: table.capacity ?? table.seats,
      seatLabelStyle: table.seatLabelStyle,
      rotation: table.rotation,
      minSpend: table.minSpend,
      isReservable: table.isReservable,
    })),
    chairs: (chairs ?? []).map((chair: any) => ({
      x: chair.x,
      y: chair.y,
      rotation: chair.rotation,
      ...(chair.label ? { label: chair.label } : {}),
    })),
  };
}

export function useStadiumLiveStream(facilityId: string | null | undefined, zoneId?: string) {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const [connected, setConnected] = useState(false);
  const [lastSeq, setLastSeq] = useState<number | null>(null);
  const lastEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!facilityId || !token) return;

    // EventSource is not polyfilled in React Native — only native web has it.
    if (typeof EventSource === 'undefined') {
      return;
    }

    let active = true;
    let eventSource: EventSource | null = null;
    let retryDelay = 1000;

    async function connect() {
      if (!active || !facilityId || !token) return;
      const fId = String(facilityId);

      // Always require a short-lived single-use stream ticket; never put the
      // session JWT in the URL where access logs would capture it.
      let ticket: string | undefined;
      try {
        const ticketRes = await apiRequest<{ ticket: string }>(
          `/v1/stadium/facilities/${encodeURIComponent(fId)}/ticket${zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : ''}`,
          { method: 'POST' }
        );
        ticket = ticketRes?.ticket;
      } catch {
        // Surfaced via the disconnected state; the stream will not connect
        // without a valid ticket.
      }
      if (!active) return;
      if (!ticket) {
        setConnected(false);
        return;
      }

      const queryParams: string[] = [`ticket=${encodeURIComponent(ticket)}`];
      if (zoneId) queryParams.push(`zoneId=${encodeURIComponent(zoneId)}`);
      const lastId = lastEventIdRef.current;
      if (lastId) queryParams.push(`lastEventId=${encodeURIComponent(lastId)}`);

      const url = `${getApiBaseUrl()}/v1/stadium/facilities/${encodeURIComponent(fId)}/live-stream?${queryParams.join('&')}`;

      eventSource = new EventSource(url);

      eventSource.onopen = () => {
        if (!active) return;
        setConnected(true);
        retryDelay = 1000;
      };

      eventSource.onmessage = (event) => {
        if (!active) return;
        if (event.lastEventId) {
          lastEventIdRef.current = event.lastEventId;
        }
        try {
          const payload = JSON.parse(event.data);
          if (typeof payload?.seq === 'number') {
            setLastSeq(payload.seq);
          }
          queryClient.invalidateQueries({ queryKey: ['stadium', 'getOverview'] });
          queryClient.invalidateQueries({ queryKey: ['stadium', 'listEventIssues'] });
          queryClient.invalidateQueries({ queryKey: ['stadium', 'getPilotHealth'] });
        } catch {
          // ignore malformed frame
        }
      };

      eventSource.onerror = () => {
        if (!active) return;
        setConnected(false);
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        if (active) {
          setTimeout(() => void connect(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      };
    }

    void connect();

    return () => {
      active = false;
      setConnected(false);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, [facilityId, zoneId, token, queryClient]);

  return { connected, lastSeq };
}

