import { memo, type ComponentProps, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, HelperText, IconButton, Text, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { accents, colors, radius, spacing } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { asArray, errorMessage, formatRelativeTime } from '../../lib/format';
import { SectionHeader } from '../../components/AppCard';
import { useI18n } from '../../lib/i18n';


type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type FilterKey = 'all' | 'direct' | 'groups' | 'shifts';
type ConversationRow = {
  _id: string;
  title: string;
  type?: string;
  lastMessageText?: string | null;
  lastMessageAt?: number | null;
  unread?: boolean;
};
type DirectoryEntry = { _id: string; fullName: string; role: string; jobTitle: string };

const FILTERS: Array<{ key: FilterKey; labelKey: 'chat.filterAll' | 'chat.filterDirect' | 'chat.filterGroups' | 'chat.filterShifts' }> = [
  { key: 'all', labelKey: 'chat.filterAll' },
  { key: 'direct', labelKey: 'chat.filterDirect' },
  { key: 'groups', labelKey: 'chat.filterGroups' },
  { key: 'shifts', labelKey: 'chat.filterShifts' },
];

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}



function colorFor(index: number) {
  return accents[index % accents.length].icon;
}

const ConversationListRow = memo(function ConversationListRow({
  row,
  index,
  icon,
  subtitle,
  onPress,
  onDelete,
}: {
  row: ConversationRow;
  index: number;
  icon?: MaterialIconName;
  subtitle?: string | null;
  onPress: () => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  const accent = colorFor(index);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.md,
          opacity: pressed ? 0.78 : 1,
        })}
      >
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }}>
          {icon ? (
            <MaterialCommunityIcons name={icon} size={22} color="#000000" />
          ) : (
            <Text style={{ color: '#000000', fontWeight: '900' }}>{initials(row.title)}</Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text numberOfLines={1} style={{ flex: 1, color: colors.charcoal, fontSize: 15, fontWeight: row.unread ? '900' : '700' }}>
              {row.title}
            </Text>
            {row.lastMessageAt ? (
              <Text style={{ color: row.unread ? colors.primary : colors.muted, fontSize: 11, fontWeight: '700' }}>
                {formatRelativeTime(row.lastMessageAt)}
              </Text>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: row.unread ? colors.primary : colors.muted, fontSize: 13, fontWeight: row.unread ? '700' : '400' }}>
              {subtitle ?? row.lastMessageText ?? t('chat.noMessagesYet')}
            </Text>
            {row.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} /> : null}
          </View>
        </View>
      </Pressable>
      {onDelete ? <IconButton icon="delete-outline" iconColor={colors.danger} onPress={onDelete} /> : null}
    </View>
  );
});

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.charcoal, fontSize: 16, fontWeight: '900' }}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export default function ChatScreen() {
  const { t } = useI18n();
  const { venue, isReady, me, canManage } = useVenueAuth();
  const ensureSetup = useMutation(api.chat.ensureChatSetup);
  const openDm = useMutation(api.chat.openDm);
  const createGroup = useMutation(api.chat.createGroup);
  const deleteConversation = useMutation(api.chat.deleteConversation);
  const conversations = useQuery(api.chat.listConversations, isReady && venue?.id ? { venueId: venue.id } : 'skip');
  const directory = useQuery(api.chat.listDirectory, isReady && venue?.id ? { venueId: venue.id } : 'skip');

  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !venue?.id) return;
    setError(null);
    void ensureSetup({ venueId: venue.id }).catch((e: unknown) => {
      setError(errorMessage(e, t('chat.errorPrepareChat')));
    });
  }, [ensureSetup, isReady, venue?.id]);

  const groups = asArray(conversations?.groups) as ConversationRow[];
  const dms = asArray(conversations?.dms) as ConversationRow[];
  const roles = asArray(conversations?.roles) as ConversationRow[];
  const shifts = asArray(conversations?.shifts) as ConversationRow[];

  const unreadCount = [...groups, ...dms, ...roles, ...shifts].filter((row) => row.unread).length;

  const dmByName = useMemo(() => new Map(dms.map((dm) => [dm.title, dm])), [dms]);
  const byPosition = useMemo(() => {
    const map = new Map<string, DirectoryEntry[]>();
    for (const person of asArray(directory) as DirectoryEntry[]) {
      const key = person.jobTitle?.trim() || t('chat.teamFallback');
      const list = asArray(map.get(key));
      list.push(person);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [directory, t]);

  const startDm = async (otherId: string) => {
    if (!venue?.id) return;
    setError(null);
    try {
      const result = await openDm({ venueId: venue.id, targetProfileId: otherId as Id<'profiles'> });
      const conversationId = result?.conversationId ?? result;
      if (!conversationId) throw new Error(t('chat.errorOpenDm'));
      router.push(`/chat/${conversationId}`);
    } catch (e) {
      setError(errorMessage(e, t('chat.errorOpenDm')));
    }
  };

  const onCreateGroup = async () => {
    if (!venue?.id || !groupName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createGroup({ venueId: venue.id, name: groupName.trim() });
      const conversationId = result?.conversationId ?? result;
      if (!conversationId) throw new Error(t('chat.errorCreateGroup'));
      setGroupName('');
      setShowNewGroup(false);
      router.push(`/chat/${conversationId}`);
    } catch (e) {
      setError(errorMessage(e, t('chat.errorCreateGroup')));
    } finally {
      setCreating(false);
    }
  };

  const onDeleteConversation = async (conversationId: string) => {
    setError(null);
    try {
      await deleteConversation({ conversationId: conversationId as Id<'conversations'> });
    } catch (e) {
      setError(errorMessage(e, t('chat.errorDeleteChat')));
    }
  };

  if (!venue?.id) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'center' }}>
        <Text style={{ color: colors.charcoal, fontSize: 18, fontWeight: '900', textAlign: 'center' }}>{t('chat.unlockTitle')}</Text>
        <Text style={{ color: colors.muted, textAlign: 'center', marginTop: spacing.sm }}>{t('chat.unlockSubtitle')}</Text>
      </View>
    );
  }

  const showDirect = activeFilter === 'all' || activeFilter === 'direct';
  const showGroups = activeFilter === 'all' || activeFilter === 'groups';
  const showShifts = activeFilter === 'all' || activeFilter === 'shifts';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader
        kicker={t('chat.headerKicker')}
        title={t('chat.header')}
        subtitle={
          unreadCount
            ? unreadCount === 1
              ? t('chat.unreadSingular', { count: unreadCount })
              : t('chat.unreadPlural', { count: unreadCount })
            : t('chat.allCaughtUp')
        }
        rule={false}
      />

      <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceSoft, borderRadius: radius.md, padding: 3, gap: 3 }}>
        {FILTERS.map((filter) => {
          const active = activeFilter === filter.key;
          return (
            <Pressable
              key={filter.key}
              onPress={() => setActiveFilter(filter.key)}
              style={{
                flex: 1,
                minHeight: 36,
                borderRadius: radius.sm,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.surface : 'transparent',
                borderWidth: active ? 1 : 0,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: active ? colors.primary : colors.muted, fontWeight: '800', fontSize: 12 }}>{t(filter.labelKey)}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <HelperText type="error" visible>{error}</HelperText> : null}

      {showShifts && roles.length + shifts.length > 0 ? (
        <Section title={t('chat.operationsChannels')}>
          {roles.map((row, index) => (
            <ConversationListRow
              key={row._id}
              row={row}
              index={index}
              icon="pound"
              subtitle={row.lastMessageText ?? t('chat.roleUpdatesSubtitle')}
              onPress={() => router.push(`/chat/${row._id}`)}
            />
          ))}
          {shifts.map((row, index) => (
            <ConversationListRow
              key={row._id}
              row={row}
              index={index + 3}
              icon="clock-outline"
              subtitle={row.lastMessageText ?? t('chat.todayShiftCrew')}
              onPress={() => router.push(`/chat/${row._id}`)}
            />
          ))}
        </Section>
      ) : null}

      {showGroups ? (
        <Section
          title={t('chat.groupChats')}
          action={
            <Button compact mode="text" textColor={colors.primary} icon="plus" onPress={() => setShowNewGroup((value) => !value)}>
              {t('chat.newButton')}
            </Button>
          }
        >
          {showNewGroup ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.xs }}>
              <TextInput
                placeholder={t('chat.groupNamePlaceholder')}
                value={groupName}
                onChangeText={setGroupName}
                mode="outlined"
                dense
                style={{ flex: 1, backgroundColor: colors.surface }}
                onSubmitEditing={() => void onCreateGroup()}
              />
              <IconButton
                icon="check"
                mode="contained"
                containerColor={colors.primary}
                iconColor="#fff"
                disabled={!groupName.trim() || creating}
                onPress={() => void onCreateGroup()}
              />
            </View>
          ) : null}
          {groups.length ? (
            groups.map((row, index) => (
              <ConversationListRow
                key={row._id}
                row={row}
                index={index + 1}
                icon="account-group"
                subtitle={row.lastMessageText ?? t('chat.tapToOpenGroup')}
                onPress={() => router.push(`/chat/${row._id}`)}
                onDelete={canManage ? () => void onDeleteConversation(row._id) : undefined}
              />
            ))
          ) : (
            <Text style={{ color: colors.muted }}>{t('chat.noGroupChats')}</Text>
          )}
        </Section>
      ) : null}

      {showDirect && dms.length > 0 ? (
        <Section title={t('chat.directMessages')}>
          {dms.map((row, index) => (
            <ConversationListRow
              key={row._id}
              row={row}
              index={index}
              onPress={() => router.push(`/chat/${row._id}`)}
              onDelete={canManage ? () => void onDeleteConversation(row._id) : undefined}
            />
          ))}
        </Section>
      ) : null}

      {showDirect ? (
        <Section title={t('chat.teamDirectory')}>
          {directory === undefined ? (
            <Text style={{ color: colors.muted }}>{t('chat.loadingTeammates')}</Text>
          ) : byPosition.length === 0 ? (
            <Text style={{ color: colors.muted }}>{t('chat.noTeammates')}</Text>
          ) : (
            byPosition.map(([position, people], groupIndex) => (
              <View key={position} style={{ gap: spacing.xs }}>
                <Text style={{ color: colors.primary, fontWeight: '900', marginTop: spacing.xs }}>{position}</Text>
                {people.map((person, index) => {
                  const existingDm = dmByName.get(person.fullName);
                  return (
                    <ConversationListRow
                      key={person._id}
                      row={{ _id: person._id, title: person.fullName, lastMessageText: person.role }}
                      index={groupIndex + index + 2}
                      onPress={() => (existingDm ? router.push(`/chat/${existingDm._id}`) : void startDm(person._id))}
                    />
                  );
                })}
              </View>
            ))
          )}
        </Section>
      ) : null}
    </ScrollView>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
