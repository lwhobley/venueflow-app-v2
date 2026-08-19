import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, useApiQuery } from '../../lib/api-client';
import { asArray } from '../../lib/format';
import { OpsQueryState } from '../../components/stadium/OpsQueryState';
import { opsConsole } from '../../lib/theme';

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

const STAND_SHEETS_KEY = ['stadium', 'concourse', 'stand-sheets'];

export default function StandSheetAuditScreen() {
  const queryClient = useQueryClient();
  const query = useApiQuery<StandSheetData[]>(STAND_SHEETS_KEY, '/v1/stadium/concourse/stand-sheets');
  const sheets = asArray<StandSheetData>(query.data);
  const loading = query.isLoading;
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const activeSheet = sheets.find((sheet) => sheet.id === selectedSheetId) ?? sheets[0] ?? null;

  // Form states for manual count out input
  const [countOutDraft, setCountOutDraft] = useState<Record<string, number>>({});
  const [posSoldDraft, setPosSoldDraft] = useState<Record<string, number>>({});
  const [actualRevenue, setActualRevenue] = useState<string>('');

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
      setSelectedSheetId(updated.id);
      await queryClient.invalidateQueries({ queryKey: STAND_SHEETS_KEY });
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

      <OpsQueryState
        isLoading={loading}
        error={query.error}
        isEmpty={!activeSheet}
        loadingMessage="Loading stand sheets…"
        emptyMessage="No stand sheets recorded for this facility yet."
        onRetry={() => void query.refetch()}
      >
        {activeSheet ? <ScrollView contentContainerStyle={styles.body}>
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
                <Text style={[styles.td, { color: opsConsole.accentSoft }]}>+{item.restocks}</Text>
                <Text style={styles.td}>{item.countOut}</Text>
                <Text style={[styles.td, { color: opsConsole.warn }]}>{item.waste}</Text>
                <Text style={[styles.td, { fontWeight: '900' }]}>{item.expectedSold}</Text>
                <Text style={[styles.td, { color: opsConsole.good, fontWeight: '900' }]}>{item.posSold}</Text>
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
        </ScrollView> : null}
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
  headerTitle: { color: opsConsole.text, fontSize: 22, fontWeight: '900' },
  headerSub: { color: opsConsole.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  reconcileBtnHeader: { backgroundColor: opsConsole.good, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  reconcileBtnText: { color: opsConsole.textStrong, fontSize: 13, fontWeight: '900' },
  body: { padding: 16, gap: 16 },
  summaryRow: { flexDirection: 'row', gap: 12 },
  summaryCard: { flex: 1, backgroundColor: opsConsole.surface, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: opsConsole.border },
  bgMatch: { borderColor: opsConsole.good },
  bgDiff: { borderColor: opsConsole.danger },
  summaryLabel: { color: opsConsole.muted, fontSize: 10, fontWeight: '800' },
  summaryValue: { color: opsConsole.text, fontSize: 20, fontWeight: '900', marginTop: 4 },
  summaryValueText: { color: opsConsole.good, fontSize: 20, fontWeight: '900', marginTop: 4 },
  standInfoBar: { backgroundColor: opsConsole.surface, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: opsConsole.border },
  standTitle: { color: opsConsole.textStrong, fontSize: 18, fontWeight: '800' },
  standSub: { color: opsConsole.accentSoft, fontSize: 12, fontWeight: '700', marginTop: 2 },
  tableCard: { backgroundColor: opsConsole.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: opsConsole.border },
  tableHeaderTitle: { color: opsConsole.text, fontSize: 14, fontWeight: '900', marginBottom: 12 },
  tableHeaderRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: opsConsole.border },
  th: { flex: 1, color: opsConsole.mutedDim, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  tableRow: { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: opsConsole.border, alignItems: 'center' },
  itemName: { color: opsConsole.textStrong, fontSize: 13, fontWeight: '700' },
  itemCode: { color: opsConsole.muted, fontSize: 10 },
  td: { flex: 1, color: opsConsole.subtle, fontSize: 13, textAlign: 'center' },
  varBadge: { fontSize: 11, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, textAlign: 'center' },
  varZero: { backgroundColor: '#064e3b', color: '#34d399' },
  varWarn: { backgroundColor: '#7f1d1d', color: '#fca5a5' },
  formulaBox: { backgroundColor: opsConsole.surface, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: opsConsole.accent },
  formulaTitle: { color: opsConsole.accent, fontSize: 12, fontWeight: '900' },
  formulaText: { color: opsConsole.subtle, fontSize: 12, marginTop: 4, lineHeight: 18 },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
