import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../lib/auth-store';
import { useWorkspaceResolution } from '../lib/workspace-routing';
import { useAppearanceStore, designPalettes } from '../lib/theme';

export default function DepartmentRequiredScreen() {
  const router = useRouter();
  const themeMode = useAppearanceStore((s) => s.mode);
  const palette = designPalettes[themeMode];

  const user = useAuthStore((s) => s.user);
  const venue = useAuthStore((s) => s.venue);
  const clearSession = useAuthStore((s) => s.clearSession);

  const { refetch, isRefetching } = useWorkspaceResolution();

  const handleCheckAssignment = async () => {
    const res = await refetch();
    if (res.data?.assigned && res.data.defaultRoute) {
      router.replace(res.data.defaultRoute as any);
    }
  };

  const handleSignOut = async () => {
    clearSession();
    router.replace('/(auth)/sign-in');
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={[styles.iconWrapper, { backgroundColor: `${palette.warning}20` }]}>
          <MaterialCommunityIcons name="shield-account-outline" size={48} color={palette.warning} />
        </View>

        <Text variant="headlineSmall" style={[styles.title, { color: palette.charcoal }]}>
          Department Assignment Required
        </Text>

        <Text variant="bodyMedium" style={[styles.subtitle, { color: palette.muted }]}>
          You are authenticated at <Text style={{ fontWeight: '700', color: palette.charcoal }}>{venue?.name ?? 'this venue'}</Text>, but have not yet been assigned to an active operational department.
        </Text>

        <View style={[styles.infoBox, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <Text variant="labelMedium" style={{ color: palette.muted }}>Signed in as</Text>
          <Text variant="bodyMedium" style={{ color: palette.charcoal, fontWeight: '600' }}>{user?.full_name ?? user?.email}</Text>
          <Text variant="labelSmall" style={{ color: palette.muted, marginTop: 4 }}>Role: {user?.role?.toUpperCase() ?? 'STAFF'}</Text>
        </View>

        <Text variant="bodySmall" style={[styles.policyNotice, { color: palette.muted }]}>
          Per stadium operational security policy, access to suites, concessions, culinary kitchens, and rosters requires a verified department membership. Please contact your venue supervisor or department manager to be assigned.
        </Text>

        <Button
          mode="contained"
          onPress={handleCheckAssignment}
          loading={isRefetching}
          style={[styles.refreshButton, { backgroundColor: palette.primary }]}
          labelStyle={{ color: palette.buttonText, fontWeight: '700' }}
          icon="refresh"
        >
          Check Assignment Status
        </Button>

        <Button
          mode="text"
          onPress={handleSignOut}
          style={styles.signOutButton}
          labelStyle={{ color: palette.muted }}
        >
          Sign Out / Switch Venue
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 20,
    padding: 28,
    borderWidth: 1,
    alignItems: 'center',
    elevation: 4,
  },
  iconWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  infoBox: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  policyNotice: {
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 24,
  },
  refreshButton: {
    width: '100%',
    borderRadius: 12,
    marginBottom: 12,
    paddingVertical: 4,
  },
  signOutButton: {
    width: '100%',
  },
});
