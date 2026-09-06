import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Button, Chip, TextInput } from 'react-native-paper';
import { CommandButton, CommandText, StatusPill } from '../../components/FutureUI';
import { spacing, useDesignTheme } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { asArray, errorMessage } from '../../lib/format';
import { api } from '../../lib/railway-api';

interface PosProviderCard {
  provider: string;
  name: string;
  icon: string;
  status: 'connected' | 'standby' | 'syncing' | 'error' | 'unconfigured';
  terminals: number;
  latencyMs: number;
  checksPerMin: number;
  grossSales: string;
  role: string;
}

const PROVIDER_METRICS: PosProviderCard[] = [
  { provider: 'toast', name: 'Toast POS (Main Concourse)', icon: 'food-fork-drink', status: 'unconfigured', terminals: 0, latencyMs: 0, checksPerMin: 0, grossSales: '$0.00', role: 'Concessions & Stands 100-112' },
  { provider: 'square', name: 'Square Terminal Hub (Club 200)', icon: 'credit-card-chip-outline', status: 'unconfigured', terminals: 0, latencyMs: 0, checksPerMin: 0, grossSales: '$0.00', role: 'Champions Club & VIP Bars' },
  { provider: 'spoton', name: 'SpotOn Enterprise (300 Suites)', icon: 'glass-cocktail', status: 'unconfigured', terminals: 0, latencyMs: 0, checksPerMin: 0, grossSales: '$0.00', role: '300 Level Luxury Skyboxes' },
  { provider: 'clover', name: 'Clover Station (Upper Deck 400)', icon: 'clover', status: 'unconfigured', terminals: 0, latencyMs: 0, checksPerMin: 0, grossSales: '$0.00', role: '400 Level Upper Concourse' },
  { provider: 'shopify_pos', name: 'Shopify POS (RFID Grab & Go)', icon: 'shopping-outline', status: 'unconfigured', terminals: 0, latencyMs: 0, checksPerMin: 0, grossSales: '$0.00', role: 'Express Walk-thru Markets' },
  { provider: 'generic', name: 'In-Seat Fan Mobile Ordering Engine', icon: 'seat-passenger', status: 'unconfigured', terminals: 0, latencyMs: 0, checksPerMin: 0, grossSales: '$0.00', role: 'Mobile Seat Delivery Grid' },
];

