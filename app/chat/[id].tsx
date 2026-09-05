import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Dialog, HelperText, IconButton, Portal, Text, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { resolveMediaUrl } from '../../lib/api-client';
import type { Id } from '../../lib/ids';
import { accents, colors, radius, spacing, type } from '../../lib/theme';
import { Kicker } from '../../components/AppCard';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { asArray, errorMessage, formatTime } from '../../lib/format';
import { useI18n, type TranslationKey } from '../../lib/i18n';

type ChatMessage = {
  _id: string;
  id: string;
  text: string;
  senderName: string;
  createdAt: number;
  mine: boolean;
  shiftId?: string | null;
  swapId?: string | null;
  imageUrl?: string | null;
  reactions?: Record<string, string[]>;
};

type RenderItem =
  | { kind: 'day'; id: string; label: string }
  | { kind: 'message'; id: string; message: ChatMessage; showSender: boolean; compact: boolean };


function fmtDay(at: number, t: (key: TranslationKey) => string) {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t('chatThread.today');
  if (date.toDateString() === yesterday.toDateString()) return t('chatThread.yesterday');
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function isSameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function isValidId(id: string): id is Id<'conversations'> {
  return /^[a-zA-Z0-9_-]+$/.test(id) && id.length >= 10;
}

function parseShiftCard(text: string) {
  const match = text.match(/^\[Shift:\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\]$/);
  if (!match) return null;
  return {
    jobTitle: match[1],
    dayLabel: match[2],
    timeRange: match[3],
    shiftId: match[4],
  };
}

function parseSwapCard(text: string) {
  const match = text.match(/^\[Swap:\s*(.*?)\s*\|\s*(.*?)\s*\]$/);
  if (!match) return null;
  return {
    description: match[1],
    swapId: match[2],
  };
}

function groupMessages(messages: ChatMessage[], t: (key: TranslationKey) => string): RenderItem[] {
  const items: RenderItem[] = [];
  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    if (!previous || !isSameDay(previous.createdAt, message.createdAt)) {
      items.push({ kind: 'day', id: `day-${message.createdAt}`, label: fmtDay(message.createdAt, t) });
    }
    const sameSender = previous?.senderName === message.senderName && previous?.mine === message.mine;
    const closeInTime = previous ? message.createdAt - previous.createdAt < 5 * 60 * 1000 : false;
    items.push({
      kind: 'message',
      id: message.id,
      message,
      showSender: !message.mine && !(sameSender && closeInTime),
      compact: Boolean(sameSender && closeInTime),
    });
  });
  return items;
}

const ReactionPill = memo(function ReactionPill({
  emoji,
  count,
  active,
  onPress,
}: {
  emoji: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: active ? colors.cream : colors.surface,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        gap: 3,
      }}
    >
      <Text style={{ fontSize: 12, color: active ? colors.primary : colors.charcoal, fontWeight: '800' }}>{emoji}</Text>
      <Text style={{ fontSize: 11, color: active ? colors.primary : colors.muted, fontWeight: '800' }}>{count}</Text>
    </Pressable>
  );
});

