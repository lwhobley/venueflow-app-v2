import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { accents, colors, spacing } from '../../lib/theme';
import { asArray } from '../../lib/format';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

type Blackout = { _id: Id<'blackoutDates'>; startDate: string; endDate: string; reason: string };

export function BlackoutManager({ venueId }: { venueId: Id<'venues'> }) {
  const data = useQuery(api.scheduling.listBlackouts, { venueId });
  const addBlackout = useMutation(api.scheduling.addBlackout);
  const removeBlackout = useMutation(api.scheduling.removeBlackout);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const blackouts = useMemo(() => asArray(data) as Blackout[], [data]);

  const onAdd = async () => {
    setError(null);
    if (!isoDate.test(startDate.trim())) {
      setError('Start date must be YYYY-MM-DD.');
      return;
    }
    if (endDate.trim() && !isoDate.test(endDate.trim())) {
      setError('End date must be YYYY-MM-DD.');
      return;
    }
    try {
      await addBlackout({ venueId, startDate: startDate.trim(), endDate: endDate.trim() || undefined, reason: reason.trim() });
      setStartDate('');
      setEndDate('');
      setReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add blackout.');
    }
  };

  const onRemove = async (blackoutId: Id<'blackoutDates'>) => {
    setError(null);
    try {
      await removeBlackout({ venueId, blackoutId });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove blackout.');
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      <Card style={{ backgroundColor: accents[4].bg, borderRadius: 16 }}>
        <Card.Content style={{ gap: 4 }}>
          <Text variant="titleMedium" style={{ color: accents[4].fg, fontWeight: '700' }}>Blackout dates</Text>
          <Text style={{ color: colors.charcoal }}>
            Dates added here are blocked for time-off requests. Staff can't request off during a blackout window.
          </Text>
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Add a blackout</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput label="Start (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} mode="outlined" autoCapitalize="none" style={{ flex: 1, backgroundColor: colors.surface }} />
            <TextInput label="End (optional)" value={endDate} onChangeText={setEndDate} mode="outlined" autoCapitalize="none" style={{ flex: 1, backgroundColor: colors.surface }} />
          </View>
          <TextInput label="Reason (e.g. New Year's Eve)" value={reason} onChangeText={setReason} mode="outlined" style={{ backgroundColor: colors.surface }} />
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          <Button mode="contained" buttonColor={colors.primary} onPress={() => void onAdd()}>
            Add blackout
          </Button>
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Current blackouts</Text>
          {data === undefined ? (
            <Text style={{ color: colors.muted }}>Loading…</Text>
          ) : blackouts.length === 0 ? (
            <Text style={{ color: colors.muted }}>No blackout dates set.</Text>
          ) : (
            blackouts.map((b) => (
              <View key={b._id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700' }}>
                    {b.startDate}{b.endDate !== b.startDate ? ` – ${b.endDate}` : ''}
                  </Text>
                  <Text style={{ color: colors.muted }}>{b.reason}</Text>
                </View>
                <Button compact mode="text" textColor={colors.danger} onPress={() => void onRemove(b._id)}>
                  Remove
                </Button>
              </View>
            ))
          )}
        </Card.Content>
      </Card>
    </View>
  );
}
