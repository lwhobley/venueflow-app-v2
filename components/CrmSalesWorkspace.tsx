import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Divider, IconButton, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import type { Id } from '../lib/ids';
import { accents, colors, spacing } from '../lib/theme';
import { useIsDesktop } from '../lib/responsive';
import { asArray, dollarsToCents, errorMessage, formatMoneyWhole, formatShortDate, splitTags as baseSplitTags } from '../lib/format';
import { AnimatedTab } from './AppCard';
import type { WorkspaceView } from '../lib/crm-routing';

type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal_sent' | 'negotiating' | 'won' | 'lost' | 'unqualified' | 'on_hold';

type ForecastRow = { stage: string; probability: number; count: number; rawValueCents: number; weightedValueCents: number };
type ForecastResponse = { byStage: ForecastRow[]; totals: { leadCount: number; rawValueCents: number; weightedValueCents: number; wonCount: number; wonValueCents: number } };
type SourceRoiRow = { source: string; leadCount: number; wonCount: number; lostCount: number; pipelineValueCents: number; wonValueCents: number; winRate: number };
type StaleLead = { id: string; fullName: string; status: string; email: string | null; phone: string | null; lastActivityAt: number | null; estimatedValueCents: number; daysSinceActivity: number };
type StaleLeadsResponse = { thresholdDays: number; leads: StaleLead[] };
type ActivityRow = { id: string; kind: string; detail: string | null; actorId: string | null; actorName: string | null; createdAt: number };
type EmailTemplateRow = { id: string; name: string; subject: string; body: string; variables: string[]; updatedAt: number };

type LeadRow = {
  _id: Id<'crmLeads'>;
  fullName: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: string;
  status: LeadStatus;
  tags: string[];
  assignedToName?: string | null;
  estimatedValueCents?: number;
  lastActivityAt?: number;
  createdAt: number;
  updatedAt: number;
};

type BeoRow = {
  _id: Id<'crmBeos'>;
  leadId?: Id<'crmLeads'>;
  leadName?: string | null;
  /** Operational suite orders raised against this sales BEO. */
  suiteOrderCount?: number;
  eventName: string;
  eventDate?: number;
  eventType?: string;
  guestCount?: number;
  venueSpace?: string;
  setupStyle?: string;
  fbMinimumCents?: number;
  depositCents?: number;
  menuAppetizers?: string;
  menuEntrees?: string;
  menuDesserts?: string;
  menuBarPackage?: string;
  specialRequirements?: string;
  internalNotes?: string;
  status: string;
  updatedAt: number;
};

type ContractRow = {
  _id: Id<'crmContracts'>;
  leadId?: Id<'crmLeads'>;
  leadName?: string | null;
  contractNumber: string;
  eventName?: string;
  eventDate?: number;
  guestCount?: number;
  venueSpace?: string;
  fbMinimumCents?: number;
  status: string;
  updatedAt: number;
};

type LeadDetail = {
  lead: LeadRow;
  notes: Array<{ _id: Id<'crmNotes'>; text: string; authorName: string; createdAt: number }>;
  beos: BeoRow[];
  contracts: ContractRow[];
  activityLog: Array<{ _id: Id<'crmActivityLog'>; kind: string; detail?: string; createdAt: number }>;
};
type LeadListResponse = { leads: LeadRow[]; totalCount: number; page: number; limit: number };

const statusColumns: Array<{ status: LeadStatus; label: string; accent: (typeof accents)[number] }> = [
  { status: 'new', label: 'New', accent: accents[2] },
  { status: 'contacted', label: 'Contacted', accent: accents[4] },
  { status: 'qualified', label: 'Qualified', accent: accents[0] },
  { status: 'proposal_sent', label: 'Proposal', accent: accents[1] },
  { status: 'negotiating', label: 'Negotiating', accent: accents[3] },
  { status: 'won', label: 'Won', accent: accents[0] },
];

const lostStatuses: LeadStatus[] = ['lost', 'unqualified', 'on_hold'];

function dateInputValue(value: string) {
  const time = Date.parse(`${value}T12:00:00`);
  return Number.isFinite(time) ? time : undefined;
}

function splitTags(value: string) {
  return Array.from(new Set(baseSplitTags(value))).slice(0, 12);
}

