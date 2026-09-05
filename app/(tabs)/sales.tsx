import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Card, Chip, SegmentedButtons, Text } from 'react-native-paper';
import { ScreenErrorBoundary } from '../../components/ErrorBoundary';
import { AnimatedTab, SectionHeader } from '../../components/AppCard';
import { useI18n } from '../../lib/i18n';
import { useQueryState } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { accents, colors, radius, spacing } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { asArray, formatDuration, formatMoney, formatPct } from '../../lib/format';
import { ScheduleSkeleton } from '../../components/schedule/ScheduleSkeleton';
import { PremiumFeatureGate } from '../../components/PremiumFeatureGate';
import { ManagerGate } from '../../components/ManagerGate';
import { ScreenState } from '../../components/ScreenState';
import { DateRangeBar, useDateRange } from '../../components/DateRangeBar';




// A simple bar chart rendered as relative-width View bands.
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? value / max : 0;
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' }}>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: color, width: `${Math.max(2, Math.round(pct * 100))}%` }} />
    </View>
  );
}

function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: typeof accents[number] }) {
  return (
    <Card style={{ backgroundColor: accent.bg, borderRadius: radius.sharp, minWidth: '47%', flexGrow: 1 }}>
      <Card.Content style={{ gap: 2 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: accent.fg }}>{value}</Text>
        {sub ? <Text style={{ fontSize: 12, color: colors.charcoal }}>{sub}</Text> : null}
        <Text style={{ fontSize: 12, color: colors.charcoal }}>{label}</Text>
      </Card.Content>
    </Card>
  );
}

type SalesTabProps = { venueId: Id<'venues'>; days: number; startTs: number; endTs: number };

