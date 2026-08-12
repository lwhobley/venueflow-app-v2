import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Alert } from 'react-native';
import { apiRequest } from '../../lib/api-client';

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

export default function SuiteAttendantRunnerScreen() {
  const [beos, setBeos] = useState<SuiteBEO[]>([]);
  const [selectedZone, setSelectedZone] = useState<string>('all');
  const [deliveryModalBeo, setDeliveryModalBeo] = useState<SuiteBEO | null>(null);
  const [replenishModalBeo, setReplenishModalBeo] = useState<SuiteBEO | null>(null);
  const [replenishSummary, setReplenishSummary] = useState<string>('');
  const [signatureName, setSignatureName] = useState<string>('');

  const fetchRunnerOrders = async (silent = false) => {
    try {
      setBeos(await apiRequest<SuiteBEO[]>('/v1/stadium/suite-beos'));
    } catch (error) {
      setBeos([]);
      if (!silent) Alert.alert('Runner sync failed', error instanceof Error ? error.message : 'Unable to load suite deliveries.');
    }
  };

  useEffect(() => {
    fetchRunnerOrders();
    const interval = setInterval(() => fetchRunnerOrders(true), 4000);
    return () => clearInterval(interval);
  }, []);

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

      <ScrollView contentContainerStyle={styles.listContainer}>
        {beos.map((beo) => (
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
                placeholderTextColor="#64748b"
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
                placeholderTextColor="#64748b"
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
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '900' },
  headerSub: { color: '#94a3b8', fontSize: 10, fontWeight: '700', marginTop: 2 },
  refreshIconBtn: { backgroundColor: '#334155', padding: 8, borderRadius: 8 },
  refreshIconText: { fontSize: 16 },
  zoneFilterBar: { flexDirection: 'row', padding: 12, backgroundColor: '#1e293b', gap: 8 },
  zoneChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#334155' },
  zoneChipActive: { backgroundColor: '#3b82f6' },
  zoneChipText: { color: '#94a3b8', fontSize: 11, fontWeight: '700' },
  zoneChipTextActive: { color: '#ffffff' },
  listContainer: { padding: 12, gap: 12 },
  orderCard: { backgroundColor: '#1e293b', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#334155' },
  statusBanner: { paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bgPrep: { backgroundColor: '#eab308' },
  bgEnRoute: { backgroundColor: '#0284c7' },
  bgDelivered: { backgroundColor: '#16a34a' },
  statusBannerText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  beoNumberText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  cardContent: { padding: 12 },
  suiteTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  hostSubtitle: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  instructionsText: { color: '#f59e0b', fontSize: 12, fontWeight: '600', marginTop: 6, backgroundColor: '#451a03', padding: 6, borderRadius: 4 },
  itemsHeader: { color: '#64748b', fontSize: 11, fontWeight: '800', marginTop: 10, marginBottom: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  itemBadge: { color: '#38bdf8', fontSize: 12, fontWeight: '900', width: 28 },
  itemText: { color: '#f8fafc', fontSize: 13, fontWeight: '600' },
  actionRow: { marginTop: 12, gap: 8 },
  deliverBtn: { backgroundColor: '#10b981', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  deliverBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  replenishBtn: { backgroundColor: '#3b82f6', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  replenishBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 16 },
  modalContent: { backgroundColor: '#1e293b', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#334155' },
  modalTitle: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  modalSub: { color: '#94a3b8', fontSize: 12, marginBottom: 16 },
  inputLabel: { color: '#cbd5e1', fontSize: 11, fontWeight: '800', marginTop: 10, marginBottom: 6 },
  textInput: { backgroundColor: '#0f172a', color: '#ffffff', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#334155', fontSize: 14 },
  sigCanvasMock: { height: 80, backgroundColor: '#0f172a', borderRadius: 8, borderWidth: 1, borderColor: '#10b981', justifyContent: 'center', alignItems: 'center', marginVertical: 12 },
  sigMockText: { color: '#10b981', fontSize: 12, fontWeight: '800' },
  presetRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  presetChip: { backgroundColor: '#334155', padding: 10, borderRadius: 8 },
  presetChipText: { color: '#38bdf8', fontSize: 12, fontWeight: '700' },
  modalActionRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn: { flex: 1, backgroundColor: '#475569', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  cancelBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  confirmBtn: { flex: 1, backgroundColor: '#10b981', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  confirmBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
});
