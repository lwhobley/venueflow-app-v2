import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, TextInput } from 'react-native-paper';
import { useMutation, useQueryState } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import { CommandButton, CommandSurface, CommandText, StatusPill } from '../components/FutureUI';
import { colors, spacing, useDesignTheme } from '../lib/theme';

type EventWorkspace = {
  workspaceId: string;
  event: { title: string; startsAt: number; endsAt: number | null; expectedGuests: number | null; space: string | null; setupStyle: string | null };
  readiness: { score: number; status: 'on-track' | 'blocked'; categories: Record<string, number> };
  blockers: Array<{ code: string; title: string; detail: string; targetId?: string }>;
  tasks: Array<{ _id: string; title: string; station: string | null; status: string; completedAt: number | null }>;
  staffing: { scheduled: number; open: number; covered: number };
  floor: { assigned: boolean; tableIds: string[] };
  timeline: Array<{ _id: string; title: string; startsAt: number; status: string }>;
  vendors: Array<{ _id: string; name: string; status: string; dueAt: number | null }>;
  incidents: Array<{ _id: string; title: string; severity: string; status: string; blocksReadiness: boolean }>;
};

export default function EventCommandCenterScreen() {
  const params = useLocalSearchParams<{ eventId?: string }>();
  const eventId = typeof params.eventId === 'string' ? params.eventId : '';
  const palette = useDesignTheme();
  const generateWorkspace = useMutation<{ eventId: string }, { workspaceId: string }>(api.operations.generateExecutionWorkspace);
  const [generationState, setGenerationState] = useState<'loading' | 'ready' | 'error'>('loading');
  const workspaceQuery = useQueryState<EventWorkspace>(api.operations.getCommandCenterEvent, eventId && generationState === 'ready' ? { eventId } : 'skip');
  const workspace = workspaceQuery.data;
  const updateTask = useMutation(api.operations.updateExecutionTask);
  const updateTimeline = useMutation(api.operations.updateExecutionTimeline);
  const updateVendor = useMutation(api.operations.updateExecutionVendor);
  const createIncident = useMutation(api.operations.createExecutionIncident);
  const resolveIncident = useMutation(api.operations.resolveExecutionIncident);
  const [incidentTitle, setIncidentTitle] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const prepareWorkspace = async () => {
    if (!eventId) {
      setGenerationState('error');
      return;
    }
    setGenerationState('loading');
    try {
      await generateWorkspace({ eventId });
      setGenerationState('ready');
    } catch {
      setGenerationState('error');
    }
  };

  useEffect(() => {
    void prepareWorkspace();
    // The event id is the only input that should regenerate this workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const runAction = async (key: string, action: () => Promise<unknown>) => {
    setPendingAction(key);
    setActionError(null);
    try {
      await action();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The update could not be saved.');
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  if (generationState === 'error' || workspaceQuery.error) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent', padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
        <CommandText palette={palette} variant="title">Event workspace unavailable</CommandText>
        <CommandText palette={palette} variant="caption">{workspaceQuery.error instanceof Error ? workspaceQuery.error.message : 'The workspace could not be prepared.'}</CommandText>
        <Button mode="contained" buttonColor={palette.primary} textColor={colors.surface} onPress={() => void prepareWorkspace()}>Try again</Button>
      </View>
    );
  }

  if (!workspace || generationState === 'loading' || workspaceQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent', padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
        <CommandText palette={palette} variant="title">Loading event workspace…</CommandText>
        <CommandText palette={palette} variant="caption">Pulling the live event brief, staffing, floor, and execution tasks.</CommandText>
      </View>
    );
  }

  const { event, readiness } = workspace;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: 'transparent' }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <CommandButton palette={palette} icon="arrow-left" onPress={() => router.back()}>Back</CommandButton>
        <View style={{ flex: 1 }}>
          <CommandText palette={palette} variant="label">Event command center</CommandText>
          <CommandText palette={palette} variant="hero">{event.title}</CommandText>
        </View>
        <StatusPill palette={palette} tone={readiness?.status === 'blocked' ? 'warn' : 'good'}>{`${readiness?.score ?? 0}% ready`}</StatusPill>
      </View>

      {actionError ? (
        <CommandSurface palette={palette} style={{ borderColor: palette.warning }}>
          <CommandText palette={palette} variant="body">{actionError}</CommandText>
        </CommandSurface>
      ) : null}

      <CommandSurface palette={palette} strong style={{ gap: spacing.sm, borderColor: readiness?.status === 'blocked' ? palette.warning : palette.primary }}>
        <CommandText palette={palette} variant="caption">
          {new Date(event.startsAt).toLocaleString()} · {event.expectedGuests ?? '—'} guests{event.space ? ` · ${event.space}` : ''}
        </CommandText>
        {event.setupStyle ? <StatusPill palette={palette}>{event.setupStyle}</StatusPill> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {Object.entries(readiness?.categories ?? {}).map(([key, value]) => (
            <View key={key} style={{ flexGrow: 1, flexBasis: 120, backgroundColor: palette.surfaceSoft, borderRadius: 10, padding: spacing.sm }}>
              <CommandText palette={palette} variant="metric">{`${value}%`}</CommandText>
              <CommandText palette={palette} variant="caption">{key}</CommandText>
            </View>
          ))}
        </View>
      </CommandSurface>

      {workspace.blockers.length > 0 ? (
        <CommandSurface palette={palette} style={{ gap: spacing.sm, borderColor: palette.warning }}>
          <StatusPill palette={palette} tone="warn">Action queue</StatusPill>
          {workspace.blockers.slice(0, 8).map((blocker) => (
            <View key={`${blocker.code}-${blocker.title}`} style={{ padding: spacing.sm, backgroundColor: blocker.code === 'OPEN_EXECUTION_TASK' ? '#FDE7E9' : palette.surfaceSoft, borderRadius: 10 }}>
              <CommandText palette={palette} variant="body">{blocker.title}</CommandText>
              <CommandText palette={palette} variant="caption">{blocker.detail}</CommandText>
              {blocker.code === 'OPEN_SHIFT' ? (
                <Button compact mode="outlined" textColor={palette.primary} onPress={() => router.push('/(tabs)/schedule')}>Open schedule</Button>
              ) : blocker.code === 'UNASSIGNED_TABLE' ? (
                <Button compact mode="outlined" textColor={palette.primary} onPress={() => router.push('/reservations')}>Open floor assignments</Button>
              ) : blocker.code === 'BEO_NOT_CONFIRMED' ? (
                <Button compact mode="outlined" textColor={palette.primary} onPress={() => router.push('/(tabs)/guests')}>Open event brief</Button>
              ) : null}
            </View>
          ))}
        </CommandSurface>
      ) : null}

      <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">Execution tasks</CommandText>
        {workspace.tasks.length === 0 ? <CommandText palette={palette} variant="caption">No generated tasks yet.</CommandText> : null}
        {workspace.tasks.map((task) => {
          const done = task.status === 'done';
          return (
            <View key={task._id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: palette.border }}>
              <View style={{ flex: 1 }}>
                <CommandText palette={palette} variant="body" style={{ textDecorationLine: done ? 'line-through' : 'none' }}>{task.title}</CommandText>
                <CommandText palette={palette} variant="caption">{task.station || 'Operations'}</CommandText>
              </View>
              <Button disabled={pendingAction !== null} compact mode={done ? 'outlined' : 'contained'} buttonColor={done ? undefined : palette.primary} textColor={done ? palette.primary : colors.surface} onPress={() => void runAction(`task-${task._id}`, () => updateTask({ taskId: task._id, status: done ? 'open' : 'done' }))}>
                {done ? 'Reopen' : 'Complete'}
              </Button>
            </View>
          );
        })}
      </CommandSurface>

      <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">Run of show</CommandText>
        {workspace.timeline.map((item) => {
          const done = item.status === 'done';
          return (
            <View key={item._id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: palette.border, paddingVertical: spacing.xs }}>
              <View style={{ flex: 1 }}>
                <CommandText palette={palette} variant="body">{item.title}</CommandText>
                <CommandText palette={palette} variant="caption">{new Date(item.startsAt).toLocaleString()}</CommandText>
              </View>
              <Button disabled={pendingAction !== null} compact mode={done ? 'outlined' : 'contained'} buttonColor={done ? undefined : palette.primary} textColor={done ? palette.primary : colors.surface} onPress={() => void runAction(`timeline-${item._id}`, () => updateTimeline({ itemId: item._id, status: done ? 'pending' : 'done' }))}>{done ? 'Reopen' : 'Done'}</Button>
            </View>
          );
        })}
      </CommandSurface>

      <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">Vendors</CommandText>
        {workspace.vendors.map((vendor) => (
          <View key={vendor._id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View style={{ flex: 1 }}><CommandText palette={palette} variant="body">{vendor.name}</CommandText><CommandText palette={palette} variant="caption">{vendor.status}</CommandText></View>
            <Button disabled={pendingAction !== null} compact mode="contained" buttonColor={palette.primary} textColor={colors.surface} onPress={() => void runAction(`vendor-${vendor._id}`, () => updateVendor({ vendorId: vendor._id, status: vendor.status === 'arrived' ? 'unconfirmed' : 'arrived' }))}>{vendor.status === 'arrived' ? 'Reopen' : 'Mark arrived'}</Button>
          </View>
        ))}
      </CommandSurface>

      <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">Incidents</CommandText>
        {workspace.incidents.map((incident) => (
          <View key={incident._id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View style={{ flex: 1 }}><CommandText palette={palette} variant="body">{incident.title}</CommandText><CommandText palette={palette} variant="caption">{incident.status} · {incident.severity}</CommandText></View>
            <Button disabled={pendingAction !== null} compact mode="outlined" textColor={palette.primary} onPress={() => void runAction(`incident-${incident._id}`, () => resolveIncident({ incidentId: incident._id, status: incident.status === 'resolved' ? 'open' : 'resolved' }))}>{incident.status === 'resolved' ? 'Reopen' : 'Resolve'}</Button>
          </View>
        ))}
        <TextInput mode="outlined" label="Add incident" value={incidentTitle} onChangeText={setIncidentTitle} style={{ backgroundColor: palette.surfaceSoft }} />
        <Button mode="contained" buttonColor={palette.primary} textColor={colors.surface} disabled={!incidentTitle.trim() || pendingAction !== null} onPress={() => void (async () => {
          const saved = await runAction('new-incident', () => createIncident({ eventId, title: incidentTitle.trim(), severity: 'high', blocksReadiness: true }));
          if (saved) setIncidentTitle('');
        })()}>Log blocking incident</Button>
      </CommandSurface>

      <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">Coverage and floor</CommandText>
        <CommandText palette={palette} variant="body">Staffing: {workspace.staffing.covered}/{workspace.staffing.scheduled || '—'} covered{workspace.staffing.open ? ` · ${workspace.staffing.open} open` : ''}</CommandText>
        <CommandText palette={palette} variant="body">Floor assignment: {workspace.floor.assigned ? 'Ready' : 'Missing'}</CommandText>
      </CommandSurface>

      <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">Post-event</CommandText>
        <CommandText palette={palette} variant="caption">Reconcile attendance, sales, labor, and inventory after the event.</CommandText>
        <Button mode="contained" buttonColor={palette.primary} textColor={colors.surface} onPress={() => router.push({ pathname: '/event-closeout', params: { eventId } })}>Open closeout</Button>
      </CommandSurface>

      <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">NFL game-day tools</CommandText>
        <Button mode="outlined" textColor={palette.primary} onPress={() => router.push({ pathname: '/nfl-brief', params: { eventId } })}>Open NFL game-day brief</Button>
      </CommandSurface>
    </ScrollView>
  );
}
