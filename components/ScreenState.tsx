import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { ApiError } from '../lib/api-client';
import { colors, radius, spacing } from '../lib/theme';
import { Skeleton } from './Skeleton';

type Props = {
  /** True while the query has never resolved. */
  isLoading: boolean;
  /** The query's error, if it failed. */
  error: unknown;
  /** True when the query succeeded but there is nothing to show. */
  isEmpty?: boolean;
  /** What to say when the query succeeded and returned nothing. */
  emptyMessage?: string;
  /** Re-run the failed query. */
  onRetry?: () => void;
  /** Rows of skeleton to show while loading. */
  skeletonRows?: number;
  children: ReactNode;
};

/**
 * Renders the three outcomes a read can have, distinctly.
 *
 * Screens used to collapse all three into one empty state, because
 * railway-hooks' `useQuery` returns only `query.data` — so "still loading",
 * "nothing here", and "the server refused you" all arrived as `undefined` and
 * came out as the same reassuring "nothing scheduled yet" copy. Pair this with
 * `useQueryState`, which returns the error alongside the data.
 */
export function ScreenState({
  isLoading,
  error,
  isEmpty = false,
  emptyMessage = 'Nothing here yet.',
  onRetry,
  skeletonRows = 3,
  children,
}: Props) {
  if (isLoading) {
    return (
      <View style={{ gap: spacing.sm }} accessibilityLabel="Loading">
        {Array.from({ length: skeletonRows }, (_, index) => (
          <Skeleton key={index} height={index === 0 ? 28 : 64} style={{ borderRadius: radius.sharp }} />
        ))}
      </View>
    );
  }

  if (error) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleSmall" style={{ fontWeight: '700', color: colors.danger }}>
            {describeFailure(error).title}
          </Text>
          <Text style={{ color: colors.muted }}>{describeFailure(error).detail}</Text>
          {onRetry && describeFailure(error).retryable ? (
            <Button compact mode="outlined" textColor={colors.primary} onPress={onRetry}>
              Try again
            </Button>
          ) : null}
        </Card.Content>
      </Card>
    );
  }

  if (isEmpty) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content>
          <Text style={{ color: colors.muted }}>{emptyMessage}</Text>
        </Card.Content>
      </Card>
    );
  }

  return <>{children}</>;
}

/**
 * A 403 is a settled answer, not a hiccup — offering "try again" on one just
 * invites the user to keep pulling a locked door.
 */
export function describeFailure(error: unknown): { title: string; detail: string; retryable: boolean } {
  const status = error instanceof ApiError ? error.status : 0;
  const message = error instanceof Error ? error.message : 'The request failed.';

  if (status === 403) {
    return { title: 'Not available for your role', detail: message, retryable: false };
  }
  if (status === 404) {
    return { title: 'Not found', detail: message, retryable: false };
  }
  if (status === 408) {
    return { title: 'Timed out', detail: message, retryable: true };
  }
  return { title: 'Couldn’t load this', detail: message, retryable: true };
}
