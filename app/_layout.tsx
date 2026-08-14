import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';
import { PaperProvider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useFonts } from 'expo-font';
import {
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_600SemiBold_Italic,
} from '@expo-google-fonts/fraunces';
import { A0PurchaseProvider } from '../lib/a0-purchases-stub';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { makePaperTheme, useAppearanceStore, designPalettes } from '../lib/theme';
import { SubscriptionGate } from '../components/SubscriptionGate';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useAuthStore, type AuthState } from '../lib/auth-store';
import { configurePurchases, logoutPurchases } from '../lib/purchases';
import { queryClient } from '../lib/query-client';
import { flushOfflineQueue } from '../lib/offline-queue';
import { OfflineBanner } from '../components/OfflineBanner';
import { SportsBrandIntro } from '../components/SportsBrandIntro';

const shouldIgnoreWebError = (message: string) =>
  message.includes('ResizeObserver loop completed with undelivered notifications') ||
  message.includes('ResizeObserver loop limit exceeded') ||
  message.includes("Failed to execute 'importScripts' on 'WorkerGlobalScope'") ||
  message.includes('monaco-editor') ||
  message.includes('ts.worker');

export default function RootLayout() {
  const themeMode = useAppearanceStore((state) => state.mode);
  const palette = designPalettes[themeMode];
  const [fontsLoaded, fontError] = useFonts({
    ...MaterialCommunityIcons.font,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_600SemiBold_Italic,
  });
  const fontsReady = Platform.OS !== 'web' || fontsLoaded || !!fontError;
  const [introDone, setIntroDone] = useState(false);
  const authScopeKey = useAuthStore(
    (state: AuthState) => `${state.authEpoch}:${state.user?.id ?? 'anon'}:${state.venue?.id ?? 'none'}`,
  );
  const venueId = useAuthStore((state: AuthState) => state.venue?.id ?? null);
  const token = useAuthStore((state: AuthState) => state.token);
  const lastAuthScopeKey = useRef<string | null>(null);

  useEffect(() => {
    if (lastAuthScopeKey.current === authScopeKey) return;
    lastAuthScopeKey.current = authScopeKey;
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [authScopeKey]);

  useEffect(() => {
    if (!token) {
      void logoutPurchases();
      return;
    }
    void configurePurchases(venueId ?? undefined);
  }, [token, venueId]);

  useEffect(() => {
    if (!token) return undefined;
    void flushOfflineQueue();
    const networkSubscription = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void flushOfflineQueue();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flushOfflineQueue();
    });
    return () => {
      subscription.remove();
      networkSubscription();
    };
  }, [token, venueId]);
  const debug = Boolean((globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;

    const globalObject = globalThis as typeof globalThis & {
      addEventListener?: typeof globalThis.addEventListener;
      removeEventListener?: typeof globalThis.removeEventListener;
    };

    const handleError = (event: Event) => {
      const errorEvent = event as ErrorEvent;
      const message = errorEvent.message || errorEvent.error?.message || '';
      if (shouldIgnoreWebError(message)) {
        errorEvent.preventDefault();
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = typeof reason === 'string'
        ? reason
        : (reason && typeof reason === 'object' && 'message' in reason ? String((reason as { message: unknown }).message) : String(reason ?? ''));
      if (shouldIgnoreWebError(message)) {
        event.preventDefault();
      }
    };

    globalObject.addEventListener?.('error', handleError);
    globalObject.addEventListener?.('unhandledrejection', handleUnhandledRejection);

    return () => {
      globalObject.removeEventListener?.('error', handleError);
      globalObject.removeEventListener?.('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  if (!fontsReady) {
    return <View style={{ flex: 1, backgroundColor: palette.background }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <PaperProvider theme={makePaperTheme(themeMode)}>
            <A0PurchaseProvider config={{ appUserId: venueId ?? undefined, debug }}>
              <View style={{ flex: 1, width: '100%', backgroundColor: '#FFFFFF' }}>
                <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top', 'left', 'right']}>
                  <ErrorBoundary>
                    <OfflineBanner />
                    <SubscriptionGate>
                      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
                    </SubscriptionGate>
                  </ErrorBoundary>
                </SafeAreaView>
                {!introDone ? (
                  <SportsBrandIntro onComplete={() => setIntroDone(true)} />
                ) : null}
              </View>
            </A0PurchaseProvider>
          </PaperProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
