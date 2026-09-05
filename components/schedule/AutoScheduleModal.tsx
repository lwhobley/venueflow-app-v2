import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Divider, Menu, Modal, Portal, Text } from 'react-native-paper';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { colors, spacing } from '../../lib/theme';
import { asArray } from '../../lib/format';

type StaffOption = { _id: Id<'profiles'>; fullName: string; jobTitle: string; role: string; weeklyHours: number };

const reasonLabel: Record<string, string> = {
  assigned: 'Proposed',
  no_role_match: 'No matching role',
  no_availability: 'Blocked by unavailable-day requests',
  all_double_booked: 'All candidates busy',
  labor_cap: 'Over labor budget',
  time_off: 'On approved time off',
};

// The Sunday (day index 0) of the current week, as YYYY-MM-DD in local time.
// Used to map calendar-date time-off onto the week being scheduled.
function currentWeekSundayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AutoScheduleModal({
  venueId,
  weekStartDate: selectedWeekStart,
  visible,
  onClose,
  onApplied,
  staff,
}: {
  venueId: Id<'venues'>;
  weekStartDate: string;
  visible: boolean;
  onClose: () => void;
  onApplied: (msg: string) => void;
  staff: StaffOption[];
}) {
  const [weekStartDate, setWeekStartDate] = useState(selectedWeekStart || currentWeekSundayISO);
  const preview = useQuery(api.scheduling.previewAutoSchedule, visible ? { venueId, weekStartDate } : 'skip');
  const applyAutoSchedule = useMutation(api.scheduling.applyAutoSchedule);

  // shiftId -> chosen profileId ('' = leave open). Seeded from the engine's
  // proposals when the preview loads; the manager can override any row.
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setWeekStartDate(selectedWeekStart || currentWeekSundayISO());
  }, [selectedWeekStart, visible]);

  useEffect(() => {
    if (!preview) return;
    const seed: Record<string, string> = {};
    for (const p of asArray(preview.proposals) as any[]) seed[p.shiftId] = p.profileId ?? '';
    setChoice(seed);
  }, [preview]);

  const nameById = useMemo(() => new Map(staff.map((s) => [s._id as string, s.fullName])), [staff]);
  const chosenCount = Object.values(choice).filter(Boolean).length;

  const apply = async () => {
    const assignments = Object.entries(choice)
      .filter(([, profileId]) => Boolean(profileId))
      .map(([shiftId, profileId]) => ({ shiftId: shiftId as Id<'scheduleShifts'>, profileId: profileId as Id<'profiles'> }));
    if (assignments.length === 0) {
      onApplied('Nothing selected to assign.');
      onClose();
      return;
    }
    setBusy(true);
    try {
      const r = await applyAutoSchedule({ venueId, weekStartDate: preview?.weekStart ?? weekStartDate, assignments });
      onApplied(`Auto-scheduled ${r.assigned} shift${r.assigned === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped}` : ''}.`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onClose} contentContainerStyle={{ margin: spacing.lg }}>
        <Card style={{ backgroundColor: colors.surface, borderRadius: 14, maxHeight: '88%' }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="titleLarge" style={{ fontWeight: '800', color: colors.primary }}>Auto-schedule</Text>
              <Button compact mode="text" textColor={colors.muted} onPress={onClose}>Close</Button>
            </View>

            {preview === undefined ? (
              <Text style={{ color: colors.muted }}>Building proposals…</Text>
            ) : preview.openCount === 0 ? (
              <Text style={{ color: colors.muted }}>No open shifts to fill. Add open shifts first, then auto-schedule.</Text>
            ) : (
              <>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  Matched {preview.filled} of {preview.openCount} open shifts by role, approved unavailable days, and labor budget. Review and commit.
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <Chip compact style={{ backgroundColor: '#E1FBF3' }}>{preview.filled} matched</Chip>
                  {preview.unfilled > 0 ? <Chip compact style={{ backgroundColor: '#FDE7E9' }}>{preview.unfilled} unfilled</Chip> : null}
                  <Chip compact style={{ backgroundColor: colors.cream }}>{chosenCount} selected</Chip>
                </View>
                <Divider />
                <ScrollView style={{ maxHeight: 420 }}>
                  <View style={{ gap: 8 }}>
                    {(asArray(preview.proposals) as any[]).map((p) => {
                      const chosen = choice[p.shiftId] ?? '';
                      const unfilled = !p.profileId;
                      return (
                        <View
                          key={p.shiftId}
                          style={{
                            padding: spacing.sm,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: chosen ? colors.border : '#F1C7CB',
                            backgroundColor: chosen ? colors.background : '#FDF2F3',
                            gap: 6,
                          }}
                        >
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontWeight: '800', color: colors.charcoal }}>
                                {p.dayLabel} {p.startTime}–{p.endTime}
                              </Text>
                              <Text style={{ color: colors.muted, fontSize: 12 }}>{p.jobTitle}</Text>
                            </View>
                            {!chosen && unfilled ? (
                              <Chip compact style={{ backgroundColor: '#FDE7E9' }} textStyle={{ color: colors.danger, fontSize: 11 }}>
                                {reasonLabel[p.reason] ?? 'Unfilled'}
                              </Chip>
                            ) : null}
                          </View>
                          <Menu
                            visible={menuFor === p.shiftId}
                            onDismiss={() => setMenuFor(null)}
                            anchor={
                              <Button
                                compact
                                mode={chosen ? 'contained' : 'outlined'}
                                buttonColor={chosen ? colors.primary : undefined}
                                textColor={chosen ? '#fff' : colors.primary}
                                icon={chosen ? 'account-check' : 'account-plus'}
                                onPress={() => setMenuFor(p.shiftId)}
                              >
                                {chosen ? nameById.get(chosen) ?? 'Assigned' : 'Assign someone'}
                              </Button>
                            }
                          >
                            <Menu.Item
                              title="Leave open"
                              leadingIcon="close"
                              onPress={() => { setChoice((c) => ({ ...c, [p.shiftId]: '' })); setMenuFor(null); }}
                            />
                            <Divider />
                            {staff.map((s) => (
                              <Menu.Item
                                key={s._id}
                                title={`${s.fullName} · ${s.weeklyHours}h`}
                                onPress={() => { setChoice((c) => ({ ...c, [p.shiftId]: s._id })); setMenuFor(null); }}
                              />
                            ))}
                          </Menu>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
                <Button
                  mode="contained"
                  buttonColor={colors.primary}
                  icon="check-all"
                  loading={busy}
                  disabled={busy || chosenCount === 0}
                  onPress={() => void apply()}
                >
                  Assign {chosenCount} shift{chosenCount === 1 ? '' : 's'}
                </Button>
              </>
            )}
          </Card.Content>
        </Card>
      </Modal>
    </Portal>
  );
}
