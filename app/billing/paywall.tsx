import { ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { CommandButton, CommandSurface, CommandText } from '../../components/FutureUI';
import { spacing, useDesignTheme } from '../../lib/theme';
import { useAuthStore } from '../../lib/auth-store';

export default function PaywallScreen() {
  const palette = useDesignTheme();
  const venue = useAuthStore((s) => s.venue);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={{ padding: spacing.lg }}>
      <CommandSurface palette={palette} strong style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={[styles.badgeIcon, { backgroundColor: '#E8EEF5' }]}>
            <MaterialCommunityIcons name="shield-check" size={28} color="#013369" />
          </View>
          <View style={{ flex: 1 }}>
            <CommandText palette={palette} variant="label" style={{ color: '#013369' }}>
              ENTERPRISE ACCESS
            </CommandText>
            <CommandText palette={palette} variant="title">Stadium operations unlocked</CommandText>
          </View>
        </View>
        <CommandText palette={palette} variant="body">
          {venue?.name ?? 'Your venue'} is on the Venue Wrangler enterprise plan with full F&B command tools.
        </CommandText>
        <CommandButton palette={palette} selected onPress={() => router.back()}>
          Continue
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