function ActionCard({
  title,
  subtitle,
  tone,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: {
  title: string;
  subtitle: string;
  tone: 'shift' | 'swap';
  primaryLabel: string;
  secondaryLabel?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
}) {
  const accent = tone === 'shift' ? accents[2] : accents[0];
  return (
    <View
      style={{
        width: 260,
        maxWidth: '100%',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: accent.bg, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name={tone === 'shift' ? 'calendar-clock' : 'swap-horizontal'} size={18} color={accent.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.charcoal, fontWeight: '900' }} numberOfLines={1}>{title}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={2}>{subtitle}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button mode="contained" compact buttonColor={colors.primary} style={{ flex: 1 }} onPress={onPrimary}>
          {primaryLabel}
        </Button>
        {secondaryLabel && onSecondary ? (
          <Button mode="outlined" compact textColor={colors.danger} style={{ flex: 1 }} onPress={onSecondary}>
            {secondaryLabel}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

export default function ConversationScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ id: string }>();
  const { isReady } = useAuthenticatedSession();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const conversationId: Id<'conversations'> | null = rawId && isValidId(rawId) ? rawId as Id<'conversations'> : null;

  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const data = useQuery(api.chat.getMessages, isReady && conversationId ? { conversationId } : 'skip');
  const myScheduleData = useQuery(api.scheduling.getMySchedule, isReady ? {} : 'skip');

  const sendMessage = useMutation(api.chat.sendMessage);
  const deleteConversation = useMutation(api.chat.deleteConversation);
  const toggleReaction = useMutation(api.chat.toggleReaction);
  const editMessage = useMutation(api.chat.editMessage);
  const uploadImage = useMutation(api.chat.uploadImage);
  const claimOpenShift = useMutation(api.scheduling.claimOpenShift);
  const respondToShiftSwap = useMutation(api.scheduling.respondToShiftSwap);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reactMsgId, setReactMsgId] = useState<string | null>(null);
  const [showShareDialog, setShowShareDialog] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const messages = asArray(data?.messages) as ChatMessage[];
  messagesRef.current = messages;
  const readReceipts = asArray(data?.readReceipts) as Array<{ name: string; readAt: number }>;
  const mineShifts = asArray(myScheduleData?.mine);
  const openShifts = asArray(myScheduleData?.open);
  const renderItems = useMemo(() => groupMessages(messages, t), [messages, t]);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 70);
    return () => clearTimeout(timer);
  }, [messages.length]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const onSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !conversationId || sending) return;
    setText('');
    setSending(true);
    setError(null);
    try {
      await sendMessage({ conversationId, text: trimmed });
    } catch (e) {
      setText(trimmed);
      setError(errorMessage(e, t('chatThread.errorSend')));
    } finally {
      setSending(false);
    }
  };

  const onReact = async (messageId: string, emoji: string) => {
    setError(null);
    try {
      await toggleReaction({ messageId, emoji });
    } catch (e) {
      setError(errorMessage(e, t('chatThread.errorReact')));
    }
  };

  const onUpdateChecklist = async (messageId: string, newText: string) => {
    setError(null);
    try {
      await editMessage({ messageId, text: newText });
    } catch (e) {
      setError(errorMessage(e, t('chatThread.errorChecklist')));
    }
  };

  const onClaimShift = async (shiftId: string) => {
    try {
      await claimOpenShift({ shiftId });
      setToast(t('chatThread.shiftClaimed'));
    } catch (e) {
      setToast(errorMessage(e, t('chatThread.errorClaim')));
    }
  };

  const onRespondSwap = async (swapId: string, accept: boolean) => {
    try {
      await respondToShiftSwap({ swapId, accept });
      setToast(accept ? t('chatThread.swapAccepted') : t('chatThread.swapDeclined'));
    } catch (e) {
      setToast(errorMessage(e, t('chatThread.errorSwapAction')));
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
      base64: true,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64 || !conversationId) return;

    setError(null);
    setSending(true);
    try {
      const { imageUrl } = await uploadImage({
        dataBase64: asset.base64,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      await sendMessage({ conversationId, text: t('chatThread.sharedPhoto'), imageUrl });
    } catch (e) {
      setError(errorMessage(e, t('chatThread.errorUpload')));
    } finally {
      setSending(false);
    }
  };

  const shareShift = async (shift: any) => {
    if (!conversationId) return;
    const formatted = `[Shift: ${shift.jobTitle} | ${shift.dayLabel} | ${shift.startTime} - ${shift.endTime} | ${shift._id}]`;
    setError(null);
    try {
      await sendMessage({ conversationId, text: formatted });
      setShowShareDialog(false);
    } catch (e) {
      setError(errorMessage(e, t('chatThread.errorShare')));
    }
  };

  const onDeleteChat = async () => {
    if (!conversationId) return;
    setError(null);
    try {
      await deleteConversation({ conversationId });
      router.back();
    } catch (e) {
      setError(errorMessage(e, t('chatThread.errorDelete')));
    }
  };

  const renderChecklist = (messageId: string, msgText: string, mine: boolean) => {
    const lines = msgText.split('\n');
    return (
      <View style={{ gap: spacing.xs }}>
        {lines.map((line, index) => {
          const isUnchecked = line.startsWith('[ ]');
          const isChecked = line.startsWith('[x]');
          if (!isUnchecked && !isChecked) {
            return <Text key={`${messageId}-${index}`} style={{ color: mine ? '#fff' : colors.charcoal }}>{line}</Text>;
          }
          const label = line.slice(3).trim();
          return (
            <Pressable
              key={`${messageId}-${index}`}
              onPress={() => {
                const current = messagesRef.current.find((msg) => msg.id === messageId || msg._id === messageId);
                const currentLines = (current?.text ?? msgText).split('\n');
                currentLines[index] = currentLines[index]?.startsWith('[ ]') ? `[x] ${label}` : `[ ] ${label}`;
                void onUpdateChecklist(messageId, currentLines.join('\n'));
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 2 }}
            >
              <MaterialCommunityIcons
                name={isChecked ? 'checkbox-marked-outline' : 'checkbox-blank-outline'}
                size={18}
                color={mine ? '#fff' : colors.primary}
              />
              <Text style={{ color: mine ? '#fff' : colors.charcoal, textDecorationLine: isChecked ? 'line-through' : 'none' }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderReactions = (message: ChatMessage) => {
    const reactions = message.reactions || {};
    const emojis = Object.keys(reactions);
    if (!emojis.length) return null;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4, alignSelf: message.mine ? 'flex-end' : 'flex-start' }}>
        {emojis.map((emoji) => {
          const users = reactions[emoji] || [];
          if (!users.length) return null;
          return (
            <ReactionPill
              key={emoji}
              emoji={emoji}
              count={users.length}
              active={users.includes(me?.profile?.id)}
              onPress={() => void onReact(message.id, emoji)}
            />
          );
        })}
      </View>
    );
  };

  const renderMessage = (item: Extract<RenderItem, { kind: 'message' }>) => {
    const message = item.message;
    const shift = parseShiftCard(message.text);
    const swap = parseSwapCard(message.text);
    const hasChecklist = message.text.includes('[ ]') || message.text.includes('[x]');
    const bubbleColor = message.mine ? colors.primary : colors.surface;
    const textColor = message.mine ? '#fff' : colors.charcoal;

    return (
      <View
        key={item.id}
        style={{
          alignSelf: message.mine ? 'flex-end' : 'flex-start',
          maxWidth: '84%',
          marginTop: item.compact ? 2 : spacing.sm,
        }}
      >
        {item.showSender ? <Text style={{ color: colors.muted, fontSize: 11, marginLeft: spacing.sm, marginBottom: 2 }}>{message.senderName}</Text> : null}
        <Pressable onLongPress={() => setReactMsgId(message.id)}>
          <View
            style={{
              backgroundColor: bubbleColor,
              borderRadius: radius.lg,
              borderBottomRightRadius: message.mine ? radius.sm : radius.lg,
              borderBottomLeftRadius: message.mine ? radius.lg : radius.sm,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderWidth: message.mine ? 0 : 1,
              borderColor: colors.border,
              gap: spacing.xs,
            }}
          >
            {message.imageUrl ? (
              <Image source={{ uri: resolveMediaUrl(message.imageUrl) }} style={{ width: 230, height: 160, borderRadius: radius.md }} resizeMode="cover" />
            ) : null}

            {shift ? (
              <ActionCard
                title={shift.jobTitle}
                subtitle={`${shift.dayLabel} - ${shift.timeRange}`}
                tone="shift"
                primaryLabel={t('chatThread.claim')}
                onPrimary={() => void onClaimShift(shift.shiftId)}
              />
            ) : swap ? (
              <ActionCard
                title={t('chatThread.shiftSwapTitle')}
                subtitle={swap.description}
                tone="swap"
                primaryLabel={t('chatThread.accept')}
                secondaryLabel={t('chatThread.deny')}
                onPrimary={() => void onRespondSwap(swap.swapId, true)}
                onSecondary={() => void onRespondSwap(swap.swapId, false)}
              />
            ) : hasChecklist ? (
              renderChecklist(message.id, message.text, message.mine)
            ) : (
              <Text style={{ color: textColor, fontSize: 15, lineHeight: 20 }}>{message.text}</Text>
            )}

            <Text style={{ color: message.mine ? 'rgba(255,255,255,0.72)' : colors.muted, fontSize: 10, alignSelf: 'flex-end' }}>
              {formatTime(message.createdAt)}
            </Text>
          </View>
        </Pressable>
        {renderReactions(message)}
      </View>
    );
  };

  const latestReadNames = readReceipts
    .slice(0, 3)
    .map((receipt) => receipt.name.split(' ')[0])
    .join(', ');

  return (
    <Portal.Host>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surface }}>
          <IconButton icon="arrow-left" iconColor={colors.charcoal} onPress={() => router.back()} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.charcoal, fontSize: 18, fontWeight: '900' }} numberOfLines={1}>{data?.title ?? t('chatThread.headerFallback')}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{t('chatThread.teamConversation')}</Text>
          </View>
          <IconButton icon="delete-outline" iconColor={colors.danger} onPress={() => void onDeleteChat()} />
        </View>

        {error ? <HelperText type="error" visible>{error}</HelperText> : null}

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 ? (
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.sm }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="message-text-outline" size={28} color={colors.primary} />
              </View>
              <Text style={{ ...type.heading, color: colors.charcoal }}>{t('chatThread.emptyTitle')}</Text>
              <Text style={{ color: colors.muted, textAlign: 'center' }}>{t('chatThread.emptySubtitle')}</Text>
            </View>
          ) : (
            renderItems.map((item) => (
              item.kind === 'day' ? (
                <View key={item.id} style={{ alignItems: 'center', marginVertical: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', backgroundColor: colors.surfaceSoft, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    {item.label}
                  </Text>
                </View>
              ) : renderMessage(item)
            ))
          )}
        </ScrollView>

        {latestReadNames ? (
          <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.xs, backgroundColor: colors.background }}>
            <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'right' }}>{t('chatThread.readBy', { names: latestReadNames })}</Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: spacing.sm, gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface }}>
          <IconButton icon="calendar-plus" iconColor={colors.primary} size={22} style={{ margin: 0 }} onPress={() => setShowShareDialog(true)} accessibilityLabel={t('chatThread.shareShiftLabel')} />
          <IconButton icon="image-outline" iconColor={colors.primary} size={22} style={{ margin: 0 }} onPress={() => void pickImage()} accessibilityLabel={t('chatThread.addPhotoLabel')} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('chatThread.messagePlaceholder')}
            mode="outlined"
            dense
            multiline
            style={{ flex: 1, maxHeight: 110, backgroundColor: colors.surface }}
            onSubmitEditing={() => {
              if (Platform.OS !== 'web') return;
              void onSend();
            }}
            returnKeyType="send"
          />
          <IconButton
            icon={sending ? 'clock-outline' : 'send'}
            mode="contained"
            containerColor={text.trim() && !sending ? colors.primary : colors.border}
            iconColor="#fff"
            disabled={!text.trim() || sending}
            style={{ margin: 0 }}
            onPress={() => void onSend()}
            accessibilityLabel={t('chatThread.sendMessageLabel')}
          />
        </View>

        <Portal>
          <Dialog visible={Boolean(reactMsgId)} onDismiss={() => setReactMsgId(null)} style={{ backgroundColor: colors.surface }}>
            <Dialog.Title style={{ fontSize: 16 }}>{t('chatThread.reactDialogTitle')}</Dialog.Title>
            <Dialog.Content style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.md }}>
              {['+1', 'heart', 'wow', 'haha', 'clap'].map((emoji) => (
                <Button
                  key={emoji}
                  mode="outlined"
                  compact
                  onPress={() => {
                    if (reactMsgId) void onReact(reactMsgId, emoji);
                    setReactMsgId(null);
                  }}
                >
                  {emoji}
                </Button>
              ))}
            </Dialog.Content>
          </Dialog>

          <Dialog visible={showShareDialog} onDismiss={() => setShowShareDialog(false)} style={{ backgroundColor: colors.surface }}>
            <Dialog.Title style={{ fontSize: 16 }}>{t('chatThread.shareShiftDialogTitle')}</Dialog.Title>
            <Dialog.ScrollArea style={{ maxHeight: 340, paddingHorizontal: 0 }}>
              <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
                <Kicker style={{ marginVertical: spacing.sm }}>{t('chatThread.myShifts')}</Kicker>
                {mineShifts.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>{t('chatThread.noShiftsScheduled')}</Text>
                ) : (
                  mineShifts.map((shift: any) => (
                    <ShiftShareRow key={shift._id} title={shift.jobTitle} subtitle={`${shift.dayLabel} - ${shift.startTime} - ${shift.endTime}`} onPress={() => void shareShift(shift)} />
                  ))
                )}

                <Kicker style={{ marginVertical: spacing.sm }}>{t('chatThread.openShifts')}</Kicker>
                {openShifts.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>{t('chatThread.noOpenShifts')}</Text>
                ) : (
                  openShifts.map((shift: any) => (
                    <ShiftShareRow key={shift._id} title={shift.jobTitle} subtitle={`${shift.dayLabel} - ${shift.startTime} - ${shift.endTime}`} onPress={() => void shareShift(shift)} />
                  ))
                )}
              </ScrollView>
            </Dialog.ScrollArea>
            <Dialog.Actions>
              <Button onPress={() => setShowShareDialog(false)}>{t('chatThread.cancel')}</Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>

        {toast ? (
          <Portal>
            <View style={{ position: 'absolute', bottom: 76, left: 20, right: 20, backgroundColor: colors.surface, borderColor: colors.success, borderWidth: 1, padding: spacing.md, borderRadius: radius.md }}>
              <Text style={{ color: colors.success, fontWeight: '900', textAlign: 'center' }}>{toast}</Text>
            </View>
          </Portal>
        ) : null}
      </KeyboardAvoidingView>
    </Portal.Host>
  );
}

function ShiftShareRow({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: spacing.md,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.charcoal, fontWeight: '800' }} numberOfLines={1}>{title}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{subtitle}</Text>
      </View>
      <MaterialCommunityIcons name="send" size={18} color={colors.primary} />
    </Pressable>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
