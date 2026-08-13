import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, TextInput } from 'react-native-paper';
import { CommandSurface, CommandText } from '../components/FutureUI';
import { errorMessage } from '../lib/format';
import { api } from '../lib/railway-api';
import { useMutation, useQueryState } from '../lib/railway-hooks';
import { spacing, useDesignTheme } from '../lib/theme';

type Closeout = { status?: string; actualAttendance?: number | null; actualSalesCents?: number | null; forecastSalesCents?: number | null; laborHours?: number | null; laborCostCents?: number | null; inventoryVarianceCents?: number | null; notes?: string | null } | null;
const numberValue = (value: string) => value.trim() ? Number(value) : undefined;

export default function EventCloseoutScreen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const palette = useDesignTheme();
  const query = useQueryState<Closeout>(api.stadium.getEventCloseout, eventId ? { eventId } : 'skip');
  const save = useMutation(api.stadium.upsertEventCloseout);
  const [attendance, setAttendance] = useState('');
  const [sales, setSales] = useState('');
  const [forecast, setForecast] = useState('');
  const [laborHours, setLaborHours] = useState('');
  const [laborCost, setLaborCost] = useState('');
  const [inventoryVariance, setInventoryVariance] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const closeout = query.data;
    if (!closeout) return;
    setAttendance(closeout.actualAttendance?.toString() ?? ''); setSales(closeout.actualSalesCents?.toString() ?? ''); setForecast(closeout.forecastSalesCents?.toString() ?? ''); setLaborHours(closeout.laborHours?.toString() ?? ''); setLaborCost(closeout.laborCostCents?.toString() ?? ''); setInventoryVariance(closeout.inventoryVarianceCents?.toString() ?? ''); setNotes(closeout.notes ?? '');
  }, [query.data]);

  const submit = async (status: 'draft' | 'finalized') => {
    if (!eventId) return;
    try { await save({ eventId, status, actualAttendance: numberValue(attendance), actualSalesCents: numberValue(sales), forecastSalesCents: numberValue(forecast), laborHours: numberValue(laborHours), laborCostCents: numberValue(laborCost), inventoryVarianceCents: numberValue(inventoryVariance), notes }); setMessage(status === 'finalized' ? 'Closeout finalized and audit logged.' : 'Closeout saved as draft.'); } catch (error) { setMessage(errorMessage(error, 'Closeout could not be saved.')); }
  };

  return <ScrollView style={{ flex: 1, backgroundColor: 'transparent' }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
    <Button mode="text" textColor={palette.primary} onPress={() => router.back()}>Back to command center</Button>
    <CommandSurface palette={palette} strong style={{ gap: spacing.sm }}><CommandText palette={palette} variant="label">Post-event closeout</CommandText><CommandText palette={palette} variant="hero">Forecast vs actual</CommandText><CommandText palette={palette} variant="caption">Capture the canonical event result once POS, labor, and inventory counts are reconciled.</CommandText></CommandSurface>
    {message ? <CommandSurface palette={palette}><CommandText palette={palette} variant="body">{message}</CommandText></CommandSurface> : null}
    <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
      <TextInput mode="outlined" label="Actual attendance" keyboardType="numeric" value={attendance} onChangeText={setAttendance} />
      <TextInput mode="outlined" label="Actual sales (cents)" keyboardType="numeric" value={sales} onChangeText={setSales} />
      <TextInput mode="outlined" label="Forecast sales (cents)" keyboardType="numeric" value={forecast} onChangeText={setForecast} />
      <TextInput mode="outlined" label="Labor hours" keyboardType="numeric" value={laborHours} onChangeText={setLaborHours} />
      <TextInput mode="outlined" label="Labor cost (cents)" keyboardType="numeric" value={laborCost} onChangeText={setLaborCost} />
      <TextInput mode="outlined" label="Inventory variance (cents)" keyboardType="numeric" value={inventoryVariance} onChangeText={setInventoryVariance} />
      <TextInput mode="outlined" label="Closeout notes" multiline value={notes} onChangeText={setNotes} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}><Button style={{ flex: 1 }} mode="outlined" textColor={palette.primary} onPress={() => void submit('draft')}>Save draft</Button><Button style={{ flex: 1 }} mode="contained" buttonColor={palette.primary} onPress={() => void submit('finalized')}>Finalize closeout</Button></View>
    </CommandSurface>
  </ScrollView>;
}