function SummaryTab({ venueId, days, startTs, endTs }: SalesTabProps) {
  const { t } = useI18n();
  const dashboardQuery = useQueryState<any>(api.pos.getSalesSummaryDashboard, { venueId, windowDays: days, startTs, endTs });
  const dashboard = dashboardQuery.data;

  if (dashboardQuery.isLoading) return <ScheduleSkeleton rows={5} />;
  if (dashboardQuery.error) return <ScreenState isLoading={false} error={dashboardQuery.error} onRetry={() => void dashboardQuery.refetch()}>{null}</ScreenState>;

  if (!dashboard?.summary || dashboard.summary.checkCount === 0) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content>
          <Text style={{ color: colors.muted }}>{t('sales.summary.empty')}</Text>
        </Card.Content>
      </Card>
    );
  }

  const summary = dashboard.summary as any;
  const byDay = asArray<any>(dashboard.byDay);
  const byTender = asArray<any>(dashboard.byTender);
  const byRevenueCenter = asArray<any>(dashboard.byRevenueCenter);
  const netSales = summary.salesCents - (summary.discountCents + summary.compCents + summary.promoCents);
  const maxDay = Math.max(...byDay.map((d) => d.salesCents), 1);

  return (
    <View style={{ gap: spacing.md }}>
      {/* KPI grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <KpiTile label={t('sales.summary.kpi.grossSales')} value={formatMoney(summary.salesCents)} accent={accents[0]} />
        <KpiTile label={t('sales.summary.kpi.netSales')} value={formatMoney(netSales)} sub={t('sales.summary.kpi.netSalesSub', { amount: formatMoney(summary.discountCents + summary.compCents + summary.promoCents) })} accent={accents[2]} />
        <KpiTile label={t('sales.summary.kpi.tips')} value={formatMoney(summary.tipCents)} sub={t('sales.summary.kpi.tipsSub', { pct: formatPct(summary.tipCents, summary.salesCents) })} accent={accents[1]} />
        <KpiTile label={t('sales.summary.kpi.tax')} value={formatMoney(summary.taxCents)} accent={accents[4]} />
        <KpiTile label={t('sales.summary.kpi.checks')} value={String(summary.checkCount)} sub={t('sales.summary.kpi.checksSub', { amount: formatMoney(summary.avgCheckCents) })} accent={accents[3]} />
        <KpiTile label={t('sales.summary.kpi.covers')} value={String(summary.coverCount)} sub={summary.coverCount ? t('sales.summary.kpi.coversSub', { amount: formatMoney(Math.round(summary.salesCents / summary.coverCount)) }) : undefined} accent={accents[0]} />
      </View>

      {/* Discounts / comps / promos */}
      {(summary.discountCents + summary.compCents + summary.promoCents) > 0 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>{t('sales.summary.discounts.title')}</Text>
            {[
              { key: 'discounts', label: t('sales.summary.discounts.discountsLabel'), value: summary.discountCents },
              { key: 'comps', label: t('sales.summary.discounts.compsLabel'), value: summary.compCents },
              { key: 'promos', label: t('sales.summary.discounts.promosLabel'), value: summary.promoCents },
            ].filter((r) => r.value > 0).map((r) => (
              <View key={r.key} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.muted }}>{r.label}</Text>
                <Text style={{ color: colors.danger, fontWeight: '700' }}>-{formatMoney(r.value)}</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
              <Text style={{ fontWeight: '700' }}>{t('sales.summary.discounts.totalOff')}</Text>
              <Text style={{ color: colors.danger, fontWeight: '800' }}>-{formatMoney(summary.discountCents + summary.compCents + summary.promoCents)}</Text>
            </View>
          </Card.Content>
        </Card>
      ) : null}

      {/* Daily sparkline */}
      {byDay.length > 1 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>{t('sales.summary.dailySales.title')}</Text>
            {byDay.map((d) => (
              <View key={d.date} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{d.date}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700' }}>{formatMoney(d.salesCents)}</Text>
                </View>
                <MiniBar value={d.salesCents} max={maxDay} color={colors.primary} />
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      {/* Tender mix */}
      {byTender.length > 0 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>{t('sales.summary.tenderMix.title')}</Text>
            {byTender.map((tender, i) => (
              <View key={tender.tenderType} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.charcoal }}>{tender.tenderType}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{formatMoney(tender.salesCents)} · {formatPct(tender.salesCents, summary.salesCents)}</Text>
                </View>
                <MiniBar value={tender.salesCents} max={summary.salesCents} color={accents[i % accents.length].icon} />
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      {/* Revenue centers */}
      {byRevenueCenter.length > 1 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>{t('sales.summary.revenueCenters.title')}</Text>
            {byRevenueCenter.map((r, i) => (
              <View key={r.revenueCenter} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.charcoal }}>{r.revenueCenter}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{formatMoney(r.salesCents)} · {t('sales.summary.revenueCenters.checksCount', { count: r.checkCount })}</Text>
                </View>
                <MiniBar value={r.salesCents} max={summary.salesCents} color={accents[i % accents.length].icon} />
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      {/* Avg check time */}
      {summary.avgCheckTimeMins != null ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>{t('sales.summary.avgTableTurn.title')}</Text>
            <Text style={{ fontSize: 28, fontWeight: '800', color: colors.primary, marginTop: 4 }}>{formatDuration(summary.avgCheckTimeMins)}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{t('sales.summary.avgTableTurn.sub')}</Text>
          </Card.Content>
        </Card>
      ) : null}
    </View>
  );
}

function ServersTab({ venueId, days, startTs, endTs }: SalesTabProps) {
  const { t } = useI18n();
  const serverQuery = useQueryState<any>(api.pos.getSalesByServer, { venueId, windowDays: days, startTs, endTs });
  const result = serverQuery.data;

  if (serverQuery.isLoading) return <ScheduleSkeleton rows={4} />;
  if (serverQuery.error) return <ScreenState isLoading={false} error={serverQuery.error} onRetry={() => void serverQuery.refetch()}>{null}</ScreenState>;
  const data = asArray<any>(result);
  if (data.length === 0) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content><Text style={{ color: colors.muted }}>{t('sales.servers.empty')}</Text></Card.Content>
      </Card>
    );
  }

  const maxSales = Math.max(...data.map((r) => r.salesCents), 1);

  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
      <Card.Content style={{ gap: spacing.md }}>
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('sales.servers.title')}</Text>
        {data.map((r, i) => (
          <View key={r.serverName} style={{ gap: 6, paddingBottom: spacing.sm, borderBottomWidth: i < data.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>{r.serverName}</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.primary }}>{formatMoney(r.salesCents)}</Text>
            </View>
            <MiniBar value={r.salesCents} max={maxSales} color={accents[i % accents.length].icon} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Chip compact style={{ backgroundColor: accents[0].bg }}>
                <Text style={{ fontSize: 11, color: accents[0].fg }}>{t('sales.servers.checksCount', { count: r.checkCount })}</Text>
              </Chip>
              <Chip compact style={{ backgroundColor: accents[2].bg }}>
                <Text style={{ fontSize: 11, color: accents[2].fg }}>{t('sales.servers.coversCount', { count: r.coverCount })}</Text>
              </Chip>
              <Chip compact style={{ backgroundColor: accents[1].bg }}>
                <Text style={{ fontSize: 11, color: accents[1].fg }}>{t('sales.servers.avgCheck', { amount: formatMoney(r.avgCheckCents) })}</Text>
              </Chip>
              {r.tipCents > 0 ? (
                <Chip compact style={{ backgroundColor: accents[3].bg }}>
                  <Text style={{ fontSize: 11, color: accents[3].fg }}>{t('sales.servers.tipsAmount', { amount: formatMoney(r.tipCents) })}</Text>
                </Chip>
              ) : null}
              {r.compCents + r.discountCents > 0 ? (
                <Chip compact style={{ backgroundColor: `${colors.danger}1A` }}>
                  <Text style={{ fontSize: 11, color: colors.danger }}>{t('sales.servers.off', { amount: formatMoney(r.compCents + r.discountCents) })}</Text>
                </Chip>
              ) : null}
            </View>
          </View>
        ))}
      </Card.Content>
    </Card>
  );
}

function ItemsTab({ venueId, days, startTs, endTs }: SalesTabProps) {
  const { t } = useI18n();
  const itemsQuery = useQueryState<any>(api.pos.getTopMenuItems, { venueId, windowDays: days, limit: 30, startTs, endTs });
  const result = itemsQuery.data;

  if (itemsQuery.isLoading) return <ScheduleSkeleton rows={4} />;
  if (itemsQuery.error) return <ScreenState isLoading={false} error={itemsQuery.error} onRetry={() => void itemsQuery.refetch()}>{null}</ScreenState>;
  const data = asArray<any>(result);
  if (data.length === 0) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content><Text style={{ color: colors.muted }}>{t('sales.items.empty')}</Text></Card.Content>
      </Card>
    );
  }

  const maxSales = Math.max(...data.map((r) => r.salesCents), 1);
  const categories = Array.from(new Set(data.map((r) => r.category).filter(Boolean))) as string[];

  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
      <Card.Content style={{ gap: spacing.md }}>
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('sales.items.title')}</Text>
        {categories.length > 1
          ? categories.map((cat) => (
            <View key={cat} style={{ gap: spacing.sm }}>
              <Text style={{ fontWeight: '700', color: colors.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>{cat}</Text>
              {data.filter((r) => r.category === cat).map((r, i) => (
                <ItemRow key={r.name} r={r} i={i} maxSales={maxSales} />
              ))}
            </View>
          ))
          : data.map((r, i) => <ItemRow key={r.name} r={r} i={i} maxSales={maxSales} />)
        }
      </Card.Content>
    </Card>
  );
}

