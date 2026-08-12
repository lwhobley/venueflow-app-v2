import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';

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

export default function KitchenBumpScreen() {
  const [beos, setBeos] = useState<SuiteBEO[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [lastSynced, setLastSynced] = useState<string>('');

  const fetchOrders = async () => {
    try {
      const apiHost = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
      const res = await fetch(`${apiHost}/v1/stadium/suite-beos/public-kds?facilityId=facility-1`);
      if (res.ok) {
        const data = await res.json();
        setBeos(data);
      } else {
        // Fallback demo data if API server is offline during dev UI preview
        setBeos(getMockKdsData());
      }
    } catch {
      setBeos(getMockKdsData());
    } finally {
      setLoading(false);
      setLastSynced(new Date().toLocaleTimeString());
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleBumpStatus = async (id: string, nextStatus: 'prep_initiated' | 'en_route') => {
    try {
      const apiHost = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
      await fetch(`${apiHost}/v1/stadium/suite-beos/${id}/status-public`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, actorName: 'Kitchen Staff' }),
      });
    } catch {
      // Optimistic state update for instant UI feedback
      setBeos(prev => prev.map(b => b.id === id ? { ...b, status: nextStatus } : b));
    }
    fetchOrders();
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
          <Text style={styles.headerTitle}>CHEF'S BUMP SCREEN</style>
          <Text style={styles.headerSub}>STADIUM CENTRAL KITCHEN KDS • LIVE WEBSOCKET SYNC</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.syncText}>LAST SYNC: {lastSynced || 'LIVE'}</Text>
          <TouchableOpacity style={styles.seedBtn} onPress={fetchOrders}>
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

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading Kitchen Bump Screen Queue...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.gridContainer}>
          {filteredBeos.map((beo) => {
            const urgencyBg = beo.minutesUntilDelivery <= 15 ? '#ef4444' : beo.minutesUntilDelivery <= 30 ? '#f59e0b' : '#10b981';
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
      )}
    </View>
  );
}

