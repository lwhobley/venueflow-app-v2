import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Chip, TextInput } from 'react-native-paper';
import { CommandSurface, CommandText, StatusPill } from '../components/FutureUI';
import { errorMessage, humanizeLabel } from '../lib/format';
import { api } from '../lib/railway-api';
import { useMutation, useQuery } from '../lib/railway-hooks';
import { spacing, useDesignTheme } from '../lib/theme';
import { useVenueAuth } from '../lib/useVenueAuth';
import { SyncStatus } from '../lib/sync-status';

type EventSummary = { id: string; title: string; startsAt: string; operationalState?: string };
type Issue = { id: string; issueType: string; severity: 'low' | 'medium' | 'high' | 'critical'; status: 'open' | 'acknowledged' | 'resolved'; title: string; description: string; openedAt: string; resolutionNotes: string | null };
type Overview = { events: EventSummary[] };

const severities: Issue['severity'][] = ['low', 'medium', 'high', 'critical'];
const label = humanizeLabel;

export default function EventIssuesScreen() {
  const palette = useDesignTheme();
  const { isReady, venue } = useVenueAuth();
  const overview = useQuery(api.stadium.getOverview, isReady && venue?.id ? {} : 'skip') as Overview | undefined;
  const [eventId, setEventId] = useState<string | null>(null);
  const [issueType, setIssueType] = useState('operational');
  const [severity, setSeverity] = useState<Issue['severity']>('high');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const createIssue = useMutation(api.stadium.createEventIssue);
  const acknowledgeIssue = useMutation(api.stadium.acknowledgeEventIssue);
  const resolveIssue = useMutation(api.stadium.resolveEventIssue);

  useEffect(() => {
    if (!eventId && overview?.events?.[0]) setEventId(overview.events[0].id);
  }, [eventId, overview?.events]);

  const issues = useQuery(api.stadium.listEventIssues, eventId ? { eventId } : 'skip') as Issue[] | undefined;
  const activeEvent = useMemo(() => overview?.events?.find((event) => event.id === eventId), [eventId, overview?.events]);

  const report = async () => {
    if (!eventId || !title.trim() || !description.trim()) return;
    setMessage(null);
    try {
      await createIssue({ eventId, issueType, severity, title, description });
      setTitle(''); setDescription(''); setMessage('Issue reported to the event command center.');
    } catch (error) { setMessage(errorMessage(error, 'The issue could not be reported.')); }
  };

  const resolve = async (issue: Issue) => {
    const notes = resolutionNotes[issue.id]?.trim();
    if (!notes) { setMessage('Enter resolution notes before resolving an issue.'); return; }
    try {
      await resolveIssue({ issueId: issue.id, resolutionNotes: notes });
      setMessage('Issue resolved and recorded in the event audit trail.');
    } catch (error) { setMessage(errorMessage(error, 'The issue could not be resolved.')); }
  };

  return <ScrollView style={{ flex: 1, backgroundColor: 'transparent' }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View><CommandText palette={palette} variant="label">Event command center</CommandText><CommandText palette={palette} variant="hero">Live issues</CommandText></View><View style={{ alignItems: 'flex-end' }}><SyncStatus /><Button mode="text" textColor={palette.primary} onPress={() => router.back()}>Back</Button></View></View>
    {message ? <CommandSurface palette={palette}><CommandText palette={palette} variant="body">{message}</CommandText></CommandSurface> : null}
    <CommandSurface palette={palette} strong style={{ gap: spacing.sm }}><CommandText palette={palette} variant="title">Event in scope</CommandText><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>{overview?.events?.map((event) => <Chip key={event.id} selected={event.id === eventId} onPress={() => setEventId(event.id)}>{event.title}</Chip>)}</View>{activeEvent ? <CommandText palette={palette} variant="caption">{new Date(activeEvent.startsAt).toLocaleString()} · {label(activeEvent.operationalState ?? 'draft')}</CommandText> : <CommandText palette={palette} variant="caption">Create or select an event before reporting issues.</CommandText>}</CommandSurface>
    <CommandSurface palette={palette} style={{ gap: spacing.sm }}><CommandText palette={palette} variant="title">Report an issue</CommandText><TextInput mode="outlined" label="Issue type" value={issueType} onChangeText={setIssueType} placeholder="e.g. stockout, equipment, safety" /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>{severities.map((value) => <Chip key={value} selected={severity === value} onPress={() => setSeverity(value)}>{label(value)}</Chip>)}</View><TextInput mode="outlined" label="Short title" value={title} onChangeText={setTitle} /><TextInput mode="outlined" label="What happened?" value={description} onChangeText={setDescription} multiline /><Button mode="contained" buttonColor={palette.primary} disabled={!eventId || !title.trim() || !description.trim()} onPress={() => void report()}>Report issue</Button></CommandSurface>
    <CommandSurface palette={palette} style={{ gap: spacing.sm }}><CommandText palette={palette} variant="title">Open and recent issues</CommandText>{issues?.length ? issues.map((issue) => <View key={issue.id} style={{ borderTopWidth: 1, borderColor: palette.border, paddingTop: spacing.sm, gap: spacing.xs }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}><View style={{ flex: 1 }}><CommandText palette={palette} variant="body" style={{ fontWeight: '800' }}>{issue.title}</CommandText><CommandText palette={palette} variant="caption">{label(issue.issueType)} · {new Date(issue.openedAt).toLocaleTimeString()}</CommandText></View><StatusPill palette={palette} tone={issue.severity === 'critical' || issue.severity === 'high' ? 'warn' : issue.status === 'resolved' ? 'good' : 'neutral'}>{label(issue.status)} · {label(issue.severity)}</StatusPill></View><CommandText palette={palette} variant="caption">{issue.description}</CommandText>{issue.status === 'open' ? <Button compact mode="outlined" textColor={palette.primary} onPress={() => void acknowledgeIssue({ issueId: issue.id })}>Acknowledge</Button> : null}{issue.status !== 'resolved' ? <><TextInput mode="outlined" dense label="Resolution notes" value={resolutionNotes[issue.id] ?? ''} onChangeText={(value) => setResolutionNotes((notes) => ({ ...notes, [issue.id]: value }))} /><Button compact mode="contained-tonal" textColor={palette.primary} onPress={() => void resolve(issue)}>Resolve</Button></> : <CommandText palette={palette} variant="caption">Resolution: {issue.resolutionNotes}</CommandText>}</View>) : <CommandText palette={palette} variant="caption">No issues have been reported for this event.</CommandText>}</CommandSurface>
  </ScrollView>;
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
