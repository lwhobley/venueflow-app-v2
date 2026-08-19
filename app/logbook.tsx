import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Chip, IconButton, Text, TextInput as PaperTextInput } from 'react-native-paper';
import { useMutation, useQueryState } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import { colors, spacing, type } from '../lib/theme';
import { AppCard } from '../components/AppCard';
import { ScreenState } from '../components/ScreenState';
import { asArray, errorMessage } from '../lib/format';
import { useVenueAuth } from '../lib/useVenueAuth';
import { useI18n } from '../lib/i18n';

type LogbookEntry = {
  _id: string;
  authorProfileId: string;
  authorName: string;
  category: string;
  body: string;
  pinned: boolean;
  createdAt: number;
};

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export default function LogbookScreen() {
  const { t } = useI18n();
  const { venue, isReady, canManage, me } = useVenueAuth();
  const CATEGORIES: Array<{ value: string; label: string }> = [
    { value: 'handoff', label: t('logbook.categoryHandoff') },
    { value: 'incident', label: t('logbook.categoryIncident') },
    { value: 'maintenance', label: t('logbook.categoryMaintenance') },
    { value: 'general', label: t('logbook.categoryGeneral') },
  ];
  const myProfileId = me?.profile?._id ?? null;
  const entriesQuery = useQueryState<{ entries: LogbookEntry[] }>(api.operations.listLogbook, isReady && venue?.id ? { limit: 100 } : 'skip');
  const entries = useMemo(() => asArray<LogbookEntry>(entriesQuery.data?.entries), [entriesQuery.data]);

  const addEntry = useMutation(api.operations.addLogbookEntry);
  const deleteEntry = useMutation(api.operations.deleteLogbookEntry);

  const [category, setCategory] = useState('handoff');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPost = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addEntry({ category, body: body.trim(), pinned });
      setBody('');
      setPinned(false);
    } catch (e) {
      setError(errorMessage(e, t('logbook.errorPost')));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      await deleteEntry(id);
    } catch (e) {
      setError(errorMessage(e, t('logbook.errorRemove')));
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <IconButton icon="arrow-left" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.title, color: colors.charcoal }}>{t('logbook.title')}</Text>
          <Text style={{ color: colors.muted }}>{t('logbook.subtitle')}</Text>
        </View>
      </View>

      <AppCard>
          <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {CATEGORIES.map((c) => (
              <Chip key={c.value} selected={category === c.value} onPress={() => setCategory(c.value)}>{c.label}</Chip>
            ))}
          </View>
          <PaperTextInput
            placeholder={t('logbook.bodyPlaceholder')}
            value={body}
            onChangeText={setBody}
            mode="outlined"
            multiline
            numberOfLines={4}
            style={{ backgroundColor: colors.surface, minHeight: 90 }}
          />
          {canManage ? (
            <Chip selected={pinned} onPress={() => setPinned((v) => !v)} icon="pin">
              {t('logbook.pinToTop')}
            </Chip>
          ) : null}
          <Button mode="contained" buttonColor={colors.primary} loading={busy} disabled={busy || !body.trim()} onPress={() => void onPost()}>
            {t('logbook.postEntry')}
          </Button>
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          </View>
      </AppCard>

      <ScreenState
        isLoading={entriesQuery.isLoading}
        error={entriesQuery.error}
        isEmpty={entries.length === 0}
        emptyMessage={t('logbook.noEntries')}
        onRetry={() => void entriesQuery.refetch()}
      >
        {entries.map((entry) => {
          const categoryLabel = CATEGORIES.find((c) => c.value === entry.category)?.label ?? entry.category;
          const canDelete = canManage || entry.authorProfileId === myProfileId;
          return (
            <AppCard key={entry._id}>
                <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {entry.pinned ? <Text style={{ color: colors.primary }}>📌</Text> : null}
                    <Text style={{ fontWeight: '700' }}>{entry.authorName}</Text>
                    <Chip compact>{categoryLabel}</Chip>
                  </View>
                  {canDelete ? (
                    <IconButton icon="close" size={16} onPress={() => void onDelete(entry._id)} accessibilityLabel={t('logbook.removeEntryLabel')} />
                  ) : null}
                </View>
                <Text style={{ color: colors.charcoal, lineHeight: 20 }}>{entry.body}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{formatTimestamp(entry.createdAt)}</Text>
                </View>
            </AppCard>
          );
        })}
      </ScreenState>
    </ScrollView>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
