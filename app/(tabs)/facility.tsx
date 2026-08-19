import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button, Chip, TextInput } from 'react-native-paper';
import { CommandSurface, CommandText, StatusPill } from '../../components/FutureUI';
import { asArray, errorMessage, humanizeLabel } from '../../lib/format';
import { api } from '../../lib/railway-api';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { spacing, useDesignTheme } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';


type ZoneType = 'concession_stand' | 'grab_and_go' | 'portable_cart' | 'kiosk' | 'food_vendor' | 'commissary' | 'production_kitchen' | 'premium_suite' | 'premium_club' | 'loge_hospitality' | 'in_seat_service' | 'catering' | 'banquet' | 'bar' | 'beer_cart' | 'beverage' | 'mobile_pickup' | 'retail_fnb' | 'partner_pop_up' | 'back_of_house' | 'other';
type FnbDepartment = 'concessions' | 'culinary_production' | 'premium_hospitality' | 'catering_banquets' | 'beverage_operations' | 'retail_fnb' | 'vendor_partners';
type ZoneStatus = 'open' | 'restricted' | 'closed' | 'incident';
type EventStatus = 'draft' | 'planning' | 'ready' | 'live' | 'completed' | 'cancelled';
type EventOperationalState = 'draft' | 'planning' | 'approved' | 'pre_open' | 'live' | 'closing' | 'closed' | 'archived';

type StadiumOverview = {
  venue: { name: string; stadiumCapacity: number | null; homeTeam: string | null };
  zones: Array<{ id: string; code: string; name: string; department: FnbDepartment; type: ZoneType; capacity: number | null; stadiumZone: string | null; level: string | null; status: ZoneStatus }>;
  events: Array<{ id: string; title: string; eventType: string; status: EventStatus; operationalState: EventOperationalState; startsAt: string; gatesOpenAt: string | null; expectedAttendance: number | null; ticketsScanned: number; opponentOrHeadliner: string | null; readinessPercent: number; openHighOrCriticalIssueCount?: number }>;
  partners: Array<{ id: string; name: string; type: string; status: string; contactName: string | null; complianceExpiresAt: string | null; revenueShareBps: number | null }>;
};

const zoneTypes: ZoneType[] = ['concession_stand', 'grab_and_go', 'portable_cart', 'kiosk', 'food_vendor', 'commissary', 'production_kitchen', 'premium_suite', 'premium_club', 'loge_hospitality', 'in_seat_service', 'catering', 'banquet', 'bar', 'beer_cart', 'beverage', 'mobile_pickup', 'retail_fnb', 'partner_pop_up', 'back_of_house', 'other'];
const departments: FnbDepartment[] = ['concessions', 'culinary_production', 'premium_hospitality', 'catering_banquets', 'beverage_operations', 'retail_fnb', 'vendor_partners'];
const zoneStatusNext: Record<ZoneStatus, ZoneStatus> = { open: 'restricted', restricted: 'incident', incident: 'closed', closed: 'open' };
const eventStateNext: Partial<Record<EventOperationalState, EventOperationalState>> = {
  draft: 'planning', planning: 'approved', approved: 'pre_open', pre_open: 'live', live: 'closing', closing: 'closed', closed: 'archived',
};

const label = humanizeLabel;