function ItemRow({ r, i, maxSales }: { r: { name: string; category: string | null; quantity: number; salesCents: number }; i: number; maxSales: number }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: colors.charcoal }} numberOfLines={1}>{r.name}</Text>
        <Text style={{ fontSize: 13, fontWeight: '700' }}>{formatMoney(r.salesCents)}</Text>
      </View>
      <MiniBar value={r.salesCents} max={maxSales} color={accents[i % accents.length].icon} />
      <Text style={{ color: colors.muted, fontSize: 11 }}>{t('sales.items.qtyAvg', { qty: r.quantity, amount: formatMoney(r.quantity > 0 ? Math.round(r.salesCents / r.quantity) : 0) })}</Text>
    </View>
  );
}

function LaborTab({ venueId, days, startTs, endTs }: SalesTabProps) {
  const { t } = useI18n();
  const laborQuery = useQueryState<any>(api.pos.getLaborSummary, { venueId, windowDays: days, startTs, endTs });
  const data = laborQuery.data;

  if (laborQuery.isLoading) return <ScheduleSkeleton rows={4} />;
  if (laborQuery.error) return <ScreenState isLoading={false} error={laborQuery.error} onRetry={() => void laborQuery.refetch()}>{null}</ScreenState>;
  const byEmployee = asArray<any>(data?.byEmployee);
  if (byEmployee.length === 0) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content><Text style={{ color: colors.muted }}>{t('sales.labor.empty')}</Text></Card.Content>
      </Card>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <KpiTile label={t('sales.labor.kpi.regularHours')} value={formatDuration(data.totalRegularMins)} accent={accents[0]} />
        <KpiTile label={t('sales.labor.kpi.overtimeHours')} value={formatDuration(data.totalOvertimeMins)} sub={data.totalOvertimeMins > 0 ? t('sales.labor.kpi.overtimeSub') : undefined} accent={data.totalOvertimeMins > 0 ? accents[5] : accents[4]} />
        <KpiTile label={t('sales.labor.kpi.totalPay')} value={formatMoney(data.totalPayCents)} accent={accents[2]} />
        <KpiTile label={t('sales.labor.kpi.tipsPaidOut')} value={formatMoney(data.totalTipsCents)} accent={accents[1]} />
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.md }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('sales.labor.byEmployee')}</Text>
          {byEmployee.map((emp: any, i: number) => (
            <View key={emp.employeeName + i} style={{ gap: 6, paddingBottom: spacing.sm, borderBottomWidth: i < byEmployee.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700' }} numberOfLines={1}>{emp.employeeName}</Text>
                  {emp.jobTitle ? <Text style={{ color: colors.muted, fontSize: 12 }}>{emp.jobTitle}</Text> : null}
                </View>
                <Text style={{ fontWeight: '800', color: colors.primary }}>{formatMoney(emp.payCents)}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <Chip compact style={{ backgroundColor: accents[0].bg }}>
                  <Text style={{ fontSize: 11, color: accents[0].fg }}>{t('sales.labor.regHours', { duration: formatDuration(emp.regularMins) })}</Text>
                </Chip>
                {emp.overtimeMins > 0 ? (
                  <Chip compact style={{ backgroundColor: `${colors.danger}1A` }}>
                    <Text style={{ fontSize: 11, color: colors.danger }}>{t('sales.labor.otHours', { duration: formatDuration(emp.overtimeMins) })}</Text>
                  </Chip>
                ) : null}
                {emp.tipsCents > 0 ? (
                  <Chip compact style={{ backgroundColor: accents[1].bg }}>
                    <Text style={{ fontSize: 11, color: accents[1].fg }}>{t('sales.labor.tipsAmount', { amount: formatMoney(emp.tipsCents) })}</Text>
                  </Chip>
                ) : null}
              </View>
            </View>
          ))}
        </Card.Content>
      </Card>
    </View>
  );
}

