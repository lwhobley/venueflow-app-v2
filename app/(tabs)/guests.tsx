import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { Button, Card, Chip, SegmentedButtons, Switch, Text, TextInput } from 'react-native-paper';
import { ScreenErrorBoundary } from '../../components/ErrorBoundary';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { accents, colors, radius, spacing } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { formatMoney, formatShortDate, formatShortDateTime, formatFullDateTime, splitTags, errorMessage } from '../../lib/format';
import { PremiumFeatureGate } from '../../components/PremiumFeatureGate';
import { SectionHeader } from '../../components/AppCard';
import { CrmSalesWorkspace } from '../../components/CrmSalesWorkspace';
import { useI18n } from '../../lib/i18n';

type LifecycleStage = 'lead' | 'regular' | 'vip' | 'lapsed';
type Segment = 'all' | LifecycleStage | 'upcoming' | 'needs_follow_up';

type LeadImportRow = {
  fullName: string;
  phone?: string;
  email?: string;
  source?: string;
  company?: string;
  tags?: string[];
  notes?: string;
  marketingOptIn?: boolean;
};

type GuestRow = {
  _id: Id<'guests'>;
  fullName: string;
  phone: string | null;
  email: string | null;
  lifecycleStage: LifecycleStage;
  source: string | null;
  birthday: string | null;
  company: string | null;
  marketingOptIn: boolean;
  favoriteTable: string | null;
  preferredServer: string | null;
  dietaryNotes: string | null;
  tags: string[];
  notes: string | null;
  reservationCount: number;
  visitCount: number;
  lastVisitAt: number | null;
  upcomingReservationAt: number | null;
  totalSpendCents: number;
  averageSpendCents: number;
  daysSinceLastVisit: number | null;
};

type ReservationEvent = {
  _id: Id<'reservations'>;
  partySize: number;
  reservationTime: number;
  status: string;
  tags: string[];
  notes: string | null;
  isPrivateEvent: boolean;
  eventName: string | null;
  eventStatus: string | null;
  eventSpace: string | null;
  setupStyle: string | null;
  menuNotes: string | null;
  beverageNotes: string | null;
  billingNotes: string | null;
  estimatedValueCents: number | null;
  depositDueCents: number | null;
};

type CheckEvent = {
  _id: Id<'posChecks'>;
  provider: string;
  openedAt: number;
  closedAt: number | null;
  totalCents: number;
  tipCents: number;
  status: string;
  revenueCenter: string | null;
  tenderType: string | null;
  guestCount: number | null;
  menuItems: Array<{ name: string; category: string | null; quantity: number; priceCents: number }>;
};

type GuestProfile = { guest: GuestRow; reservations: ReservationEvent[]; checks: CheckEvent[] };
type GuestListResponse = { guests: GuestRow[]; totalCount: number; page: number; limit: number };

type I18nT = ReturnType<typeof useI18n>['t'];

const segmentDefs: Array<{ value: Segment; key: 'all' | 'vip' | 'regulars' | 'upcoming' | 'followUp' }> = [
  { value: 'all', key: 'all' },
  { value: 'vip', key: 'vip' },
  { value: 'regular', key: 'regulars' },
  { value: 'upcoming', key: 'upcoming' },
  { value: 'needs_follow_up', key: 'followUp' },
];

const lifecycleDefs: Array<{ value: LifecycleStage; key: 'lead' | 'regular' | 'vip' | 'lapsed' }> = [
  { value: 'lead', key: 'lead' },
  { value: 'regular', key: 'regular' },
  { value: 'vip', key: 'vip' },
  { value: 'lapsed', key: 'lapsed' },
];



function scoreGuest(guest: GuestRow) {
  const spendScore = Math.min(45, Math.floor(guest.totalSpendCents / 5000));
  const visitScore = Math.min(35, guest.visitCount * 7);
  const futureScore = guest.upcomingReservationAt ? 10 : 0;
  const profileScore = (guest.email ? 4 : 0) + (guest.phone ? 3 : 0) + (guest.tags.length ? 3 : 0);
  return Math.min(100, spendScore + visitScore + futureScore + profileScore);
}



function latestEventReservation(profile: GuestProfile | null | undefined) {
  return [...(profile?.reservations ?? [])]
    .filter((reservation) => reservation.isPrivateEvent || reservation.tags.includes('private_event'))
    .sort((a, b) => b.reservationTime - a.reservationTime)[0] ?? profile?.reservations?.[0] ?? null;
}

