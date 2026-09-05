import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, Card, Chip, Dialog, Portal, Text, TextInput } from 'react-native-paper';
import { router } from 'expo-router';
import { useAuthStore, type AuthState } from '../lib/auth-store';
import { ApiError } from '../lib/api-client';
import { useMutation } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import { colors, spacing, type } from '../lib/theme';
import type { VenueSummary } from '../lib/types';
import { AppCard, SectionHeader } from './AppCard';

export function VenueSwitcher() {
  const activeVenue = useAuthStore((state: AuthState) => state.venue);
  const venues = useAuthStore((state: AuthState) => state.venues);
  const switchVenueAction = useAuthStore((state: AuthState) => state.switchVenue);
  const user = useAuthStore((state: AuthState) => state.user);

  const switchVenueMutation = useMutation(api.app.switchVenue);
  const registerVenueMutation = useMutation(api.app.registerVenue);

  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [registerVisible, setRegisterVisible] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState(user?.full_name ?? '');
  const [staffRange, setStaffRange] = useState('1-15');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSwitch = async (v: VenueSummary) => {
    if (v.id === activeVenue?.id) return;
    setSwitchingId(v.id);
    setError(null);
    try {
      const result = await switchVenueMutation({ venueId: v.id });
      if (result?.venue) {
        switchVenueAction({
          id: result.venue._id ?? result.venue.id,
          name: result.venue.name,
          latitude: result.venue.latitude,
          longitude: result.venue.longitude,
          geofence_radius_m: result.venue.geofenceRadiusM ?? result.venue.geofence_radius_m,
        });
        if (result.venues) {
          useAuthStore.getState().setVenues(result.venues);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch venue.');
    } finally {
      setSwitchingId(null);
    }
  };

  const handleRegisterNewVenue = async () => {
    if (!businessName.trim()) {
      setError('Business name is required.');
      return;
    }
    setRegistering(true);
    setError(null);
    try {
      const result = await registerVenueMutation({
        businessName: businessName.trim(),
        ownerName: ownerName.trim() || undefined,
        staffRange,
      });
      if (result?.venue) {
        const newVenue = {
          id: result.venue._id ?? result.venue.id,
          name: result.venue.name,
          latitude: result.venue.latitude,
          longitude: result.venue.longitude,
          geofence_radius_m: result.venue.geofenceRadiusM ?? result.venue.geofence_radius_m,
        };
        switchVenueAction(newVenue);
        if (result.venues) {
          useAuthStore.getState().setVenues(result.venues);
        }
      }
      setRegisterVisible(false);
      setBusinessName('');
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 402) {
        setError('Multi-Venue Pro subscription ($399/mo) required to register additional venues.');
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || 'Failed to register new venue.');
      }
    } finally {
      setRegistering(false);
    }
  };

  return (
    <AppCard style={styles.container}>
      <SectionHeader
        title="Multi-Venue Management"
        subtitle="Switch between your locations or register an additional venue"
      />

      {error ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.errorText}>{error}</Text>
          {error.includes('Multi-Venue Pro') ? (
            <Button
              mode="contained"
              buttonColor={colors.primary}
              compact
              onPress={() => {
                setRegisterVisible(false);
                router.push('/billing/paywall');
              }}
            >
              Upgrade to Multi-Venue Pro ($399/mo)
            </Button>
          ) : null}
        </View>
      ) : null}

      <View style={styles.venueList}>
        {venues.map((v) => {
          const isActive = v.id === activeVenue?.id;
          const isSwitching = switchingId === v.id;
          return (
            <Card key={v.id} style={[styles.venueCard, isActive && styles.activeVenueCard]}>
              <Card.Content style={styles.venueCardContent}>
                <View style={styles.venueInfo}>
                  <Text style={styles.venueName}>{v.name}</Text>
                  <View style={styles.chipRow}>
                    <Chip compact style={styles.roleChip} textStyle={styles.chipText}>
                      {v.role.toUpperCase()}
                    </Chip>
                    {isActive ? (
                      <Chip compact style={styles.activeChip} textStyle={styles.activeChipText}>
                        Active
                      </Chip>
                    ) : null}
                  </View>
                </View>
                {!isActive ? (
                  <Button
                    mode="contained-tonal"
                    compact
                    disabled={isSwitching}
                    loading={isSwitching}
                    onPress={() => void handleSwitch(v)}
                    buttonColor={colors.primary}
                    textColor={colors.buttonText}
                  >
                    Switch
                  </Button>
                ) : null}
              </Card.Content>
            </Card>
          );
        })}
      </View>

      <Button
        mode="outlined"
        icon="plus-box"
        style={styles.addButton}
        textColor={colors.primary}
        onPress={() => {
          setError(null);
          setRegisterVisible(true);
        }}
      >
        Register Additional Venue
      </Button>

      <Portal>
        <Dialog visible={registerVisible} onDismiss={() => setRegisterVisible(false)}>
          <Dialog.Title>Add New Venue</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <Text variant="bodyMedium" style={styles.dialogNotice}>
              Registering a new venue will create an independent location with its own roster, schedule, and subscription.
            </Text>
            <TextInput
              label="Venue / Business Name"
              value={businessName}
              onChangeText={setBusinessName}
              mode="outlined"
              style={styles.input}
            />
            <TextInput
              label="Your Title / Owner Name"
              value={ownerName}
              onChangeText={setOwnerName}
              mode="outlined"
              style={styles.input}
            />
            <Text style={styles.staffRangeLabel}>Staff Size Range</Text>
            <View style={styles.staffRangeRow}>
              {['1-15', '16-30', '31-50'].map((range) => (
                <Button
                  key={range}
                  mode={staffRange === range ? 'contained' : 'outlined'}
                  compact
                  onPress={() => setStaffRange(range)}
                  buttonColor={staffRange === range ? colors.primary : undefined}
                >
                  {range}
                </Button>
              ))}
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRegisterVisible(false)} disabled={registering}>
              Cancel
            </Button>
            <Button
              mode="contained"
              buttonColor={colors.primary}
              loading={registering}
              disabled={registering}
              onPress={() => void handleRegisterNewVenue()}
            >
              Create Venue
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
  },
  venueList: {
    gap: spacing.sm,
  },
  venueCard: {
    backgroundColor: colors.surface,
    borderColor: '#E4E7EC',
    borderWidth: 1,
    borderRadius: 8,
  },
  activeVenueCard: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  venueCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  venueInfo: {
    gap: 4,
    flex: 1,
  },
  venueName: {
    ...type.subtitle,
    color: colors.charcoal,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  roleChip: {
    backgroundColor: '#F2F4F7',
  },
  chipText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.charcoal,
  },
  activeChip: {
    backgroundColor: colors.primary,
  },
  activeChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.buttonText,
  },
  addButton: {
    marginTop: spacing.xs,
    borderColor: colors.primary,
  },
  dialogContent: {
    gap: spacing.sm,
  },
  dialogNotice: {
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
  },
  staffRangeLabel: {
    fontWeight: '600',
    fontSize: 12,
    color: colors.charcoal,
    marginTop: 4,
  },
  staffRangeRow: {
    flexDirection: 'row',
    gap: 8,
  },
});
