import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button } from 'react-native-paper';
import { CommandSurface, CommandText, StatusPill } from '../components/FutureUI';
import { api } from '../lib/railway-api';
import { useQueryState } from '../lib/railway-hooks';
import { spacing, useDesignTheme } from '../lib/theme';

type Health = { activeEvents: number; outletReadinessPercent: number; openCriticalIssues: number; unresolvedIssues: number; closeoutStatus: { draft: number; finalized: number; adjusted: number }; userActivity24h: { total: number; uniqueUsers: number }; eventsByState: Record<string, number>; generatedAt: string };

export default function PilotHealthScreen() {
  const palette = useDesignTheme();
  const query = useQueryState<Health>(api.stadium.getPilotHealth, {});
  const health = query.data;
  return <ScrollView style={{ flex: 1, backgroundColor: 'transparent' }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><View><CommandText palette={palette} variant="label">Pilot operations</CommandText><CommandText palette={palette} variant="hero">Pilot Health</CommandText></View><Button mode="text" textColor={palette.primary} onPress={() => router.back()}>Back</Button></View>
    {query.error ? <CommandSurface palette={palette}><CommandText palette={palette} variant="body">{query.error instanceof Error ? query.error.message : 'Pilot Health is unavailable for this role.'}</CommandText></CommandSurface> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>{[['Active events', health?.activeEvents ?? 0], ['Readiness', `${health?.outletReadinessPercent ?? 0}%`], ['Critical issues', health?.openCriticalIssues ?? 0], ['Unresolved', health?.unresolvedIssues ?? 0]].map(([label, value]) => <CommandSurface key={String(label)} palette={palette} style={{ flexGrow: 1, flexBasis: 140 }}><CommandText palette={palette} variant="caption">{label}</CommandText><CommandText palette={palette} variant="metric">{String(value)}</CommandText></CommandSurface>)}</View>
    <CommandSurface palette={palette} style={{ gap: spacing.sm }}><CommandText palette={palette} variant="title">Closeout status</CommandText><View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}><StatusPill palette={palette}>Draft {health?.closeoutStatus.draft ?? 0}</StatusPill><StatusPill palette={palette} tone="good">Finalized {health?.closeoutStatus.finalized ?? 0}</StatusPill><StatusPill palette={palette} tone="warn">Adjusted {health?.closeoutStatus.adjusted ?? 0}</StatusPill></View></CommandSurface>
    <CommandSurface palette={palette} style={{ gap: spacing.xs }}><CommandText palette={palette} variant="title">Event states</CommandText>{Object.entries(health?.eventsByState ?? {}).map(([state, count]) => <CommandText key={state} palette={palette} variant="body">{state.replaceAll('_', ' ')}: {count}</CommandText>)}</CommandSurface>
    <CommandSurface palette={palette}><CommandText palette={palette} variant="title">User activity, last 24 hours</CommandText><CommandText palette={palette} variant="body">{health?.userActivity24h.total ?? 0} audit events from {health?.userActivity24h.uniqueUsers ?? 0} users.</CommandText><CommandText palette={palette} variant="caption">Refreshes from the immutable event audit trail.</CommandText></CommandSurface>
  </ScrollView>;
}