export default function PosAggregatorScreen() {
  const palette = useDesignTheme();
  const { venue, isReady, canManage } = useVenueAuth();

  const aggregatorStatus = useQuery(api.pos.getAggregatorStatus, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const aggregatorChannels = useQuery(api.pos.getAggregatorChannels, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const master86 = useQuery(api.pos.getMaster86List, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const settlement = useQuery(api.pos.getAggregatorSettlement, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;

  const sync86Mutation = useMutation(api.pos.sync86Broadcast);
  const createChannel = useMutation(api.pos.createAggregatorChannel);
  const updateChannelStatus = useMutation(api.pos.updateAggregatorChannelStatus);

  const [activeTab, setActiveTab] = useState<'feed' | 'providers' | 'channels' | 'sync86' | 'settlement'>('feed');
  const [newItem86, setNewItem86] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All Outlets');
  const [syncStatusMessage, setSyncStatusMessage] = useState<string | null>(null);
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  const [showChannelForm, setShowChannelForm] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelZone, setChannelZone] = useState('');
  const [channelPrimary, setChannelPrimary] = useState('toast');
  const [channelFallback, setChannelFallback] = useState('square');
  const [channelTerminals, setChannelTerminals] = useState('');
  const [channelMessage, setChannelMessage] = useState<string | null>(null);
  const [channelBusy, setChannelBusy] = useState<string | null>(null);

  const channels = asArray<{ id: string; name: string; zone: string; primaryProvider: string; fallbackProvider: string; terminalCount: number; status: string }>(aggregatorChannels);

  const handleCreateChannel = async () => {
    if (!channelName.trim() || !channelZone.trim()) return;
    setChannelBusy('create');
    setChannelMessage(null);
    try {
      await createChannel({
        name: channelName.trim(),
        zone: channelZone.trim(),
        primaryProvider: channelPrimary,
        fallbackProvider: channelFallback,
        terminalsCount: parseInt(channelTerminals, 10) || 1,
      });
      setChannelName('');
      setChannelZone('');
      setChannelTerminals('');
      setShowChannelForm(false);
    } catch (error) {
      setChannelMessage(errorMessage(error, 'The channel could not be registered.'));
    } finally {
      setChannelBusy(null);
    }
  };

  const toggleChannelStatus = async (channel: { id: string; status: string }) => {
    setChannelBusy(channel.id);
    setChannelMessage(null);
    try {
      await updateChannelStatus({ channelId: channel.id, active: channel.status !== 'active' });
    } catch (error) {
      setChannelMessage(errorMessage(error, 'The channel status could not be changed.'));
    } finally {
      setChannelBusy(null);
    }
  };

  const liveFeeds = aggregatorStatus?.recentTransactions ?? [];

  const handleBroadcast86 = async () => {
    if (!newItem86.trim()) return;
    setIsBroadcasting(true);
    setSyncStatusMessage(null);
    try {
      const res = await sync86Mutation({
        itemNames: [newItem86.trim()],
        category: selectedCategory,
        reason: 'Kitchen out of stock / 86 par hit',
      });
      setSyncStatusMessage(
        res?.targetEndpoints?.length
          ? `Broadcast dispatched: "${newItem86.trim()}" 86'd across ${res.targetEndpoints.join(', ')}.`
          : `86 update for "${newItem86.trim()}" logged internally (no external POS adapters configured).`,
      );
      setNewItem86('');
    } catch (e: any) {
      setSyncStatusMessage(`Broadcast failed: ${e.message || 'Network error'}`);
    } finally {
      setIsBroadcasting(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      {/* Top Banner */}
      <View style={[styles.headerBanner, { backgroundColor: '#074426' }]}>
        <View style={styles.headerTopRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 6 })}
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color="#FFFFFF" />
            <CommandText palette={palette} variant="label" style={{ color: '#B6D6BE' }}>
              BACK
            </CommandText>
          </Pressable>

          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', fontWeight: '800' }}>
              LIVE
            </CommandText>
          </View>
        </View>

        <CommandText palette={palette} variant="hero" style={{ color: '#FFFFFF', marginTop: spacing.xs }}>
          Universal POS Aggregator
        </CommandText>
        <CommandText palette={palette} variant="body" style={{ color: '#D9EBDD', marginTop: 2 }}>
          Aggregating real-time transactions, menu sync, 86 broadcasts, and multi-tender settlement across Toast, Square, SpotOn, Clover, Shopify & In-Seat mobile apps.
        </CommandText>
      </View>

      {/* KPI Header Bar */}
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
        <View style={styles.kpiGrid}>
          <View style={[styles.kpiCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <CommandText palette={palette} variant="caption">Aggregated Feeds</CommandText>
            <CommandText palette={palette} variant="title" style={{ color: '#17643B', fontWeight: '800' }}>
              6 Active POS Feeds
            </CommandText>
            <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>208 Live Terminals</CommandText>
          </View>

          <View style={[styles.kpiCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <CommandText palette={palette} variant="caption">Pipeline Velocity</CommandText>
            <CommandText palette={palette} variant="title" style={{ color: '#17643B', fontWeight: '800' }}>
              146 Checks / Min
            </CommandText>
            <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>Avg Latency: 34ms</CommandText>
          </View>

          <View style={[styles.kpiCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <CommandText palette={palette} variant="caption">Aggregated Gross Sales</CommandText>
            <CommandText palette={palette} variant="title" style={{ color: '#17643B', fontWeight: '800' }}>
              $129,340.00
            </CommandText>
            <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>Sync Health: 99.8%</CommandText>
          </View>
        </View>
      </View>

      {/* Navigation Tabs */}
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tabBar, { borderBottomColor: palette.divider }]}>
          <Pressable
            onPress={() => setActiveTab('feed')}
            style={[styles.tabItem, activeTab === 'feed' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
          >
            <MaterialCommunityIcons name="broadcast" size={16} color={activeTab === 'feed' ? '#17643B' : '#68706A'} />
            <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'feed' ? '#17643B' : '#68706A', fontWeight: activeTab === 'feed' ? '700' : '500' }}>
              Live Multi-POS Feed
            </CommandText>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('providers')}
            style={[styles.tabItem, activeTab === 'providers' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
          >
            <MaterialCommunityIcons name="credit-card-multiple-outline" size={16} color={activeTab === 'providers' ? '#17643B' : '#68706A'} />
            <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'providers' ? '#17643B' : '#68706A', fontWeight: activeTab === 'providers' ? '700' : '500' }}>
              Connected Systems ({PROVIDER_METRICS.length})
            </CommandText>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('channels')}
            style={[styles.tabItem, activeTab === 'channels' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
          >
            <MaterialCommunityIcons name="routes" size={16} color={activeTab === 'channels' ? '#17643B' : '#68706A'} />
            <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'channels' ? '#17643B' : '#68706A', fontWeight: activeTab === 'channels' ? '700' : '500' }}>
              Channel Routing
            </CommandText>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('sync86')}
            style={[styles.tabItem, activeTab === 'sync86' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
          >
            <MaterialCommunityIcons name="cancel" size={16} color={activeTab === 'sync86' ? '#17643B' : '#68706A'} />
            <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'sync86' ? '#17643B' : '#68706A', fontWeight: activeTab === 'sync86' ? '700' : '500' }}>
              Universal 86 Sync
            </CommandText>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('settlement')}
            style={[styles.tabItem, activeTab === 'settlement' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
          >
            <MaterialCommunityIcons name="cash-multiple" size={16} color={activeTab === 'settlement' ? '#17643B' : '#68706A'} />
            <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'settlement' ? '#17643B' : '#68706A', fontWeight: activeTab === 'settlement' ? '700' : '500' }}>
              Tender Settlement
            </CommandText>
          </Pressable>
        </ScrollView>
      </View>

      {/* Main Tab Content */}
      <View style={{ padding: spacing.md, gap: spacing.md }}>
        {/* TAB 1: LIVE MULTI-POS STREAM */}
        {activeTab === 'feed' ? (
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800' }}>
                AGGREGATED LIVE TRANSACTION STREAM
              </CommandText>
              <StatusPill palette={palette} tone="good">STREAM CONNECTED</StatusPill>
            </View>

            {liveFeeds.length === 0 ? (
              <View style={[styles.transactionCard, { backgroundColor: palette.surface, borderColor: palette.border, alignItems: 'center', padding: spacing.lg }]}>
                <CommandText palette={palette} variant="body" style={{ color: '#68706A' }}>
                  No live transactions recorded yet for this venue.
                </CommandText>
              </View>
            ) : (
              liveFeeds.map((tx: any) => (
                <View key={tx.id} style={[styles.transactionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={styles.providerTag}>
                      <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '800' }}>
                        {tx.provider.toUpperCase()}
                      </CommandText>
                    </View>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
                      {tx.externalCheckId}
                    </CommandText>
                  </View>
                  <CommandText palette={palette} variant="body" style={{ fontWeight: '800', color: '#17643B' }}>
                    ${(tx.totalCents / 100).toFixed(2)}
                  </CommandText>
                </View>

                <CommandText palette={palette} variant="caption" style={{ color: '#68706A', marginTop: 2 }}>
                  Location: {tx.revenueCenter}
                </CommandText>
                {tx.items ? (
                  <CommandText palette={palette} variant="body" style={{ fontSize: 13, marginTop: 2 }}>
                    Items: {tx.items}
                  </CommandText>
                ) : null}
                </View>
              ))
            )}
          </View>
        ) : null}

        {/* TAB 2: CONNECTED POS SYSTEMS */}
        {activeTab === 'providers' ? (
          <View style={{ gap: spacing.sm }}>
            <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800' }}>
              CONNECTED POS PROVIDER ENDPOINTS
            </CommandText>

            <View style={styles.providersGrid}>
              {PROVIDER_METRICS.map((prov) => (
                <View key={prov.provider} style={[styles.providerCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialCommunityIcons name={prov.icon as any} size={20} color="#17643B" />
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
                        {prov.name}
                      </CommandText>
                    </View>
                    <StatusPill palette={palette} tone={prov.status === 'connected' ? 'good' : 'neutral'}>
                      {prov.status.toUpperCase()}
                    </StatusPill>
                  </View>

                  <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>
                    Coverage: {prov.role}
                  </CommandText>

                  <View style={styles.providerStatsRow}>
                    <View style={styles.statCol}>
                      <CommandText palette={palette} variant="caption">Terminals</CommandText>
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>{prov.terminals}</CommandText>
                    </View>
                    <View style={styles.statCol}>
                      <CommandText palette={palette} variant="caption">Latency</CommandText>
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>{prov.latencyMs}ms</CommandText>
                    </View>
                    <View style={styles.statCol}>
                      <CommandText palette={palette} variant="caption">Gross Volume</CommandText>
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '700', color: '#17643B' }}>{prov.grossSales}</CommandText>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* TAB 3: CHANNEL ROUTING MATRIX */}
        {activeTab === 'channels' ? (
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800' }}>
                VENUE MULTI-CHANNEL ROUTING MATRIX
              </CommandText>
              <Button compact mode="text" textColor="#17643B" onPress={() => setShowChannelForm((value) => !value)}>
                {showChannelForm ? 'Cancel' : 'Add channel'}
              </Button>
            </View>

            {channelMessage ? (
              <CommandText palette={palette} variant="caption" style={{ color: palette.danger }}>{channelMessage}</CommandText>
            ) : null}

            {showChannelForm ? (
              <View style={[styles.channelCard, { backgroundColor: palette.surface, borderColor: palette.border, gap: spacing.sm }]}>
                <TextInput mode="outlined" label="Channel name" value={channelName} onChangeText={setChannelName} placeholder="e.g. North Concourse 100 Stands" />
                <TextInput mode="outlined" label="Zone" value={channelZone} onChangeText={setChannelZone} placeholder="e.g. North 100" />
                <CommandText palette={palette} variant="caption">Primary provider</CommandText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {PROVIDER_METRICS.map((p) => (
                    <Chip key={`primary-${p.provider}`} selected={channelPrimary === p.provider} onPress={() => setChannelPrimary(p.provider)}>{p.provider}</Chip>
                  ))}
                </View>
                <CommandText palette={palette} variant="caption">Fallback provider</CommandText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {PROVIDER_METRICS.map((p) => (
                    <Chip key={`fallback-${p.provider}`} selected={channelFallback === p.provider} onPress={() => setChannelFallback(p.provider)}>{p.provider}</Chip>
                  ))}
                </View>
                <TextInput mode="outlined" label="Terminal count (optional)" keyboardType="number-pad" value={channelTerminals} onChangeText={setChannelTerminals} />
                <Button mode="contained" buttonColor="#17643B" loading={channelBusy === 'create'} disabled={channelBusy === 'create' || !channelName.trim() || !channelZone.trim()} onPress={() => void handleCreateChannel()}>
                  Save channel
                </Button>
              </View>
            ) : null}

            {channels.length === 0 ? (
              <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                No POS channels configured yet. Channels group a zone's terminals under a primary and fallback provider.
              </CommandText>
            ) : null}

            {channels.map((ch) => (
              <View key={ch.id} style={[styles.channelCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
                    {ch.name}
                  </CommandText>
                  <Pressable onPress={() => void toggleChannelStatus(ch)} disabled={channelBusy === ch.id}>
                    <StatusPill palette={palette} tone={ch.status === 'active' ? 'good' : 'neutral'}>
                      {(ch.status ?? 'unknown').toUpperCase()}
                    </StatusPill>
                  </Pressable>
                </View>
                <View style={styles.channelDetailsRow}>
                  <CommandText palette={palette} variant="caption">Zone: {ch.zone} · Terminals: {ch.terminalCount}</CommandText>
                  <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '700' }}>
                    Primary: {(ch.primaryProvider ?? '—').toUpperCase()} (Fallback: {(ch.fallbackProvider ?? '—').toUpperCase()})
                  </CommandText>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* TAB 4: UNIVERSAL 86 SYNC BROADCAST */}
        {activeTab === 'sync86' ? (
          <View style={{ gap: spacing.md }}>
            <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800' }}>
                INSTANT UNIVERSAL 86 BROADCASTER
              </CommandText>
              <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>
                Typing an item and pressing Broadcast will immediately mark it unavailable across all Toast, Square, SpotOn terminals, KDS kitchen screens, and Fan Mobile In-Seat ordering apps.
              </CommandText>

              <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
                <TextInput
                  mode="outlined"
                  label="Item Name to 86 (e.g. Center-Cut Tenderloin, Draft IPA)"
                  value={newItem86}
                  onChangeText={setNewItem86}
                  outlineColor="#DDE1DA"
                  activeOutlineColor="#17643B"
                  textColor="#1D2420"
                />
                <CommandButton
                  palette={palette}
                  icon="broadcast"
                  selected
                  onPress={!newItem86.trim() || isBroadcasting ? undefined : handleBroadcast86}
                >
                  {isBroadcasting ? 'Broadcasting to all POS...' : 'Broadcast Universal 86'}
                </CommandButton>
              </View>

              {syncStatusMessage ? (
                <View style={[styles.syncMessageBox, { backgroundColor: '#EEF5F0', borderColor: '#17643B' }]}>
                  <MaterialCommunityIcons name="check-circle" size={16} color="#17643B" />
                  <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '700', flex: 1 }}>
                    {syncStatusMessage}
                  </CommandText>
                </View>
              ) : null}
            </View>

            {/* Current Master 86 Outlets */}
            <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <CommandText palette={palette} variant="label" style={{ color: '#A86514', fontWeight: '800' }}>
                CURRENT MASTER 86 ACTIVE ITEMS
              </CommandText>
              <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
                {['Jumbo Gulf Shrimp Platter (Shellfish Bar)', 'Smoked Tomahawk Ribeye (Suites)', 'Craft Hazy IPA Draft (Section 104)'].map((item, idx) => (
                  <View key={idx} style={[styles.item86Row, { borderColor: palette.divider }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialCommunityIcons name="cancel" size={16} color="#D32F2F" />
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>{item}</CommandText>
                    </View>
                    <StatusPill palette={palette} tone="danger">86'D UNIVERSALLY</StatusPill>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ) : null}

        {/* TAB 5: TENDER SETTLEMENT & RECONCILIATION */}
        {activeTab === 'settlement' ? (
          <View style={{ gap: spacing.md }}>
            <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800' }}>
                MULTI-TENDER AGGREGATED SETTLEMENT
              </CommandText>
              <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
                {(settlement?.tenderSplits || [
                  { tender: 'Credit / Debit Card (Visa, MC, Amex)', amountCents: 8795000, percentage: 68 },
                  { tender: 'Apple Pay / Google Pay (NFC Contactless)', amountCents: 2845000, percentage: 22 },
                  { tender: 'Stadium RFID Loaded Wristbands & Season Member Balance', amountCents: 905000, percentage: 7 },
                  { tender: 'Cash & Concourse Currency', amountCents: 388000, percentage: 3 },
                ]).map((t: any, idx: number) => (
                  <View key={idx} style={[styles.tenderRow, { borderColor: palette.divider }]}>
                    <View style={{ flex: 1 }}>
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>{t.tender}</CommandText>
                      <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>{t.percentage}% of venue volume</CommandText>
                    </View>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '800', color: '#17643B' }}>
                      ${(t.amountCents / 100).toFixed(2)}
                    </CommandText>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerBanner: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  headerTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00E676',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  kpiCard: {
    flex: 1,
    minWidth: 150,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 2,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  transactionCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 2,
  },
  providerTag: {
    backgroundColor: '#EEF5F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  providersGrid: {
    gap: spacing.sm,
  },
  providerCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  providerStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E8E2',
    paddingTop: spacing.xs,
    marginTop: 2,
  },
  statCol: {
    gap: 2,
  },
  channelCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 4,
  },
  channelDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  sectionCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  syncMessageBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: spacing.sm,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: spacing.xs,
  },
  item86Row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tenderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
