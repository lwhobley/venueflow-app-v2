import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { IconButton, Text, TextInput } from 'react-native-paper';
import { colors, spacing, type } from '../lib/theme';
import { AppCard, Kicker } from '../components/AppCard';
import { useI18n } from '../lib/i18n';

type GuideSection = {
  key: string;
  tab: string;
  title: string;
  summary: string;
  steps: string[];
};

// Section keys, in display order. Content for each (tab/title/summary/steps)
// lives in lib/i18n/namespaces/misc.ts under help.sections.<key> — grounded in
// the actual screens under app/(tabs); keep translations in sync when a
// feature's flow changes so the in-app guide never drifts from the product.
const SECTION_KEYS = [
  'home',
  'clock',
  'schedule',
  'floor',
  'reservations',
  'guests',
  'integrations',
  'sales',
  'chat',
  'bar-stock',
  'reports',
  'staff',
  'logbook',
  'checklist',
  'profile',
] as const;

export default function HelpScreen() {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const SECTIONS: GuideSection[] = useMemo(
    () =>
      SECTION_KEYS.map((key) => ({
        key,
        tab: t(`help.sections.${key}.tab`),
        title: t(`help.sections.${key}.title`),
        summary: t(`help.sections.${key}.summary`),
        steps: (() => {
          try {
            const parsed = JSON.parse(t(`help.sections.${key}.steps`));
            return Array.isArray(parsed) ? (parsed as string[]) : [];
          } catch {
            return [];
          }
        })(),
      })),
    [t],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (section) =>
        section.tab.toLowerCase().includes(q) ||
        section.title.toLowerCase().includes(q) ||
        section.summary.toLowerCase().includes(q) ||
        section.steps.some((step) => step.toLowerCase().includes(q)),
    );
  }, [query, SECTIONS]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <IconButton icon="arrow-left" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.title, color: colors.charcoal }}>{t('help.title')}</Text>
          <Text style={{ color: colors.muted }}>{t('help.subtitle')}</Text>
        </View>
      </View>

      <TextInput
        placeholder={t('help.searchPlaceholder')}
        value={query}
        onChangeText={setQuery}
        mode="outlined"
        left={<TextInput.Icon icon="magnify" />}
        style={{ backgroundColor: colors.surface }}
      />

      {filtered.length === 0 ? (
        <Text style={{ color: colors.muted }}>{t('help.noResults', { query })}</Text>
      ) : (
        filtered.map((section) => {
          const isOpen = expandedKey === section.key;
          return (
            <AppCard key={section.key}>
                <Pressable
                  onPress={() => setExpandedKey(isOpen ? null : section.key)}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}
                  accessibilityRole="button"
                  accessibilityLabel={`${isOpen ? t('help.collapse') : t('help.expand')} ${section.title} ${t('help.instructionsSuffix')}`}
                >
                  <View style={{ flex: 1 }}>
                    <Kicker>{section.tab}</Kicker>
                    <Text style={{ ...type.heading, color: colors.charcoal, marginTop: 2 }}>{section.title}</Text>
                    <Text style={{ color: colors.muted }}>{section.summary}</Text>
                  </View>
                  <MaterialCommunityIcons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={24}
                    color={colors.muted}
                  />
                </Pressable>
                {isOpen ? (
                  <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm }}>
                    {section.steps.map((step, index) => (
                      <View key={index} style={{ flexDirection: 'row', gap: 8 }}>
                        <Text style={{ color: colors.primary, fontWeight: '700' }}>{index + 1}.</Text>
                        <Text style={{ flex: 1, color: colors.charcoal, lineHeight: 20 }}>{step}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
            </AppCard>
          );
        })
      )}
    </ScrollView>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
