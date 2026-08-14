import { useState } from 'react';
import { router } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandButton, CommandText, StatusPill } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';
import { useResponsive } from '../lib/responsive';

export interface BeoPreOrderItem {
  id: string;
  name: string;
  quantity: number;
  category: 'entree' | 'appetizer' | 'dessert' | 'beverage' | 'bar';
  status: 'prepped' | 'delivered' | 'active';
  dietaryNotes?: string;
  scheduledTime?: string;
}

export interface InSuiteOrderItem {
  id: string;
  orderedAt: string;
  orderedBy: string;
  items: string;
  totalCents: number;
  status: 'preparing' | 'delivering' | 'fulfilled';
}

export interface InSeatOrderItem {
  id: string;
  seatLocation: string;
  customerName: string;
  orderedAt: string;
  items: string;
  totalCents: number;
  status: 'queue' | 'fulfilling' | 'delivered';
  runnerName?: string;
}

export interface StaffHierarchy {
  director: {
    name: string;
    title: string;
    radioChannel: string;
  };
  manager: {
    name: string;
    title: string;
    status: 'on_duty' | 'break' | 'off_duty';
    radioChannel: string;
  };
  assignedStaff: Array<{
    name: string;
    role: string;
    status: 'on_duty' | 'break' | 'dispatched';
    shift: string;
    geofenceVerified: boolean;
  }>;
}

export interface StadiumZoneItem {
  id: string;
  code: string;
  name: string;
  department: string;
  type: string;
  capacity: number | null;
  stadiumZone: string | null;
  level: string | null;
  status: 'open' | 'restricted' | 'incident' | 'closed';
  suiteDetails?: {
    suiteNumber: string;
    suiteholder?: string;
    beoNumber?: string;
    beoPackageName?: string;
    tier?: string;
    hostName?: string;
    guestCount?: number;
    menuPackage?: string;
    attendantName?: string;
    replenishmentPending?: boolean;
    beoPreOrders?: BeoPreOrderItem[];
    inSuiteOrders?: InSuiteOrderItem[];
    inSeatOrders?: InSeatOrderItem[];
    hierarchy?: StaffHierarchy;
  };
  standDetails?: {
    standNumber: string;
    concept: string;
    terminalCount?: number;
    cashBeginningCents?: number;
    cashGrossCents?: number;
    lowStockItems?: string[];
    inSeatOrders?: InSeatOrderItem[];
    hierarchy?: StaffHierarchy;
  };
}

interface Props {
  visible: boolean;
  unit: StadiumZoneItem | null;
  onClose: () => void;
  onStatusChange?: (unitId: string, newStatus: StadiumZoneItem['status']) => void;
}

type ModalTab = 'hierarchy' | 'beo' | 'orders' | 'stand_metrics';

