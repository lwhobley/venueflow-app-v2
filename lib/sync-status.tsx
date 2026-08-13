import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { CommandText, StatusPill } from '../components/FutureUI';
import { subscribeOfflineQueue } from './offline-queue';
import { useDesignTheme } from './theme';

export function SyncStatus() {
  const palette = useDesignTheme();
  const [pending, setPending] = useState(0);
  useEffect(() => { const unsubscribe = subscribeOfflineQueue(setPending); return () => { unsubscribe(); }; }, []);
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><StatusPill palette={palette} tone={pending ? 'warn' : 'good'}>{pending ? `${pending} pending` : 'Synced'}</StatusPill>{pending ? <CommandText palette={palette} variant="caption">Will retry automatically</CommandText> : null}</View>;
}
