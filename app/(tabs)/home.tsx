import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { TextInput } from 'react-native-paper';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { CommandButton, CommandText } from '../../components/FutureUI';
import { HomeWranglerSurface } from '../../components/HomeWranglerSurface';
import { StadiumVenueMap } from '../../components/StadiumVenueMap';
import { Skeleton } from '../../components/Skeleton';
import { useAuthStore } from '../../lib/auth-store';
import { usePushNotifications } from '../../lib/usePushNotifications';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { radius, spacing, useDesignTheme } from '../../lib/theme';
import { asArray, formatDuration, formatMoney } from '../../lib/format';
import { canManageVenue } from '../../lib/permissions';
import { useResponsive } from '../../lib/responsive';
import { EVENT_BEO_ROUTE, READINESS_ROW_ROUTES, type ReadinessRowLabel } from '../../lib/crm-routing';


type NotificationItem = {
  _id: Id<'notificationEvents'>;
  title: string;
  body: string;
  read: boolean;
};

const todayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const MORE_OPS = [
  { href: '/(tabs)/schedule', label: 'Rosters', icon: 'calendar-week' as const },
  { href: '/(tabs)/staff', label: 'Staff & Union', icon: 'account-group' as const },
  { href: EVENT_BEO_ROUTE, label: 'Event BEOs', icon: 'file-document-edit-outline' as const },
  { href: '/(tabs)/documents', label: 'Documents & Files', icon: 'file-document-multiple-outline' as const },
  { href: '/(tabs)/reports', label: 'Reports & Recon', icon: 'chart-box-outline' as const },
  { href: '/(tabs)/sales', label: 'Concessions POS', icon: 'cash-register' as const },
  { href: '/(tabs)/guests', label: 'CRM', icon: 'account-heart-outline' as const },
  { href: '/(tabs)/integrations', label: 'POS & Hardware', icon: 'connection' as const },
];

