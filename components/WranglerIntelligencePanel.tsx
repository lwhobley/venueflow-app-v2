import { useEffect, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { CommandText } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';
import {
  useAskWrangler,
  useWranglerOperatorExecute,
  useWranglerOperatorPlan,
  type WranglerOperatorPlan,
  type WranglerSnapshot,
} from '../lib/useWrangler';

function formatOperatorResult(result: unknown): string {
  if (Array.isArray(result)) {
    if (result.length === 0) return 'No matching records found.';
    return result.slice(0, 8).map((row) => {
      if (!row || typeof row !== 'object') return String(row);
      const item = row as Record<string, unknown>;
      const name = String(item.guestName ?? item.staffName ?? item.fullName ?? item.jobTitle ?? item.label ?? item.title ?? item.name ?? 'Record');
      const pieces: string[] = [];
      if (item.partySize != null) pieces.push(`party ${item.partySize}`);
      if (item.status != null) pieces.push(String(item.status));
      if (item.startMinutes != null && item.endMinutes != null) pieces.push(`${item.startMinutes}-${item.endMinutes}`);
      if (item.clockInAt != null) pieces.push(`in ${new Date(Number(item.clockInAt)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
      if (item.clockOutAt != null) pieces.push(`out ${new Date(Number(item.clockOutAt)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
      if (item.reservationTime != null) pieces.push(new Date(Number(item.reservationTime)).toLocaleString());
      if (item.jobTitle != null && name !== String(item.jobTitle)) pieces.push(String(item.jobTitle));
      return `• ${name}${pieces.length ? ` — ${pieces.join(' · ')}` : ''}`;
    }).join('\n');
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

export function WranglerIntelligencePanel({
  snapshot,
  initialQuery,
  initialCommand,
}: {
  snapshot: WranglerSnapshot;
  initialQuery?: string;
  initialCommand?: string;
}) {
  const palette = useDesignTheme();
  const ask = useAskWrangler();
  const operatorPlan = useWranglerOperatorPlan();
  const operatorExecute = useWranglerOperatorExecute();
  const [question, setQuestion] = useState(initialQuery ?? '');
  const [answer, setAnswer] = useState<string | null>(null);
  const [command, setCommand] = useState(initialCommand ?? '');
  const [operatorAnswer, setOperatorAnswer] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<WranglerOperatorPlan | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string[]>([]);
  const [handledInitial, setHandledInitial] = useState(false);

  useEffect(() => {
    if (handledInitial) return;
    setHandledInitial(true);
    if (initialCommand && initialCommand.trim().length >= 2) {
      void runOperator(initialCommand.trim());
    } else if (initialQuery && initialQuery.trim().length >= 2) {
      void submit(initialQuery.trim());
    }
  }, [handledInitial, initialCommand, initialQuery]);

  const submit = async (preset?: string) => {
    const value = (preset ?? question).trim();
    if (value.length < 2) return;
    const result = await ask.mutateAsync({ question: value });
    setAnswer(result.answer);
    if (preset) setQuestion(preset);
  };

  const runOperator = async (preset?: string) => {
    const value = (preset ?? command).trim();
    if (value.length < 2) return;
    setPendingPlan(null);
    setPendingPreview([]);
    try {
      const result = await operatorPlan.mutateAsync({ command: value });
      if (result.status === 'executed') {
        setOperatorAnswer(`${result.summary}\n${formatOperatorResult(result.result)}`);
      } else {
        setOperatorAnswer(result.summary);
        setPendingPlan(result.plan);
        setPendingPreview(result.preview);
      }
      if (preset) setCommand(preset);
    } catch (error) {
      setOperatorAnswer(error instanceof Error ? error.message : 'Wrangler could not process that command.');
    }
  };

  const confirmOperator = () => {
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
              setOperatorAnswer(`Done. ${pendingPlan.summary}\n${formatOperatorResult(result.result)}`);
              setPendingPlan(null);
              setPendingPreview([]);
            } catch (error) {
              setOperatorAnswer(error instanceof Error ? error.message : 'The operation could not be completed.');
            }
          })(),
        },
      ],
    );
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">Service recap</CommandText>
        <CommandText palette={palette} variant="body">{snapshot.recap.headline}</CommandText>
        {snapshot.recap.unresolved.slice(0, 3).map((item) => <CommandText key={item.id} palette={palette} variant="caption">• {item.title} — {item.reason}</CommandText>)}
      </View>

      <View style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">What Wrangler is seeing</CommandText>
        {snapshot.patterns.length ? snapshot.patterns.map((pattern) => (
          <View key={pattern.id} style={{ borderTopWidth: 1, borderColor: palette.divider, paddingTop: spacing.sm, gap: 2 }}>
            <CommandText palette={palette} variant="label">{pattern.title}</CommandText>
            <CommandText palette={palette} variant="caption">{pattern.detail}</CommandText>
          </View>
        )) : <CommandText palette={palette} variant="caption">No recurring pressure is visible in the current service picture.</CommandText>}
      </View>

      <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: palette.divider, paddingTop: spacing.lg }}>
        <CommandText palette={palette} variant="title">Wrangler Operator</CommandText>
        <CommandText palette={palette} variant="caption">Tell Wrangler what to find or change. Concession stand replenishment, BEO lookups, and operational commands run immediately. Sensitive roster and timecard actions are previewed before execution.</CommandText>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {['86 Jumbo Hot Dog Buns at Stand 104', 'Add Jose to North Concourse Saturday 3pm - 11pm', 'Check Stand 112 mustard dispenser', 'Who is working Concourse East?'].map((preset) => (
            <Pressable key={preset} onPress={() => void runOperator(preset)} style={{ borderWidth: 1, borderColor: palette.border, paddingHorizontal: spacing.sm, paddingVertical: 7 }}>
              <CommandText palette={palette} variant="caption">{preset}</CommandText>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TextInput
            value={command}
            onChangeText={setCommand}
            placeholder="86 hot dog buns at stand 104, check union break alerts, add Jose to roster…"
            placeholderTextColor={palette.muted}
            style={{ flex: 1, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: palette.muted }}
            onSubmitEditing={() => void runOperator()}
          />
          <Pressable onPress={() => void runOperator()} style={{ backgroundColor: '#7A5A35', justifyContent: 'center', paddingHorizontal: spacing.md }}>
            <CommandText palette={palette} variant="label" style={{ color: '#FFFFFF' }}>{operatorPlan.isPending ? 'THINKING…' : 'RUN'}</CommandText>
          </Pressable>
        </View>
        {operatorAnswer ? <View style={{ backgroundColor: '#F8F3EA', padding: spacing.md, gap: spacing.sm }}><CommandText palette={palette} variant="body">{operatorAnswer}</CommandText>{pendingPreview.map((line) => <CommandText key={line} palette={palette} variant="caption">• {line}</CommandText>)}{pendingPlan ? <Pressable onPress={confirmOperator} style={{ backgroundColor: pendingPlan.risk === 'sensitive_write' ? palette.warning : '#7A5A35', paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignSelf: 'flex-start' }}><CommandText palette={palette} variant="label" style={{ color: '#FFFFFF' }}>{operatorExecute.isPending ? 'WORKING…' : pendingPlan.risk === 'sensitive_write' ? 'REVIEW & CONFIRM' : 'CONFIRM ACTION'}</CommandText></Pressable> : null}</View> : null}
      </View>

      <View style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">Ask Wrangler</CommandText>
        <CommandText palette={palette} variant="caption">Ask for analysis of the live stadium operating picture across all concession zones, luxury suites, and kitchens.</CommandText>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {['What stands need attention?', 'How is Union break compliance?', 'What are gross concession sales today?'].map((preset) => (
            <Pressable key={preset} onPress={() => void submit(preset)} style={{ borderWidth: 1, borderColor: palette.border, paddingHorizontal: spacing.sm, paddingVertical: 7 }}>
              <CommandText palette={palette} variant="caption">{preset}</CommandText>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TextInput value={question} onChangeText={setQuestion} placeholder="Ask about event-day F&B operations…" placeholderTextColor={palette.muted} style={{ flex: 1, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: palette.muted }} onSubmitEditing={() => void submit()} />
          <Pressable onPress={() => void submit()} style={{ backgroundColor: '#7A5A35', justifyContent: 'center', paddingHorizontal: spacing.md }}>
            <CommandText palette={palette} variant="label" style={{ color: '#FFFFFF' }}>{ask.isPending ? 'ASKING…' : 'ASK'}</CommandText>
          </Pressable>
        </View>
        {answer ? <View style={{ backgroundColor: '#F8F3EA', padding: spacing.md }}><CommandText palette={palette} variant="body">{answer}</CommandText></View> : null}
      </View>
    </View>
  );
}
