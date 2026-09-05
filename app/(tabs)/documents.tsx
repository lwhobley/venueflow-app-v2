import { useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { ActivityIndicator, Button, Card, Chip, Searchbar, Text, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScreenErrorBoundary } from '../../components/ErrorBoundary';
import { InlineMessage } from '../../components/InlineMessage';
import { SectionHeader } from '../../components/AppCard';
import { api } from '../../lib/railway-api';
import { useMutation, useQueryState } from '../../lib/railway-hooks';
import { asArray, errorMessage } from '../../lib/format';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { radius, spacing, useDesignTheme } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { readPickedFileBase64 } from '../../lib/picked-file';


const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CATEGORIES = ['sop', 'manual', 'recipe', 'menu', 'training', 'form', 'other'] as const;
type DocumentCategory = (typeof CATEGORIES)[number];
type CategoryFilter = 'all' | DocumentCategory;

type VenueDocument = {
  id: string;
  title: string;
  fileName: string;
  category: DocumentCategory;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: number;
};

type SelectedFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
  file?: Blob | null;
};

const PICKER_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/rtf',
];

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function iconForMime(mimeType: string): keyof typeof MaterialCommunityIcons.glyphMap {
  if (mimeType === 'application/pdf') return 'file-pdf-box';
  if (mimeType.startsWith('image/')) return 'file-image-outline';
  if (mimeType.includes('word')) return 'file-word-outline';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'file-excel-outline';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return 'file-powerpoint-outline';
  return 'file-document-outline';
}

export default function DocumentsScreen() {
  return (
    <ScreenErrorBoundary>
      <DocumentsScreenInner />
    </ScreenErrorBoundary>
  );
}