function generateBeo(guest: GuestRow, profile: GuestProfile | null | undefined, t: I18nT) {
  const event = latestEventReservation(profile);
  const topItems = new Map<string, number>();
  for (const check of profile?.checks ?? []) {
    for (const item of check.menuItems) topItems.set(item.name, (topItems.get(item.name) ?? 0) + item.quantity);
  }
  const tbd = t('guests.documents.common.tbd');
  const favorites = Array.from(topItems.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, quantity]) => `${name} (${quantity})`).join(', ') || t('guests.documents.common.reviewWithClient');
  return [
    t('guests.documents.beo.title'),
    t('guests.documents.beo.client', { name: guest.fullName }),
    t('guests.documents.beo.companyGroup', { value: guest.company ?? event?.eventName ?? tbd }),
    t('guests.documents.beo.contact', { phone: guest.phone ?? t('guests.documents.common.noPhone'), email: guest.email ?? t('guests.documents.common.noEmail') }),
    t('guests.documents.beo.event', { name: event?.eventName ?? t('guests.documents.common.privateEvent') }),
    t('guests.documents.beo.dateTime', { value: event ? formatFullDateTime(event.reservationTime) : tbd }),
    t('guests.documents.beo.guestCount', { value: event?.partySize ?? tbd }),
    t('guests.documents.beo.roomSpace', { value: event?.eventSpace ?? tbd }),
    t('guests.documents.beo.setup', { value: event?.setupStyle ?? tbd }),
    t('guests.documents.beo.menu', { value: event?.menuNotes ?? favorites }),
    t('guests.documents.beo.beverage', { value: event?.beverageNotes ?? tbd }),
    t('guests.documents.beo.dietary', { value: guest.dietaryNotes ?? t('guests.documents.common.noneCaptured') }),
    t('guests.documents.beo.serviceNotes', { value: event?.notes ?? guest.notes ?? tbd }),
    t('guests.documents.beo.billingNotes', { value: event?.billingNotes ?? tbd }),
  ].join('\n');
}

function generateContract(guest: GuestRow, profile: GuestProfile | null | undefined, t: I18nT) {
  const event = latestEventReservation(profile);
  const tbd = t('guests.documents.common.tbd');
  return [
    t('guests.documents.contract.title'),
    t('guests.documents.beo.client', { name: guest.fullName }),
    t('guests.documents.beo.contact', { phone: guest.phone ?? t('guests.documents.common.noPhone'), email: guest.email ?? t('guests.documents.common.noEmail') }),
    t('guests.documents.contract.eventAt', { name: event?.eventName ?? t('guests.documents.common.privateEvent'), space: event?.eventSpace ?? tbd }),
    t('guests.documents.beo.dateTime', { value: event ? formatFullDateTime(event.reservationTime) : tbd }),
    t('guests.documents.beo.guestCount', { value: event?.partySize ?? tbd }),
    t('guests.documents.contract.estimatedValue', { value: event?.estimatedValueCents ? formatMoney(event.estimatedValueCents) : tbd }),
    t('guests.documents.contract.depositDue', { value: event?.depositDueCents ? formatMoney(event.depositDueCents) : tbd }),
    t('guests.documents.contract.includedServices'),
    t('guests.documents.contract.paymentTerms'),
    t('guests.documents.contract.cancellationTerms'),
    t('guests.documents.contract.specialTerms', { value: event?.billingNotes ?? guest.notes ?? tbd }),
  ].join('\n');
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseLeadLines(value: string, defaultSource: string): LeadImportRow[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => !(index === 0 && /name/i.test(splitCsvLine(line)[0] ?? '')))
    .map((line) => {
      const [fullName, second, third, fourth, fifth, sixth, seventh] = splitCsvLine(line);
      const secondIsEmail = second?.includes('@');
      const thirdLooksLikePhone = Boolean(third?.match(/\d/));
      const email = secondIsEmail ? second : undefined;
      const phone = secondIsEmail ? (thirdLooksLikePhone ? third : undefined) : second || undefined;
      const source = secondIsEmail ? (thirdLooksLikePhone ? fourth : third) : third;
      const company = secondIsEmail ? (thirdLooksLikePhone ? fifth : fourth) : fourth;
      const tagsText = secondIsEmail ? (thirdLooksLikePhone ? sixth : fifth) : fifth;
      const notes = secondIsEmail ? (thirdLooksLikePhone ? seventh : sixth) : sixth;
      return {
        fullName,
        email,
        phone: phone || undefined,
        source: source || defaultSource || undefined,
        company: company || undefined,
        tags: tagsText ? splitTags(tagsText.replaceAll('|', ',')) : undefined,
        notes: notes || undefined,
        marketingOptIn: false,
      };
    })
    .filter((row) => row.fullName);
}

