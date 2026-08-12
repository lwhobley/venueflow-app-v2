import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { apiRequest } from '../../lib/api-client';

export interface StandSheetItem {
  code: string;
  name: string;
  countIn: number;
  restocks: number;
  countOut: number;
  waste: number;
  expectedSold: number;
  posSold: number;
  varianceQuantity: number;
  unitPriceCents: number;
  varianceDollarsCents: number;
}

export interface StandSheetData {
  id: string;
  outlet: { name: string; code: string };
  zone: { name: string };
  supervisorName: string;
  status: 'draft' | 'count_in_recorded' | 'active_event' | 'count_out_recorded' | 'reconciled';
  expectedSalesRevenueCents: number;
  actualPosRevenueCents: number;
  varianceAmountCents: number;
  inventoryVariance: StandSheetItem[];
}

export default function StandSheetAuditScreen() {
  const [sheets, setSheets] = useState<StandSheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState<StandSheetData | null>(null);
  const [loading, setLoading] = useState(true);

  // Form states for manual count out input simulation
  const [countOutDraft, setCountOutDraft] = useState<Record<string, number>>({});
  const [posSoldDraft, setPosSoldDraft] = useState<Record<string, number>>({});
  const [actualRevenue, setActualRevenue] = useState<string>('2450.00');

  const fetchSheets = async () => {
    try {
      const data = await apiRequest<StandSheetData[]>('/v1/stadium/concourse/stand-sheets');
      setSheets(data);
      if (data.length && !activeSheet) setActiveSheet(data[0]);
    } catch (error) {
      setSheets([]);
      setActiveSheet(null);
      Alert.alert('Stand sheets unavailable', error instanceof Error ? error.message : 'Unable to load live stand sheets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSheets();
  }, []);

  const handleReconcile = async () => {
    if (!activeSheet) return;
    const items = activeSheet.inventoryVariance || [];
    const countOutItems = items.map(i => ({ code: i.code, name: i.name, count: countOutDraft[i.code] ?? i.countOut, unitPriceCents: i.unitPriceCents }));
    const wasteItems = items.map(i => ({ code: i.code, name: i.name, count: i.waste, unitPriceCents: i.unitPriceCents }));
    const posItemsSold = items.map(i => ({ code: i.code, name: i.name, count: posSoldDraft[i.code] ?? i.posSold, unitPriceCents: i.unitPriceCents }));
    const actualCents = Math.round(parseFloat(actualRevenue || '0') * 100);

    try {
      const updated = await apiRequest<StandSheetData>(`/v1/stadium/concourse/stand-sheets/${activeSheet.id}/reconcile`, {
        method: 'POST',
        body: {
          countOutItems,
          wasteItems,
          posItemsSold,
          actualPosRevenueCents: actualCents,
        },
      });
      setActiveSheet(updated);
      Alert.alert('Stand Sheet Reconciled', `Inventory Variance: $${(updated.varianceAmountCents / 100).toFixed(2)}`);
    } catch (error) {
      Alert.alert('Reconciliation failed', error instanceof Error ? error.message : 'No inventory counts were changed.');
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>STAND SHEET RECONCILIATION</Text>
          <Text style={styles.headerSub}>CONCOURSE F&B AUDIT ENGINE • AUTOMATIC VARIANCE TRACKING</Text>
        </View>
        <TouchableOpacity style={styles.reconcileBtnHeader} onPress={handleReconcile}>
          <Text style={styles.reconcileBtnText}>RECONCILE & AUDIT ✅</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#3b82f6" style={{ margin: 20 }} />
      ) : activeSheet ? (
        <ScrollView contentContainerStyle={styles.body}>
          {/* Summary Cards */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>EXPECTED REVENUE</Text>
              <Text style={styles.summaryValue}>${((activeSheet.expectedSalesRevenueCents || 0) / 100).toFixed(2)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>ACTUAL POS REVENUE</Text>
              <Text style={styles.summaryValue}>${((activeSheet.actualPosRevenueCents || 0) / 100).toFixed(2)}</Text>
            </View>
            <View style={[styles.summaryCard, activeSheet.varianceAmountCents === 0 ? styles.bgMatch : styles.bgDiff]}>
              <Text style={styles.summaryLabel}>REVENUE VARIANCE</Text>
              <Text style={styles.summaryValueText}>
                ${((activeSheet.varianceAmountCents || 0) / 100).toFixed(2)}
              </Text>
            </View>
          </View>

          {/* Stand Info Bar */}
          <View style={styles.standInfoBar}>
            <Text style={styles.standTitle}>{activeSheet.outlet?.name}</Text>
            <Text style={styles.standSub}>SUPERVISOR: {activeSheet.supervisorName} • STATUS: {activeSheet.status.toUpperCase()}</Text>
          </View>

          {/* Audit Table */}
          <View style={styles.tableCard}>
            <Text style={styles.tableHeaderTitle}>INVENTORY RECONCILIATION BREAKDOWN</Text>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.th, { flex: 2 }]}>ITEM</Text>
              <Text style={styles.th}>COUNT IN</Text>
              <Text style={styles.th}>RESTOCK</Text>
              <Text style={styles.th}>COUNT OUT</Text>
              <Text style={styles.th}>WASTE</Text>
              <Text style={styles.th}>EXP. SOLD</Text>
              <Text style={styles.th}>POS SOLD</Text>
              <Text style={styles.th}>VARIANCE</Text>
            </View>

            {(activeSheet.inventoryVariance || []).map((item, idx) => (
              <View key={idx} style={styles.tableRow}>
                <View style={{ flex: 2 }}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemCode}>{item.code} • ${(item.unitPriceCents / 100).toFixed(2)}</Text>
                </View>
                <Text style={styles.td}>{item.countIn}</Text>
                <Text style={[styles.td, { color: '#38bdf8' }]}>+{item.restocks}</Text>
                <Text style={styles.td}>{item.countOut}</Text>
                <Text style={[styles.td, { color: '#f59e0b' }]}>{item.waste}</Text>
                <Text style={[styles.td, { fontWeight: '900' }]}>{item.expectedSold}</Text>
                <Text style={[styles.td, { color: '#10b981', fontWeight: '900' }]}>{item.posSold}</Text>
                <View style={styles.td}>
                  <Text style={[styles.varBadge, item.varianceQuantity === 0 ? styles.varZero : styles.varWarn]}>
                    {item.varianceQuantity === 0 ? 'MATCH (0)' : `${item.varianceQuantity}`}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.formulaBox}>
            <Text style={styles.formulaTitle}>📐 AUTOMATIC VARIANCE FORMULA:</Text>
            <Text style={styles.formulaText}>
              Expected Stock Sold = (Count In + Restocks - Count Out - Waste){'\n'}
              Item Variance = Expected Stock Sold - POS Items Sold{'\n'}
              Dollar Variance = Expected Revenue - Actual POS Revenue
            </Text>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 2, borderBottomColor: '#334155',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle: { color: '#f8fafc', fontSize: 22, fontWeight: '900' },
  headerSub: { color: '#94a3b8', fontSize: 11, fontWeight: '700', marginTop: 2 },
  reconcileBtnHeader: { backgroundColor: '#10b981', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  reconcileBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  body: { padding: 16, gap: 16 },
  summaryRow: { flexDirection: 'row', gap: 12 },
  summaryCard: { flex: 1, backgroundColor: '#1e293b', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  bgMatch: { borderColor: '#10b981' },
  bgDiff: { borderColor: '#ef4444' },
  summaryLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '800' },
  summaryValue: { color: '#f8fafc', fontSize: 20, fontWeight: '900', marginTop: 4 },
  summaryValueText: { color: '#10b981', fontSize: 20, fontWeight: '900', marginTop: 4 },
  standInfoBar: { backgroundColor: '#1e293b', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  standTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  standSub: { color: '#38bdf8', fontSize: 12, fontWeight: '700', marginTop: 2 },
  tableCard: { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  tableHeaderTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '900', marginBottom: 12 },
  tableHeaderRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: '#334155' },
  th: { flex: 1, color: '#64748b', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  tableRow: { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#334155', alignItems: 'center' },
  itemName: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  itemCode: { color: '#94a3b8', fontSize: 10 },
  td: { flex: 1, color: '#cbd5e1', fontSize: 13, textAlign: 'center' },
  varBadge: { fontSize: 11, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, textAlign: 'center' },
  varZero: { backgroundColor: '#064e3b', color: '#34d399' },
  varWarn: { backgroundColor: '#7f1d1d', color: '#fca5a5' },
  formulaBox: { backgroundColor: '#1e293b', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#3b82f6' },
  formulaTitle: { color: '#3b82f6', fontSize: 12, fontWeight: '900' },
  formulaText: { color: '#cbd5e1', fontSize: 12, marginTop: 4, lineHeight: 18 },
});
