import { useCallback, useState } from 'react';
import { Alert, FlatList, SafeAreaView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { useQuery as useRQQuery, useMutation as useRQMutation, useQueryClient } from '@tanstack/react-query';
import { appApi } from '../lib/api-client';
import { spacing, type, useDesignTheme } from '../lib/theme';
import { AppCard } from '../components/AppCard';
import { useAuthStore, type AuthState } from '../lib/auth-store';
import { useI18n } from '../lib/i18n';
import { asArray } from '../lib/format';

type JoinRequest = {
  id: string;
  venueId: string;
  venueName: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  status: string;
  createdAt: number;
};

export default function JoinRequestsScreen() {
  const { t } = useI18n();
  const token = useAuthStore((s: AuthState) => s.token);
  const queryClient = useQueryClient();
  const palette = useDesignTheme();

  const { data, isLoading, error, refetch } = useRQQuery({
    queryKey: ['manager-join-requests'],
    queryFn: () => appApi.listManagerJoinRequests(),
    enabled: Boolean(token),
  });

  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleApprove = useCallback(async (req: JoinRequest) => {
    setProcessingId(req.id);
    try {
      await appApi.approveJoinRequest(req.id);
      await queryClient.invalidateQueries({ queryKey: ['manager-join-requests'] });
    } catch (e) {
      Alert.alert(t('joinRequests.approveError'), e instanceof Error ? e.message : t('joinRequests.tryAgain'));
    } finally {
      setProcessingId(null);
    }
  }, [queryClient, t]);

  const handleReject = useCallback((req: JoinRequest) => {
    Alert.alert(
      t('joinRequests.declineTitle'),
      t('joinRequests.declineMessage', { name: req.userName ?? req.userEmail ?? t('joinRequests.thisPerson'), venue: req.venueName }),
      [
        { text: t('joinRequests.cancel'), style: 'cancel' },
        {
          text: t('joinRequests.decline'),
          style: 'destructive',
          onPress: async () => {
            setProcessingId(req.id);
            try {
              await appApi.rejectJoinRequest(req.id);
              await queryClient.invalidateQueries({ queryKey: ['manager-join-requests'] });
            } catch (e) {
              Alert.alert(t('joinRequests.declineError'), e instanceof Error ? e.message : t('joinRequests.tryAgain'));
            } finally {
              setProcessingId(null);
            }
          },
        },
      ],
    );
  }, [queryClient, t]);

  const requests: JoinRequest[] = asArray(data?.requests);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }}>
      <View style={[styles.header, { borderBottomColor: palette.divider }]}>
        <Button
          icon="arrow-left"
          textColor={palette.primary}
          onPress={() => router.back()}
          compact
        >
          {t('joinRequests.back')}
        </Button>
        <Text style={{ ...type.heading, color: palette.charcoal, flex: 1, minWidth: 0 }}>
          {t('joinRequests.title')}
        </Text>
        <Button icon="refresh" textColor={palette.muted} onPress={() => void refetch()} compact>
          {''}
        </Button>
      </View>

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      )}

      {!isLoading && error && (
        <View style={styles.center}>
          <Text style={{ color: palette.danger }}>{t('joinRequests.failedToLoad')}</Text>
          <Button mode="text" textColor={palette.primary} onPress={() => void refetch()}>
            {t('joinRequests.retry')}
          </Button>
        </View>
      )}

      {!isLoading && !error && requests.length === 0 && (
        <View style={styles.center}>
          <Text style={{ ...type.heading, color: palette.charcoal }}>
            {t('joinRequests.noPendingTitle')}
          </Text>
          <Text style={{ color: palette.muted, marginTop: 4 }}>
            {t('joinRequests.noPendingSubtitle')}
          </Text>
        </View>
      )}

      {!isLoading && requests.length > 0 && (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => {
            const isProcessing = processingId === item.id;
            const name = item.userName ?? item.userEmail ?? t('joinRequests.unknownUser');
            return (
              <AppCard>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: palette.charcoal, fontWeight: '600' }}>
                        {name}
                      </Text>
                      {item.userEmail && item.userName ? (
                        <Text style={{ color: palette.muted, fontSize: 13 }}>
                          {item.userEmail}
                        </Text>
                      ) : null}
                      <Text style={{ color: palette.muted, fontSize: 13 }}>
                        {item.venueName}
                      </Text>
                      <Text style={{ color: palette.muted, fontSize: 12 }}>
                        {new Date(item.createdAt).toLocaleDateString()}
                      </Text>
                    </View>
                    {isProcessing && <ActivityIndicator size="small" color={palette.primary} />}
                  </View>
                  {!isProcessing && (
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                      <Button
                        mode="contained"
                        buttonColor={palette.primary}
                        textColor={palette.backgroundAlt}
                        onPress={() => void handleApprove(item)}
                        style={{ flex: 1 }}
                        compact
                      >
                        {t('joinRequests.approve')}
                      </Button>
                      <Button
                        mode="outlined"
                        textColor={palette.danger}
                        onPress={() => handleReject(item)}
                        style={{ flex: 1, borderColor: palette.danger }}
                        compact
                      >
                        {t('joinRequests.decline')}
                      </Button>
                    </View>
                  )}
              </AppCard>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
