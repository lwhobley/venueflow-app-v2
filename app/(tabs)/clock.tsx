import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View, Linking, TextInput } from 'react-native';
import { Card, Text } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { accents, colors, radius, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { canManageVenue } from '../../lib/permissions';
import { asArray, errorMessage, formatTime } from '../../lib/format';
import { getPreciseLocation, isWithinGeofence, type CurrentLocation } from '../../lib/location';
import { appApi, useApiMutation, useApiQuery } from '../../lib/api-client';
import { useI18n } from '../../lib/i18n';


type ActiveClockEntry = {
  _id: string;
  memberName: string;
  jobTitle: string;
  venueName: string;
  clockInAt: number;
  clockInLat?: number | null;
  clockInLng?: number | null;
  clockInAccuracyM?: number | null;
  breaks?: any[];
};

type ManagerAlert = {
  kind: 'late_clock_in' | 'missed_clock_out';
  severity: 'warning' | 'danger';
  profileId: string;
  memberName: string;
  detail: string;
};

type PunchRow = {
  type: 'in' | 'out';
  at: number;
};

function fmtClock(d: Date) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 === 0 ? 12 : h % 12;
  return { time: `${h}:${m.toString().padStart(2, '0')}`, ampm };
}
function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ClockScreen() {
  const { t } = useI18n();
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady } = useAuthenticatedSession();
  const [location, setLocation] = useState<CurrentLocation | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);

  const { data: clockBoard } = useApiQuery<any | null>(['time-clock', 'board'], '/v1/time-clock/board', isReady);
  const { data: dashboard } = useApiQuery<any | null>(['app', 'dashboard'], '/v1/app/dashboard', isReady);
  const { data: timeClock } = useApiQuery<any | null>(['time-clock', 'me'], '/v1/time-clock/me', isReady);

  const clockInvalidations = [['time-clock', 'board'], ['time-clock', 'me'], ['app', 'dashboard']];
  const clockIn = useApiMutation(appApi.clockIn, clockInvalidations);
  const clockOut = useApiMutation(appApi.clockOut, clockInvalidations);
  const breakStart = useApiMutation(appApi.breakStart, clockInvalidations);
  const breakEnd = useApiMutation(appApi.breakEnd, clockInvalidations);
  const createCorrectionRequest = useApiMutation(appApi.createStaffRequest, [['app', 'listStaffRequests']]);

  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionDate, setCorrectionDate] = useState('');
  const [correctionInTime, setCorrectionInTime] = useState('');
  const [correctionOutTime, setCorrectionOutTime] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');

  // Admin/owner/manager are salaried: they don't punch a time clock.
  const salaried = Boolean(dashboard?.profile && canManageVenue(dashboard.profile.role, dashboard.profile.allAccess));
  const isAdmin = salaried;

  const rawVenue = venue ?? clockBoard?.venue ?? dashboard?.venue ?? null;
  const activeVenue = useMemo(() => {
    if (!rawVenue) return null;
    const geofenceRadiusM = 'geofenceRadiusM' in rawVenue ? rawVenue.geofenceRadiusM : rawVenue.geofence_radius_m;
    return { name: rawVenue.name, latitude: rawVenue.latitude, longitude: rawVenue.longitude, geofenceRadiusM };
  }, [rawVenue]);

  const activeClockEntries = asArray(clockBoard?.activeClockEntries) as ActiveClockEntry[];
  const managerAlerts = asArray(clockBoard?.managerAlerts) as ManagerAlert[];
  const isClockedIn = timeClock?.isClockedIn ?? Boolean(clockBoard?.employeeEntry);

  const employeeEntry = clockBoard?.employeeEntry;
  const breaks = (employeeEntry?.breaks || []) as any[];
  const activeBreak = breaks.find((b: any) => b.endAt === null);
  const isOnBreak = Boolean(activeBreak);
  const breakType = activeBreak?.type;

  // Live ticking clock.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingLocation(true);
    getPreciseLocation()
      .then((next) => !cancelled && setLocation(next))
      .catch((error) => {
        if (!cancelled) Alert.alert(t('clock.locationNeededTitle'), errorMessage(error, t('clock.locationUnavailable')));
      })
      .finally(() => !cancelled && setLoadingLocation(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const canClock = Boolean(activeVenue && location && isWithinGeofence(location, activeVenue));

  const onPunch = async () => {
    if (!location || !canClock || busy) return;
    setBusy(true);
    try {
      const args = { lat: location.latitude, lng: location.longitude, accuracy: location.accuracy, mocked: location.mocked };
      if (isClockedIn) await clockOut.mutateAsync(args);
      else await clockIn.mutateAsync(args);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert(t('clock.punchFailedTitle'), errorMessage(error, t('clock.punchFailedDefault')));
    } finally {
      setBusy(false);
    }
  };

  const onStartBreak = async (type: 'paid' | 'unpaid') => {
    if (busy) return;
    setBusy(true);
    try {
      await breakStart.mutateAsync({ type });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert(t('clock.breakFailedTitle'), errorMessage(error, t('clock.breakFailedDefault')));
    } finally {
      setBusy(false);
    }
  };

  const onEndBreak = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await breakEnd.mutateAsync({});
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert(t('clock.endBreakFailedTitle'), errorMessage(error, t('clock.endBreakFailedDefault')));
    } finally {
      setBusy(false);
    }
  };

  const onSubmitCorrection = async () => {
    if (!correctionDate || !correctionInTime || !correctionOutTime || !correctionReason) {
      Alert.alert(t('clock.errorTitle'), t('clock.fillAllFields'));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(correctionDate)) {
      Alert.alert(t('clock.errorTitle'), t('clock.dateFormatError'));
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(correctionInTime) || !/^\d{2}:\d{2}$/.test(correctionOutTime)) {
      Alert.alert(t('clock.errorTitle'), t('clock.timeFormatError'));
      return;
    }
    setBusy(true);
    try {
      const clockInAt = new Date(`${correctionDate}T${correctionInTime}:00`).getTime();
      const clockOutAt = new Date(`${correctionDate}T${correctionOutTime}:00`).getTime();
      if (isNaN(clockInAt) || isNaN(clockOutAt)) {
        Alert.alert(t('clock.errorTitle'), t('clock.invalidDateTime'));
        return;
      }
      if (clockOutAt <= clockInAt) {
        Alert.alert(t('clock.errorTitle'), t('clock.clockOutAfterClockIn'));
        return;
      }
      await createCorrectionRequest.mutateAsync({
        kind: 'time_correction',
        title: t('clock.correctionTitle', { date: correctionDate }),
        details: t('clock.correctionDetails', { date: correctionDate, inTime: correctionInTime, outTime: correctionOutTime, reason: correctionReason }),
        timeCorrection: {
          timeEntryId: null,
          clockInAt,
          clockOutAt,
          reason: correctionReason,
        },
      });
      Alert.alert(t('clock.successTitle'), t('clock.correctionSubmitted'));
      setShowCorrection(false);
      setCorrectionDate('');
      setCorrectionInTime('');
      setCorrectionOutTime('');
      setCorrectionReason('');
    } catch (error) {
      Alert.alert(t('clock.submissionFailedTitle'), errorMessage(error, t('clock.submissionFailedDefault')));
    } finally {
      setBusy(false);
    }
  };

  const { time, ampm } = fmtClock(now);
  const punches = asArray(timeClock?.punches) as PunchRow[];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header: live time + date + venue pill */}
      <View style={{ backgroundColor: colors.primary, borderRadius: radius.soft, padding: spacing.xl, alignItems: 'center', gap: 6 }}>
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontWeight: '700' }}>{user?.full_name ?? t('clock.defaultUserName')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <Text style={{ color: '#fff', fontSize: 56, fontWeight: '800', lineHeight: 60 }}>{time}</Text>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8, marginLeft: 4 }}>{ampm}</Text>
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 16, fontWeight: '600' }}>{fmtDate(now)}</Text>
        <View style={{ marginTop: 8, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18 }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>{activeVenue?.name ?? t('clock.noVenue')}</Text>
        </View>
      </View>

      {salaried ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: 4 }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('clock.salariedTitle')}</Text>
            <Text style={{ color: colors.muted }}>
              {t('clock.salariedDesc', { role: ((r: string) => r.charAt(0).toUpperCase() + r.slice(1))(user?.role ?? 'manager') })}
            </Text>
          </Card.Content>
        </Card>
      ) : null}

      {!salaried ? (
        <>
          {/* Punch Now button */}
          {isClockedIn && isOnBreak ? (
            <Pressable
              onPress={() => void onEndBreak()}
              disabled={busy}
              style={{
                backgroundColor: accents[1].fg,
                borderRadius: radius.sharp,
                paddingVertical: 20,
                alignItems: 'center',
                opacity: busy ? 0.7 : 1,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>
                {busy ? t('clock.working') : t('clock.endBreak', { type: breakType === 'paid' ? t('clock.paid') : t('clock.unpaid') })}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void onPunch()}
              disabled={!canClock || busy}
              style={{
                backgroundColor: canClock ? (isClockedIn ? colors.danger : colors.secondary) : colors.border,
                borderRadius: radius.sharp,
                paddingVertical: 20,
                alignItems: 'center',
                opacity: busy ? 0.7 : 1,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>
                {busy ? t('clock.working') : isClockedIn ? t('clock.punchOut') : t('clock.punchNow')}
              </Text>
            </Pressable>
          )}

          {isClockedIn && !isOnBreak && (
            <Pressable
              onPress={() => {
                Alert.alert(
                  t('clock.takeBreakTitle'),
                  t('clock.takeBreakMessage'),
                  [
                    { text: t('clock.paidRestBreak'), onPress: () => void onStartBreak('paid') },
                    { text: t('clock.unpaidMealBreak'), onPress: () => void onStartBreak('unpaid') },
                    { text: t('clock.cancel'), style: 'cancel' }
                  ]
                );
              }}
              disabled={busy}
              style={{
                backgroundColor: colors.primary,
                borderRadius: radius.sharp,
                paddingVertical: 12,
                alignItems: 'center',
                marginTop: 4,
                opacity: busy ? 0.7 : 1,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{t('clock.takeBreak')}</Text>
            </Pressable>
          )}

          {!canClock ? (
            <Text style={{ color: colors.muted, textAlign: 'center', marginTop: -4 }}>
              {loadingLocation
                ? t('clock.checkingLocation')
                : !location
                  ? t('clock.locationUnavailableMsg')
                  : location.mocked
                    ? t('clock.mockedLocation')
                    : t('clock.mustBeWithin', { radius: activeVenue?.geofenceRadiusM ?? 120, venue: activeVenue?.name ?? t('common.yourVenue') })}
            </Text>
          ) : (
            <Text style={{ color: accents[2].fg, textAlign: 'center', marginTop: -4 }}>
              {t('clock.insideGeofence')}{timeClock?.openSince ? t('clock.inSince', { time: formatTime(timeClock.openSince) }) : ''}{isOnBreak ? t('clock.onBreakSuffix', { type: breakType === 'paid' ? t('clock.paid') : t('clock.unpaid') }) : ''}
            </Text>
          )}

          {/* Period totals */}
          <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('clock.periodTotals')}</Text>
                <Text style={{ color: colors.primary, fontWeight: '800' }}>{t('clock.totalWorked', { hours: timeClock?.totalHours ?? 0 })}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 }}>
                <View>
                  <Text style={{ color: colors.muted }}>{t('clock.regularHours')}</Text>
                  <Text style={{ fontWeight: '700' }}>{timeClock?.regularHours ?? 0}h</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.lg, paddingTop: 4 }}>
                <View>
                  <Text style={{ color: colors.muted }}>{t('clock.sickBalance')}</Text>
                  <Text style={{ fontWeight: '700', color: accents[1].fg }}>{timeClock?.sickHours ?? 0}h</Text>
                </View>
                <View>
                  <Text style={{ color: colors.muted }}>{t('clock.ptoAccrued')}</Text>
                  <Text style={{ fontWeight: '700', color: accents[2].fg }}>{timeClock?.ptoHours ?? 0}h</Text>
                </View>
              </View>
            </Card.Content>
          </Card>

          {/* Daily punches */}
          <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('clock.dailyPunches')}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtDate(now)}</Text>
              </View>
              {punches.length === 0 ? (
                <Text style={{ color: colors.muted }}>{t('clock.noPunchesYet')}</Text>
              ) : (
                punches.map((p, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: i < punches.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialCommunityIcons name={p.type === 'in' ? 'login' : 'logout'} size={18} color={p.type === 'in' ? accents[2].fg : colors.danger} />
                      <Text>{p.type === 'in' ? t('clock.clockIn') : t('clock.clockOut')}</Text>
                    </View>
                    <Text style={{ color: colors.primary, fontWeight: '700' }}>{formatTime(p.at)}</Text>
                  </View>
                ))
              )}
            </Card.Content>
          </Card>

          {/* Time Correction Form */}
          <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Pressable
                onPress={() => setShowCorrection(!showCorrection)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('clock.requestTimeCorrection')}</Text>
                <MaterialCommunityIcons
                  name={showCorrection ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.muted}
                />
              </Pressable>

              {showCorrection && (
                <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {t('clock.correctionHelp')}
                  </Text>
                  <View style={{ gap: spacing.xs }}>
                    <Text style={{ fontWeight: '600', fontSize: 12, color: colors.charcoal }}>{t('clock.dateLabel')}</Text>
                    <TextInput
                      placeholder={t('clock.datePlaceholder')}
                      value={correctionDate}
                      onChangeText={setCorrectionDate}
                      placeholderTextColor={colors.muted}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sharp,
                        padding: 10,
                        backgroundColor: colors.surface,
                        color: colors.charcoal,
                      }}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={{ flex: 1, gap: spacing.xs }}>
                      <Text style={{ fontWeight: '600', fontSize: 12, color: colors.charcoal }}>{t('clock.inTimeLabel')}</Text>
                      <TextInput
                        placeholder={t('clock.inTimePlaceholder')}
                        value={correctionInTime}
                        onChangeText={setCorrectionInTime}
                        placeholderTextColor={colors.muted}
                        style={{
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: radius.sharp,
                          padding: 10,
                          backgroundColor: colors.surface,
                          color: colors.charcoal,
                        }}
                      />
                    </View>
                    <View style={{ flex: 1, gap: spacing.xs }}>
                      <Text style={{ fontWeight: '600', fontSize: 12, color: colors.charcoal }}>{t('clock.outTimeLabel')}</Text>
                      <TextInput
                        placeholder={t('clock.outTimePlaceholder')}
                        value={correctionOutTime}
                        onChangeText={setCorrectionOutTime}
                        placeholderTextColor={colors.muted}
                        style={{
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: radius.sharp,
                          padding: 10,
                          backgroundColor: colors.surface,
                          color: colors.charcoal,
                        }}
                      />
                    </View>
                  </View>
                  <View style={{ gap: spacing.xs }}>
                    <Text style={{ fontWeight: '600', fontSize: 12, color: colors.charcoal }}>{t('clock.reasonLabel')}</Text>
                    <TextInput
                      placeholder={t('clock.reasonPlaceholder')}
                      value={correctionReason}
                      onChangeText={setCorrectionReason}
                      placeholderTextColor={colors.muted}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sharp,
                        padding: 10,
                        backgroundColor: colors.surface,
                        color: colors.charcoal,
                      }}
                    />
                  </View>
                  <Pressable
                    onPress={() => void onSubmitCorrection()}
                    disabled={busy}
                    style={{
                      backgroundColor: colors.primary,
                      borderRadius: radius.sharp,
                      paddingVertical: 12,
                      alignItems: 'center',
                      marginTop: 4,
                      opacity: busy ? 0.7 : 1,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{t('clock.submitCorrection')}</Text>
                  </Pressable>
                </View>
              )}
            </Card.Content>
          </Card>
        </>
      ) : null}

      {/* Manager board */}
      {isAdmin ? (
        <>
          <Card style={{ backgroundColor: managerAlerts.length > 0 ? `${colors.danger}1A` : colors.surface, borderRadius: radius.sharp }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('clock.managerAlerts')}</Text>
              {managerAlerts.length === 0 ? (
                <Text style={{ color: colors.muted }}>{t('clock.noAlerts')}</Text>
              ) : (
                managerAlerts.map((alert) => (
                  <View key={`${alert.kind}-${alert.profileId}`} style={{ gap: 2, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: alert.severity === 'danger' ? colors.danger : accents[1].fg, fontWeight: '800' }}>{alert.memberName}</Text>
                    <Text style={{ color: colors.charcoal }}>{alert.detail}</Text>
                  </View>
                ))
              )}
            </Card.Content>
          </Card>
          <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('clock.whosClockedIn')}</Text>
              {activeClockEntries.length === 0 ? (
                <Text style={{ color: colors.muted }}>{t('clock.noOneClockedIn')}</Text>
              ) : (
                activeClockEntries.map((e) => (
                  <View key={e._id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View>
                        <Text style={{ fontWeight: '600' }}>{e.memberName}</Text>
                        <Text style={{ color: colors.muted }}>{e.jobTitle}</Text>
                      </View>
                      <Text style={{ color: colors.muted }}>{t('clock.inTimeValue', { time: formatTime(e.clockInAt) })}</Text>
                    </View>
                    {Number.isFinite(e.clockInLat) && Number.isFinite(e.clockInLng) && e.clockInLat !== 0 && e.clockInLng !== 0 && (
                      <Pressable
                        onPress={() => {
                          const url = `https://www.google.com/maps/search/?api=1&query=${e.clockInLat},${e.clockInLng}`;
                          Linking.openURL(url).catch(() => Alert.alert(t('clock.errorTitle'), t('clock.mapError')));
                        }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                      >
                        <MaterialCommunityIcons name="map-marker" size={14} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}>
                          {t('clock.punchLocation', { accuracy: Math.round(e.clockInAccuracyM ?? 0) })}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ))
              )}
            </Card.Content>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
