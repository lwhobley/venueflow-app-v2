import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, ScrollView } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { router, type ErrorBoundaryProps } from 'expo-router';
import { colors, spacing, radius } from '../lib/theme';

type Props = { children: ReactNode };
type State = { error: Error | null; componentStack: string | null };

// App-wide error boundary. A thrown error during render (e.g. a failing
// A failed async data hook would otherwise unmount the whole tree, which is a hard
// crash in a release build. This catches it and shows a recoverable screen
// instead, so a single screen's data error never takes down the app.
export function ScreenErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.error('[ErrorBoundary] caught:', error);
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  private reset = (goHome: boolean) => {
    this.setState({ error: null, componentStack: null });
    if (goHome) {
      try {
        router.replace('/(tabs)/home');
      } catch {
        // ignore navigation errors
      }
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md }}
      >
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md }}>
          <Text variant="headlineSmall" style={{ color: colors.primary, fontWeight: '800' }}>
            Something went wrong
          </Text>
          <Text style={{ color: colors.muted }}>
            This screen hit an error and couldn’t load. Your data is safe — try again or head back home.
          </Text>
          {typeof __DEV__ !== 'undefined' && __DEV__ ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>
                {error.name}: {error.message}
              </Text>
              {this.state.componentStack ? (
                <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={8}>
                  {this.state.componentStack.trim()}
                </Text>
              ) : null}
            </View>
          ) : null}
          <Button mode="contained" buttonColor={colors.primary} onPress={() => this.reset(true)}>
            Back to Home
          </Button>
          <Button mode="text" textColor={colors.primary} onPress={() => this.reset(false)}>
            Try again
          </Button>
        </View>
      </ScrollView>
    );
  }
}

/**
 * Per-route boundary. Expo Router renders the `ErrorBoundary` a route file
 * exports around that route only, so a screen that throws shows this recovery
 * card *inside* the navigator — tab bar intact, other screens still reachable
 * — instead of unmounting the whole app tree through the root boundary.
 *
 * Route files opt in with a single line:
 *   `export { RouteErrorBoundary as ErrorBoundary } from '<path>/components/ErrorBoundary';`
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md }}
    >
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md }}>
        <Text variant="headlineSmall" style={{ color: colors.primary, fontWeight: '800' }}>
          This screen didn’t load
        </Text>
        <Text style={{ color: colors.muted }}>
          Something went wrong rendering this screen. Your data is safe — retry, or use the tabs to keep working.
        </Text>
        {typeof __DEV__ !== 'undefined' && __DEV__ ? (
          <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>
            {error.name}: {error.message}
          </Text>
        ) : null}
        <Button mode="contained" buttonColor={colors.primary} onPress={() => void retry()}>
          Try again
        </Button>
        <Button mode="text" textColor={colors.primary} onPress={() => router.replace('/(tabs)/home')}>
          Back to Home
        </Button>
      </View>
    </ScrollView>
  );
}
