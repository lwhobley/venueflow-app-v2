import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandButton, CommandText } from '../components/FutureUI';
import { StadiumVenueMap } from '../components/StadiumVenueMap';
import { spacing, useDesignTheme } from '../lib/theme';

export default function StadiumMapScreen() {
  const palette = useDesignTheme();
  const params = useLocalSearchParams<{ zoneId?: string }>();
  const initialZoneId = typeof params.zoneId === 'string' ? params.zoneId : undefined;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={{
          backgroundColor: palette.warning,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        }}
        accessibilityRole="alert"
        accessibilityLabel="Demo stadium layout. Sales and staff figures may be simulated."
      >
        <CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', fontWeight: '800' }}>
          Demo layout — stand sales, staff names, and in-seat orders may be simulated until live POS/roster feeds are bound.
        </CommandText>
      </View>
      <View style={[styles.headerBanner, { backgroundColor: '#013369' }]}>
        <View style={styles.headerTopRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 6 })}
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color="#FFFFFF" />
            <CommandText palette={palette} variant="label" style={{ color: '#A8C4E0' }}>BACK</CommandText>
          </Pressable>
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', fontWeight: '800' }}>LIVE F&B MAPPING</CommandText>
          </View>
        </View>
        <CommandText palette={palette} variant="hero" style={{ color: '#FFFFFF', marginTop: spacing.xs }}>Stadium Map</CommandText>
        <CommandText palette={palette} variant="body" style={{ color: '#C5D6EB', marginTop: 2 }}>
          Choose a level, then open a suite, club or service space for BEOs, staffing and stand details.
        </CommandText>
      </View>
      <View style={{ padding: spacing.md, gap: spacing.md }}>
        <StadiumVenueMap initialZoneId={initialZoneId} />
        <View style={[styles.quickActionsCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <CommandText palette={palette} variant="title">Stadium F&B Workflows</CommandText>
          <View style={styles.actionsGrid}>
            <CommandButton palette={palette} icon="clipboard-list-outline" onPress={() => router.push('/stadium/stand-sheet')} style={{ flex: 1, minWidth: 150 }}>Stand Sheets</CommandButton>
            <CommandButton palette={palette} icon="room-service-outline" onPress={() => router.push('/stadium/suite-attendant')} style={{ flex: 1, minWidth: 150 }}>Suite Attendant</CommandButton>
            <CommandButton palette={palette} icon="chef-hat" onPress={() => router.push('/stadium/kds')} style={{ flex: 1, minWidth: 150 }}>Kitchen KDS</CommandButton>
            <CommandButton palette={palette} icon="warehouse" onPress={() => router.push('/stadium/commissary')} style={{ flex: 1, minWidth: 150 }}>Commissary Hub</CommandButton>
            <CommandButton palette={palette} icon="broadcast" onPress={() => router.push('/stadium/pos-aggregator')} style={{ flex: 1, minWidth: 150 }}>POS Aggregator</CommandButton>
            <CommandButton palette={palette} icon="shield-check-outline" onPress={() => router.push('/stadium/multi-venue-compliance')} style={{ flex: 1, minWidth: 150 }}>Multi-Venue Compliance</CommandButton>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerBanner: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xs },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255, 255, 255, 0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00E676' },
  quickActionsCard: { borderRadius: 8, borderWidth: 1, padding: spacing.md, gap: spacing.md },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
