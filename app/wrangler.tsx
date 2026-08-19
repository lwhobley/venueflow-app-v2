import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { CommandButton, CommandText } from '../components/FutureUI';
import { Skeleton } from '../components/Skeleton';
import { WranglerAiUsagePanel } from '../components/WranglerAiUsagePanel';
import { WranglerIntelligencePanel } from '../components/WranglerIntelligencePanel';
import { WranglerShiftStory } from '../components/WranglerShiftStory';
import { spacing, useDesignTheme } from '../lib/theme';
import { useExecuteWranglerAction, useWrangler, type WranglerAction, type WranglerPriority, type WranglerSeverity } from '../lib/useWrangler';

// Server-supplied routes are typed but not runtime-validated; only navigate to
// known in-app destinations so a malformed response can't route the app
// anywhere unexpected. Keep in sync with the routes the API emits.
const ALLOWED_WRANGLER_ROUTES = new Set([
  '/stadium-map',
  '/event-command-center',
  '/stadium/stand-sheet',
  '/stadium/suite-attendant',
  '/stadium/kds',
  '/stadium/commissary',
  '/stadium/labor-dashboard',
  '/event-issues',
  '/event-closeout',
  '/bar-stock',
  '/facility',
  '/reports',
  '/schedule',
  '/staff',
]);
function pushWranglerRoute(route: unknown) {
  if (typeof route === 'string' && ALLOWED_WRANGLER_ROUTES.has(route)) router.push(route as never);
}
function severityLabel(severity: WranglerSeverity) { if (severity === 'critical') return 'CRITICAL'; if (severity === 'warning') return 'ATTENTION'; if (severity === 'watch') return 'WATCH'; return 'CLEAR'; }
function iconFor(priority: WranglerPriority) { if (priority.kind === 'coverage') return 'account-alert-outline' as const; if (priority.kind === 'stock') return 'bottle-wine-outline' as const; if (priority.kind === 'event') return 'calendar-clock-outline' as const; if (priority.kind === 'requests') return 'clipboard-clock-outline' as const; if (priority.kind === 'floor') return 'stadium' as const; return 'check-circle-outline' as const; }

