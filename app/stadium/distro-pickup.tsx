import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, useApiQuery } from '../../lib/api-client';
import { asArray } from '../../lib/format';
import { useStadiumLiveStream } from '../../lib/stadium-live-stream';
import { DistroStatusBadge, KitchenTicketStatusType } from '../../components/stadium/DistroStatusBadge';

export interface DistroTicket {
  id: string;
  organizationId: string;
  facilityId: string;
  eventId?: string;
  beoId?: string;
  zoneId?: string;
  serviceAreaId?: string;
  serviceAreaName: string;
  kitchenId: string;
  kitchenName: string;
  distroLocationId?: string;
  distroLocationName?: string;
  status: KitchenTicketStatusType;
  priority: 'normal' | 'high' | 'urgent';
  itemName: string;
  itemDescription?: string;
  quantity: number;
  unitOfMeasure?: string;
  notes?: string;
  requestedAt: string;
  firedAt?: string;
  readyAt?: string;
  pickedUpAt?: string;
  cancelledAt?: string;
  pickedUpByName?: string;
  overdueAt?: string;
  wasOverdue: boolean;
  cancelReason?: string;
  elapsedReadySeconds?: number;
  overdueSeconds?: number;
  isOverdue?: boolean;
  history?: Array<{
    id: string;
    fromStatus?: KitchenTicketStatusType;
    toStatus: KitchenTicketStatusType;
    actorName?: string;
    reason?: string;
    notes?: string;
    timestamp: string;
  }>;
}

const DISTRO_TICKETS_KEY = ['stadium', 'distro-tickets'];

/**
 * Operational areas a ticket can be raised against. Must stay a subset of the
 * server's OperationalAreaType enum; the API rejects anything the caller's
 * department does not cover, so this list is a convenience, not a permission.
 */
const OPERATIONAL_AREA_OPTIONS = [
  { value: 'suite', label: 'Suite' },
  { value: 'club', label: 'Club' },
  { value: 'catering', label: 'Catering' },
  { value: 'concession', label: 'Concession' },
  { value: 'culinary', label: 'Culinary' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'distro', label: 'Distro' },
] as const;

type OperationalAreaTypeOption = (typeof OPERATIONAL_AREA_OPTIONS)[number]['value'];

