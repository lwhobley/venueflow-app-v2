import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { colors, spacing } from '../../lib/theme';
import { asArray, errorMessage } from '../../lib/format';

type ScheduleMemoryNote = {
  _id: string;
  title: string;
  detail: string;
  weekStart: string;
  createdAt: number;
};

export function ScheduleMemoryPanel({ venueId }: { venueId: Id<'venues'> }) {
  const memoryQuery = useQuery(api.scheduling.listScheduleMemory, { venueId }) as { notes: ScheduleMemoryNote[] } | undefined;
  const addMemoryNote = useMutation(api.scheduling.addScheduleMemoryNote);
  const notes = useMemo(() => asArray(memoryQuery?.notes), [memoryQuery]);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveNote = async () => {
    if (!title.trim() || !detail.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addMemoryNote({ venueId, title: title.trim(), detail: detail.trim() });
      setTitle('');
      setDetail('');
    } catch (e) {
      setError(errorMessage(e, 'Could not save schedule memory.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <View style={{ gap: 2 }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Schedule memory</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Capture what this week taught us so the next AI draft can use it too.
          </Text>
        </View>

        {notes.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            No schedule lessons yet. Add one from a busy night, a coverage miss, or a staffing win.
          </Text>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {notes.slice(0, 4).map((note) => (
              <View key={note._id} style={{ padding: spacing.sm, borderRadius: 10, backgroundColor: colors.background, gap: 4 }}>
                <Text style={{ color: colors.charcoal, fontWeight: '800' }}>{note.title}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{note.detail}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {note.weekStart} · {new Date(note.createdAt).toLocaleDateString()}
                </Text>
              </View>
            ))}
          </View>
        )}

        <TextInput
          mode="outlined"
          label="Memory title"
          value={title}
          onChangeText={setTitle}
          outlineColor={colors.border}
          activeOutlineColor={colors.primary}
          style={{ backgroundColor: colors.surface }}
        />
        <TextInput
          mode="outlined"
          label="Memory detail"
          value={detail}
          onChangeText={setDetail}
          multiline
          numberOfLines={3}
          outlineColor={colors.border}
          activeOutlineColor={colors.primary}
          style={{ backgroundColor: colors.surface }}
        />
        <Button mode="contained" buttonColor={colors.primary} loading={busy} disabled={busy || !title.trim() || !detail.trim()} onPress={() => void saveNote()}>
          Save memory
        </Button>

        {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : null}
      </Card.Content>
    </Card>
  );
}
