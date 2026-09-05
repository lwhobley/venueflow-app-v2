import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { describeFailure } from '../ScreenState';
import { opsConsole } from '../../lib/theme';

type Props = {
  isLoading: boolean;
  error: unknown;
  isEmpty?: boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  onRetry?: () => void;
  children: ReactNode;
};

/**
 * `ScreenState` for the stadium operations consoles.
 *
 * Same three outcomes, drawn on the dark back-of-house surface instead of the
 * light Paper cards the rest of the app uses. These screens previously popped a
 * native `Alert` when a poll failed, which is the wrong shape for a wall-mounted
 * kitchen display: nobody is standing at it to dismiss a modal, and the board
 * behind it stops updating silently.
 */
export function OpsQueryState({
  isLoading,
  error,
  isEmpty = false,
  loadingMessage = 'Loading live board…',
  emptyMessage = 'Nothing on the board right now.',
  onRetry,
  children,
}: Props) {
  if (isLoading) {
    return (
      <View style={styles.box}>
        <ActivityIndicator size="large" color={opsConsole.accent} />
        <Text style={styles.loading}>{loadingMessage}</Text>
      </View>
    );
  }

  if (error) {
    const failure = describeFailure(error);
    return (
      <View style={styles.box}>
        <Text style={styles.errorTitle}>{failure.title.toUpperCase()}</Text>
        <Text style={styles.errorDetail}>{failure.detail}</Text>
        {onRetry && failure.retryable ? (
          <TouchableOpacity style={styles.retry} onPress={onRetry} accessibilityRole="button">
            <Text style={styles.retryText}>RETRY</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (isEmpty) {
    return (
      <View style={styles.box}>
        <Text style={styles.empty}>{emptyMessage}</Text>
      </View>
    );
  }

  return <>{children}</>;
}

/**
 * A thin strip for boards that keep showing their last good data through a
 * failed refresh — the board stays useful, but the staleness has to be visible.
 */
export function OpsStaleNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const failure = describeFailure(error);
  return (
    <View style={styles.strip} accessibilityRole="alert">
      <Text style={styles.stripText}>NOT UPDATING · {failure.detail}</Text>
      {onRetry && failure.retryable ? (
        <TouchableOpacity onPress={onRetry} accessibilityRole="button">
          <Text style={styles.stripAction}>RETRY</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 32, alignItems: 'center', gap: 10 },
  loading: { color: opsConsole.muted, fontSize: 13, fontWeight: '700' },
  errorTitle: { color: opsConsole.danger, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  errorDetail: { color: opsConsole.subtle, fontSize: 13, textAlign: 'center' },
  empty: { color: opsConsole.muted, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  retry: {
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: opsConsole.accent,
  },
  retryText: { color: opsConsole.textStrong, fontSize: 12, fontWeight: '900' },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: opsConsole.danger,
  },
  stripText: { color: opsConsole.textStrong, fontSize: 11, fontWeight: '800', flex: 1 },
  stripAction: { color: opsConsole.textStrong, fontSize: 11, fontWeight: '900' },
});
