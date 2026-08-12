import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';

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

export default function CentralCommissaryDashboard() {
  const [transfers, setTransfers] = useState<RestockTransfer[]>([]);
  const [hawkerSessions, setHawkerSessions] = useState<HawkerSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const apiHost = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
      const res = await fetch(`${apiHost}/v1/stadium/concourse/transfers-public?facilityId=facility-1`);
      if (res.ok) {
        const data = await res.json();
        setTransfers(data);
      } else {
        setMockData();
      }
    } catch {
      setMockData();
    } finally {
      setLoading(false);
    }
  };

  const setMockData = () => {
    setTransfers([
      {
        id: 'transfer_101',
        fromOutletId: 'WH-CENTRAL-01',
        toOutletId: 'Concourse Stand 112',
        requestedBy: 'Concourse Supervisor Dave',
        status: 'pending',
        items: [{ code: 'BEER-IPA', name: 'Craft IPA Cases (24x)', quantity: 10 }],
        createdAt: new Date().toISOString(),
      },
    ]);
    setHawkerSessions([
      {
        id: 'hawker_1',
        hawkerId: 'HAWKER-88',
        hawkerName: 'Hawker Vendor Marcus',
        grossSalesCents: 48000,
        commissionRateBps: 1500, // 15%
        commissionPayoutCents: 7200, // $72.00
        status: 'active',
      },
    ]);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUpdateTransfer = async (id: string, nextStatus: 'approved' | 'completed') => {
    try {
      const apiHost = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
      await fetch(`${apiHost}/v1/stadium/concourse/transfers/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch {
      // Optimistic mock update
    }
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, status: nextStatus } : t));
    Alert.alert('Transfer Dispatched', `Restock Transfer marked ${nextStatus.toUpperCase()}. Restock items appended to Stand Sheet.`);
  };

  const handleSettleHawker = async (sessionId: string) => {
    try {
      const apiHost = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
      await fetch(`${apiHost}/v1/stadium/concourse/hawkers/${sessionId}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemsCheckedIn: [{ code: 'BEER-IPA', quantity: 5 }],
          cashCollectedCents: 30000,
          cardCollectedCents: 18000,
        }),
      });
    } catch {
      // Optimistic update
    }
    setHawkerSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: 'settled' } : s));
    Alert.alert('Hawker Commission Settled', 'Hawker Marcus Checked In: Gross Sales $480.00 | Commission Payout (15%): $72.00');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>CENTRAL COMMISSARY DISPATCH</Text>
          <Text style={styles.headerSub}>WAREHOUSE TABLET DASHBOARD • HAWKER COMMISSION SETTLEMENT</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#3b82f6" style={{ margin: 20 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {/* Transfer Requests Section */}
          <Text style={styles.sectionTitle}>CONCOURSE RESTOCK TRANSFER REQUESTS</Text>
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
                  <Text style={[styles.statVal, { color: '#10b981' }]}>${(h.commissionPayoutCents / 100).toFixed(2)}</Text>
                </View>
              </View>
              {h.status !== 'settled' && (
                <TouchableOpacity style={styles.settleBtn} onPress={() => handleSettleHawker(h.id)}>
                  <Text style={styles.btnText}>CHECK-IN & SETTLE COMMISSION 💵</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 2, borderBottomColor: '#334155' },
  headerTitle: { color: '#f8fafc', fontSize: 22, fontWeight: '900' },
  headerSub: { color: '#94a3b8', fontSize: 11, fontWeight: '700', marginTop: 2 },
  body: { padding: 16, gap: 12 },
  sectionTitle: { color: '#38bdf8', fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  transferCard: { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  destText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  badgeText: { color: '#f59e0b', fontSize: 12, fontWeight: '900' },
  reqByText: { color: '#94a3b8', fontSize: 12 },
  itemsBox: { backgroundColor: '#0f172a', padding: 10, borderRadius: 8, marginVertical: 10 },
  itemText: { color: '#f8fafc', fontSize: 13, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 10 },
  approveBtn: { flex: 1, backgroundColor: '#3b82f6', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  completeBtn: { flex: 1, backgroundColor: '#10b981', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  hawkerCard: { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  statsRow: { flexDirection: 'row', gap: 12, marginVertical: 12 },
  statBox: { flex: 1, backgroundColor: '#0f172a', padding: 10, borderRadius: 8 },
  statLabel: { color: '#64748b', fontSize: 10, fontWeight: '800' },
  statVal: { color: '#ffffff', fontSize: 16, fontWeight: '900', marginTop: 2 },
  settleBtn: { backgroundColor: '#10b981', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
});
