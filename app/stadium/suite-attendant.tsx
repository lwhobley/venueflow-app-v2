import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, useApiQuery } from '../../lib/api-client';
import { useStadiumLiveStream } from '../../lib/stadium-live-stream';
import { asArray } from '../../lib/format';
import { OpsQueryState, OpsStaleNotice } from '../../components/stadium/OpsQueryState';
import { opsConsole } from '../../lib/theme';

export interface BEOItem {
  code: string;
  name: string;
  quantity: number;
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
  deliveredAt?: string;
  deliveredBy?: string;
}

// Shared with the kitchen bump screen, so both boards read one cache entry.
const SUITE_BEOS_KEY = ['stadium', 'suite-beos'];

export default function SuiteAttendantRunnerScreen() {
  const queryClient = useQueryClient();
  const [selectedZone, setSelectedZone] = useState<string>('all');
  const [deliveryModalBeo, setDeliveryModalBeo] = useState<SuiteBEO | null>(null);
  const [replenishModalBeo, setReplenishModalBeo] = useState<SuiteBEO | null>(null);
  const [replenishSummary, setReplenishSummary] = useState<string>('');
  const [signatureName, setSignatureName] = useState<string>('');

  // Fallback cadence — the live stream (web only) invalidates this cache on
  // push, same as the kitchen bump screen it shares SUITE_BEOS_KEY with.
  const query = useApiQuery<SuiteBEO[]>(SUITE_BEOS_KEY, '/v1/stadium/suite-beos', true, 20000);
  useStadiumLiveStream({
    events: ['suite_beo_updated', 'replenishment_requested'],
    invalidate: [SUITE_BEOS_KEY],
  });
  const beos = asArray<SuiteBEO>(query.data);
  const fetchRunnerOrders = () => void queryClient.invalidateQueries({ queryKey: SUITE_BEOS_KEY });

  // The level chips were rendered but never applied, so every runner saw every
  // suite on every level.
  const visibleBeos = selectedZone === 'all'
    ? beos
    : beos.filter((beo) => beo.zone?.level === selectedZone);

  const handleMarkDelivered = async () => {
    if (!deliveryModalBeo) return;
    try {
      await apiRequest(`/v1/stadium/suite-beos/${deliveryModalBeo.id}/deliver`, {
        method: 'POST',
        body: {
          deliveredBy: signatureName || 'Attendant Runner',
          notes: 'Signed by host on runner mobile device.',
        },
      });
    } catch (error) {
      Alert.alert('Delivery update failed', error instanceof Error ? error.message : 'The delivery was not changed.');
      return;
    }
    setDeliveryModalBeo(null);
    setSignatureName('');
    fetchRunnerOrders();
  };

  const handleRequestReplenishment = async (presetText?: string) => {
    if (!replenishModalBeo) return;
    const text = presetText || replenishSummary;
    if (!text.trim()) return;

    try {
      await apiRequest(`/v1/stadium/suite-beos/${replenishModalBeo.id}/replenish`, {
        method: 'POST',
        body: {
          itemSummary: text,
          priority: 'urgent',
        },
      });
    } catch (error) {
      Alert.alert('Request failed', error instanceof Error ? error.message : 'The replenishment was not sent.');
      return;
    }

    Alert.alert('Replenishment Alert Sent!', `High-priority alert sent to Central Supply: "${text}"`);
    setReplenishModalBeo(null);
    setReplenishSummary('');
  };

  return (
    <View style={styles.container}>
      {/* Mobile Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SUITE ATTENDANT RUNNER</Text>
          <Text style={styles.headerSub}>LEVEL 3 VIP SUITES • RUNNER MOBILE INTERFACE</Text>
        </View>
        <TouchableOpacity style={styles.refreshIconBtn} onPress={() => fetchRunnerOrders()}>
          <Text style={styles.refreshIconText}>🔄</Text>
        </TouchableOpacity>
      </View>

      {/* Concourse Level Filter */}
      <View style={styles.zoneFilterBar}>
        {['all', 'Level 3 VIP', 'Level 2 Club'].map((lvl) => (
          <TouchableOpacity
            key={lvl}
            style={[styles.zoneChip, selectedZone === lvl && styles.zoneChipActive]}
            onPress={() => setSelectedZone(lvl)}
          >
            <Text style={[styles.zoneChipText, selectedZone === lvl && styles.zoneChipTextActive]}>
              {lvl.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {beos.length > 0 ? <OpsStaleNotice error={query.error} onRetry={fetchRunnerOrders} /> : null}

      <OpsQueryState
        isLoading={query.isLoading}
        error={beos.length > 0 ? null : query.error}
        isEmpty={visibleBeos.length === 0}
        loadingMessage="Loading suite delivery queue…"
        emptyMessage="No suite deliveries on this level right now."
        onRetry={fetchRunnerOrders}
      >
      <ScrollView contentContainerStyle={styles.listContainer}>
        {visibleBeos.map((beo) => (
          <View key={beo.id} style={styles.orderCard}>
            {/* Status Banner */}
            <View style={[styles.statusBanner, beo.status === 'delivered' ? styles.bgDelivered : beo.status === 'en_route' ? styles.bgEnRoute : styles.bgPrep]}>
              <Text style={styles.statusBannerText}>
                {beo.status === 'delivered' ? 'DELIVERED ✅' : beo.status === 'en_route' ? 'READY FOR DELIVERY 🏃‍♂️' : 'KITCHEN PREP IN PROGRESS 👨‍🍳'}
              </Text>
              <Text style={styles.beoNumberText}>{beo.beoNumber}</Text>
            </View>

            <View style={styles.cardContent}>
              <Text style={styles.suiteTitle}>{beo.subVenue?.name || 'VIP Suite'}</Text>
              <Text style={styles.hostSubtitle}>Host: {beo.hostName} ({beo.guestCount} Guests)</Text>
              
              {beo.specialInstructions ? (
                <Text style={styles.instructionsText}>⚠️ {beo.specialInstructions}</Text>
              ) : null}

              <Text style={styles.itemsHeader}>CATERING ITEMS TO DELIVER:</Text>
              {beo.cateringLineItems.map((item, idx) => (
                <View key={idx} style={styles.itemRow}>
                  <Text style={styles.itemBadge}>{item.quantity}x</Text>
                  <Text style={styles.itemText}>{item.name}</Text>
                </View>
              ))}

              {/* Action Buttons */}
              <View style={styles.actionRow}>
                {beo.status !== 'delivered' && (
                  <TouchableOpacity style={styles.deliverBtn} onPress={() => setDeliveryModalBeo(beo)}>
                    <Text style={styles.deliverBtnText}>MARK DELIVERED ✍️</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.replenishBtn} onPress={() => setReplenishModalBeo(beo)}>
                  <Text style={styles.replenishBtnText}>REQUEST REPLENISHMENT 🍾</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
      </OpsQueryState>

      {/* Mark Delivered Modal */}
      {deliveryModalBeo && (
        <Modal visible transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>CONFIRM SUITE DELIVERY</Text>
              <Text style={styles.modalSub}>{deliveryModalBeo.subVenue?.name} • {deliveryModalBeo.beoNumber}</Text>

              <Text style={styles.inputLabel}>SUITE HOST SIGNATURE NAME:</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Enter host name (e.g. John Executive)"
                placeholderTextColor={opsConsole.mutedDim}
                value={signatureName}
                onChangeText={setSignatureName}
              />

              <View style={styles.sigCanvasMock}>
                <Text style={styles.sigMockText}>[ DIGITAL TOUCH SIGNATURE VERIFIED ]</Text>
              </View>

              <View style={styles.modalActionRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setDeliveryModalBeo(null)}>
                  <Text style={styles.cancelBtnText}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmBtn} onPress={handleMarkDelivered}>
                  <Text style={styles.confirmBtnText}>SUBMIT DELIVERY</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Replenishment Quick Drawer Modal */}
      {replenishModalBeo && (
        <Modal visible transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>INSTANT REPLENISHMENT REQUEST</Text>
              <Text style={styles.modalSub}>{replenishModalBeo.subVenue?.name} • High Priority Alert</Text>

              <Text style={styles.inputLabel}>QUICK PRESETS:</Text>
              <View style={styles.presetRow}>
                <TouchableOpacity style={styles.presetChip} onPress={() => handleRequestReplenishment('Need 2x Ice Bags & 1x Champagne Case')}>
                  <Text style={styles.presetChipText}>2x Ice + 1x Champagne 🍾</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.presetChip} onPress={() => handleRequestReplenishment('Need Glassware Refresh & Cutlery')}>
                  <Text style={styles.presetChipText}>Glassware + Cutlery 🥂</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>CUSTOM REQUEST:</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Need 3x Mineral Water, 2x Fruit Platters"
                placeholderTextColor={opsConsole.mutedDim}
                value={replenishSummary}
                onChangeText={setReplenishSummary}
              />

              <View style={styles.modalActionRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setReplenishModalBeo(null)}>
                  <Text style={styles.cancelBtnText}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmBtn} onPress={() => handleRequestReplenishment()}>
                  <Text style={styles.confirmBtnText}>SEND ALERT 🚨</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: opsConsole.background },
  header: {
    padding: 16, backgroundColor: opsConsole.surface, borderBottomWidth: 1, borderBottomColor: opsConsole.border,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle: { color: opsConsole.text, fontSize: 18, fontWeight: '900' },
  headerSub: { color: opsConsole.muted, fontSize: 10, fontWeight: '700', marginTop: 2 },
  refreshIconBtn: { backgroundColor: opsConsole.border, padding: 8, borderRadius: 8 },
  refreshIconText: { fontSize: 16 },
  zoneFilterBar: { flexDirection: 'row', padding: 12, backgroundColor: opsConsole.surface, gap: 8 },
  zoneChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: opsConsole.border },
  zoneChipActive: { backgroundColor: opsConsole.accent },
  zoneChipText: { color: opsConsole.muted, fontSize: 11, fontWeight: '700' },
  zoneChipTextActive: { color: opsConsole.textStrong },
  listContainer: { padding: 12, gap: 12 },
  orderCard: { backgroundColor: opsConsole.surface, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: opsConsole.border },
  statusBanner: { paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bgPrep: { backgroundColor: '#eab308' },
  bgEnRoute: { backgroundColor: '#0284c7' },
  bgDelivered: { backgroundColor: '#16a34a' },
  statusBannerText: { color: opsConsole.textStrong, fontSize: 12, fontWeight: '900' },
  beoNumberText: { color: opsConsole.textStrong, fontSize: 11, fontWeight: '700' },
  cardContent: { padding: 12 },
  suiteTitle: { color: opsConsole.textStrong, fontSize: 18, fontWeight: '800' },
  hostSubtitle: { color: opsConsole.muted, fontSize: 12, marginTop: 2 },
  instructionsText: { color: opsConsole.warn, fontSize: 12, fontWeight: '600', marginTop: 6, backgroundColor: '#451a03', padding: 6, borderRadius: 4 },
  itemsHeader: { color: opsConsole.mutedDim, fontSize: 11, fontWeight: '800', marginTop: 10, marginBottom: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  itemBadge: { color: opsConsole.accentSoft, fontSize: 12, fontWeight: '900', width: 28 },
  itemText: { color: opsConsole.text, fontSize: 13, fontWeight: '600' },
  actionRow: { marginTop: 12, gap: 8 },
  deliverBtn: { backgroundColor: opsConsole.good, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  deliverBtnText: { color: opsConsole.textStrong, fontSize: 14, fontWeight: '900' },
  replenishBtn: { backgroundColor: opsConsole.accent, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  replenishBtnText: { color: opsConsole.textStrong, fontSize: 13, fontWeight: '800' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 16 },
  modalContent: { backgroundColor: opsConsole.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: opsConsole.border },
  modalTitle: { color: opsConsole.textStrong, fontSize: 18, fontWeight: '900' },
  modalSub: { color: opsConsole.muted, fontSize: 12, marginBottom: 16 },
  inputLabel: { color: opsConsole.subtle, fontSize: 11, fontWeight: '800', marginTop: 10, marginBottom: 6 },
  textInput: { backgroundColor: opsConsole.background, color: opsConsole.textStrong, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: opsConsole.border, fontSize: 14 },
  sigCanvasMock: { height: 80, backgroundColor: opsConsole.background, borderRadius: 8, borderWidth: 1, borderColor: opsConsole.good, justifyContent: 'center', alignItems: 'center', marginVertical: 12 },
  sigMockText: { color: opsConsole.good, fontSize: 12, fontWeight: '800' },
  presetRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  presetChip: { backgroundColor: opsConsole.border, padding: 10, borderRadius: 8 },
  presetChipText: { color: opsConsole.accentSoft, fontSize: 12, fontWeight: '700' },
  modalActionRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn: { flex: 1, backgroundColor: '#475569', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  cancelBtnText: { color: opsConsole.textStrong, fontSize: 13, fontWeight: '800' },
  confirmBtn: { flex: 1, backgroundColor: opsConsole.good, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  confirmBtnText: { color: opsConsole.textStrong, fontSize: 13, fontWeight: '900' },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