export default function DistroPickupConsoleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Mode: 'kitchen' (Prep & Bump) or 'runner' (Distro & Service Pickup)
  const [activeTab, setActiveTab] = useState<'kitchen' | 'runner'>('runner');
  const [filterStatus, setFilterStatus] = useState<string>('active');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [selectedTicket, setSelectedTicket] = useState<DistroTicket | null>(null);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [rewindModalVisible, setRewindModalVisible] = useState(false);
  const [rewindReason, setRewindReason] = useState('');
  const [pickupModalVisible, setPickupModalVisible] = useState(false);
  const [runnerName, setRunnerName] = useState('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newTicketData, setNewTicketData] = useState({
    serviceAreaName: '',
    // Routes the ticket to the owning department. The server treats this as a
    // declaration to validate, never as a grant — you can only pick an area
    // your department already covers.
    operationalAreaType: '' as OperationalAreaTypeOption | '',
    kitchenName: 'Main Commissary Kitchen',
    kitchenId: 'kitchen-main',
    distroLocationName: 'Distro Bay North',
    itemName: '',
    quantity: '1',
    notes: '',
  });

  const query = useApiQuery<DistroTicket[]>(
    DISTRO_TICKETS_KEY,
    '/v1/stadium/distro-tickets',
    true,
    10000,
  );

  useStadiumLiveStream({
    events: ['distro_pickup_updated', 'distro_pickup_ready', 'distro_pickup_overdue'],
    invalidate: [DISTRO_TICKETS_KEY],
  });

  const tickets = asArray<DistroTicket>(query.data);
  const loading = query.isLoading;
  const lastSynced = query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toLocaleTimeString() : '';
  const refresh = () => void queryClient.invalidateQueries({ queryKey: DISTRO_TICKETS_KEY });

  // Metrics computation
  const activeTickets = tickets.filter(
    (t: DistroTicket) => t.status === 'waiting' || t.status === 'firing' || t.status === 'ready' || t.status === 'overdue_pickup',
  );
  const waitingCount = tickets.filter((t: DistroTicket) => t.status === 'waiting').length;
  const firingCount = tickets.filter((t: DistroTicket) => t.status === 'firing').length;
  const readyCount = tickets.filter((t: DistroTicket) => t.status === 'ready').length;
  const overdueCount = tickets.filter((t: DistroTicket) => t.status === 'overdue_pickup' || t.isOverdue).length;

  // Actions
  const handleFire = async (ticket: DistroTicket) => {
    try {
      await apiRequest(`/v1/stadium/distro-tickets/${ticket.id}/fire`, { method: 'POST' });
      refresh();
    } catch (err) {
      Alert.alert('Action Failed', err instanceof Error ? err.message : 'Could not fire ticket');
    }
  };

  const handleMarkReady = async (ticket: DistroTicket) => {
    try {
      await apiRequest(`/v1/stadium/distro-tickets/${ticket.id}/ready`, {
        method: 'POST',
        body: {
          distroLocationName: ticket.distroLocationName || 'Distro Station A',
        },
      });
      refresh();
    } catch (err) {
      Alert.alert('Action Failed', err instanceof Error ? err.message : 'Could not mark ready');
    }
  };

  const handleOpenRewind = (ticket: DistroTicket) => {
    setSelectedTicket(ticket);
    setRewindReason('');
    setRewindModalVisible(true);
  };

  const submitRewind = async () => {
    if (!selectedTicket) return;
    if (!rewindReason.trim()) {
      Alert.alert('Required', 'Please enter a correction reason (e.g., Re-plate, temp check, garnish).');
      return;
    }
    try {
      await apiRequest(`/v1/stadium/distro-tickets/${selectedTicket.id}/rewind-fire`, {
        method: 'POST',
        body: { reason: rewindReason.trim() },
      });
      setRewindModalVisible(false);
      refresh();
    } catch (err) {
      Alert.alert('Rewind Failed', err instanceof Error ? err.message : 'Could not rewind ticket');
    }
  };

  const handleOpenPickup = (ticket: DistroTicket) => {
    setSelectedTicket(ticket);
    setRunnerName('');
    setPickupModalVisible(true);
  };

  const submitPickup = async () => {
    if (!selectedTicket) return;
    try {
      await apiRequest(`/v1/stadium/distro-tickets/${selectedTicket.id}/pickup`, {
        method: 'POST',
        body: { runnerName: runnerName.trim() || undefined },
      });
      setPickupModalVisible(false);
      refresh();
    } catch (err) {
      Alert.alert('Pickup Failed', err instanceof Error ? err.message : 'Could not mark picked up');
    }
  };

  const handleOpenHistory = (ticket: DistroTicket) => {
    setSelectedTicket(ticket);
    setHistoryModalVisible(true);
  };

  const submitCreateTicket = async () => {
    if (!newTicketData.serviceAreaName.trim() || !newTicketData.itemName.trim()) {
      Alert.alert('Required Fields', 'Please specify Service Area and Item Name.');
      return;
    }
    if (!newTicketData.operationalAreaType) {
      Alert.alert('Operational Area Required', 'Select the operational area this ticket belongs to.');
      return;
    }
    try {
      await apiRequest('/v1/stadium/distro-tickets', {
        method: 'POST',
        body: {
          serviceAreaName: newTicketData.serviceAreaName.trim(),
          operationalAreaType: newTicketData.operationalAreaType,
          kitchenName: newTicketData.kitchenName.trim(),
          kitchenId: newTicketData.kitchenId.trim(),
          distroLocationName: newTicketData.distroLocationName.trim(),
          itemName: newTicketData.itemName.trim(),
          quantity: parseInt(newTicketData.quantity, 10) || 1,
          notes: newTicketData.notes.trim() || undefined,
        },
      });
      setCreateModalVisible(false);
      setNewTicketData({
        serviceAreaName: '',
        operationalAreaType: '',
        kitchenName: 'Main Commissary Kitchen',
        kitchenId: 'kitchen-main',
        distroLocationName: 'Distro Bay North',
        itemName: '',
        quantity: '1',
        notes: '',
      });
      refresh();
    } catch (err) {
      Alert.alert('Creation Failed', err instanceof Error ? err.message : 'Could not create ticket');
    }
  };

  // Filter tickets
  const filteredTickets = tickets.filter((t: DistroTicket) => {
    // Mode-specific defaults
    if (activeTab === 'kitchen') {
      if (filterStatus === 'active' && !['waiting', 'firing', 'ready', 'overdue_pickup'].includes(t.status)) return false;
      if (filterStatus === 'firing' && t.status !== 'firing') return false;
      if (filterStatus === 'waiting' && t.status !== 'waiting') return false;
      if (filterStatus === 'ready' && t.status !== 'ready' && t.status !== 'overdue_pickup') return false;
    } else {
      // Runner mode focuses on pickup queue
      if (filterStatus === 'active' && !['ready', 'overdue_pickup'].includes(t.status)) return false;
      if (filterStatus === 'ready' && t.status !== 'ready') return false;
      if (filterStatus === 'overdue' && t.status !== 'overdue_pickup' && !t.isOverdue) return false;
      if (filterStatus === 'picked_up' && t.status !== 'picked_up') return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        t.itemName.toLowerCase().includes(q) ||
        t.serviceAreaName.toLowerCase().includes(q) ||
        t.kitchenName.toLowerCase().includes(q) ||
        (t.distroLocationName && t.distroLocationName.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialCommunityIcons name="arrow-left" size={20} color="#CBD5E1" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.headerTitle}>Kitchen → Distro Pickup Console</Text>
            <Text style={styles.headerSubtitle}>
              Multi-Kitchen Stadium Staging & Service Area Notifications
            </Text>
          </View>
          <TouchableOpacity style={styles.createBtn} onPress={() => setCreateModalVisible(true)}>
            <MaterialCommunityIcons name="plus" size={16} color="#FFFFFF" />
            <Text style={styles.createBtnText}>New Ticket</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.refreshBtn} onPress={refresh}>
            <MaterialCommunityIcons name="refresh" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* Tab Switcher: Kitchen vs Runner */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'runner' && styles.tabBtnActive]}
            onPress={() => {
              setActiveTab('runner');
              setFilterStatus('active');
            }}
          >
            <MaterialCommunityIcons
              name="package-variant-closed-check"
              size={16}
              color={activeTab === 'runner' ? '#FFFFFF' : '#94A3B8'}
            />
            <Text style={[styles.tabBtnText, activeTab === 'runner' && styles.tabBtnTextActive]}>
              Distro Pickup Queue ({readyCount + overdueCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'kitchen' && styles.tabBtnActive]}
            onPress={() => {
              setActiveTab('kitchen');
              setFilterStatus('active');
            }}
          >
            <MaterialCommunityIcons
              name="chef-hat"
              size={16}
              color={activeTab === 'kitchen' ? '#FFFFFF' : '#94A3B8'}
            />
            <Text style={[styles.tabBtnText, activeTab === 'kitchen' && styles.tabBtnTextActive]}>
              Kitchen Production ({waitingCount + firingCount})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Metrics KPI Bar */}
        <View style={styles.kpiBar}>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>Queued</Text>
            <Text style={[styles.kpiValue, { color: '#FACC15' }]}>{waitingCount}</Text>
          </View>
          <View style={styles.kpiDivider} />
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>Firing</Text>
            <Text style={[styles.kpiValue, { color: '#FB923C' }]}>{firingCount}</Text>
          </View>
          <View style={styles.kpiDivider} />
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>Ready at Distro</Text>
            <Text style={[styles.kpiValue, { color: '#10B981' }]}>{readyCount}</Text>
          </View>
          <View style={styles.kpiDivider} />
          <View style={[styles.kpiItem, overdueCount > 0 && styles.kpiOverdueHighlight]}>
            <Text style={[styles.kpiLabel, overdueCount > 0 && { color: '#FCA5A5' }]}>
              Overdue (&gt;10m)
            </Text>
            <Text style={[styles.kpiValue, { color: overdueCount > 0 ? '#EF4444' : '#64748B' }]}>
              {overdueCount}
            </Text>
          </View>
        </View>

        {/* Search & Filter Bar */}
        <View style={styles.filterRow}>
          <View style={styles.searchWrap}>
            <MaterialCommunityIcons name="magnify" size={16} color="#64748B" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search items, suites, kitchens, distro..."
              placeholderTextColor="#64748B"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <MaterialCommunityIcons name="close-circle" size={14} color="#64748B" />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterPills}>
            <TouchableOpacity
              style={[styles.filterPill, filterStatus === 'active' && styles.filterPillActive]}
              onPress={() => setFilterStatus('active')}
            >
              <Text style={[styles.filterPillText, filterStatus === 'active' && styles.filterPillTextActive]}>
                Active
              </Text>
            </TouchableOpacity>

            {activeTab === 'kitchen' ? (
              <>
                <TouchableOpacity
                  style={[styles.filterPill, filterStatus === 'waiting' && styles.filterPillActive]}
                  onPress={() => setFilterStatus('waiting')}
                >
                  <Text style={[styles.filterPillText, filterStatus === 'waiting' && styles.filterPillTextActive]}>
                    Queued ({waitingCount})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterPill, filterStatus === 'firing' && styles.filterPillActive]}
                  onPress={() => setFilterStatus('firing')}
                >
                  <Text style={[styles.filterPillText, filterStatus === 'firing' && styles.filterPillTextActive]}>
                    Firing ({firingCount})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterPill, filterStatus === 'ready' && styles.filterPillActive]}
                  onPress={() => setFilterStatus('ready')}
                >
                  <Text style={[styles.filterPillText, filterStatus === 'ready' && styles.filterPillTextActive]}>
                    At Distro ({readyCount})
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.filterPill, filterStatus === 'ready' && styles.filterPillActive]}
                  onPress={() => setFilterStatus('ready')}
                >
                  <Text style={[styles.filterPillText, filterStatus === 'ready' && styles.filterPillTextActive]}>
                    Ready ({readyCount})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterPill, filterStatus === 'overdue' && styles.filterPillActive]}
                  onPress={() => setFilterStatus('overdue')}
                >
                  <Text style={[styles.filterPillText, filterStatus === 'overdue' && styles.filterPillTextActive]}>
                    Overdue ({overdueCount})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterPill, filterStatus === 'picked_up' && styles.filterPillActive]}
                  onPress={() => setFilterStatus('picked_up')}
                >
                  <Text style={[styles.filterPillText, filterStatus === 'picked_up' && styles.filterPillTextActive]}>
                    Picked Up
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              style={[styles.filterPill, filterStatus === 'all' && styles.filterPillActive]}
              onPress={() => setFilterStatus('all')}
            >
              <Text style={[styles.filterPillText, filterStatus === 'all' && styles.filterPillTextActive]}>
                All
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>

      {/* Main Ticket Cards List */}
      <ScrollView contentContainerStyle={styles.listContainer}>
        {loading && (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color="#10B981" />
            <Text style={styles.loadingText}>Connecting to Stadium Live Distro Stream...</Text>
          </View>
        )}

        {!loading && filteredTickets.length === 0 && (
          <View style={styles.centerBox}>
            <MaterialCommunityIcons name="check-decagram-outline" size={48} color="#475569" />
            <Text style={styles.emptyTitle}>Queue Clear</Text>
            <Text style={styles.emptySubtitle}>
              {activeTab === 'runner'
                ? 'No items waiting for pickup at Distro station.'
                : 'No kitchen production items matching the selected filters.'}
            </Text>
          </View>
        )}

        {filteredTickets.map((ticket: DistroTicket) => {
          const isOverdue = ticket.status === 'overdue_pickup' || ticket.isOverdue;
          return (
            <View
              key={ticket.id}
              style={[
                styles.card,
                isOverdue && styles.cardOverdue,
                ticket.status === 'ready' && !isOverdue && styles.cardReady,
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <Text style={styles.cardItemTitle}>
                    {ticket.quantity}x {ticket.itemName}
                  </Text>
                  <Text style={styles.cardDest}>
                    <MaterialCommunityIcons name="map-marker" size={13} color="#94A3B8" />{' '}
                    {ticket.serviceAreaName}
                  </Text>
                </View>
                <DistroStatusBadge
                  status={ticket.status}
                  readyAt={ticket.readyAt}
                  pickedUpAt={ticket.pickedUpAt}
                  wasOverdue={ticket.wasOverdue}
                  size="md"
                />
              </View>

              {ticket.itemDescription ? (
                <Text style={styles.cardDesc}>{ticket.itemDescription}</Text>
              ) : null}

              {ticket.notes ? (
                <View style={styles.notesBox}>
                  <Text style={styles.notesText}>Note: {ticket.notes}</Text>
                </View>
              ) : null}

              <View style={styles.metaRow}>
                <Text style={styles.metaText}>
                  <MaterialCommunityIcons name="chef-hat" size={12} color="#64748B" />{' '}
                  {ticket.kitchenName}
                </Text>
                <Text style={styles.metaText}>
                  <MaterialCommunityIcons name="store-marker-outline" size={12} color="#64748B" />{' '}
                  {ticket.distroLocationName || 'Staging Bay A'}
                </Text>
                {ticket.pickedUpByName && (
                  <Text style={styles.metaText}>
                    <MaterialCommunityIcons name="account-check" size={12} color="#10B981" /> Runner:{' '}
                    {ticket.pickedUpByName}
                  </Text>
                )}
              </View>

              {/* Action Bar */}
              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.historyBtn}
                  onPress={() => handleOpenHistory(ticket)}
                >
                  <MaterialCommunityIcons name="history" size={14} color="#94A3B8" />
                  <Text style={styles.historyBtnText}>Audit Trail</Text>
                </TouchableOpacity>

                <View style={styles.actionGroup}>
                  {activeTab === 'kitchen' ? (
                    <>
                      {ticket.status === 'waiting' && (
                        <TouchableOpacity
                          style={[styles.btnAction, { backgroundColor: '#EA580C' }]}
                          onPress={() => handleFire(ticket)}
                        >
                          <MaterialCommunityIcons name="fire" size={16} color="#FFFFFF" />
                          <Text style={styles.btnActionText}>Fire Item</Text>
                        </TouchableOpacity>
                      )}

                      {ticket.status === 'firing' && (
                        <TouchableOpacity
                          style={[styles.btnAction, { backgroundColor: '#10B981' }]}
                          onPress={() => handleMarkReady(ticket)}
                        >
                          <MaterialCommunityIcons name="check" size={16} color="#FFFFFF" />
                          <Text style={styles.btnActionText}>Mark Ready at Distro</Text>
                        </TouchableOpacity>
                      )}

                      {(ticket.status === 'ready' || ticket.status === 'overdue_pickup') && (
                        <TouchableOpacity
                          style={[styles.btnAction, { backgroundColor: '#475569' }]}
                          onPress={() => handleOpenRewind(ticket)}
                        >
                          <MaterialCommunityIcons name="undo-variant" size={16} color="#FFFFFF" />
                          <Text style={styles.btnActionText}>Rewind to Firing</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  ) : (
                    <>
                      {(ticket.status === 'ready' || ticket.status === 'overdue_pickup') && (
                        <TouchableOpacity
                          style={[
                            styles.btnAction,
                            { backgroundColor: isOverdue ? '#DC2626' : '#10B981' },
                          ]}
                          onPress={() => handleOpenPickup(ticket)}
                        >
                          <MaterialCommunityIcons
                            name="package-variant-closed-check"
                            size={16}
                            color="#FFFFFF"
                          />
                          <Text style={styles.btnActionText}>Confirm Pickup</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Footer Info */}
      <View style={styles.footerBar}>
        <View style={styles.footerLiveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.footerLiveText}>SSE Live Stream Active</Text>
        </View>
        <Text style={styles.footerSyncText}>Last synced: {lastSynced || 'just now'}</Text>
      </View>

      {/* Modal: Rewind Item to Firing */}
      <Modal visible={rewindModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Rewind Item to Firing</Text>
              <TouchableOpacity onPress={() => setRewindModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={20} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHelp}>
              Moving this item from Distro staging back to Firing will reset the pickup timer and
              notify the service area. An audit reason is mandatory.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Needs re-temping, sauce adjustment, plate garnish correction"
              placeholderTextColor="#64748B"
              value={rewindReason}
              onChangeText={setRewindReason}
              multiline
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setRewindModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={submitRewind}>
                <Text style={styles.modalConfirmText}>Rewind to Firing</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Confirm Pickup */}
      <Modal visible={pickupModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm Distro Pickup</Text>
              <TouchableOpacity onPress={() => setPickupModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={20} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHelp}>
              Confirm that {selectedTicket?.quantity}x {selectedTicket?.itemName} for{' '}
              {selectedTicket?.serviceAreaName} has been picked up from Distro.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Runner name or Badge ID (Optional)"
              placeholderTextColor="#64748B"
              value={runnerName}
              onChangeText={setRunnerName}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setPickupModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, { backgroundColor: '#10B981' }]}
                onPress={submitPickup}
              >
                <Text style={styles.modalConfirmText}>Mark Picked Up</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Audit Trail */}
      <Modal visible={historyModalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Audit Trail: {selectedTicket?.itemName}
              </Text>
              <TouchableOpacity onPress={() => setHistoryModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={20} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ marginTop: 8 }}>
              {selectedTicket?.history && selectedTicket.history.length > 0 ? (
                selectedTicket.history.map((h) => (
                  <View key={h.id} style={styles.historyRow}>
                    <View style={styles.historyDot} />
                    <View style={{ flex: 1 }}>
                      <View style={styles.historyHeader}>
                        <Text style={styles.historyStatus}>
                          {h.fromStatus ? `${h.fromStatus} → ` : ''}
                          {h.toStatus}
                        </Text>
                        <Text style={styles.historyTime}>
                          {new Date(h.timestamp).toLocaleTimeString()}
                        </Text>
                      </View>
                      {h.reason ? <Text style={styles.historyReason}>{h.reason}</Text> : null}
                      {h.actorName ? (
                        <Text style={styles.historyActor}>By: {h.actorName}</Text>
                      ) : null}
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.emptySubtitle}>No status logs recorded.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal: Create Ad-hoc Ticket */}
      <Modal visible={createModalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Distro Ticket</Text>
              <TouchableOpacity onPress={() => setCreateModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={20} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Service Area / Suite / Stand</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Suite 204 or Concourse Grill 108"
              placeholderTextColor="#64748B"
              value={newTicketData.serviceAreaName}
              onChangeText={(t) => setNewTicketData({ ...newTicketData, serviceAreaName: t })}
            />
            <Text style={styles.fieldLabel}>Operational Area</Text>
            <View style={styles.areaChipRow}>
              {OPERATIONAL_AREA_OPTIONS.map((opt) => {
                const selected = newTicketData.operationalAreaType === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.areaChip, selected && styles.areaChipSelected]}
                    onPress={() => setNewTicketData({ ...newTicketData, operationalAreaType: opt.value })}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Operational area ${opt.label}`}
                  >
                    <Text style={[styles.areaChipText, selected && styles.areaChipTextSelected]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.fieldLabel}>Item Name</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Wagyu Sliders Platter"
              placeholderTextColor="#64748B"
              value={newTicketData.itemName}
              onChangeText={(t) => setNewTicketData({ ...newTicketData, itemName: t })}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Quantity</Text>
                <TextInput
                  style={styles.modalInput}
                  keyboardType="numeric"
                  value={newTicketData.quantity}
                  onChangeText={(t) => setNewTicketData({ ...newTicketData, quantity: t })}
                />
              </View>
              <View style={{ flex: 2 }}>
                <Text style={styles.fieldLabel}>Distro Staging Area</Text>
                <TextInput
                  style={styles.modalInput}
                  value={newTicketData.distroLocationName}
                  onChangeText={(t) => setNewTicketData({ ...newTicketData, distroLocationName: t })}
                />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Special Notes</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Gluten free, extra hot, etc."
              placeholderTextColor="#64748B"
              value={newTicketData.notes}
              onChangeText={(t) => setNewTicketData({ ...newTicketData, notes: t })}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setCreateModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, { backgroundColor: '#10B981' }]}
                onPress={submitCreateTicket}
              >
                <Text style={styles.modalConfirmText}>Create Ticket</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingTop: 12,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#334155',
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0284C7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 8,
  },
  createBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 4,
  },
  refreshBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#334155',
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    backgroundColor: '#162032',
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    gap: 6,
  },
  tabBtnActive: {
    borderBottomColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  tabBtnText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  kpiBar: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    alignItems: 'center',
  },
  kpiItem: {
    flex: 1,
    alignItems: 'center',
  },
  kpiDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#334155',
  },
  kpiLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  kpiValue: {
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  kpiOverdueHighlight: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: 4,
    paddingVertical: 2,
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  searchInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 12,
    marginLeft: 6,
    padding: 0,
  },
  filterPills: {
    flexDirection: 'row',
    marginTop: 8,
  },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#334155',
    marginRight: 6,
  },
  filterPillActive: {
    backgroundColor: '#10B981',
  },
  filterPillText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  listContainer: {
    padding: 12,
    paddingBottom: 40,
  },
  centerBox: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 12,
  },
  emptyTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
  emptySubtitle: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
    marginBottom: 10,
  },
  cardReady: {
    borderColor: '#10B981',
    backgroundColor: '#142728',
  },
  cardOverdue: {
    borderColor: '#EF4444',
    borderWidth: 2,
    backgroundColor: '#2A1519',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardHeaderLeft: {
    flex: 1,
    marginRight: 8,
  },
  cardItemTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
  },
  cardDest: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  cardDesc: {
    color: '#CBD5E1',
    fontSize: 12,
    marginTop: 6,
  },
  notesBox: {
    backgroundColor: '#0F172A',
    borderRadius: 4,
    padding: 6,
    marginTop: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  notesText: {
    color: '#FCD34D',
    fontSize: 11,
    fontStyle: 'italic',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  metaText: {
    color: '#94A3B8',
    fontSize: 11,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  historyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
  },
  historyBtnText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  actionGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  btnAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
  },
  btnActionText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  footerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  footerLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  footerLiveText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '700',
  },
  footerSyncText: {
    color: '#64748B',
    fontSize: 11,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#475569',
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
  },
  modalHelp: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 12,
    lineHeight: 16,
  },
  fieldLabel: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  modalInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 6,
    color: '#F8FAFC',
    padding: 10,
    fontSize: 13,
  },
  areaChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  areaChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
  },
  areaChipSelected: {
    borderColor: '#0EA5E9',
    backgroundColor: '#0C4A6E',
  },
  areaChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  areaChipTextSelected: {
    color: '#E0F2FE',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#334155',
  },
  modalCancelText: {
    color: '#CBD5E1',
    fontWeight: '700',
    fontSize: 12,
  },
  modalConfirmBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#EA580C',
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  historyRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    alignItems: 'flex-start',
  },
  historyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#38BDF8',
    marginTop: 5,
    marginRight: 10,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyStatus: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  historyTime: {
    color: '#64748B',
    fontSize: 11,
  },
  historyReason: {
    color: '#CBD5E1',
    fontSize: 12,
    marginTop: 2,
  },
  historyActor: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 2,
  },
});
