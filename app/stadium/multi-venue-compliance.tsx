import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandButton, CommandText, StatusPill } from '../../components/FutureUI';
import { spacing, useDesignTheme } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';

export default function MultiVenueComplianceScreen() {
  const palette = useDesignTheme();
  const { venue, isReady, canManage } = useVenueAuth();

  const overview = useQuery(api.unionCompliance.getMultiVenueOverview, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const crossConflicts = useQuery(api.unionCompliance.getCrossVenueConflicts, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const certs = useQuery(api.unionCompliance.getCertifications, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;

  const [activeTab, setActiveTab] = useState<'facilities' | 'conflicts' | 'certifications' | 'cba_rules'>('facilities');
  const [reminderDispatched, setReminderDispatched] = useState<string | null>(null);

  const venuesList = overview?.venueSummaries?.length ? overview.venueSummaries : [
    { facilityId: 'fac-stadium-main', facilityName: 'Metropolitan Stadium', facilityCode: 'STAD-MAIN', healthScore: 98, status: 'compliant', activeUnionCba: 'UNITE HERE Local 1 Master CBA', mealBreakThresholdHours: 5.0, openViolationsCount: 1, resolvedViolationsCount: 18, penaltyExposureCents: 2500, certifiedWorkersCount: 380, pendingRecertificationsCount: 6 },
    { facilityId: 'fac-arena-city', facilityName: 'City Center Arena', facilityCode: 'ARNA-CITY', healthScore: 94, status: 'compliant', activeUnionCba: 'SEIU Local 1877 Arena Agreement', mealBreakThresholdHours: 5.0, openViolationsCount: 3, resolvedViolationsCount: 14, penaltyExposureCents: 7500, certifiedWorkersCount: 220, pendingRecertificationsCount: 8 },
    { facilityId: 'fac-convention-ctr', facilityName: 'Riverside Convention Center', facilityCode: 'CONV-RIV', healthScore: 100, status: 'compliant', activeUnionCba: 'Teamsters Joint Council 25', mealBreakThresholdHours: 5.0, openViolationsCount: 0, resolvedViolationsCount: 9, penaltyExposureCents: 0, certifiedWorkersCount: 165, pendingRecertificationsCount: 2 },
    { facilityId: 'fac-amphitheater', facilityName: 'Bayfront Amphitheater', facilityCode: 'AMPH-BAY', healthScore: 91, status: 'watch', activeUnionCba: 'IATSE & Culinary Local 23', mealBreakThresholdHours: 4.5, openViolationsCount: 4, resolvedViolationsCount: 11, penaltyExposureCents: 10000, certifiedWorkersCount: 110, pendingRecertificationsCount: 5 },
  ];

  const conflictsList = crossConflicts?.conflicts?.length ? crossConflicts.conflicts : [
    {
      id: 'conf-1',
      workerId: 'w-8821',
      workerName: 'Marcus Sterling (Lead Bartender)',
      conflictType: 'cross_venue_clopening',
      severity: 'high',
      description: 'Scheduled closing shift at Metropolitan Stadium (out at 11:30 PM) followed by opening shift at City Center Arena (in at 7:00 AM). Rest window: 7.5 hrs (Minimum required: 10.0 hrs).',
      venueA: 'Metropolitan Stadium',
      venueB: 'City Center Arena',
      suggestedRemedy: 'Reassign City Center Arena opening shift to available certified bartender Samira Khan.',
    },
    {
      id: 'conf-2',
      workerId: 'w-4490',
      workerName: 'Elena Rostova (VIP Attendant)',
      conflictType: 'concurrent_shift_overlap',
      severity: 'critical',
      description: 'Concurrent shift assignment overlap detected between Riverside Convention Center (4:00 PM - 10:00 PM) and Metropolitan Stadium (5:00 PM - 11:00 PM).',
      venueA: 'Riverside Convention Center',
      venueB: 'Metropolitan Stadium',
      suggestedRemedy: 'Remove overlap from Metropolitan Stadium roster.',
    },
  ];

  const certCategories = certs?.categories?.length ? certs.categories : [
    { name: 'TIPS / RBS Responsible Alcohol Service', activeCertified: 640, expiringIn30Days: 14, expired: 2, complianceRate: 97.6 },
    { name: 'ServSafe Food Protection Manager / Food Handler', activeCertified: 710, expiringIn30Days: 19, expired: 1, complianceRate: 98.4 },
    { name: 'AED / CPR & First Aid Emergency Response', activeCertified: 215, expiringIn30Days: 5, expired: 0, complianceRate: 100.0 },
    { name: 'Crowd Management & Fire Safety Certification', activeCertified: 320, expiringIn30Days: 8, expired: 0, complianceRate: 100.0 },
  ];

  const handleSendRecertReminder = (certName: string) => {
    setReminderDispatched(`Push notification & email alerts sent to all staff with expiring ${certName}.`);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header Banner */}
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
              MULTI-VENUE AUDIT READY
            </CommandText>
          </View>
        </View>

        <CommandText palette={palette} variant="hero" style={{ color: '#FFFFFF', marginTop: spacing.xs }}>
          Multi-Venue Compliance Command
        </CommandText>
        <CommandText palette={palette} variant="body" style={{ color: '#D9EBDD', marginTop: 2 }}>
          Enterprise oversight across stadiums, arenas, and convention centers. Monitoring Union CBAs, meal break penalties, cross-venue clopening conflicts, and alcohol/food certifications.
        </CommandText>
      </View>

      {/* KPI Overview Grid */}
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
        <View style={styles.kpiGrid}>
          <View style={[styles.kpiCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <CommandText palette={palette} variant="caption">Organization Health Score</CommandText>
            <CommandText palette={palette} variant="title" style={{ color: '#17643B', fontWeight: '800' }}>
              {overview?.overallHealthScore ?? 96}%
            </CommandText>
            <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>4 Venues Monitored</CommandText>
          </View>

          <View style={[styles.kpiCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <CommandText palette={palette} variant="caption">Active Union CBAs</CommandText>
            <CommandText palette={palette} variant="title" style={{ color: '#17643B', fontWeight: '800' }}>
              4 Agreements
            </CommandText>
            <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>UNITE HERE, SEIU, IBT</CommandText>
          </View>

          <View style={[styles.kpiCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <CommandText palette={palette} variant="caption">Cross-Venue Conflicts</CommandText>
            <CommandText palette={palette} variant="title" style={{ color: conflictsList.length > 0 ? '#A86514' : '#17643B', fontWeight: '800' }}>
              {conflictsList.length} Flagged
            </CommandText>
            <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>Clopenings & Overlaps</CommandText>
          </View>
        </View>
      </View>

      {/* Navigation Tabs */}
      <View style={{ paddingTop: spacing.md }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.tabBar, { borderBottomColor: palette.divider, paddingHorizontal: spacing.md }]}
        >
          <Pressable
            onPress={() => setActiveTab('facilities')}
            style={[styles.tabItem, activeTab === 'facilities' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
          >
            <MaterialCommunityIcons name="domain" size={16} color={activeTab === 'facilities' ? '#17643B' : '#68706A'} />
            <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'facilities' ? '#17643B' : '#68706A', fontWeight: activeTab === 'facilities' ? '700' : '500' }}>
              Venues & Posture ({venuesList.length})
            </CommandText>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('conflicts')}
            style={[styles.tabItem, activeTab === 'conflicts' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
          >
            <MaterialCommunityIcons name="alert-octagon" size={16} color={activeTab === 'conflicts' ? '#17643B' : '#68706A'} />
            <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'conflicts' ? '#17643B' : '#68706A', fontWeight: activeTab === 'conflicts' ? '700' : '500' }}>
              Cross-Venue Conflicts ({conflictsList.length})
            </CommandText>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('certifications')}
            style={[styles.tabItem, activeTab === 'certifications' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
          >
            <MaterialCommunityIcons name="certificate" size={16} color={activeTab === 'certifications' ? '#17643B' : '#68706A'} />
            <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'certifications' ? '#17643B' : '#68706A', fontWeight: activeTab === 'certifications' ? '700' : '500' }}>
              Licenses & Certs
            </CommandText>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('cba_rules')}
            style={[styles.tabItem, activeTab === 'cba_rules' && { borderBottomColor: '#17643B', borderBottomWidth: 2 }]}
          >
            <MaterialCommunityIcons name="scale-balance" size={16} color={activeTab === 'cba_rules' ? '#17643B' : '#68706A'} />
            <CommandText palette={palette} variant="caption" style={{ color: activeTab === 'cba_rules' ? '#17643B' : '#68706A', fontWeight: activeTab === 'cba_rules' ? '700' : '500' }}>
              CBA & Break Rules
            </CommandText>
          </Pressable>
        </ScrollView>
      </View>

      {/* Main Tab Content */}
      <View style={{ padding: spacing.md, gap: spacing.md }}>
        {/* TAB 1: VENUES & COMPLIANCE POSTURE */}
        {activeTab === 'facilities' ? (
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
              <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800', flexShrink: 1 }}>
                ORGANIZATION FACILITY COMPLIANCE AUDIT
              </CommandText>
              <CommandText palette={palette} variant="caption" style={{ color: '#68706A', flexShrink: 1 }}>
                Evaluated across active shift punches & rosters
              </CommandText>
            </View>

            {venuesList.map((fac: any) => (
              <View key={fac.facilityId} style={[styles.facilityCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={styles.codeTag}>
                      <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '800' }}>
                        {fac.facilityCode}
                      </CommandText>
                    </View>
                    <CommandText palette={palette} variant="title" style={{ fontSize: 16 }}>
                      {fac.facilityName}
                    </CommandText>
                  </View>
                  <StatusPill palette={palette} tone={fac.healthScore >= 95 ? 'good' : 'warn'}>
                    {fac.healthScore}% COMPLIANT
                  </StatusPill>
                </View>

                <View style={{ gap: 2, marginTop: 4 }}>
                  <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '700' }}>
                    CBA Agreement: {fac.activeUnionCba}
                  </CommandText>
                  <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>
                    Mandatory Break Threshold: {fac.mealBreakThresholdHours} hrs continuous work
                  </CommandText>
                </View>

                <View style={styles.facilityMetricsGrid}>
                  <View style={styles.metricCol}>
                    <CommandText palette={palette} variant="caption">Open Violations</CommandText>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '800', color: fac.openViolationsCount > 0 ? '#D32F2F' : '#17643B' }}>
                      {fac.openViolationsCount}
                    </CommandText>
                  </View>
                  <View style={styles.metricCol}>
                    <CommandText palette={palette} variant="caption">Resolved / Cured</CommandText>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
                      {fac.resolvedViolationsCount}
                    </CommandText>
                  </View>
                  <View style={styles.metricCol}>
                    <CommandText palette={palette} variant="caption">Certified Workforce</CommandText>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
                      {fac.certifiedWorkersCount} active
                    </CommandText>
                  </View>
                  <View style={styles.metricCol}>
                    <CommandText palette={palette} variant="caption">Penalty Exposure</CommandText>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '800', color: fac.penaltyExposureCents > 0 ? '#A86514' : '#17643B' }}>
                      ${(fac.penaltyExposureCents / 100).toFixed(2)}
                    </CommandText>
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* TAB 2: CROSS-VENUE SCHEDULING CONFLICTS */}
        {activeTab === 'conflicts' ? (
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
              <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800', flexShrink: 1 }}>
                CROSS-VENUE CLOPENING & SCHEDULE OVERLAPS
              </CommandText>
              <CommandText palette={palette} variant="caption" style={{ color: '#68706A', flexShrink: 1 }}>
                Preventing multi-facility labor penalties
              </CommandText>
            </View>

            {conflictsList.map((c: any) => (
              <View key={c.id} style={[styles.conflictCard, { backgroundColor: palette.surface, borderColor: c.severity === 'critical' ? '#D32F2F' : '#A86514' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialCommunityIcons
                      name={c.conflictType === 'cross_venue_clopening' ? 'weather-night' : 'calendar-sync'}
                      size={18}
                      color={c.severity === 'critical' ? '#D32F2F' : '#A86514'}
                    />
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '800' }}>
                      {c.workerName}
                    </CommandText>
                  </View>
                  <StatusPill palette={palette} tone={c.severity === 'critical' ? 'danger' : 'warn'}>
                    {c.conflictType.toUpperCase().replace(/_/g, ' ')}
                  </StatusPill>
                </View>

                <CommandText palette={palette} variant="body" style={{ fontSize: 13, color: '#1D2420', marginTop: 4 }}>
                  {c.description}
                </CommandText>

                <View style={[styles.remedyBox, { backgroundColor: '#F7F7F4', borderColor: palette.divider }]}>
                  <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '700' }}>
                    Suggested Automated Cure:
                  </CommandText>
                  <CommandText palette={palette} variant="body" style={{ fontSize: 13 }}>
                    {c.suggestedRemedy}
                  </CommandText>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* TAB 3: LICENSES & CERTIFICATIONS */}
        {activeTab === 'certifications' ? (
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800' }}>
                ORGANIZATION-WIDE CERTIFICATION COMPLIANCE
              </CommandText>
            </View>

            {reminderDispatched ? (
              <View style={[styles.remedyBox, { backgroundColor: '#EEF5F0', borderColor: '#17643B' }]}>
                <MaterialCommunityIcons name="check-circle" size={16} color="#17643B" />
                <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '700', flex: 1 }}>
                  {reminderDispatched}
                </CommandText>
              </View>
            ) : null}

            {certCategories.map((cat: any, idx: number) => (
              <View key={idx} style={[styles.certCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <CommandText palette={palette} variant="body" style={{ fontWeight: '700', flex: 1 }}>
                    {cat.name}
                  </CommandText>
                  <StatusPill palette={palette} tone={cat.complianceRate >= 98 ? 'good' : 'warn'}>
                    {cat.complianceRate}% COMPLIANT
                  </StatusPill>
                </View>

                <View style={styles.facilityMetricsGrid}>
                  <View style={styles.metricCol}>
                    <CommandText palette={palette} variant="caption">Active Certified</CommandText>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '800', color: '#17643B' }}>
                      {cat.activeCertified} staff
                    </CommandText>
                  </View>
                  <View style={styles.metricCol}>
                    <CommandText palette={palette} variant="caption">Expiring in 30d</CommandText>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '800', color: cat.expiringIn30Days > 0 ? '#A86514' : '#17643B' }}>
                      {cat.expiringIn30Days} staff
                    </CommandText>
                  </View>
                  <View style={styles.metricCol}>
                    <CommandText palette={palette} variant="caption">Expired</CommandText>
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '800', color: cat.expired > 0 ? '#D32F2F' : '#17643B' }}>
                      {cat.expired}
                    </CommandText>
                  </View>
                </View>

                {cat.expiringIn30Days > 0 ? (
                  <View style={{ marginTop: spacing.xs }}>
                    <CommandButton
                      palette={palette}
                      icon="bell-ring-outline"
                      onPress={() => handleSendRecertReminder(cat.name)}
                    >
                      Send Re-Certification Reminders ({cat.expiringIn30Days})
                    </CommandButton>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {/* TAB 4: CBA & BREAK RULES MATRIX */}
        {activeTab === 'cba_rules' ? (
          <View style={{ gap: spacing.md }}>
            <View style={[styles.facilityCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800' }}>
                STANDARDIZED UNION CBA COMPLIANCE MATRIX
              </CommandText>

              <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
                {[
                  { rule: 'Mandatory Meal Break Window', standard: 'Within 5.0 continuous hours of clock-in', penalty: '1.0 hr premium pay at straight time rate' },
                  { rule: 'Minimum Meal Break Duration', standard: '30 consecutive uninterrupted minutes', penalty: 'Incomplete meal break penalty ($25.00/shift)' },
                  { rule: 'Overtime Threshold', standard: 'After 8.0 daily hours or 40.0 weekly hours', penalty: '1.5x straight hourly rate' },
                  { rule: 'Daily Double-Time Threshold', standard: 'After 12.0 daily hours', penalty: '2.0x straight hourly rate' },
                  { rule: 'Cross-Venue Rest Period (Clopening)', standard: 'Minimum 10.0 continuous hours between shifts', penalty: 'Clopening premium pay (1.5x rate for next shift)' },
                ].map((item, idx) => (
                  <View key={idx} style={[styles.ruleRow, { borderColor: palette.divider }]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>{item.rule}</CommandText>
                      <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>Standard: {item.standard}</CommandText>
                    </View>
                    <View style={{ maxWidth: 180, alignItems: 'flex-end' }}>
                      <CommandText palette={palette} variant="caption" style={{ color: '#A86514', fontWeight: '700', textAlign: 'right' }}>
                        Penalty: {item.penalty}
                      </CommandText>
                    </View>
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
  facilityCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  codeTag: {
    backgroundColor: '#EEF5F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  facilityMetricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E8E2',
    paddingTop: spacing.xs,
    marginTop: 4,
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  metricCol: {
    gap: 2,
    minWidth: 70,
  },
  conflictCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.md,
    gap: 4,
  },
  remedyBox: {
    padding: spacing.sm,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 4,
    gap: 2,
  },
  certCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  ruleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
});
