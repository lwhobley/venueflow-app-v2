import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, View, Modal } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Chip, Divider, IconButton, Menu, Searchbar, SegmentedButtons, Snackbar, Text, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { accents, colors, spacing } from '../../lib/theme';
import { useIsDesktop } from '../../lib/responsive';
import { AutoScheduleModal } from './AutoScheduleModal';
import { ScheduleSkeleton } from './ScheduleSkeleton';
import { CollapsibleSection } from '../AppCard';
import { asArray } from '../../lib/format';

type ShiftSnapshot = {
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  jobTitle: string;
  station: string;
  status: 'scheduled' | 'open' | 'covered';
  profileId: Id<'profiles'> | null;
  notes: string | null;
};

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourTicks = [8, 10, 12, 14, 16, 18, 20, 22];
const gridStart = 8 * 60;
const gridEnd = 24 * 60;
const gridMinutes = gridEnd - gridStart;

const roleTargets: Record<string, number> = {
  bartender: 2,
  bar: 2,
  host: 1,
  manager: 1,
  server: 4,
  staff: 2,
};

function parseTime(value: string): number | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function toInputTime(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeLabel(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${m ? `:${String(m).padStart(2, '0')}` : ''} ${suffix}`;
}

function pct(minutes: number) {
  const clamped = Math.max(gridStart, Math.min(gridEnd, minutes));
  return `${((clamped - gridStart) / gridMinutes) * 100}%`;
}

function durationHours(start: number, end: number) {
  return Math.round(((end - start) / 60) * 10) / 10;
}

type AvailabilityRow = { dayIndex: number; startMinutes: number; endMinutes: number; available: boolean };
type ManagerShift = {
  _id: Id<'scheduleShifts'>;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  startTime: string;
  endTime: string;
  jobTitle: string;
  station: string;
  notes: string | null;
  status: 'scheduled' | 'open' | 'covered';
  profileId: Id<'profiles'> | null;
  memberName: string | null;
  conflict: boolean;
};
type Staff = {
  _id: Id<'profiles'>;
  fullName: string;
  role: string;
  jobTitle: string;
  weeklyHours: number;
  overtime: boolean;
  availability: AvailabilityRow[];
};
type Template = { _id: Id<'scheduleTemplates'>; name: string; shiftCount: number };
type StaffRequest = { _id: Id<'staffRequests'>; kind: string; status: string; title: string; details: string };
type LaborForecastDay = {
  dayIndex: number;
  dayLabel: string;
  covers: number;
  privateEvents: number;
  scheduledPeople: number;
  scheduledHours: number;
  suggestedHours: number;
  gapHours: number;
  status: 'under' | 'over' | 'balanced';
};
type LaborForecast = {
  days: LaborForecastDay[];
  totals: { covers: number; scheduledHours: number; suggestedHours: number; gapHours: number };
};
type PanelMode = 'create' | 'edit';

function roleKey(role: string) {
  return role.trim().toLowerCase() || 'staff';
}

function roleAccent(role: string) {
  const keys = ['server', 'bartender', 'bar', 'host', 'manager', 'staff'];
  const index = Math.max(0, keys.indexOf(roleKey(role)));
  return accents[index % accents.length];
}

function availabilityLabel(rows: AvailabilityRow[] | undefined, dayIndex: number) {
  const dayRows = asArray(rows).filter((row) => row.dayIndex === dayIndex);
  if (dayRows.length === 0) return 'Available unless an unavailable-day request is approved';
  return dayRows
    .slice(0, 2)
    .map((row) => row.available
      ? 'Available unless an unavailable-day request is approved'
      : `Unavailable ${timeLabel(row.startMinutes)}-${timeLabel(row.endMinutes)}`)
    .join(' | ');
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

export function ManagerCalendar({ venueId }: { venueId: Id<'venues'> }) {
  const isDesktop = useIsDesktop();
  const [weekOffset, setWeekOffset] = useState(0);

  const createShift = useMutation(api.scheduling.createShift);
  const updateShift = useMutation(api.scheduling.updateShift);
  const assignShift = useMutation(api.scheduling.assignShift);
  const unassignShift = useMutation(api.scheduling.unassignShift);
  const deleteShift = useMutation(api.scheduling.deleteShift);
  const publishSchedule = useMutation(api.scheduling.publishSchedule);
  const saveTemplate = useMutation(api.scheduling.saveScheduleTemplate);
  const applyTemplate = useMutation(api.scheduling.applyScheduleTemplate);
  const deleteTemplate = useMutation(api.scheduling.deleteScheduleTemplate);
  const copyDayShifts = useMutation(api.scheduling.copyDayShifts);
  const clearWeek = useMutation(api.scheduling.clearWeek);
  const setLaborBudget = useMutation(api.scheduling.setLaborBudget);
  const restoreShifts = useMutation(api.scheduling.restoreShifts);
  const openDm = useMutation(api.chat.openDm);

  const [subTab, setSubTab] = useState<'planner' | 'analytics' | 'staffing'>('planner');

  const weekStart = useMemo(() => {
    const today = new Date();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay() + weekOffset * 7);
    sunday.setHours(0, 0, 0, 0);
    return sunday;
  }, [weekOffset]);

  const selectedWeekStart = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
  const data = useQuery(api.scheduling.getManagerSchedule, { venueId, weekStart: selectedWeekStart });
  const forecast = useQuery(api.scheduling.getLaborForecast, { venueId, weekStart: selectedWeekStart }) as LaborForecast | undefined;
  const templates = useQuery(api.scheduling.listScheduleTemplates, { venueId });
  const requestRows = useQuery(api.app.listStaffRequests, { venueId });

  const dayDate = (dayIndex: number) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + dayIndex);
    return d;
  };

  const formatDayDate = (dayIndex: number) =>
    dayDate(dayIndex).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const formatDayNum = (dayIndex: number) => String(dayDate(dayIndex).getDate());

  const isToday = (dayIndex: number) => {
    const today = new Date();
    const d = dayDate(dayIndex);
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  };

  const weekRangeLabel = () => {
    const sunStr = dayDate(0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const satStr = dayDate(6).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${sunStr} – ${satStr}`;
  };

  const [selectedShiftId, setSelectedShiftId] = useState<Id<'scheduleShifts'> | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>('create');
  const [pickedStaff, setPickedStaff] = useState<Id<'profiles'> | null>(null);
  const [day, setDay] = useState(1);
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('17:00');
  const [jobTitle, setJobTitle] = useState('Server');
  const [station, setStation] = useState('Floor');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [status, setStatus] = useState<'Draft' | 'Published' | 'Edited after publish'>('Draft');
  const [templateName, setTemplateName] = useState('');
  const [budgetInput, setBudgetInput] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [dragShiftId, setDragShiftId] = useState<Id<'scheduleShifts'> | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [undo, setUndo] = useState<{ label: string; shifts: ShiftSnapshot[] } | null>(null);

  const shifts = useMemo(() => asArray(data?.shifts) as ManagerShift[], [data]);
  const staff = useMemo(() => asArray(data?.staff) as Staff[], [data]);
  const templateList = useMemo(() => asArray(templates) as Template[], [templates]);
  const requests = useMemo(() => (asArray(requestRows) as StaffRequest[]).filter((row) => row.status === 'pending'), [requestRows]);
  const selectedShift = shifts.find((shift) => shift._id === selectedShiftId) ?? null;
  const pickedName = staff.find((row) => row._id === pickedStaff)?.fullName ?? null;

  const roleOptions = useMemo(() => {
    const roles = Array.from(new Set([...staff.map((row) => row.jobTitle || row.role), ...shifts.map((row) => row.jobTitle)]));
    return ['All', ...roles.filter(Boolean).sort((a, b) => a.localeCompare(b))];
  }, [staff, shifts]);

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff
      .filter((row) => roleFilter === 'All' || row.jobTitle === roleFilter || row.role === roleFilter)
      .filter((row) => !q || row.fullName.toLowerCase().includes(q) || row.jobTitle.toLowerCase().includes(q));
  }, [roleFilter, search, staff]);

  const openShifts = shifts.filter((shift) => shift.status === 'open' || !shift.profileId);
  const conflicts = shifts.filter((shift) => shift.conflict);
  const totalHours = data?.totalScheduledHours ?? 0;
  const laborBudget = data?.laborBudgetHours ?? null;
  const overBudget = laborBudget != null && totalHours > laborBudget;
  const forecastTotals = forecast?.totals;

  useEffect(() => {
    if (!selectedShift) return;
    setPanelMode('edit');
    setDay(selectedShift.dayIndex);
    setStart(toInputTime(selectedShift.startMinutes));
    setEnd(toInputTime(selectedShift.endMinutes));
    setJobTitle(selectedShift.jobTitle);
    setStation(selectedShift.station);
    setNotes(selectedShift.notes ?? '');
    setPickedStaff(selectedShift.profileId);
    setShowEditor(true);
  }, [selectedShift]);

  // Keyboard shortcuts (web): ⌘/Ctrl+S saves the open shift panel, ⌘/Ctrl+Z
  // undoes the last destructive action while the undo toast is showing.
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        void savePanel();
      } else if (key === 'z' && undo) {
        e.preventDefault();
        runUndo();
      }
    };
    const target = globalThis as unknown as { addEventListener?: typeof window.addEventListener; removeEventListener?: typeof window.removeEventListener };
    target.addEventListener?.('keydown', onKey as any);
    return () => target.removeEventListener?.('keydown', onKey as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, panelMode, selectedShiftId, day, start, end, jobTitle, station, notes, pickedStaff]);

  const flash = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 2600);
  };

  const safe = async (action: () => Promise<unknown>, ok?: string) => {
    try {
      await action();
      if (ok) flash(ok);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Action failed.');
    }
  };

  const messageStaff = (profileId: Id<'profiles'>) =>
    safe(async () => {
      const result = await openDm({ venueId, targetProfileId: profileId });
      router.push(`/chat/${result?.conversationId ?? result}`);
    });

  const runUndo = () => {
    if (!undo) return;
    const snapshot = undo;
    setUndo(null);
    void safe(async () => {
      await restoreShifts({ venueId, weekStart: selectedWeekStart, shifts: snapshot.shifts });
      markEdited();
    }, 'Restored.');
  };

  const markEdited = () => setStatus((current) => (current === 'Published' ? 'Edited after publish' : current));

  const openCreatePanel = (nextDay = day, nextStart = parseTime(start) ?? 600) => {
    setSelectedShiftId(null);
    setPanelMode('create');
    setDay(nextDay);
    setStart(toInputTime(nextStart));
    setEnd(toInputTime(Math.min(gridEnd, nextStart + 4 * 60)));
    setNotes('');
    setPickedStaff(null);
    setShowEditor(true);
  };

  const savePanel = async () => {
    const startMinutes = parseTime(start);
    const endMinutes = parseTime(end);
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
      flash('Enter a valid start and end time.');
      return;
    }
    if (panelMode === 'edit' && selectedShift) {
      await safe(async () => {
        await updateShift({
          venueId,
          shiftId: selectedShift._id,
          dayIndex: day,
          startMinutes,
          endMinutes,
          jobTitle: jobTitle.trim() || 'Staff',
          station: station.trim() || 'Floor',
          notes: notes.trim() || undefined,
        });
        markEdited();
        flash('Shift updated.');
        setShowEditor(false);
        setSelectedShiftId(null);
      });
      return;
    }
    await safe(async () => {
      const shiftId = await createShift({
        venueId,
        weekStart: selectedWeekStart,
        dayIndex: day,
        startMinutes,
        endMinutes,
        jobTitle: jobTitle.trim() || 'Staff',
        station: station.trim() || 'Floor',
        profileId: pickedStaff ?? undefined,
      });
      setSelectedShiftId(shiftId);
      markEdited();
      flash(pickedStaff ? 'Assigned shift created.' : 'Open shift created.');
      setShowEditor(false);
      setSelectedShiftId(null);
    });
  };

  const assignSelected = async (profileId: Id<'profiles'>) => {
    if (!selectedShift) return;
    await safe(async () => {
      await assignShift({ venueId, shiftId: selectedShift._id, profileId });
      setPickedStaff(profileId);
      markEdited();
    });
  };

  const moveDraggedShift = async (targetDay: number, targetStart: number) => {
    if (!dragShiftId) return;
    const shift = shifts.find((row) => row._id === dragShiftId);
    if (!shift) return;
    const length = Math.max(60, shift.endMinutes - shift.startMinutes);
    await updateShift({
      venueId,
      shiftId: shift._id,
      dayIndex: targetDay,
      startMinutes: targetStart,
      endMinutes: Math.min(gridEnd, targetStart + length),
      jobTitle: shift.jobTitle,
      station: shift.station,
      notes: shift.notes ?? undefined,
    });
    setDragShiftId(null);
    markEdited();
    flash('Shift moved.');
  };

  const coverageRows = useMemo(() => {
    const dayparts = [
      { label: 'Lunch', start: 11 * 60, end: 15 * 60 },
      { label: 'Dinner', start: 17 * 60, end: 21 * 60 },
      { label: 'Close', start: 21 * 60, end: 24 * 60 },
    ];
    const roles = Array.from(new Set(shifts.map((shift) => shift.jobTitle || 'Staff'))).slice(0, 4);
    return dayparts.flatMap((part) =>
      (roles.length ? roles : ['Server', 'Bartender']).map((role) => {
        const roleShifts = shifts.filter((shift) => shift.jobTitle === role && overlaps(shift.startMinutes, shift.endMinutes, part.start, part.end));
        const count = roleShifts.filter((shift) => shift.profileId).length;
        const target = roleTargets[roleKey(role)] ?? 2;
        const state = count < target ? 'Under' : count === target ? 'Full' : 'Over';
        return { key: `${part.label}-${role}`, part: part.label, role, count, target, state };
      }),
    );
  }, [shifts]);

  if (data === undefined) {
    return <ScheduleSkeleton rows={5} />;
  }

  const topButtonStyle = isDesktop ? { minWidth: 120 } : {};
  const panelInputStyle = { backgroundColor: colors.surface };

  return (
    <View style={{ gap: spacing.md }}>
      {/* Header Card */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 10 }}>
        <Card.Content style={{ gap: spacing.md }}>
          <View style={{ flexDirection: isDesktop ? 'row' : 'column', gap: spacing.sm, alignItems: isDesktop ? 'center' : 'stretch', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <Button compact mode="outlined" textColor={colors.primary} icon="chevron-left" onPress={() => setWeekOffset((o) => o - 1)}>Prev</Button>
              <View style={{ minWidth: isDesktop ? 180 : 0 }}>
                <Text style={{ color: colors.primary, fontWeight: '800' }}>Weekly Schedule</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{weekRangeLabel()}</Text>
              </View>
              <Button compact mode="outlined" textColor={colors.primary} icon="chevron-right" onPress={() => setWeekOffset((o) => o + 1)}>Next</Button>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip compact style={{ backgroundColor: status === 'Published' ? '#E1FBF3' : status === 'Edited after publish' ? '#FFF5DA' : colors.cream, marginRight: 4 }}>
                {status}
              </Chip>
              <Button mode="contained" buttonColor={colors.primary} icon="plus" style={topButtonStyle} labelStyle={{ fontSize: 12 }} onPress={() => openCreatePanel()}>
                Add Shift
              </Button>
              <Button
                mode="contained"
                buttonColor={accents[0].fg}
                icon="auto-fix"
                style={topButtonStyle}
                labelStyle={{ fontSize: 12 }}
                disabled={openShifts.length === 0}
                onPress={() => setAutoOpen(true)}
              >
                Auto
              </Button>
              <Button
                mode="contained"
                buttonColor={colors.secondary}
                icon="send"
                style={topButtonStyle}
                labelStyle={{ fontSize: 12 }}
                onPress={() => void safe(async () => {
                  const r = await publishSchedule({ venueId, weekStart: selectedWeekStart });
                  setStatus('Published');
                  flash(`Published and notified ${r.notified} staff.`);
                })}
              >
                Publish
              </Button>
            </View>
          </View>

          {/* Sub-tab segmented button */}
          <SegmentedButtons
            value={subTab}
            onValueChange={(v) => setSubTab(v as 'planner' | 'analytics' | 'staffing')}
            buttons={[
              { value: 'planner', label: 'Planner (Grid)' },
              { value: 'analytics', label: 'Analytics' },
              { value: 'staffing', label: 'Staffing' },
            ]}
          />
        </Card.Content>
      </Card>

      {/* Primary Metrics Summary Bar */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {[
          { label: 'Scheduled Hours', value: `${totalHours}h`, tone: overBudget ? colors.danger : colors.primary },
          { label: 'Open Shifts', value: String(openShifts.length), tone: openShifts.length ? colors.warning : colors.success },
          { label: 'Conflicts', value: String(conflicts.length), tone: conflicts.length ? colors.danger : colors.success },
          { label: 'Pending Approvals', value: String(requests.length), tone: requests.length ? colors.warning : colors.primary },
        ].map((metric) => (
          <View key={metric.label} style={{ minWidth: 145, flex: 1, padding: spacing.sm, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: colors.muted, fontSize: 11 }}>{metric.label}</Text>
              <Text style={{ color: metric.tone, fontSize: 18, fontWeight: '800' }}>{metric.value}</Text>
            </View>
            <MaterialCommunityIcons 
              name={
                metric.label.includes('Hours') ? 'clock-outline' :
                metric.label.includes('Open') ? 'account-plus-outline' :
                metric.label.includes('Conflicts') ? 'alert-circle-outline' : 'checkbox-marked-circle-outline'
              } 
              size={20} 
              color={metric.tone} 
            />
          </View>
        ))}
      </View>

      {actionMsg ? (
        <Card style={{ backgroundColor: '#E1FBF3', padding: 4 }}>
          <Text style={{ color: colors.charcoal, fontWeight: '800', textAlign: 'center' }}>{actionMsg}</Text>
        </Card>
      ) : null}

      {/* ─── Planner Sub-tab ─── */}
      {subTab === 'planner' && (
        <View style={{ gap: spacing.md }}>
          <Card style={{ backgroundColor: colors.surface, borderRadius: 10 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="titleMedium" style={{ fontWeight: '800' }}>Week Grid</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {pickedName ? `Assigning: ${pickedName}` : 'Click an hour to create. Drag shifts on desktop.'}
                </Text>
              </View>
              
              <ScrollView horizontal={!isDesktop} showsHorizontalScrollIndicator={false}>
                <View style={{ minWidth: isDesktop ? 760 : 860, gap: spacing.sm, paddingVertical: spacing.xs }}>
                  <View style={{ flexDirection: 'row', paddingLeft: 64 }}>
                    {hourTicks.map((hour) => (
                      <Text key={hour} style={{ flex: 1, color: colors.muted, fontSize: 11 }}>{timeLabel(hour * 60)}</Text>
                    ))}
                  </View>
                  
                  {dayLabels.map((label, dayIndex) => {
                    const dayShifts = shifts.filter((shift) => shift.dayIndex === dayIndex);
                    const today = isToday(dayIndex);
                    const active = day === dayIndex;
                    return (
                      <View key={label} style={{ flexDirection: 'row', minHeight: 96 }}>
                        <Pressable onPress={() => setDay(dayIndex)} style={{ width: 56, paddingTop: spacing.sm }}>
                          <Text style={{ color: active ? colors.primary : today ? colors.secondary : colors.charcoal, fontWeight: '800' }}>{label}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Text style={{
                              color: today ? colors.secondary : active ? colors.primary : colors.muted,
                              fontSize: 11,
                              fontWeight: today ? '800' : '400',
                            }}>
                              {formatDayNum(dayIndex)}
                            </Text>
                            {today && (
                              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.secondary }} />
                            )}
                          </View>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>{dayShifts.length} shifts</Text>
                        </Pressable>
                        
                        <View style={{ flex: 1, minHeight: 92, borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden', position: 'relative', backgroundColor: colors.background }}>
                          <View style={{ position: 'absolute', inset: 0 as any, flexDirection: 'row' }}>
                            {hourTicks.map((hour) => (
                              <Pressable
                                key={hour}
                                onPress={() => openCreatePanel(dayIndex, hour * 60)}
                                {...({
                                  onDragOver: (event: any) => event.preventDefault(),
                                  onDrop: async (event: any) => {
                                    event.preventDefault();
                                    await moveDraggedShift(dayIndex, hour * 60);
                                  },
                                } as any)}
                                style={{ flex: 1, borderRightWidth: 1, borderRightColor: colors.border }}
                              />
                            ))}
                          </View>
                          
                          {dayShifts.map((shift) => {
                            const accent = roleAccent(shift.jobTitle);
                            const left = pct(shift.startMinutes);
                            const width = `${Math.max(8, ((Math.min(gridEnd, shift.endMinutes) - Math.max(gridStart, shift.startMinutes)) / gridMinutes) * 100)}%`;
                            return (
                              <Pressable
                                key={shift._id}
                                onPress={() => setSelectedShiftId(shift._id)}
                                {...({
                                  draggable: true,
                                  onDragStart: (event: any) => {
                                    setDragShiftId(shift._id);
                                    event.dataTransfer?.setData('text/plain', shift._id);
                                  },
                                } as any)}
                                style={{
                                  position: 'absolute',
                                  left: left as any,
                                  width: width as any,
                                  top: 12 + (dayShifts.indexOf(shift) % 2) * 34,
                                  minHeight: 30,
                                  borderRadius: 7,
                                  paddingHorizontal: 8,
                                  paddingVertical: 5,
                                  backgroundColor: shift.conflict ? '#FDE7E9' : shift.profileId ? accent.bg : '#FFF5DA',
                                  borderWidth: selectedShiftId === shift._id || shift.conflict ? 1 : 0,
                                  borderColor: shift.conflict ? colors.danger : accent.fg,
                                }}
                              >
                                <Text numberOfLines={1} style={{ color: shift.conflict ? colors.danger : accent.fg, fontWeight: '800', fontSize: 11 }}>
                                  {shift.jobTitle} {shift.conflict ? '!' : ''}
                                </Text>
                                <Text numberOfLines={1} style={{ color: colors.charcoal, fontSize: 10 }}>
                                  {shift.memberName ?? 'Open'} | {shift.startTime}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            </Card.Content>
          </Card>

          <CollapsibleSection
            title="Templates"
            subtitle={templateList.length ? `${templateList.length} saved templates` : 'Save and reuse weekly patterns'}
          >
            <View style={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
                <TextInput dense label="Template name" value={templateName} onChangeText={setTemplateName} mode="outlined" style={{ flex: 1, minWidth: 200, backgroundColor: colors.surface }} />
                <Button mode="outlined" textColor={colors.primary} onPress={() => void safe(async () => { if (!templateName.trim()) throw new Error('Enter a template name.'); await saveTemplate({ venueId, name: templateName.trim(), weekStart: selectedWeekStart }); setTemplateName(''); }, 'Template saved.')}>
                  Save current week
                </Button>
              </View>
              <View style={{ gap: spacing.sm }}>
                {templateList.length === 0 ? <Text style={{ color: colors.muted }}>No saved templates yet.</Text> : null}
                {templateList.map((template) => (
                  <View key={template._id} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
                    <View style={{ flex: 1, minWidth: 150 }}>
                      <Text style={{ color: colors.charcoal, fontWeight: '800' }}>{template.name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{template.shiftCount} open shifts</Text>
                    </View>
                    <Button compact mode="outlined" textColor={colors.primary} onPress={() => void safe(async () => { const r = await applyTemplate({ venueId, templateId: template._id, replace: false, weekStart: selectedWeekStart }); markEdited(); flash(`Added ${r.added} shifts.`); })}>
                      Add
                    </Button>
                    <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void safe(async () => { const r = await applyTemplate({ venueId, templateId: template._id, replace: true, weekStart: selectedWeekStart }); markEdited(); flash(`Replaced week with ${r.added} shifts.`); })}>
                      Replace
                    </Button>
                    <IconButton
                      icon="trash-can-outline"
                      size={18}
                      iconColor={colors.danger}
                      accessibilityLabel={`Delete ${template.name} template`}
                      onPress={() => void safe(() => deleteTemplate({ venueId, templateId: template._id }), 'Template deleted.')}
                    />
                  </View>
                ))}
              </View>
            </View>
          </CollapsibleSection>
        </View>
      )}

      {/* ─── Analytics Sub-tab ─── */}
      {subTab === 'analytics' && (
        <View style={{ gap: spacing.md }}>
          {/* Budget configuration Card */}
          <Card style={{ backgroundColor: colors.surface, borderRadius: 10 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ fontWeight: '800' }}>Labor Budget Config</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <TextInput
                  dense
                  label="Weekly Labor Budget (Hours)"
                  value={budgetInput}
                  onChangeText={setBudgetInput}
                  keyboardType="number-pad"
                  mode="outlined"
                  style={{ flex: 1, backgroundColor: colors.surface }}
                />
                <Button mode="contained" buttonColor={colors.primary} onPress={async () => { await setLaborBudget({ venueId, weeklyLaborBudgetHours: budgetInput.trim() ? Number(budgetInput) : null }); setBudgetInput(''); flash('Budget saved.'); }}>
                  Save
                </Button>
              </View>
            </Card.Content>
          </Card>

          <CollapsibleSection
            title="Labor Forecast"
            subtitle="Next 7 days from bookings, events, and hours."
            rightAdornment={forecastTotals ? (
              <Chip compact style={{ backgroundColor: forecastTotals.gapHours > 0 ? '#FFF5DA' : forecastTotals.gapHours < 0 ? '#E1FBF3' : colors.cream }}>
                {forecastTotals.gapHours > 0 ? `${forecastTotals.gapHours}h short` : forecastTotals.gapHours < 0 ? `${Math.abs(forecastTotals.gapHours)}h cushion` : 'Balanced'}
              </Chip>
            ) : null}
          >
            <View style={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {[
                  { label: 'Forecasted Covers', value: String(forecastTotals?.covers ?? 0), tone: colors.primary },
                  { label: 'Scheduled Hours', value: `${forecastTotals?.scheduledHours ?? 0}h`, tone: colors.secondary },
                  { label: 'Suggested Hours', value: `${forecastTotals?.suggestedHours ?? 0}h`, tone: colors.warning },
                ].map((metric) => (
                  <View key={metric.label} style={{ minWidth: 135, flexGrow: 1, padding: spacing.sm, borderRadius: 8, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: metric.tone, fontSize: 18, fontWeight: '800' }}>{metric.value}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{metric.label}</Text>
                  </View>
                ))}
              </View>
              
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {asArray(forecast?.days).map((row) => {
                    const bg = row.status === 'under' ? '#FFF5DA' : row.status === 'over' ? '#FDE7E9' : '#E1FBF3';
                    const fg = row.status === 'under' ? colors.warning : row.status === 'over' ? colors.danger : colors.success;
                    return (
                      <View key={row.dayIndex} style={{ width: 160, padding: spacing.sm, borderRadius: 8, backgroundColor: bg, gap: 4 }}>
                        <Text style={{ color: fg, fontWeight: '800', fontSize: 12 }}>{row.dayLabel} - {row.status.toUpperCase()}</Text>
                        <Text style={{ color: colors.charcoal, fontSize: 12 }}>{row.covers} covers | {row.privateEvents} events</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{row.scheduledPeople} staff ({row.scheduledHours}h)</Text>
                        <Text style={{ color: fg, fontSize: 11, fontWeight: '800' }}>
                          {row.gapHours > 0 ? `${row.gapHours}h short` : row.gapHours < 0 ? `${Math.abs(row.gapHours)}h cushion` : 'On target'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          </CollapsibleSection>

          <CollapsibleSection
            title="Shift Coverage"
            subtitle="Role coverage by daypart"
            rightAdornment={overBudget ? <Chip compact textStyle={{ color: colors.danger }}>Over labor budget</Chip> : <Chip compact>On budget</Chip>}
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {coverageRows.map((row) => {
                  const bg = row.state === 'Under' ? '#FDE7E9' : row.state === 'Over' ? '#FFF5DA' : '#E1FBF3';
                  const fg = row.state === 'Under' ? colors.danger : row.state === 'Over' ? colors.warning : colors.success;
                  return (
                    <View key={row.key} style={{ width: 138, padding: spacing.sm, borderRadius: 8, backgroundColor: bg }}>
                      <Text style={{ color: fg, fontWeight: '800', fontSize: 12 }}>{row.state}</Text>
                      <Text style={{ color: colors.charcoal, fontWeight: '600' }}>{row.role}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{row.part}: {row.count}/{row.target}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </CollapsibleSection>
        </View>
      )}

      {/* ─── Staffing Sub-tab ─── */}
      {subTab === 'staffing' && (
        <View style={{ gap: spacing.md }}>
          {/* Employee Directory Card */}
          <Card style={{ backgroundColor: colors.surface, borderRadius: 10 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ fontWeight: '800' }}>Employees</Text>
              
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Searchbar
                  placeholder="Search employees or roles"
                  value={search}
                  onChangeText={setSearch}
                  style={{ flex: 1, height: 44, backgroundColor: colors.background, borderRadius: 8 }}
                  inputStyle={{ fontSize: 14 }}
                />
                <Menu
                  visible={menuOpen}
                  onDismiss={() => setMenuOpen(false)}
                  anchor={<Button mode="outlined" compact textColor={colors.primary} icon="menu" onPress={() => setMenuOpen(true)}>Tools</Button>}
                >
                  <Menu.Item
                    title="Duplicate Monday to week"
                    onPress={async () => {
                      setMenuOpen(false);
                      const r = await copyDayShifts({ venueId, weekStart: selectedWeekStart, fromDay: 1, toDays: [0, 2, 3, 4, 5, 6] });
                      markEdited();
                      flash(`Copied ${r.added} shifts.`);
                    }}
                  />
                  <Menu.Item
                    title="Auto-fill from first template"
                    onPress={async () => {
                      setMenuOpen(false);
                      const first = templateList[0];
                      if (!first) {
                        flash('Save a template first.');
                        return;
                      }
                      const r = await applyTemplate({ venueId, templateId: first._id, replace: false });
                      markEdited();
                      flash(`Added ${r.added} open shifts.`);
                    }}
                  />
                  <Menu.Item
                    title="Clear week"
                    onPress={async () => {
                      setMenuOpen(false);
                      await safe(async () => {
                        const r = await clearWeek({ venueId, weekStart: selectedWeekStart });
                        markEdited();
                        if (r.removed > 0) setUndo({ label: `Cleared ${r.removed} shifts.`, shifts: r.shifts as ShiftSnapshot[] });
                        else flash('Nothing to clear.');
                      });
                    }}
                  />
                </Menu>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: spacing.xs }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {roleOptions.slice(0, 8).map((role) => (
                    <Chip key={role} compact selected={roleFilter === role} onPress={() => setRoleFilter(role)} style={{ height: 32 }}>
                      {role}
                    </Chip>
                  ))}
                </View>
              </ScrollView>

              <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
                {filteredStaff.map((row) => {
                  const accent = roleAccent(row.jobTitle || row.role);
                  const selected = pickedStaff === row._id;
                  return (
                    <Pressable
                      key={row._id}
                      onPress={() => setPickedStaff(selected ? null : row._id)}
                      style={{
                        borderWidth: 1,
                        borderColor: selected ? accent.fg : colors.border,
                        backgroundColor: selected ? accent.bg : colors.background,
                        borderRadius: 8,
                        padding: spacing.sm,
                        gap: 4,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
                        <Text style={{ color: colors.charcoal, fontWeight: '800', flex: 1 }}>{row.fullName}</Text>
                        <Text style={{ color: row.overtime ? colors.danger : colors.muted, fontWeight: '700' }}>{row.weeklyHours}h</Text>
                        <IconButton
                          icon="message-outline"
                          size={16}
                          iconColor={colors.primary}
                          style={{ margin: 0 }}
                          accessibilityLabel={`Message ${row.fullName}`}
                          onPress={() => void messageStaff(row._id)}
                        />
                      </View>
                      <Text style={{ color: accent.fg, fontSize: 12 }}>{row.jobTitle || row.role}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{availabilityLabel(row.availability, day)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card.Content>
          </Card>

          {/* Open Shifts & Approvals lists */}
          <Card style={{ backgroundColor: colors.surface, borderRadius: 10 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ fontWeight: '800' }}>Open Shifts</Text>
              {openShifts.length === 0 ? <Text style={{ color: colors.muted }}>No open shifts.</Text> : null}
              {openShifts.slice(0, 5).map((shift) => (
                <Pressable key={shift._id} onPress={() => setSelectedShiftId(shift._id)} style={{ padding: spacing.sm, borderRadius: 8, backgroundColor: accents[4].bg }}>
                  <Text style={{ color: accents[4].fg, fontWeight: '800' }}>{dayLabels[shift.dayIndex]} {formatDayDate(shift.dayIndex)} {shift.startTime}</Text>
                  <Text style={{ color: colors.charcoal }}>{shift.jobTitle} | {shift.station}</Text>
                </Pressable>
              ))}
              <Divider style={{ marginVertical: spacing.xs }} />
              
              <Text variant="titleMedium" style={{ fontWeight: '800' }}>Approvals queue</Text>
              {requests.length === 0 ? <Text style={{ color: colors.muted }}>No time-off or swap requests pending.</Text> : null}
              {requests.slice(0, 3).map((request) => (
                <View key={request._id} style={{ gap: 2, paddingVertical: 4 }}>
                  <Text style={{ color: colors.charcoal, fontWeight: '700' }}>{request.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{request.kind.replace('_', ' ')} · {request.details}</Text>
                </View>
              ))}
            </Card.Content>
          </Card>
        </View>
      )}

      {/* ─── Shift Editor Modal ─── */}
      <Modal
        visible={showEditor}
        animationType="slide"
        transparent
        onRequestClose={() => { setShowEditor(false); setSelectedShiftId(null); }}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="titleMedium" style={{ fontWeight: '800' }}>
                  {panelMode === 'edit' ? 'Shift Details' : 'Add Shift'}
                </Text>
                <IconButton
                  icon="close"
                  size={20}
                  onPress={() => { setShowEditor(false); setSelectedShiftId(null); }}
                  style={{ margin: 0 }}
                />
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 4 }}>
                  {dayLabels.map((label, index) => (
                    <Chip key={label} compact selected={day === index} onPress={() => setDay(index)}>{label} {formatDayNum(index)}</Chip>
                  ))}
                </View>
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput dense label="Start" value={start} onChangeText={setStart} mode="outlined" style={{ flex: 1, ...panelInputStyle }} />
                <TextInput dense label="End" value={end} onChangeText={setEnd} mode="outlined" style={{ flex: 1, ...panelInputStyle }} />
              </View>
              
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput dense label="Break" value="30m" editable={false} mode="outlined" style={{ flex: 1, ...panelInputStyle }} />
                <TextInput dense label="Cost" value={`$${Math.round((durationHours(parseTime(start) ?? 0, parseTime(end) ?? 0) * 18) || 0)}`} editable={false} mode="outlined" style={{ flex: 1, ...panelInputStyle }} />
              </View>
              
              <TextInput dense label="Role" value={jobTitle} onChangeText={setJobTitle} mode="outlined" style={panelInputStyle} />
              <TextInput dense label="Station" value={station} onChangeText={setStation} mode="outlined" style={panelInputStyle} />
              <TextInput dense label="Notes" value={notes} onChangeText={setNotes} mode="outlined" multiline style={panelInputStyle} />

              {selectedShift?.conflict ? (
                <View style={{ padding: spacing.sm, borderRadius: 8, backgroundColor: '#FDE7E9' }}>
                  <Text style={{ color: colors.charcoal, fontWeight: '800' }}>Availability conflict</Text>
                  <Text style={{ color: colors.charcoal, fontSize: 12 }}>This employee is unavailable or not fully available for the selected shift.</Text>
                </View>
              ) : null}

              <Text style={{ color: colors.muted, fontSize: 12 }}>Assign employee</Text>
              
              <ScrollView style={{ maxHeight: 120 }}>
                <View style={{ gap: 6 }}>
                  <Chip selected={!pickedStaff} onPress={async () => { setPickedStaff(null); if (selectedShift) await unassignShift({ venueId, shiftId: selectedShift._id }); }}>
                    Open shift
                  </Chip>
                  {staff.map((row) => (
                    <Chip key={row._id} selected={pickedStaff === row._id} onPress={() => { setPickedStaff(row._id); if (selectedShift) void assignSelected(row._id); }}>
                      {row.fullName} | {row.weeklyHours}h{row.overtime ? ' OT risk' : ''}
                    </Chip>
                  ))}
                </View>
              </ScrollView>

              <Button mode="contained" buttonColor={colors.primary} icon="content-save" style={{ marginTop: 8 }} accessibilityLabel={panelMode === 'edit' ? 'Save shift' : 'Create shift'} onPress={() => void savePanel()}>
                {panelMode === 'edit' ? 'Save shift' : 'Create shift'}
              </Button>

              {selectedShift ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button compact mode="outlined" textColor={colors.primary} style={{ flex: 1 }} onPress={async () => { await unassignShift({ venueId, shiftId: selectedShift._id }); setShowEditor(false); setSelectedShiftId(null); }}>Open</Button>
                  <Button compact mode="outlined" textColor={colors.danger} style={{ flex: 1 }} accessibilityLabel="Delete shift" onPress={async () => {
                    const snap: ShiftSnapshot = {
                      dayIndex: selectedShift.dayIndex,
                      startMinutes: selectedShift.startMinutes,
                      endMinutes: selectedShift.endMinutes,
                      jobTitle: selectedShift.jobTitle,
                      station: selectedShift.station,
                      status: selectedShift.status,
                      profileId: selectedShift.profileId,
                      notes: selectedShift.notes,
                    };
                    await safe(async () => {
                      await deleteShift({ venueId, shiftId: selectedShift._id });
                      setSelectedShiftId(null);
                      setShowEditor(false);
                      markEdited();
                      setUndo({ label: 'Shift deleted.', shifts: [snap] });
                    });
                  }}>Delete</Button>
                </View>
              ) : null}
            </Card.Content>
          </Card>
        </View>
      </Modal>

      <AutoScheduleModal
        venueId={venueId}
        weekStartDate={selectedWeekStart}
        visible={autoOpen}
        onClose={() => setAutoOpen(false)}
        onApplied={flash}
        staff={staff.map((s) => ({ _id: s._id, fullName: s.fullName, jobTitle: s.jobTitle, role: s.role, weeklyHours: s.weeklyHours }))}
      />

      <Snackbar
        visible={Boolean(undo)}
        onDismiss={() => setUndo(null)}
        duration={6000}
        action={{ label: 'Undo', onPress: runUndo }}
      >
        {undo?.label ?? ''}
      </Snackbar>
    </View>
  );
}
