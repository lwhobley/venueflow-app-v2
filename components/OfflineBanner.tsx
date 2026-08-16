import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandText } from './FutureUI';
import {
  dismissOfflineMutation,
  flushOfflineQueue,
  offlineQueueConflicts,
  offlineQueueSize,
  retryOfflineMutation,
  subscribeOfflineQueue,
  type OfflineMutation,
  type OfflineQueueSnapshot,
} from '../lib/offline-queue';
import { spacing, useDesignTheme } from '../lib/theme';

function statusLabel(status: OfflineMutation['status']) {
  if (status === 'conflict') return 'Conflict';
  if (status === 'blocked_scope') return 'Not authorized';
  return 'Failed';
}

/** Global offline / sync status for game-day operations. */
export function OfflineBanner() {
  const palette = useDesignTheme();
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(offlineQueueSize());
  const [conflicts, setConflicts] = useState<OfflineMutation[]>(offlineQueueConflicts());
  const [expanded, setExpanded] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const unsubNet = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    const unsubQueue = subscribeOfflineQueue((snapshot: OfflineQueueSnapshot) => {
      setQueued(snapshot.pending);
      setConflicts(offlineQueueConflicts());
    });
    setQueued(offlineQueueSize());
    setConflicts(offlineQueueConflicts());
    return () => {
      unsubNet();
      unsubQueue();
    };
  }, []);

  if (online && queued === 0 && conflicts.length === 0) return null;

  const backgroundColor = !online ? palette.danger : conflicts.length > 0 ? palette.danger : palette.warning;
  const label = !online
    ? queued > 0
      ? `Offline · ${queued} queued`
      : 'Offline · changes will sync when reconnected'
    : conflicts.length > 0
      ? `${conflicts.length} sync issue${conflicts.length === 1 ? '' : 's'} need review`
      : `${queued} change${queued === 1 ? '' : 's'} waiting to sync`;

  return (
    <View>
      <View
        style={{
          backgroundColor,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          borderBottomLeftRadius: expanded ? 0 : 12,
          borderBottomRightRadius: expanded ? 0 : 12,
        }}
        accessibilityRole="alert"
        accessibilityLabel={label}
      >
        <MaterialCommunityIcons
          name={!online ? 'cloud-off-outline' : conflicts.length > 0 ? 'alert-circle-outline' : 'cloud-sync-outline'}
          size={18}
          color="#FFFFFF"
        />
        <CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', flex: 1, fontWeight: '700' }}>
          {label}
        </CommandText>
        {conflicts.length > 0 ? (
          <Pressable
            onPress={() => setExpanded((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Hide sync issues' : 'Review sync issues'}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', fontWeight: '800' }}>
              {expanded ? 'Hide' : 'Review'}
            </CommandText>
          </Pressable>
        ) : null}
        {online && queued > 0 ? (
          <Pressable
            disabled={flushing}
            onPress={() => {
              setFlushing(true);
              void flushOfflineQueue().finally(() => setFlushing(false));
            }}
            accessibilityRole="button"
            accessibilityLabel="Sync now"
            style={({ pressed }) => ({ opacity: pressed || flushing ? 0.7 : 1 })}
          >
            <CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', fontWeight: '800' }}>
              {flushing ? 'Syncing…' : 'Sync now'}
            </CommandText>
          </Pressable>
        ) : null}
      </View>

      {expanded && conflicts.length > 0 ? (
        <View
          style={{
            backgroundColor: palette.surfaceStrong,
            borderBottomLeftRadius: 12,
            borderBottomRightRadius: 12,
            borderWidth: 1,
            borderTopWidth: 0,
            borderColor: palette.border,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            gap: spacing.sm,
          }}
        >
          {conflicts.slice(0, 5).map((item) => (
            <View
              key={item.id}
              style={{
                gap: spacing.xs,
                paddingVertical: spacing.xs,
                borderBottomWidth: 1,
                borderBottomColor: palette.divider,
              }}
            >
              <CommandText palette={palette} variant="caption" style={{ fontWeight: '700', color: palette.charcoal }}>
                {statusLabel(item.status)} · {item.method} {item.path}
              </CommandText>
              {item.lastError ? (
                <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                  {item.lastError}
                </CommandText>
              ) : null}
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <Pressable
                  disabled={busyId === item.id}
                  onPress={() => {
                    setBusyId(item.id);
                    void retryOfflineMutation(item.id)
                      .then(() => flushOfflineQueue())
                      .finally(() => setBusyId(null));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Retry offline mutation"
                >
                  <CommandText palette={palette} variant="caption" style={{ color: palette.primary, fontWeight: '800' }}>
                    Retry
                  </CommandText>
                </Pressable>
                <Pressable
                  disabled={busyId === item.id}
                  onPress={() => {
                    setBusyId(item.id);
                    void dismissOfflineMutation(item.id).finally(() => setBusyId(null));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss offline mutation"
                >
                  <CommandText palette={palette} variant="caption" style={{ color: palette.danger, fontWeight: '800' }}>
                    Dismiss
                  </CommandText>
                </Pressable>
              </View>
            </View>
          ))}
          {conflicts.length > 5 ? (
            <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
              +{conflicts.length - 5} more issues
            </CommandText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
