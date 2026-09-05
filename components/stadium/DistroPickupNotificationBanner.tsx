import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApiQuery } from '../../lib/api-client';
import { useStadiumLiveStream } from '../../lib/stadium-live-stream';

export interface DistroTicketSummary {
  id: string;
  itemName: string;
  quantity: number;
  serviceAreaName: string;
  kitchenName: string;
  distroLocationName?: string;
  status: 'waiting' | 'firing' | 'ready' | 'overdue_pickup' | 'picked_up' | 'cancelled';
  readyAt?: string;
  isOverdue?: boolean;
}

interface DistroPickupNotificationBannerProps {
  serviceAreaId?: string;
  zoneId?: string;
}

const DISTRO_TICKETS_KEY = ['stadium', 'distro-tickets'];

export function DistroPickupNotificationBanner({ serviceAreaId, zoneId }: DistroPickupNotificationBannerProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  const queryPath = `/v1/stadium/distro-tickets?status=active${
    serviceAreaId ? `&serviceAreaId=${serviceAreaId}` : ''
  }${zoneId ? `&zoneId=${zoneId}` : ''}`;

  const query = useApiQuery<DistroTicketSummary[]>(
    DISTRO_TICKETS_KEY,
    queryPath,
    true,
    15000,
  );

  useStadiumLiveStream({
    events: ['distro_pickup_updated', 'distro_pickup_ready', 'distro_pickup_overdue'],
    invalidate: [DISTRO_TICKETS_KEY],
  });

  const tickets = Array.isArray(query.data) ? query.data : [];
  const readyTickets = tickets.filter((t: DistroTicketSummary) => t.status === 'ready' || t.status === 'overdue_pickup');
  const overdueTickets = readyTickets.filter((t: DistroTicketSummary) => t.status === 'overdue_pickup' || t.isOverdue);

  if (readyTickets.length === 0) {
    return null; // Nothing ready for pickup, keep UI uncluttered
  }

  const hasOverdue = overdueTickets.length > 0;
  const bannerBg = hasOverdue ? '#450A0A' : '#064E3B';
  const bannerBorder = hasOverdue ? '#EF4444' : '#10B981';
  const titleColor = hasOverdue ? '#FCA5A5' : '#6EE7B7';

  return (
    <View style={[styles.container, { backgroundColor: bannerBg, borderColor: bannerBorder }]}>
      <View style={styles.contentRow}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons
            name={hasOverdue ? 'alert-octagon' : 'food-takeout-box'}
            size={22}
            color={hasOverdue ? '#EF4444' : '#10B981'}
          />
        </View>

        <View style={styles.textWrap}>
          <Text style={[styles.title, { color: titleColor }]}>
            {hasOverdue
              ? `OVERDUE PICKUP: ${overdueTickets.length} item${overdueTickets.length === 1 ? '' : 's'} waiting >10m`
              : `${readyTickets.length} item${readyTickets.length === 1 ? '' : 's'} ready at Distro`}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {readyTickets.map((t: DistroTicketSummary) => `${t.quantity}x ${t.itemName} (${t.serviceAreaName})`).join(' • ')}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: hasOverdue ? '#EF4444' : '#10B981' }]}
          onPress={() => router.push('/stadium/distro-pickup')}
        >
          <Text style={styles.actionBtnText}>Open Distro</Text>
          <MaterialCommunityIcons name="arrow-right" size={14} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 8,
    borderWidth: 1.5,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    marginRight: 10,
  },
  textWrap: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  subtitle: {
    color: '#CBD5E1',
    fontSize: 11,
    marginTop: 2,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
    marginRight: 4,
  },
});
