import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Share,
} from 'react-native';
import { Text, Button, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';
import { useAuthStore } from '../../lib/auth-store';
import { useAppearanceStore, designPalettes } from '../../lib/theme';
import { DepartmentSwitcher } from '../../components/DepartmentSwitcher';

interface DailyRosterSummary {
  id: string;
  operationalDate: string;
  name: string;
  rosterType: string;
  staffingSource: string;
  departmentId: string;
  status: 'draft' | 'submitted' | 'approved' | 'closed';
  version: number;
  notes?: string;
  department: { id: string; code: string; name: string };
  agency?: { id: string; code: string; name: string };
  _count: { workers: number };
}

interface RosterWorker {
  id: string;
  workerName: string;
  workerRole: string;
  assignedOutletId?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  checkedInAt?: string;
  checkedOutAt?: string;
  hoursWorked: number;
  breakMinutes: number;
  hourlyRateCents: number;
  attendanceStatus: string;
  notes?: string;
}

interface RosterDetails extends DailyRosterSummary {
  workers: RosterWorker[];
  history: Array<{
    id: string;
    version: number;
    changeType: string;
    summary: string;
    timestamp: string;
  }>;
}

export default function DailyTemporaryRosterScreen() {
  const queryClient = useQueryClient();
  const themeMode = useAppearanceStore((s) => s.mode);
  const palette = designPalettes[themeMode];
  const user = useAuthStore((s) => s.user);
  const venue = useAuthStore((s) => s.venue);

  // Default to today in local/venue date string
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedRosterId, setSelectedRosterId] = useState<string | null>(null);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [addWorkerModalOpen, setAddWorkerModalOpen] = useState(false);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);

  // Form states
  const [newRosterName, setNewRosterName] = useState('');
  const [newRosterSource, setNewRosterSource] = useState('');
  const [newRosterDeptId, setNewRosterDeptId] = useState('');
  const [newRosterType, setNewRosterType] = useState<'temporary' | 'npo'>('temporary');

  const [workerName, setWorkerName] = useState('');
  const [workerRole, setWorkerRole] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  // 1. Fetch departments for the venue
  const { data: departments } = useQuery({
    queryKey: ['departments', venue?.id],
    queryFn: () => apiRequest<Array<{ id: string; code: string; name: string }>>('/v1/departments'),
    enabled: Boolean(venue?.id),
  });

  // 2. Fetch rosters for the selected date
  const { data: rosters, isLoading: rostersLoading } = useQuery<DailyRosterSummary[]>({
    queryKey: ['daily-rosters', venue?.id, selectedDate],
    queryFn: () => apiRequest<DailyRosterSummary[]>(`/v1/stadium/daily-rosters?operationalDate=${selectedDate}`),
    enabled: Boolean(venue?.id),
  });

  // Auto-select first roster if none selected
  const activeRosterId = selectedRosterId ?? rosters?.[0]?.id ?? null;

  // 3. Fetch detailed roster with workers
  const { data: activeRoster, isLoading: rosterLoading } = useQuery<RosterDetails>({
    queryKey: ['daily-roster-detail', venue?.id, activeRosterId],
    queryFn: () => apiRequest<RosterDetails>(`/v1/stadium/daily-rosters/${activeRosterId}`),
    enabled: Boolean(venue?.id && activeRosterId),
  });

  // Mutations
  const createRosterMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest('/v1/stadium/daily-rosters', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (newRoster: any) => {
      void queryClient.invalidateQueries({ queryKey: ['daily-rosters'] });
      setSelectedRosterId(newRoster.id);
      setCreateModalOpen(false);
      setNewRosterName('');
      setNewRosterSource('');
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to create roster'),
  });

  const addWorkerMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest(`/v1/stadium/daily-rosters/${activeRosterId}/workers`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['daily-roster-detail', venue?.id, activeRosterId] });
      void queryClient.invalidateQueries({ queryKey: ['daily-rosters'] });
      setAddWorkerModalOpen(false);
      setWorkerName('');
      setWorkerRole('');
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to add worker'),
  });

  const updateWorkerAttendanceMutation = useMutation({
    mutationFn: ({ workerId, status }: { workerId: string; status: string }) => {
      const now = new Date().toISOString();
      const body: any = { attendanceStatus: status };
      if (status === 'checked_in') body.checkedInAt = now;
      if (status === 'checked_out') body.checkedOutAt = now;

      return apiRequest(`/v1/stadium/daily-rosters/${activeRosterId}/workers/${workerId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['daily-roster-detail', venue?.id, activeRosterId] });
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to update attendance'),
  });

  const submitRosterMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/stadium/daily-rosters/${activeRosterId}/submit`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['daily-roster-detail', venue?.id, activeRosterId] });
      void queryClient.invalidateQueries({ queryKey: ['daily-rosters'] });
    },
  });

  const approveRosterMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/stadium/daily-rosters/${activeRosterId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['daily-roster-detail', venue?.id, activeRosterId] });
      void queryClient.invalidateQueries({ queryKey: ['daily-rosters'] });
    },
  });

  const closeRosterMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/stadium/daily-rosters/${activeRosterId}/close`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['daily-roster-detail', venue?.id, activeRosterId] });
      void queryClient.invalidateQueries({ queryKey: ['daily-rosters'] });
    },
  });

  const adjustRosterMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest(`/v1/stadium/daily-rosters/${activeRosterId}/adjust`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['daily-roster-detail', venue?.id, activeRosterId] });
      void queryClient.invalidateQueries({ queryKey: ['daily-rosters'] });
      setAdjustModalOpen(false);
      setAdjustReason('');
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to apply adjustment'),
  });

  const handleExportCsv = async () => {
    if (!activeRosterId) return;
    try {
      const csv = await apiRequest<string>(`/v1/stadium/daily-rosters/${activeRosterId}/export`);
      await Share.share({
        message: csv,
        title: `Roster_${activeRoster?.name}_${selectedDate}.csv`,
      });
    } catch {
      Alert.alert('Export', 'CSV copied or exported');
    }
  };

  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';
  const isLocked = activeRoster?.status === 'approved' || activeRoster?.status === 'closed';

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Top Header */}
      <View style={[styles.header, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.headerTitleRow}>
          <View>
            <Text variant="headlineSmall" style={{ fontWeight: '800', color: palette.charcoal }}>
              Daily Staffing Rosters
            </Text>
            <Text variant="bodySmall" style={{ color: palette.muted }}>
              Operational temporary & NPO workforce allocations
            </Text>
          </View>
          <DepartmentSwitcher />
        </View>

        {/* Date Selector & Fresh Workspace Indicator */}
        <View style={styles.dateRow}>
          <View style={styles.dateSelector}>
            <MaterialCommunityIcons name="calendar" size={18} color={palette.primary} />
            <Text variant="titleSmall" style={{ color: palette.charcoal, marginHorizontal: 8, fontWeight: '700' }}>
              {selectedDate === todayStr ? `Today (${selectedDate})` : selectedDate}
            </Text>
            {selectedDate !== todayStr && (
              <TouchableOpacity
                onPress={() => setSelectedDate(todayStr)}
                style={[styles.todayButton, { backgroundColor: palette.primary }]}
              >
                <Text style={{ color: palette.buttonText, fontSize: 11, fontWeight: '700' }}>Back to Today</Text>
              </TouchableOpacity>
            )}
          </View>

          {isManager && (
            <Button
              mode="contained"
              icon="plus"
              onPress={() => setCreateModalOpen(true)}
              style={{ backgroundColor: palette.primary, borderRadius: 8 }}
              labelStyle={{ color: palette.buttonText, fontWeight: '700' }}
            >
              New Daily Roster
            </Button>
          )}
        </View>

        {/* Same-Day Roster Source Tabs */}
        {rosters && rosters.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rosterTabs}>
            {rosters.map((r) => {
              const isSelected = r.id === activeRosterId;
              return (
                <TouchableOpacity
                  key={r.id}
                  onPress={() => setSelectedRosterId(r.id)}
                  style={[
                    styles.rosterTab,
                    {
                      backgroundColor: isSelected ? `${palette.primary}20` : palette.background,
                      borderColor: isSelected ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text variant="bodyMedium" style={{ fontWeight: '700', color: palette.charcoal }}>
                      {r.name}
                    </Text>
                    <Chip
                      compact
                      style={[
                        styles.statusChip,
                        {
                          backgroundColor:
                            r.status === 'closed'
                              ? '#9333ea20'
                              : r.status === 'approved'
                              ? '#22c55e20'
                              : r.status === 'submitted'
                              ? '#3b82f620'
                              : '#eab30820',
                        },
                      ]}
                      textStyle={{
                        fontSize: 10,
                        fontWeight: '700',
                        color:
                          r.status === 'closed'
                            ? '#9333ea'
                            : r.status === 'approved'
                            ? '#22c55e'
                            : r.status === 'submitted'
                            ? '#3b82f6'
                            : '#eab308',
                      }}
                    >
                      {r.status.toUpperCase()} (v{r.version})
                    </Chip>
                  </View>
                  <Text variant="labelSmall" style={{ color: palette.muted, marginTop: 2 }}>
                    {r.staffingSource} • {r.department.name} • {r._count.workers} workers
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* Main Content Area */}
      <ScrollView contentContainerStyle={styles.content}>
        {rostersLoading || rosterLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={palette.primary} />
          </View>
        ) : !activeRoster ? (
          <View style={[styles.emptyCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <MaterialCommunityIcons name="account-group-outline" size={48} color={palette.muted} />
            <Text variant="titleMedium" style={{ color: palette.charcoal, marginTop: 12, fontWeight: '700' }}>
              No Rosters Created For {selectedDate}
            </Text>
            <Text variant="bodySmall" style={{ color: palette.muted, textAlign: 'center', marginTop: 4 }}>
              Start the operational day fresh by creating a daily staffing roster from your agency or NPO partner.
            </Text>
            {isManager && (
              <Button
                mode="contained"
                icon="plus"
                onPress={() => setCreateModalOpen(true)}
                style={{ backgroundColor: palette.primary, marginTop: 16, borderRadius: 8 }}
                labelStyle={{ color: palette.buttonText }}
              >
                Create Daily Roster
              </Button>
            )}
          </View>
        ) : (
          <View>
            {/* Roster Overview Bar */}
            <View style={[styles.overviewCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.overviewTop}>
                <View>
                  <Text variant="titleLarge" style={{ fontWeight: '800', color: palette.charcoal }}>
                    {activeRoster.name}
                  </Text>
                  <Text variant="bodySmall" style={{ color: palette.muted }}>
                    Source: {activeRoster.staffingSource} • Department: {activeRoster.department.name} • Version {activeRoster.version}
                  </Text>
                </View>

                {/* Status and Action Buttons */}
                <View style={styles.actionButtons}>
                  <Button
                    mode="outlined"
                    icon="file-download-outline"
                    onPress={handleExportCsv}
                    style={{ marginRight: 8, borderColor: palette.border }}
                    labelStyle={{ color: palette.charcoal }}
                  >
                    Export CSV
                  </Button>

                  {isManager && activeRoster.status === 'draft' && (
                    <Button
                      mode="contained"
                      icon="send"
                      onPress={() => submitRosterMutation.mutate()}
                      loading={submitRosterMutation.isPending}
                      style={{ backgroundColor: palette.primary, marginRight: 8 }}
                      labelStyle={{ color: palette.buttonText, fontWeight: '700' }}
                    >
                      Submit
                    </Button>
                  )}

                  {isManager && activeRoster.status === 'submitted' && (
                    <Button
                      mode="contained"
                      icon="check-decagram"
                      onPress={() => approveRosterMutation.mutate()}
                      loading={approveRosterMutation.isPending}
                      style={{ backgroundColor: '#22c55e', marginRight: 8 }}
                      labelStyle={{ color: '#fff', fontWeight: '700' }}
                    >
                      Approve & Lock
                    </Button>
                  )}

                  {isManager && activeRoster.status === 'approved' && (
                    <Button
                      mode="contained"
                      icon="lock"
                      onPress={() => closeRosterMutation.mutate()}
                      loading={closeRosterMutation.isPending}
                      style={{ backgroundColor: '#9333ea', marginRight: 8 }}
                      labelStyle={{ color: '#fff', fontWeight: '700' }}
                    >
                      Close Day
                    </Button>
                  )}

                  {isManager && isLocked && (
                    <Button
                      mode="outlined"
                      icon="history"
                      onPress={() => setAdjustModalOpen(true)}
                      style={{ borderColor: palette.warning }}
                      labelStyle={{ color: palette.warning, fontWeight: '700' }}
                    >
                      Post-Approval Correction
                    </Button>
                  )}
                </View>
              </View>

              {isLocked && (
                <View style={[styles.lockedBanner, { backgroundColor: `${palette.primary}15` }]}>
                  <MaterialCommunityIcons name="lock" size={16} color={palette.primary} />
                  <Text variant="labelSmall" style={{ color: palette.charcoal, marginLeft: 6, fontWeight: '600' }}>
                    Roster is {activeRoster.status}. Direct modifications locked for audit and payroll compliance.
                  </Text>
                </View>
              )}
            </View>

            {/* Workers List Header */}
            <View style={styles.workersHeader}>
              <Text variant="titleMedium" style={{ fontWeight: '700', color: palette.charcoal }}>
                Allocated Workers ({activeRoster.workers.length})
              </Text>
              {!isLocked && isManager && (
                <Button
                  mode="text"
                  icon="account-plus"
                  onPress={() => setAddWorkerModalOpen(true)}
                  labelStyle={{ color: palette.primary, fontWeight: '700' }}
                >
                  Add Worker
                </Button>
              )}
            </View>

            {/* Workers Table */}
            {activeRoster.workers.length === 0 ? (
              <View style={[styles.emptyWorkersCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>
                  No workers allocated to this roster yet.
                </Text>
              </View>
            ) : (
              activeRoster.workers.map((worker) => (
                <View
                  key={worker.id}
                  style={[styles.workerCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
                >
                  <View style={styles.workerInfo}>
                    <Text variant="bodyLarge" style={{ fontWeight: '700', color: palette.charcoal }}>
                      {worker.workerName}
                    </Text>
                    <Text variant="labelMedium" style={{ color: palette.muted }}>
                      {worker.workerRole} {worker.hoursWorked > 0 && `• ${worker.hoursWorked} hrs`}
                    </Text>
                    {worker.hourlyRateCents > 0 && (
                      <Text variant="labelSmall" style={{ color: palette.primary, fontWeight: '700', marginTop: 2 }}>
                        Rate: ${(worker.hourlyRateCents / 100).toFixed(2)}/hr
                      </Text>
                    )}
                  </View>

                  <View style={styles.workerActions}>
                    <Chip
                      compact
                      style={[
                        styles.workerStatusChip,
                        {
                          backgroundColor:
                            worker.attendanceStatus === 'checked_in'
                              ? '#22c55e20'
                              : worker.attendanceStatus === 'checked_out'
                              ? '#3b82f620'
                              : '#6b728020',
                        },
                      ]}
                      textStyle={{
                        fontSize: 11,
                        fontWeight: '700',
                        color:
                          worker.attendanceStatus === 'checked_in'
                            ? '#22c55e'
                            : worker.attendanceStatus === 'checked_out'
                            ? '#3b82f6'
                            : '#6b7280',
                      }}
                    >
                      {worker.attendanceStatus.replace('_', ' ').toUpperCase()}
                    </Chip>

                    {!isLocked && (
                      <View style={{ flexDirection: 'row', marginLeft: 10 }}>
                        {worker.attendanceStatus !== 'checked_in' && (
                          <TouchableOpacity
                            onPress={() =>
                              updateWorkerAttendanceMutation.mutate({
                                workerId: worker.id,
                                status: 'checked_in',
                              })
                            }
                            style={[styles.quickActionButton, { backgroundColor: '#22c55e' }]}
                          >
                            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>In</Text>
                          </TouchableOpacity>
                        )}
                        {worker.attendanceStatus === 'checked_in' && (
                          <TouchableOpacity
                            onPress={() =>
                              updateWorkerAttendanceMutation.mutate({
                                workerId: worker.id,
                                status: 'checked_out',
                              })
                            }
                            style={[styles.quickActionButton, { backgroundColor: '#3b82f6' }]}
                          >
                            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Out</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              ))
            )}

            {/* Versioned History Log */}
            {activeRoster.history.length > 0 && (
              <View style={[styles.historyCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Text variant="titleSmall" style={{ fontWeight: '700', color: palette.charcoal, marginBottom: 8 }}>
                  Post-Approval Audit Ledger
                </Text>
                {activeRoster.history.map((h) => (
                  <View key={h.id} style={styles.historyRow}>
                    <Text variant="labelSmall" style={{ fontWeight: '700', color: palette.primary }}>
                      v{h.version} ({new Date(h.timestamp).toLocaleTimeString()}):
                    </Text>
                    <Text variant="bodySmall" style={{ color: palette.charcoal, marginLeft: 6 }}>
                      {h.summary}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Modal: Create Daily Roster */}
      <Modal visible={createModalOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text variant="titleMedium" style={{ fontWeight: '800', color: palette.charcoal, marginBottom: 16 }}>
              New Daily Staffing Roster
            </Text>

            <Text variant="labelMedium" style={{ color: palette.muted, marginBottom: 4 }}>Roster Name</Text>
            <TextInput
              style={[styles.input, { color: palette.charcoal, borderColor: palette.border }]}
              placeholder="e.g. Instawork Concessions Crew A"
              placeholderTextColor={palette.muted}
              value={newRosterName}
              onChangeText={setNewRosterName}
            />

            <Text variant="labelMedium" style={{ color: palette.muted, marginTop: 12, marginBottom: 4 }}>Staffing Source / Vendor</Text>
            <TextInput
              style={[styles.input, { color: palette.charcoal, borderColor: palette.border }]}
              placeholder="e.g. Instawork, PeopleReady, High School Boosters"
              placeholderTextColor={palette.muted}
              value={newRosterSource}
              onChangeText={setNewRosterSource}
            />

            <Text variant="labelMedium" style={{ color: palette.muted, marginTop: 12, marginBottom: 4 }}>Department</Text>
            <ScrollView horizontal style={{ marginBottom: 12 }}>
              {departments?.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  onPress={() => setNewRosterDeptId(d.id)}
                  style={[
                    styles.deptPill,
                    {
                      backgroundColor: newRosterDeptId === d.id ? palette.primary : palette.background,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <Text style={{ color: newRosterDeptId === d.id ? palette.buttonText : palette.charcoal, fontWeight: '600', fontSize: 12 }}>
                    {d.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalFooter}>
              <Button mode="text" onPress={() => setCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button
                mode="contained"
                onPress={() =>
                  createRosterMutation.mutate({
                    operationalDate: selectedDate,
                    name: newRosterName,
                    staffingSource: newRosterSource,
                    departmentId: newRosterDeptId || departments?.[0]?.id,
                    rosterType: newRosterType,
                  })
                }
                loading={createRosterMutation.isPending}
                disabled={!newRosterName.trim() || !newRosterSource.trim()}
                style={{ backgroundColor: palette.primary }}
                labelStyle={{ color: palette.buttonText }}
              >
                Create Roster
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Add Worker */}
      <Modal visible={addWorkerModalOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text variant="titleMedium" style={{ fontWeight: '800', color: palette.charcoal, marginBottom: 16 }}>
              Allocate Worker
            </Text>

            <Text variant="labelMedium" style={{ color: palette.muted, marginBottom: 4 }}>Worker Full Name</Text>
            <TextInput
              style={[styles.input, { color: palette.charcoal, borderColor: palette.border }]}
              placeholder="e.g. John Smith"
              placeholderTextColor={palette.muted}
              value={workerName}
              onChangeText={setWorkerName}
            />

            <Text variant="labelMedium" style={{ color: palette.muted, marginTop: 12, marginBottom: 4 }}>Operational Role</Text>
            <TextInput
              style={[styles.input, { color: palette.charcoal, borderColor: palette.border }]}
              placeholder="e.g. Concessions Cashier, Suite Server, Prep Cook"
              placeholderTextColor={palette.muted}
              value={workerRole}
              onChangeText={setWorkerRole}
            />

            <View style={styles.modalFooter}>
              <Button mode="text" onPress={() => setAddWorkerModalOpen(false)}>
                Cancel
              </Button>
              <Button
                mode="contained"
                onPress={() =>
                  addWorkerMutation.mutate({
                    workerName,
                    workerRole,
                  })
                }
                loading={addWorkerMutation.isPending}
                disabled={!workerName.trim() || !workerRole.trim()}
                style={{ backgroundColor: palette.primary }}
                labelStyle={{ color: palette.buttonText }}
              >
                Add Worker
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Post-Approval Adjustment */}
      <Modal visible={adjustModalOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text variant="titleMedium" style={{ fontWeight: '800', color: palette.charcoal, marginBottom: 8 }}>
              Post-Approval Roster Correction
            </Text>
            <Text variant="bodySmall" style={{ color: palette.muted, marginBottom: 16 }}>
              This action creates an immutable version increment (v{(activeRoster?.version ?? 1) + 1}) with an auditable change reason.
            </Text>

            <Text variant="labelMedium" style={{ color: palette.muted, marginBottom: 4 }}>Reason for Correction</Text>
            <TextInput
              style={[styles.input, { color: palette.charcoal, borderColor: palette.border, height: 80 }]}
              placeholder="e.g. Corrected overtime punch for North concourse stand workers"
              placeholderTextColor={palette.muted}
              multiline
              value={adjustReason}
              onChangeText={setAdjustReason}
            />

            <View style={styles.modalFooter}>
              <Button mode="text" onPress={() => setAdjustModalOpen(false)}>
                Cancel
              </Button>
              <Button
                mode="contained"
                onPress={() => adjustRosterMutation.mutate({ reason: adjustReason })}
                loading={adjustRosterMutation.isPending}
                disabled={!adjustReason.trim()}
                style={{ backgroundColor: palette.warning }}
                labelStyle={{ color: palette.buttonText }}
              >
                Apply Correction
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dateSelector: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  todayButton: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  rosterTabs: {
    flexDirection: 'row',
  },
  rosterTab: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 10,
    minWidth: 180,
  },
  statusChip: {
    marginLeft: 6,
    height: 22,
  },
  content: {
    padding: 16,
  },
  centerBox: {
    padding: 40,
    alignItems: 'center',
  },
  emptyCard: {
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  overviewCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  overviewTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    marginTop: 12,
  },
  workersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyWorkersCard: {
    padding: 24,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  workerCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  workerInfo: {
    flex: 1,
  },
  workerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  workerStatusChip: {
    height: 24,
  },
  quickActionButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 6,
  },
  historyCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 16,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },
  deptPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 6,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 20,
  },
});