function DocumentsScreenInner() {
  const palette = useDesignTheme();
  const { t, formatDate } = useI18n();
  const { venue, isReady, canManage, profileLoading } = useVenueAuth();
  const query = useQueryState<VenueDocument[]>(api.documents.list, isReady && venue?.id ? {} : 'skip');
  const uploadDocument = useMutation(api.documents.upload);
  const accessDocument = useMutation(api.documents.access);
  const removeDocument = useMutation(api.documents.remove);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('sop');
  const [busy, setBusy] = useState<'upload' | string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const categoryLabel = (value: DocumentCategory) =>
    t(`documents.categories.${value}` as TranslationKey);

  const documents = asArray(query.data);
  const filteredDocuments = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return documents.filter((document) => {
      const matchesCategory = filter === 'all' || document.category === filter;
      const matchesSearch = !needle || `${document.title} ${document.fileName} ${document.uploadedBy ?? ''}`.toLocaleLowerCase().includes(needle);
      return matchesCategory && matchesSearch;
    });
  }, [documents, filter, search]);

  const chooseFile = async () => {
    setMessage(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: PICKER_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      const asset = result.assets[0];
      if (typeof asset.size === 'number' && asset.size > MAX_FILE_BYTES) {
        setMessage(t('documents.errors.tooLarge'));
        return;
      }
      const name = asset.name || 'document';
      setSelectedFile({ uri: asset.uri, file: asset.file, name, mimeType: asset.mimeType || 'application/octet-stream', size: asset.size ?? null });
      if (!title.trim()) setTitle(name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
    } catch (error) {
      setMessage(errorMessage(error, t('documents.errors.pickFailed')));
    }
  };

  const submitUpload = async () => {
    if (!selectedFile) {
      setMessage(t('documents.errors.fileRequired'));
      return;
    }
    if (!title.trim()) {
      setMessage(t('documents.errors.titleRequired'));
      return;
    }
    setBusy('upload');
    setMessage(null);
    try {
      const dataBase64 = await readPickedFileBase64(selectedFile);
      await uploadDocument({
        title: title.trim(),
        fileName: selectedFile.name,
        mimeType: selectedFile.mimeType,
        category,
        dataBase64,
      });
      setSelectedFile(null);
      setTitle('');
      setCategory('sop');
      setMessage(t('documents.uploadSuccess'));
    } catch (error) {
      setMessage(errorMessage(error, t('documents.errors.uploadFailed')));
    } finally {
      setBusy(null);
    }
  };

  const openDocument = async (document: VenueDocument) => {
    setBusy(`open:${document.id}`);
    setMessage(null);
    try {
      const result = await accessDocument({ documentId: document.id }) as { url: string };
      await Linking.openURL(result.url);
    } catch (error) {
      setMessage(errorMessage(error, t('documents.errors.openFailed')));
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = (document: VenueDocument) => {
    Alert.alert(t('documents.deleteTitle'), t('documents.deleteMessage', { title: document.title }), [
      { text: t('documents.cancel'), style: 'cancel' },
      {
        text: t('documents.delete'),
        style: 'destructive',
        onPress: async () => {
          setBusy(`delete:${document.id}`);
          setMessage(null);
          try {
            await removeDocument({ documentId: document.id });
          } catch (error) {
            setMessage(errorMessage(error, t('documents.errors.deleteFailed')));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: 'transparent' }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg }}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader
        kicker={t('documents.kicker')}
        title={t('documents.title')}
        subtitle={t('documents.subtitle', { venue: venue?.name ?? t('common.yourVenue') })}
      />

      {canManage ? (
        <Card style={{ backgroundColor: palette.surface, borderRadius: radius.sharp, borderWidth: 1, borderColor: palette.border }}>
          <Card.Content style={{ gap: spacing.md }}>
            <View>
              <Text variant="titleMedium" style={{ color: palette.charcoal, fontWeight: '700' }}>{t('documents.uploadTitle')}</Text>
              <Text style={{ color: palette.muted }}>{t('documents.uploadSubtitle')}</Text>
            </View>
            <Button mode="outlined" icon="paperclip" textColor={palette.primary} disabled={busy === 'upload'} onPress={() => void chooseFile()}>
              {selectedFile ? t('documents.replaceFile') : t('documents.chooseFile')}
            </Button>
            {selectedFile ? (
              <Text style={{ color: palette.muted }}>
                {t('documents.selectedFile', { name: selectedFile.name, size: selectedFile.size == null ? '—' : formatFileSize(selectedFile.size) })}
              </Text>
            ) : null}
            <TextInput
              mode="outlined"
              label={t('documents.titleLabel')}
              placeholder={t('documents.titlePlaceholder')}
              value={title}
              onChangeText={setTitle}
              maxLength={120}
              style={{ backgroundColor: palette.surface }}
            />
            <View style={{ gap: spacing.sm }}>
              <Text style={{ color: palette.muted }}>{t('documents.categoryLabel')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {CATEGORIES.map((value) => (
                  <Chip key={value} selected={category === value} onPress={() => setCategory(value)}>{categoryLabel(value)}</Chip>
                ))}
              </View>
            </View>
            <Button
              mode="contained"
              icon="cloud-upload-outline"
              buttonColor={palette.primary}
              loading={busy === 'upload'}
              disabled={busy === 'upload' || !selectedFile || !title.trim()}
              onPress={() => void submitUpload()}
            >
              {busy === 'upload' ? t('documents.uploading') : t('documents.upload')}
            </Button>
          </Card.Content>
        </Card>
      ) : !profileLoading ? (
        <Text style={{ color: palette.muted }}>{t('documents.managerHint')}</Text>
      ) : null}

      <InlineMessage message={message} />

      <View style={{ gap: spacing.md }}>
        <Text variant="titleLarge" style={{ color: palette.charcoal, fontWeight: '700' }}>{t('documents.libraryTitle')}</Text>
        <Searchbar placeholder={t('documents.searchPlaceholder')} value={search} onChangeText={setSearch} style={{ backgroundColor: palette.surfaceSoft, borderRadius: radius.sharp }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          <Chip selected={filter === 'all'} onPress={() => setFilter('all')}>{t('documents.all')}</Chip>
          {CATEGORIES.map((value) => (
            <Chip key={value} selected={filter === value} onPress={() => setFilter(value)}>{categoryLabel(value)}</Chip>
          ))}
        </ScrollView>
      </View>

      {query.isLoading || profileLoading ? (
        <View style={{ alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm }}>
          <ActivityIndicator color={palette.primary} />
          <Text style={{ color: palette.muted }}>{t('documents.loading')}</Text>
        </View>
      ) : query.error ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: palette.danger }}>{errorMessage(query.error, t('documents.errors.loadFailed'))}</Text>
          <Button mode="outlined" textColor={palette.primary} onPress={() => void query.refetch()}>{t('documents.retry')}</Button>
        </View>
      ) : filteredDocuments.length === 0 ? (
        <Text style={{ color: palette.muted }}>{documents.length === 0 ? t('documents.noDocuments') : t('documents.noResults')}</Text>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {filteredDocuments.map((document) => {
            const uploader = document.uploadedBy ? t('documents.uploaderSuffix', { name: document.uploadedBy }) : '';
            const opening = busy === `open:${document.id}`;
            const deleting = busy === `delete:${document.id}`;
            return (
              <Card key={document.id} style={{ backgroundColor: palette.surface, borderRadius: radius.sharp, borderWidth: 1, borderColor: palette.border }}>
                <Card.Content style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                    <MaterialCommunityIcons name={iconForMime(document.mimeType)} size={30} color={palette.primary} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="titleMedium" style={{ color: palette.charcoal, fontWeight: '700' }}>{document.title}</Text>
                      <Text numberOfLines={1} style={{ color: palette.muted }}>{document.fileName} · {formatFileSize(document.sizeBytes)}</Text>
                      <Text style={{ color: palette.muted, fontSize: 12 }}>
                        {t('documents.uploadedBy', {
                          date: formatDate(document.createdAt, { year: 'numeric', month: 'short', day: 'numeric' }),
                          uploader,
                        })}
                      </Text>
                    </View>
                    <Chip compact>{categoryLabel(document.category)}</Chip>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    <Button mode="contained" compact icon="open-in-new" buttonColor={palette.primary} loading={opening} disabled={Boolean(busy)} onPress={() => void openDocument(document)}>
                      {opening ? t('documents.opening') : t('documents.open')}
                    </Button>
                    {canManage ? (
                      <Button mode="text" compact icon="trash-can-outline" textColor={palette.danger} loading={deleting} disabled={Boolean(busy)} onPress={() => confirmDelete(document)}>
                        {t('documents.delete')}
                      </Button>
                    ) : null}
                  </View>
                </Card.Content>
              </Card>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