export default function GuestsScreenWrapper() {
  return <ScreenErrorBoundary><GuestsScreen /></ScreenErrorBoundary>;
}

function GuestsScreen() {
  return (
    <PremiumFeatureGate feature="CRM">
      <GuestsScreenInner />
    </PremiumFeatureGate>
  );
}

function GuestsScreenInner() {
  const { t } = useI18n();
  const { venue, isReady, canManage } = useVenueAuth();
  const guestList = useQuery(api.guests.listGuests, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as GuestListResponse | undefined;
  const guests = guestList?.guests;
  const upsertGuest = useMutation(api.guests.upsertGuest);
  const ingestLeads = useMutation(api.guests.ingestLeads);
  const removeGuest = useMutation(api.guests.removeGuest);

  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [showForm, setShowForm] = useState(false);
  const [showLeadImport, setShowLeadImport] = useState(false);
  const [selectedGuestId, setSelectedGuestId] = useState<Id<'guests'> | null>(null);
  const [editingGuestId, setEditingGuestId] = useState<Id<'guests'> | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [lifecycleStage, setLifecycleStage] = useState<LifecycleStage>('lead');
  const [source, setSource] = useState('');
  const [birthday, setBirthday] = useState('');
  const [company, setCompany] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [favoriteTable, setFavoriteTable] = useState('');
  const [preferredServer, setPreferredServer] = useState('');
  const [dietaryNotes, setDietaryNotes] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [leadSource, setLeadSource] = useState('Website');
  const [leadText, setLeadText] = useState('');
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadMessage, setLeadMessage] = useState<string | null>(null);
  const [leadMessageIsError, setLeadMessageIsError] = useState(false);

  const segmentOptions = useMemo(
    () => segmentDefs.map((option) => ({ value: option.value, label: t(`guests.segments.${option.key}`) })),
    [t],
  );
  const lifecycleOptions = useMemo(
    () => lifecycleDefs.map((option) => ({ value: option.value, label: t(`guests.lifecycle.${option.key}`) })),
    [t],
  );

  const selectedGuest = useMemo(() => guests?.find((guest) => guest._id === selectedGuestId) ?? guests?.[0] ?? null, [guests, selectedGuestId]);
  const profile = useQuery(
    api.guests.getGuestProfile,
    isReady && canManage && venue?.id && selectedGuest ? { venueId: venue.id, guestId: selectedGuest._id } : 'skip',
  ) as GuestProfile | null | undefined;

  useEffect(() => {
    if (!selectedGuestId && guests?.[0]) setSelectedGuestId(guests[0]._id);
  }, [guests, selectedGuestId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = guests ?? [];
    return rows.filter((guest) => {
      const matchesSearch = !q || [guest.fullName, guest.phone ?? '', guest.email ?? '', guest.company ?? '', guest.tags.join(' ')].some((value) => value.toLowerCase().includes(q));
      const matchesSegment =
        segment === 'all' ||
        guest.lifecycleStage === segment ||
        (segment === 'upcoming' && Boolean(guest.upcomingReservationAt)) ||
        (segment === 'needs_follow_up' && !guest.upcomingReservationAt && (guest.daysSinceLastVisit == null || guest.daysSinceLastVisit >= 30));
      return matchesSearch && matchesSegment;
    });
  }, [guests, query, segment]);

  const crmStats = useMemo(() => {
    const rows = guests ?? [];
    return {
      totalGuests: rows.length,
      vipGuests: rows.filter((guest) => guest.lifecycleStage === 'vip').length,
      upcomingGuests: rows.filter((guest) => guest.upcomingReservationAt).length,
      totalSpend: rows.reduce((sum, guest) => sum + guest.totalSpendCents, 0),
      optedIn: rows.filter((guest) => guest.marketingOptIn).length,
      needsFollowUp: rows.filter((guest) => !guest.upcomingReservationAt && (guest.daysSinceLastVisit == null || guest.daysSinceLastVisit >= 30)).length,
      leads: rows.filter((guest) => guest.lifecycleStage === 'lead').length,
    };
  }, [guests]);

  const resetForm = () => {
    setEditingGuestId(null);
    setFullName('');
    setPhone('');
    setEmail('');
    setLifecycleStage('lead');
    setSource('');
    setBirthday('');
    setCompany('');
    setMarketingOptIn(false);
    setFavoriteTable('');
    setPreferredServer('');
    setDietaryNotes('');
    setTags('');
    setNotes('');
    setError(null);
  };

  const startEdit = useCallback((guest: GuestRow) => {
    setEditingGuestId(guest._id);
    setFullName(guest.fullName);
    setPhone(guest.phone ?? '');
    setEmail(guest.email ?? '');
    setLifecycleStage(guest.lifecycleStage);
    setSource(guest.source ?? '');
    setBirthday(guest.birthday ?? '');
    setCompany(guest.company ?? '');
    setMarketingOptIn(guest.marketingOptIn);
    setFavoriteTable(guest.favoriteTable ?? '');
    setPreferredServer(guest.preferredServer ?? '');
    setDietaryNotes(guest.dietaryNotes ?? '');
    setTags(guest.tags.join(', '));
    setNotes(guest.notes ?? '');
    setShowForm(true);
  }, []);

  const saveGuest = async () => {
    if (!venue?.id || !fullName.trim()) {
      setError(t('guests.form.nameRequired'));
      return;
    }
    setError(null);
    try {
      const saved = await upsertGuest({
        venueId: venue.id,
        guestId: editingGuestId ?? undefined,
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        lifecycleStage,
        source: source.trim() || undefined,
        birthday: birthday.trim() || undefined,
        company: company.trim() || undefined,
        marketingOptIn,
        favoriteTable: favoriteTable.trim() || undefined,
        preferredServer: preferredServer.trim() || undefined,
        dietaryNotes: dietaryNotes.trim() || undefined,
        tags: splitTags(tags),
        notes: notes.trim() || undefined,
      });
      setSelectedGuestId(saved.id);
      setShowForm(false);
      resetForm();
    } catch (e) {
      setError(errorMessage(e, t('guests.form.saveError')));
    }
  };

  const deleteGuest = async (guestId: Id<'guests'>) => {
    if (!venue?.id) return;
    setDeleteError(null);
    try {
      await removeGuest({ venueId: venue.id, guestId });
      if (selectedGuestId === guestId) setSelectedGuestId(null);
    } catch (e) {
      setDeleteError(errorMessage(e, t('guests.detail.deleteError')));
    }
  };

  const importLeads = async () => {
    if (!venue?.id) return;
    const leads = parseLeadLines(leadText, leadSource);
    if (leads.length === 0) {
      setLeadMessage(t('guests.leadImport.pasteAtLeastOne'));
      setLeadMessageIsError(true);
      return;
    }
    setLeadBusy(true);
    setLeadMessage(null);
    setLeadMessageIsError(false);
    try {
      const result = await ingestLeads({ venueId: venue.id, leads });
      setLeadText('');
      setSegment('lead');
      setLeadMessage(
        t('guests.leadImport.imported', {
          created: result.created,
          leadWord: result.created === 1 ? t('guests.leadImport.leadSingular') : t('guests.leadImport.leadPlural'),
          updated: result.updated,
          skipped: result.skipped ? t('guests.leadImport.skippedCount', { skipped: result.skipped }) : '',
        }),
      );
      setLeadMessageIsError(false);
      if (result.guestIds[0]) setSelectedGuestId(result.guestIds[0]);
    } catch (e) {
      setLeadMessage(errorMessage(e, t('guests.leadImport.couldNotImport')));
      setLeadMessageIsError(true);
    } finally {
      setLeadBusy(false);
    }
  };

  const onOpenGuest = useCallback((id: Id<'guests'>) => setSelectedGuestId(id), []);
  const keyExtractor = useCallback((item: GuestRow) => String(item._id), []);
  const renderGuest = useCallback(
    ({ item }: { item: GuestRow }) => (
      <GuestListItem guest={item} isSelected={selectedGuest?._id === item._id} onOpen={onOpenGuest} onEdit={startEdit} />
    ),
    [selectedGuest?._id, onOpenGuest, startEdit],
  );

  if (!canManage) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>{t('guests.header.managerOnly')}</Text>
      </ScrollView>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
      data={filtered}
      keyExtractor={keyExtractor}
      renderItem={renderGuest}
      ItemSeparatorComponent={GuestListSeparator}
      removeClippedSubviews
      ListHeaderComponent={
        <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
          <SectionHeader
            kicker={t('guests.header.kicker')}
            title={t('guests.header.title')}
            subtitle={t('guests.header.subtitle', { venue: venue?.name ?? t('guests.header.yourVenue') })}
          />

          <CrmSalesWorkspace venueId={venue?.id} enabled={isReady && canManage} />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {[
              { label: t('guests.stats.guests'), value: String(crmStats.totalGuests), accent: accents[0] },
              { label: t('guests.stats.leads'), value: String(crmStats.leads), accent: accents[5] },
              { label: t('guests.stats.vips'), value: String(crmStats.vipGuests), accent: accents[1] },
              { label: t('guests.stats.upcoming'), value: String(crmStats.upcomingGuests), accent: accents[2] },
              { label: t('guests.stats.revenue'), value: formatMoney(crmStats.totalSpend), accent: accents[3] },
              { label: t('guests.stats.optedIn'), value: String(crmStats.optedIn), accent: accents[4] },
              { label: t('guests.stats.followUp'), value: String(crmStats.needsFollowUp), accent: accents[5] },
            ].map((metric) => (
              <Card key={metric.label} style={{ backgroundColor: metric.accent.bg, width: '31%', minWidth: 105, flexGrow: 1, borderRadius: radius.sharp }}>
                <Card.Content>
                  <Text style={{ color: metric.accent.fg, fontSize: 22, fontWeight: '800' }}>{metric.value}</Text>
                  <Text style={{ color: colors.charcoal }}>{metric.label}</Text>
                </Card.Content>
              </Card>
            ))}
          </View>

          <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('guests.directory.title')}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowLeadImport((value) => !value)} accessibilityLabel={showLeadImport ? t('guests.directory.closeLeadImportA11y') : t('guests.directory.importLeadsA11y')}>
                    {showLeadImport ? t('guests.directory.closeLeads') : t('guests.directory.importLeads')}
                  </Button>
                  <Button compact mode={showForm ? 'text' : 'contained'} buttonColor={showForm ? undefined : colors.primary} onPress={() => {
                    if (showForm) resetForm();
                    setShowForm((value) => !value);
                  }}>
                    {showForm ? t('guests.directory.close') : t('guests.directory.addGuest')}
                  </Button>
                </View>
              </View>
              <TextInput label={t('guests.directory.searchLabel')} value={query} onChangeText={setQuery} mode="outlined" style={{ backgroundColor: colors.surface }} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <SegmentedButtons
                  value={segment}
                  onValueChange={(value) => setSegment(value as Segment)}
                  buttons={segmentOptions.map((option) => ({ value: option.value, label: option.label }))}
                  style={{ minWidth: 560 }}
                />
              </ScrollView>
              {deleteError ? <Text style={{ color: colors.danger }}>{deleteError}</Text> : null}
              {showLeadImport ? (
                <Card style={{ backgroundColor: accents[5].bg, borderRadius: radius.sharp }}>
                  <Card.Content style={{ gap: spacing.sm }}>
                    <Text variant="titleSmall" style={{ color: accents[5].fg, fontWeight: '800' }}>{t('guests.leadImport.title')}</Text>
                    <Text style={{ color: colors.charcoal }}>
                      {t('guests.leadImport.description')}
                    </Text>
                    <TextInput label={t('guests.leadImport.defaultSourceLabel')} value={leadSource} onChangeText={setLeadSource} mode="outlined" style={{ backgroundColor: colors.surface }} />
                    <TextInput
                      label={t('guests.leadImport.leadsLabel')}
                      value={leadText}
                      onChangeText={setLeadText}
                      mode="outlined"
                      multiline
                      numberOfLines={6}
                      placeholder={t('guests.leadImport.leadsPlaceholder')}
                      style={{ backgroundColor: colors.surface, minHeight: 130 }}
                    />
                    {leadMessage ? <Text style={{ color: leadMessageIsError ? colors.danger : colors.charcoal }}>{leadMessage}</Text> : null}
                    <Button mode="contained" buttonColor={colors.primary} loading={leadBusy} disabled={leadBusy} onPress={() => void importLeads()} accessibilityLabel={t('guests.leadImport.ingestA11y')}>
                      {t('guests.leadImport.ingestButton')}
                    </Button>
                  </Card.Content>
                </Card>
              ) : null}
              {showForm ? (
                <View style={{ gap: spacing.sm }}>
                  <Text variant="titleSmall" style={{ fontWeight: '700' }}>{editingGuestId ? t('guests.form.editTitle') : t('guests.form.addTitle')}</Text>
                  <TextInput label={t('guests.form.fullName')} value={fullName} onChangeText={setFullName} mode="outlined" style={{ backgroundColor: colors.surface }} />
                  <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                    <TextInput label={t('guests.form.phone')} value={phone} onChangeText={setPhone} mode="outlined" keyboardType="phone-pad" style={{ flex: 1, minWidth: 150, backgroundColor: colors.surface }} />
                    <TextInput label={t('guests.form.email')} value={email} onChangeText={setEmail} mode="outlined" keyboardType="email-address" autoCapitalize="none" style={{ flex: 1, minWidth: 150, backgroundColor: colors.surface }} />
                  </View>
                  <SegmentedButtons
                    value={lifecycleStage}
                    onValueChange={(value) => setLifecycleStage(value as LifecycleStage)}
                    buttons={lifecycleOptions}
                  />
                  <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                    <TextInput label={t('guests.form.source')} value={source} onChangeText={setSource} mode="outlined" style={{ flex: 1, minWidth: 135, backgroundColor: colors.surface }} />
                    <TextInput label={t('guests.form.company')} value={company} onChangeText={setCompany} mode="outlined" style={{ flex: 1, minWidth: 135, backgroundColor: colors.surface }} />
                    <TextInput label={t('guests.form.birthday')} value={birthday} onChangeText={setBirthday} mode="outlined" style={{ flex: 1, minWidth: 135, backgroundColor: colors.surface }} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                    <TextInput label={t('guests.form.favoriteTable')} value={favoriteTable} onChangeText={setFavoriteTable} mode="outlined" style={{ flex: 1, minWidth: 135, backgroundColor: colors.surface }} />
                    <TextInput label={t('guests.form.preferredServer')} value={preferredServer} onChangeText={setPreferredServer} mode="outlined" style={{ flex: 1, minWidth: 135, backgroundColor: colors.surface }} />
                  </View>
                  <TextInput label={t('guests.form.dietaryNotes')} value={dietaryNotes} onChangeText={setDietaryNotes} mode="outlined" style={{ backgroundColor: colors.surface }} />
                  <TextInput label={t('guests.form.tags')} value={tags} onChangeText={setTags} mode="outlined" style={{ backgroundColor: colors.surface }} />
                  <TextInput label={t('guests.form.notes')} value={notes} onChangeText={setNotes} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                    <Text style={{ color: colors.charcoal, flex: 1 }}>{t('guests.form.marketingOptIn')}</Text>
                    <Switch value={marketingOptIn} onValueChange={setMarketingOptIn} color={colors.primary} />
                  </View>
                  {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
                  <Button mode="contained" buttonColor={colors.primary} onPress={() => void saveGuest()}>{editingGuestId ? t('guests.form.updateButton') : t('guests.form.saveButton')}</Button>
                </View>
              ) : null}
            </Card.Content>
          </Card>

          <Text variant="titleMedium" style={{ fontWeight: '800', color: colors.charcoal }}>
            {t('guests.list.guestsCount', { count: guestList?.totalCount ?? filtered.length })}
          </Text>
        </View>
      }
      ListEmptyComponent={
        guests === undefined ? (
          <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}><Card.Content><Text style={{ color: colors.muted }}>{t('guests.list.loading')}</Text></Card.Content></Card>
        ) : (
          <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}><Card.Content><Text style={{ color: colors.muted }}>{t('guests.list.empty')}</Text></Card.Content></Card>
        )
      }
      ListFooterComponent={
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '800', color: colors.charcoal }}>{t('guests.detail.profileTitle')}</Text>
          {!selectedGuest ? (
            <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}><Card.Content><Text style={{ color: colors.muted }}>{t('guests.detail.selectPrompt')}</Text></Card.Content></Card>
          ) : (
            <GuestProfilePanel
              guest={profile?.guest ?? selectedGuest}
              profile={profile}
              onEdit={() => startEdit(profile?.guest ?? selectedGuest)}
              onDelete={() => void deleteGuest(selectedGuest._id)}
            />
          )}
        </View>
      }
    />
  );
}

