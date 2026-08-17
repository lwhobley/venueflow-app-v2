import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { router } from 'expo-router';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { accents, colors, radius, spacing } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { DateRangeBar, useDateRange } from '../../components/DateRangeBar';
import { ProviderDropdown } from '../../components/ProviderDropdown';
import { ManagerGate } from '../../components/ManagerGate';
import { SectionHeader } from '../../components/AppCard';
import { useI18n } from '../../lib/i18n';

// What we record as the export destination on /v1/payroll/record-export. The
// server stores `provider` as a free-form string today, so this list is purely
// the dropdown's choices — adding a vendor here is sufficient.
const payrollProviderOptions = [
  { value: 'gusto', label: 'Gusto' },
  { value: 'square_payroll', label: 'Square Payroll' },
  { value: 'toast_payroll', label: 'Toast Payroll' },
  { value: 'adp', label: 'ADP' },
  { value: 'paychex', label: 'Paychex' },
  { value: 'rippling', label: 'Rippling' },
  { value: 'paylocity', label: 'Paylocity' },
  { value: 'justworks', label: 'Justworks' },
  { value: 'onpay', label: 'OnPay' },
  { value: 'quickbooks_payroll', label: 'QuickBooks Payroll' },
  { value: 'wave_payroll', label: 'Wave Payroll' },
  { value: 'patriot', label: 'Patriot Software' },
  { value: 'homebase_payroll', label: 'Homebase Payroll' },
  { value: 'deel', label: 'Deel' },
  { value: 'csv', label: 'Other / generic CSV' },
] as const;
type PayrollProvider = (typeof payrollProviderOptions)[number]['value'];

type Insight = {
  scheduledShifts: number;
  openShifts: number;
  activeClocks: number;
  lateOrMissedAlerts: number;
  activeReservations: number;
  upcomingReservations: number;
  pendingRequests: number;
  laborHours?: number;
};

