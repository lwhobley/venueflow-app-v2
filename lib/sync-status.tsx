import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { CommandText, StatusPill } from '../components/FutureUI';
import { subscribeOfflineQueue, type OfflineQueueSnapshot } from './offline-queue';
import { useDesignTheme } from './theme';

export function SyncStatus() {
  const palette = useDesignTheme();
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribeOfflineQueue((snapshot: OfflineQueueSnapshot) => {
      setPending(snapshot.pending);
      setConflicts(snapshot.conflicts);
    });
    return () => {
      unsubscribe();
    };
  }, []);
  const tone = conflicts > 0 ? 'bad' : pending ? 'warn' : 'good';
  const label = conflicts > 0 ? `${conflicts} issue${conflicts === 1 ? '' : 's'}` : pending ? `${pending} pending` : 'Synced';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <StatusPill palette={palette} tone={tone as 'bad' | 'warn' | 'good'}>
        {label}
      </StatusPill>
      {pending && !conflicts ? (
        <CommandText palette={palette} variant="caption">
          Will retry automatically
        </CommandText>
      ) : null}
      {conflicts > 0 ? (
        <CommandText palette={palette} variant="caption">
          Review in the banner
        </CommandText>
      ) : null}
    </View>
  );
}