const GuestListSeparator = () => <View style={{ height: spacing.sm }} />;

type GuestListItemProps = {
  guest: GuestRow;
  isSelected: boolean;
  onOpen: (id: Id<'guests'>) => void;
  onEdit: (guest: GuestRow) => void;
};

const GuestListItem = memo(function GuestListItem({ guest, isSelected, onOpen, onEdit }: GuestListItemProps) {
  const { t } = useI18n();
  return (
    <Card style={{ backgroundColor: isSelected ? accents[2].bg : colors.surface, borderRadius: radius.sharp }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>{guest.fullName}</Text>
            <Text style={{ color: colors.charcoal }}>{guest.company ? `${guest.company} · ` : ''}{guest.phone || guest.email || t('guests.list.noContact')}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontWeight: '800', color: colors.charcoal }}>{scoreGuest(guest)}</Text>
            <Text style={{ color: colors.charcoal, fontSize: 12 }}>{t('guests.list.score')}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip compact>{guest.lifecycleStage.toUpperCase()}</Chip>
          {guest.marketingOptIn ? <Chip compact>{t('guests.list.optedIn')}</Chip> : null}
          {guest.tags.slice(0, 4).map((tag) => <Chip compact key={tag}>{tag}</Chip>)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Text style={{ color: colors.charcoal }}>{t('guests.list.visits', { count: guest.visitCount })}</Text>
          <Text style={{ color: colors.charcoal }}>{formatMoney(guest.totalSpendCents)}</Text>
          <Text style={{ color: colors.charcoal }}>{t('guests.list.last', { date: formatShortDate(guest.lastVisitAt) })}</Text>
          <Text style={{ color: colors.charcoal }}>{t('guests.list.next', { date: formatShortDate(guest.upcomingReservationAt) })}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => onOpen(guest._id)}>{t('guests.list.openProfile')}</Button>
          <Button compact mode="text" textColor={colors.primary} onPress={() => onEdit(guest)}>{t('guests.list.edit')}</Button>
        </View>
      </Card.Content>
    </Card>
  );
});

