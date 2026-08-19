import { View } from 'react-native';
import { CommandText } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';
import { asArray } from '../lib/format';
import { useWranglerAiUsage } from '../lib/useWrangler';

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: value < 10 ? 2 : 0, maximumFractionDigits: 2 }).format(value);
}

function tokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function featureLabel(value: string | null | undefined) {
  return String(value ?? '').split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function WranglerAiUsagePanel() {
  const palette = useDesignTheme();
  const usage = useWranglerAiUsage(true);

  if (usage.isError) return null;

  return (
    <View style={{ gap: spacing.md, borderTopWidth: 1, borderColor: palette.divider, paddingTop: spacing.lg }}>
      <View style={{ gap: 3 }}>
        <CommandText palette={palette} variant="title">AI usage</CommandText>
        <CommandText palette={palette} variant="caption">Month-to-date usage for this venue. Cost is estimated from configured model rates.</CommandText>
      </View>

      {usage.isLoading || !usage.data?.budget ? (
        <CommandText palette={palette} variant="caption">Loading venue AI usage…</CommandText>
      ) : (
        <>
          {usage.data.budget.status !== 'unlimited' ? (
            <View style={{ gap: spacing.sm, backgroundColor: usage.data.budget.status === 'over_budget' ? '#FFF0ED' : usage.data.budget.status === 'warning' ? '#FFF8E8' : '#F5F7F2', padding: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <CommandText palette={palette} variant="label">
                    {usage.data.budget.status === 'over_budget' ? 'AI BUDGET EXCEEDED' : usage.data.budget.status === 'warning' ? 'AI BUDGET WARNING' : 'AI BUDGET'}
                  </CommandText>
                  <CommandText palette={palette} variant="caption">
                    {money(usage.data.estimatedCostUsd)} of {money(usage.data.budget.budgetUsd)} used this month
                  </CommandText>
                </View>
                <CommandText palette={palette} variant="title">{usage.data.budget.percentUsed.toFixed(1)}%</CommandText>
              </View>
              <View style={{ height: 8, backgroundColor: palette.divider, overflow: 'hidden' }}>
                <View style={{ height: 8, width: `${Math.min(100, usage.data.budget.percentUsed)}%`, backgroundColor: usage.data.budget.status === 'over_budget' ? palette.warning : '#7A5A35' }} />
              </View>
              <CommandText palette={palette} variant="caption">
                {usage.data.budget.status === 'over_budget'
                  ? 'This venue is above its monthly AI budget target. Review high-cost features before usage grows further.'
                  : usage.data.budget.status === 'warning'
                    ? `This venue has crossed the ${usage.data.budget.warningPercent}% warning threshold.`
                    : `${money(usage.data.budget.remainingUsd ?? 0)} remains in the current venue AI budget.`}
              </CommandText>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {[
              ['Estimated spend', money(usage.data.estimatedCostUsd)],
              ['AI requests', String(usage.data.requests)],
              ['Input tokens', tokens(usage.data.promptTokens)],
              ['Output tokens', tokens(usage.data.completionTokens)],
            ].map(([label, value]) => (
              <View key={label} style={{ minWidth: 135, flexGrow: 1, flexBasis: '45%', backgroundColor: '#F8F3EA', padding: spacing.md, gap: 3 }}>
                <CommandText palette={palette} variant="caption">{label}</CommandText>
                <CommandText palette={palette} variant="title">{value}</CommandText>
              </View>
            ))}
          </View>

          <View style={{ gap: spacing.sm }}>
            <CommandText palette={palette} variant="label">BY FEATURE / MODEL</CommandText>
            {asArray(usage.data.breakdown).length ? asArray<(typeof usage.data.breakdown)[number]>(usage.data.breakdown).slice(0, 6).map((row) => (
              <View key={`${row.feature}:${row.model}`} style={{ borderTopWidth: 1, borderColor: palette.divider, paddingTop: spacing.sm, gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                  <CommandText palette={palette} variant="body" style={{ fontWeight: '700', flex: 1 }}>{featureLabel(row.feature)}</CommandText>
                  <CommandText palette={palette} variant="body">{money(row.estimatedCostUsd)}</CommandText>
                </View>
                <CommandText palette={palette} variant="caption">{row.model} · {row.requests} requests · {tokens(row.totalTokens)} tokens</CommandText>
              </View>
            )) : <CommandText palette={palette} variant="caption">No metered AI calls have been recorded for this venue this month.</CommandText>}
          </View>
        </>
      )}
    </View>
  );
}
