import { useLocalSearchParams, router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button } from 'react-native-paper';
import { CommandSurface, CommandText, StatusPill } from '../components/FutureUI';
import { api } from '../lib/railway-api';
import { useQueryState } from '../lib/railway-hooks';
import { spacing, useDesignTheme } from '../lib/theme';

type Brief = { event: { title: string; opponentOrHeadliner?: string | null }; phases: Array<{ key: string; label: string; at: string }>; activation: Array<{ id: string; name: string; department: string; stadiumZone?: string | null; readiness: string }>; openIssues: Array<{ title: string; severity: string }>; controls: string[]; assumptions: string[] };
export default function NflBriefScreen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>(); const palette = useDesignTheme();
  const query = useQueryState<Brief>(api.stadium.getNflBrief, eventId ? { eventId } : 'skip'); const brief = query.data;
  return <ScrollView style={{ flex: 1, backgroundColor: 'transparent' }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}><Button mode="text" textColor={palette.primary} onPress={() => router.back()}>Back</Button><CommandSurface palette={palette} strong style={{ gap: spacing.xs }}><CommandText palette={palette} variant="label">NFL game-day brief</CommandText><CommandText palette={palette} variant="hero">{brief?.event?.title ?? 'Loading game brief'}</CommandText><CommandText palette={palette} variant="caption">{brief?.event?.opponentOrHeadliner ?? 'Opponent not set'}</CommandText></CommandSurface><CommandSurface palette={palette} style={{ gap: spacing.sm }}><CommandText palette={palette} variant="title">Game phases</CommandText>{brief?.phases?.map((phase) => <View key={phase.key} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: palette.border, paddingVertical: spacing.xs }}><CommandText palette={palette} variant="body" style={{ flex: 1, minWidth: 140 }}>{phase.label}</CommandText><CommandText palette={palette} variant="caption">{new Date(phase.at).toLocaleTimeString()}</CommandText></View>)}</CommandSurface><CommandSurface palette={palette} style={{ gap: spacing.xs }}><CommandText palette={palette} variant="title">Activation by department</CommandText>{brief?.activation?.map((outlet) => <View key={outlet.id} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}><View style={{ flex: 1, minWidth: 160 }}><CommandText palette={palette} variant="body">{outlet.name}</CommandText><CommandText palette={palette} variant="caption">{outlet.department} · {outlet.stadiumZone ?? 'Unzoned'}</CommandText></View><StatusPill palette={palette} tone={outlet.readiness === 'ready' ? 'good' : 'warn'}>{outlet.readiness}</StatusPill></View>)}</CommandSurface><CommandSurface palette={palette} style={{ gap: spacing.xs }}><CommandText palette={palette} variant="title">Critical controls</CommandText>{brief?.controls?.map((control) => <CommandText key={control} palette={palette} variant="body">• {control}</CommandText>)}</CommandSurface></ScrollView>;
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
