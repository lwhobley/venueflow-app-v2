import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, TextInput } from 'react-native-paper';
import { CommandSurface, CommandText } from '../components/FutureUI';
import { asArray, errorMessage } from '../lib/format';
import { api } from '../lib/railway-api';
import { useMutation, useQueryState } from '../lib/railway-hooks';
import { spacing, useDesignTheme } from '../lib/theme';

type CloseoutRevision = {
  id: string;
  version: number;
  adjustmentReason?: string | null;
  approvedBy?: string | null;
  createdAt?: string;
  revisionHash?: string;
};

type Closeout = {
  status?: string;
  currentVersion?: number;
  actualAttendance?: number | null;
  actualSalesCents?: number | null;
  forecastSalesCents?: number | null;
  laborHours?: number | null;
  laborCostCents?: number | null;
  inventoryVarianceCents?: number | null;
  notes?: string | null;
  adjustmentReason?: string | null;
  revisions?: CloseoutRevision[];
} | null;

const numberValue = (value: string) => (value.trim() ? Number(value) : undefined);

export default function EventCloseoutScreen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const palette = useDesignTheme();
  const query = useQueryState<Closeout>(api.stadium.getEventCloseout, eventId ? { eventId } : 'skip');
  const save = useMutation(api.stadium.upsertEventCloseout);
  const submitRevision = useMutation(api.stadium.submitEventCloseoutRevision);
  const [attendance, setAttendance] = useState('');
  const [sales, setSales] = useState('');
  const [forecast, setForecast] = useState('');
  const [laborHours, setLaborHours] = useState('');
  const [laborCost, setLaborCost] = useState('');
  const [inventoryVariance, setInventoryVariance] = useState('');
  const [notes, setNotes] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const closeout = query.data;
  const locked = Boolean(closeout && closeout.status && closeout.status !== 'draft');
  const revisions = asArray(closeout?.revisions);

  useEffect(() => {
    if (!closeout) return;
    setAttendance(closeout.actualAttendance?.toString() ?? '');
    setSales(closeout.actualSalesCents?.toString() ?? '');
    setForecast(closeout.forecastSalesCents?.toString() ?? '');
    setLaborHours(closeout.laborHours?.toString() ?? '');
    setLaborCost(closeout.laborCostCents?.toString() ?? '');
    setInventoryVariance(closeout.inventoryVarianceCents?.toString() ?? '');
    setNotes(closeout.notes ?? '');
  }, [closeout]);

  const submit = async (status: 'draft' | 'finalized' | 'adjusted') => {
    if (!eventId) return;
    const isRevision = status === 'adjusted' || (locked && status !== 'draft');
    if (isRevision && !adjustmentReason.trim()) {
      setMessage('An adjustment reason is required once closeout is finalized.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const values = {
        actualAttendance: numberValue(attendance),
        actualSalesCents: numberValue(sales),
        forecastSalesCents: numberValue(forecast),
        laborHours: numberValue(laborHours),
        laborCostCents: numberValue(laborCost),
        inventoryVarianceCents: numberValue(inventoryVariance),
        notes,
      };
      if (isRevision) {
        // Finalized/adjusted closeouts are immutable — changes must go through
        // the revision ledger endpoint (POST .../closeout/revisions).
        await submitRevision({
          eventId,
          ...values,
          adjustmentReason: adjustmentReason.trim(),
        });
        setMessage('Adjustment submitted to the revision ledger.');
      } else {
        await save({ ...values, eventId, status });
        setMessage(
          status === 'finalized' ? 'Closeout finalized and audit logged.' : 'Closeout saved as draft.',
        );
      }
      setAdjustmentReason('');
      await query.refetch?.();
    } catch (error) {
      setMessage(errorMessage(error, 'Closeout could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: 'transparent' }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
      <Button mode="text" textColor={palette.primary} onPress={() => router.back()}>Back to command center</Button>
      <CommandSurface palette={palette} strong style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="label">Post-event closeout</CommandText>
        <CommandText palette={palette} variant="hero">Forecast vs actual</CommandText>
        <CommandText palette={palette} variant="caption">Capture the canonical event result once POS, labor, and inventory counts are reconciled.</CommandText>
        <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>Status: {closeout?.status ?? 'none'} · Version: {closeout?.currentVersion ?? 1}</CommandText>
        {locked ? (
          <CommandText palette={palette} variant="caption" style={{ color: palette.warning, fontWeight: '700' }}>
            Finalized data is locked. Further changes create immutable revisions and require a reason.
          </CommandText>
        ) : null}
      </CommandSurface>
      {message ? <CommandSurface palette={palette}><CommandText palette={palette} variant="body">{message}</CommandText></CommandSurface> : null}
      <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
        <TextInput mode="outlined" label="Actual attendance" keyboardType="numeric" value={attendance} onChangeText={setAttendance} />
        <TextInput mode="outlined" label="Actual sales (cents)" keyboardType="numeric" value={sales} onChangeText={setSales} />
        <TextInput mode="outlined" label="Forecast sales (cents)" keyboardType="numeric" value={forecast} onChangeText={setForecast} />
        <TextInput mode="outlined" label="Labor hours" keyboardType="numeric" value={laborHours} onChangeText={setLaborHours} />
        <TextInput mode="outlined" label="Labor cost (cents)" keyboardType="numeric" value={laborCost} onChangeText={setLaborCost} />
        <TextInput mode="outlined" label="Inventory variance (cents)" keyboardType="numeric" value={inventoryVariance} onChangeText={setInventoryVariance} />
        <TextInput mode="outlined" label="Closeout notes" multiline value={notes} onChangeText={setNotes} />
        {locked ? (
          <TextInput mode="outlined" label="Adjustment reason (required)" multiline value={adjustmentReason} onChangeText={setAdjustmentReason} />
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {!locked ? (
            <>
              <Button style={{ flex: 1, minWidth: 120 }} mode="outlined" textColor={palette.primary} disabled={saving} onPress={() => void submit('draft')}>Save draft</Button>
              <Button style={{ flex: 1, minWidth: 120 }} mode="contained" buttonColor={palette.primary} disabled={saving} onPress={() => void submit('finalized')}>Finalize closeout</Button>
            </>
          ) : (
            <Button style={{ flex: 1 }} mode="contained" buttonColor={palette.primary} disabled={saving} onPress={() => void submit('adjusted')}>Submit adjustment</Button>
          )}
        </View>
      </CommandSurface>
      {revisions.length > 0 ? (
        <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
          <CommandText palette={palette} variant="title">Revision history</CommandText>
          {revisions.map((revision) => (
            <View key={revision.id} style={{ gap: 4, paddingVertical: spacing.xs }}>
              <CommandText palette={palette} variant="body" style={{ fontWeight: '700' }}>
                v{revision.version}{revision.approvedBy ? ' · approved' : ' · pending approval'}
              </CommandText>
              {revision.adjustmentReason ? <CommandText palette={palette} variant="caption">{revision.adjustmentReason}</CommandText> : null}
              {revision.revisionHash ? <CommandText palette={palette} variant="caption">Hash {revision.revisionHash.slice(0, 12)}…</CommandText> : null}
            </View>
          ))}
        </CommandSurface>
      ) : null}
    </ScrollView>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
