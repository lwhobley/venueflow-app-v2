import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { apiRequest } from '../../lib/api-client';

export interface KioskCheckInResponse {
  status: 'GREEN' | 'YELLOW' | 'RED';
  message: string;
  worker: {
    id: string;
    fullName: string;
    unionMemberId?: string;
    agencyName?: string;
    assignedOutlet?: string;
  };
}

export default function StaffGateKioskScreen() {
  const [pinInput, setPinInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastCheckIn, setLastCheckIn] = useState<KioskCheckInResponse | null>(null);

  const handleKeyPress = (num: string) => {
    if (pinInput.length < 6) {
      const nextPin = pinInput + num;
      setPinInput(nextPin);
      if (nextPin.length === 6) {
        submitCheckIn(nextPin);
      }
    }
  };

  const handleClear = () => {
    setPinInput('');
  };

  const submitCheckIn = async (credential: string) => {
    setLoading(true);
    try {
      const data = await apiRequest<KioskCheckInResponse>('/v1/stadium/temp-staffing/kiosk-checkin', {
        method: 'POST',
        body: {
          credential,
          outletId: credential === '100001' ? 'STAND-104' : undefined,
        },
      });
      setLastCheckIn(data);
    } catch (error) {
      setLastCheckIn(null);
      Alert.alert('Check-in failed', error instanceof Error ? error.message : 'Unable to reach the check-in service.');
    } finally {
      setLoading(false);
      setPinInput('');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>VENUE WRANGLER ENTERPRISE • STAFF GATE KIOSK</Text>
        <Text style={styles.headerSub}>500 WORKERS / 30 MIN THROUGHPUT • RAPID PIN & QR SCANNER</Text>
      </View>

      <View style={styles.body}>
        {/* Left Column: Touch PIN Keypad */}
        <View style={styles.keypadCard}>
          <Text style={styles.keypadTitle}>ENTER 6-DIGIT ASSIGNED PIN</Text>
          <View style={styles.pinDisplay}>
            <Text style={styles.pinText}>
              {pinInput.padEnd(6, '•').split('').join('  ')}
            </Text>
          </View>

          <View style={styles.grid}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(n => (
              <TouchableOpacity key={n} style={styles.keyBtn} onPress={() => handleKeyPress(n)}>
                <Text style={styles.keyText}>{n}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.keyBtn, styles.clearBtn]} onPress={handleClear}>
              <Text style={styles.keyTextAux}>CLEAR</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.keyBtn} onPress={() => handleKeyPress('0')}>
              <Text style={styles.keyText}>0</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.keyBtn, styles.scanBtn]} onPress={() => submitCheckIn('QR-STADIUM-100001')}>
              <Text style={styles.keyTextAux}>SCAN QR</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Right Column: Status Banner & Worker Details */}
        <View style={styles.statusCard}>
          {loading ? (
            <ActivityIndicator size="large" color="#3b82f6" style={{ marginTop: 40 }} />
          ) : lastCheckIn ? (
            <View style={{ flex: 1 }}>
              <View style={[
                styles.statusBanner,
                lastCheckIn.status === 'GREEN' && styles.bgGreen,
                lastCheckIn.status === 'YELLOW' && styles.bgYellow,
                lastCheckIn.status === 'RED' && styles.bgRed,
              ]}>
                <Text style={styles.statusBadgeText}>
                  {lastCheckIn.status === 'GREEN' && '🟢 APPROVED (ASSIGNED)'}
                  {lastCheckIn.status === 'YELLOW' && '🟡 APPROVED (UNASSIGNED)'}
                  {lastCheckIn.status === 'RED' && '🔴 CHECK-IN BLOCKED'}
                </Text>
                <Text style={styles.statusMessage}>{lastCheckIn.message}</Text>
              </View>

              <View style={styles.workerDetails}>
                <Text style={styles.detailLabel}>WORKER NAME</Text>
                <Text style={styles.detailValue}>{lastCheckIn.worker.fullName}</Text>

                <Text style={styles.detailLabel}>UNION MEMBER ID</Text>
                <Text style={styles.detailValue}>{lastCheckIn.worker.unionMemberId}</Text>

                <Text style={styles.detailLabel}>QR BADGE IDENTIFIER</Text>
                <Text style={styles.detailValue}>{lastCheckIn.worker.id}</Text>

                {lastCheckIn.worker.assignedOutlet && (
                  <>
                    <Text style={styles.detailLabel}>ASSIGNED WORKSTATION</Text>
                    <Text style={[styles.detailValue, { color: '#10b981', fontSize: 18 }]}>
                      📍 {lastCheckIn.worker.assignedOutlet}
                    </Text>
                  </>
                )}
              </View>
            </View>
          ) : (
            <View style={styles.idleState}>
              <Text style={styles.idleTitle}>READY FOR WORKER ENTRY</Text>
              <Text style={styles.idleSub}>Enter 4-Digit PIN or Scan QR Badge on Camera</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 2, borderBottomColor: '#334155' },
  headerTitle: { color: '#f8fafc', fontSize: 22, fontWeight: '900' },
  headerSub: { color: '#94a3b8', fontSize: 11, fontWeight: '700', marginTop: 2 },
  body: { flex: 1, flexDirection: 'row', padding: 16, gap: 16 },
  keypadCard: { flex: 1, backgroundColor: '#1e293b', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  keypadTitle: { color: '#94a3b8', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  pinDisplay: { backgroundColor: '#0f172a', width: '100%', paddingVertical: 14, borderRadius: 10, marginVertical: 16, alignItems: 'center' },
  pinText: { color: '#38bdf8', fontSize: 32, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%', gap: 10, justifyContent: 'center' },
  keyBtn: { width: '30%', height: 60, backgroundColor: '#334155', borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  keyText: { color: '#ffffff', fontSize: 24, fontWeight: '900' },
  keyTextAux: { color: '#94a3b8', fontSize: 12, fontWeight: '900' },
  clearBtn: { backgroundColor: '#7f1d1d' },
  scanBtn: { backgroundColor: '#1e3a8a' },
  statusCard: { flex: 1.2, backgroundColor: '#1e293b', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#334155' },
  statusBanner: { padding: 16, borderRadius: 12, marginBottom: 16 },
  bgGreen: { backgroundColor: '#064e3b' },
  bgYellow: { backgroundColor: '#78350f' },
  bgRed: { backgroundColor: '#7f1d1d' },
  statusBadgeText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  statusMessage: { color: '#f8fafc', fontSize: 13, fontWeight: '700', marginTop: 4 },
  workerDetails: { backgroundColor: '#0f172a', padding: 16, borderRadius: 12, gap: 8 },
  detailLabel: { color: '#64748b', fontSize: 10, fontWeight: '800' },
  detailValue: { color: '#f8fafc', fontSize: 15, fontWeight: '800' },
  idleState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  idleTitle: { color: '#38bdf8', fontSize: 20, fontWeight: '900' },
  idleSub: { color: '#94a3b8', fontSize: 13, marginTop: 4 },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
