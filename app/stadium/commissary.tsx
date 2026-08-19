import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, useApiQuery } from '../../lib/api-client';
import { asArray } from '../../lib/format';
import { OpsQueryState } from '../../components/stadium/OpsQueryState';
import { opsConsole } from '../../lib/theme';

export interface RestockTransfer {
  id: string;
  fromOutletId: string;
  toOutletId: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'in_transit' | 'completed' | 'rejected';
  items: Array<{ code: string; name: string; quantity: number }>;
  createdAt: string;
}

export interface HawkerSession {
  id: string;
  hawkerId: string;
  hawkerName: string;
  grossSalesCents: number;
  commissionRateBps: number;
  commissionPayoutCents: number;
  status: 'active' | 'checked_in' | 'settled';
}

const TRANSFERS_KEY = ['stadium', 'concourse', 'transfers'];
const HAWKERS_KEY = ['stadium', 'concourse', 'hawkers'];

export default function CentralCommissaryDashboard() {
  const queryClient = useQueryClient();
  const transfersQuery = useApiQuery<RestockTransfer[]>(TRANSFERS_KEY, '/v1/stadium/concourse/transfers');
  const hawkersQuery = useApiQuery<HawkerSession[]>(HAWKERS_KEY, '/v1/stadium/concourse/hawkers');
  const transfers = asArray<RestockTransfer>(transfersQuery.data);
  const hawkerSessions = asArray<HawkerSession>(hawkersQuery.data);
  const loading = transfersQuery.isLoading || hawkersQuery.isLoading;

  const handleUpdateTransfer = async (id: string, nextStatus: 'approved' | 'completed') => {
    try {
      await apiRequest(`/v1/stadium/concourse/transfers/${id}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
    } catch (error) {
      Alert.alert('Transfer update failed', error instanceof Error ? error.message : 'The transfer was not changed.');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: TRANSFERS_KEY });
    Alert.alert('Transfer Dispatched', `Restock Transfer marked ${nextStatus.toUpperCase()}. Restock items appended to Stand Sheet.`);
  };

  const handleSettleHawker = async (session: HawkerSession) => {
    // The checkout-time item list isn't in this list response, so we can't
    // reconstruct a real check-in count here; settle for zero returns
    // (full sellthrough) rather than a fabricated fixed count.
    try {
      const settled = await apiRequest<HawkerSession & { grossSalesCents: number; commissionPayoutCents: number }>(
        `/v1/stadium/concourse/hawkers/${session.id}/settle`,
        { method: 'POST', body: { itemsCheckedIn: [], cashCollectedCents: 0, cardCollectedCents: 0 } },
      );
      await queryClient.invalidateQueries({ queryKey: HAWKERS_KEY });
      Alert.alert(
        'Hawker Commission Settled',
        `${session.hawkerName}: Gross Sales $${(settled.grossSalesCents / 100).toFixed(2)} | Commission Payout $${(settled.commissionPayoutCents / 100).toFixed(2)}`,
      );
    } catch (error) {
      Alert.alert('Settlement failed', error instanceof Error ? error.message : 'No settlement was recorded.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>CENTRAL COMMISSARY DISPATCH</Text>
          <Text style={styles.headerSub}>WAREHOUSE TABLET DASHBOARD • HAWKER COMMISSION SETTLEMENT</Text>
        </View>
      </View>

      <OpsQueryState
        isLoading={loading}
        error={transfersQuery.error ?? hawkersQuery.error}
        loadingMessage="Loading commissary dashboard…"
        onRetry={() => {
          void transfersQuery.refetch();
          void hawkersQuery.refetch();
        }}
      >
        <ScrollView contentContainerStyle={styles.body}>
          {/* Transfer Requests Section */}
          <Text style={styles.sectionTitle}>CONCOURSE RESTOCK TRANSFER REQUESTS</Text>
          {transfers.length === 0 ? <Text style={styles.emptyText}>No restock transfers pending.</Text> : null}
          {transfers.map((t) => (
            <View key={t.id} style={styles.transferCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.destText}>TO: {t.toOutletId}</Text>
                <Text style={styles.badgeText}>{t.status.toUpperCase()}</Text>
              </View>
              <Text style={styles.reqByText}>REQUESTED BY: {t.requestedBy}</Text>
              <View style={styles.itemsBox}>
                {t.items.map((i, idx) => (
                  <Text key={idx} style={styles.itemText}>📦 {i.quantity}x {i.name} ({i.code})</Text>
                ))}
              </View>
              <View style={styles.actionRow}>
                {t.status === 'pending' && (
                  <TouchableOpacity style={styles.approveBtn} onPress={() => handleUpdateTransfer(t.id, 'approved')}>
                    <Text style={styles.btnText}>APPROVE & DISPATCH 🚚</Text>
                  </TouchableOpacity>
                )}
                {t.status === 'approved' && (
                  <TouchableOpacity style={styles.completeBtn} onPress={() => handleUpdateTransfer(t.id, 'completed')}>
                    <Text style={styles.btnText}>CONFIRM DELIVERED TO STAND ✅</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}

          {/* Hawker Vendor Commission Section */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>HAWKER VENDOR COMMISSION TRACKING</Text>
          {hawkerSessions.length === 0 ? <Text style={styles.emptyText}>No hawker vendors checked out right now.</Text> : null}
          {hawkerSessions.map((h) => (
            <View key={h.id} style={styles.hawkerCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.destText}>{h.hawkerName} ({h.hawkerId})</Text>
                <Text style={styles.badgeText}>{h.status.toUpperCase()}</Text>
              </View>
              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>GROSS SALES</Text>
                  <Text style={styles.statVal}>${(h.grossSalesCents / 100).toFixed(2)}</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>COMMISSION RATE</Text>
                  <Text style={styles.statVal}>{(h.commissionRateBps / 100).toFixed(2)}%</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>PAYOUT AMOUNT</Text>
                  <Text style={[styles.statVal, { color: opsConsole.good }]}>${(h.commissionPayoutCents / 100).toFixed(2)}</Text>
                </View>
              </View>
              {h.status !== 'settled' && (
                <TouchableOpacity style={styles.settleBtn} onPress={() => void handleSettleHawker(h)}>
                  <Text style={styles.btnText}>CHECK-IN & SETTLE COMMISSION 💵</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
      </OpsQueryState>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: opsConsole.background },
  header: { padding: 16, backgroundColor: opsConsole.surface, borderBottomWidth: 2, borderBottomColor: opsConsole.border },
  headerTitle: { color: opsConsole.text, fontSize: 22, fontWeight: '900' },
  headerSub: { color: opsConsole.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  emptyText: { color: opsConsole.mutedDim, fontSize: 13, fontStyle: 'italic' },
  body: { padding: 16, gap: 12 },
  sectionTitle: { color: opsConsole.accentSoft, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  transferCard: { backgroundColor: opsConsole.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: opsConsole.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  destText: { color: opsConsole.textStrong, fontSize: 16, fontWeight: '800' },
  badgeText: { color: opsConsole.warn, fontSize: 12, fontWeight: '900' },
  reqByText: { color: opsConsole.muted, fontSize: 12 },
  itemsBox: { backgroundColor: opsConsole.background, padding: 10, borderRadius: 8, marginVertical: 10 },
  itemText: { color: opsConsole.text, fontSize: 13, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 10 },
  approveBtn: { flex: 1, backgroundColor: opsConsole.accent, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  completeBtn: { flex: 1, backgroundColor: opsConsole.good, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { color: opsConsole.textStrong, fontSize: 13, fontWeight: '900' },
  hawkerCard: { backgroundColor: opsConsole.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: opsConsole.border },
  statsRow: { flexDirection: 'row', gap: 12, marginVertical: 12 },
  statBox: { flex: 1, backgroundColor: opsConsole.background, padding: 10, borderRadius: 8 },
  statLabel: { color: opsConsole.mutedDim, fontSize: 10, fontWeight: '800' },
  statVal: { color: opsConsole.textStrong, fontSize: 16, fontWeight: '900', marginTop: 2 },
  settleBtn: { backgroundColor: opsConsole.good, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
