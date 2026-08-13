import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { CommandText } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';
import {
  useAskWrangler,
  useWrangler,
  useWranglerOperatorExecute,
  useWranglerOperatorPlan,
  type WranglerOperatorPlan,
} from '../lib/useWrangler';

type Props = {
  enabled: boolean;
};

function statusLabel(status?: string) {
  if (status === 'critical') return 'IMMEDIATE ATTENTION';
  if (status === 'attention') return 'NEEDS WRANGLING';
  if (status === 'watch') return 'WATCH SERVICE';
  return 'SERVICE UNDER CONTROL';
}

function formatOperatorResult(result: unknown): string {
  if (Array.isArray(result)) {
    if (result.length === 0) return 'No matching records found.';
    return result
      .slice(0, 5)
      .map((row) => {
        if (!row || typeof row !== 'object') return String(row);
        const item = row as Record<string, unknown>;
        const name = String(item.guestName ?? item.staffName ?? item.fullName ?? item.jobTitle ?? item.label ?? item.title ?? item.name ?? 'Record');
        const pieces: string[] = [];
        if (item.partySize != null) pieces.push(`party ${item.partySize}`);
        if (item.status != null) pieces.push(String(item.status));
        if (item.startMinutes != null && item.endMinutes != null) pieces.push(`${item.startMinutes}-${item.endMinutes}`);
        if (item.clockInAt != null) pieces.push(`in ${new Date(Number(item.clockInAt)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
        return `• ${name}${pieces.length ? ` — ${pieces.join(' · ')}` : ''}`;
      })
      .join('\n');
  }
  if (result && typeof result === 'object') {
    const item = result as Record<string, unknown>;
    const name = String(item.guestName ?? item.staffName ?? item.fullName ?? item.jobTitle ?? item.label ?? item.title ?? item.itemName ?? item.name ?? 'Done');
    const pieces: string[] = [];
    if (item.partySize != null) pieces.push(`party ${item.partySize}`);
    if (item.status != null) pieces.push(String(item.status));
    if (item.onHand != null) pieces.push(`on hand: ${item.onHand}`);
    if (item.startMinutes != null && item.endMinutes != null) pieces.push(`${item.startMinutes}-${item.endMinutes}`);
    return `• ${name}${pieces.length ? ` — ${pieces.join(' · ')}` : ''}`;
  }
  return result == null ? 'Done.' : String(result);
}

function isCommandInput(text: string): boolean {
  return /^\s*(?:clear|bus|add|schedule|create|86|update|set|remove|assign|post|cancel|correct|mark|clean)\b/i.test(text);
}

export function HomeWranglerSurface({ enabled }: Props) {
  const palette = useDesignTheme();
  const wrangler = useWrangler(enabled);
  const ask = useAskWrangler();
  const operatorPlan = useWranglerOperatorPlan();
  const operatorExecute = useWranglerOperatorExecute();

  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'ask' | 'command'>('ask');
  const [inlineResult, setInlineResult] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<WranglerOperatorPlan | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string[]>([]);

  const snapshot = wrangler.data;

  if (!enabled) return null;

  if (wrangler.isLoading || !snapshot) {
    return (
      <View style={{ marginHorizontal: spacing.lg, marginTop: -1, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, backgroundColor: palette.surface, padding: spacing.md }}>
        <CommandText palette={palette} variant="label">THE WRANGLER</CommandText>
        <CommandText palette={palette} variant="caption" style={{ marginTop: 4 }}>Building the live service picture…</CommandText>
      </View>
    );
  }

  const priority = snapshot.priorities[0];
  const nextAction = priority?.actions[0];
  const urgent = priority?.severity === 'critical' || priority?.severity === 'warning';
  const accent = urgent ? palette.warning : priority?.severity === 'watch' ? '#8A6B2D' : palette.success;

  const handleAsk = async (text?: string) => {
    const query = (text ?? prompt).trim();
    if (query.length < 2) return;
    if (isCommandInput(query)) {
      return handleCommand(query);
    }
    setPendingPlan(null);
    setPendingPreview([]);
    try {
      const res = await ask.mutateAsync({ question: query });
      setInlineResult(`Gemini: ${res.answer}`);
      if (text) setPrompt(text);
    } catch (err) {
      setInlineResult(err instanceof Error ? err.message : 'Could not ask Wrangler.');
    }
  };

  const handleCommand = async (text?: string) => {
    const cmd = (text ?? prompt).trim();
    if (cmd.length < 2) return;
    setPendingPlan(null);
    setPendingPreview([]);
    try {
      const res = await operatorPlan.mutateAsync({ command: cmd });
      if (res.status === 'executed') {
        setInlineResult(`${res.summary}\n${formatOperatorResult(res.result)}`);
      } else {
        setInlineResult(res.summary);
        setPendingPlan(res.plan);
        setPendingPreview(res.preview);
      }
      if (text) setPrompt(text);
    } catch (err) {
      setInlineResult(err instanceof Error ? err.message : 'Wrangler operator failed.');
    }
  };

  const handleSubmit = (text?: string) => {
    const val = (text ?? prompt).trim();
    if (isCommandInput(val) || mode === 'command') {
      void handleCommand(val);
    } else {
      void handleAsk(val);
    }
  };

  const handleRouteToWrangler = (text?: string) => {
    const val = (text ?? prompt).trim();
    if (isCommandInput(val) || mode === 'command') {
      router.push({ pathname: '/wrangler', params: { command: val || undefined } });
    } else {
      router.push({ pathname: '/wrangler', params: { q: val || undefined } });
    }
  };

  const confirmPendingPlan = () => {
    if (!pendingPlan) return;
    const sensitive = pendingPlan.risk === 'sensitive_write';
    Alert.alert(
      sensitive ? 'Confirm sensitive operation' : 'Confirm Wrangler action',
      `${pendingPlan.summary}${pendingPreview.length ? `\n\n${pendingPreview.join('\n')}` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: sensitive ? 'Confirm & record' : 'Confirm',
          style: sensitive ? 'destructive' : 'default',
          onPress: () => void (async () => {
            try {
              const result = await operatorExecute.mutateAsync({ plan: pendingPlan });
              setInlineResult(`Done. ${pendingPlan.summary}\n${formatOperatorResult(result.result)}`);
              setPendingPlan(null);
              setPendingPreview([]);
            } catch (error) {
              setInlineResult(error instanceof Error ? error.message : 'The operation could not be completed.');
            }
          })(),
        },
      ],
    );
  };

  return (
    <View
      style={{
        marginHorizontal: spacing.lg,
        marginTop: -1,
        backgroundColor: '#F8F3EA',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
        borderLeftWidth: 4,
        borderLeftColor: accent,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <Pressable
        onPress={() => router.push('/wrangler')}
        accessibilityRole="button"
        accessibilityLabel="Open The Wrangler"
        style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
            <MaterialCommunityIcons name="target" size={22} color="#7A5A35" />
            <View style={{ flex: 1 }}>
              <CommandText palette={palette} variant="label" style={{ color: '#7A5A35' }}>
                THE WRANGLER · {snapshot.servicePhaseLabel.toUpperCase()}
              </CommandText>
              <CommandText palette={palette} variant="caption" style={{ marginTop: 2, color: accent }}>
                {statusLabel(snapshot.status)}
              </CommandText>
              <CommandText palette={palette} variant="title" style={{ marginTop: 2 }}>
                {priority?.title ?? 'Service is under control'}
              </CommandText>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={palette.muted} />
        </View>
      </Pressable>

      <CommandText palette={palette} variant="body">
        {priority?.body ?? 'No active service conflicts need attention right now.'}
      </CommandText>

      {priority?.reason ? (
        <View style={{ paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider }}>
          <CommandText palette={palette} variant="caption">Why it matters: {priority.reason}</CommandText>
        </View>
      ) : null}

      {nextAction ? (
        <Pressable
          onPress={() => router.push('/wrangler')}
          accessibilityRole="button"
          accessibilityLabel={`Wrangle it: ${nextAction.label}`}
          style={({ pressed }) => ({
            opacity: pressed ? 0.75 : 1,
            marginTop: spacing.xs,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            backgroundColor: urgent ? '#7A5A35' : palette.surface,
            borderWidth: 1,
            borderColor: urgent ? '#7A5A35' : palette.border,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.sm,
          })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <CommandText palette={palette} variant="label" style={urgent ? { color: '#FFFFFF' } : undefined}>
              NEXT BEST MOVE
            </CommandText>
            <CommandText palette={palette} variant="body" style={urgent ? { color: '#FFFFFF', fontWeight: '700' } : { fontWeight: '700' }}>
              {nextAction.label}
            </CommandText>
          </View>
          <MaterialCommunityIcons name="arrow-right" size={20} color={urgent ? '#FFFFFF' : palette.muted} />
        </Pressable>
      ) : null}

      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingTop: spacing.sm, gap: spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CommandText palette={palette} variant="label" style={{ color: '#7A5A35' }}>
            OPERATIONS COMMAND
          </CommandText>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <Pressable
              onPress={() => setMode('ask')}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 4,
                backgroundColor: mode === 'ask' ? '#7A5A35' : palette.surface,
              }}
            >
              <CommandText palette={palette} variant="caption" style={{ color: mode === 'ask' ? '#FFFFFF' : palette.muted }}>
                Ask
              </CommandText>
            </Pressable>
            <Pressable
              onPress={() => setMode('command')}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 4,
                backgroundColor: mode === 'command' ? '#7A5A35' : palette.surface,
              }}
            >
              <CommandText palette={palette} variant="caption" style={{ color: mode === 'command' ? '#FFFFFF' : palette.muted }}>
                Command
              </CommandText>
            </Pressable>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
          {(mode === 'ask'
            ? ['What stands need attention?', 'Check Union break compliance', 'How is East Concourse stock?']
            : ['86 Jumbo Hot Dog Buns at Stand 104', 'Add Jose to North Concourse Saturday 3pm - 11pm', 'Check Stand 112 mustard dispenser']
          ).map((preset) => (
            <Pressable
              key={preset}
              onPress={() => {
                setPrompt(preset);
                handleSubmit(preset);
              }}
              style={{
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.surface,
                paddingHorizontal: spacing.sm,
                paddingVertical: 4,
                borderRadius: 4,
              }}
            >
              <CommandText palette={palette} variant="caption">
                {preset}
              </CommandText>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder={mode === 'ask' ? 'Ask or command Gemini (e.g. Check Stand 104 par)…' : 'Give command to Gemini (e.g. 86 Hot Dog Buns)…'}
            placeholderTextColor={palette.muted}
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.surface,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              color: palette.charcoal,
              fontSize: 13,
            }}
            onSubmitEditing={() => handleSubmit()}
          />
          <Pressable
            onPress={() => handleSubmit()}
            style={{
              backgroundColor: '#7A5A35',
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: spacing.md,
              borderRadius: 4,
            }}
          >
            <CommandText palette={palette} variant="label" style={{ color: '#FFFFFF' }}>
              {ask.isPending || operatorPlan.isPending ? '...' : mode === 'ask' ? 'SUBMIT' : 'RUN'}
            </CommandText>
          </Pressable>
          <Pressable
            onPress={() => handleRouteToWrangler()}
            accessibilityRole="button"
            accessibilityLabel="Open Wrangler full view"
            style={{
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: spacing.sm,
              borderRadius: 4,
            }}
          >
            <MaterialCommunityIcons name="open-in-new" size={18} color={palette.muted} />
          </Pressable>
        </View>

        {inlineResult ? (
          <View style={{ backgroundColor: palette.surface, padding: spacing.sm, borderWidth: 1, borderColor: palette.border, borderRadius: 4, marginTop: 4, gap: spacing.xs }}>
            <CommandText palette={palette} variant="body" style={{ fontSize: 13 }}>
              {inlineResult}
            </CommandText>
            {pendingPreview.map((line) => (
              <CommandText key={line} palette={palette} variant="caption">
                • {line}
              </CommandText>
            ))}
            {pendingPlan ? (
              <Pressable
                onPress={confirmPendingPlan}
                style={{
                  backgroundColor: pendingPlan.risk === 'sensitive_write' ? palette.warning : '#7A5A35',
                  paddingVertical: 6,
                  paddingHorizontal: spacing.md,
                  alignSelf: 'flex-start',
                  borderRadius: 4,
                  marginTop: 4,
                }}
              >
                <CommandText palette={palette} variant="label" style={{ color: '#FFFFFF' }}>
                  {operatorExecute.isPending ? 'WORKING…' : pendingPlan.risk === 'sensitive_write' ? 'REVIEW & CONFIRM' : 'CONFIRM ACTION'}
                </CommandText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.lg, paddingTop: 2 }}>
        <CommandText palette={palette} variant="caption">{snapshot.summary.lowStockItems ? `${snapshot.summary.lowStockItems} Low-Stock Par` : 'Inventory Par OK'}</CommandText>
        <CommandText palette={palette} variant="caption">{snapshot.summary.vipArrivals ? `${snapshot.summary.vipArrivals} Suite BEOs` : 'Suites Ready'}</CommandText>
        <CommandText palette={palette} variant="caption">{snapshot.summary.openShifts ? `${snapshot.summary.openShifts} Open Staff Shifts` : 'Roster Full'}</CommandText>
      </View>
    </View>
  );
}