export default function FacilityScreen() {
  const palette = useDesignTheme();
  const { venue, isReady, canManage } = useVenueAuth();
  const overview = useQuery(api.stadium.getOverview, isReady && venue?.id ? {} : 'skip') as StadiumOverview | undefined;
  const createZone = useMutation(api.stadium.createZone);
  const generateEventPlan = useMutation(api.stadium.generateEventPlan);
  const updateZoneStatus = useMutation(api.stadium.updateZoneStatus);
  const createEvent = useMutation(api.stadium.createEvent);
  const updateEventState = useMutation(api.stadium.updateEventOperationalState);
  const upsertPartner = useMutation(api.stadium.upsertPartner);
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showPartnerForm, setShowPartnerForm] = useState(false);
  const [zoneCode, setZoneCode] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [department, setDepartment] = useState<FnbDepartment>('concessions');
  const [zoneType, setZoneType] = useState<ZoneType>('concession_stand');
  const [zoneCapacity, setZoneCapacity] = useState('');
  const [stadiumZone, setStadiumZone] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventType, setEventType] = useState('game');
  const [eventStart, setEventStart] = useState('');
  const [expectedAttendance, setExpectedAttendance] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [partnerType, setPartnerType] = useState('local_concept');
  const [partnerRevenueShare, setPartnerRevenueShare] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const zoneSummary = useMemo(() => {
    const zones = asArray(overview?.zones);
    return {
      total: zones.length,
      open: zones.filter((zone) => zone.status === 'open').length,
      attention: zones.filter((zone) => zone.status === 'incident' || zone.status === 'closed').length,
    };
  }, [overview?.zones]);

  const saveZone = async () => {
    if (!venue?.id || !zoneCode.trim() || !zoneName.trim()) return;
    setMessage(null);
    try {
      await createZone({ venueId: venue.id, code: zoneCode, name: zoneName, department, type: zoneType, capacity: zoneCapacity ? Number(zoneCapacity) : undefined, stadiumZone: stadiumZone || undefined });
      setZoneCode(''); setZoneName(''); setZoneCapacity(''); setStadiumZone(''); setShowZoneForm(false);
    } catch (error) { setMessage(errorMessage(error, 'The facility zone could not be saved.')); }
  };

  const saveEvent = async () => {
    if (!venue?.id || !eventTitle.trim() || !eventStart.trim()) return;
    const parsed = new Date(eventStart);
    if (Number.isNaN(parsed.getTime())) { setMessage('Enter a valid event date, such as 2026-09-12 19:00.'); return; }
    setMessage(null);
    try {
      await createEvent({ venueId: venue.id, title: eventTitle, eventType, startsAt: parsed.toISOString(), expectedAttendance: expectedAttendance ? Number(expectedAttendance) : undefined });
      setEventTitle(''); setEventStart(''); setExpectedAttendance(''); setShowEventForm(false);
    } catch (error) { setMessage(errorMessage(error, 'The stadium event could not be saved.')); }
  };

  const buildEventPlan = async (eventId: string) => {
    if (!venue?.id) return;
    setMessage(null);
    try {
      const plan = await generateEventPlan({ venueId: venue.id, eventId, options: { use_historical_events: true, include_labor_plan: true, include_production_plan: true, include_par_plan: true, include_checklists: true } });
      const projectedSales = plan.forecast?.estimatedSalesCents == null ? 'attendance required' : `$${(plan.forecast.estimatedSalesCents / 100).toLocaleString()} projected sales`;
      setMessage(`F&B event plan generated: ${projectedSales}; ${plan.outletPars?.length ?? 0} outlet pars. Review the plan in the Copilot workflow before purchasing or scheduling.`);
    } catch (error) { setMessage(errorMessage(error, 'The event F&B plan could not be generated.')); }
  };

  const savePartner = async () => {
    if (!venue?.id || !partnerName.trim()) return;
    setMessage(null);
    try {
      const sharePercent = partnerRevenueShare ? Number(partnerRevenueShare) : undefined;
      await upsertPartner({ venueId: venue.id, name: partnerName, type: partnerType, revenueShareBps: sharePercent == null ? undefined : Math.round(sharePercent * 100) });
      setPartnerName(''); setPartnerRevenueShare(''); setShowPartnerForm(false);
    } catch (error) { setMessage(errorMessage(error, 'The F&B partner could not be saved.')); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: 'transparent' }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg }}>
      <View style={{ gap: spacing.xs }}>
        <CommandText palette={palette} variant="label">Stadium food & beverage</CommandText>
        <CommandText palette={palette} variant="hero">Stadium / arena F&B map</CommandText>
        <CommandText palette={palette} variant="caption">{overview?.venue?.name ?? venue?.name ?? 'Your stadium'}{overview?.venue?.stadiumCapacity ? ` · ${overview.venue.stadiumCapacity.toLocaleString()} capacity` : ''}</CommandText>
      </View>

      {message ? <CommandSurface palette={palette} style={{ borderColor: palette.warning }}><CommandText palette={palette} variant="body">{message}</CommandText></CommandSurface> : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {[[zoneSummary.total, 'Zones'], [zoneSummary.open, 'Open'], [zoneSummary.attention, 'Attention']].map(([value, title]) => (
          <CommandSurface key={String(title)} palette={palette} style={{ flex: 1, gap: 2 }}>
            <CommandText palette={palette} variant="metric">{String(value)}</CommandText>
            <CommandText palette={palette} variant="caption">{String(title)}</CommandText>
          </CommandSurface>
        ))}
      </View>

      <CommandSurface palette={palette} strong style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CommandText palette={palette} variant="title">Upcoming events</CommandText>
          <Button compact mode="text" textColor={palette.primary} onPress={() => router.push('/event-issues')}>Live issues</Button>
          <Button compact mode="text" textColor={palette.primary} onPress={() => router.push('/pilot-health')}>Pilot Health</Button>
          <Button compact mode="text" textColor={palette.primary} onPress={() => router.push('/integration-readiness')}>Integrations</Button>
          {canManage ? <Button compact mode="text" textColor={palette.primary} onPress={() => setShowEventForm((value) => !value)}>Add event</Button> : null}
        </View>
        {showEventForm ? <View style={{ gap: spacing.sm }}>
          <TextInput mode="outlined" label="Event name" value={eventTitle} onChangeText={setEventTitle} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>{['game', 'concert', 'tournament', 'festival', 'community', 'corporate', 'other'].map((type) => <Chip key={type} selected={eventType === type} onPress={() => setEventType(type)}>{label(type)}</Chip>)}</View>
          <TextInput mode="outlined" label="Start date and time" placeholder="2026-09-12 19:00" value={eventStart} onChangeText={setEventStart} />
          <TextInput mode="outlined" label="Expected attendance" keyboardType="number-pad" value={expectedAttendance} onChangeText={setExpectedAttendance} />
          <Button mode="contained" buttonColor={palette.primary} disabled={!eventTitle.trim() || !eventStart.trim()} onPress={() => void saveEvent()}>Create event</Button>
        </View> : null}
        {overview?.events?.length ? overview.events.map((event) => (
          <View key={event.id} style={{ borderTopWidth: 1, borderColor: palette.border, paddingTop: spacing.sm, gap: spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flex: 1 }}><CommandText palette={palette} variant="body" style={{ fontWeight: '800' }}>{event.title}</CommandText><CommandText palette={palette} variant="caption">{new Date(event.startsAt).toLocaleString()} · {event.expectedAttendance?.toLocaleString() ?? '—'} expected</CommandText></View>
              <StatusPill palette={palette} tone={event.operationalState === 'live' || event.operationalState === 'closing' ? 'warn' : event.operationalState === 'pre_open' || event.operationalState === 'closed' ? 'good' : 'neutral'}>{label(event.operationalState)}</StatusPill>
            </View>
            <CommandText palette={palette} variant="caption">F&B readiness {event.readinessPercent}% · {event.ticketsScanned.toLocaleString()} scanned</CommandText>
            {canManage ? <Button compact mode="contained-tonal" textColor={palette.primary} onPress={() => void buildEventPlan(event.id)}>Generate F&B plan</Button> : null}
            {canManage && eventStateNext[event.operationalState] ? <Button compact mode="outlined" textColor={palette.primary} onPress={() => void updateEventState({ eventId: event.id, state: eventStateNext[event.operationalState] })}>Move to {label(eventStateNext[event.operationalState]!)}</Button> : null}
          </View>
        )) : <CommandText palette={palette} variant="caption">No stadium events scheduled yet.</CommandText>}
      </CommandSurface>

      <CommandSurface palette={palette} style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CommandText palette={palette} variant="title">Departments & stadium zones</CommandText>
          {canManage ? <Button compact mode="text" textColor={palette.primary} onPress={() => setShowZoneForm((value) => !value)}>Add zone</Button> : null}
        </View>
        {showZoneForm ? <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}><TextInput mode="outlined" label="Code" value={zoneCode} onChangeText={setZoneCode} style={{ flex: 1 }} /><TextInput mode="outlined" label="Zone name" value={zoneName} onChangeText={setZoneName} style={{ flex: 2 }} /></View>
          <TextInput mode="outlined" label="Stadium / arena zone" placeholder="e.g. North Concourse · Level 100" value={stadiumZone} onChangeText={setStadiumZone} />
          <CommandText palette={palette} variant="caption">Department</CommandText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>{departments.map((item) => <Chip key={item} selected={department === item} onPress={() => setDepartment(item)}>{label(item)}</Chip>)}</View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>{zoneTypes.map((type) => <Chip key={type} selected={zoneType === type} onPress={() => setZoneType(type)}>{label(type)}</Chip>)}</View>
          <TextInput mode="outlined" label="Capacity (optional)" keyboardType="number-pad" value={zoneCapacity} onChangeText={setZoneCapacity} />
          <Button mode="contained" buttonColor={palette.primary} disabled={!zoneCode.trim() || !zoneName.trim()} onPress={() => void saveZone()}>Save zone</Button>
        </View> : null}
        {overview?.zones?.length ? departments.map((department) => {
          const departmentZones = overview.zones.filter((zone) => zone.department === department);
          return departmentZones.length ? <View key={`section-${department}`} style={{ gap: spacing.xs, borderTopWidth: 1, borderColor: palette.border, paddingTop: spacing.sm }}>
            <CommandText palette={palette} variant="body" style={{ fontWeight: '800' }}>{label(department)}</CommandText>
            <CommandText palette={palette} variant="caption">{departmentZones.map((zone) => `${zone.stadiumZone ?? zone.level ?? 'Unassigned zone'}: ${zone.code} ${zone.name}`).join(' · ')}</CommandText>
          </View> : null;
        }) : null}
        {overview?.zones?.length ? overview.zones.map((zone) => (
          <View key={zone.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderColor: palette.border, paddingTop: spacing.sm }}>
            <View style={{ flex: 1 }}><CommandText palette={palette} variant="body" style={{ fontWeight: '800' }}>{zone.code} · {zone.name}</CommandText><CommandText palette={palette} variant="caption">{label(zone.type)}{zone.capacity ? ` · ${zone.capacity.toLocaleString()} capacity` : ''}</CommandText></View>
            <Button compact mode="outlined" disabled={!canManage} textColor={zone.status === 'incident' || zone.status === 'closed' ? palette.warning : palette.primary} onPress={() => void updateZoneStatus({ zoneId: zone.id, status: zoneStatusNext[zone.status] })}>{label(zone.status)}</Button>
          </View>
        )) : <CommandText palette={palette} variant="caption">Add concession stands, markets, portables, kitchens, suites, clubs, catering spaces, bars, pickup points, and partner concepts.</CommandText>}
      </CommandSurface>

      <CommandSurface palette={palette} style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CommandText palette={palette} variant="title">Vendors & local partners</CommandText>
          {canManage ? <Button compact mode="text" textColor={palette.primary} onPress={() => setShowPartnerForm((value) => !value)}>Add partner</Button> : null}
        </View>
        {showPartnerForm ? <View style={{ gap: spacing.sm }}>
          <TextInput mode="outlined" label="Partner or concept name" value={partnerName} onChangeText={setPartnerName} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>{['local_concept', 'restaurant_concept', 'pop_up', 'licensed_brand', 'food_vendor', 'beverage_vendor', 'distributor', 'other'].map((type) => <Chip key={type} selected={partnerType === type} onPress={() => setPartnerType(type)}>{label(type)}</Chip>)}</View>
          <TextInput mode="outlined" label="Revenue share % (optional)" keyboardType="decimal-pad" value={partnerRevenueShare} onChangeText={setPartnerRevenueShare} />
          <Button mode="contained" buttonColor={palette.primary} disabled={!partnerName.trim()} onPress={() => void savePartner()}>Save partner</Button>
        </View> : null}
        {overview?.partners?.length ? overview.partners.map((partner) => (
          <View key={partner.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderColor: palette.border, paddingTop: spacing.sm }}>
            <View style={{ flex: 1 }}><CommandText palette={palette} variant="body" style={{ fontWeight: '800' }}>{partner.name}</CommandText><CommandText palette={palette} variant="caption">{label(partner.type)}{partner.revenueShareBps != null ? ` · ${(partner.revenueShareBps / 100).toFixed(2)}% revenue share` : ''}</CommandText></View>
            <StatusPill palette={palette} tone={partner.status === 'active' || partner.status === 'approved' ? 'good' : partner.status === 'noncompliant' ? 'warn' : 'neutral'}>{label(partner.status)}</StatusPill>
          </View>
        )) : <CommandText palette={palette} variant="caption">Partner concepts, pop-ups, licensing, revenue-share terms, and compliance will appear here.</CommandText>}
      </CommandSurface>
    </ScrollView>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
