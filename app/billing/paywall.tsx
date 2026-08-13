import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandButton, CommandSurface, CommandText } from '../../components/FutureUI';
import { useAuthStore } from '../../lib/auth-store';
import { spacing, useDesignTheme } from '../../lib/theme';

export default function PaywallScreen() {
  const palette = useDesignTheme();
  const venue = useAuthStore((state) => state.venue);
  const user = useAuthStore((state) => state.user);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}
    >
      <View style={{ gap: spacing.xs, paddingTop: spacing.md }}>
        <CommandText palette={palette} variant="hero">Enterprise Licensing</CommandText>
        <CommandText palette={palette} variant="body" style={{ color: palette.muted }}>
          This application is managed and licensed directly through your stadium & venue enterprise agreement.
        </CommandText>
      </View>

      <CommandSurface palette={palette} style={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={[styles.badgeIcon, { backgroundColor: '#E8F5E9' }]}>
            <MaterialCommunityIcons name="shield-check" size={28} color="#074426" />
          </View>
          <View style={{ flex: 1 }}>
            <CommandText palette={palette} variant="label" style={{ color: '#074426' }}>
              LICENSED ENTERPRISE SEAT
            </CommandText>
            <CommandText palette={palette} variant="title">
              {venue?.name ?? 'Stadium Venue'}
            </CommandText>
          </View>
        </View>

        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingTop: spacing.md, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <CommandText palette={palette} variant="body">License Status</CommandText>
            <CommandText palette={palette} variant="body" style={{ fontWeight: '700', color: palette.success }}>
              Active & Unrestricted
            </CommandText>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <CommandText palette={palette} variant="body">Assigned Member</CommandText>
            <CommandText palette={palette} variant="body" style={{ fontWeight: '600' }}>
              {user?.full_name ?? user?.email ?? 'Enterprise Operator'}
            </CommandText>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <CommandText palette={palette} variant="body">Access Tier</CommandText>
            <CommandText palette={palette} variant="body" style={{ fontWeight: '600' }}>
              Stadium Enterprise Suite
            </CommandText>
          </View>
        </View>

        <CommandText palette={palette} variant="caption" style={{ color: palette.muted, marginTop: 4 }}>
          Staff provisioning, role assignments, and kiosk authorizations are administered centrally by your venue leadership. No consumer payment is required.
        </CommandText>

        <CommandButton palette={palette} selected onPress={() => router.replace('/(tabs)/home')} style={{ marginTop: spacing.sm }}>
          Return to Command Center
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
