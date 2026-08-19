import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, SegmentedButtons, Snackbar, Text } from 'react-native-paper';
import { ScreenErrorBoundary } from '../../components/ErrorBoundary';
import { AnimatedTab, SectionHeader } from '../../components/AppCard';
import { useI18n } from '../../lib/i18n';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { colors, radius, spacing } from '../../lib/theme';
import { useDesktopContentStyle } from '../../lib/responsive';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { asArray, errorMessage } from '../../lib/format';
import { ManagerCalendar } from '../../components/schedule/ManagerCalendar';
import { MyShifts } from '../../components/schedule/MyShifts';
import { BlackoutManager } from '../../components/schedule/BlackoutManager';
import { LaborForecastPanel } from '../../components/schedule/LaborForecastPanel';


type StaffRequest = {
  _id: string;
  title: string;
  kind: 'add_shift' | 'drop_shift' | 'time_off' | 'sick_leave' | 'other';
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  details: string;
};

type SwapRow = { _id: Id<'shiftSwaps'>; status: string; requesterName: string; targetName: string; requesterShift: string; targetShift: string | null };

function RequestQueue({ venueId }: { venueId: Id<'venues'> }) {
  const { t } = useI18n();
  const queueQuery = useQuery(api.app.listStaffRequests, { venueId });
  const reviewRequest = useMutation(api.app.reviewStaffRequest);
  const queue = useMemo(() => asArray(queueQuery) as StaffRequest[], [queueQuery]);
  const swapsQuery = useQuery(api.scheduling.listShiftSwaps, { venueId });
  const reviewSwap = useMutation(api.scheduling.reviewShiftSwap);
  const swaps = useMemo(() => asArray(swapsQuery) as SwapRow[], [swapsQuery]);
  const [toast, setToast] = useState<string | null>(null);

  const safe = async (action: () => Promise<unknown>, ok?: string) => {
    try {
      await action();
      if (ok) setToast(ok);
    } catch (e) {
      setToast(errorMessage(e, t('schedule.actionFailed')));
    }
  };

  return (
    <>
    <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp, marginBottom: spacing.md }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('schedule.swapsTitle')}</Text>
        {swaps.length === 0 ? (
          <Text style={{ color: colors.muted }}>{t('schedule.noSwaps')}</Text>
        ) : (
          swaps.map((sw) => (
            <View key={sw._id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 6 }}>
              <Text>{sw.requesterName} → {sw.targetName}</Text>
              <Text style={{ color: colors.muted }}>{sw.requesterShift}{sw.targetShift ? ` ⇄ ${sw.targetShift}` : ` ${t('schedule.giveAway')}`} · {sw.status}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void safe(() => reviewSwap({ swapId: sw._id, approve: true }), t('schedule.swapApproved'))} accessibilityLabel={t('schedule.approveSwap')}>{t('schedule.approve')}</Button>
                <Button compact mode="outlined" textColor={colors.danger} onPress={() => void safe(() => reviewSwap({ swapId: sw._id, approve: false }), t('schedule.swapDenied'))}>{t('schedule.deny')}</Button>
              </View>
            </View>
          ))
        )}
      </Card.Content>
    </Card>
    <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('schedule.requestQueueTitle')}</Text>
        {queue.length === 0 ? (
          <Text style={{ color: colors.muted }}>{t('schedule.noPendingRequests')}</Text>
        ) : (
          queue.map((request) => (
            <View key={request._id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 }}>
              <Text style={{ fontWeight: '700' }}>{request.title}</Text>
              <Text style={{ color: colors.muted }}>{request.kind.replace('_', ' ')} · {request.status}</Text>
              <Text>{request.details}</Text>
              {request.status === 'pending' ? (
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void safe(() => reviewRequest({ requestId: request._id as Id<'staffRequests'>, status: 'approved' }), t('schedule.requestApproved'))} accessibilityLabel={t('schedule.approveRequest')}>{t('schedule.approve')}</Button>
                  <Button compact mode="outlined" textColor={colors.danger} onPress={() => void safe(() => reviewRequest({ requestId: request._id as Id<'staffRequests'>, status: 'denied' }), t('schedule.requestDenied'))}>{t('schedule.deny')}</Button>
                </View>
              ) : null}
            </View>
          ))
        )}
      </Card.Content>
    </Card>
    <Snackbar visible={Boolean(toast)} onDismiss={() => setToast(null)} duration={3000} action={{ label: t('schedule.dismiss'), onPress: () => setToast(null) }}>
      {toast ?? ''}
    </Snackbar>
    </>
  );
}

export default function ScheduleScreenWrapper() {
  return <ScreenErrorBoundary><ScheduleScreen /></ScreenErrorBoundary>;
}

function ScheduleScreen() {
  const { venue, canManage } = useVenueAuth();
  const { t } = useI18n();

  const [managerTab, setManagerTab] = useState<'calendar' | 'forecast' | 'requests' | 'blackouts'>('calendar');
  const contentContainerStyle = useDesktopContentStyle({ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader
        kicker={t('schedule.kicker')}
        title={t('schedule.title')}
        subtitle={canManage ? t('schedule.subtitleManager') : t('schedule.subtitleStaff')}
      />

      {!venue?.id ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content>
            <Text style={{ color: colors.muted }}>{t('schedule.noVenue')}</Text>
          </Card.Content>
        </Card>
      ) : canManage ? (
        <>
          <SegmentedButtons
            value={managerTab}
            onValueChange={(v) => setManagerTab(v as 'calendar' | 'forecast' | 'requests' | 'blackouts')}
            buttons={[
              { value: 'calendar', label: t('schedule.tabCalendar') },
              { value: 'forecast', label: t('schedule.tabForecast') },
              { value: 'requests', label: t('schedule.tabRequests') },
              { value: 'blackouts', label: t('schedule.tabBlackouts') },
            ]}
          />
          <AnimatedTab tabKey={managerTab}>
            {managerTab === 'calendar' ? (
              <ManagerCalendar venueId={venue.id} />
            ) : managerTab === 'forecast' ? (
              <LaborForecastPanel venueId={venue.id} />
            ) : managerTab === 'requests' ? (
              <RequestQueue venueId={venue.id} />
            ) : (
              <BlackoutManager venueId={venue.id} />
            )}
          </AnimatedTab>
        </>
      ) : <MyShifts />}
    </ScrollView>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
