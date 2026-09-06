import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandButton, CommandText, StatusPill } from '../../components/FutureUI';
import { ScreenState } from '../../components/ScreenState';
import { apiRequest, useApiQuery } from '../../lib/api-client';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { asArray, errorMessage, formatMoney, humanizeLabel } from '../../lib/format';
import { radius, spacing, useDesignTheme } from '../../lib/theme';
import { crmEventBeoRoute } from '../../lib/crm-routing';
import {
  type EventBeoReportDocument,
  type PublishedBeoReport,
  type ReportDepartmentSection,
  formatWindow,
  isOpenLineStatus,
  parseReportDepartment,
} from '../../lib/beo-report';

type UpcomingEvent = { id: string; title: string; startsAt: string; eventCode: string | null };
type StadiumOverview = { events?: UpcomingEvent[] };

/**
 * The published event BEO report.
 *
 * This is the document every BEO entry point leads to: the suite BEO list for
 * one event, followed by each department's run of service in chronological
 * order. It reads from the published snapshot, not from live tables, so what a
 * suite host and a department head see is the same copy taken at publish time.
 */
export default function EventBeoReportScreen() {
  const palette = useDesignTheme();
  const { canManage } = useVenueAuth();
  const params = useLocalSearchParams<{ eventId?: string; department?: string }>();
  const requestedEventId = typeof params.eventId === 'string' ? params.eventId : undefined;
  const [publishing, setPublishing] = useState(false);

  const overview = useApiQuery<StadiumOverview>(['stadium', 'overview'], '/v1/stadium/overview');
  const upcoming = asArray<UpcomingEvent>(overview.data?.events);
  // Without an explicit event the report opens on the next one, which is what a
  // manager tapping "Suite BEOs" on event day is asking for.
  const eventId = requestedEventId ?? upcoming[0]?.id;

  const reportQuery = useApiQuery<PublishedBeoReport | null>(
    ['stadium', 'beo-report', eventId ?? 'none'],
    `/v1/stadium/events/${eventId}/beo-report`,
    Boolean(eventId),
  );

  const published = reportQuery.data ?? null;
  const document: EventBeoReportDocument | null = published?.report ?? null;

  const [departmentFilter, setDepartmentFilter] = useState<string | null>(
    parseReportDepartment(params.department) ?? null
  );

  const departments = useMemo<ReportDepartmentSection[]>(() => {
    const all = asArray<ReportDepartmentSection>(document?.departments);
    return departmentFilter ? all.filter((section) => section.code === departmentFilter) : all;
  }, [document?.departments, departmentFilter]);

  const publish = async () => {
    if (!eventId) return;
    setPublishing(true);
    try {
      await apiRequest(`/v1/stadium/events/${eventId}/beo-report/publish`, { method: 'POST' });
      await reportQuery.refetch();
    } catch (error) {
      Alert.alert('Publish failed', errorMessage(error, 'The BEO report was not published.'));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { backgroundColor: '#013369' }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 6 })}
        >
          <MaterialCommunityIcons name="arrow-left" size={20} color="#FFFFFF" />
          <CommandText palette={palette} variant="label" style={{ color: '#A8C4E0' }}>BACK</CommandText>
        </Pressable>
        <CommandText palette={palette} variant="hero" style={{ color: '#FFFFFF', marginTop: spacing.xs }}>
          Banquet Event Orders
        </CommandText>
        <CommandText palette={palette} variant="body" style={{ color: '#C5D6EB' }}>
          {document
            ? `${document.event.title}${document.event.eventCode ? ` · ${document.event.eventCode}` : ''}`
            : 'Suite BEOs and each department’s run of service for one event.'}
        </CommandText>
        {published ? (
          <CommandText palette={palette} variant="caption" style={{ color: '#8FB0D0', marginTop: 2 }}>
            Version {published.version} · published {new Date(published.publishedAt).toLocaleString()} by{' '}
            {published.publishedBy}
            {published.trigger === 'scheduled' ? ' (scheduled)' : ''}
          </CommandText>
        ) : null}
      </View>

      <View style={{ padding: spacing.md, gap: spacing.md }}>
        {upcoming.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {upcoming.slice(0, 8).map((event) => {
              const active = event.id === eventId;
              return (
                <Pressable
                  key={event.id}
                  onPress={() => router.setParams({ eventId: event.id })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.chip,
                    { backgroundColor: active ? palette.primary : palette.surface, borderColor: active ? palette.primary : palette.border },
                  ]}
                >
                  <CommandText
                    palette={palette}
                    variant="caption"
                    style={{ color: active ? palette.buttonText : palette.charcoal, fontWeight: '700' }}
                  >
                    {event.title}
                  </CommandText>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <ScreenState
          isLoading={reportQuery.isLoading || overview.isLoading}
          error={reportQuery.error}
          onRetry={() => void reportQuery.refetch()}
        >
          {!eventId ? (
            <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <CommandText palette={palette} variant="title">No upcoming event</CommandText>
              <CommandText palette={palette} variant="body" style={{ color: palette.muted }}>
                Create an event before publishing a BEO report.
              </CommandText>
            </View>
          ) : !document ? (
            <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <CommandText palette={palette} variant="title">No report published yet</CommandText>
              <CommandText palette={palette} variant="body" style={{ color: palette.muted }}>
                A report publishes automatically the day before the event. Publish now to hand departments a copy
                sooner.
              </CommandText>
              {canManage ? (
                <CommandButton palette={palette} icon="file-document-check-outline" selected onPress={() => void publish()}>
                  {publishing ? 'Publishing…' : 'Generate & publish report'}
                </CommandButton>
              ) : null}
            </View>
          ) : (
            <>
              <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={styles.summaryRow}>
                  <Summary palette={palette} label="Suite BEOs" value={String(document.suites.beoCount)} />
                  <Summary palette={palette} label="Suite guests" value={String(document.suites.guestCount)} />
                  <Summary palette={palette} label="Catering total" value={formatMoney(document.suites.revenueCents)} />
                  <Summary palette={palette} label="Open items" value={String(document.totals.openLineCount)} />
                </View>
                {canManage ? (
                  <CommandButton palette={palette} icon="refresh" onPress={() => void publish()}>
                    {publishing ? 'Publishing…' : 'Publish new version'}
                  </CommandButton>
                ) : null}
                {document.dataGaps.length ? (
                  <View style={{ gap: 4 }}>
                    {document.dataGaps.map((gap) => (
                      <CommandText key={gap} palette={palette} variant="caption" style={{ color: palette.warning }}>
                        • {gap}
                      </CommandText>
                    ))}
                  </View>
                ) : null}
              </View>

              {/* ── SUITE BEO LIST, chronological by delivery window ── */}
              <View style={styles.beoHeader}>
                <CommandText palette={palette} variant="title" style={{ flex: 1 }}>Suite BEOs</CommandText>
                {canManage ? (
                  <Pressable
                    onPress={() => router.push(crmEventBeoRoute(document.event.title) as any)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit BEOs for ${document.event.title} in the CRM`}
                    style={({ pressed }) => [styles.linkBtn, { borderColor: palette.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <MaterialCommunityIcons name="pencil-outline" size={14} color={String(palette.primary)} />
                    <CommandText palette={palette} variant="caption" style={{ color: palette.primary, fontWeight: '700' }}>
                      Edit in CRM
                    </CommandText>
                  </Pressable>
                ) : null}
              </View>
              {/*
                The report is read-only by design — it is a published snapshot.
                Editing happens in the CRM, which holds the sales BEO. The link
                carries the event name because a CrmBeo and a SuiteBeoOrder are
                separate records with no relation, so there is no per-row target.
              */}
              {document.suites.rows.length === 0 ? (
                <CommandText palette={palette} variant="body" style={{ color: palette.muted }}>
                  No suite BEOs are attached to this event.
                </CommandText>
              ) : (
                document.suites.rows.map((row) => (
                  <View
                    key={row.id}
                    style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
                  >
                    <View style={styles.beoHeader}>
                      <View style={{ flex: 1 }}>
                        <CommandText palette={palette} variant="body" style={{ fontWeight: '800' }}>
                          {row.suiteCode ? `${row.suiteCode} · ` : ''}{row.suiteName}
                        </CommandText>
                        <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                          {row.beoNumber} · {row.zoneName}
                        </CommandText>
                      </View>
                      <StatusPill palette={palette} tone={row.status === 'delivered' ? 'good' : isOpenLineStatus(row.status) ? 'warn' : 'neutral'}>
                        {humanizeLabel(row.status)}
                      </StatusPill>
                    </View>

                    <CommandText palette={palette} variant="body">
                      Host {row.hostName} · {row.guestCount} guests
                    </CommandText>
                    <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                      Service window {formatWindow(row.deliveryWindowStart, row.deliveryWindowEnd)}
                    </CommandText>
                    {row.specialInstructions ? (
                      <CommandText palette={palette} variant="caption" style={{ color: palette.warning }}>
                        {row.specialInstructions}
                      </CommandText>
                    ) : null}

                    <View style={[styles.itemsBox, { borderColor: palette.divider }]}>
                      {row.lineItems.map((item, index) => (
                        <View key={`${row.id}-${item.code || index}`} style={styles.itemRow}>
                          <CommandText palette={palette} variant="caption" style={{ width: 34, fontWeight: '800' }}>
                            {item.quantity}×
                          </CommandText>
                          <CommandText palette={palette} variant="caption" style={{ flex: 1 }}>{item.name}</CommandText>
                          <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                            {formatMoney(item.unitPriceCents * item.quantity)}
                          </CommandText>
                        </View>
                      ))}
                      <View style={[styles.itemRow, { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingTop: 6 }]}>
                        <CommandText palette={palette} variant="caption" style={{ flex: 1, fontWeight: '800' }}>
                          BEO total
                        </CommandText>
                        <CommandText palette={palette} variant="caption" style={{ fontWeight: '800' }}>
                          {formatMoney(row.totalCents)}
                        </CommandText>
                      </View>
                    </View>
                  </View>
                ))
              )}

              {/* ── DEPARTMENT RUN OF SERVICE ── */}
              <CommandText palette={palette} variant="title">Departments</CommandText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                <Pressable
                  onPress={() => setDepartmentFilter(null)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: departmentFilter === null }}
                  style={[
                    styles.chip,
                    { backgroundColor: departmentFilter === null ? palette.primary : palette.surface, borderColor: palette.border },
                  ]}
                >
                  <CommandText
                    palette={palette}
                    variant="caption"
                    style={{ color: departmentFilter === null ? palette.buttonText : palette.charcoal, fontWeight: '700' }}
                  >
                    All
                  </CommandText>
                </Pressable>
                {asArray<ReportDepartmentSection>(document.departments).map((section) => {
                  const active = departmentFilter === section.code;
                  return (
                    <Pressable
                      key={section.code}
                      onPress={() => setDepartmentFilter(active ? null : section.code)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.chip,
                        { backgroundColor: active ? palette.primary : palette.surface, borderColor: palette.border },
                      ]}
                    >
                      <CommandText
                        palette={palette}
                        variant="caption"
                        style={{ color: active ? palette.buttonText : palette.charcoal, fontWeight: '700' }}
                      >
                        {section.label} ({section.lineCount})
                      </CommandText>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {departments.length === 0 ? (
                <CommandText palette={palette} variant="body" style={{ color: palette.muted }}>
                  No departmental run of service exists for this event yet.
                </CommandText>
              ) : (
                departments.map((section) => (
                  <View
                    key={section.code}
                    style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
                  >
                    <View style={styles.beoHeader}>
                      <CommandText palette={palette} variant="body" style={{ flex: 1, fontWeight: '800' }}>
                        {section.label}
                      </CommandText>
                      <StatusPill palette={palette} tone={section.openCount ? 'warn' : 'good'}>
                        {section.openCount ? `${section.openCount} open` : 'All clear'}
                      </StatusPill>
                    </View>
                    {section.lines.map((line) => (
                      <View key={line.id} style={[styles.lineRow, { borderColor: palette.divider }]}>
                        <CommandText palette={palette} variant="caption" style={{ width: 66, color: palette.muted, fontVariant: ['tabular-nums'] }}>
                          {line.at
                            ? new Date(line.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                            : '—'}
                        </CommandText>
                        <View style={{ flex: 1 }}>
                          <CommandText palette={palette} variant="body">{line.title}</CommandText>
                          {line.detail ? (
                            <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                              {line.detail}
                              {line.reference ? ` · ${line.reference}` : ''}
                            </CommandText>
                          ) : null}
                        </View>
                        <CommandText
                          palette={palette}
                          variant="caption"
                          style={{ color: isOpenLineStatus(line.status) ? palette.warning : palette.success, fontWeight: '700' }}
                        >
                          {humanizeLabel(line.status)}
                        </CommandText>
                      </View>
                    ))}
                  </View>
                ))
              )}
            </>
          )}
        </ScreenState>
      </View>
    </ScrollView>
  );
}

function Summary({ palette, label, value }: { palette: ReturnType<typeof useDesignTheme>; label: string; value: string }) {
  return (
    <View style={{ minWidth: 78, gap: 2 }}>
      <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>{label}</CommandText>
      <CommandText palette={palette} variant="body" style={{ fontWeight: '800' }}>{value}</CommandText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xs },
  card: { borderRadius: 8, borderWidth: 1, padding: spacing.md, gap: spacing.sm },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  chipRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
  chip: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  beoHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
  },
  itemsBox: { borderWidth: 1, borderRadius: 6, padding: spacing.sm, gap: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