export default function WranglerScreen() {
  const params = useLocalSearchParams<{ q?: string; command?: string }>();
  const initialQuery = typeof params.q === 'string' ? params.q : undefined;
  const initialCommand = typeof params.command === 'string' ? params.command : undefined;
  const palette = useDesignTheme(); const wrangler = useWrangler(true); const executeAction = useExecuteWranglerAction(); const snapshot = wrangler.data;
  const createFollowUp = (priority: WranglerPriority) => {
    const run = async () => {
      try {
        const result = await executeAction.mutateAsync({ type: 'CREATE_FOLLOW_UP', priorityId: priority.id });
        Alert.alert(result.existing ? 'Follow-up already exists' : 'Follow-up created', result.title ?? `Wrangler: ${priority.title}`);
      } catch (error) {
        Alert.alert('Could not create follow-up', error instanceof Error ? error.message : 'The manager follow-up could not be created.');
      }
    };
    Alert.alert('Create follow-up?', `Add “${priority.title}” to today’s manager action items?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Create follow-up', onPress: () => void run() }]);
  };
  const handleAction = (action: WranglerAction) => {
    if (action.type === 'NAVIGATE' || action.type === 'ACKNOWLEDGE') { pushWranglerRoute(action.route); return; }
    if (action.type === 'NOTIFY_STAFF') {
      const run = async () => { try { const result = await executeAction.mutateAsync({ type: 'NOTIFY_STAFF' }); Alert.alert('Staff notified', `${result.openShifts ?? 'Open'} shift coverage alert sent to venue staff.`); } catch (error) { Alert.alert('Could not notify staff', error instanceof Error ? error.message : 'The staff notification could not be sent.'); } };
      if (action.requiresConfirmation) Alert.alert('Notify staff?', 'Send a coverage alert to venue staff about the currently open shifts?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Notify staff', onPress: () => void run() }]); else void run();
      return;
    }
    if (action.type === 'REASSIGN_RESERVATION') {
      const reservationId = typeof action.payload?.reservationId === 'string' ? action.payload.reservationId : null; const tableId = typeof action.payload?.tableId === 'string' ? action.payload.tableId : null; const tableLabel = typeof action.payload?.tableLabel === 'string' ? action.payload.tableLabel : 'the alternate table';
      if (!reservationId || !tableId) { Alert.alert('Action unavailable', 'The Wrangler recommendation is missing the table assignment details.'); return; }
      const run = async () => { try { await executeAction.mutateAsync({ type: 'REASSIGN_RESERVATION', reservationId, tableId }); Alert.alert('Reservation moved', `The reservation is now assigned to ${tableLabel}.`); } catch (error) { Alert.alert('Could not move reservation', error instanceof Error ? error.message : 'The table assignment could not be changed.'); } };
      if (action.requiresConfirmation) Alert.alert('Move reservation?', `Reassign this reservation to ${tableLabel}? Venue Wrangler will recheck table conflicts before saving.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Move reservation', onPress: () => void run() }]); else void run();
    }
  };
  if (wrangler.isError) return <View style={{ flex: 1, backgroundColor: palette.background, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}><MaterialCommunityIcons name="alert-circle-outline" size={32} color={palette.warning} /><CommandText palette={palette} variant="title">The Wrangler could not load</CommandText><CommandText palette={palette} variant="body">The live service snapshot is unavailable right now.</CommandText><CommandButton palette={palette} onPress={() => router.back()}>Go back</CommandButton></View>;
  if (wrangler.isLoading || !snapshot) return <View style={{ flex: 1, backgroundColor: palette.background, padding: spacing.lg, gap: spacing.md }}><Skeleton height={34} style={{ borderRadius: 8 }} /><Skeleton height={92} style={{ borderRadius: 8 }} /><Skeleton height={180} style={{ borderRadius: 8 }} /></View>;
  const summary = snapshot.summary; const statusCopy = snapshot.status === 'critical' ? 'Immediate attention required' : snapshot.status === 'attention' ? 'Service needs attention' : snapshot.status === 'watch' ? 'Keep an eye on service' : 'Service is under control';
  return <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg, backgroundColor: '#F5EFE4', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.divider }}><CommandText palette={palette} variant="label" style={{ color: '#7A5A35' }}>{snapshot.venue.name} · {snapshot.servicePhaseLabel.toUpperCase()}</CommandText><View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 }}><MaterialCommunityIcons name="target" size={28} color="#7A5A35" /><CommandText palette={palette} variant="hero">The Wrangler</CommandText></View><CommandText palette={palette} variant="body" style={{ marginTop: spacing.sm, color: palette.muted }}>{statusCopy}. {snapshot.priorities.length} prioritized item{snapshot.priorities.length === 1 ? '' : 's'} in the current service picture.</CommandText></View>
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.lg }}>
      <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingVertical: spacing.md }}>{[
        ['Concessions Par', summary.lowStockItems ? `${summary.lowStockItems} Low` : 'Nominal'],
        ['Suite BEOs', summary.vipArrivals ? `${summary.vipArrivals} Active` : 'Ready'],
        ['Open Shifts', String(summary.openShifts)],
        ['86 Items', String(summary.eightySixItems)],
      ].map(([label, value], index) => <View key={label} style={{ flex: 1, paddingHorizontal: spacing.sm, borderLeftWidth: index ? StyleSheet.hairlineWidth : 0, borderColor: palette.divider, gap: 2 }}><CommandText palette={palette} variant="title">{value}</CommandText><CommandText palette={palette} variant="caption">{label}</CommandText></View>)}</View>
      <WranglerShiftStory snapshot={snapshot} />
      <View style={{ gap: spacing.sm }}><CommandText palette={palette} variant="title">Needs wrangling</CommandText><CommandText palette={palette} variant="caption">Prioritized by operational impact, not by which module happened to notice first.</CommandText></View>
      <View style={{ gap: spacing.md }}>{snapshot.priorities.map((priority) => { const urgent = priority.severity === 'critical' || priority.severity === 'warning'; const accent = urgent ? palette.warning : priority.severity === 'watch' ? '#8A6B2D' : palette.success; const action = priority.actions[0]; const pendingLabel = action?.type === 'REASSIGN_RESERVATION' ? 'Moving…' : action?.type === 'NOTIFY_STAFF' ? 'Notifying…' : action?.label; return <View key={priority.id} style={{ backgroundColor: palette.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderLeftWidth: 4, borderLeftColor: accent, padding: spacing.md, gap: spacing.sm }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}><MaterialCommunityIcons name={iconFor(priority)} size={22} color={accent} /><View style={{ flex: 1 }}><CommandText palette={palette} variant="label" style={{ color: accent }}>{severityLabel(priority.severity)}</CommandText><CommandText palette={palette} variant="title">{priority.title}</CommandText></View></View><CommandText palette={palette} variant="body">{priority.body}</CommandText><View style={{ backgroundColor: palette.background, padding: spacing.sm, borderRadius: 6, gap: 2 }}><CommandText palette={palette} variant="label">Why it matters</CommandText><CommandText palette={palette} variant="caption">{priority.reason}</CommandText></View><View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>{action ? <CommandButton palette={palette} selected={urgent} onPress={() => handleAction(action)}>{executeAction.isPending ? pendingLabel : action.label}</CommandButton> : null}{priority.kind !== 'steady' ? <CommandButton palette={palette} onPress={() => createFollowUp(priority)}>Create follow-up</CommandButton> : null}<CommandButton palette={palette} onPress={() => pushWranglerRoute(priority.route)}>View details</CommandButton></View></View>; })}</View>
      <WranglerIntelligencePanel snapshot={snapshot} initialQuery={initialQuery} initialCommand={initialCommand} />
      <WranglerAiUsagePanel />
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingTop: spacing.md, gap: 4 }}><CommandText palette={palette} variant="label">Service risks</CommandText><CommandText palette={palette} variant="caption">{summary.openShifts} open shifts · {summary.lowStockItems} low-stock items · {summary.eightySixItems} 86'd · {summary.pendingStaffRequests} pending staff requests</CommandText></View>
    </View>
  </ScrollView>;
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
