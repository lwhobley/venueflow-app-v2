import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandButton, CommandSurface, CommandText } from '../../components/FutureUI';
import { useAuthStore } from '../../lib/auth-store';
import { spacing, useDesignTheme } from '../../lib/theme';

export default function BillingScreen() {
  const palette = useDesignTheme();
  const venue = useAuthStore((state) => state.venue);
  const user = useAuthStore((state) => state.user);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}
    >
      <View style={{ gap: spacing.xs, paddingTop: spacing.md }}>
        <CommandText palette={palette} variant="hero">Enterprise Agreement</CommandText>
        <CommandText palette={palette} variant="body" style={{ color: palette.muted }}>
          Billing and master contract licensing are managed externally via enterprise invoice.
        </CommandText>
      </View>

      <CommandSurface palette={palette} style={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={[styles.badgeIcon, { backgroundColor: '#E8F5E9' }]}>
            <MaterialCommunityIcons name="domain" size={28} color="#074426" />
          </View>
          <View style={{ flex: 1 }}>
            <CommandText palette={palette} variant="label" style={{ color: '#074426' }}>
              ORGANIZATION PLAN
            </CommandText>
            <CommandText palette={palette} variant="title">
              {venue?.name ?? 'Enterprise Venue'}
            </CommandText>
          </View>
        </View>

        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingTop: spacing.md, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <CommandText palette={palette} variant="body">Billing Method</CommandText>
            <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
              Direct Enterprise Invoicing
            </CommandText>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <CommandText palette={palette} variant="body">Roster & Seat Budget</CommandText>
            <CommandText palette={palette} variant="body" style={{ fontWeight: '700', color: palette.success }}>
              Unlimited Stadium Staff
            </CommandText>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <CommandText palette={palette} variant="body">Contract Administrator</CommandText>
            <CommandText palette={palette} variant="body" style={{ fontWeight: '600' }}>
              {user?.email ?? 'admin@venue.org'}
            </CommandText>
          </View>
        </View>

        <CommandText palette={palette} variant="caption" style={{ color: palette.muted, marginTop: 4 }}>
          To modify enterprise seat allocations, add partner entities, or adjust annual SLA terms, contact your enterprise account executive.
        </CommandText>

        <CommandButton palette={palette} onPress={() => router.back()} style={{ marginTop: spacing.sm }}>
          Back to Settings
        </CommandButton>
      </CommandSurface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  badgeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