export default function HomeScreen() {
  usePushNotifications();
  const venue = useAuthStore((state) => state.venue);
  const venues = useAuthStore((state) => state.venues);
  const { isReady } = useAuthenticatedSession();
  const palette = useDesignTheme();
  const { pagePadding, isPhone } = useResponsive();
  const dashboard = useQuery(api.app.getDashboard, isReady ? {} : 'skip');
  const notifications = useQuery(api.app.getNotifications, isReady ? {} : 'skip');
  const markNotificationRead = useMutation(api.app.markNotificationRead);
  const upsertManagerGoal = useMutation(api.operations.upsertManagerGoal);
  const [showNotifications, setShowNotifications] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');

  const venueName = dashboard?.venue?.name ?? venue?.name ?? 'Stadium F&B Operations';
  const canManage = Boolean(dashboard?.profile && canManageVenue(dashboard.profile.role, dashboard.profile.allAccess));
  const managerDashboard = useQuery(api.operations.getManagerDashboard, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const dailyBrief = useQuery(api.operations.getDailyBrief, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const commandCenter = useQuery(api.operations.getCommandCenter, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const notificationsList = asArray(notifications) as NotificationItem[];
  const unreadCount = notificationsList.filter((item) => !item.read).length;
  const readiness = commandCenter?.readiness;
  const pulse = dailyBrief?.profitabilityPulse;
  const events = commandCenter?.events?.slice(0, 4) ?? asArray(managerDashboard?.events?.slice(0, 4));
  const loading = dashboard === undefined;
  const currentDate = todayLabel.format(new Date());
  const readinessRows = useMemo(() => {
    const values = readiness?.categories ?? {};
    return [
      ['Concessions & Stands', values.floor ?? values['floor'] ?? 0],
      ['Luxury Suite BEOs', values.approvals ?? values['approvals'] ?? 0],
      ['Commissary & Kitchens', values.setup ?? values['setup'] ?? 0],
      ['Staffing & Union Roster', values.staffing ?? values['staffing'] ?? 0],
    ] as const satisfies ReadonlyArray<readonly [ReadinessRowLabel, number]>;
  }, [readiness?.categories]);

  const markAllRead = async () => {
    await Promise.all(notificationsList.filter((item) => !item.read).map((item) => markNotificationRead({ notificationId: item._id })));
  };

  const addGoal = async () => {
    if (!venue?.id || !goalTitle.trim()) return;
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await upsertManagerGoal({ venueId: venue.id, title: goalTitle.trim(), period: 'day', targetDate: date, status: 'open' });
    setGoalTitle('');
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: 'transparent' }} contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
      <View style={{ backgroundColor: palette.primary, paddingHorizontal: pagePadding, paddingTop: isPhone ? spacing.lg : spacing.xl, paddingBottom: spacing.lg, gap: spacing.md, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Pressable onPress={() => router.push('/venue/settings')} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 4 })}>
              <CommandText palette={palette} variant="label" style={{ color: palette.buttonText, opacity: 0.7 }}>{venueName}</CommandText>
              {venues.length > 1 ? <MaterialCommunityIcons name="swap-horizontal" size={16} color={palette.buttonText} style={{ opacity: 0.7 }} /> : null}
            </Pressable>
            <CommandText palette={palette} variant="hero" style={{ color: palette.buttonText, fontSize: isPhone ? 26 : undefined }}>Stadium F&B Command</CommandText>
          </View>
          <Pressable onPress={() => setShowNotifications((value) => !value)} accessibilityRole="button" accessibilityLabel="Open notifications" style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1, padding: 8 })}>
            <View>
              <MaterialCommunityIcons name={unreadCount ? 'bell-ring-outline' : 'bell-outline'} size={24} color={String(palette.buttonText)} />
              {unreadCount ? <View style={[styles.notificationBadge, { backgroundColor: palette.secondary }]}><CommandText palette={palette} variant="caption" style={{ color: palette.buttonText }}>{unreadCount}</CommandText></View> : null}
            </View>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: `${palette.buttonText}22`, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: readiness?.status === 'blocked' ? palette.danger : readiness?.status === 'at-risk' ? palette.warning : palette.buttonText }} />
          <CommandText palette={palette} variant="caption" style={{ color: palette.buttonText, fontWeight: '700' }}>
            {readiness?.status === 'blocked' ? 'Needs attention' : readiness?.status === 'at-risk' ? 'Watch F&B operations' : 'F&B command ready'}
          </CommandText>
          <View style={{ width: StyleSheet.hairlineWidth, height: 12, backgroundColor: palette.buttonText, opacity: 0.3 }} />
          <CommandText palette={palette} variant="caption" style={{ color: palette.buttonText, opacity: 0.85, fontVariant: ['tabular-nums'] }}>{currentDate}</CommandText>
        </View>
      </View>

      <View style={{ paddingHorizontal: pagePadding, paddingTop: spacing.md, gap: spacing.sm }}>
        <Pressable onPress={() => router.push('/stadium-map')} style={({ pressed }) => [styles.heroTile, { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 }]}>
          <View style={[styles.heroIconBadge, { backgroundColor: `${palette.buttonText}22` }]}>
            <MaterialCommunityIcons name="stadium" size={24} color={String(palette.buttonText)} />
          </View>
          <View style={{ flex: 1 }}>
            <CommandText palette={palette} variant="body" style={{ color: palette.buttonText, fontWeight: '700', fontSize: 16 }}>Stadium Map</CommandText>
            <CommandText palette={palette} variant="caption" style={{ color: palette.buttonText, opacity: 0.75 }}>Zones, suites, stands</CommandText>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={String(palette.buttonText)} style={{ opacity: 0.7 }} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Pressable onPress={() => router.push('/event-command-center')} style={({ pressed }) => [styles.subTile, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 }]}>
            <MaterialCommunityIcons name="shield-star-outline" size={18} color={String(palette.primary)} />
            <CommandText palette={palette} variant="caption" style={{ fontWeight: '700', color: palette.charcoal }}>Command Center</CommandText>
          </Pressable>
          <Pressable onPress={() => router.push('/stadium/stand-sheet')} style={({ pressed }) => [styles.subTile, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 }]}>
            <MaterialCommunityIcons name="clipboard-list-outline" size={18} color={String(palette.primary)} />
            <CommandText palette={palette} variant="caption" style={{ fontWeight: '700', color: palette.charcoal }}>Stand Sheets</CommandText>
          </Pressable>
          <Pressable onPress={() => router.push('/stadium/suite-attendant')} style={({ pressed }) => [styles.subTile, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 }]}>
            <MaterialCommunityIcons name="room-service-outline" size={18} color={String(palette.primary)} />
            <CommandText palette={palette} variant="caption" style={{ fontWeight: '700', color: palette.charcoal }}>Suite BEOs</CommandText>
          </Pressable>
        </View>
      </View>

      {canManage ? (
        <View style={{ paddingHorizontal: pagePadding, paddingTop: spacing.md, gap: spacing.xs }}>
          <CommandText palette={palette} variant="label">More operations</CommandText>
          {MORE_OPS.map((item) => (
            <Pressable
              key={item.href}
              onPress={() => router.push(item.href as any)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                paddingVertical: spacing.sm,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderColor: palette.divider,
              })}
            >
              <MaterialCommunityIcons name={item.icon} size={20} color={palette.primary} />
              <CommandText palette={palette} variant="body" style={{ flex: 1, fontWeight: '600' }}>{item.label}</CommandText>
              <MaterialCommunityIcons name="chevron-right" size={18} color={palette.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <HomeWranglerSurface enabled={isReady && canManage && Boolean(venue?.id)} />

      <View style={{ paddingHorizontal: pagePadding, paddingTop: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MaterialCommunityIcons name="map-marker-radius" size={20} color={String(palette.primary)} />
            <CommandText palette={palette} variant="title">Stadium layout & zone status</CommandText>
          </View>
          <Pressable onPress={() => router.push('/stadium-map')} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 2 })}>
            <CommandText palette={palette} variant="caption" style={{ color: palette.primary, fontWeight: '700' }}>Full screen</CommandText>
            <MaterialCommunityIcons name="chevron-right" size={16} color={String(palette.primary)} />
          </Pressable>
        </View>
        <StadiumVenueMap />
      </View>

      <View style={{ paddingHorizontal: pagePadding, paddingTop: spacing.xl, gap: spacing.xl }}>
        {showNotifications ? (
          <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingVertical: spacing.md, gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <CommandText palette={palette} variant="title">Notifications</CommandText>
              {unreadCount ? <CommandButton palette={palette} onPress={() => void markAllRead()}>Mark all read</CommandButton> : null}
            </View>
            {notificationsList.length ? notificationsList.slice(0, 4).map((item) => (
              <Pressable key={item._id} onPress={() => !item.read && void markNotificationRead({ notificationId: item._id })} style={{ paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider }}>
                <CommandText palette={palette} variant="body" style={{ fontWeight: item.read ? '500' : '800' }}>{item.title}</CommandText>
                <CommandText palette={palette} variant="caption">{item.body}</CommandText>
              </Pressable>
            )) : <CommandText palette={palette} variant="caption">You are all caught up.</CommandText>}
          </View>
        ) : null}

        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <CommandText palette={palette} variant="title">Readiness snapshot</CommandText>
            <CommandText palette={palette} variant="body" style={{ color: readiness?.status === 'at-risk' ? palette.warning : palette.primary, fontWeight: '700' }}>
              {readiness ? `${readiness.score}% ready` : 'Loading'}
            </CommandText>
          </View>
          <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider }}>
            {readinessRows.map(([label, value]) => {
              const state = value >= 100 ? 'Clear' : value > 0 ? `${value}% watch` : 'Pending';
              const color = value >= 100 ? palette.success : value > 0 ? palette.warning : palette.muted;
              return (
                <Pressable key={label} onPress={() => router.push(READINESS_ROW_ROUTES[label])} style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.divider })}>
                  <CommandText palette={palette} variant="body" style={{ flex: 1 }}>{label}</CommandText>
                  <View style={{ width: 88, flexDirection: 'row', alignItems: 'center', gap: 6 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} /><CommandText palette={palette} variant="caption" style={{ color, fontWeight: '700' }}>{state}</CommandText></View>
                  <CommandText palette={palette} variant="caption" style={{ width: 80, textAlign: 'right' }}>{label === 'Staffing & Union Roster' ? 'Manager' : 'Team'}</CommandText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {canManage ? <View style={{ gap: spacing.sm, paddingBottom: spacing.md }}>
          <CommandText palette={palette} variant="title">F&B priority</CommandText>
          <TextInput value={goalTitle} onChangeText={setGoalTitle} placeholder="Add an event-day F&B priority" mode="outlined" dense outlineColor={palette.border} activeOutlineColor={palette.primary} textColor={palette.charcoal} style={{ backgroundColor: palette.surface }} />
          <CommandButton palette={palette} icon="plus" selected={Boolean(goalTitle.trim())} onPress={() => void addGoal()} style={{ alignSelf: 'flex-start' }}>Add priority</CommandButton>
        </View> : null}

        {loading ? <Skeleton height={60} /> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  notificationBadge: {
    position: 'absolute',
    right: -8,
    top: -7,
    minWidth: 17,
    height: 17,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    padding: spacing.md,
    overflow: 'hidden',
  },
  heroIconBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subTile: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
