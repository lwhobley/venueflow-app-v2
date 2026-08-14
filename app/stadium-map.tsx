import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandButton, CommandText } from '../components/FutureUI';
import { StadiumVenueMap } from '../components/StadiumVenueMap';
import { useResponsive } from '../lib/responsive';
import { spacing, useDesignTheme } from '../lib/theme';

export default function StadiumMapScreen() {
  const palette = useDesignTheme();
  const { pagePadding, tileMinWidth, isPhone } = useResponsive();
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
          paddingHorizontal: pagePadding,
          paddingVertical: spacing.sm,
        }}
        accessibilityRole="alert"
        accessibilityLabel="Demo stadium layout. Sales and staff figures may be simulated."
      >
        <CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', fontWeight: '800' }}>
          Demo layout — stand sales, staff names, and in-seat orders may be simulated until live POS/roster feeds are bound.
        </CommandText>
      </View>

      <View
        style={[
          styles.headerBanner,
          {
            backgroundColor: '#013369',
            paddingHorizontal: pagePadding,
            paddingTop: isPhone ? spacing.lg : spacing.xl,
          },
        ]}
      >
        <View style={styles.headerTopRow}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
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
        <CommandText palette={palette} variant="hero" style={{ color: '#FFFFFF', fontSize: isPhone ? 24 : undefined }}>
          Interactive Stadium Layout
        </CommandText>
        <CommandText palette={palette} variant="body" style={{ color: '#C5D6EB', marginTop: 2 }}>
          {isPhone
            ? 'Use Directory to open a stand, or Map for the bowl layout.'
            : 'Click concourses, club lounges, and luxury suite corridors to inspect live stand sheets, BEO orders, and stock pars.'}
        </CommandText>
      </View>

      <View style={{ padding: isPhone ? spacing.sm : spacing.md, gap: spacing.md }}>
        <StadiumVenueMap initialZoneId={initialZoneId} />
        <View style={[styles.quickActionsCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <CommandText palette={palette} variant="title">Stadium F&B Workflows</CommandText>
          <View style={styles.actionsGrid}>
            {[
              { icon: 'clipboard-list-outline' as const, href: '/stadium/stand-sheet', label: 'Stand Sheets' },
              { icon: 'room-service-outline' as const, href: '/stadium/suite-attendant', label: 'Suite Attendant' },
              { icon: 'chef-hat' as const, href: '/stadium/kds', label: 'Kitchen KDS' },
              { icon: 'warehouse' as const, href: '/stadium/commissary', label: 'Commissary Hub' },
              { icon: 'broadcast' as const, href: '/stadium/pos-aggregator', label: 'POS Aggregator' },
              { icon: 'shield-check-outline' as const, href: '/stadium/multi-venue-compliance', label: 'Multi-Venue Compliance' },
            ].map((action) => (
              <CommandButton
                key={action.href}
                palette={palette}
                icon={action.icon}
                onPress={() => router.push(action.href as any)}
                style={{ flex: 1, minWidth: tileMinWidth }}
              >
                {action.label}
              </CommandButton>
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerBanner: { paddingBottom: spacing.lg, gap: spacing.xs, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D50A0A' },
  quickActionsCard: { borderRadius: 16, borderWidth: 1, padding: spacing.md, gap: spacing.md },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
