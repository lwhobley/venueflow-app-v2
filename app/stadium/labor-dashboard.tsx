import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';

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

export default function SupervisorLaborDashboard() {
  const [overrideReason, setOverrideReason] = useState('');
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);

  const mockRecords: AuditRecord[] = [
    { workerId: 'w_1', unionMemberId: 'LOCAL226-1001', workerName: 'TempWorker 1', agencyName: 'Instawork', regularHours: 8.0, overtimeHours: 2.0, doubleTimeHours: 0.0, mealPenaltyPayCents: 2500, violationNotes: 'Worked 10.0 consecutive hours without mandatory 30-min meal break by Hour 5' },
    { workerId: 'w_2', unionMemberId: 'LOCAL226-1002', workerName: 'TempWorker 2', agencyName: 'Instawork', regularHours: 8.0, overtimeHours: 0.0, doubleTimeHours: 0.0, mealPenaltyPayCents: 0 },
    { workerId: 'w_3', unionMemberId: 'LOCAL226-1003', workerName: 'TempWorker 3', agencyName: 'Instawork', regularHours: 8.0, overtimeHours: 4.0, doubleTimeHours: 1.5, mealPenaltyPayCents: 0 },
  ];

  const handleSupervisorOverride = async () => {
    if (!overrideReason.trim()) {
      Alert.alert('Grievance Audit Requirement', 'Please enter a supervisor override reason to log for union compliance audits.');
      return;
    }
    Alert.alert('Punch Override Recorded', `Supervisor override logged for union grievance audit: "${overrideReason}"`);
    setOverrideReason('');
    setSelectedWorkerId(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SUPERVISOR LABOR RECONCILIATION & UNION AUDIT</Text>
          <Text style={styles.headerSub}>REAL-TIME HEADCOUNT • MEAL BREAK WARNINGS • UNION PAYROLL REPORT</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Headcount Summary Cards */}
        <View style={styles.row}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>BUDGETED HEADCOUNT</Text>
            <Text style={styles.cardVal}>200 WORKERS</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>CHECKED-IN ON SITE</Text>
            <Text style={[styles.cardVal, { color: '#10b981' }]}>198 WORKERS</Text>
          </View>
          <View style={[styles.card, { borderColor: '#f59e0b' }]}>
            <Text style={styles.cardLabel}>MEAL BREAK WARNINGS (15m)</Text>
            <Text style={[styles.cardVal, { color: '#f59e0b' }]}>1 WORKER</Text>
          </View>
        </View>

        {/* Union Break Alert Box */}
        <View style={styles.alertBox}>
          <Text style={styles.alertTitle}>⚠️ 15-MINUTE MANDATORY MEAL BREAK WARNING:</Text>
          <Text style={styles.alertText}>
            Worker TempWorker 1 (LOCAL226-1001) is approaching 4.75 continuous hours without a meal punch. Schedule 30-min break immediately to prevent $25.00 union meal penalty pay.
          </Text>
        </View>

        {/* Union Payroll Audit Report */}
        <View style={styles.tableCard}>
          <Text style={styles.tableTitle}>UNION PAYROLL AUDIT REPORT (LOCAL 226 CULINARY)</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, { flex: 1.5 }]}>WORKER / UNION ID</Text>
            <Text style={styles.th}>REG (1.0x)</Text>
            <Text style={styles.th}>OT (1.5x)</Text>
            <Text style={styles.th}>DT (2.0x)</Text>
            <Text style={styles.th}>MEAL PENALTY</Text>
            <Text style={styles.th}>ACTIONS</Text>
          </View>

          {mockRecords.map((r) => (
            <View key={r.workerId} style={styles.tableRow}>
              <View style={{ flex: 1.5 }}>
                <Text style={styles.workerName}>{r.workerName}</Text>
                <Text style={styles.workerSub}>{r.unionMemberId} • {r.agencyName}</Text>
              </View>
              <Text style={styles.td}>{r.regularHours.toFixed(1)}h</Text>
              <Text style={[styles.td, r.overtimeHours > 0 ? { color: '#38bdf8', fontWeight: '900' } : {}]}>{r.overtimeHours.toFixed(1)}h</Text>
              <Text style={[styles.td, r.doubleTimeHours > 0 ? { color: '#f59e0b', fontWeight: '900' } : {}]}>{r.doubleTimeHours.toFixed(1)}h</Text>
              <Text style={[styles.td, r.mealPenaltyPayCents > 0 ? { color: '#ef4444', fontWeight: '900' } : {}]}>
                ${(r.mealPenaltyPayCents / 100).toFixed(2)}
              </Text>
              <TouchableOpacity style={styles.overrideBtn} onPress={() => setSelectedWorkerId(r.workerId)}>
                <Text style={styles.overrideBtnText}>OVERRIDE 📝</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Supervisor Override Modal Box */}
        {selectedWorkerId && (
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>SUPERVISOR PUNCH OVERRIDE (UNION GRIEVANCE LOG)</Text>
            <Text style={styles.modalSub}>Worker: {selectedWorkerId} • Mandatory audit reason required for contract compliance</Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Enter override reason (e.g. Employee late meal due to emergency stand rush)..."
              placeholderTextColor="#64748b"
              value={overrideReason}
              onChangeText={setOverrideReason}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelectedWorkerId(null)}>
                <Text style={styles.btnText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleSupervisorOverride}>
                <Text style={styles.btnText}>SUBMIT OVERRIDE LOG ✅</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 2, borderBottomColor: '#334155' },
  headerTitle: { color: '#f8fafc', fontSize: 20, fontWeight: '900' },
  headerSub: { color: '#94a3b8', fontSize: 11, fontWeight: '700', marginTop: 2 },
  body: { padding: 16, gap: 16 },
  row: { flexDirection: 'row', gap: 12 },
  card: { flex: 1, backgroundColor: '#1e293b', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  cardLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '800' },
  cardVal: { color: '#f8fafc', fontSize: 18, fontWeight: '900', marginTop: 4 },
  alertBox: { backgroundColor: '#78350f', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#f59e0b' },
  alertTitle: { color: '#fcd34d', fontSize: 13, fontWeight: '900' },
  alertText: { color: '#fef3c7', fontSize: 12, marginTop: 4, lineHeight: 18 },
  tableCard: { backgroundColor: '#1e293b', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  tableTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '900', marginBottom: 12 },
  tableHeader: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: '#334155' },
  th: { flex: 1, color: '#64748b', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  tableRow: { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#334155', alignItems: 'center' },
  workerName: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  workerSub: { color: '#94a3b8', fontSize: 10 },
  td: { flex: 1, color: '#cbd5e1', fontSize: 13, textAlign: 'center' },
  overrideBtn: { backgroundColor: '#334155', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  overrideBtnText: { color: '#38bdf8', fontSize: 11, fontWeight: '900' },
  modalBox: { backgroundColor: '#1e293b', padding: 16, borderRadius: 12, borderWidth: 2, borderColor: '#3b82f6' },
  modalTitle: { color: '#3b82f6', fontSize: 14, fontWeight: '900' },
  modalSub: { color: '#94a3b8', fontSize: 11, marginTop: 2, marginBottom: 10 },
  reasonInput: { backgroundColor: '#0f172a', color: '#f8fafc', padding: 12, borderRadius: 8, fontSize: 13 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, backgroundColor: '#475569', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  confirmBtn: { flex: 1, backgroundColor: '#10b981', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
});
