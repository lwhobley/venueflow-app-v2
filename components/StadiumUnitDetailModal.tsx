import { router } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandButton, CommandText, StatusPill } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';

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
    beoNumber?: string;
    tier?: string;
    hostName?: string;
    guestCount?: number;
    menuPackage?: string;
    attendantName?: string;
    replenishmentPending?: boolean;
  };
  standDetails?: {
    standNumber: string;
    concept: string;
    terminalCount?: number;
    cashBeginningCents?: number;
    cashGrossCents?: number;
    lowStockItems?: string[];
  };
}

interface Props {
  visible: boolean;
  unit: StadiumZoneItem | null;
  onClose: () => void;
  onStatusChange?: (unitId: string, newStatus: StadiumZoneItem['status']) => void;
}

export function StadiumUnitDetailModal({ visible, unit, onClose, onStatusChange }: Props) {
  const palette = useDesignTheme();

  if (!unit) return null;

  const isSuite = unit.type === 'premium_suite' || unit.type === 'premium_club' || unit.department === 'premium_hospitality';
  const isStand = unit.type === 'concession_stand' || unit.type === 'grab_and_go' || unit.type === 'kiosk' || unit.department === 'concessions';

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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissOverlay} onPress={onClose} />
        <View style={[styles.modalCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {/* Header */}
          <View style={[styles.headerRow, { borderBottomColor: palette.divider }]}>
            <View style={styles.headerLeft}>
              <View style={[styles.iconPill, { backgroundColor: '#F4EFE6' }]}>
                <MaterialCommunityIcons
                  name={isSuite ? 'glass-cocktail' : isStand ? 'food-hot-dog' : 'storefront-outline'}
                  size={24}
                  color="#074426"
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <CommandText palette={palette} variant="label" style={{ color: '#074426' }}>
                    {unit.code}
                  </CommandText>
                  <StatusPill
                    palette={palette}
                    tone={unit.status === 'open' ? 'good' : unit.status === 'incident' ? 'danger' : 'warn'}
                  >
                    {unit.status.toUpperCase()}
                  </StatusPill>
                </View>
                <CommandText palette={palette} variant="title" style={{ marginTop: 2 }}>
                  {unit.name}
                </CommandText>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <MaterialCommunityIcons name="close" size={24} color={palette.muted} />
            </Pressable>
          </View>

          <ScrollView style={styles.bodyScroll} contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.md }}>
            {/* Meta Tags */}
            <View style={styles.metaRow}>
              <View style={[styles.metaChip, { backgroundColor: palette.background, borderColor: palette.border }]}>
                <MaterialCommunityIcons name="map-marker-outline" size={14} color={palette.muted} />
                <CommandText palette={palette} variant="caption">
                  {unit.stadiumZone || 'Main Concourse'} {unit.level ? `· Level ${unit.level}` : ''}
                </CommandText>
              </View>
              <View style={[styles.metaChip, { backgroundColor: palette.background, borderColor: palette.border }]}>
                <MaterialCommunityIcons name="tag-outline" size={14} color={palette.muted} />
                <CommandText palette={palette} variant="caption">
                  {unit.department.replace('_', ' ')}
                </CommandText>
              </View>
              {unit.capacity ? (
                <View style={[styles.metaChip, { backgroundColor: palette.background, borderColor: palette.border }]}>
                  <MaterialCommunityIcons name="account-multiple-outline" size={14} color={palette.muted} />
                  <CommandText palette={palette} variant="caption">Cap: {unit.capacity}</CommandText>
                </View>
              ) : null}
            </View>

            {/* Suite Specific Details */}
            {isSuite ? (
              <View style={[styles.sectionCard, { backgroundColor: '#FAF7F0', borderColor: palette.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <CommandText palette={palette} variant="label" style={{ color: '#7A5A35' }}>
                    LUXURY SUITE HOSPITALITY
                  </CommandText>
                  <CommandText palette={palette} variant="caption" style={{ color: '#074426', fontWeight: '700' }}>
                    {unit.suiteDetails?.beoNumber ?? 'BEO #2026-904'}
                  </CommandText>
                </View>
                <View style={styles.gridTwoCol}>
                  <View style={styles.infoCol}>
                    <CommandText palette={palette} variant="caption">Host / Account</CommandText>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
                      {unit.suiteDetails?.hostName ?? 'Apex Partners VIP'}
                    </CommandText>
                  </View>
                  <View style={styles.infoCol}>
                    <CommandText palette={palette} variant="caption">Attendant Assigned</CommandText>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
                      {unit.suiteDetails?.attendantName ?? 'Sarah Jenkins (Lead)'}
                    </CommandText>
                  </View>
                </View>
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingTop: spacing.xs, gap: 2 }}>
                  <CommandText palette={palette} variant="caption">Catering Package</CommandText>
                  <CommandText palette={palette} variant="body" style={{ fontWeight: '600' }}>
                    {unit.suiteDetails?.menuPackage ?? 'Prime Rib carving board, artisanal sliders, premium open bar'}
                  </CommandText>
                </View>
              </View>
            ) : null}

            {/* Concession Stand Specific Details */}
            {isStand ? (
              <View style={[styles.sectionCard, { backgroundColor: '#FAF7F0', borderColor: palette.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <CommandText palette={palette} variant="label" style={{ color: '#7A5A35' }}>
                    CONCESSION STAND METRICS
                  </CommandText>
                  <CommandText palette={palette} variant="caption" style={{ color: '#074426', fontWeight: '700' }}>
                    {unit.standDetails?.terminalCount ?? 4} Terminals Active
                  </CommandText>
                </View>
                <View style={styles.gridTwoCol}>
                  <View style={styles.infoCol}>
                    <CommandText palette={palette} variant="caption">Beginning Float</CommandText>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
                      ${((unit.standDetails?.cashBeginningCents ?? 120000) / 100).toFixed(2)}
                    </CommandText>
                  </View>
                  <View style={styles.infoCol}>
                    <CommandText palette={palette} variant="caption">Gross Concession Sales</CommandText>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '700', color: palette.success }}>
                      ${((unit.standDetails?.cashGrossCents ?? 845000) / 100).toFixed(2)}
                    </CommandText>
                  </View>
                </View>
                {unit.standDetails?.lowStockItems?.length ? (
                  <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingTop: spacing.xs, gap: 2 }}>
                    <CommandText palette={palette} variant="caption" style={{ color: '#D32F2F', fontWeight: '700' }}>
                      Stock Alert ({unit.standDetails.lowStockItems.length} items low par)
                    </CommandText>
                    <CommandText palette={palette} variant="body" style={{ fontSize: 13 }}>
                      {unit.standDetails.lowStockItems.join(', ')}
                    </CommandText>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Fast Operational Controls */}
            <View style={{ gap: spacing.xs }}>
              <CommandText palette={palette} variant="label">UNIT STATUS CONTROL</CommandText>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Pressable
                  onPress={() => onStatusChange?.(unit.id, nextStatus[unit.status])}
                  style={[styles.statusActionButton, { borderColor: statusColor, backgroundColor: palette.surface }]}
                >
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
                    Status: {unit.status.toUpperCase()} (Tap to change)
                  </CommandText>
                </Pressable>
              </View>
            </View>
          </ScrollView>

          {/* Action Footer */}
          <View style={[styles.footerRow, { borderTopColor: palette.divider }]}>
            {isStand ? (
              <CommandButton palette={palette} icon="clipboard-list-outline" selected onPress={handleOpenStandSheet} style={{ flex: 1 }}>
                Stand Sheet
              </CommandButton>
            ) : null}
            {isSuite ? (
              <CommandButton palette={palette} icon="room-service-outline" selected onPress={handleOpenSuiteAttendant} style={{ flex: 1 }}>
                Suite Attendant
              </CommandButton>
            ) : null}
            <CommandButton palette={palette} icon="alert-outline" onPress={handleReportIssue} style={{ flex: 1 }}>
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
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
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
    maxWidth: 540,
    maxHeight: '85%',
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.lg,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  iconPill: {
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bodyScroll: {
    flexGrow: 0,
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
    padding: spacing.md,
    gap: spacing.sm,
  },
  gridTwoCol: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  infoCol: {
    flex: 1,
    gap: 2,
  },
  statusActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 6,
    borderWidth: 1.5,
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  footerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
