import { useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { accents, colors, radius, spacing } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { asArray, errorMessage, formatMoney, formatShortDateTime } from '../../lib/format';
import { PremiumFeatureGate } from '../../components/PremiumFeatureGate';
import { ProviderDropdown } from '../../components/ProviderDropdown';
import { InlineMessage } from '../../components/InlineMessage';
import { ManagerGate } from '../../components/ManagerGate';
import { SectionHeader } from '../../components/AppCard';
import { useI18n } from '../../lib/i18n';


// Must stay in sync with POS_PROVIDERS in packages/api/src/modules/pos/pos.controller.ts
// and the PosProvider enum in prisma/schema.prisma.
const posProviderOptions = [
  { value: 'toast', label: 'Toast' },
  { value: 'square', label: 'Square' },
  { value: 'clover', label: 'Clover' },
  { value: 'shopify_pos', label: 'Shopify POS' },
  { value: 'lightspeed_restaurant', label: 'Lightspeed Restaurant' },
  { value: 'spoton', label: 'SpotOn' },
  { value: 'generic', label: 'Other (generic webhook)' },
] as const;
type Provider = (typeof posProviderOptions)[number]['value'];

const reservationProviderOptions = [
  { value: 'opentable', label: 'OpenTable' },
  { value: 'resy', label: 'Resy' },
  { value: 'sevenrooms', label: 'SevenRooms' },
  { value: 'tock', label: 'Tock' },
  { value: 'google', label: 'Google Reserve' },
  { value: 'generic', label: 'Other (generic webhook)' },
] as const;
type ReservationProvider = (typeof reservationProviderOptions)[number]['value'];



export default function IntegrationsScreen() {
  return (
    <PremiumFeatureGate feature="Integrations">
      <IntegrationsScreenInner />
    </PremiumFeatureGate>
  );
}

function IntegrationsScreenInner() {
  const { t } = useI18n();
  const { venue, isReady, canManage, profileLoading } = useVenueAuth();
  const overview = useQuery(api.pos.getPosOverview, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const reservationOverview = useQuery(
    api.reservationIntegrations.getReservationIntegrationOverview,
    isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip',
  ) as any;
  const upsertConnection = useMutation(api.pos.upsertPosConnection);
  const rotatePosSecret = useMutation(api.pos.rotatePosConnectionSecret);
  const upsertReservationConnection = useMutation(api.reservationIntegrations.upsertReservationConnection);
  const rotateLeadsSecret = useMutation(api.guests.rotateLeadsWebhookSecret);

  const [provider, setProvider] = useState<Provider>('toast');
  const [locationId, setLocationId] = useState('');
  const [reservationProvider, setReservationProvider] = useState<ReservationProvider>('opentable');
  const [externalVenueId, setExternalVenueId] = useState('');
  // Which action is in flight, so only its button spins (not all three).
  const [pending, setPending] = useState<'pos' | 'reservation' | 'leads' | `pos-rotate:${string}` | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // A freshly generated webhook secret, shown once. It cannot be read back, so
  // the manager must copy it now; rotating issues a new one.
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const saveConnection = async () => {
    if (!venue?.id) return;
    setPending('pos');
    setMessage(null);
    try {
      const r = await upsertConnection({
        venueId: venue.id,
        provider,
        externalLocationId: locationId.trim() || undefined,
        status: 'connected',
      });
      if (r?.webhookSecret) setNewSecret(r.webhookSecret);
      setMessage(t('integrations.messages.posSaved'));
    } catch (e) {
      setMessage(errorMessage(e, t('integrations.messages.posSaveError')));
    } finally {
      setPending(null);
    }
  };

  const saveReservationConnection = async () => {
    if (!venue?.id) return;
    setPending('reservation');
    setMessage(null);
    try {
      const r = await upsertReservationConnection({
        venueId: venue.id,
        provider: reservationProvider,
        externalVenueId: externalVenueId.trim() || undefined,
        status: 'connected',
      });
      if (r?.webhookSecret) setNewSecret(r.webhookSecret);
      setMessage(t('integrations.messages.reservationSaved'));
    } catch (e) {
      setMessage(errorMessage(e, t('integrations.messages.reservationSaveError')));
    } finally {
      setPending(null);
    }
  };

  const rotateConnectionSecret = async (connectionId: string) => {
    if (!venue?.id) return;
    setPending(`pos-rotate:${connectionId}`);
    setMessage(null);
    try {
      const result = await rotatePosSecret({ venueId: venue.id, connectionId });
      setNewSecret(result.webhookSecret);
      setMessage(t('integrations.messages.posRotated'));
    } catch (error) {
      setMessage(errorMessage(error, t('integrations.messages.posRotateError')));
    } finally {
      setPending(null);
    }
  };

  const generateLeadsSecret = async () => {
    if (!venue?.id) return;
    setPending('leads');
    setMessage(null);
    try {
      const r = await rotateLeadsSecret({ venueId: venue.id });
      if (r?.webhookSecret) setNewSecret(r.webhookSecret);
      setMessage(t('integrations.messages.leadsGenerated'));
    } catch (e) {
      setMessage(errorMessage(e, t('integrations.messages.leadsGenerateError')));
    } finally {
      setPending(null);
    }
  };

  return (
    <ManagerGate canManage={canManage} profileLoading={profileLoading} feature="Integrations">
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader
        kicker={t('integrations.header.kicker')}
        title={t('integrations.header.title')}
        subtitle={t('integrations.header.subtitle', { venue: venue?.name ?? t('integrations.header.venueFallback') })}
      />

      {newSecret ? (
        <Card style={{ backgroundColor: colors.surfaceSoft, borderRadius: radius.sharp, borderWidth: 1, borderColor: colors.warning }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text style={{ fontWeight: '800', color: colors.charcoal }}>{t('integrations.secret.title')}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {t('integrations.secret.body')}
            </Text>
            <Text selectable style={{ fontFamily: 'monospace', fontSize: 14, color: colors.charcoal, backgroundColor: colors.surface, padding: spacing.sm, borderRadius: radius.sharp }}>
              {newSecret}
            </Text>
            <Button compact mode="text" textColor={colors.primary} onPress={() => setNewSecret(null)}>{t('integrations.secret.saved')}</Button>
          </Card.Content>
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {[
          { label: t('integrations.metrics.todaySales'), value: formatMoney(overview?.todaySalesCents ?? 0), a: accents[0] },
          { label: t('integrations.metrics.todayTips'), value: formatMoney(overview?.todayTipsCents ?? 0), a: accents[2] },
          { label: t('integrations.metrics.openChecks'), value: String(overview?.openChecks ?? 0), a: accents[3] },
          { label: t('integrations.metrics.lastSync'), value: overview?.lastSyncAt ? formatShortDateTime(overview.lastSyncAt) : t('integrations.metrics.never'), a: accents[4] },
        ].map((metric) => (
          <Card key={metric.label} style={{ backgroundColor: metric.a.bg, width: '48%', flexGrow: 1, borderRadius: radius.sharp }}>
            <Card.Content>
              <Text style={{ color: metric.a.fg, fontSize: 24, fontWeight: '800' }}>{metric.value}</Text>
                  <Text style={{ color: colors.charcoal }}>{metric.label}</Text>
            </Card.Content>
          </Card>
        ))}
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp, borderWidth: 1, borderColor: colors.border }}>
        <Card.Content style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700', color: colors.charcoal, fontSize: 16 }}>POS aggregator</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${colors.success}18`, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success }} />
              <Text style={{ color: colors.success, fontWeight: '700', fontSize: 12 }}>Online</Text>
            </View>
          </View>
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            Unified live stream aggregating transactions, menus, 86'd items, and tender reconciliation across Toast, Square, SpotOn, Clover, Shopify POS & in-seat mobile apps.
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
            <Button
              mode="contained"
              buttonColor={colors.primary}
              icon="broadcast"
              onPress={() => router.push('/stadium/pos-aggregator')}
            >
              Open aggregator console
            </Button>
          </View>
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('integrations.pos.title')}</Text>
          <ProviderDropdown
            label={t('integrations.pos.providerLabel')}
            value={provider}
            options={posProviderOptions}
            onChange={(next) => setProvider(next as Provider)}
            disabled={pending !== null}
          />
          <TextInput label={t('integrations.pos.locationLabel')} value={locationId} onChangeText={setLocationId} mode="outlined" autoCapitalize="none" style={{ backgroundColor: colors.surface }} />
          <InlineMessage message={message} />
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Button mode="contained" buttonColor={colors.primary} loading={pending === 'pos'} disabled={pending !== null} onPress={() => void saveConnection()}>{t('integrations.pos.save')}</Button>
          </View>
          <Text style={{ color: colors.muted }}>
            {t('integrations.pos.webhookInfo')}
          </Text>
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('integrations.reservation.title')}</Text>
          <ProviderDropdown
            label={t('integrations.reservation.providerLabel')}
            value={reservationProvider}
            options={reservationProviderOptions}
            onChange={(next) => setReservationProvider(next as ReservationProvider)}
            disabled={pending !== null}
          />
          <TextInput label={t('integrations.reservation.venueIdLabel')} value={externalVenueId} onChangeText={setExternalVenueId} mode="outlined" autoCapitalize="none" style={{ backgroundColor: colors.surface }} />
          <Button mode="contained" buttonColor={colors.primary} loading={pending === 'reservation'} disabled={pending !== null} onPress={() => void saveReservationConnection()}>
            {t('integrations.reservation.save')}
          </Button>
          <Text style={{ color: colors.muted }}>{t('integrations.reservation.webhookInfo')}</Text>
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('integrations.leads.title')}</Text>
          <Text style={{ color: colors.muted }}>
            {t('integrations.leads.body')}
          </Text>
          <Button mode="contained" buttonColor={colors.primary} loading={pending === 'leads'} disabled={pending !== null} onPress={() => void generateLeadsSecret()}>
            {t('integrations.leads.generate')}
          </Button>
          <InlineMessage message={message} />
          {newSecret ? (
            <Text selectable style={{ fontFamily: 'monospace', color: colors.charcoal, backgroundColor: colors.surfaceSoft, padding: spacing.sm, borderRadius: radius.sharp }}>
              {newSecret}
            </Text>
          ) : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('integrations.connections.title')}</Text>
          {asArray(overview?.connections).length === 0 ? (
            <Text style={{ color: colors.muted }}>{t('integrations.connections.empty')}</Text>
          ) : (
            overview.connections.map((connection: any) => (
              <View key={connection._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 2 }}>
                <Text style={{ fontWeight: '700' }}>{connection.provider}</Text>
                <Text style={{ color: colors.muted }}>
                  {t('integrations.connections.statusLocation', { status: connection.status, location: connection.externalLocationId ?? t('integrations.connections.notSet') })}
                </Text>
                <Text style={{ color: colors.muted }}>
                  {t('integrations.connections.lastSync', { value: connection.lastSyncAt ? formatShortDateTime(connection.lastSyncAt) : t('integrations.metrics.never') })}
                </Text>
                <Button
                  compact
                  mode="outlined"
                  loading={pending === `pos-rotate:${connection._id}`}
                  disabled={pending !== null}
                  onPress={() => void rotateConnectionSecret(connection._id)}
                >
                  {t('integrations.connections.rotateSecret')}
                </Button>
              </View>
            ))
          )}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('integrations.reservationConnections.title')}</Text>
          {asArray(reservationOverview?.connections).length === 0 ? (
            <Text style={{ color: colors.muted }}>{t('integrations.reservationConnections.empty')}</Text>
          ) : (
            reservationOverview.connections.map((connection: any) => (
              <View key={connection._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 2 }}>
                <Text style={{ fontWeight: '700' }}>{connection.provider}</Text>
                <Text style={{ color: colors.muted }}>
                  {t('integrations.reservationConnections.statusVenue', { status: connection.status, value: connection.externalVenueId ?? t('integrations.connections.notSet') })}
                </Text>
                <Text style={{ color: colors.muted }}>
                  {t('integrations.reservationConnections.lastSync', { value: connection.lastSyncAt ? formatShortDateTime(connection.lastSyncAt) : t('integrations.metrics.never') })}
                </Text>
              </View>
            ))
          )}
          {asArray(reservationOverview?.recentEvents).length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={{ fontWeight: '700' }}>{t('integrations.reservationConnections.recentEvents')}</Text>
              {reservationOverview.recentEvents.slice(0, 5).map((event: any) => (
                <Text key={event._id} style={{ color: colors.muted }}>
                  {event.provider} · {event.eventType} · {formatShortDateTime(event.processedAt)}
                </Text>
              ))}
            </View>
          ) : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('integrations.recentChecks.title')}</Text>
          {asArray(overview?.recentChecks).length === 0 ? (
            <Text style={{ color: colors.muted }}>{t('integrations.recentChecks.empty')}</Text>
          ) : (
            overview.recentChecks.map((check: any) => (
              <View key={check._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 2 }}>
                <Text style={{ fontWeight: '700' }}>{check.provider} · {formatMoney(check.totalCents)}</Text>
                <Text style={{ color: colors.muted }}>
                  {t('integrations.recentChecks.statusTable', {
                    status: check.status,
                    table: check.tableLabel ?? t('integrations.recentChecks.tableFallback'),
                    guest: check.guestName ?? t('integrations.recentChecks.guestFallback'),
                  })}
                </Text>
                <Text style={{ color: colors.muted }}>{formatShortDateTime(check.openedAt)}</Text>
              </View>
            ))
          )}
        </Card.Content>
      </Card>
    </ScrollView>
    </ManagerGate>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