export function StadiumUnitDetailModal({ visible, unit, onClose, onStatusChange }: Props) {
  const palette = useDesignTheme();
  const { isPhone, height } = useResponsive();
  const [activeTab, setActiveTab] = useState<ModalTab>('hierarchy');

  if (!unit) return null;

  const isSuite = unit.type === 'premium_suite' || unit.type === 'premium_club' || unit.department === 'premium_hospitality';
  const isStand = unit.type === 'concession_stand' || unit.type === 'grab_and_go' || unit.type === 'kiosk' || unit.department === 'concessions' || unit.type === 'bar';

  const suiteDetails = unit.suiteDetails;
  const standDetails = unit.standDetails;

  const preOrders = suiteDetails?.beoPreOrders ?? [
    { id: 'po-1', name: 'Prime Rib Carving Station w/ Au Jus & Horseradish', quantity: 24, category: 'entree', status: 'delivered', scheduledTime: 'Kickoff - 30m', dietaryNotes: 'Accommodates 24 guests' },
    { id: 'po-2', name: 'Jumbo Gulf Shrimp Cocktail Platter', quantity: 2, category: 'appetizer', status: 'delivered', scheduledTime: 'Pre-Game', dietaryNotes: 'Contains Shellfish' },
    { id: 'po-3', name: 'Artisanal Truffle Mac & Vermont White Cheddar', quantity: 2, category: 'entree', status: 'active', scheduledTime: 'Kickoff' },
    { id: 'po-4', name: 'Dom Pérignon Vintage Champagne (3 btls)', quantity: 3, category: 'bar', status: 'delivered', scheduledTime: 'Pre-Game' },
    { id: 'po-5', name: 'Warm Soft Pretzels with Craft Beer Cheese', quantity: 24, category: 'appetizer', status: 'delivered', scheduledTime: 'Halftime' },
    { id: 'po-6', name: 'Executive Pastry Chef Grand Dessert Cart', quantity: 24, category: 'dessert', status: 'prepped', scheduledTime: 'Q3 Break', dietaryNotes: 'Includes Nut-Free assortment' },
  ];

  const inSuiteOrders = suiteDetails?.inSuiteOrders ?? [
    { id: 'iso-1', orderedAt: '1:15 PM (Q1 08:42)', orderedBy: 'Suite Host Tablet', items: '2x Casamigos Reposado Carafe, 1x Extra Ice Bucket', totalCents: 24000, status: 'fulfilled' },
    { id: 'iso-2', orderedAt: '1:48 PM (Q2 03:10)', orderedBy: 'Attendant Alice T.', items: '1x Crispy Hot Wings Platter (30ct), 4x Diet Coke', totalCents: 9500, status: 'delivering' },
  ];

  const inSeatOrders = suiteDetails?.inSeatOrders ?? standDetails?.inSeatOrders ?? [
    { id: 'seat-1', seatLocation: `${unit.name} · Seat 4A`, customerName: 'Marcus Sterling', orderedAt: '1:24 PM', items: '1x Double Smashburger, 1x Local Draft IPA', totalCents: 3200, status: 'delivered', runnerName: 'Runner Marcus C.' },
    { id: 'seat-2', seatLocation: `${unit.name} · Seat 4B`, customerName: 'David K.', orderedAt: '1:52 PM', items: '1x Loaded Helmet Nachos, 2x Sparkling Water', totalCents: 2800, status: 'fulfilling', runnerName: 'Runner Elena R.' },
  ];

  const hierarchy: StaffHierarchy = suiteDetails?.hierarchy ?? standDetails?.hierarchy ?? {
    director: { name: 'Eleanor Vance', title: 'VP of Premium Hospitality', radioChannel: 'Ch 1 - Exec' },
    manager: { name: 'Sarah Jenkins', title: 'Suite Operations Floor Manager', status: 'on_duty', radioChannel: 'Ch 4 - Suites' },
    assignedStaff: [
      { name: 'Alice Taylor', role: 'Lead Suite Attendant', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
      { name: 'Marcus Chen', role: 'Hospitality Runner', status: 'on_duty', shift: '11:00 - Close', geofenceVerified: true },
      { name: 'Elena Rostova', role: 'Private Bartender', status: 'on_duty', shift: '11:00 - Close', geofenceVerified: true },
    ],
  };

  const statusColor =
    unit.status === 'open' ? palette.success :
    unit.status === 'restricted' ? palette.warning :
    unit.status === 'incident' ? '#D32F2F' : palette.muted;

  const nextStatus: Record<StadiumZoneItem['status'], StadiumZoneItem['status']> = {
    open: 'restricted',
    restricted: 'incident',
    incident: 'closed',
    closed: 'open',
  };

  const handleOpenStandSheet = () => {
    onClose();
    router.push({
      pathname: '/stadium/stand-sheet',
      params: { standCode: unit.code, standName: unit.name },
    });
  };

  const handleOpenSuiteAttendant = () => {
    onClose();
    router.push({
      pathname: '/stadium/suite-attendant',
      params: { suiteId: unit.id, suiteCode: unit.code },
    });
  };

  const handleReportIssue = () => {
    onClose();
    router.push({
      pathname: '/event-issues',
      params: { outletId: unit.id, outletCode: unit.code },
    });
  };

  const sheetMaxHeight = isPhone ? Math.min(height * 0.92, height - 24) : undefined;

  return (
    <Modal visible={visible} transparent animationType={isPhone ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={[styles.backdrop, isPhone && styles.backdropPhone]}>
        <Pressable style={styles.dismissOverlay} onPress={onClose} />
        <View
          style={[
            styles.modalCard,
            { backgroundColor: '#FFFFFF', borderColor: palette.border },
            isPhone && {
              width: '100%',
              maxWidth: '100%',
              maxHeight: sheetMaxHeight,
              borderRadius: 16,
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              marginBottom: 0,
              paddingBottom: spacing.md,
            },
          ]}
        >
          {/* Header */}
          <View style={[styles.headerRow, { borderBottomColor: palette.divider }]}>
            <View style={styles.headerLeft}>
              <View style={[styles.iconPill, { backgroundColor: '#EEF5F0' }]}>
                <MaterialCommunityIcons
                  name={isSuite ? 'glass-cocktail' : isStand ? 'food-hot-dog' : 'storefront-outline'}
                  size={24}
                  color="#17643B"
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800' }}>
                    {unit.code}
                  </CommandText>
                  <StatusPill
                    palette={palette}
                    tone={unit.status === 'open' ? 'good' : unit.status === 'incident' ? 'danger' : 'warn'}
                  >
                    {unit.status.toUpperCase()}
                  </StatusPill>
                  {suiteDetails?.suiteholder ? (
                    <View style={styles.suiteholderBadge}>
                      <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '700' }}>
                        {suiteDetails.suiteholder}
                      </CommandText>
                    </View>
                  ) : null}
                </View>
                <CommandText palette={palette} variant="title" style={{ marginTop: 2, fontSize: isPhone ? 16 : 18 }}>
                  {unit.name}
                </CommandText>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}>
              <MaterialCommunityIcons name="close" size={24} color="#68706A" />
            </Pressable>
          </View>

          {/* Navigation Tab Bar */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.tabBar, { borderBottomColor: palette.divider }]} contentContainerStyle={{ gap: spacing.md, paddingHorizontal: 2 }}>
            <Pressable
              onPress={() => setActiveTab('hierarchy')}
              style={[styles.tabItem, activeTab === 'hierarchy' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
            >
              <MaterialCommunityIcons name="account-tie" size={16} color={activeTab === 'hierarchy' ? '#17643B' : '#68706A'} />
              <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'hierarchy' ? '#17643B' : '#68706A', fontWeight: activeTab === 'hierarchy' ? '700' : '500' }}>
                Hierarchy & Staff
              </CommandText>
            </Pressable>

            {isSuite ? (
              <Pressable
                onPress={() => setActiveTab('beo')}
                style={[styles.tabItem, activeTab === 'beo' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
              >
                <MaterialCommunityIcons name="silverware-fork-knife" size={16} color={activeTab === 'beo' ? '#17643B' : '#68706A'} />
                <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'beo' ? '#17643B' : '#68706A', fontWeight: activeTab === 'beo' ? '700' : '500' }}>
                  BEO Pre-Orders ({preOrders.length})
                </CommandText>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => setActiveTab('orders')}
              style={[styles.tabItem, activeTab === 'orders' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
            >
              <MaterialCommunityIcons name="seat-passenger" size={16} color={activeTab === 'orders' ? '#17643B' : '#68706A'} />
              <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'orders' ? '#17643B' : '#68706A', fontWeight: activeTab === 'orders' ? '700' : '500' }}>
                In-Seat & Suite Orders
              </CommandText>
            </Pressable>

            {isStand ? (
              <Pressable
                onPress={() => setActiveTab('stand_metrics')}
                style={[styles.tabItem, activeTab === 'stand_metrics' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
              >
                <MaterialCommunityIcons name="cash-register" size={16} color={activeTab === 'stand_metrics' ? '#17643B' : '#68706A'} />
                <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'stand_metrics' ? '#17643B' : '#68706A', fontWeight: activeTab === 'stand_metrics' ? '700' : '500' }}>
                  POS & Stock
                </CommandText>
              </Pressable>
            ) : null}
          </ScrollView>

          <ScrollView
            style={[styles.bodyScroll, isPhone && { maxHeight: Math.max(280, (sheetMaxHeight ?? 520) - 180) }]}
            contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.md }}
            showsVerticalScrollIndicator={false}
          >
            {/* Meta Tags */}
            <View style={styles.metaRow}>
              <View style={[styles.metaChip, { backgroundColor: '#F7F7F4', borderColor: palette.border }]}>
                <MaterialCommunityIcons name="map-marker-outline" size={14} color="#68706A" />
                <CommandText palette={palette} variant="caption">
                  {unit.stadiumZone || 'Main Concourse'} {unit.level ? `· Level ${unit.level}` : ''}
                </CommandText>
              </View>
              <View style={[styles.metaChip, { backgroundColor: '#F7F7F4', borderColor: palette.border }]}>
                <MaterialCommunityIcons name="tag-outline" size={14} color="#68706A" />
                <CommandText palette={palette} variant="caption">
                  {unit.department.replace(/_/g, ' ')}
                </CommandText>
              </View>
              {unit.capacity ? (
                <View style={[styles.metaChip, { backgroundColor: '#F7F7F4', borderColor: palette.border }]}>
                  <MaterialCommunityIcons name="account-multiple-outline" size={14} color="#68706A" />
                  <CommandText palette={palette} variant="caption">Cap: {unit.capacity}</CommandText>
                </View>
              ) : null}
            </View>

            {/* TAB 1: HIERARCHY & ASSIGNED STAFF */}
            {activeTab === 'hierarchy' ? (
              <View style={{ gap: spacing.md }}>
                {/* Suiteholder & Room Card */}
                {isSuite ? (
                  <View style={[styles.sectionCard, { backgroundColor: '#FDFBF7', borderColor: '#E5DFD5' }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <CommandText palette={palette} variant="label" style={{ color: '#8A5D23' }}>
                        SUITEHOLDER & RESERVATION DETAILS
                      </CommandText>
                      <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '700' }}>
                        {suiteDetails?.beoNumber ?? 'BEO-2026-904'}
                      </CommandText>
                    </View>
                    <View style={[styles.gridTwoCol, isPhone && { flexDirection: 'column' }]}>
                      <View style={styles.infoCol}>
                        <CommandText palette={palette} variant="caption">Suiteholder / Company</CommandText>
                        <CommandText palette={palette} variant="body" style={{ fontWeight: '700', color: '#1D2420' }}>
                          {suiteDetails?.suiteholder ?? 'Apex Global Holdings'}
                        </CommandText>
                      </View>
                      <View style={styles.infoCol}>
                        <CommandText palette={palette} variant="caption">Tier & Capacity</CommandText>
                        <CommandText palette={palette} variant="body" style={{ fontWeight: '700', color: '#1D2420' }}>
                          {suiteDetails?.tier ?? 'Presidential Luxury Suite'} ({suiteDetails?.guestCount ?? 24} guests)
                        </CommandText>
                      </View>
                    </View>
                    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingTop: spacing.xs }}>
                      <CommandText palette={palette} variant="caption">Assigned VIP Host / Lead</CommandText>
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '600' }}>
                        {suiteDetails?.hostName ?? 'Marcus Sterling (VP VIP Experience)'}
                      </CommandText>
                    </View>
                  </View>
                ) : null}

                {/* Organizational Hierarchy Card */}
                <View style={[styles.sectionCard, { backgroundColor: '#FFFFFF', borderColor: palette.border }]}>
                  <CommandText palette={palette} variant="label" style={{ color: '#17643B' }}>
                    ORGANIZATIONAL HIERARCHY & AREA ASSIGNMENTS
                  </CommandText>

                  {/* Level 1: Director */}
                  <View style={styles.hierarchyTier}>
                    <View style={styles.tierIconBox}>
                      <MaterialCommunityIcons name="shield-account" size={18} color="#17643B" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>Executive / Department Director</CommandText>
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '700', color: '#1D2420' }}>
                        {hierarchy.director.name} <CommandText palette={palette} variant="caption">({hierarchy.director.title})</CommandText>
                      </CommandText>
                      <CommandText palette={palette} variant="caption" style={{ color: '#17643B' }}>
                        Radio: {hierarchy.director.radioChannel}
                      </CommandText>
                    </View>
                  </View>

                  {/* Level 2: Manager / Floor Supervisor */}
                  <View style={styles.hierarchyTier}>
                    <View style={styles.tierIconBox}>
                      <MaterialCommunityIcons name="account-tie-hat" size={18} color="#A86514" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>Area Floor Manager / Supervisor</CommandText>
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '700', color: '#1D2420' }}>
                        {hierarchy.manager.name} <CommandText palette={palette} variant="caption">({hierarchy.manager.title})</CommandText>
                      </CommandText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <View style={[styles.liveDot, { backgroundColor: hierarchy.manager.status === 'on_duty' ? '#17643B' : '#A86514' }]} />
                        <CommandText palette={palette} variant="caption" style={{ color: '#1D2420', fontWeight: '600' }}>
                          {hierarchy.manager.status === 'on_duty' ? 'ON DUTY' : 'ON BREAK'} · Radio: {hierarchy.manager.radioChannel}
                        </CommandText>
                      </View>
                    </View>
                  </View>

                  {/* Level 3: Direct Assigned Staff */}
                  <View style={{ marginTop: spacing.xs, gap: spacing.xs }}>
                    <CommandText palette={palette} variant="caption" style={{ fontWeight: '700', color: '#68706A' }}>
                      ASSIGNED AREA STAFF ({hierarchy.assignedStaff.length})
                    </CommandText>
                    {hierarchy.assignedStaff.map((staff, idx) => (
                      <View key={idx} style={[styles.staffRow, { borderColor: palette.divider }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                          <MaterialCommunityIcons name="account-check" size={18} color="#17643B" />
                          <View style={{ flex: 1 }}>
                            <CommandText palette={palette} variant="body" style={{ fontWeight: '700', fontSize: 14 }}>
                              {staff.name}
                            </CommandText>
                            <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>
                              {staff.role} · Shift: {staff.shift}
                            </CommandText>
                          </View>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 2 }}>
                          <View style={styles.verifiedBadge}>
                            <MaterialCommunityIcons name="crosshairs-gps" size={12} color="#17643B" />
                            <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontSize: 11, fontWeight: '700' }}>
                              GEOFENCED
                            </CommandText>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            ) : null}

            {/* TAB 2: BEO PRE-ORDERS & MENU */}
            {activeTab === 'beo' && isSuite ? (
              <View style={{ gap: spacing.md }}>
                <View style={[styles.sectionCard, { backgroundColor: '#FDFBF7', borderColor: '#E5DFD5' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <CommandText palette={palette} variant="label" style={{ color: '#8A5D23' }}>
                      BEO MENU PACKAGE
                    </CommandText>
                    <StatusPill palette={palette} tone="good">BEO CONFIRMED</StatusPill>
                  </View>
                  <CommandText palette={palette} variant="title" style={{ fontSize: 16, marginTop: 2 }}>
                    {suiteDetails?.beoPackageName ?? 'Touchdown Luxury Banquet & Chilled Raw Bar'}
                  </CommandText>
                  <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>
                    Pre-ordered menu items prepped and dispatched by the Commissary Chef team.
                  </CommandText>
                </View>

                <View style={{ gap: spacing.xs }}>
                  <CommandText palette={palette} variant="label" style={{ color: '#17643B' }}>
                    PRE-ORDERED ITEMS & FULFILLMENT
                  </CommandText>
                  {preOrders.map((item) => (
                    <View key={item.id} style={[styles.orderItemCard, { borderColor: palette.divider }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <View style={{ flex: 1, paddingRight: spacing.sm }}>
                          <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
                            {item.quantity}x {item.name}
                          </CommandText>
                          {item.scheduledTime ? (
                            <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>
                              Schedule: {item.scheduledTime}
                            </CommandText>
                          ) : null}
                          {item.dietaryNotes ? (
                            <View style={styles.dietaryChip}>
                              <MaterialCommunityIcons name="alert-circle-outline" size={12} color="#A86514" />
                              <CommandText palette={palette} variant="caption" style={{ color: '#A86514', fontSize: 11, fontWeight: '600' }}>
                                {item.dietaryNotes}
                              </CommandText>
                            </View>
                          ) : null}
                        </View>
                        <View style={[
                          styles.fulfillmentBadge,
                          item.status === 'delivered' ? { backgroundColor: '#EEF5F0', borderColor: '#17643B' } :
                          item.status === 'prepped' ? { backgroundColor: '#FFF4DE', borderColor: '#A86514' } :
                          { backgroundColor: '#EEF3F7', borderColor: '#4A6678' }
                        ]}>
                          <CommandText palette={palette} variant="caption" style={{
                            fontWeight: '700',
                            fontSize: 11,
                            color: item.status === 'delivered' ? '#17643B' : item.status === 'prepped' ? '#A86514' : '#4A6678',
                          }}>
                            {item.status.toUpperCase()}
                          </CommandText>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* TAB 3: IN-SUITE & IN-SEAT LIVE ORDERS */}
            {activeTab === 'orders' ? (
              <View style={{ gap: spacing.md }}>
                {/* In-Seat Mobile Orders */}
                <View style={{ gap: spacing.xs }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <CommandText palette={palette} variant="label" style={{ color: '#17643B' }}>
                      IN-SEAT FAN MOBILE ORDERS
                    </CommandText>
                    <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>
                      {inSeatOrders.length} active
                    </CommandText>
                  </View>

                  {inSeatOrders.map((seatOrder) => (
                    <View key={seatOrder.id} style={[styles.orderItemCard, { borderColor: palette.divider }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                          <MaterialCommunityIcons name="seat-passenger" size={16} color="#17643B" />
                          <CommandText palette={palette} variant="body" style={{ fontWeight: '700', flexShrink: 1 }}>
                            {seatOrder.seatLocation}
                          </CommandText>
                        </View>
                        <StatusPill palette={palette} tone={seatOrder.status === 'delivered' ? 'good' : 'warn'}>
                          {seatOrder.status.toUpperCase()}
                        </StatusPill>
                      </View>
                      <CommandText palette={palette} variant="body" style={{ marginTop: 4, color: '#1D2420' }}>
                        {seatOrder.items}
                      </CommandText>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, flexWrap: 'wrap', gap: 4 }}>
                        <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>
                          Customer: {seatOrder.customerName} · Ordered at {seatOrder.orderedAt}
                        </CommandText>
                        <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '700' }}>
                          {seatOrder.runnerName ?? 'Runner Assigned'}
                        </CommandText>
                      </View>
                    </View>
                  ))}
                </View>

                {/* In-Suite Live Orders */}
                {isSuite ? (
                  <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
                    <CommandText palette={palette} variant="label" style={{ color: '#17643B' }}>
                      LIVE IN-SUITE ORDERS
                    </CommandText>
                    {inSuiteOrders.map((order) => (
                      <View key={order.id} style={[styles.orderItemCard, { borderColor: palette.divider }]}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <CommandText palette={palette} variant="caption" style={{ color: '#68706A', flex: 1 }}>
                            Ordered: {order.orderedAt} by {order.orderedBy}
                          </CommandText>
                          <StatusPill palette={palette} tone={order.status === 'fulfilled' ? 'good' : 'warn'}>
                            {order.status.toUpperCase()}
                          </StatusPill>
                        </View>
                        <CommandText palette={palette} variant="body" style={{ fontWeight: '700', marginTop: 4 }}>
                          {order.items}
                        </CommandText>
                        <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '700', marginTop: 2 }}>
                          Total: ${(order.totalCents / 100).toFixed(2)}
                        </CommandText>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* TAB 4: CONCESSION STAND POS & METRICS */}
            {activeTab === 'stand_metrics' && isStand ? (
              <View style={{ gap: spacing.md }}>
                <View style={[styles.sectionCard, { backgroundColor: '#FDFBF7', borderColor: '#E5DFD5' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                    <CommandText palette={palette} variant="label" style={{ color: '#8A5D23' }}>
                      CONCESSION STAND POS METRICS
                    </CommandText>
                    <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '700' }}>
                      {standDetails?.terminalCount ?? 6} Terminals Active
                    </CommandText>
                  </View>
                  <View style={[styles.gridTwoCol, isPhone && { flexDirection: 'column' }]}>
                    <View style={styles.infoCol}>
                      <CommandText palette={palette} variant="caption">Beginning Cash Float</CommandText>
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
                        ${((standDetails?.cashBeginningCents ?? 150000) / 100).toFixed(2)}
                      </CommandText>
                    </View>
                    <View style={styles.infoCol}>
                      <CommandText palette={palette} variant="caption">Gross Stand Sales</CommandText>
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '700', color: '#17643B' }}>
                        ${((standDetails?.cashGrossCents ?? 1120000) / 100).toFixed(2)}
                      </CommandText>
                    </View>
                  </View>
                  {standDetails?.lowStockItems?.length ? (
                    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingTop: spacing.xs, gap: 2 }}>
                      <CommandText palette={palette} variant="caption" style={{ color: '#D32F2F', fontWeight: '700' }}>
                        Stock Replenishment Warning ({standDetails.lowStockItems.length} items low par)
                      </CommandText>
                      <CommandText palette={palette} variant="body" style={{ fontSize: 13 }}>
                        {standDetails.lowStockItems.join(', ')}
                      </CommandText>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Fast Operational Controls */}
            <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
              <CommandText palette={palette} variant="label" style={{ color: '#68706A' }}>UNIT STATUS CONTROL</CommandText>
              <Pressable
                onPress={() => onStatusChange?.(unit.id, nextStatus[unit.status])}
                style={[styles.statusActionButton, { borderColor: statusColor, backgroundColor: '#FFFFFF' }]}
              >
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <CommandText palette={palette} variant="body" style={{ fontWeight: '700', color: '#1D2420', flex: 1 }}>
                  Status: {unit.status.toUpperCase()} (Tap to toggle status)
                </CommandText>
              </Pressable>
            </View>
          </ScrollView>

          {/* Action Footer */}
          <View style={[styles.footerRow, { borderTopColor: palette.divider }, isPhone && { flexWrap: 'wrap' }]}>
            {isStand ? (
              <CommandButton palette={palette} icon="clipboard-list-outline" selected onPress={handleOpenStandSheet} style={{ flex: 1, minWidth: isPhone ? 140 : undefined }}>
                Stand Sheet
              </CommandButton>
            ) : null}
            {isSuite ? (
              <CommandButton palette={palette} icon="room-service-outline" selected onPress={handleOpenSuiteAttendant} style={{ flex: 1, minWidth: isPhone ? 140 : undefined }}>
                Suite Attendant
              </CommandButton>
            ) : null}
            <CommandButton palette={palette} icon="alert-outline" onPress={handleReportIssue} style={{ flex: 1, minWidth: isPhone ? 140 : undefined }}>
              Log Issue
            </CommandButton>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  backdropPhone: {
    justifyContent: 'flex-end',
    alignItems: 'stretch',
    padding: 0,
  },
  dismissOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalCard: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '90%',
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  iconPill: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suiteholderBadge: {
    backgroundColor: '#EEF5F0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tabBar: {
    borderBottomWidth: 1,
    paddingTop: spacing.xs,
    flexGrow: 0,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  bodyScroll: {
    maxHeight: 520,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  sectionCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  gridTwoCol: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: 2,
  },
  infoCol: {
    flex: 1,
    gap: 2,
  },
  hierarchyTier: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E8E2',
  },
  tierIconBox: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#EEF5F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  staffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.xs,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: '#F7F7F4',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EEF5F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  orderItemCard: {
    borderRadius: 6,
    borderWidth: 1,
    padding: spacing.sm,
    backgroundColor: '#FAFAF8',
    gap: 2,
  },
  dietaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF4DE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  fulfillmentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  statusActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  footerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
  },
});