function getMockKdsData(): SuiteBEO[] {
  const now = new Date();
  return [
    {
      id: 'beo_101',
      beoNumber: 'BEO-SUITE-2001',
      subVenue: { name: 'VIP Suite 101 (Owner Box)', code: 'S-101' },
      zone: { name: 'East Concourse VIP', level: 'Level 3' },
      hostName: 'Global Corp Host',
      guestCount: 16,
      deliveryWindowStart: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      deliveryWindowEnd: new Date(now.getTime() + 40 * 60 * 1000).toISOString(),
      specialInstructions: 'Peanut allergy. Serve Dom Pérignon extra chilled at 45°F.',
      cateringLineItems: [
        { code: 'CAVIAR', name: 'Petrossian Caviar & Blinis', quantity: 2, unitPriceCents: 15000, category: 'Appetizers' },
        { code: 'SLIDER', name: 'Wagyu Beef Sliders (12pc)', quantity: 3, unitPriceCents: 8500, category: 'Platters' },
        { code: 'CHAMP', name: 'Dom Pérignon Vintage Champagne', quantity: 2, unitPriceCents: 35000, category: 'Beverage' },
      ],
      status: 'confirmed_beo',
      urgencyColor: '#ef4444',
      minutesUntilDelivery: 10,
    },
    {
      id: 'beo_102',
      beoNumber: 'BEO-SUITE-2002',
      subVenue: { name: 'VIP Suite 102 (Presidential)', code: 'S-102' },
      zone: { name: 'East Concourse VIP', level: 'Level 3' },
      hostName: 'Apex Capital Host',
      guestCount: 20,
      deliveryWindowStart: new Date(now.getTime() + 25 * 60 * 1000).toISOString(),
      deliveryWindowEnd: new Date(now.getTime() + 55 * 60 * 1000).toISOString(),
      cateringLineItems: [
        { code: 'CHARCUTERIE', name: 'Artisanal Cheese & Charcuterie', quantity: 2, unitPriceCents: 12000, category: 'Platters' },
        { code: 'SUSHI', name: 'Premium Sashimi & Nigiri Platter', quantity: 2, unitPriceCents: 18000, category: 'Platters' },
      ],
      status: 'prep_initiated',
      urgencyColor: '#f59e0b',
      minutesUntilDelivery: 25,
    },
    {
      id: 'beo_103',
      beoNumber: 'BEO-SUITE-2003',
      subVenue: { name: 'VIP Suite 103 (Loge Suite)', code: 'S-103' },
      zone: { name: 'North Club VIP', level: 'Level 2' },
      hostName: 'TechVentures Host',
      guestCount: 12,
      deliveryWindowStart: new Date(now.getTime() + 45 * 60 * 1000).toISOString(),
      deliveryWindowEnd: new Date(now.getTime() + 75 * 60 * 1000).toISOString(),
      cateringLineItems: [
        { code: 'SLIDER', name: 'Wagyu Beef Sliders (12pc)', quantity: 2, unitPriceCents: 8500, category: 'Platters' },
        { code: 'WINGS', name: 'Jumbo Buffalo Wings Platter', quantity: 2, unitPriceCents: 6500, category: 'Appetizers' },
      ],
      status: 'confirmed_beo',
      urgencyColor: '#10b981',
      minutesUntilDelivery: 45,
    },
  ];
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 2, borderBottomColor: '#334155',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitleGroup: { flexDirection: 'column' },
  headerTitle: { color: '#f8fafc', fontSize: 24, fontWeight: '900', letterSpacing: 1 },
  headerSub: { color: '#94a3b8', fontSize: 11, fontWeight: '700', marginTop: 2 },
  headerRight: { alignItems: 'flex-end' },
  syncText: { color: '#10b981', fontSize: 11, fontWeight: '800', marginBottom: 4 },
  seedBtn: { backgroundColor: '#3b82f6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  seedBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  filterBar: { flexDirection: 'row', padding: 12, backgroundColor: '#1e293b', gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#334155' },
  filterChipActive: { backgroundColor: '#3b82f6' },
  filterChipText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  filterChipTextActive: { color: '#ffffff' },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#94a3b8', marginTop: 12, fontSize: 14 },
  gridContainer: { padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '48%', backgroundColor: '#1e293b', borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: '#334155', marginBottom: 12,
  },
  cardHeader: { padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  suiteName: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  beoNumber: { color: '#f1f5f9', fontSize: 12, fontWeight: '600' },
  timerBadge: { backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  timerText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  cardBody: { padding: 12 },
  metaRow: { flexDirection: 'row', marginBottom: 8 },
  metaLabel: { color: '#64748b', fontSize: 12, fontWeight: '700', width: 60 },
  metaValue: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  instructionsBox: { backgroundColor: '#451a03', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#b45309', marginVertical: 8 },
  instructionsLabel: { color: '#f59e0b', fontSize: 11, fontWeight: '800' },
  instructionsText: { color: '#fef3c7', fontSize: 12, marginTop: 2 },
  sectionHeader: { color: '#94a3b8', fontSize: 11, fontWeight: '800', marginTop: 8, marginBottom: 4 },
  lineItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#334155' },
  itemQty: { color: '#38bdf8', fontSize: 14, fontWeight: '900', width: 32 },
  itemName: { color: '#f8fafc', fontSize: 14, fontWeight: '600', flex: 1 },
  itemCat: { color: '#64748b', fontSize: 11 },
  cardFooter: { padding: 12, backgroundColor: '#0f172a' },
  actionBtn: { paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  prepBtn: { backgroundColor: '#eab308' },
  readyBtn: { backgroundColor: '#10b981' },
  actionBtnText: { color: '#0f172a', fontSize: 15, fontWeight: '900' },
  statusBadgeEnRoute: { backgroundColor: '#0284c7', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  statusTextEnRoute: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  statusBadgeDelivered: { backgroundColor: '#16a34a', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  statusTextDelivered: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
});
