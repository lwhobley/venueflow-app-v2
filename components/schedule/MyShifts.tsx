import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Chip, Snackbar, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { ScheduleSkeleton } from './ScheduleSkeleton';
import { asArray } from '../../lib/format';

type Shift = {
  _id: Id<'scheduleShifts'>;
  dayIndex: number;
  dayLabel: string;
  startMinutes: number;
  endMinutes: number;
  startTime: string;
  endTime: string;
  jobTitle: string;
  station: string;
  status: 'scheduled' | 'open' | 'covered';
  mine: boolean;
  conflict: boolean;
};

type Blackout = { _id: Id<'blackoutDates'>; startDate: string; endDate: string; reason: string };
type Coworker = {
  shiftId: Id<'scheduleShifts'>;
  profileId: Id<'profiles'>;
  name: string;
  jobTitle: string;
  station: string;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  startTime: string;
  endTime: string;
  withMe: boolean;
};
type RosterDay = { dayIndex: number; dayLabel: string; coworkers: Coworker[] };

export function MyShifts() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady } = useAuthenticatedSession();
  const data = useQuery(api.scheduling.getMySchedule, isReady ? {} : 'skip');
  const blackoutData = useQuery(api.scheduling.listBlackouts, isReady && venue?.id ? { venueId: venue.id } : 'skip');
  const claimOpenShift = useMutation(api.scheduling.claimOpenShift);
  const requestDropShift = useMutation(api.scheduling.requestDropShift);
  const createRequest = useMutation(api.app.createStaffRequest);
  const proposeSwap = useMutation(api.scheduling.proposeShiftSwap);
  const respondToSwap = useMutation(api.scheduling.respondToShiftSwap);
  const openDm = useMutation(api.chat.openDm);
  const directory = useQuery(api.chat.listDirectory, isReady && venue?.id ? { venueId: venue.id } : 'skip');
  const swaps = useQuery(api.scheduling.getMyShiftSwaps, isReady ? {} : 'skip');

  const [offStart, setOffStart] = useState('');
  const [offEnd, setOffEnd] = useState('');
  const [offReason, setOffReason] = useState('');
  const [offError, setOffError] = useState<string | null>(null);
  const [offOk, setOffOk] = useState(false);
  const [swapShiftId, setSwapShiftId] = useState<string | null>(null);
  const [swapTargetShiftId, setSwapTargetShiftId] = useState<Id<'scheduleShifts'> | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Surfaces mutation errors (e.g. double-booking, claim races) as a toast
  // instead of an unhandled rejection, and confirms successful actions.
  const run = async (action: () => Promise<unknown>, ok?: string) => {
    try {
      await action();
      if (ok) setToast(ok);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    }
  };

  const messageTeammate = (profileId: Id<'profiles'>) =>
    run(async () => {
      if (!venue?.id) return;
      const result = await openDm({ venueId: venue.id, targetProfileId: profileId });
      router.push(`/chat/${result?.conversationId ?? result}`);
    });

  const teammates = useMemo(() => asArray(directory) as { _id: Id<'profiles'>; fullName: string; jobTitle: string }[], [directory]);
  const coworkersPerDay = useMemo(() => {
    const map = new Map<number, number>();
    for (const day of asArray(data?.roster) as RosterDay[]) {
      map.set(day.dayIndex, day.coworkers.length);
    }
    return map;
  }, [data?.roster]);
  const mySwaps = useMemo(() => asArray(swaps) as Array<{ _id: Id<'shiftSwaps'>; status: string; requesterName: string; targetName: string; requesterShift: string; targetShift: string | null; direction: string }>, [swaps]);
  const incomingSwaps = mySwaps.filter((s) => s.direction === 'incoming' && s.status === 'proposed');
  const otherSwaps = mySwaps.filter((s) => !(s.direction === 'incoming' && s.status === 'proposed'));

  const offerSwap = (shiftId: string, targetProfileId: Id<'profiles'>, targetShiftId?: Id<'scheduleShifts'> | null) =>
    run(async () => {
      if (!venue?.id) return;
      await proposeSwap({ myShiftId: shiftId as Id<'scheduleShifts'>, targetProfileId, targetShiftId: targetShiftId ?? undefined });
      setSwapShiftId(null);
      setSwapTargetShiftId(null);
    }, targetShiftId ? 'Swap offered.' : 'Coverage offer sent.');

  const mine = useMemo(() => asArray(data?.mine) as Shift[], [data]);
  const open = useMemo(() => asArray(data?.open) as Shift[], [data]);
  const roster = useMemo(() => asArray(data?.roster) as RosterDay[], [data]);
  const blackouts = useMemo(() => asArray(blackoutData) as Blackout[], [blackoutData]);
  const coworkerShiftOptions = useMemo(
    () => roster.flatMap((day) => day.coworkers.map((coworker) => ({ ...coworker, dayLabel: day.dayLabel }))),
    [roster],
  );
  const selectedSwapTarget = coworkerShiftOptions.find((shift) => shift.shiftId === swapTargetShiftId) ?? null;

  const weekDates = useMemo(() => {
    const today = new Date();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      return d;
    });
  }, []);
  const todayDayIndex = new Date().getDay();

  const shiftDate = (dayIndex: number) =>
    weekDates[dayIndex]?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) ?? '';
  const nextShift = useMemo(() => {
    const now = new Date();
    const today = now.getDay();
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    return [...mine]
      .filter((shift) => shift.dayIndex > today || (shift.dayIndex === today && shift.startMinutes >= minutesNow))
      .sort((a, b) => a.dayIndex - b.dayIndex || a.startMinutes - b.startMinutes)[0] ?? null;
  }, [mine]);

  const submitTimeOff = async () => {
    setOffError(null);
    setOffOk(false);
    if (!venue?.id || !offStart.trim()) {
      setOffError('Enter at least a start date (YYYY-MM-DD).');
      return;
    }
    try {
      await createRequest({
        venueId: venue.id,
        kind: 'time_off',
        title: `Time off ${offStart.trim()}${offEnd.trim() ? ` – ${offEnd.trim()}` : ''}`,
        details: offReason.trim() || 'Requesting time off.',
        requestedRangeStart: offStart.trim(),
        requestedRangeEnd: offEnd.trim() || offStart.trim(),
      });
      setOffStart('');
      setOffEnd('');
      setOffReason('');
      setOffOk(true);
    } catch (e) {
      setOffError(e instanceof Error ? e.message : 'Could not submit request.');
    }
  };

  if (data === undefined) return <ScheduleSkeleton rows={3} />;

  return (
    <View style={{ gap: spacing.md }}>
      {nextShift ? (
        <Card style={{ backgroundColor: accents[0].bg, borderRadius: 16 }}>
          <Card.Content style={{ gap: 4 }}>
            <Text variant="titleMedium" style={{ color: accents[0].fg, fontWeight: '800' }}>Upcoming shift reminder</Text>
            <Text style={{ color: colors.charcoal }}>
              {nextShift.dayLabel}{nextShift.dayIndex === todayDayIndex ? ' (Today)' : ''} · {shiftDate(nextShift.dayIndex)} · {nextShift.startTime} – {nextShift.endTime}
            </Text>
            <Text style={{ color: accents[0].fg }}>{nextShift.jobTitle} · {nextShift.station}</Text>
          </Card.Content>
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>My shifts</Text>
          {mine.length === 0 ? (
            <Text style={{ color: colors.muted }}>You have no scheduled shifts yet.</Text>
          ) : (
            mine.map((s) => (
              <View key={s._id} style={{ padding: 12, borderRadius: 12, backgroundColor: s.conflict ? '#FDE7E9' : colors.cream, borderWidth: s.conflict ? 1.5 : 0, borderColor: colors.danger, gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                  <View>
                    <Text style={{ fontWeight: '800' }}>{s.dayLabel} · {shiftDate(s.dayIndex)}{s.dayIndex === todayDayIndex ? ' · Today' : ''}</Text>
                    <Text style={{ color: colors.charcoal, fontSize: 12 }}>{s.startTime} – {s.endTime}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {s.conflict ? <Text style={{ color: colors.charcoal, fontWeight: '700' }}>⚠ Approved unavailable-day request</Text> : null}
                    {(() => {
                      const coworkers = coworkersPerDay.get(s.dayIndex) ?? 0;
                      const label = coworkers >= 6 ? '🔥 High volume' : coworkers >= 3 ? 'Moderate' : coworkers > 0 ? 'Light day' : null;
                      const bg = coworkers >= 6 ? accents[3].bg : coworkers >= 3 ? accents[1].bg : accents[2].bg;
                      const fg = coworkers >= 6 ? accents[3].fg : coworkers >= 3 ? accents[1].fg : accents[2].fg;
                      if (!label) return null;
                      return <View style={{ backgroundColor: bg, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ color: fg, fontSize: 11 }}>{label}</Text></View>;
                    })()}
                  </View>
                </View>
                <Text style={{ color: colors.charcoal }}>{s.jobTitle} · {s.station}</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Button compact mode="outlined" textColor={colors.danger} onPress={() => void run(() => requestDropShift({ shiftId: s._id }), 'Drop request sent.')}>
                    Request to drop
                  </Button>
                  <Button compact mode={swapShiftId === s._id ? 'contained' : 'outlined'} buttonColor={swapShiftId === s._id ? colors.primary : undefined} textColor={swapShiftId === s._id ? '#fff' : colors.primary} onPress={() => setSwapShiftId(swapShiftId === s._id ? null : s._id)}>
                    {swapShiftId === s._id ? 'Pick teammate…' : 'Offer swap'}
                  </Button>
                </View>
                {swapShiftId === s._id ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {coworkerShiftOptions.length > 0 ? (
                      <>
                        <Text style={{ width: '100%', color: colors.charcoal, fontSize: 12 }}>
                          Optional: pick a coworker shift to request back.
                        </Text>
                        {coworkerShiftOptions.map((target) => {
                          const selected = swapTargetShiftId === target.shiftId;
                          return (
                            <Chip
                              key={target.shiftId}
                              selected={selected}
                              onPress={() => setSwapTargetShiftId(selected ? null : target.shiftId)}
                            >
                              {target.name}: {target.dayLabel} {target.startTime}
                            </Chip>
                          );
                        })}
                      </>
                    ) : null}
                    {selectedSwapTarget ? (
                      <Button
                        compact
                        mode="contained"
                        buttonColor={colors.primary}
                        onPress={() => void offerSwap(s._id, selectedSwapTarget.profileId, selectedSwapTarget.shiftId)}
                      >
                        Offer swap with {selectedSwapTarget.name}
                      </Button>
                    ) : null}
                    {teammates.length === 0 ? (
                      <Text style={{ color: colors.charcoal }}>No teammates to offer to.</Text>
                    ) : (
                      teammates.map((t) => (
                        <Chip key={t._id} onPress={() => void offerSwap(s._id, t._id)}>Ask {t.fullName} to cover</Chip>
                      ))
                    )}
                  </View>
                ) : null}
              </View>
            ))
          )}
        </Card.Content>
      </Card>

      {/* Shift swaps */}
      {incomingSwaps.length > 0 || otherSwaps.length > 0 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Shift swap marketplace</Text>
            {incomingSwaps.map((sw) => (
              <View key={sw._id} style={{ padding: 10, borderRadius: 12, backgroundColor: accents[0].bg, gap: 6 }}>
                <Text>{sw.requesterName} wants you to take {sw.requesterShift}{sw.targetShift ? ` in exchange for your ${sw.targetShift}` : ''}.</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void run(() => respondToSwap({ swapId: sw._id, accept: true }), 'Swap accepted — pending manager approval.')} accessibilityLabel="Accept swap">Accept</Button>
                  <Button compact mode="text" textColor={colors.danger} onPress={() => void run(() => respondToSwap({ swapId: sw._id, accept: false }), 'Swap declined.')} accessibilityLabel="Decline swap">Decline</Button>
                </View>
              </View>
            ))}
            {otherSwaps.map((sw) => (
              <View key={sw._id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ flex: 1, color: colors.muted }}>
                  {sw.direction === 'outgoing' ? `You → ${sw.targetName}` : `${sw.requesterName} → ${sw.targetName}`} · {sw.requesterShift}
                </Text>
                <Chip compact>{sw.status}</Chip>
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Who you're working with</Text>
          {roster.length === 0 ? (
            <Text style={{ color: colors.muted }}>Once you're scheduled, the rest of the crew on those days shows up here.</Text>
          ) : (
            roster.map((day) => (
              <View key={day.dayIndex} style={{ gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ fontWeight: '700', color: day.dayIndex === todayDayIndex ? colors.primary : undefined }}>
                  {day.dayLabel} · {shiftDate(day.dayIndex)}{day.dayIndex === todayDayIndex ? ' · Today' : ''}
                </Text>
                {day.coworkers.length === 0 ? (
                  <Text style={{ color: colors.muted }}>You're the only one scheduled.</Text>
                ) : (
                  day.coworkers.map((c, i) => (
                    <View key={`${day.dayIndex}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text>{c.name}</Text>
                        <Text style={{ color: colors.muted }}>{c.jobTitle} · {c.startTime} – {c.endTime}</Text>
                      </View>
                      <Button
                        compact
                        mode="text"
                        icon="message-outline"
                        textColor={colors.primary}
                        accessibilityLabel={`Message ${c.name}`}
                        onPress={() => void messageTeammate(c.profileId)}
                      >
                        Message
                      </Button>
                      <Chip compact style={{ backgroundColor: c.withMe ? accents[2].bg : colors.cream }} textStyle={{ color: c.withMe ? accents[2].fg : colors.muted }}>
                        {c.withMe ? 'On with you' : 'Same day'}
                      </Chip>
                    </View>
                  ))
                )}
              </View>
            ))
          )}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Open shifts you can pick up</Text>
          {open.length === 0 ? (
            <Text style={{ color: colors.muted }}>No open shifts right now.</Text>
          ) : (
            open.map((s) => (
              <View key={s._id} style={{ padding: 12, borderRadius: 12, backgroundColor: accents[4].bg, gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={{ fontWeight: '800' }}>{s.dayLabel} · {shiftDate(s.dayIndex)}{s.dayIndex === todayDayIndex ? ' · Today' : ''}</Text>
                    <Text style={{ color: colors.charcoal, fontSize: 12 }}>{s.startTime} – {s.endTime}</Text>
                  </View>
                  {s.conflict ? <Chip compact style={{ backgroundColor: '#FDE7E9' }} textStyle={{ color: colors.danger }}>Approved unavailable-day request</Chip> : null}
                </View>
                <Text>{s.jobTitle} · {s.station}</Text>
                <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void run(() => claimOpenShift({ shiftId: s._id }), 'Shift picked up.')}>
                  Pick up shift
                </Button>
              </View>
            ))
          )}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Request unavailable days</Text>
          {blackouts.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.muted }}>Blackout dates (can't request off):</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {blackouts.map((b) => (
                  <Chip key={b._id} compact style={{ backgroundColor: '#FDE7E9' }} textStyle={{ color: colors.danger }}>
                    {b.startDate}{b.endDate !== b.startDate ? `–${b.endDate}` : ''}
                  </Chip>
                ))}
              </View>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput label="From (YYYY-MM-DD)" value={offStart} onChangeText={setOffStart} mode="outlined" autoCapitalize="none" style={{ flex: 1, backgroundColor: colors.surface }} />
            <TextInput label="To (optional)" value={offEnd} onChangeText={setOffEnd} mode="outlined" autoCapitalize="none" style={{ flex: 1, backgroundColor: colors.surface }} />
          </View>
          <TextInput label="Reason (optional)" value={offReason} onChangeText={setOffReason} mode="outlined" style={{ backgroundColor: colors.surface }} />
          {offError ? <Text style={{ color: colors.danger }}>{offError}</Text> : null}
          {offOk ? <Text style={{ color: accents[2].fg }}>Request submitted ✓</Text> : null}
          <Button mode="contained" buttonColor={colors.primary} onPress={() => void submitTimeOff()}>
            Submit unavailable-days request
          </Button>
        </Card.Content>
      </Card>

      <Snackbar visible={Boolean(toast)} onDismiss={() => setToast(null)} duration={3000} action={{ label: 'Dismiss', onPress: () => setToast(null) }}>
        {toast ?? ''}
      </Snackbar>
    </View>
  );
}