function GuestProfilePanel({ guest, profile, onEdit, onDelete }: { guest: GuestRow; profile: GuestProfile | null | undefined; onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const [generatedDocument, setGeneratedDocument] = useState('');
  const timeline = useMemo(() => {
    const reservations = (profile?.reservations ?? []).map((reservation) => ({
      id: reservation._id,
      at: reservation.reservationTime,
      title: t('guests.timeline.reservationTitle', { status: reservation.status }),
      body: reservation.notes
        ? t('guests.timeline.partyOfWithNotes', { party: reservation.partySize, notes: reservation.notes })
        : t('guests.timeline.partyOf', { party: reservation.partySize }),
      tags: reservation.tags,
    }));
    const checks = (profile?.checks ?? []).map((check) => {
      let body = check.revenueCenter ?? check.provider;
      if (check.guestCount) body += ` · ${t('guests.timeline.guestsCount', { count: check.guestCount })}`;
      if (check.tenderType) body += ` · ${check.tenderType}`;
      return {
        id: check._id,
        at: check.closedAt ?? check.openedAt,
        title: t('guests.timeline.checkTitle', { amount: formatMoney(check.totalCents), status: check.status }),
        body,
        tags: check.menuItems.slice(0, 3).map((item) => `${item.quantity}× ${item.name}`),
      };
    });
    return [...reservations, ...checks].sort((a, b) => b.at - a.at).slice(0, 12);
  }, [profile, t]);

  const topItems = useMemo(() => {
    const byName = new Map<string, { name: string; quantity: number; spendCents: number }>();
    for (const check of profile?.checks ?? []) {
      for (const item of check.menuItems) {
        const row = byName.get(item.name) ?? { name: item.name, quantity: 0, spendCents: 0 };
        row.quantity += item.quantity;
        row.spendCents += item.quantity * item.priceCents;
        byName.set(item.name, row);
      }
    }
    return Array.from(byName.values()).sort((a, b) => b.spendCents - a.spendCents).slice(0, 5);
  }, [profile]);

  return (
    <View style={{ gap: spacing.sm }}>
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text variant="headlineSmall" style={{ fontWeight: '800', color: colors.primary }}>{guest.fullName}</Text>
              <Text style={{ color: colors.muted }}>{guest.phone || t('guests.detail.noPhone')} · {guest.email || t('guests.detail.noEmail')}</Text>
              {guest.company ? <Text style={{ color: colors.muted }}>{guest.company}</Text> : null}
            </View>
            <Chip>{guest.lifecycleStage.toUpperCase()}</Chip>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Metric label={t('guests.detail.relationshipScore')} value={String(scoreGuest(guest))} />
            <Metric label={t('guests.detail.lifetimeSpend')} value={formatMoney(guest.totalSpendCents)} />
            <Metric label={t('guests.detail.avgCheck')} value={formatMoney(guest.averageSpendCents)} />
            <Metric label={t('guests.detail.visits')} value={String(guest.visitCount)} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {guest.tags.length > 0 ? guest.tags.map((tag) => <Chip compact key={tag}>{tag}</Chip>) : <Chip compact>{t('guests.detail.noTags')}</Chip>}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
            <Button compact mode="outlined" textColor={colors.primary} onPress={() => setGeneratedDocument(generateBeo(guest, profile, t))}>{t('guests.detail.generateBeo')}</Button>
            <Button compact mode="outlined" textColor={colors.primary} onPress={() => setGeneratedDocument(generateContract(guest, profile, t))}>{t('guests.detail.generateContract')}</Button>
            <Button compact mode="outlined" textColor={colors.primary} onPress={onEdit}>{t('guests.detail.editProfile')}</Button>
            <Button compact mode="text" textColor={colors.danger} onPress={onDelete}>{t('guests.detail.delete')}</Button>
          </View>
        </Card.Content>
      </Card>

      {generatedDocument ? (
        <Card style={{ backgroundColor: accents[5].bg, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ color: accents[5].fg, fontWeight: '800' }}>{t('guests.detail.generatedDocument')}</Text>
            <Text style={{ color: colors.charcoal }}>{t('guests.detail.generatedDocumentHint')}</Text>
            <TextInput value={generatedDocument} onChangeText={setGeneratedDocument} mode="outlined" multiline numberOfLines={12} style={{ backgroundColor: colors.surface, minHeight: 220 }} />
            <Button compact mode="text" textColor={colors.primary} onPress={() => setGeneratedDocument('')}>{t('guests.detail.clearDraft')}</Button>
          </Card.Content>
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('guests.preferences.title')}</Text>
          <Preference label={t('guests.preferences.favoriteTable')} value={guest.favoriteTable} />
          <Preference label={t('guests.preferences.preferredServer')} value={guest.preferredServer} />
          <Preference label={t('guests.preferences.birthday')} value={guest.birthday} />
          <Preference label={t('guests.preferences.source')} value={guest.source} />
          <Preference label={t('guests.preferences.dietaryNotes')} value={guest.dietaryNotes} />
          <Preference label={t('guests.preferences.marketing')} value={guest.marketingOptIn ? t('guests.preferences.optedIn') : t('guests.preferences.notOptedIn')} />
          {guest.notes ? <Text style={{ color: colors.charcoal }}>{guest.notes}</Text> : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('guests.intelligence.title')}</Text>
          <Text style={{ color: colors.muted }}>{t('guests.intelligence.lastNext', { last: formatShortDate(guest.lastVisitAt), next: formatShortDate(guest.upcomingReservationAt) })}</Text>
          {guest.daysSinceLastVisit == null ? (
            <Text style={{ color: colors.muted }}>{t('guests.intelligence.newGuest')}</Text>
          ) : guest.daysSinceLastVisit >= 30 && !guest.upcomingReservationAt ? (
            <Text style={{ color: colors.danger }}>{t('guests.intelligence.followUpCandidate', { days: guest.daysSinceLastVisit })}</Text>
          ) : (
            <Text style={{ color: colors.muted }}>{t('guests.intelligence.engaged')}</Text>
          )}
          {topItems.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={{ fontWeight: '700' }}>{t('guests.intelligence.favoriteItems')}</Text>
              {topItems.map((item) => (
                <Text key={item.name} style={{ color: colors.muted }}>{t('guests.intelligence.itemLine', { name: item.name, quantity: item.quantity, spend: formatMoney(item.spendCents) })}</Text>
              ))}
            </View>
          ) : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('guests.timeline.title')}</Text>
          {profile === undefined ? (
            <Text style={{ color: colors.muted }}>{t('guests.timeline.loading')}</Text>
          ) : timeline.length === 0 ? (
            <Text style={{ color: colors.muted }}>{t('guests.timeline.empty')}</Text>
          ) : timeline.map((item) => (
            <View key={String(item.id)} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 }}>
              <Text style={{ fontWeight: '700' }}>{item.title}</Text>
              <Text style={{ color: colors.muted }}>{formatShortDateTime(item.at)} · {item.body}</Text>
              {item.tags.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {item.tags.map((tag) => <Chip compact key={tag}>{tag}</Chip>)}
                </View>
              ) : null}
            </View>
          ))}
        </Card.Content>
      </Card>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ minWidth: 135, flexGrow: 1, padding: spacing.sm, borderRadius: radius.sharp, backgroundColor: accents[0].bg }}>
      <Text style={{ color: accents[0].fg, fontSize: 18, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: colors.charcoal, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function Preference({ label, value }: { label: string; value: string | null }) {
  const { t } = useI18n();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
      <Text style={{ color: colors.muted, flex: 1 }}>{label}</Text>
      <Text style={{ color: colors.charcoal, fontWeight: value ? '700' : '400', flex: 1, textAlign: 'right' }}>{value || t('guests.preferences.notSet')}</Text>
    </View>
  );
}
