import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View, Pressable } from 'react-native';
import { Button, TextInput, Card, Text, Chip, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQueryState } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import { CommandButton, CommandSurface, CommandText, StatusPill } from '../components/FutureUI';
import { colors, spacing, useDesignTheme, radius } from '../lib/theme';
import { useResponsive } from '../lib/responsive';

export default function EventCommandCenterScreen() {
  const params = useLocalSearchParams<{ eventId?: string }>();
  const initialEventId = typeof params.eventId === 'string' ? params.eventId : '';
  const [selectedEventId, setSelectedEventId] = useState<string>(initialEventId);
  const palette = useDesignTheme();
  const { pagePadding, isPhone } = useResponsive();
  const masterQuery = useQueryState(api.operations.getCommandCenter);
  const masterData = masterQuery.data as any;
  const generateWorkspace = useMutation(api.operations.generateExecutionWorkspace);
  const [generationState, setGenerationState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const workspaceQuery = useQueryState(api.operations.getCommandCenterEvent, selectedEventId ? { eventId: selectedEventId } : 'skip');
  const workspace = workspaceQuery.data as any;
  const updateTask = useMutation(api.operations.updateExecutionTask);
  const updateTimeline = useMutation(api.operations.updateExecutionTimeline);
  const createIncident = useMutation(api.operations.createExecutionIncident);
  const resolveIncident = useMutation(api.operations.resolveExecutionIncident);
  const [incidentTitle, setIncidentTitle] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedEventId) { setGenerationState('idle'); return; }
    let isMounted = true;
    const prepare = async () => {
      setGenerationState('loading');
      try { await generateWorkspace({ eventId: selectedEventId }); if (isMounted) setGenerationState('ready'); }
      catch { if (isMounted) setGenerationState('ready'); }
    };
    void prepare();
    return () => { isMounted = false; };
  }, [selectedEventId]);

  const runAction = async (key: string, action: () => Promise<unknown>) => {
    setPendingAction(key); setActionError(null);
    try { await action(); return true; }
    catch (error) { setActionError(error instanceof Error ? error.message : 'The update could not be saved.'); return false; }
    finally { setPendingAction(null); }
  };

  if (selectedEventId) {
    if (generationState === 'loading' || (workspaceQuery.isLoading && !workspace)) {
      return (
        <View style={{ flex: 1, backgroundColor: '#FFFFFF', padding: pagePadding, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <MaterialCommunityIcons name="shield-sync-outline" size={48} color="#17643B" />
          <Text variant="titleLarge" style={{ fontWeight: '800', color: '#17643B' }}>Loading Event Workspace…</Text>
          <Text style={{ color: '#1D2420', textAlign: 'center' }}>Synchronizing live run-of-show, staffing, and execution tasks.</Text>
        </View>
      );
    }
    if (workspace) {
      const { event, readiness } = workspace;
      return (
        <ScrollView style={{ flex: 1, backgroundColor: '#FFFFFF' }} contentContainerStyle={{ padding: pagePadding, gap: spacing.md, paddingBottom: spacing.xxl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: isPhone ? 'wrap' : 'nowrap' }}>
            <Button mode="outlined" icon="arrow-left" textColor="#17643B" onPress={() => { if (initialEventId) router.back(); else setSelectedEventId(''); }}>{initialEventId ? 'Back' : 'Master Overview'}</Button>
            <View style={{ flex: 1, minWidth: isPhone ? '100%' : undefined }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#17643B', textTransform: 'uppercase' }}>Event Command Center</Text>
              <Text variant="titleLarge" style={{ fontWeight: '800', color: '#1D2420', fontSize: isPhone ? 20 : undefined }}>{event.title}</Text>
            </View>
            <View style={{ backgroundColor: readiness?.status === 'blocked' ? '#FDE7E9' : '#EEF5F0', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 }}>
              <Text style={{ color: readiness?.status === 'blocked' ? '#C5221F' : '#17643B', fontWeight: '800', fontSize: 13 }}>{`${readiness?.score ?? 0}% Ready`}</Text>
            </View>
          </View>
          {actionError ? (<Card style={{ backgroundColor: '#FDE7E9', borderColor: '#C5221F', borderWidth: 1 }}><Card.Content><Text style={{ color: '#C5221F', fontWeight: '700' }}>{actionError}</Text></Card.Content></Card>) : null}
          {workspace.blockers?.length > 0 ? (
            <Card style={{ backgroundColor: '#FFFFFF', borderColor: '#EA8600', borderWidth: 1, borderRadius: radius.sharp }}>
              <Card.Content style={{ gap: spacing.sm }}>
                <Text variant="titleMedium" style={{ fontWeight: '800', color: '#B06000' }}>Critical Action Queue ({workspace.blockers.length})</Text>
                {workspace.blockers.slice(0, 8).map((blocker: any) => (
                  <View key={`${blocker.code}-${blocker.title}`} style={{ padding: spacing.sm, backgroundColor: '#FFF8E1', borderRadius: 6, gap: 4 }}>
                    <Text style={{ fontWeight: '700', color: '#1D2420' }}>{blocker.title}</Text>
                    <Text style={{ fontSize: 12, color: '#1D2420' }}>{blocker.detail}</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      {blocker.code === 'OPEN_SHIFT' ? (<Button compact mode="outlined" textColor="#17643B" onPress={() => router.push('/(tabs)/schedule')}>Open Schedule</Button>) : null}
                      {blocker.code === 'UNASSIGNED_TABLE' ? (<Button compact mode="outlined" textColor="#17643B" onPress={() => router.push('/stadium-map')}>Open Stadium Map</Button>) : null}
                      {blocker.code === 'BEO_NOT_CONFIRMED' ? (<Button compact mode="outlined" textColor="#17643B" onPress={() => router.push('/(tabs)/guests')}>Open Event BEO</Button>) : null}
                    </View>
                  </View>
                ))}
              </Card.Content>
            </Card>
          ) : null}
          <Card style={{ backgroundColor: '#FFFFFF', borderColor: '#D9E2DC', borderWidth: 1, borderRadius: radius.sharp }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ fontWeight: '800', color: '#1D2420' }}>Execution Tasks ({workspace.tasks?.length ?? 0})</Text>
              {(workspace.tasks ?? []).map((task: any) => {
                const done = task.status === 'done';
                return (
                  <View key={task._id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: '#EEF5F0' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '600', color: '#1D2420', textDecorationLine: done ? 'line-through' : 'none' }}>{task.title}</Text>
                      <Text style={{ fontSize: 11, color: '#17643B' }}>{task.station || 'Operations'}</Text>
                    </View>
                    <Button disabled={pendingAction !== null} compact mode={done ? 'outlined' : 'contained'} buttonColor={done ? undefined : '#17643B'} textColor={done ? '#17643B' : '#FFFFFF'} onPress={() => void runAction(`task-${task._id}`, () => updateTask({ taskId: task._id, status: done ? 'open' : 'done' }))}>{done ? 'Reopen' : 'Complete'}</Button>
                  </View>
                );
              })}
            </Card.Content>
          </Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button mode="outlined" textColor="#17643B" style={{ flex: 1, minWidth: isPhone ? 140 : undefined }} onPress={() => router.push({ pathname: '/event-closeout', params: { eventId: selectedEventId } })}>Open Closeout</Button>
            <Button mode="outlined" textColor="#17643B" style={{ flex: 1, minWidth: isPhone ? 140 : undefined }} onPress={() => router.push({ pathname: '/nfl-brief', params: { eventId: selectedEventId } })}>Game-Day Brief</Button>
          </View>
        </ScrollView>
      );
    }
  }

  const readiness = masterData?.readiness;
  const events = masterData?.events ?? [];
  const blockers = masterData?.blockers ?? [];
  const staffing = masterData?.staffing ?? { scheduled: 0, open: 0, covered: 0 };
  const setup = masterData?.setup ?? { prepOpen: 0, checklistOpen: 0 };
  const floor = masterData?.floor ?? { tableCount: 0, unassignedReservations: 0 };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#FFFFFF' }} contentContainerStyle={{ padding: pagePadding, gap: spacing.md, paddingBottom: spacing.xxl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm }}>
        <View style={{ gap: 2, flex: 1, minWidth: isPhone ? '70%' : undefined }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MaterialCommunityIcons name="shield-star" size={20} color="#17643B" />
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#17643B', textTransform: 'uppercase' }}>Operations Command Center</Text>
          </View>
          <Text variant="headlineSmall" style={{ fontWeight: '900', color: '#1D2420', fontSize: isPhone ? 22 : undefined }}>Venue Master Workspace</Text>
        </View>
        <View style={{ backgroundColor: '#EEF5F0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#17643B' }}>
          <Text style={{ color: '#17643B', fontWeight: '900', fontSize: 15 }}>{`${readiness?.score ?? 98}% Ready`}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Button mode="contained" buttonColor="#074426" icon="stadium" onPress={() => router.push('/stadium-map')}>Stadium Map</Button>
        <Button mode="outlined" textColor="#17643B" icon="shield-check" onPress={() => router.push('/stadium/multi-venue-compliance')}>Compliance Command</Button>
        <Button mode="outlined" textColor="#17643B" icon="cash-register" onPress={() => router.push('/stadium/pos-aggregator')}>POS Aggregator</Button>
      </View>
      <Card style={{ backgroundColor: '#F6FAF7', borderColor: '#17643B', borderWidth: 1, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '800', color: '#17643B' }}>Today's Operational Posture</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <View style={{ flexGrow: 1, flexBasis: isPhone ? '45%' : 100, backgroundColor: '#FFFFFF', borderRadius: 6, padding: spacing.sm, borderWidth: 1, borderColor: '#D9E2DC' }}>
              <Text style={{ fontSize: 20, fontWeight: '900', color: '#17643B' }}>{`${readiness?.categories?.staffing ?? 100}%`}</Text>
              <Text style={{ fontSize: 11, color: '#1D2420', fontWeight: '700' }}>Staffing Coverage</Text>
              <Text style={{ fontSize: 10, color: '#17643B' }}>{staffing.covered}/{staffing.scheduled || '—'} shifts</Text>
            </View>
            <View style={{ flexGrow: 1, flexBasis: isPhone ? '45%' : 100, backgroundColor: '#FFFFFF', borderRadius: 6, padding: spacing.sm, borderWidth: 1, borderColor: '#D9E2DC' }}>
              <Text style={{ fontSize: 20, fontWeight: '900', color: '#17643B' }}>{`${readiness?.categories?.setup ?? 100}%`}</Text>
              <Text style={{ fontSize: 11, color: '#1D2420', fontWeight: '700' }}>Opening Prep</Text>
              <Text style={{ fontSize: 10, color: '#17643B' }}>{setup.checklistOpen} checklists open</Text>
            </View>
            <View style={{ flexGrow: 1, flexBasis: isPhone ? '45%' : 100, backgroundColor: '#FFFFFF', borderRadius: 6, padding: spacing.sm, borderWidth: 1, borderColor: '#D9E2DC' }}>
              <Text style={{ fontSize: 20, fontWeight: '900', color: '#17643B' }}>{`${readiness?.categories?.floor ?? 100}%`}</Text>
              <Text style={{ fontSize: 11, color: '#1D2420', fontWeight: '700' }}>Floor Readiness</Text>
              <Text style={{ fontSize: 10, color: '#17643B' }}>{floor.tableCount} tables active</Text>
            </View>
          </View>
        </Card.Content>
      </Card>
      <Card style={{ backgroundColor: '#FFFFFF', borderColor: '#D9E2DC', borderWidth: 1, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '800', color: '#1D2420' }}>Active & Upcoming Events ({events.length})</Text>
          {events.length === 0 ? (
            <View style={{ paddingVertical: spacing.md, alignItems: 'center', gap: 6 }}>
              <MaterialCommunityIcons name="calendar-check-outline" size={32} color="#17643B" />
              <Text style={{ color: '#1D2420', fontWeight: '700' }}>No separate single events scheduled today.</Text>
            </View>
          ) : events.map((event: any) => (
            <Pressable key={event._id} onPress={() => setSelectedEventId(event._id)} style={({ pressed }) => ({ padding: spacing.md, backgroundColor: pressed ? '#EEF5F0' : '#F6FAF7', borderRadius: 6, borderWidth: 1, borderColor: '#D9E2DC', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' })}>
              <View style={{ gap: 2, flex: 1 }}>
                <Text style={{ fontWeight: '800', color: '#1D2420', fontSize: 15 }}>{event.title}</Text>
                <Text style={{ color: '#17643B', fontSize: 12 }}>{new Date(event.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {event.expectedGuests ?? '—'} expected attendees</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#17643B" />
            </Pressable>
          ))}
        </Card.Content>
      </Card>
      {blockers.length > 0 ? (
        <Card style={{ backgroundColor: '#FFFFFF', borderColor: '#EA8600', borderWidth: 1, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '800', color: '#B06000' }}>Action Queue & Alerts ({blockers.length})</Text>
            {blockers.slice(0, 6).map((blocker: any) => (
              <View key={`${blocker.code}-${blocker.title}`} style={{ padding: spacing.sm, backgroundColor: '#FFF8E1', borderRadius: 6, gap: 2 }}>
                <Text style={{ fontWeight: '700', color: '#1D2420' }}>{blocker.title}</Text>
                <Text style={{ fontSize: 12, color: '#1D2420' }}>{blocker.detail}</Text>
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : (
        <Card style={{ backgroundColor: '#EEF5F0', borderColor: '#17643B', borderWidth: 1, borderRadius: radius.sharp }}>
          <Card.Content style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <MaterialCommunityIcons name="check-circle-outline" size={24} color="#17643B" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: '#17643B' }}>All Critical Action Items Clear</Text>
              <Text style={{ fontSize: 12, color: '#1D2420' }}>Staffing, prep, and assignments are fully on track.</Text>
            </View>
          </Card.Content>
        </Card>
      )}
    </ScrollView>
  );
}
