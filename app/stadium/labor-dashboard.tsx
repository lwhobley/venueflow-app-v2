import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useApiQuery } from '../../lib/api-client';
import { asArray } from '../../lib/format';
import { OpsQueryState } from '../../components/stadium/OpsQueryState';
import { opsConsole } from '../../lib/theme';

export interface AuditRecord {
  workerId: string;
  unionMemberId: string;
  workerName: string;
  agencyName: string;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  mealPenaltyPayCents: number;
  violationNotes?: string;
}

type ShiftSummaryRow = Omit<AuditRecord, 'agencyName' | 'violationNotes'> & { violations: Array<{ notes: string }> };

export default function SupervisorLaborDashboard() {
  const query = useApiQuery<ShiftSummaryRow[]>(
    ['stadium', 'union-compliance', 'shift-summaries'],
    '/v1/stadium/union-compliance/shift-summaries',
  );
  const records: AuditRecord[] = asArray<ShiftSummaryRow>(query.data).map((row) => ({
    ...row,
    agencyName: 'Venue Staff',
    violationNotes: asArray<{ notes: string }>(row.violations)[0]?.notes,
  }));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SUPERVISOR LABOR RECONCILIATION & UNION AUDIT</Text>
          <Text style={styles.headerSub}>REAL-TIME HEADCOUNT • MEAL BREAK WARNINGS • UNION PAYROLL REPORT</Text>
        </View>
      </View>

      <OpsQueryState
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={records.length === 0}
        loadingMessage="Loading union labor audit…"
        emptyMessage="No shift summaries recorded for today yet."
        onRetry={() => void query.refetch()}
      >
      <ScrollView contentContainerStyle={styles.body}>
        {/* Headcount Summary Cards */}
        <View style={styles.row}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>BUDGETED HEADCOUNT</Text>
            <Text style={styles.cardVal}>{records.length} WORKERS</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>CHECKED-IN ON SITE</Text>
            <Text style={[styles.cardVal, { color: opsConsole.good }]}>{records.filter((record) => record.regularHours > 0).length} WORKERS</Text>
          </View>
          <View style={[styles.card, { borderColor: opsConsole.warn }]}>
            <Text style={styles.cardLabel}>MEAL BREAK WARNINGS (15m)</Text>
            <Text style={[styles.cardVal, { color: opsConsole.warn }]}>{records.filter((record) => record.mealPenaltyPayCents > 0).length} WORKERS</Text>
          </View>
        </View>

        {/* Union Break Alert Box */}
        {records.some((record) => record.violationNotes) && <View style={styles.alertBox}>
          <Text style={styles.alertTitle}>⚠️ 15-MINUTE MANDATORY MEAL BREAK WARNING:</Text>
          <Text style={styles.alertText}>
            {records.find((record) => record.violationNotes)?.violationNotes}
          </Text>
        </View>}

        {/* Union Payroll Audit Report */}
        <View style={styles.tableCard}>
          <Text style={styles.tableTitle}>UNION PAYROLL AUDIT REPORT (LOCAL 226 CULINARY)</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, { flex: 1.5 }]}>WORKER / UNION ID</Text>
            <Text style={styles.th}>REG (1.0x)</Text>
            <Text style={styles.th}>OT (1.5x)</Text>
            <Text style={styles.th}>DT (2.0x)</Text>
            <Text style={styles.th}>MEAL PENALTY</Text>
          </View>

          {records.map((r) => (
            <View key={r.workerId} style={styles.tableRow}>
              <View style={{ flex: 1.5 }}>
                <Text style={styles.workerName}>{r.workerName}</Text>
                <Text style={styles.workerSub}>{r.unionMemberId} • {r.agencyName}</Text>
              </View>
              <Text style={styles.td}>{r.regularHours.toFixed(1)}h</Text>
              <Text style={[styles.td, r.overtimeHours > 0 ? { color: opsConsole.accentSoft, fontWeight: '900' } : {}]}>{r.overtimeHours.toFixed(1)}h</Text>
              <Text style={[styles.td, r.doubleTimeHours > 0 ? { color: opsConsole.warn, fontWeight: '900' } : {}]}>{r.doubleTimeHours.toFixed(1)}h</Text>
              <Text style={[styles.td, r.mealPenaltyPayCents > 0 ? { color: opsConsole.danger, fontWeight: '900' } : {}]}>
                ${(r.mealPenaltyPayCents / 100).toFixed(2)}
              </Text>
            </View>
          ))}
        </View>

      </ScrollView>
      </OpsQueryState>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: opsConsole.background },
  header: { padding: 16, backgroundColor: opsConsole.surface, borderBottomWidth: 2, borderBottomColor: opsConsole.border },
  headerTitle: { color: opsConsole.text, fontSize: 20, fontWeight: '900' },
  headerSub: { color: opsConsole.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  body: { padding: 16, gap: 16 },
  row: { flexDirection: 'row', gap: 12 },
  card: { flex: 1, backgroundColor: opsConsole.surface, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: opsConsole.border },
  cardLabel: { color: opsConsole.muted, fontSize: 10, fontWeight: '800' },
  cardVal: { color: opsConsole.text, fontSize: 18, fontWeight: '900', marginTop: 4 },
  alertBox: { backgroundColor: '#78350f', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: opsConsole.warn },
  alertTitle: { color: '#fcd34d', fontSize: 13, fontWeight: '900' },
  alertText: { color: '#fef3c7', fontSize: 12, marginTop: 4, lineHeight: 18 },
  tableCard: { backgroundColor: opsConsole.surface, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: opsConsole.border },
  tableTitle: { color: opsConsole.text, fontSize: 14, fontWeight: '900', marginBottom: 12 },
  tableHeader: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: opsConsole.border },
  th: { flex: 1, color: opsConsole.mutedDim, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  tableRow: { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: opsConsole.border, alignItems: 'center' },
  workerName: { color: opsConsole.textStrong, fontSize: 13, fontWeight: '700' },
  workerSub: { color: opsConsole.muted, fontSize: 10 },
  td: { flex: 1, color: opsConsole.subtle, fontSize: 13, textAlign: 'center' },
  overrideBtn: { backgroundColor: opsConsole.border, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  overrideBtnText: { color: opsConsole.accentSoft, fontSize: 11, fontWeight: '900' },
  modalBox: { backgroundColor: opsConsole.surface, padding: 16, borderRadius: 12, borderWidth: 2, borderColor: opsConsole.accent },
  modalTitle: { color: opsConsole.accent, fontSize: 14, fontWeight: '900' },
  modalSub: { color: opsConsole.muted, fontSize: 11, marginTop: 2, marginBottom: 10 },
  reasonInput: { backgroundColor: opsConsole.background, color: opsConsole.text, padding: 12, borderRadius: 8, fontSize: 13 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, backgroundColor: '#475569', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  confirmBtn: { flex: 1, backgroundColor: opsConsole.good, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  btnText: { color: opsConsole.textStrong, fontSize: 12, fontWeight: '900' },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
