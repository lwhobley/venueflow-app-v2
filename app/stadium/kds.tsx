import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, useApiQuery } from '../../lib/api-client';
import { asArray } from '../../lib/format';
import { OpsQueryState, OpsStaleNotice } from '../../components/stadium/OpsQueryState';
import { opsConsole } from '../../lib/theme';

export interface BEOItem {
  code: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  category: string;
}

export interface SuiteBEO {
  id: string;
  beoNumber: string;
  subVenue: { name: string; code: string };
  zone: { name: string; level: string };
  hostName: string;
  guestCount: number;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  specialInstructions?: string;
  cateringLineItems: BEOItem[];
  status: 'draft' | 'confirmed_beo' | 'prep_initiated' | 'en_route' | 'delivered' | 'closed_invoiced';
  urgencyColor: string;
  minutesUntilDelivery: number;
}

const SUITE_BEOS_KEY = ['stadium', 'suite-beos'];

export default function KitchenBumpScreen() {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const queryClient = useQueryClient();

  // The board used to poll with its own setInterval and pop an Alert whenever a
  // refresh failed — on a kitchen monitor nobody is there to dismiss it. React
  // Query polls instead: it pauses while the screen is unmounted, shares one
  // cache entry with the runner queue on the same path, and keeps the last good
  // board on screen through a blip.
  const query = useApiQuery<SuiteBEO[]>(SUITE_BEOS_KEY, '/v1/stadium/suite-beos', true, 5000);
  const beos = asArray<SuiteBEO>(query.data);
  const loading = query.isLoading;
  const lastSynced = query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toLocaleTimeString() : '';
  const refresh = () => void queryClient.invalidateQueries({ queryKey: SUITE_BEOS_KEY });

  const handleBumpStatus = async (id: string, nextStatus: 'prep_initiated' | 'en_route') => {
    try {
      await apiRequest(`/v1/stadium/suite-beos/${id}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
    } catch (error) {
      Alert.alert('Status update failed', error instanceof Error ? error.message : 'The order was not changed.');
    }
    refresh();
  };

  const filteredBeos = beos.filter(b => {
    if (filterStatus === 'active') return ['confirmed_beo', 'prep_initiated'].includes(b.status);
    if (filterStatus === 'prep') return b.status === 'prep_initiated';
    if (filterStatus === 'en_route') return b.status === 'en_route';
    return true;
  });

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle}>CHEF'S BUMP SCREEN</Text>
          <Text style={styles.headerSub}>STADIUM CENTRAL KITCHEN KDS • LIVE WEBSOCKET SYNC</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.syncText}>LAST SYNC: {lastSynced || 'LIVE'}</Text>
          <TouchableOpacity style={styles.seedBtn} onPress={refresh}>
            <Text style={styles.seedBtnText}>REFRESH</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter Bar */}
      <View style={styles.filterBar}>
        {['all', 'active', 'prep', 'en_route'].map((st) => (
          <TouchableOpacity
            key={st}
            style={[styles.filterChip, filterStatus === st && styles.filterChipActive]}
            onPress={() => setFilterStatus(st)}
          >
            <Text style={[styles.filterChipText, filterStatus === st && styles.filterChipTextActive]}>
              {st.toUpperCase().replace('_', ' ')} ({beos.filter(b => st === 'all' || (st === 'active' && ['confirmed_beo', 'prep_initiated'].includes(b.status)) || b.status === st).length})
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* A failed poll keeps the last good board on screen; the strip says so. */}
      {beos.length > 0 ? <OpsStaleNotice error={query.error} onRetry={refresh} /> : null}

      <OpsQueryState
        isLoading={loading}
        error={beos.length > 0 ? null : query.error}
        isEmpty={filteredBeos.length === 0}
        loadingMessage="Loading Kitchen Bump Screen Queue…"
        emptyMessage="No suite orders match this filter."
        onRetry={refresh}
      >
        <ScrollView contentContainerStyle={styles.gridContainer}>
          {filteredBeos.map((beo) => {
            const urgencyBg = beo.minutesUntilDelivery <= 15 ? opsConsole.danger : beo.minutesUntilDelivery <= 30 ? opsConsole.warn : opsConsole.good;
            return (
              <View key={beo.id} style={styles.card}>
                {/* Urgency Header */}
                <View style={[styles.cardHeader, { backgroundColor: urgencyBg }]}>
                  <View>
                    <Text style={styles.suiteName}>{beo.subVenue?.name || 'VIP Suite'}</Text>
                    <Text style={styles.beoNumber}>{beo.beoNumber} • {beo.zone?.level || 'Level 3 VIP'}</Text>
                  </View>
                  <View style={styles.timerBadge}>
                    <Text style={styles.timerText}>
                      {beo.minutesUntilDelivery <= 0 ? 'DUE NOW' : `${beo.minutesUntilDelivery}m REMAINING`}
                    </Text>
                  </View>
                </View>

                {/* Body Content */}
                <View style={styles.cardBody}>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>HOST:</Text>
                    <Text style={styles.metaValue}>{beo.hostName} ({beo.guestCount} Guests)</Text>
                  </View>
                  
                  {beo.specialInstructions ? (
                    <View style={styles.instructionsBox}>
                      <Text style={styles.instructionsLabel}>⚠️ SPECIAL INSTRUCTIONS:</Text>
                      <Text style={styles.instructionsText}>{beo.specialInstructions}</Text>
                    </View>
                  ) : null}

                  <Text style={styles.sectionHeader}>CATERING LINE ITEMS:</Text>
                  {beo.cateringLineItems.map((item, idx) => (
                    <View key={idx} style={styles.lineItem}>
                      <Text style={styles.itemQty}>{item.quantity}x</Text>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemCat}>{item.category}</Text>
                    </View>
                  ))}
                </View>

                {/* Card Action Footer */}
                <View style={styles.cardFooter}>
                  {beo.status === 'confirmed_beo' && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.prepBtn]}
                      onPress={() => handleBumpStatus(beo.id, 'prep_initiated')}
                    >
                      <Text style={styles.actionBtnText}>BUMP TO PREP 👨‍🍳</Text>
                    </TouchableOpacity>
                  )}
                  {beo.status === 'prep_initiated' && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.readyBtn]}
                      onPress={() => handleBumpStatus(beo.id, 'en_route')}
                    >
                      <Text style={styles.actionBtnText}>READY FOR RUNNER 🏃‍♂️</Text>
                    </TouchableOpacity>
                  )}
                  {beo.status === 'en_route' && (
                    <View style={styles.statusBadgeEnRoute}>
                      <Text style={styles.statusTextEnRoute}>RUNNER EN ROUTE 🚚</Text>
                    </View>
                  )}
                  {beo.status === 'delivered' && (
                    <View style={styles.statusBadgeDelivered}>
                      <Text style={styles.statusTextDelivered}>DELIVERED TO SUITE ✅</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </OpsQueryState>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: opsConsole.background },
  header: {
    padding: 16, backgroundColor: opsConsole.surface, borderBottomWidth: 2, borderBottomColor: opsConsole.border,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitleGroup: { flexDirection: 'column' },
  headerTitle: { color: opsConsole.text, fontSize: 24, fontWeight: '900', letterSpacing: 1 },
  headerSub: { color: opsConsole.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  headerRight: { alignItems: 'flex-end' },
  syncText: { color: opsConsole.good, fontSize: 11, fontWeight: '800', marginBottom: 4 },
  seedBtn: { backgroundColor: opsConsole.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  seedBtnText: { color: opsConsole.textStrong, fontSize: 12, fontWeight: '800' },
  filterBar: { flexDirection: 'row', padding: 12, backgroundColor: opsConsole.surface, gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: opsConsole.border },
  filterChipActive: { backgroundColor: opsConsole.accent },
  filterChipText: { color: opsConsole.muted, fontSize: 12, fontWeight: '700' },
  filterChipTextActive: { color: opsConsole.textStrong },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: opsConsole.muted, marginTop: 12, fontSize: 14 },
  gridContainer: { padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '48%', backgroundColor: opsConsole.surface, borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: opsConsole.border, marginBottom: 12,
  },
  cardHeader: { padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  suiteName: { color: opsConsole.textStrong, fontSize: 18, fontWeight: '800' },
  beoNumber: { color: '#f1f5f9', fontSize: 12, fontWeight: '600' },
  timerBadge: { backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  timerText: { color: opsConsole.textStrong, fontSize: 12, fontWeight: '900' },
  cardBody: { padding: 12 },
  metaRow: { flexDirection: 'row', marginBottom: 8 },
  metaLabel: { color: opsConsole.mutedDim, fontSize: 12, fontWeight: '700', width: 60 },
  metaValue: { color: opsConsole.subtle, fontSize: 12, fontWeight: '600' },
  instructionsBox: { backgroundColor: '#451a03', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#b45309', marginVertical: 8 },
  instructionsLabel: { color: opsConsole.warn, fontSize: 11, fontWeight: '800' },
  instructionsText: { color: '#fef3c7', fontSize: 12, marginTop: 2 },
  sectionHeader: { color: opsConsole.muted, fontSize: 11, fontWeight: '800', marginTop: 8, marginBottom: 4 },
  lineItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: opsConsole.border },
  itemQty: { color: opsConsole.accentSoft, fontSize: 14, fontWeight: '900', width: 32 },
  itemName: { color: opsConsole.text, fontSize: 14, fontWeight: '600', flex: 1 },
  itemCat: { color: opsConsole.mutedDim, fontSize: 11 },
  cardFooter: { padding: 12, backgroundColor: opsConsole.background },
  actionBtn: { paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  prepBtn: { backgroundColor: '#eab308' },
  readyBtn: { backgroundColor: opsConsole.good },
  actionBtnText: { color: opsConsole.background, fontSize: 15, fontWeight: '900' },
  statusBadgeEnRoute: { backgroundColor: '#0284c7', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  statusTextEnRoute: { color: opsConsole.textStrong, fontSize: 14, fontWeight: '900' },
  statusBadgeDelivered: { backgroundColor: '#16a34a', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  statusTextDelivered: { color: opsConsole.textStrong, fontSize: 14, fontWeight: '900' },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