export default function SalesScreenWrapper() {
  return <ScreenErrorBoundary><SalesScreen /></ScreenErrorBoundary>;
}

function SalesScreen() {
  const { t } = useI18n();
  const { venue, isReady, profileLoading, canManage } = useVenueAuth();

  const [tab, setTab] = useState<'summary' | 'servers' | 'items' | 'labor'>('summary');
  const { selected: dateRange, setSelected: setDateRange, presets } = useDateRange('today');

  if (!venue?.id) {
    return (
      <ManagerGate canManage={canManage} profileLoading={profileLoading} feature={t('sales.managerGate.feature')}>
        <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
          <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
            <Card.Content>
              <Text style={{ color: colors.muted }}>{t('sales.noVenue')}</Text>
            </Card.Content>
          </Card>
        </ScrollView>
      </ManagerGate>
    );
  }

  return (
    <ManagerGate canManage={canManage} profileLoading={profileLoading} feature={t('sales.managerGate.feature')}>
    <PremiumFeatureGate feature="pos_analytics">
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 64 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <SectionHeader
          kicker={t('sales.header.kicker')}
          title={t('sales.header.title')}
          subtitle={t('sales.header.subtitle', { venue: venue.name ?? t('sales.header.venueFallback') })}
          trailing={<DateRangeBar selected={dateRange} presets={presets} onSelect={setDateRange} />}
        />

        {/* Tab switcher */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: 620 }}>
          <SegmentedButtons
            value={tab}
            onValueChange={(v) => setTab(v as typeof tab)}
            style={{ minWidth: 620 }}
            buttons={[
              { value: 'summary', label: t('sales.tabs.summary') },
              { value: 'servers', label: t('sales.tabs.servers') },
              { value: 'items', label: t('sales.tabs.items') },
              { value: 'labor', label: t('sales.tabs.labor') },
            ]}
          />
        </ScrollView>

        {/* Content */}
        <AnimatedTab tabKey={tab}>
          {tab === 'summary' && <SummaryTab venueId={venue.id} days={dateRange.days} startTs={dateRange.startTs} endTs={dateRange.endTs} />}
          {tab === 'servers' && <ServersTab venueId={venue.id} days={dateRange.days} startTs={dateRange.startTs} endTs={dateRange.endTs} />}
          {tab === 'items' && <ItemsTab venueId={venue.id} days={dateRange.days} startTs={dateRange.startTs} endTs={dateRange.endTs} />}
          {tab === 'labor' && <LaborTab venueId={venue.id} days={dateRange.days} startTs={dateRange.startTs} endTs={dateRange.endTs} />}
        </AnimatedTab>
      </ScrollView>
    </PremiumFeatureGate>
    </ManagerGate>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
