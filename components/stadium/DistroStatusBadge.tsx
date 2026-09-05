import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export type KitchenTicketStatusType =
  | 'waiting'
  | 'firing'
  | 'ready'
  | 'overdue_pickup'
  | 'picked_up'
  | 'cancelled';

interface DistroStatusBadgeProps {
  status: KitchenTicketStatusType;
  readyAt?: string | Date | null;
  pickedUpAt?: string | Date | null;
  wasOverdue?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showTimer?: boolean;
}

export function DistroStatusBadge({
  status,
  readyAt,
  pickedUpAt,
  wasOverdue,
  size = 'md',
  showTimer = true,
}: DistroStatusBadgeProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() => {
    if (!readyAt) return 0;
    const start = new Date(readyAt).getTime();
    const end = pickedUpAt ? new Date(pickedUpAt).getTime() : Date.now();
    return Math.max(0, Math.floor((end - start) / 1000));
  });

  // Live timer tick for active ready or overdue items
  useEffect(() => {
    if (!readyAt || status === 'picked_up' || status === 'cancelled') return;

    const start = new Date(readyAt).getTime();
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [readyAt, status, pickedUpAt]);

  const isDynamicallyOverdue =
    status === 'overdue_pickup' || (status === 'ready' && elapsedSeconds >= 600);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Determine appearance based on status
  let bg = '#334155';
  let border = '#475569';
  let text = '#F8FAFC';
  let iconName: keyof typeof MaterialCommunityIcons.glyphMap = 'clock-outline';
  let label = 'Queued';

  switch (status) {
    case 'waiting':
      bg = 'rgba(234, 179, 8, 0.15)';
      border = '#EAB308';
      text = '#FACC15';
      iconName = 'timer-sand';
      label = 'Waiting / Queued';
      break;
    case 'firing':
      bg = 'rgba(234, 88, 12, 0.18)';
      border = '#EA580C';
      text = '#FB923C';
      iconName = 'fire';
      label = 'Firing';
      break;
    case 'ready':
      if (isDynamicallyOverdue) {
        bg = 'rgba(239, 68, 68, 0.22)';
        border = '#EF4444';
        text = '#FCA5A5';
        iconName = 'alert-octagon';
        label = 'Pickup Overdue';
      } else {
        bg = 'rgba(16, 185, 129, 0.18)';
        border = '#10B981';
        text = '#6EE7B7';
        iconName = 'check-circle-outline';
        label = 'Ready at Distro';
      }
      break;
    case 'overdue_pickup':
      bg = 'rgba(239, 68, 68, 0.22)';
      border = '#EF4444';
      text = '#FCA5A5';
      iconName = 'alert-octagon';
      label = 'Pickup Overdue';
      break;
    case 'picked_up':
      bg = 'rgba(100, 116, 139, 0.18)';
      border = wasOverdue ? '#F59E0B' : '#64748B';
      text = wasOverdue ? '#FCD34D' : '#94A3B8';
      iconName = 'package-variant-closed-check';
      label = wasOverdue ? 'Picked Up (Overdue)' : 'Picked Up';
      break;
    case 'cancelled':
      bg = 'rgba(71, 85, 105, 0.2)';
      border = '#475569';
      text = '#64748B';
      iconName = 'close-circle-outline';
      label = 'Cancelled';
      break;
  }

  const iconSize = size === 'sm' ? 12 : size === 'lg' ? 18 : 14;
  const fontSize = size === 'sm' ? 11 : size === 'lg' ? 14 : 12;
  const paddingV = size === 'sm' ? 2 : size === 'lg' ? 6 : 4;
  const paddingH = size === 'sm' ? 6 : size === 'lg' ? 12 : 8;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: bg,
          borderColor: border,
          paddingVertical: paddingV,
          paddingHorizontal: paddingH,
        },
      ]}
    >
      <MaterialCommunityIcons name={iconName} size={iconSize} color={text} style={styles.icon} />
      <Text style={[styles.text, { color: text, fontSize }]}>{label}</Text>
      {showTimer && readyAt && (status === 'ready' || status === 'overdue_pickup') && (
        <View style={[styles.timerPill, { backgroundColor: isDynamicallyOverdue ? '#991B1B' : '#065F46' }]}>
          <Text style={[styles.timerText, { fontSize: fontSize - 1 }]}>
            {isDynamicallyOverdue ? `+${formatTimer(elapsedSeconds - 600)}` : formatTimer(elapsedSeconds)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: 4,
  },
  text: {
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  timerPill: {
    marginLeft: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  timerText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});
