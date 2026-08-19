import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandText } from './FutureUI';
import { ApiError } from '../lib/api-client';
import { spacing, useDesignTheme } from '../lib/theme';

type Failure = { key: string; message: string; status: number };

/**
 * Global surface for failed reads.
 *
 * `useQuery` in railway-hooks returns only `query.data`, so loading, empty, and
 * failed all reach a screen as `undefined` and most screens render their empty
 * state — "No issues have been reported" reads identically whether the venue is
 * quiet or the request was refused. This watches the query cache for failures on
 * queries something currently mounted is observing, and says so, with a retry.
 *
 * Screens that need the distinction inline should use `useQueryState` and render
 * `<ScreenState>`; this banner is the floor for everything else.
 */
export function DataErrorBanner() {
  const palette = useDesignTheme();
  const queryClient = useQueryClient();
  const [failures, setFailures] = useState<Failure[]>([]);
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const cache = queryClient.getQueryCache();

    const read = (): Failure[] =>
      cache
        .getAll()
        .filter((query) => query.getObserversCount() > 0 && query.state.status === 'error')
        .map((query) => {
          const error = query.state.error;
          // A 401 already clears the session and bounces to sign-in; surfacing it
          // here would just stack a banner on top of that redirect.
          const status = error instanceof ApiError ? error.status : 0;
          return {
            key: JSON.stringify(query.queryKey.slice(0, 2)),
            message: error instanceof Error ? error.message : 'Request failed',
            status,
          };
        })
        .filter((failure) => failure.status !== 401);

    const sync = () => {
      const next = read();
      setFailures((previous) =>
        signatureOf(previous) === signatureOf(next) ? previous : next,
      );
    };

    sync();
    return cache.subscribe(sync);
  }, [queryClient]);

  const signature = signatureOf(failures);
  if (failures.length === 0 || signature === dismissedSignature) return null;

  const forbidden = failures.every((failure) => failure.status === 403);
  const label = forbidden
    ? 'Some of this screen is outside your access'
    : failures.length === 1
      ? `Couldn’t load some data — ${failures[0].message}`
      : `Couldn’t load ${failures.length} parts of this screen`;

  return (
    <View
      style={{
        backgroundColor: forbidden ? palette.warning : palette.danger,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
      }}
      accessibilityRole="alert"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#FFFFFF" />
      <CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', flex: 1, fontWeight: '700' }}>
        {label}
      </CommandText>
      {forbidden ? null : (
        <Pressable
          disabled={retrying}
          onPress={() => {
            setRetrying(true);
            void queryClient
              .refetchQueries({ type: 'active', predicate: (query) => query.state.status === 'error' })
              .finally(() => setRetrying(false));
          }}
          accessibilityRole="button"
          accessibilityLabel="Retry loading this screen"
          style={({ pressed }) => ({ opacity: pressed || retrying ? 0.7 : 1 })}
        >
          <CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', fontWeight: '800' }}>
            {retrying ? 'Retrying…' : 'Retry'}
          </CommandText>
        </Pressable>
      )}
      <Pressable
        onPress={() => setDismissedSignature(signature)}
        accessibilityRole="button"
        accessibilityLabel="Dismiss data error"
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <MaterialCommunityIcons name="close" size={16} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

function signatureOf(failures: Failure[]) {
  return failures
    .map((failure) => `${failure.key}:${failure.status}`)
    .sort()
    .join('|');
}
