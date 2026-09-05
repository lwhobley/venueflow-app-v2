import { useMemo, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Button, Chip, IconButton, Text, TextInput as PaperTextInput } from 'react-native-paper';
import { useMutation, useQuery } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import { resolveMediaUrl } from '../lib/api-client';
import { colors, spacing, radius, type } from '../lib/theme';
import { AppCard, SectionHeader } from '../components/AppCard';
import { asArray, errorMessage } from '../lib/format';
import { useVenueAuth } from '../lib/useVenueAuth';
import { useI18n } from '../lib/i18n';

type ChecklistItem = {
  _id: string;
  title: string;
  requiresPhoto: boolean;
  sortOrder: number;
  completionId: string | null;
  status: 'pending' | 'done';
  completedByName: string | null;
  completedAt: number | null;
  hasPhoto: boolean;
  photoUrl: string | null;
};

type ChecklistResponse = { date: string; kind: string; items: ChecklistItem[] };

export default function ChecklistScreen() {
  const { t } = useI18n();
  const { venue, isReady, canManage } = useVenueAuth();
  const [kind, setKind] = useState<'opening' | 'closing'>('opening');
  const [newTitle, setNewTitle] = useState('');
  const [newRequiresPhoto, setNewRequiresPhoto] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checklistQuery = useQuery(api.operations.getChecklist, isReady && venue?.id ? { kind } : 'skip') as ChecklistResponse | null | undefined;
  const items = useMemo(() => asArray(checklistQuery?.items).slice().sort((a, b) => a.sortOrder - b.sortOrder), [checklistQuery]);

  const addItem = useMutation(api.operations.addChecklistItem);
  const removeItem = useMutation(api.operations.removeChecklistItem);
  const completeItem = useMutation(api.operations.completeChecklistItem);

  const onAddItem = async () => {
    if (!newTitle.trim()) return;
    setError(null);
    try {
      await addItem({ kind, title: newTitle.trim(), requiresPhoto: newRequiresPhoto });
      setNewTitle('');
      setNewRequiresPhoto(false);
    } catch (e) {
      setError(errorMessage(e, t('checklist.errorAdd')));
    }
  };

  const onRemoveItem = async (id: string) => {
    try {
      await removeItem(id);
    } catch (e) {
      setError(errorMessage(e, t('checklist.errorRemove')));
    }
  };

  const onCompletePlain = async (item: ChecklistItem) => {
    if (!item.completionId) return;
    setBusyItemId(item._id);
    setError(null);
    try {
      await completeItem({ completionId: item.completionId });
    } catch (e) {
      setError(errorMessage(e, t('checklist.errorComplete')));
    } finally {
      setBusyItemId(null);
    }
  };

  const onCompleteWithPhoto = async (item: ChecklistItem) => {
    if (!item.completionId) return;
    setError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.status !== 'granted') {
        setError(t('checklist.cameraPermissionRequired'));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 });
      if (result.canceled || !result.assets[0]?.base64) return;
      setBusyItemId(item._id);
      await completeItem({
        completionId: item.completionId,
        photoBase64: result.assets[0].base64,
        photoMimeType: result.assets[0].mimeType || 'image/jpeg',
      });
    } catch (e) {
      setError(errorMessage(e, t('checklist.errorUpload')));
    } finally {
      setBusyItemId(null);
    }
  };

  const doneCount = items.filter((i) => i.status === 'done').length;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <IconButton icon="arrow-left" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.title, color: colors.charcoal }}>{t('checklist.title')}</Text>
          <Text style={{ color: colors.muted }}>{t('checklist.subtitle')}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Chip selected={kind === 'opening'} onPress={() => setKind('opening')}>{t('checklist.opening')}</Chip>
        <Chip selected={kind === 'closing'} onPress={() => setKind('closing')}>{t('checklist.closing')}</Chip>
      </View>

      <Text style={{ color: colors.muted }}>{t('checklist.progress', { done: doneCount, total: items.length })}</Text>

      {items.length === 0 ? (
        <Text style={{ color: colors.muted }}>
          {t(canManage ? 'checklist.emptyWithManage' : 'checklist.emptyWithoutManage', { kind: kind === 'opening' ? t('checklist.opening').toLowerCase() : t('checklist.closing').toLowerCase() })}
        </Text>
      ) : (
        items.map((item) => (
          <AppCard key={item._id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', textDecorationLine: item.status === 'done' ? 'line-through' : 'none' }}>{item.title}</Text>
                  {item.requiresPhoto ? <Text style={{ color: colors.secondary, fontSize: 12 }}>📷 {t('checklist.photoRequired')}</Text> : null}
                  {item.status === 'done' ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {t('checklist.doneBy', { name: item.completedByName ?? '' })}{item.completedAt ? ` · ${new Date(item.completedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}
                    </Text>
                  ) : null}
                </View>
                {canManage ? (
                  <IconButton icon="delete-outline" size={18} onPress={() => void onRemoveItem(item._id)} accessibilityLabel={t('checklist.removeTaskLabel')} />
                ) : null}
              </View>

              {item.hasPhoto && item.photoUrl ? (
                <Image
                  source={{ uri: resolveMediaUrl(item.photoUrl) }}
                  style={{ width: '100%', height: 160, borderRadius: radius.sharp, backgroundColor: colors.background, marginTop: spacing.sm }}
                  resizeMode="cover"
                />
              ) : null}

              {item.status !== 'done' ? (
                item.requiresPhoto ? (
                  <Button mode="contained" buttonColor={colors.primary} icon="camera" loading={busyItemId === item._id} onPress={() => void onCompleteWithPhoto(item)} style={{ marginTop: spacing.sm }}>
                    {t('checklist.takePhotoAndComplete')}
                  </Button>
                ) : (
                  <Button mode="contained" buttonColor={colors.primary} loading={busyItemId === item._id} onPress={() => void onCompletePlain(item)} style={{ marginTop: spacing.sm }}>
                    {t('checklist.markDone')}
                  </Button>
                )
              ) : null}
          </AppCard>
        ))
      )}

      {canManage ? (
        <AppCard>
            <SectionHeader title={t('checklist.addTaskTitle', { kind: kind === 'opening' ? t('checklist.opening').toLowerCase() : t('checklist.closing').toLowerCase() })} />
            <View style={{ gap: spacing.sm }}>
            <PaperTextInput placeholder={t('checklist.taskTitlePlaceholder')} value={newTitle} onChangeText={setNewTitle} mode="outlined" style={{ backgroundColor: colors.surface }} />
            <Chip selected={newRequiresPhoto} onPress={() => setNewRequiresPhoto((v) => !v)} icon="camera">
              {t('checklist.requirePhotoProof')}
            </Chip>
            <Button mode="outlined" textColor={colors.primary} disabled={!newTitle.trim()} onPress={() => void onAddItem()}>
              {t('checklist.addTask')}
            </Button>
            </View>
        </AppCard>
      ) : null}

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    </ScrollView>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