export function CrmSalesWorkspace({
  venueId,
  enabled,
  initialView,
  initialEventName,
  initialBeoId,
}: {
  venueId: Id<'venues'> | undefined;
  enabled: boolean;
  /** Opens the workspace on a specific tab, so a BEO link can land on Events. */
  initialView?: WorkspaceView;
  /**
   * Filters the Events tab to one event name. A link from the published BEO
   * report arrives with the event's title, which is the only handle the sales
   * and operational BEO records share.
   */
  initialEventName?: string;
  /** Filters the Events tab to one BEO by record id, from a linked suite row. */
  initialBeoId?: string;
}) {
  const isDesktop = useIsDesktop();
  const [view, setView] = useState<WorkspaceView>(initialView ?? 'dashboard');
  // A second link to a different tab arrives as a prop change on a mounted
  // screen, so follow it rather than leaving the user on the previous tab.
  useEffect(() => {
    if (initialView) setView(initialView);
  }, [initialView]);
  const [eventFilter, setEventFilter] = useState<string>(initialEventName ?? '');
  useEffect(() => {
    setEventFilter(initialEventName ?? '');
  }, [initialEventName]);
  const [beoIdFilter, setBeoIdFilter] = useState<string>(initialBeoId ?? '');
  useEffect(() => {
    setBeoIdFilter(initialBeoId ?? '');
  }, [initialBeoId]);
  const clearBeoFilters = () => {
    setEventFilter('');
    setBeoIdFilter('');
  };
  const [leadSearch, setLeadSearch] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<Id<'crmLeads'> | null>(null);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [leadName, setLeadName] = useState('');
  const [leadCompany, setLeadCompany] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadSource, setLeadSource] = useState('Website');
  const [leadValue, setLeadValue] = useState('');
  const [leadTags, setLeadTags] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventType, setEventType] = useState('Private dining');
  const [eventGuests, setEventGuests] = useState('');
  const [eventSpace, setEventSpace] = useState('');
  const [eventSetup, setEventSetup] = useState('');
  const [eventMinimum, setEventMinimum] = useState('');
  const [eventDeposit, setEventDeposit] = useState('');
  const [eventApps, setEventApps] = useState('');
  const [eventEntrees, setEventEntrees] = useState('');
  const [eventDesserts, setEventDesserts] = useState('');
  const [eventBar, setEventBar] = useState('');
  const [eventSpecial, setEventSpecial] = useState('');
  const [eventInternal, setEventInternal] = useState('');
  const [noteText, setNoteText] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const leadList = useQuery(api.crm.listLeads, enabled && venueId ? { venueId, search: leadSearch || undefined } : 'skip') as LeadListResponse | undefined;
  const leads = leadList?.leads;
  const beos = useQuery(api.crm.listBeos, enabled && venueId ? { venueId } : 'skip') as BeoRow[] | undefined;
  const contracts = useQuery(api.crm.listContracts, enabled && venueId ? { venueId } : 'skip') as ContractRow[] | undefined;
  const detail = useQuery(api.crm.getLead, enabled && venueId && selectedLeadId ? { venueId, leadId: selectedLeadId } : 'skip') as LeadDetail | null | undefined;
  const forecast = useQuery(api.crm.getForecast, enabled && venueId ? { venueId } : 'skip') as ForecastResponse | undefined;
  const sourceRoi = useQuery(api.crm.getSourceRoi, enabled && venueId ? { venueId } : 'skip') as SourceRoiRow[] | undefined;
  const staleLeads = useQuery(api.crm.getStaleLeads, enabled && venueId ? { venueId, days: 7 } : 'skip') as StaleLeadsResponse | undefined;
  const leadActivity = useQuery(api.crm.getLeadActivity, enabled && venueId && selectedLeadId ? { venueId, leadId: selectedLeadId } : 'skip') as ActivityRow[] | undefined;
  const templates = useQuery(api.crm.listTemplates, enabled && venueId ? { venueId } : 'skip') as EmailTemplateRow[] | undefined;
  const saveLead = useMutation(api.crm.saveLead);
  const saveBeo = useMutation(api.crm.saveBeo);
  const saveContract = useMutation(api.crm.saveContract);
  const convertBeoToContract = useMutation(api.crm.convertBeoToContract);
  const addNote = useMutation(api.crm.addNote);
  const emailBeo = useMutation(api.crm.emailBeo);
  const saveTemplate = useMutation(api.crm.saveTemplate);
  const deleteTemplate = useMutation(api.crm.deleteTemplate);

  const selectedLead = detail?.lead ?? leads?.find((lead) => lead._id === selectedLeadId) ?? null;
  const openLeads = useMemo(() => asArray(leads).filter((lead) => !lostStatuses.includes(lead.status) && lead.status !== 'won'), [leads]);
  const stats = useMemo(() => {
    const rows = asArray(leads);
    const events = asArray(beos);
    const docs = asArray(contracts);
    return {
      pipelineCents: openLeads.reduce((sum, lead) => sum + (lead.estimatedValueCents ?? 0), 0),
      wonCents: rows.filter((lead) => lead.status === 'won').reduce((sum, lead) => sum + (lead.estimatedValueCents ?? 0), 0),
      openCount: openLeads.length,
      proposalCount: rows.filter((lead) => lead.status === 'proposal_sent' || lead.status === 'negotiating').length,
      eventCount: events.length,
      contractCount: docs.length,
    };
  }, [beos, contracts, leads, openLeads]);

  const saveNewLead = async () => {
    if (!venueId || !leadName.trim()) {
      setMessage('Lead name is required.');
      return;
    }
    try {
      const leadId = await saveLead({
        venueId,
        fullName: leadName.trim(),
        company: leadCompany.trim() || undefined,
        email: leadEmail.trim() || undefined,
        phone: leadPhone.trim() || undefined,
        source: leadSource.trim() || undefined,
        status: 'new',
        tags: splitTags(leadTags),
        estimatedValueCents: dollarsToCents(leadValue),
        marketingOptIn: false,
      });
      setSelectedLeadId(leadId);
      setShowLeadForm(false);
      setLeadName('');
      setLeadCompany('');
      setLeadEmail('');
      setLeadPhone('');
      setLeadValue('');
      setLeadTags('');
      setMessage('Lead created.');
    } catch (err) {
      setMessage(`Failed to create lead: ${errorMessage(err)}`);
    }
  };

  const updateLeadStatus = async (leadId: Id<'crmLeads'>, status: LeadStatus) => {
    if (!venueId) return;
    const target = leads?.find((l) => l._id === leadId) ?? (detail?.lead?._id === leadId ? detail.lead : null);
    if (!target) return;
    try {
      await saveLead({ venueId, leadId, fullName: target.fullName, status });
      setMessage(`Moved to ${status.replace('_', ' ')}.`);
    } catch (err) {
      setMessage(`Failed to update lead: ${errorMessage(err)}`);
    }
  };

  const createEventDoc = async () => {
    if (!venueId || !eventName.trim()) {
      setMessage('Event name is required.');
      return;
    }
    try {
      const beoId = await saveBeo({
        venueId,
        leadId: selectedLead?._id,
        eventName: eventName.trim(),
        eventDate: dateInputValue(eventDate),
        eventType: eventType.trim() || undefined,
        guestCount: Number(eventGuests) || undefined,
        venueSpace: eventSpace.trim() || undefined,
        setupStyle: eventSetup.trim() || undefined,
        fbMinimumCents: dollarsToCents(eventMinimum),
        depositCents: dollarsToCents(eventDeposit),
        menuAppetizers: eventApps.trim() || undefined,
        menuEntrees: eventEntrees.trim() || undefined,
        menuDesserts: eventDesserts.trim() || undefined,
        menuBarPackage: eventBar.trim() || undefined,
        specialRequirements: eventSpecial.trim() || undefined,
        internalNotes: eventInternal.trim() || undefined,
        status: 'draft',
      });
      setShowEventForm(false);
      setEventName('');
      setEventDate('');
      setEventGuests('');
      setEventSpace('');
      setEventSetup('');
      setEventMinimum('');
      setEventDeposit('');
      setEventApps('');
      setEventEntrees('');
      setEventDesserts('');
      setEventBar('');
      setEventSpecial('');
      setEventInternal('');
      setMessage('BEO draft created.');
      return beoId;
    } catch (err) {
      setMessage(`Failed to create BEO: ${errorMessage(err)}`);
    }
  };

  const createContractFromLead = async () => {
    if (!venueId || !selectedLead) return;
    const depositCents = dollarsToCents(eventDeposit);
    try {
      await saveContract({
        venueId,
        leadId: selectedLead._id,
        eventName: eventName.trim() || `${selectedLead.company ?? selectedLead.fullName} event`,
        eventDate: dateInputValue(eventDate),
        guestCount: Number(eventGuests) || undefined,
        venueSpace: eventSpace.trim() || undefined,
        fbMinimumCents: dollarsToCents(eventMinimum) ?? selectedLead.estimatedValueCents,
        paymentSchedule: depositCents ? [{ amountCents: depositCents, dueDate: Date.now(), type: 'deposit' as const }] : undefined,
        cancellationPolicy: 'Deposit is non-refundable after the booking deadline. Final balance is due before event start.',
        forceMajeure: true,
        liabilityWaiver: true,
        status: 'draft',
      });
      setEventName('');
      setEventDate('');
      setEventGuests('');
      setEventSpace('');
      setEventMinimum('');
      setEventDeposit('');
      setMessage('Contract draft created.');
    } catch (err) {
      setMessage(`Failed to create contract: ${errorMessage(err)}`);
    }
  };

  const saveNote = async () => {
    if (!venueId || !selectedLead || !noteText.trim()) return;
    try {
      await addNote({ venueId, leadId: selectedLead._id, text: noteText.trim() });
      setNoteText('');
      setMessage('Note added.');
    } catch (err) {
      setMessage(`Failed to save note: ${errorMessage(err)}`);
    }
  };

  if (!enabled || !venueId) return null;

  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: 8 }}>
      <Card.Content style={{ gap: spacing.md }}>
        <View style={{ flexDirection: isDesktop ? 'row' : 'column', justifyContent: 'space-between', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text variant="headlineSmall" style={{ color: colors.primary, fontWeight: '800' }}>CRM workspace</Text>
            <Text style={{ color: colors.muted }}>Pipeline, contacts, event documents, contracts, and follow-up activity in one place.</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Button compact mode="outlined" icon="calendar-plus" textColor={colors.primary} onPress={() => setShowEventForm((value) => !value)}>
              BEO
            </Button>
            <Button compact mode="contained" icon="account-plus" buttonColor={colors.primary} onPress={() => setShowLeadForm((value) => !value)}>
              Lead
            </Button>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <SegmentedButtons
            value={view}
            onValueChange={(value) => setView(value as WorkspaceView)}
            buttons={[
              { value: 'dashboard', label: 'Dashboard' },
              { value: 'pipeline', label: 'Pipeline' },
              { value: 'contacts', label: 'Contacts' },
              { value: 'events', label: 'Events' },
              { value: 'contracts', label: 'Contracts' },
              { value: 'insights', label: 'Insights' },
              { value: 'templates', label: 'Templates' },
            ]}
            style={{ minWidth: 920 }}
          />
        </ScrollView>

        {message ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: 8, backgroundColor: accents[2].bg }}>
            <Text style={{ color: accents[2].fg, flex: 1, fontWeight: '700' }}>{message}</Text>
            <IconButton icon="close" size={16} onPress={() => setMessage(null)} style={{ margin: 0 }} />
          </View>
        ) : null}

        {showLeadForm ? (
          <View style={{ gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
            <Text variant="titleSmall" style={{ fontWeight: '800' }}>Create lead</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <TextInput label="Name" value={leadName} onChangeText={setLeadName} mode="outlined" style={{ flex: 1, minWidth: 170, backgroundColor: colors.surface }} />
              <TextInput label="Company" value={leadCompany} onChangeText={setLeadCompany} mode="outlined" style={{ flex: 1, minWidth: 170, backgroundColor: colors.surface }} />
              <TextInput label="Deal value" value={leadValue} onChangeText={setLeadValue} mode="outlined" keyboardType="numeric" style={{ width: 140, backgroundColor: colors.surface }} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <TextInput label="Email" value={leadEmail} onChangeText={setLeadEmail} mode="outlined" autoCapitalize="none" style={{ flex: 1, minWidth: 170, backgroundColor: colors.surface }} />
              <TextInput label="Phone" value={leadPhone} onChangeText={setLeadPhone} mode="outlined" style={{ flex: 1, minWidth: 150, backgroundColor: colors.surface }} />
              <TextInput label="Source" value={leadSource} onChangeText={setLeadSource} mode="outlined" style={{ flex: 1, minWidth: 130, backgroundColor: colors.surface }} />
            </View>
            <TextInput label="Tags" value={leadTags} onChangeText={setLeadTags} mode="outlined" style={{ backgroundColor: colors.surface }} />
            <Button mode="contained" buttonColor={colors.primary} onPress={() => void saveNewLead()}>Save lead</Button>
          </View>
        ) : null}

        {showEventForm ? (
          <View style={{ gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
            <Text variant="titleSmall" style={{ fontWeight: '800' }}>Create event document</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <TextInput label="Event name" value={eventName} onChangeText={setEventName} mode="outlined" style={{ flex: 1, minWidth: 190, backgroundColor: colors.surface }} />
              <TextInput label="Date (YYYY-MM-DD)" value={eventDate} onChangeText={setEventDate} mode="outlined" style={{ width: 165, backgroundColor: colors.surface }} />
              <TextInput label="Guest count" value={eventGuests} onChangeText={setEventGuests} mode="outlined" keyboardType="numeric" style={{ width: 130, backgroundColor: colors.surface }} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <TextInput label="Type" value={eventType} onChangeText={setEventType} mode="outlined" style={{ flex: 1, minWidth: 150, backgroundColor: colors.surface }} />
              <TextInput label="Space" value={eventSpace} onChangeText={setEventSpace} mode="outlined" style={{ flex: 1, minWidth: 150, backgroundColor: colors.surface }} />
              <TextInput label="Setup" value={eventSetup} onChangeText={setEventSetup} mode="outlined" style={{ flex: 1, minWidth: 150, backgroundColor: colors.surface }} />
              <TextInput label="F&B minimum" value={eventMinimum} onChangeText={setEventMinimum} mode="outlined" keyboardType="numeric" style={{ width: 150, backgroundColor: colors.surface }} />
              <TextInput label="Deposit" value={eventDeposit} onChangeText={setEventDeposit} mode="outlined" keyboardType="numeric" style={{ width: 130, backgroundColor: colors.surface }} />
            </View>
            <Text variant="titleSmall" style={{ fontWeight: '800' }}>Food and beverage</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <TextInput label="Appetizers" value={eventApps} onChangeText={setEventApps} mode="outlined" multiline style={{ flex: 1, minWidth: 210, backgroundColor: colors.surface }} />
              <TextInput label="Entrees" value={eventEntrees} onChangeText={setEventEntrees} mode="outlined" multiline style={{ flex: 1, minWidth: 210, backgroundColor: colors.surface }} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <TextInput label="Desserts" value={eventDesserts} onChangeText={setEventDesserts} mode="outlined" multiline style={{ flex: 1, minWidth: 210, backgroundColor: colors.surface }} />
              <TextInput label="Bar package" value={eventBar} onChangeText={setEventBar} mode="outlined" multiline style={{ flex: 1, minWidth: 210, backgroundColor: colors.surface }} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <TextInput label="Guest requirements" value={eventSpecial} onChangeText={setEventSpecial} mode="outlined" multiline style={{ flex: 1, minWidth: 230, backgroundColor: colors.surface }} />
              <TextInput label="Internal run-of-show notes" value={eventInternal} onChangeText={setEventInternal} mode="outlined" multiline style={{ flex: 1, minWidth: 230, backgroundColor: colors.surface }} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' }}>
              <Button mode="outlined" textColor={colors.primary} onPress={() => void createEventDoc()}>Save BEO</Button>
              <Button mode="contained" buttonColor={colors.primary} disabled={!selectedLead} onPress={() => void createContractFromLead()}>Contract</Button>
            </View>
          </View>
        ) : null}

        <AnimatedTab tabKey={view}>
          {view === 'dashboard' ? (
            <DashboardView stats={stats} leads={leads} beos={beos} contracts={contracts} onSelectLead={setSelectedLeadId} onView={setView} />
          ) : null}

          {view === 'pipeline' ? (
            <PipelineView leads={leads} selectedLeadId={selectedLead?._id ?? null} onSelectLead={setSelectedLeadId} onMove={(leadId, status) => void updateLeadStatus(leadId, status)} />
          ) : null}

          {view === 'contacts' ? (
            <ContactsView leads={leads} search={leadSearch} onSearch={setLeadSearch} onSelectLead={setSelectedLeadId} />
          ) : null}

          {view === 'events' ? (
            <EventsView beos={beos} eventFilter={eventFilter} beoIdFilter={beoIdFilter} onClearFilter={clearBeoFilters} onConvert={async (beoId) => {
              if (!venueId) return;
              try {
                await convertBeoToContract({ venueId, beoId });
                setMessage('Converted BEO to contract.');
              } catch (err) {
                setMessage(`Failed to convert: ${errorMessage(err)}`);
              }
            }} />
          ) : null}

          {view === 'contracts' ? (
            <ContractsView contracts={contracts} />
          ) : null}

          {view === 'insights' ? (
            <InsightsView
              forecast={forecast}
              sourceRoi={sourceRoi}
              staleLeads={staleLeads}
              onSelectLead={setSelectedLeadId}
            />
          ) : null}

          {view === 'templates' ? (
            <TemplatesView
              templates={asArray(templates)}
              onSave={async (tpl) => {
                try {
                  await saveTemplate({ venueId, ...tpl });
                  setMessage(tpl.templateId ? 'Template updated.' : 'Template saved.');
                } catch (err) {
                  setMessage(`Failed to save: ${errorMessage(err)}`);
                }
              }}
              onDelete={async (templateId) => {
                try {
                  await deleteTemplate({ venueId, templateId });
                  setMessage('Template deleted.');
                } catch (err) {
                  setMessage(`Failed to delete: ${errorMessage(err)}`);
                }
              }}
            />
          ) : null}
        </AnimatedTab>

        <Divider />

        <LeadDetailPanel
          lead={selectedLead}
          detail={detail}
          activity={asArray(leadActivity)}
          beos={asArray(detail?.beos)}
          onEmailBeo={async (beoId, toEmail, message) => {
            try {
              await emailBeo({ venueId, beoId, toEmail, message });
              setMessage(`BEO emailed to ${toEmail}.`);
            } catch (err) {
              setMessage(`Failed to send: ${errorMessage(err)}`);
            }
          }}
          noteText={noteText}
          onNoteText={setNoteText}
          onSaveNote={() => void saveNote()}
          onMove={(status) => { if (selectedLead) void updateLeadStatus(selectedLead._id, status); }}
        />
      </Card.Content>
    </Card>
  );
}

function DashboardView({
  stats,
  leads,
  beos,
  contracts,
  onSelectLead,
  onView,
}: {
  stats: { pipelineCents: number; wonCents: number; openCount: number; proposalCount: number; eventCount: number; contractCount: number };
  leads: LeadRow[] | undefined;
  beos: BeoRow[] | undefined;
  contracts: ContractRow[] | undefined;
  onSelectLead: (id: Id<'crmLeads'>) => void;
  onView: (view: WorkspaceView) => void;
}) {
  const hotLeads = [...asArray(leads)].sort((a, b) => (b.estimatedValueCents ?? 0) - (a.estimatedValueCents ?? 0)).slice(0, 5);
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <StatTile label="Pipeline" value={formatMoneyWhole(stats.pipelineCents)} accent={accents[0]} />
        <StatTile label="Open deals" value={String(stats.openCount)} accent={accents[2]} />
        <StatTile label="Proposals" value={String(stats.proposalCount)} accent={accents[1]} />
        <StatTile label="Won revenue" value={formatMoneyWhole(stats.wonCents)} accent={accents[4]} />
        <StatTile label="BEOs" value={String(stats.eventCount)} accent={accents[3]} />
        <StatTile label="Contracts" value={String(stats.contractCount)} accent={accents[5]} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        <View style={{ flexGrow: 1, flexBasis: 320, gap: spacing.sm }}>
          <SectionHeader title="Priority deals" action="Pipeline" onPress={() => onView('pipeline')} />
          {hotLeads.length === 0 ? <EmptyLine text="No lead pipeline yet." /> : hotLeads.map((lead) => <LeadListRow key={lead._id} lead={lead} onPress={() => onSelectLead(lead._id)} />)}
        </View>
        <View style={{ flexGrow: 1, flexBasis: 320, gap: spacing.sm }}>
          <SectionHeader title="Recent documents" action="Docs" onPress={() => onView('events')} />
          {asArray(beos).slice(0, 3).map((beo) => <DocRow key={beo._id} title={beo.eventName} subtitle={`${beo.leadName ?? 'Unlinked'} - ${formatShortDate(beo.eventDate, 'TBD')}`} status={beo.status} />)}
          {asArray(contracts).slice(0, 3).map((contract) => <DocRow key={contract._id} title={contract.eventName ?? contract.contractNumber} subtitle={`${contract.leadName ?? 'Unlinked'} - ${contract.contractNumber}`} status={contract.status} />)}
          {!(beos?.length || contracts?.length) ? <EmptyLine text="No BEOs or contracts yet." /> : null}
        </View>
      </View>
    </View>
  );
}

function PipelineView({
  leads,
  selectedLeadId,
  onSelectLead,
  onMove,
}: {
  leads: LeadRow[] | undefined;
  selectedLeadId: Id<'crmLeads'> | null;
  onSelectLead: (id: Id<'crmLeads'>) => void;
  onMove: (leadId: Id<'crmLeads'>, status: LeadStatus) => void;
}) {
  const selectedLead = asArray(leads).find((lead) => lead._id === selectedLeadId) ?? null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.xs }}>
        {statusColumns.map((column) => {
          const rows = asArray(leads).filter((lead) => lead.status === column.status);
          const total = rows.reduce((sum, lead) => sum + (lead.estimatedValueCents ?? 0), 0);
          const canMoveSelectedHere = selectedLead != null && selectedLead.status !== column.status;
          return (
            <View key={column.status} style={{ width: 245, gap: spacing.sm, padding: spacing.sm, borderRadius: 8, backgroundColor: column.accent.bg }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: column.accent.fg, fontWeight: '800' }}>{column.label}</Text>
                  <Text style={{ color: colors.charcoal, fontSize: 12 }}>{rows.length} deals - {formatMoneyWhole(total)}</Text>
                </View>
                {canMoveSelectedHere ? (
                  <Button compact mode="text" textColor={colors.primary} onPress={() => onMove(selectedLead._id, column.status)}>Move here</Button>
                ) : null}
              </View>
              {rows.length === 0 ? <Text style={{ color: colors.charcoal, fontSize: 12 }}>No deals in this stage.</Text> : rows.map((lead) => (
                <View key={lead._id} style={{ padding: spacing.sm, borderRadius: 8, backgroundColor: colors.surface, borderWidth: selectedLeadId === lead._id ? 1 : 0, borderColor: column.accent.fg }}>
                  <Text style={{ color: colors.charcoal, fontWeight: '800' }}>{lead.fullName}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{lead.company ?? lead.source ?? 'No company'} - {formatMoneyWhole(lead.estimatedValueCents)}</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', marginTop: spacing.xs }}>
                    <Button compact mode="text" textColor={colors.primary} onPress={() => onSelectLead(lead._id)}>{selectedLeadId === lead._id ? 'Selected' : 'Select'}</Button>
                  </View>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function ContactsView({ leads, search, onSearch, onSelectLead }: { leads: LeadRow[] | undefined; search: string; onSearch: (value: string) => void; onSelectLead: (id: Id<'crmLeads'>) => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <TextInput label="Search contacts and deals" value={search} onChangeText={onSearch} mode="outlined" style={{ backgroundColor: colors.surface }} />
      {asArray(leads).length === 0 ? <EmptyLine text="No matching CRM contacts." /> : asArray(leads).map((lead) => (
        <LeadListRow key={lead._id} lead={lead} onPress={() => onSelectLead(lead._id)} />
      ))}
    </View>
  );
}

function EventsView({
  beos,
  eventFilter,
  beoIdFilter,
  onClearFilter,
  onConvert,
}: {
  beos: BeoRow[] | undefined;
  /** Event name to narrow the list to, from a report link. Empty shows all. */
  eventFilter?: string;
  /** Exact BEO record id, from a suite order that carries a link. Wins over name. */
  beoIdFilter?: string;
  onClearFilter?: () => void;
  onConvert: (beoId: Id<'crmBeos'>) => Promise<void>;
}) {
  const needle = eventFilter?.trim().toLocaleLowerCase() ?? '';
  const targetId = beoIdFilter?.trim() ?? '';
  const all = asArray(beos);
  // An id is exact, so it takes precedence over a name match.
  const matching = targetId
    ? all.filter((beo) => beo._id === targetId)
    : needle
      ? all.filter((beo) => beo.eventName.toLocaleLowerCase().includes(needle))
      : all;
  const filtered = Boolean(targetId || needle);
  const filterLabel = targetId ? 'the linked BEO' : `"${eventFilter}"`;
  return (
    <View style={{ gap: spacing.sm }}>
      {filtered ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Text style={{ color: colors.muted, flex: 1 }}>
            {matching.length
              ? `Showing ${matching.length} of ${all.length} BEOs for ${filterLabel}.`
              : targetId
                ? 'That linked BEO is no longer in this venue’s list.'
                : `No BEO drafts match ${filterLabel}. This event may only have suite orders.`}
          </Text>
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => onClearFilter?.()}>
            Show all
          </Button>
        </View>
      ) : null}
      {matching.length === 0 && !filtered ? <EmptyLine text="No BEO drafts yet." /> : matching.map((beo) => (
        <View key={beo._id} style={{ padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8, gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: colors.charcoal }}>{beo.eventName}</Text>
              <Text style={{ color: colors.muted }}>{beo.leadName ?? 'Unlinked'} - {formatShortDate(beo.eventDate, 'TBD')} - {beo.guestCount ?? 'TBD'} guests</Text>
            </View>
            <Chip compact>{beo.status}</Chip>
          </View>
          <Text style={{ color: colors.muted }}>Space {beo.venueSpace ?? 'TBD'} - Minimum {formatMoneyWhole(beo.fbMinimumCents)} - Deposit {formatMoneyWhole(beo.depositCents)}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {beo.eventType ? <Chip compact>{beo.eventType}</Chip> : null}
            {beo.setupStyle ? <Chip compact>{beo.setupStyle}</Chip> : null}
            {beo.menuBarPackage ? <Chip compact>{beo.menuBarPackage}</Chip> : null}
            {beo.suiteOrderCount ? (
              <Chip compact icon="room-service-outline">
                {beo.suiteOrderCount} suite {beo.suiteOrderCount === 1 ? 'order' : 'orders'}
              </Chip>
            ) : null}
          </View>
          {[
            { label: 'Apps', value: beo.menuAppetizers },
            { label: 'Entrees', value: beo.menuEntrees },
            { label: 'Dessert', value: beo.menuDesserts },
            { label: 'Guest needs', value: beo.specialRequirements },
            { label: 'Run-of-show', value: beo.internalNotes },
          ].filter((item) => item.value).map((item) => (
            <Text key={item.label} style={{ color: colors.charcoal, fontSize: 12 }}>
              <Text style={{ fontWeight: '800' }}>{item.label}: </Text>{item.value}
            </Text>
          ))}
          <Button compact mode="outlined" icon="file-sign" textColor={colors.primary} onPress={() => void onConvert(beo._id)}>Convert to contract</Button>
        </View>
      ))}
    </View>
  );
}

function ContractsView({ contracts }: { contracts: ContractRow[] | undefined }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {asArray(contracts).length === 0 ? <EmptyLine text="No contracts yet." /> : asArray(contracts).map((contract) => (
        <DocRow
          key={contract._id}
          title={contract.eventName ?? contract.contractNumber}
          subtitle={`${contract.leadName ?? 'Unlinked'} - ${formatShortDate(contract.eventDate, 'TBD')} - ${contract.guestCount ?? 'TBD'} guests - ${formatMoneyWhole(contract.fbMinimumCents)}`}
          status={contract.status}
        />
      ))}
    </View>
  );
}

function LeadDetailPanel({
  lead,
  detail,
  activity,
  beos,
  onEmailBeo,
  noteText,
  onNoteText,
  onSaveNote,
  onMove,
}: {
  lead: LeadRow | null;
  detail: LeadDetail | null | undefined;
  activity: ActivityRow[];
  beos: BeoRow[];
  onEmailBeo: (beoId: string, toEmail: string, message?: string) => Promise<void>;
  noteText: string;
  onNoteText: (value: string) => void;
  onSaveNote: () => void;
  onMove: (status: LeadStatus) => void;
}) {
  const [emailingBeoId, setEmailingBeoId] = useState<string | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailMsg, setEmailMsg] = useState('');
  if (!lead) return <EmptyLine text="Select a deal to open the CRM record." />;
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Text variant="titleLarge" style={{ color: colors.primary, fontWeight: '800' }}>{lead.fullName}</Text>
          <Text style={{ color: colors.muted }}>{lead.company ?? 'No company'} - {lead.email ?? lead.phone ?? 'No contact'} - {formatMoneyWhole(lead.estimatedValueCents)}</Text>
        </View>
        <Chip>{lead.status.replace('_', ' ').toUpperCase()}</Chip>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {statusColumns.map((column) => (
            <Button key={column.status} compact mode={lead.status === column.status ? 'contained' : 'outlined'} buttonColor={lead.status === column.status ? colors.primary : undefined} textColor={lead.status === column.status ? colors.surface : colors.primary} onPress={() => onMove(column.status)}>
              {column.label}
            </Button>
          ))}
          <Button compact mode="outlined" textColor={colors.danger} onPress={() => onMove('lost')}>Lost</Button>
        </View>
      </ScrollView>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        <View style={{ flexGrow: 1, flexBasis: 300, gap: spacing.sm }}>
          <Text variant="titleSmall" style={{ fontWeight: '800' }}>Activity</Text>
          <TextInput label="Log note or next step" value={noteText} onChangeText={onNoteText} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
          <Button mode="contained" buttonColor={colors.primary} disabled={!noteText.trim()} onPress={onSaveNote}>Add note</Button>
          {detail === undefined ? <Text style={{ color: colors.muted }}>Loading activity...</Text> : null}
          {asArray(detail?.notes).slice(0, 4).map((note) => (
            <View key={note._id} style={{ padding: spacing.sm, borderRadius: 8, backgroundColor: colors.background }}>
              <Text style={{ color: colors.charcoal }}>{note.text}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{note.authorName} - {formatShortDate(note.createdAt)}</Text>
            </View>
          ))}
        </View>
        <View style={{ flexGrow: 1, flexBasis: 300, gap: spacing.sm }}>
          <Text variant="titleSmall" style={{ fontWeight: '800' }}>Timeline</Text>
          {activity.length === 0 ? <Text style={{ color: colors.muted, fontSize: 13 }}>No activity yet.</Text> : null}
          {activity.slice(0, 8).map((item) => (
            <View key={item.id} style={{ paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontWeight: '700', color: colors.charcoal, fontSize: 13 }}>{item.kind.replace(/_/g, ' ')}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {item.actorName ? `${item.actorName} · ` : ''}{formatShortDate(item.createdAt)}{item.detail ? ` · ${item.detail}` : ''}
              </Text>
            </View>
          ))}
          {(beos.length || (detail?.contracts?.length ?? 0)) ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={{ fontWeight: '800' }}>Documents</Text>
              {beos.slice(0, 3).map((beo) => (
                <View key={beo._id} style={{ gap: 4, padding: spacing.xs, borderRadius: 6, backgroundColor: colors.background }}>
                  <Text style={{ color: colors.charcoal }}>BEO · {beo.eventName} · {beo.status}</Text>
                  {emailingBeoId === beo._id ? (
                    <View style={{ gap: 4 }}>
                      <TextInput dense label="Recipient email" value={emailTo} onChangeText={setEmailTo} mode="outlined" autoCapitalize="none" style={{ backgroundColor: colors.surface }} />
                      <TextInput dense label="Optional message" value={emailMsg} onChangeText={setEmailMsg} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Button compact mode="contained" buttonColor={colors.primary} disabled={!emailTo.trim()} onPress={async () => {
                          await onEmailBeo(beo._id, emailTo.trim(), emailMsg.trim() || undefined);
                          setEmailingBeoId(null);
                          setEmailTo('');
                          setEmailMsg('');
                        }}>Send</Button>
                        <Button compact mode="text" onPress={() => setEmailingBeoId(null)}>Cancel</Button>
                      </View>
                    </View>
                  ) : (
                    <Button compact mode="text" textColor={colors.primary} icon="email-outline" onPress={() => {
                      setEmailingBeoId(beo._id);
                      setEmailTo(lead?.email ?? '');
                    }}>Email to client</Button>
                  )}
                </View>
              ))}
              {asArray(detail?.contracts).slice(0, 3).map((contract) => (
                <Text key={contract._id} style={{ color: colors.muted }}>Contract · {contract.contractNumber} · {contract.status}</Text>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent: (typeof accents)[number] }) {
  return (
    <View style={{ minWidth: 145, flexGrow: 1, padding: spacing.md, borderRadius: 8, backgroundColor: accent.bg }}>
      <Text style={{ color: accent.fg, fontWeight: '800', fontSize: 22 }}>{value}</Text>
      <Text style={{ color: colors.charcoal }}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title, action, onPress }: { title: string; action: string; onPress: () => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text variant="titleSmall" style={{ fontWeight: '800' }}>{title}</Text>
      <Button compact mode="text" textColor={colors.primary} onPress={onPress}>{action}</Button>
    </View>
  );
}

function LeadListRow({ lead, onPress }: { lead: LeadRow; onPress: () => void }) {
  return (
    <View style={{ padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8, gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.charcoal, fontWeight: '800' }}>{lead.fullName}</Text>
          <Text style={{ color: colors.muted }}>{lead.company ?? lead.source ?? 'No company'} - {lead.email ?? lead.phone ?? 'No contact'}</Text>
        </View>
        <Text style={{ color: colors.primary, fontWeight: '800' }}>{formatMoneyWhole(lead.estimatedValueCents)}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1 }}>
          <Chip compact>{lead.status.replace('_', ' ')}</Chip>
          {lead.tags.slice(0, 3).map((tag) => <Chip compact key={tag}>{tag}</Chip>)}
        </View>
        <Button compact mode="text" textColor={colors.primary} onPress={onPress}>Open</Button>
      </View>
    </View>
  );
}

function DocRow({ title, subtitle, status }: { title: string; subtitle: string; status: string }) {
  return (
    <View style={{ padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8, gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.charcoal, fontWeight: '800' }}>{title}</Text>
          <Text style={{ color: colors.muted }}>{subtitle}</Text>
        </View>
        <Chip compact>{status}</Chip>
      </View>
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <View style={{ padding: spacing.md, borderRadius: 8, backgroundColor: colors.background }}>
      <Text style={{ color: colors.muted }}>{text}</Text>
    </View>
  );
}

function InsightsView({
  forecast,
  sourceRoi,
  staleLeads,
  onSelectLead,
}: {
  forecast: ForecastResponse | undefined;
  sourceRoi: SourceRoiRow[] | undefined;
  staleLeads: StaleLeadsResponse | undefined;
  onSelectLead: (leadId: Id<'crmLeads'>) => void;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      {/* Pipeline forecast */}
      <View style={{ gap: spacing.sm }}>
        <Text variant="titleSmall" style={{ fontWeight: '800' }}>Pipeline forecast</Text>
        {forecast === undefined ? (
          <Text style={{ color: colors.muted }}>Loading…</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <StatTile label="Weighted pipeline" value={formatMoneyWhole(forecast.totals.weightedValueCents)} accent={accents[0]} />
              <StatTile label="Raw pipeline" value={formatMoneyWhole(forecast.totals.rawValueCents)} accent={accents[1]} />
              <StatTile label="Closed-won" value={formatMoneyWhole(forecast.totals.wonValueCents)} accent={accents[2]} />
              <StatTile label="Won deals" value={String(forecast.totals.wonCount)} accent={accents[3]} />
            </View>
            <View style={{ gap: 4 }}>
              {forecast.byStage.map((row) => (
                <View key={row.stage} style={{ padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.charcoal, fontWeight: '700' }}>{row.stage.replace(/_/g, ' ')}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{row.count} deals · {Math.round(row.probability * 100)}% probability</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colors.primary, fontWeight: '800' }}>{formatMoneyWhole(row.weightedValueCents)}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>raw {formatMoneyWhole(row.rawValueCents)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </View>

      <Divider />

      {/* Source ROI */}
      <View style={{ gap: spacing.sm }}>
        <Text variant="titleSmall" style={{ fontWeight: '800' }}>Lead source ROI</Text>
        {sourceRoi === undefined ? (
          <Text style={{ color: colors.muted }}>Loading…</Text>
        ) : sourceRoi.length === 0 ? (
          <EmptyLine text="No leads with sources yet." />
        ) : (
          sourceRoi.map((row) => (
            <View key={row.source} style={{ padding: spacing.sm, borderRadius: 8, backgroundColor: colors.background, gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.charcoal, fontWeight: '800' }}>{row.source}</Text>
                <Chip compact>{Math.round(row.winRate * 100)}% win</Chip>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {row.leadCount} leads · {row.wonCount} won · {row.lostCount} lost · {formatMoneyWhole(row.wonValueCents)} closed · {formatMoneyWhole(row.pipelineValueCents)} pipeline
              </Text>
            </View>
          ))
        )}
      </View>

      <Divider />

      {/* Stale leads */}
      <View style={{ gap: spacing.sm }}>
        <Text variant="titleSmall" style={{ fontWeight: '800' }}>
          Needs follow-up{staleLeads ? ` (${staleLeads.thresholdDays}+ days idle)` : ''}
        </Text>
        {staleLeads === undefined ? (
          <Text style={{ color: colors.muted }}>Loading…</Text>
        ) : staleLeads.leads.length === 0 ? (
          <EmptyLine text="All active leads have recent activity." />
        ) : (
          staleLeads.leads.map((lead) => (
            <View key={lead.id} style={{ padding: spacing.sm, borderRadius: 8, backgroundColor: accents[5].bg, gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.charcoal, fontWeight: '800' }}>{lead.fullName}</Text>
                  <Text style={{ color: colors.charcoal, fontSize: 12 }}>
                    {lead.status.replace(/_/g, ' ')} · {lead.daysSinceActivity}d idle · {formatMoneyWhole(lead.estimatedValueCents)}
                  </Text>
                </View>
                <Button compact mode="text" textColor={colors.primary} onPress={() => onSelectLead(lead.id as Id<'crmLeads'>)}>Open</Button>
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function TemplatesView({
  templates,
  onSave,
  onDelete,
}: {
  templates: EmailTemplateRow[];
  onSave: (tpl: { templateId?: string; name: string; subject: string; body: string; variables?: string }) => Promise<void>;
  onDelete: (templateId: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const startEdit = (tpl: EmailTemplateRow) => {
    setEditingId(tpl.id);
    setName(tpl.name);
    setSubject(tpl.subject);
    setBody(tpl.body);
  };

  const reset = () => {
    setEditingId(null);
    setName('');
    setSubject('');
    setBody('');
  };

  const submit = async () => {
    if (!name.trim() || !subject.trim() || !body.trim()) return;
    await onSave({ templateId: editingId ?? undefined, name: name.trim(), subject, body });
    reset();
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.sm }}>
        <Text variant="titleSmall" style={{ fontWeight: '800' }}>{editingId ? 'Edit template' : 'New template'}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          Use double-brace variables like {'{{lead.name}}'}, {'{{lead.firstName}}'}, {'{{event.date}}'}, {'{{venue.name}}'}.
        </Text>
        <TextInput dense label="Name (e.g. Inquiry reply)" value={name} onChangeText={setName} mode="outlined" style={{ backgroundColor: colors.surface }} />
        <TextInput dense label="Subject" value={subject} onChangeText={setSubject} mode="outlined" style={{ backgroundColor: colors.surface }} />
        <TextInput dense label="Body" value={body} onChangeText={setBody} mode="outlined" multiline numberOfLines={6} style={{ backgroundColor: colors.surface, minHeight: 120 }} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button mode="contained" buttonColor={colors.primary} disabled={!name.trim() || !subject.trim() || !body.trim()} onPress={() => void submit()}>
            {editingId ? 'Update template' : 'Save template'}
          </Button>
          {editingId ? <Button mode="text" onPress={reset}>Cancel</Button> : null}
        </View>
      </View>

      <Divider />

      <View style={{ gap: spacing.sm }}>
        <Text variant="titleSmall" style={{ fontWeight: '800' }}>Saved templates</Text>
        {templates.length === 0 ? (
          <EmptyLine text="No templates yet." />
        ) : (
          templates.map((tpl) => (
            <View key={tpl.id} style={{ padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8, gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.charcoal, fontWeight: '800' }}>{tpl.name}</Text>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <Button compact mode="text" textColor={colors.primary} onPress={() => startEdit(tpl)}>Edit</Button>
                  <Button compact mode="text" textColor={colors.danger} onPress={() => void onDelete(tpl.id)}>Delete</Button>
                </View>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Subject: {tpl.subject}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={2}>{tpl.body}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}
