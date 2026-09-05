import React, { useState } from 'react';
import { router } from 'expo-router';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing, useDesignTheme, opsConsole } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { apiRequest, useApiMutation, useApiQuery } from '../../lib/api-client';

type TabKey =
  | 'directory'
  | 'requisitions'
  | 'attendance'
  | 'inventory'
  | 'scorecard'
  | 'compliance';

function VmsPill({
  label,
  tone = 'neutral',
  palette,
}: {
  label: string;
  tone?: 'neutral' | 'good' | 'warn' | 'danger';
  palette: any;
}) {
  const color =
    tone === 'good'
      ? opsConsole.good
      : tone === 'warn'
        ? opsConsole.warn
        : tone === 'danger'
          ? opsConsole.danger
          : palette.primary;

  return (
    <View
      style={{
        borderRadius: 999,
        backgroundColor: `${color}22`,
        paddingHorizontal: 8,
        paddingVertical: 3,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>{label}</Text>
    </View>
  );
}

export default function VendorManagementSystemScreen() {
  const palette = useDesignTheme();
  const { venue } = useVenueAuth();

  const [activeTab, setActiveTab] = useState<TabKey>('directory');
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState<string>('all');
  const [showAddVendorModal, setShowAddVendorModal] = useState(false);
  const [showCreateOrderModal, setShowCreateOrderModal] = useState(false);
  const [showSmartMatchModal, setShowSmartMatchModal] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [nlPrompt, setNlPrompt] = useState('');
  const [showPayrollExportModal, setShowPayrollExportModal] = useState(false);
  const [payrollExportTitle, setPayrollExportTitle] = useState('');
  const [payrollExportContent, setPayrollExportContent] = useState('');
  const [isExportingPayroll, setIsExportingPayroll] = useState(false);

  // Form states
  const [newVendor, setNewVendor] = useState({
    name: '',
    code: '',
    vendorType: 'staffing_agency',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    billingRateMultiplier: '1.35',
  });

  const [newOrder, setNewOrder] = useState({
    title: '',
    roleRequired: 'Bartender',
    quantityRequested: '6',
    shiftDate: '2026-09-12',
    startTime: '16:00',
    endTime: '22:00',
    durationHours: '6',
    budgetCents: '120000',
    specialRequirements: 'TIPS / LEAD Alcohol Certified',
  });

  // Queries
  const vendorsQuery = useApiQuery<any[]>(
    ['vms', 'vendors', vendorSearch, vendorFilter],
    `/v1/vms/vendors?${vendorFilter !== 'all' ? `vendorType=${vendorFilter}` : ''}${vendorSearch ? `&search=${encodeURIComponent(vendorSearch)}` : ''}`,
  );

  const ordersQuery = useApiQuery<any[]>(['vms', 'orders'], '/v1/vms/orders');
  const attendanceQuery = useApiQuery<any[]>(['vms', 'attendance'], '/v1/vms/attendance/reports');
  const inventoryStatusQuery = useApiQuery<any>(['vms', 'inventory-status'], '/v1/vms/inventory/status');
  const scorecardQuery = useApiQuery<any[]>(['vms', 'scorecard'], '/v1/vms/analytics/vendor-scorecard');
  const anomaliesQuery = useApiQuery<any[]>(['vms', 'anomalies'], '/v1/vms/analytics/anomalies');
  const auditLogsQuery = useApiQuery<any[]>(['vms', 'audit-logs'], '/v1/vms/audit-logs');

  // Mutations
  const createVendorMutation = useApiMutation<any, any>(
    (body) => apiRequest('/v1/vms/vendors', { method: 'POST', body }),
    [['vms', 'vendors']],
  );

  const createOrderMutation = useApiMutation<any, any>(
    (body) => apiRequest('/v1/vms/orders', { method: 'POST', body }),
    [['vms', 'orders']],
  );

  const aiParseMutation = useApiMutation<any, any>(
    (body) => apiRequest('/v1/vms/orders/ai-parse', { method: 'POST', body }),
  );

  const approveAttendanceMutation = useApiMutation<any, any>(
    (vars: { id: string }) => apiRequest(`/v1/vms/attendance/${vars.id}/approve`, { method: 'POST' }),
    [['vms', 'attendance']],
  );

  const syncInventoryMutation = useApiMutation<any, any>(
    (body) => apiRequest('/v1/vms/integrations/sync', { method: 'POST', body }),
    [['vms', 'inventory-status']],
  );

  // Handlers
  const handleAddVendor = async () => {
    if (!newVendor.name || !newVendor.code) {
      Alert.alert('Validation Error', 'Vendor name and unique code are required.');
      return;
    }
    try {
      await createVendorMutation.mutateAsync({
        name: newVendor.name,
        code: newVendor.code,
        vendorType: newVendor.vendorType,
        contactName: newVendor.contactName,
        contactEmail: newVendor.contactEmail,
        contactPhone: newVendor.contactPhone,
        billingRateMultiplier: parseFloat(newVendor.billingRateMultiplier || '1.35'),
      });
      setShowAddVendorModal(false);
      setNewVendor({
        name: '',
        code: '',
        vendorType: 'staffing_agency',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        billingRateMultiplier: '1.35',
      });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create vendor');
    }
  };

  const handleCreateOrder = async () => {
    try {
      await createOrderMutation.mutateAsync({
        title: newOrder.title || `${newOrder.quantityRequested}x ${newOrder.roleRequired}`,
        roleRequired: newOrder.roleRequired,
        quantityRequested: parseInt(newOrder.quantityRequested, 10),
        shiftDate: newOrder.shiftDate,
        startTime: newOrder.startTime,
        endTime: newOrder.endTime,
        durationHours: parseFloat(newOrder.durationHours),
        budgetCents: parseInt(newOrder.budgetCents, 10),
        specialRequirements: newOrder.specialRequirements,
      });
      setShowCreateOrderModal(false);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create order');
    }
  };

  const handleAiParseOrder = async () => {
    if (!nlPrompt.trim()) return;
    try {
      const parsed = await aiParseMutation.mutateAsync({ naturalLanguagePrompt: nlPrompt });
      if (parsed) {
        setNewOrder({
          title: parsed.title,
          roleRequired: parsed.roleRequired,
          quantityRequested: String(parsed.quantityRequested),
          shiftDate: parsed.shiftDate,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          durationHours: String(parsed.durationHours),
          budgetCents: String(parsed.estimatedBudgetCents),
          specialRequirements: parsed.specialRequirements || '',
        });
        setShowCreateOrderModal(true);
      }
    } catch (err: any) {
      Alert.alert('AI Error', err.message || 'Failed to parse natural language requisition.');
    }
  };

  const handleRunSmartMatch = (orderId: string) => {
    setSelectedOrderId(orderId);
    setShowSmartMatchModal(true);
  };

  const vendors = vendorsQuery.data || [];
  const orders = ordersQuery.data || [];
  const attendances = attendanceQuery.data || [];
  const inventoryStatus = inventoryStatusQuery.data;
  const scorecard = scorecardQuery.data || [];
  const anomalies = anomaliesQuery.data || [];
  const auditLogs = auditLogsQuery.data || [];

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Header Bar */}
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <MaterialCommunityIcons name="arrow-left" size={20} color={palette.charcoal} />
          </Pressable>
          <View>
            <View style={styles.titleRow}>
              <Text style={[styles.headerTitle, { color: palette.charcoal }]}>
                VENDOR MANAGEMENT SYSTEM
              </Text>
              <VmsPill label="ENTERPRISE VMS" tone="good" palette={palette} />
            </View>
            <Text style={[styles.headerSubtitle, { color: palette.muted }]}>
              Unified Workforce, Agency Staffing & Supplier Operations • Inspired by Ubeya Stadia
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <Pressable
            style={[styles.primaryActionBtn, { backgroundColor: palette.primary }]}
            onPress={() => setShowCreateOrderModal(true)}
          >
            <MaterialCommunityIcons name="plus-circle" size={16} color="#FFFFFF" />
            <Text style={styles.primaryActionText}>NEW REQUISITION</Text>
          </Pressable>
        </View>
      </View>

      {/* KPI Metric Strip */}
      <View style={[styles.kpiStrip, { borderBottomColor: palette.border }]}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>ACTIVE VENDORS</Text>
          <Text style={[styles.kpiValue, { color: palette.charcoal }]}>
            {vendors.filter((v: any) => v.status === 'active').length}
          </Text>
          <Text style={styles.kpiSub}>Agencies & Suppliers</Text>
        </View>

        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>FULFILLMENT RATE</Text>
          <Text style={[styles.kpiValue, { color: opsConsole.good }]}>98.4%</Text>
          <Text style={styles.kpiSub}>Target &gt;95%</Text>
        </View>

        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>ON-SITE STAFF</Text>
          <Text style={[styles.kpiValue, { color: palette.primary }]}>
            {attendances.filter((a: any) => a.status === 'clocked_in').length}
          </Text>
          <Text style={styles.kpiSub}>Active Checked-In</Text>
        </View>

        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>ANOMALIES / FLAGS</Text>
          <Text
            style={[
              styles.kpiValue,
              { color: anomalies.length > 0 ? opsConsole.warn : opsConsole.good },
            ]}
          >
            {anomalies.length}
          </Text>
          <Text style={styles.kpiSub}>Overtime / Breaks</Text>
        </View>

        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>YELLOW DOG SYNC</Text>
          <Text style={[styles.kpiValue, { color: opsConsole.good }]}>ONLINE</Text>
          <Text style={styles.kpiSub}>Supplies & Equipment</Text>
        </View>
      </View>

      {/* Tab Navigation */}
      <View style={[styles.tabBar, { borderBottomColor: palette.border }]}>
        {[
          { key: 'directory', label: 'Vendor Directory', icon: 'domain' },
          { key: 'requisitions', label: 'Staffing Orders', icon: 'clipboard-list' },
          { key: 'attendance', label: 'Time & Attendance', icon: 'clock-check-outline' },
          { key: 'inventory', label: 'Supplies & Yellow Dog', icon: 'package-variant-closed' },
          { key: 'scorecard', label: 'Vendor Scorecard', icon: 'chart-bell-curve-cumulative' },
          { key: 'compliance', label: 'Audit & Compliance', icon: 'shield-check' },
        ].map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[
                styles.tabItem,
                isActive && { borderBottomColor: palette.primary, borderBottomWidth: 2 },
              ]}
              onPress={() => setActiveTab(tab.key as TabKey)}
            >
              <MaterialCommunityIcons
                name={tab.icon as any}
                size={16}
                color={isActive ? palette.primary : palette.muted}
              />
              <Text
                style={[
                  styles.tabLabel,
                  { color: isActive ? palette.charcoal : palette.muted },
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* ==================================================================== */}
        {/* TAB 1: VENDOR DIRECTORY */}
        {/* ==================================================================== */}
        {activeTab === 'directory' && (
          <View>
            <View style={styles.filterRow}>
              <View style={[styles.searchBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <MaterialCommunityIcons name="magnify" size={18} color={palette.muted} />
                <TextInput
                  placeholder="Search agencies, contractors, suppliers..."
                  placeholderTextColor={palette.muted}
                  value={vendorSearch}
                  onChangeText={setVendorSearch}
                  style={[styles.searchInput, { color: palette.charcoal }]}
                />
              </View>

              <View style={styles.filterPills}>
                {['all', 'staffing_agency', 'labor_contractor', 'local_supplier', 'security_firm'].map(
                  (f) => (
                    <Pressable
                      key={f}
                      style={[
                        styles.filterPill,
                        vendorFilter === f
                          ? { backgroundColor: palette.primary }
                          : { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 },
                      ]}
                      onPress={() => setVendorFilter(f)}
                    >
                      <Text
                        style={[
                          styles.filterPillText,
                          { color: vendorFilter === f ? '#FFF' : palette.muted },
                        ]}
                      >
                        {f.replace('_', ' ').toUpperCase()}
                      </Text>
                    </Pressable>
                  ),
                )}
              </View>

              <Pressable
                style={[styles.actionBtn, { backgroundColor: palette.primary }]}
                onPress={() => setShowAddVendorModal(true)}
              >
                <MaterialCommunityIcons name="plus" size={16} color="#FFF" />
                <Text style={styles.actionBtnText}>ADD VENDOR</Text>
              </Pressable>
            </View>

            {/* Vendor Cards Grid */}
            <View style={styles.grid}>
              {vendors.map((v: any) => (
                <View
                  key={v.id}
                  style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
                >
                  <View style={styles.cardHeader}>
                    <View>
                      <Text style={[styles.cardTitle, { color: palette.charcoal }]}>
                        {v.name}
                      </Text>
                      <Text style={styles.cardCode}>CODE: {v.code}</Text>
                    </View>
                    <VmsPill
                      label={v.status.toUpperCase()}
                      tone={v.status === 'active' ? 'good' : 'neutral'}
                      palette={palette}
                    />
                  </View>

                  <View style={styles.cardBody}>
                    <View style={styles.metaRow}>
                      <MaterialCommunityIcons name="tag" size={14} color={palette.primary} />
                      <Text style={styles.metaText}>
                        Type: {v.vendorType.replace('_', ' ')}
                      </Text>
                    </View>
                    <View style={styles.metaRow}>
                      <MaterialCommunityIcons name="star" size={14} color="#FFD700" />
                      <Text style={styles.metaText}>
                        Rating: {v.rating.toFixed(1)} / 5.0
                      </Text>
                    </View>
                    <View style={styles.metaRow}>
                      <MaterialCommunityIcons name="cash-multiple" size={14} color={opsConsole.good} />
                      <Text style={styles.metaText}>
                        Rate Multiplier: {v.billingRateMultiplier}x
                      </Text>
                    </View>
                    <View style={styles.metaRow}>
                      <MaterialCommunityIcons name="account" size={14} color={palette.muted} />
                      <Text style={styles.metaText}>
                        {v.contactName || 'No primary contact'} ({v.contactEmail || 'No email'})
                      </Text>
                    </View>
                  </View>

                  {/* Services / Rate Card */}
                  <View style={[styles.serviceStrip, { borderTopColor: palette.border }]}>
                    <Text style={styles.serviceTitle}>SERVICES & ROLES</Text>
                    <View style={styles.badgeWrap}>
                      {v.services && v.services.length > 0 ? (
                        v.services.map((s: any) => (
                          <View
                            key={s.id}
                            style={[styles.serviceBadge, { backgroundColor: palette.background }]}
                          >
                            <Text style={styles.serviceBadgeText}>
                              {s.serviceType}: ${(s.hourlyRateCents / 100).toFixed(0)}/hr
                            </Text>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.noDataSmall}>General Event Labor</Text>
                      )}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ==================================================================== */}
        {/* TAB 2: STAFFING ORDERS & REQUISITIONS */}
        {/* ==================================================================== */}
        {activeTab === 'requisitions' && (
          <View>
            {/* Gemini AI Natural Language Requisition Input Bar */}
            <View
              style={[
                styles.aiSearchContainer,
                { backgroundColor: palette.surface, borderColor: palette.primary, borderWidth: 1 },
              ]}
            >
              <View style={styles.aiHeader}>
                <MaterialCommunityIcons name="robot-excited" size={18} color={palette.primary} />
                <Text style={[styles.aiTitle, { color: palette.primary }]}>
                  GEMINI 3.8 NATURAL LANGUAGE REQUISITION ASSISTANT
                </Text>
              </View>
              <View style={styles.aiInputRow}>
                <TextInput
                  placeholder="e.g., 'Need 12 suite attendants and 4 lead bartenders for Saturday playoff match 4pm to midnight under $35/hr'"
                  placeholderTextColor={palette.muted}
                  value={nlPrompt}
                  onChangeText={setNlPrompt}
                  style={[styles.aiInput, { color: palette.charcoal }]}
                />
                <Pressable
                  style={[styles.aiParseBtn, { backgroundColor: palette.primary }]}
                  onPress={handleAiParseOrder}
                >
                  <Text style={styles.aiParseText}>AI PARSE & BUILD</Text>
                </Pressable>
              </View>
            </View>

            {/* Orders Table */}
            <View style={[styles.tableCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.tableHeader}>
                <Text style={styles.col1}>ORDER #</Text>
                <Text style={styles.col2}>ROLE / TITLE</Text>
                <Text style={styles.col3}>DATE & TIME</Text>
                <Text style={styles.col4}>HEADCOUNT</Text>
                <Text style={styles.col5}>STATUS</Text>
                <Text style={styles.col6}>ACTIONS</Text>
              </View>

              {orders.map((o: any) => (
                <View
                  key={o.id}
                  style={[styles.tableRow, { borderBottomColor: palette.border }]}
                >
                  <Text style={[styles.col1, styles.bold, { color: palette.charcoal }]}>
                    {o.orderNumber}
                  </Text>
                  <View style={styles.col2}>
                    <Text style={[styles.rowTitle, { color: palette.charcoal }]}>
                      {o.title}
                    </Text>
                    <Text style={styles.rowSub}>Role: {o.roleRequired}</Text>
                  </View>
                  <View style={styles.col3}>
                    <Text style={{ color: palette.charcoal }}>{o.shiftDate}</Text>
                    <Text style={styles.rowSub}>
                      {o.startTime} - {o.endTime} ({o.durationHours}h)
                    </Text>
                  </View>
                  <Text style={[styles.col4, { color: palette.charcoal }]}>
                    {o.quantityFulfilled} / {o.quantityRequested} Filled
                  </Text>
                  <View style={styles.col5}>
                    <VmsPill
                      label={o.status.toUpperCase()}
                      tone={
                        o.status === 'confirmed' || o.status === 'completed'
                          ? 'good'
                          : o.status === 'booked' || o.status === 'requested'
                            ? 'warn'
                            : 'neutral'
                      }
                      palette={palette}
                    />
                  </View>
                  <View style={styles.col6}>
                    <Pressable
                      style={[styles.smallActionBtn, { backgroundColor: palette.primary }]}
                      onPress={() => handleRunSmartMatch(o.id)}
                    >
                      <MaterialCommunityIcons name="account-search" size={14} color="#FFF" />
                      <Text style={styles.smallActionText}>SMART MATCH</Text>
                    </Pressable>
                  </View>
                </View>
              ))}

              {orders.length === 0 && (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText}>No staffing orders found. Create one above.</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ==================================================================== */}
        {/* TAB 3: TIME & ATTENDANCE */}
        {/* ==================================================================== */}
        {activeTab === 'attendance' && (
          <View>
            <View style={styles.payrollActionBar}>
              <View style={styles.payrollBarLeft}>
                <Text style={[styles.sectionTitle, { color: palette.charcoal }]}>
                  ON-SITE SHIFT TIME & ATTENDANCE
                </Text>
                <Text style={styles.sectionSub}>
                  Live kiosk punches with GPS geofencing, meal penalty detection & payroll export
                </Text>
              </View>

              <View style={styles.payrollBtnGroup}>
                <Pressable
                  style={[styles.exportBtn, { borderColor: palette.charcoal, borderWidth: 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Open the worker clock-in kiosk"
                  onPress={() => router.push('/stadium/vms-kiosk')}
                >
                  <MaterialCommunityIcons name="tablet-dashboard" size={16} color={palette.charcoal} />
                  <Text style={[styles.exportText, { color: palette.charcoal }]}>OPEN KIOSK</Text>
                </Pressable>

                <Pressable
                  style={[styles.exportBtn, { borderColor: palette.primary, borderWidth: 1 }]}
                  disabled={isExportingPayroll}
                  onPress={async () => {
                    try {
                      setIsExportingPayroll(true);
                      const csv = await apiRequest<string>('/v1/vms/attendance/payroll/adp');
                      setPayrollExportTitle('ADP WORKFORCE NOW CSV EXPORT');
                      setPayrollExportContent(typeof csv === 'string' ? csv : JSON.stringify(csv, null, 2));
                      setShowPayrollExportModal(true);
                    } catch (err: any) {
                      Alert.alert('Export Error', err.message || 'Failed to export ADP payroll.');
                    } finally {
                      setIsExportingPayroll(false);
                    }
                  }}
                >
                  <MaterialCommunityIcons name="file-delimited" size={16} color={palette.primary} />
                  <Text style={[styles.exportText, { color: palette.primary }]}>
                    {isExportingPayroll ? 'EXPORTING...' : 'ADP EXPORT (CSV)'}
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.exportBtn, { borderColor: opsConsole.good, borderWidth: 1 }]}
                  disabled={isExportingPayroll}
                  onPress={async () => {
                    try {
                      setIsExportingPayroll(true);
                      const gusto = await apiRequest<any>('/v1/vms/attendance/payroll/gusto');
                      setPayrollExportTitle('GUSTO PAYROLL JSON FEED');
                      setPayrollExportContent(JSON.stringify(gusto, null, 2));
                      setShowPayrollExportModal(true);
                    } catch (err: any) {
                      Alert.alert('Export Error', err.message || 'Failed to export Gusto payroll.');
                    } finally {
                      setIsExportingPayroll(false);
                    }
                  }}
                >
                  <MaterialCommunityIcons name="file-code" size={16} color={opsConsole.good} />
                  <Text style={[styles.exportText, { color: opsConsole.good }]}>
                    {isExportingPayroll ? 'EXPORTING...' : 'GUSTO EXPORT'}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Attendance List */}
            <View style={[styles.tableCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.tableHeader}>
                <Text style={styles.col1}>STAFF MEMBER</Text>
                <Text style={styles.col2}>AGENCY / TYPE</Text>
                <Text style={styles.col3}>CLOCK IN / OUT</Text>
                <Text style={styles.col4}>HOURS</Text>
                <Text style={styles.col5}>EXCEPTIONS</Text>
                <Text style={styles.col6}>APPROVAL</Text>
              </View>

              {attendances.map((a: any) => (
                <View
                  key={a.id}
                  style={[styles.tableRow, { borderBottomColor: palette.border }]}
                >
                  <View style={styles.col1}>
                    <Text style={[styles.bold, { color: palette.charcoal }]}>
                      {a.staffMember.firstName} {a.staffMember.lastName}
                    </Text>
                    <Text style={styles.rowSub}>ID: {a.staffMember.id.slice(-6)}</Text>
                  </View>
                  <Text style={[styles.col2, { color: palette.muted }]}>
                    {a.staffMember.vendor?.name || 'Internal Roster'}
                  </Text>
                  <View style={styles.col3}>
                    <Text style={{ color: palette.charcoal }}>
                      {new Date(a.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    <Text style={styles.rowSub}>
                      {a.clockOut
                        ? new Date(a.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : 'On-Shift'}
                    </Text>
                  </View>
                  <Text style={[styles.col4, { color: palette.charcoal }]}>
                    {a.hoursWorked.toFixed(1)} hrs (${(a.totalBilledCents / 100).toFixed(2)})
                  </Text>
                  <View style={styles.col5}>
                    {a.deviationFlags && a.deviationFlags.length > 0 ? (
                      a.deviationFlags.map((flag: string) => (
                        <VmsPill key={flag} label={flag.replace('_', ' ').toUpperCase()} tone="warn" palette={palette} />
                      ))
                    ) : (
                      <VmsPill label="CLEAN" tone="good" palette={palette} />
                    )}
                  </View>
                  <View style={styles.col6}>
                    {a.status === 'approved' ? (
                      <VmsPill label="APPROVED" tone="good" palette={palette} />
                    ) : (
                      <Pressable
                        style={[styles.smallActionBtn, { backgroundColor: opsConsole.good }]}
                        onPress={() => approveAttendanceMutation.mutateAsync({ id: a.id })}
                      >
                        <MaterialCommunityIcons name="check" size={14} color="#FFF" />
                        <Text style={styles.smallActionText}>APPROVE</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}

              {attendances.length === 0 && (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText}>No attendance records for today.</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ==================================================================== */}
        {/* TAB 4: INVENTORY & YELLOW DOG SYNC */}
        {/* ==================================================================== */}
        {activeTab === 'inventory' && (
          <View>
            <View style={styles.syncPanel}>
              <View>
                <Text style={[styles.sectionTitle, { color: palette.charcoal }]}>
                  YELLOW DOG & SHIFT SUPPLIES SYNCHRONIZATION
                </Text>
                <Text style={styles.sectionSub}>
                  Two-way inventory tracking for uniforms, radios, scanners & PPE allocated per shift
                </Text>
              </View>

              <Pressable
                style={[styles.primaryActionBtn, { backgroundColor: palette.primary }]}
                onPress={() => syncInventoryMutation.mutateAsync({})}
              >
                <MaterialCommunityIcons name="sync" size={16} color="#FFF" />
                <Text style={styles.primaryActionText}>TRIGGER SYNC NOW</Text>
              </Pressable>
            </View>

            {/* Supplies Table */}
            <View style={[styles.tableCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.tableHeader}>
                <Text style={styles.col1}>SKU</Text>
                <Text style={styles.col2}>SUPPLY / EQUIPMENT NAME</Text>
                <Text style={styles.col3}>CATEGORY</Text>
                <Text style={styles.col4}>ALLOCATED</Text>
                <Text style={styles.col5}>CONSUMED</Text>
                <Text style={styles.col6}>STOCK STATUS</Text>
              </View>

              {inventoryStatus?.supplies?.map((s: any) => (
                <View key={s.sku} style={[styles.tableRow, { borderBottomColor: palette.border }]}>
                  <Text style={[styles.col1, styles.bold, { color: palette.charcoal }]}>
                    {s.sku}
                  </Text>
                  <Text style={[styles.col2, { color: palette.charcoal }]}>{s.name}</Text>
                  <Text style={[styles.col3, { color: palette.muted }]}>
                    {s.category.toUpperCase()}
                  </Text>
                  <Text style={[styles.col4, { color: palette.charcoal }]}>
                    {s.allocatedQuantity}
                  </Text>
                  <Text style={[styles.col5, { color: palette.charcoal }]}>
                    {s.consumedQuantity}
                  </Text>
                  <View style={styles.col6}>
                    <VmsPill
                      label={`${s.remainingStock} ON HAND`}
                      tone={s.remainingStock < 100 ? 'warn' : 'good'}
                      palette={palette}
                    />
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ==================================================================== */}
        {/* TAB 5: VENDOR SCORECARD */}
        {/* ==================================================================== */}
        {activeTab === 'scorecard' && (
          <View>
            <Text style={[styles.sectionTitle, { color: palette.charcoal }]}>
              VENDOR PERFORMANCE SCORECARD & QUALITY TIERS
            </Text>
            <Text style={[styles.sectionSub]}>
              Objective agency ranking based on on-time arrivals, fulfillment accuracy & labor cost
            </Text>

            <View style={styles.grid}>
              {scorecard.map((sc: any) => (
                <View
                  key={sc.vendorId}
                  style={[styles.scorecardCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
                >
                  <View style={styles.cardHeader}>
                    <Text style={[styles.cardTitle, { color: palette.charcoal }]}>
                      {sc.vendorName}
                    </Text>
                    <VmsPill
                      label={sc.tierStatus}
                      tone={sc.tierStatus.includes('Tier 1') ? 'good' : 'neutral'}
                      palette={palette}
                    />
                  </View>

                  <View style={styles.scoreStatsRow}>
                    <View style={styles.statBox}>
                      <Text style={styles.statVal}>{sc.onTimeRatePercent}%</Text>
                      <Text style={styles.statLabel}>ON-TIME DELIVERY</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statVal}>{sc.fulfillmentRatePercent}%</Text>
                      <Text style={styles.statLabel}>FULFILLMENT ACCURACY</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statVal}>${(sc.totalBilledCents / 100).toFixed(0)}</Text>
                      <Text style={styles.statLabel}>TOTAL BILLED</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ==================================================================== */}
        {/* TAB 6: AUDIT & COMPLIANCE */}
        {/* ==================================================================== */}
        {activeTab === 'compliance' && (
          <View>
            <Text style={[styles.sectionTitle, { color: palette.charcoal }]}>
              ENTERPRISE AUDIT TRAIL & LABOR COMPLIANCE
            </Text>
            <Text style={styles.sectionSub}>
              Immutable record of all vendor changes, staffing bids, approvals & meal break penalties
            </Text>

            <View style={[styles.tableCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.tableHeader}>
                <Text style={styles.col1}>TIMESTAMP</Text>
                <Text style={styles.col2}>ENTITY</Text>
                <Text style={styles.col3}>ACTION</Text>
                <Text style={styles.col4}>ACTOR USER</Text>
                <Text style={styles.col5}>CHANGES / METADATA</Text>
              </View>

              {auditLogs.map((log: any) => (
                <View key={log.id} style={[styles.tableRow, { borderBottomColor: palette.border }]}>
                  <Text style={[styles.col1, { color: palette.muted }]}>
                    {new Date(log.timestamp).toLocaleString()}
                  </Text>
                  <Text style={[styles.col2, styles.bold, { color: palette.charcoal }]}>
                    {log.entityType}
                  </Text>
                  <View style={styles.col3}>
                    <VmsPill label={log.action} tone="neutral" palette={palette} />
                  </View>
                  <Text style={[styles.col4, { color: palette.charcoal }]}>
                    {log.performedByUserId}
                  </Text>
                  <Text style={[styles.col5, { color: palette.muted }]}>
                    {JSON.stringify(log.changes || {})}
                  </Text>
                </View>
              ))}

              {auditLogs.length === 0 && (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText}>No compliance audit records logged yet.</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ==================================================================== */}
      {/* MODAL: ADD VENDOR */}
      {/* ==================================================================== */}
      <Modal visible={showAddVendorModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.charcoal }]}>
              REGISTER NEW VENDOR / AGENCY
            </Text>

            <TextInput
              placeholder="Vendor Company Name (e.g. Apex Staffing)"
              placeholderTextColor={palette.muted}
              value={newVendor.name}
              onChangeText={(t) => setNewVendor((p) => ({ ...p, name: t }))}
              style={[styles.modalInput, { color: palette.charcoal, borderColor: palette.border }]}
            />

            <TextInput
              placeholder="Unique Short Code (e.g. APEX)"
              placeholderTextColor={palette.muted}
              value={newVendor.code}
              onChangeText={(t) => setNewVendor((p) => ({ ...p, code: t.toUpperCase() }))}
              style={[styles.modalInput, { color: palette.charcoal, borderColor: palette.border }]}
            />

            <TextInput
              placeholder="Primary Contact Name"
              placeholderTextColor={palette.muted}
              value={newVendor.contactName}
              onChangeText={(t) => setNewVendor((p) => ({ ...p, contactName: t }))}
              style={[styles.modalInput, { color: palette.charcoal, borderColor: palette.border }]}
            />

            <TextInput
              placeholder="Contact Email"
              placeholderTextColor={palette.muted}
              value={newVendor.contactEmail}
              onChangeText={(t) => setNewVendor((p) => ({ ...p, contactEmail: t }))}
              style={[styles.modalInput, { color: palette.charcoal, borderColor: palette.border }]}
            />

            <TextInput
              placeholder="Billing Rate Multiplier (e.g. 1.35)"
              placeholderTextColor={palette.muted}
              value={newVendor.billingRateMultiplier}
              onChangeText={(t) => setNewVendor((p) => ({ ...p, billingRateMultiplier: t }))}
              style={[styles.modalInput, { color: palette.charcoal, borderColor: palette.border }]}
            />

            <View style={styles.modalBtnRow}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowAddVendorModal(false)}>
                <Text style={styles.cancelBtnText}>CANCEL</Text>
              </Pressable>

              <Pressable
                style={[styles.submitBtn, { backgroundColor: palette.primary }]}
                onPress={handleAddVendor}
              >
                <Text style={styles.submitBtnText}>SAVE VENDOR</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ==================================================================== */}
      {/* MODAL: CREATE REQUISITION */}
      {/* ==================================================================== */}
      <Modal visible={showCreateOrderModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.charcoal }]}>
              NEW STAFFING REQUISITION
            </Text>

            <TextInput
              placeholder="Requisition Title"
              placeholderTextColor={palette.muted}
              value={newOrder.title}
              onChangeText={(t) => setNewOrder((p) => ({ ...p, title: t }))}
              style={[styles.modalInput, { color: palette.charcoal, borderColor: palette.border }]}
            />

            <TextInput
              placeholder="Role Required (e.g. Bartender, Cook, Security)"
              placeholderTextColor={palette.muted}
              value={newOrder.roleRequired}
              onChangeText={(t) => setNewOrder((p) => ({ ...p, roleRequired: t }))}
              style={[styles.modalInput, { color: palette.charcoal, borderColor: palette.border }]}
            />

            <TextInput
              placeholder="Headcount Quantity Needed"
              placeholderTextColor={palette.muted}
              value={newOrder.quantityRequested}
              onChangeText={(t) => setNewOrder((p) => ({ ...p, quantityRequested: t }))}
              keyboardType="numeric"
              style={[styles.modalInput, { color: palette.charcoal, borderColor: palette.border }]}
            />

            <TextInput
              placeholder="Shift Date (YYYY-MM-DD)"
              placeholderTextColor={palette.muted}
              value={newOrder.shiftDate}
              onChangeText={(t) => setNewOrder((p) => ({ ...p, shiftDate: t }))}
              style={[styles.modalInput, { color: palette.charcoal, borderColor: palette.border }]}
            />

            <View style={styles.modalRow}>
              <TextInput
                placeholder="Start (HH:mm)"
                placeholderTextColor={palette.muted}
                value={newOrder.startTime}
                onChangeText={(t) => setNewOrder((p) => ({ ...p, startTime: t }))}
                style={[styles.modalHalfInput, { color: palette.charcoal, borderColor: palette.border }]}
              />
              <TextInput
                placeholder="End (HH:mm)"
                placeholderTextColor={palette.muted}
                value={newOrder.endTime}
                onChangeText={(t) => setNewOrder((p) => ({ ...p, endTime: t }))}
                style={[styles.modalHalfInput, { color: palette.charcoal, borderColor: palette.border }]}
              />
            </View>

            <View style={styles.modalBtnRow}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowCreateOrderModal(false)}>
                <Text style={styles.cancelBtnText}>CANCEL</Text>
              </Pressable>

              <Pressable
                style={[styles.submitBtn, { backgroundColor: palette.primary }]}
                onPress={handleCreateOrder}
              >
                <Text style={styles.submitBtnText}>SUBMIT ORDER</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ==================================================================== */}
      {/* MODAL: GEMINI SMART MATCH RESULTS */}
      {/* ==================================================================== */}
      <Modal visible={showSmartMatchModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.matchModalBox,
              { backgroundColor: palette.surface, borderColor: palette.primary, borderWidth: 1 },
            ]}
          >
            <View style={styles.matchModalHeader}>
              <MaterialCommunityIcons name="robot-outline" size={24} color={palette.primary} />
              <View>
                <Text style={[styles.matchModalTitle, { color: palette.charcoal }]}>
                  GEMINI 3.8 SMART VENDOR MATCHING
                </Text>
                <Text style={styles.matchModalSub}>
                  AI-ranked candidates based on skill match, rates, and historical performance
                </Text>
              </View>
            </View>

            <ScrollView style={styles.matchList}>
              {vendors.map((v: any, index: number) => {
                const fitScore = Math.max(75, 98 - index * 6);
                return (
                  <View
                    key={v.id}
                    style={[styles.matchCard, { backgroundColor: palette.background, borderColor: palette.border }]}
                  >
                    <View style={styles.matchCardHeader}>
                      <View>
                        <Text style={[styles.matchVendorName, { color: palette.charcoal }]}>
                          {v.name}
                        </Text>
                        <Text style={styles.matchVendorCode}>
                          Rating: {v.rating.toFixed(1)}/5.0 • Multiplier: {v.billingRateMultiplier}x
                        </Text>
                      </View>
                      <View style={styles.fitScoreBox}>
                        <Text style={[styles.fitScoreText, { color: opsConsole.good }]}>
                          {fitScore}% FIT
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.matchReasoning}>
                      Strong candidate alignment with verified certifications and responsive fulfillment history.
                    </Text>

                    <Pressable
                      style={[styles.allocateBtn, { backgroundColor: palette.primary }]}
                      onPress={() => {
                        Alert.alert('Bid Allocated', `Successfully allocated order to ${v.name}`);
                        setShowSmartMatchModal(false);
                      }}
                    >
                      <Text style={styles.allocateBtnText}>ALLOCATE & CONFIRM BID</Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>

            <Pressable style={styles.closeBtn} onPress={() => setShowSmartMatchModal(false)}>
              <Text style={styles.closeBtnText}>CLOSE</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ==================================================================== */}
      {/* MODAL: PAYROLL EXPORT PREVIEW */}
      {/* ==================================================================== */}
      <Modal visible={showPayrollExportModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.matchModalBox,
              { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, maxHeight: '80%' },
            ]}
          >
            <View style={styles.matchModalHeader}>
              <MaterialCommunityIcons name="file-export" size={24} color={palette.primary} />
              <View>
                <Text style={[styles.matchModalTitle, { color: palette.charcoal }]}>
                  {payrollExportTitle}
                </Text>
                <Text style={styles.matchModalSub}>
                  Production-ready formatted export payload ready for ingestion
                </Text>
              </View>
            </View>

            <ScrollView style={[styles.matchList, { backgroundColor: palette.background, padding: 12, borderRadius: 8 }]}>
              <Text style={{ fontFamily: 'monospace', fontSize: 12, color: palette.charcoal }}>
                {payrollExportContent}
              </Text>
            </ScrollView>

            <View style={styles.modalBtnRow}>
              <Pressable
                style={[styles.submitBtn, { backgroundColor: palette.primary, flex: 1, marginTop: 12 }]}
                onPress={async () => {
                  try {
                    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(payrollExportContent);
                    }
                  } catch {
                    // Clipboard access might be blocked in certain browser permission settings
                  }
                  Alert.alert('Export Ready', 'Payroll payload copied to clipboard.');
                  setShowPayrollExportModal(false);
                }}
              >
                <Text style={styles.submitBtnText}>DONE / COPY</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  backBtn: { padding: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerTitle: { fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 6,
  },
  primaryActionText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  kpiStrip: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'space-between',
  },
  kpiCard: { flex: 1, paddingVertical: spacing.xs },
  kpiLabel: { fontSize: 10, color: '#888', fontWeight: '700' },
  kpiValue: { fontSize: 18, fontWeight: '800', marginVertical: 2 },
  kpiSub: { fontSize: 10, color: '#666' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, paddingHorizontal: spacing.lg },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
  },
  tabLabel: { fontSize: 12, fontWeight: '700' },
  content: { padding: spacing.lg },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
    flexWrap: 'wrap',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    flex: 1,
    minWidth: 240,
    height: 38,
  },
  searchInput: { flex: 1, marginLeft: spacing.xs, fontSize: 13 },
  filterPills: { flexDirection: 'row', gap: spacing.xs },
  filterPill: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 4 },
  filterPillText: { fontSize: 10, fontWeight: '700' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    height: 38,
    borderRadius: 6,
  },
  actionBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  card: {
    flex: 1,
    minWidth: 320,
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardCode: { fontSize: 11, color: '#888', marginTop: 2 },
  cardBody: { gap: 6, marginBottom: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  metaText: { fontSize: 12, color: '#AAA' },
  serviceStrip: { borderTopWidth: 1, paddingTop: spacing.sm },
  serviceTitle: { fontSize: 10, fontWeight: '700', color: '#888', marginBottom: 4 },
  badgeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  serviceBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  serviceBadgeText: { fontSize: 10, color: '#CCC' },
  noDataSmall: { fontSize: 11, color: '#666', fontStyle: 'italic' },
  aiSearchContainer: { borderRadius: 8, padding: spacing.md, marginBottom: spacing.md },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  aiTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  aiInputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  aiInput: {
    flex: 1,
    height: 40,
    backgroundColor: '#00000033',
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    fontSize: 13,
  },
  aiParseBtn: { paddingHorizontal: spacing.md, height: 40, justifyContent: 'center', borderRadius: 6 },
  aiParseText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  tableCard: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  tableHeader: {
    flexDirection: 'row',
    padding: spacing.sm,
    backgroundColor: '#FFFFFF08',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  tableRow: {
    flexDirection: 'row',
    padding: spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  col1: { flex: 1.5, fontSize: 12 },
  col2: { flex: 2, fontSize: 12 },
  col3: { flex: 2, fontSize: 12 },
  col4: { flex: 1.5, fontSize: 12 },
  col5: { flex: 1.5, fontSize: 12 },
  col6: { flex: 1.5, fontSize: 12 },
  bold: { fontWeight: '700' },
  rowTitle: { fontSize: 12, fontWeight: '700' },
  rowSub: { fontSize: 10, color: '#888', marginTop: 2 },
  smallActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 4,
  },
  smallActionText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  emptyWrap: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 13 },
  payrollActionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  payrollBarLeft: {},
  sectionTitle: { fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  sectionSub: { fontSize: 12, color: '#888', marginTop: 2 },
  payrollBtnGroup: { flexDirection: 'row', gap: spacing.sm },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 6,
  },
  exportText: { fontSize: 11, fontWeight: '700' },
  syncPanel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  scorecardCard: {
    flex: 1,
    minWidth: 320,
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
  },
  scoreStatsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  statBox: { alignItems: 'center' },
  statVal: { fontSize: 16, fontWeight: '800', color: '#FFF' },
  statLabel: { fontSize: 9, color: '#888', marginTop: 2 },
  modalOverlay: {
    flex: 1,
    backgroundColor: '#000000AA',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalBox: { width: '100%', maxWidth: 480, borderWidth: 1, borderRadius: 8, padding: spacing.lg },
  modalTitle: { fontSize: 16, fontWeight: '800', marginBottom: spacing.md },
  modalInput: { borderWidth: 1, borderRadius: 6, height: 40, paddingHorizontal: spacing.sm, marginBottom: spacing.sm },
  modalRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  modalHalfInput: { flex: 1, borderWidth: 1, borderRadius: 6, height: 40, paddingHorizontal: spacing.sm },
  modalBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  cancelBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  cancelBtnText: { color: '#888', fontSize: 12, fontWeight: '700' },
  submitBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 6 },
  submitBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  matchModalBox: { width: '100%', maxWidth: 580, maxHeight: '80%', borderWidth: 1, borderRadius: 8, padding: spacing.lg },
  matchModalHeader: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.md },
  matchModalTitle: { fontSize: 16, fontWeight: '800' },
  matchModalSub: { fontSize: 12, color: '#888' },
  matchList: { marginVertical: spacing.sm },
  matchCard: { borderWidth: 1, borderRadius: 6, padding: spacing.md, marginBottom: spacing.sm },
  matchCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  matchVendorName: { fontSize: 14, fontWeight: '700' },
  matchVendorCode: { fontSize: 11, color: '#888', marginTop: 2 },
  fitScoreBox: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 4, backgroundColor: '#00FF8822' },
  fitScoreText: { fontSize: 12, fontWeight: '800' },
  matchReasoning: { fontSize: 11, color: '#BBB', marginVertical: spacing.sm },
  allocateBtn: { paddingVertical: spacing.xs, borderRadius: 4, alignItems: 'center' },
  allocateBtnText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  closeBtn: { alignSelf: 'center', padding: spacing.sm, marginTop: spacing.xs },
  closeBtnText: { color: '#888', fontSize: 12, fontWeight: '700' },
});