export default function ReportsScreen() {
  const { t } = useI18n();
  const { venue, isReady, profileLoading, canManage } = useVenueAuth();
  const [showTimeCsv, setShowTimeCsv] = useState(false);
  const [showPayrollCsv, setShowPayrollCsv] = useState(false);
  const [payrollProvider, setPayrollProvider] = useState<PayrollProvider>('gusto');
  const [showReservationCsv, setShowReservationCsv] = useState(false);
  const { selected: dateRange, setSelected: setDateRange, presets } = useDateRange('today');

  const insights = useQuery(api.app.getManagerInsights, isReady && canManage ? {} : 'skip') as Insight | null | undefined;
  const laborForecast = useQuery(api.scheduling.getLaborForecast, isReady && canManage ? {} : 'skip') as any;
  const timeCsv = useQuery(api.app.exportTimeEntriesCsv, isReady && canManage && showTimeCsv ? { startDate: dateRange.startDate, endDate: dateRange.endDate } : 'skip') as string | null | undefined;
  const reservationCsv = useQuery(api.reservations.exportReservationsCsv, isReady && canManage && showReservationCsv && venue?.id ? { venueId: venue.id, startDate: dateRange.startDate, endDate: dateRange.endDate } : 'skip') as string | null | undefined;
  const payroll = useQuery(api.payroll.getPayrollSummary, isReady && canManage && venue?.id ? { venueId: venue.id, startDate: dateRange.startDate, endDate: dateRange.endDate } : 'skip') as any;
  const payrollCsv = useQuery(api.payroll.exportPayrollCsv, isReady && canManage && showPayrollCsv && venue?.id ? { venueId: venue.id, startDate: dateRange.startDate, endDate: dateRange.endDate } : 'skip') as string | null | undefined;
  const recordPayrollExport = useMutation(api.payroll.recordPayrollExport);



  const metrics = [
    { label: t('reports.metrics.scheduledShifts'), value: insights?.scheduledShifts ?? 0, accent: accents[0] },
    { label: t('reports.metrics.openShifts'), value: insights?.openShifts ?? 0, accent: accents[1] },
    { label: t('reports.metrics.clockedIn'), value: insights?.activeClocks ?? 0, accent: accents[2] },
    { label: t('reports.metrics.clockAlerts'), value: insights?.lateOrMissedAlerts ?? 0, accent: accents[3] },
    { label: t('reports.metrics.activeReservations'), value: insights?.activeReservations ?? 0, accent: accents[4] },
    { label: t('reports.metrics.next24hBookings'), value: insights?.upcomingReservations ?? 0, accent: accents[0] },
    { label: t('reports.metrics.pendingRequests'), value: insights?.pendingRequests ?? 0, accent: accents[1] },
  ];

  const periodLabel = payroll?.totals?.periodStart && payroll?.totals?.periodEnd
    ? `${new Date(payroll.totals.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(payroll.totals.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : null;

  return (
    <ManagerGate canManage={canManage} profileLoading={profileLoading} feature={t('reports.header.title')}>
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader
        kicker={t('reports.header.kicker')}
        title={t('reports.header.title')}
        subtitle={t('reports.header.subtitle', { venue: venue?.name ?? t('reports.header.venueFallback') })}
        trailing={<DateRangeBar selected={dateRange} presets={presets} onSelect={setDateRange} />}
      />

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('reports.integrations.title')}</Text>
          <Text style={{ color: colors.muted }}>{t('reports.integrations.description')}</Text>
          <Button compact mode="contained" buttonColor={colors.primary} icon="connection" onPress={() => router.push('/integrations')}>
            {t('reports.integrations.openButton')}
          </Button>
        </Card.Content>
      </Card>

      {/* Live metrics — always show current state */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('reports.snapshot.title')}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {t('reports.snapshot.rightNow')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {metrics.map((metric) => (
              <Card key={metric.label} style={{ backgroundColor: metric.accent.bg, minWidth: '47%', flexGrow: 1, borderRadius: radius.sharp }}>
                <Card.Content style={{ gap: 4 }}>
                  <Text style={{ color: metric.accent.fg, fontSize: 26, fontWeight: '800' }}>{metric.value}</Text>
                  <Text style={{ color: colors.charcoal, fontSize: 12 }}>{metric.label}</Text>
                </Card.Content>
              </Card>
            ))}
          </View>
        </Card.Content>
      </Card>

      {/* Labor efficiency */}
      {laborForecast ? (() => {
        const scheduled = laborForecast.totals?.scheduledHours ?? 0;
        const suggested = laborForecast.totals?.suggestedHours ?? 0;
        const budgetHours = laborForecast.laborBudgetHours ?? null;
        const otRisk = (laborForecast.otRisk ?? []) as Array<{ name: string; scheduledHours: number; overLimit: boolean }>;
        const alerts = (laborForecast.alerts ?? []) as Array<{ kind: string; severity: string; message: string }>;
        const understaffedDays = alerts.filter((a) => a.kind === 'understaffed').length;
        const overstaffedDays = alerts.filter((a) => a.kind === 'overstaffed').length;
        const otViolations = otRisk.filter((r) => r.overLimit).length;
        const otApproaching = otRisk.filter((r) => !r.overLimit).length;
        const utilizationPct = suggested > 0 ? Math.round((scheduled / suggested) * 100) : null;
        const budgetPct = budgetHours ? Math.round((scheduled / budgetHours) * 100) : null;
        return (
          <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('reports.labor.title')}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{t('reports.labor.subtitle')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                <View style={{ backgroundColor: accents[2].bg, borderRadius: radius.sharp, padding: spacing.sm, flex: 1, minWidth: 100, gap: 2 }}>
                  <Text style={{ color: accents[2].fg, fontSize: 22, fontWeight: '800' }}>{scheduled}h</Text>
                  <Text style={{ color: colors.charcoal, fontSize: 11 }}>{t('reports.labor.scheduledThisWeek')}</Text>
                </View>
                <View style={{ backgroundColor: accents[1].bg, borderRadius: radius.sharp, padding: spacing.sm, flex: 1, minWidth: 100, gap: 2 }}>
                  <Text style={{ color: accents[1].fg, fontSize: 22, fontWeight: '800' }}>{suggested}h</Text>
                  <Text style={{ color: colors.charcoal, fontSize: 11 }}>{t('reports.labor.demandSuggested')}</Text>
                </View>
                {utilizationPct !== null && (
                  <View style={{ backgroundColor: utilizationPct < 80 ? `${colors.danger}22` : utilizationPct > 120 ? `${colors.warning}22` : `${colors.success}22`, borderRadius: radius.sharp, padding: spacing.sm, flex: 1, minWidth: 100, gap: 2 }}>
                    <Text style={{ color: colors.charcoal, fontSize: 22, fontWeight: '800' }}>{utilizationPct}%</Text>
                    <Text style={{ color: colors.charcoal, fontSize: 11 }}>{t('reports.labor.coverageUtilization')}</Text>
                  </View>
                )}
                {budgetPct !== null && (
                  <View style={{ backgroundColor: accents[0].bg, borderRadius: radius.sharp, padding: spacing.sm, flex: 1, minWidth: 100, gap: 2 }}>
                    <Text style={{ color: accents[0].fg, fontSize: 22, fontWeight: '800' }}>{budgetPct}%</Text>
                    <Text style={{ color: colors.charcoal, fontSize: 11 }}>{t('reports.labor.ofBudget', { budget: budgetHours })}</Text>
                  </View>
                )}
              </View>
              {(understaffedDays > 0 || overstaffedDays > 0 || otViolations > 0 || otApproaching > 0) && (
                <View style={{ gap: 4 }}>
                  {understaffedDays > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger }} />
                      <Text style={{ color: colors.charcoal, fontSize: 13 }}>{t(understaffedDays === 1 ? 'reports.labor.understaffedSingular' : 'reports.labor.understaffedPlural', { count: understaffedDays })}</Text>
                    </View>
                  )}
                  {overstaffedDays > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning }} />
                      <Text style={{ color: colors.charcoal, fontSize: 13 }}>{t(overstaffedDays === 1 ? 'reports.labor.overstaffedSingular' : 'reports.labor.overstaffedPlural', { count: overstaffedDays })}</Text>
                    </View>
                  )}
                  {otViolations > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger }} />
                      <Text style={{ color: colors.charcoal, fontSize: 13 }}>{t(otViolations === 1 ? 'reports.labor.otViolationsSingular' : 'reports.labor.otViolationsPlural', { count: otViolations })}</Text>
                    </View>
                  )}
                  {otApproaching > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning }} />
                      <Text style={{ color: colors.charcoal, fontSize: 13 }}>{t(otApproaching === 1 ? 'reports.labor.otApproachingSingular' : 'reports.labor.otApproachingPlural', { count: otApproaching })}</Text>
                    </View>
                  )}
                </View>
              )}
              {understaffedDays === 0 && overstaffedDays === 0 && otViolations === 0 && otApproaching === 0 && (
                <Text style={{ color: colors.success, fontSize: 13 }}>{t('reports.labor.noIssues')}</Text>
              )}
            </Card.Content>
          </Card>
        );
      })() : null}

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('reports.timeCsv.title')}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{dateRange.shortLabel}</Text>
          </View>
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowTimeCsv((value) => !value)}>
            {showTimeCsv ? t('reports.common.hideExport') : t('reports.common.loadExport')}
          </Button>
          {showTimeCsv ? (
            <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
              {timeCsv ?? t('reports.common.loadingExport')}
            </Text>
          ) : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <View style={{ flex: 1 }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('reports.payroll.title')}</Text>
              <Text style={{ color: colors.muted }}>
                {payroll ? t('reports.payroll.summary', { hours: payroll.totals?.totalHours, count: payroll.totals?.employeeCount, period: periodLabel ? ` · ${periodLabel}` : '' }) : t('reports.payroll.loadingSummary')}
              </Text>
            </View>
            <Button
              compact
              mode="outlined"
              textColor={colors.primary}
              onPress={() => {
                if (venue?.id && payroll?.totals) {
                  void recordPayrollExport({
                    venueId: venue.id,
                    provider: payrollProvider,
                    periodStart: new Date(payroll.totals.periodStart).toISOString(),
                    periodEnd: new Date(payroll.totals.periodEnd).toISOString(),
                    rowCount: payroll.byEmployee?.length ?? 0,
                    totalHours: payroll.totals.totalHours,
                  });
                }
              }}
            >
              {t('reports.payroll.recordExport')}
            </Button>
          </View>
          <ProviderDropdown
            label={t('reports.payroll.providerLabel')}
            value={payrollProvider}
            options={payrollProviderOptions}
            onChange={(next) => setPayrollProvider(next as PayrollProvider)}
          />
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowPayrollCsv((value) => !value)}>
            {showPayrollCsv ? t('reports.payroll.hidePayrollExport') : t('reports.payroll.loadPayrollExport')}
          </Button>
          {showPayrollCsv ? (
            <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
              {payrollCsv ?? t('reports.payroll.loadingPayrollExport')}
            </Text>
          ) : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('reports.reservationsCsv.title')}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{dateRange.shortLabel}</Text>
          </View>
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowReservationCsv((value) => !value)}>
            {showReservationCsv ? t('reports.common.hideExport') : t('reports.common.loadExport')}
          </Button>
          {showReservationCsv ? (
            <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
              {reservationCsv ?? t('reports.common.loadingExport')}
            </Text>
          ) : null}
        </Card.Content>
      </Card>
    </ScrollView>
    </ManagerGate>
  );
}
