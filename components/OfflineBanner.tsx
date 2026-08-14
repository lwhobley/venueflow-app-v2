import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandText } from './FutureUI';
import { flushOfflineQueue, offlineQueueSize, subscribeOfflineQueue } from '../lib/offline-queue';
import { spacing, useDesignTheme } from '../lib/theme';

/**
 * Global offline / sync status for game-day operations.
 * Shows when the device is offline or when offline mutations are queued.
 */
export function OfflineBanner() {
  const palette = useDesignTheme();
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(offlineQueueSize());
  const [flushing, setFlushing] = useState(false);

  useEffect(() => {
    const unsubNet = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    const unsubQueue = subscribeOfflineQueue((size) => setQueued(size));
    setQueued(offlineQueueSize());
    return () => {
      unsubNet();
      unsubQueue();
    };
  }, []);

  if (online && queued === 0) return null;

  const backgroundColor = !online ? palette.danger : palette.warning;
  const label = !online
    ? queued > 0
      ? `Offline · ${queued} queued`
      : 'Offline · changes will sync when reconnected'
    : `${queued} change${queued === 1 ? '' : 's'} waiting to sync`;

  return (
    <View
      style={{
        backgroundColor,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
      }}
      accessibilityRole="alert"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons
        name={online ? 'cloud-sync-outline' : 'cloud-off-outline'}
        size={18}
        color="#FFFFFF"
      />
      <CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', flex: 1, fontWeight: '700' }}>
        {label}
      </CommandText>
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
  );
}
