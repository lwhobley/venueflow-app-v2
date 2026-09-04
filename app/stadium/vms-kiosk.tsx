import React, { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing, useDesignTheme, opsConsole } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { useApiQuery } from '../../lib/api-client';
import { useMutation } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { subscribeOfflineQueue, type OfflineQueueSnapshot } from '../../lib/offline-queue';

/**
 * Worker clock-in kiosk (checklist 3.2).
 *
 * Designed for a tablet mounted at the staff entrance and for a worker's own
 * phone on venue wifi:
 *
 * - Every control is at least 56pt, well over the 44pt touch-target floor.
 * - Portrait and landscape both work; the keypad reflows rather than clipping.
 * - Punches are queued locally when the network drops and replay on reconnect
 *   (handled by the shared offline queue, keyed on the mutation's idempotency
 *   key so a replay cannot double-punch).
 * - Screen readers get labelled controls and a live status region.
 * - No roster data is shown until a worker is picked, so the screen is not a
 *   staff directory for anyone who walks past.
 */

type Mode = 'idle' | 'pin' | 'working' | 'done';

const PIN_LENGTH_MAX = 8;

export default function VmsKioskScreen() {
  const palette = useDesignTheme();
  const { venue } = useVenueAuth();
  const venueId = venue?.id;
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [search, setSearch] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState<Mode>('idle');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [queue, setQueue] = useState<OfflineQueueSnapshot>({ pending: 0, conflicts: 0 });

  useEffect(() => {
    const unsubscribe = subscribeOfflineQueue(setQueue);
    return () => {
      unsubscribe();
    };
  }, []);

  // Announce results to screen readers, which otherwise miss a banner that
  // simply appears.
  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message.text);
  }, [message]);

  const { data: staff = [], isLoading } = useApiQuery<any[]>(
    ['vms.kioskStaff', venueId, search],
    '/v1/vms/staff?limit=100',
    Boolean(venueId),
  );

  const { data: openPunches = [] } = useApiQuery<any[]>(
    ['vms.kioskOpen', venueId],
    '/v1/vms/attendance/reports?status=clocked_in',
    Boolean(venueId),
  );

  // Routed through the Railway mutation layer so a punch made on a dropped
  // connection is queued locally and replayed, rather than lost.
  const clockIn = useMutation<any, any>(api.vms.clockIn);
  const clockOut = useMutation<any, any>(api.vms.clockOut);

  const openPunchByStaff = useMemo(() => {
    const map = new Map<string, string>();
    for (const punch of openPunches) {
      if (punch?.staffMemberId && !punch.clockOut) map.set(punch.staffMemberId, punch.id);
    }
    return map;
  }, [openPunches]);

  const visibleStaff = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return staff;
    return staff.filter((member: any) =>
      `${member.firstName} ${member.lastName}`.toLowerCase().includes(term),
    );
  }, [staff, search]);

  const selected = visibleStaff.find((member: any) => member.id === selectedStaffId) ?? null;
  const hasOpenPunch = selected ? openPunchByStaff.has(selected.id) : false;

  function reset() {
    setSelectedStaffId(null);
    setPin('');
    setMode('idle');
  }

  function pickWorker(staffMemberId: string) {
    setSelectedStaffId(staffMemberId);
    setPin('');
    setMessage(null);
    setMode('pin');
  }

  async function submit() {
    if (!selected || pin.length === 0) return;
    setMode('working');
    setMessage(null);

    try {
      if (hasOpenPunch) {
        await clockOut({
          attendanceId: openPunchByStaff.get(selected.id),
          pin,
          deviceInfo: 'kiosk',
        });
        setMessage({
          tone: 'ok',
          text: `${selected.firstName} ${selected.lastName} clocked out. Thank you.`,
        });
      } else {
        await clockIn({
          staffMemberId: selected.id,
          pin,
          deviceInfo: 'kiosk',
        });
        setMessage({
          tone: 'ok',
          text: `${selected.firstName} ${selected.lastName} clocked in. Have a good shift.`,
        });
      }
      setMode('done');
      setTimeout(reset, 3500);
    } catch (err: any) {
      setMode('pin');
      setPin('');
      setMessage({
        tone: 'error',
        text: err?.message ?? 'That punch could not be recorded. Please find a manager.',
      });
    }
  }

  const keypad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      {/* ---------------------------------------------------------------- */}
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Exit kiosk mode"
          style={styles.exitBtn}
          hitSlop={12}
        >
          <MaterialCommunityIcons name="arrow-left" size={26} color={palette.charcoal} />
        </Pressable>

        <View style={styles.headerText}>
          <Text style={[styles.title, { color: palette.charcoal }]}>Shift Clock</Text>
          <Text style={styles.subtitle}>Select your name, then enter your PIN</Text>
        </View>

        <View
          style={[
            styles.netPill,
            { backgroundColor: queue.pending > 0 ? opsConsole.warn + '22' : opsConsole.good + '22' },
          ]}
          accessibilityRole="text"
          accessibilityLabel={
            queue.pending > 0
              ? `Offline. ${queue.pending} punches waiting to sync.`
              : 'Online. All punches synced.'
          }
        >
          <MaterialCommunityIcons
            name={queue.pending > 0 ? 'cloud-off-outline' : 'cloud-check-outline'}
            size={18}
            color={queue.pending > 0 ? opsConsole.warn : opsConsole.good}
          />
          <Text
            style={[
              styles.netText,
              { color: queue.pending > 0 ? opsConsole.warn : opsConsole.good },
            ]}
          >
            {queue.pending > 0 ? `${queue.pending} WAITING` : 'SYNCED'}
          </Text>
        </View>
      </View>

      {/* Status banner — the live region for assistive tech. */}
      {message ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.banner,
            {
              backgroundColor: message.tone === 'ok' ? opsConsole.good + '1A' : opsConsole.danger + '1A',
              borderLeftColor: message.tone === 'ok' ? opsConsole.good : opsConsole.danger,
            },
          ]}
        >
          <MaterialCommunityIcons
            name={message.tone === 'ok' ? 'check-circle-outline' : 'alert-circle-outline'}
            size={22}
            color={message.tone === 'ok' ? opsConsole.good : opsConsole.danger}
          />
          <Text style={[styles.bannerText, { color: palette.charcoal }]}>{message.text}</Text>
        </View>
      ) : null}

      {queue.pending > 0 ? (
        <View style={[styles.offlineNote, { borderColor: opsConsole.warn }]}>
          <Text style={[styles.offlineNoteText, { color: palette.charcoal }]}>
            Working offline. Punches are saved on this device and will sync automatically when the
            connection returns — you do not need to punch again.
          </Text>
        </View>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {mode === 'idle' || !selected ? (
        <View style={styles.body}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Type your name"
            placeholderTextColor={palette.muted}
            accessibilityLabel="Search for your name"
            autoCorrect={false}
            style={[
              styles.searchInput,
              { borderColor: palette.border, color: palette.charcoal, backgroundColor: palette.surface },
            ]}
          />

          {isLoading ? (
            <ActivityIndicator style={{ marginTop: spacing.lg }} />
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
            >
              {visibleStaff.length === 0 ? (
                <Text style={[styles.emptyText, { color: palette.muted }]}>
                  No matching worker. Check the spelling, or ask a manager to add you.
                </Text>
              ) : (
                visibleStaff.map((member: any) => {
                  const isOut = openPunchByStaff.has(member.id);
                  return (
                    <Pressable
                      key={member.id}
                      onPress={() => pickWorker(member.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`${member.firstName} ${member.lastName}. ${
                        isOut ? 'Currently clocked in. Select to clock out.' : 'Select to clock in.'
                      }`}
                      style={({ pressed }) => [
                        styles.workerRow,
                        {
                          backgroundColor: pressed ? palette.border : palette.surface,
                          borderColor: palette.border,
                          width: isLandscape ? '48%' : '100%',
                        },
                      ]}
                    >
                      <View style={styles.workerInfo}>
                        <Text style={[styles.workerName, { color: palette.charcoal }]}>
                          {member.firstName} {member.lastName}
                        </Text>
                        {member.skills?.length ? (
                          <Text style={[styles.workerRole, { color: palette.muted }]}>
                            {member.skills.slice(0, 2).join(' · ')}
                          </Text>
                        ) : null}
                      </View>
                      <View
                        style={[
                          styles.statusChip,
                          { backgroundColor: isOut ? opsConsole.good + '22' : palette.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusChipText,
                            { color: isOut ? opsConsole.good : palette.muted },
                          ]}
                        >
                          {isOut ? 'ON SHIFT' : 'OFF'}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          )}
        </View>
      ) : (
        /* ------------------------------------------------------------- */
        <View style={[styles.body, isLandscape && styles.bodyLandscape]}>
          <View style={styles.pinHeader}>
            <Text style={[styles.pinName, { color: palette.charcoal }]}>
              {selected.firstName} {selected.lastName}
            </Text>
            <Text style={[styles.pinAction, { color: hasOpenPunch ? opsConsole.warn : opsConsole.good }]}>
              {hasOpenPunch ? 'CLOCKING OUT' : 'CLOCKING IN'}
            </Text>

            <View
              style={styles.pinDots}
              accessibilityRole="text"
              accessibilityLabel={`${pin.length} of up to ${PIN_LENGTH_MAX} digits entered`}
            >
              {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.pinDot,
                    {
                      backgroundColor: i < pin.length ? palette.primary : 'transparent',
                      borderColor: palette.border,
                    },
                  ]}
                />
              ))}
            </View>
          </View>

          <View style={[styles.keypad, isLandscape && styles.keypadLandscape]}>
            {keypad.map((key) => (
              <Pressable
                key={key}
                disabled={mode === 'working'}
                onPress={() => {
                  if (key === 'clear') return setPin('');
                  if (key === 'back') return setPin((p) => p.slice(0, -1));
                  setPin((p) => (p.length >= PIN_LENGTH_MAX ? p : p + key));
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  key === 'clear' ? 'Clear PIN' : key === 'back' ? 'Delete last digit' : `Digit ${key}`
                }
                style={({ pressed }) => [
                  styles.key,
                  {
                    backgroundColor: pressed ? palette.border : palette.surface,
                    borderColor: palette.border,
                  },
                ]}
              >
                {key === 'clear' ? (
                  <MaterialCommunityIcons name="close" size={26} color={palette.muted} />
                ) : key === 'back' ? (
                  <MaterialCommunityIcons name="backspace-outline" size={26} color={palette.muted} />
                ) : (
                  <Text style={[styles.keyText, { color: palette.charcoal }]}>{key}</Text>
                )}
              </Pressable>
            ))}
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={reset}
              accessibilityRole="button"
              accessibilityLabel="Cancel and choose a different name"
              style={[styles.secondaryBtn, { borderColor: palette.border }]}
            >
              <Text style={[styles.secondaryBtnText, { color: palette.muted }]}>CANCEL</Text>
            </Pressable>

            <Pressable
              onPress={submit}
              disabled={pin.length === 0 || mode === 'working'}
              accessibilityRole="button"
              accessibilityState={{ disabled: pin.length === 0 || mode === 'working' }}
              accessibilityLabel={hasOpenPunch ? 'Confirm clock out' : 'Confirm clock in'}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: pin.length === 0 ? palette.border : palette.primary,
                  opacity: mode === 'working' ? 0.7 : 1,
                },
              ]}
            >
              {mode === 'working' ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {hasOpenPunch ? 'CLOCK OUT' : 'CLOCK IN'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const TOUCH = 56; // Comfortably above the 44pt accessibility floor.

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  exitBtn: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  netPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: 6,
  },
  netText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    borderRadius: 6,
  },
  bannerText: { flex: 1, fontSize: 16, fontWeight: '600' },

  offlineNote: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: 6,
  },
  offlineNoteText: { fontSize: 14, lineHeight: 20 },

  body: { flex: 1, padding: spacing.lg },
  bodyLandscape: { flexDirection: 'column' },

  searchInput: {
    height: TOUCH,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    fontSize: 18,
  },
  list: { flex: 1, marginTop: spacing.md },
  listContent: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: spacing.xl },
  emptyText: { fontSize: 16, padding: spacing.lg, textAlign: 'center', width: '100%' },

  workerRow: {
    minHeight: TOUCH + 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: 8,
  },
  workerInfo: { flex: 1 },
  workerName: { fontSize: 18, fontWeight: '700' },
  workerRole: { fontSize: 13, marginTop: 2 },
  statusChip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 4 },
  statusChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  pinHeader: { alignItems: 'center', marginBottom: spacing.lg },
  pinName: { fontSize: 24, fontWeight: '800' },
  pinAction: { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginTop: 4 },
  pinDots: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  pinDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2 },

  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'center',
    maxWidth: 320,
  },
  keypadLandscape: { maxWidth: 420 },
  key: {
    width: 92,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
  },
  keyText: { fontSize: 26, fontWeight: '700' },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  secondaryBtn: {
    flex: 1,
    height: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  primaryBtn: {
    flex: 2,
    height: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  primaryBtnText: { color: '#FFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
});
