import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import { router, useRootNavigationState, useSegments } from 'expo-router';
import { useA0Purchases } from '../lib/a0-purchases-stub';
import { useAuthStore, type AuthState } from '../lib/auth-store';
import { config } from '../lib/config';
import { hasAllAccess } from '../lib/permissions';
import type { SubscriptionRequiredReason } from '../lib/subscription-types';
import { useApiQuery } from '../lib/api-client';

const blockedStatuses = new Set(['past_due', 'cancelled', 'expired', 'paused']);
const allowedBlockedRoutes = ['/billing/locked', '/settings/billing', '/settings/account', '/venues'];

function reasonFromStatus(status?: string | null): SubscriptionRequiredReason {
  if (status === 'past_due') return 'payment_failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'expired') return 'trial_expired';
  return 'never_subscribed';
}

function isAllowedRoute(route: string) {
  return route.startsWith('/(auth)/') || allowedBlockedRoutes.some((allowed) => route.startsWith(allowed));
}

function isSubscriptionRequiredError(error: unknown): error is Error & { reason?: SubscriptionRequiredReason } {
  return error instanceof Error && (error.name === 'SubscriptionRequiredError' || error.message.includes('Subscription required'));
}

export function SubscriptionGate({ children }: { children?: unknown }) {
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const token = useAuthStore((state: AuthState) => state.token);
  const setSession = useAuthStore((state: AuthState) => state.setSession);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const { data: me, isLoading: meLoading } = useApiQuery<any | null>(['app', 'me'], '/v1/app/me', hydrated && Boolean(user) && Boolean(token));
  const { data: billing, isLoading: billingLoading } = useApiQuery<any | null>(['app', 'billing'], '/v1/app/billing', Boolean(me?.venue?._id));
  const route = `/${segments.join('/')}`;
  const navigationReady = Boolean(rootNavigationState?.key);
  const authRoute = route.startsWith('/(auth)/');
  const signedOutProtectedRoute = hydrated && (!user || !token) && !authRoute;
  const profileMissing = hydrated && Boolean(user) && Boolean(token) && !meLoading && me === null;

  // SubscriptionGate renders ABOVE the <Stack> navigator, so in release builds
  // rootNavigationState.key can flip truthy a beat before the navigator can
  // actually accept navigation — calling router.replace then throws
  // "navigate before mounting the Root Layout". Defer to the next tick (the
  // navigator's mount effects have run by then) and swallow any residual timing
  // error so a redirect can never crash the whole app. Returns an effect
  // cleanup that cancels a pending redirect if state changes first.
  const safeReplace = useCallback((href: Parameters<typeof router.replace>[0]) => {
    const timer = setTimeout(() => {
      try {
        router.replace(href);
      } catch {
        // Navigator not ready yet; the effect re-runs when state settles.
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!navigationReady || !signedOutProtectedRoute) return;
    return safeReplace('/(auth)/welcome');
  }, [navigationReady, signedOutProtectedRoute, safeReplace]);

  useEffect(() => {
    if (!profileMissing) return;
    clearSession();
    if (navigationReady && !authRoute) return safeReplace('/(auth)/welcome');
  }, [authRoute, clearSession, navigationReady, profileMissing, safeReplace]);

  useEffect(() => {
    if (!me?.profile || !user) return;
    const p = me.profile;
    const same =
      user.role === p.role &&
      user.full_name === p.fullName &&
      user.email_verified === (p.emailVerified === true) &&
      user.job_title === p.jobTitle &&
      user.all_access === (p.allAccess === true) &&
      user.venue_id === (p.venueId ?? null);
    if (same) return;
    setSession({
      user: {
        id: p._id,
        email: p.email,
        full_name: p.fullName,
        email_verified: p.emailVerified === true,
        role: p.role,
        job_title: p.jobTitle,
        venue_id: p.venueId ?? null,
        all_access: p.allAccess === true,
      },
      venue: me.venue
        ? { id: me.venue._id, name: me.venue.name, latitude: me.venue.latitude, longitude: me.venue.longitude, geofence_radius_m: me.venue.geofenceRadiusM }
        : null,
    });
  }, [me, user, setSession]);

  const { isPremium, isLoading: isPremiumLoading } = useA0Purchases();
  const allAccess = hasAllAccess(me?.profile?.allAccess);
  const venueBlocked = config.billingEnabled && !allAccess && billing ? blockedStatuses.has(billing.status) && !isPremiumLoading && !isPremium : false;
  const venueActive = billing ? billing.status === 'active' || billing.status === 'trialing' : false;
  const trialEndsAt = me?.profile?.trialEndsAt ?? null;
  const trialExpired = trialEndsAt != null && trialEndsAt <= Date.now();
  // Wait for the billing fetch before treating a venue as not-yet-active: while
  // `billing` is still loading it's `undefined`, which made `venueActive` false
  // and could momentarily fire a false "trial expired" redirect for a venue
  // whose subscription is actually active (e.g. on a slow cold start).
  const trialBlocked = config.billingEnabled && !allAccess && trialExpired && !venueActive && !billingLoading && !isPremiumLoading && !isPremium;
  const blocked = venueBlocked || trialBlocked;
  const reason = trialBlocked ? 'trial_expired' : reasonFromStatus(billing?.status ?? null);

  useEffect(() => {
    if (!navigationReady || !hydrated || !user || !blocked) return;
    if (isAllowedRoute(route)) return;
    return safeReplace(`/billing/locked?reason=${reason}`);
  }, [blocked, hydrated, navigationReady, reason, route, user, safeReplace]);

  // Escape hatch: if the user is sitting on /billing/locked (e.g. from an
  // earlier redirect, or a link) and the account is no longer actually
  // blocked, send them back into the app instead of leaving them stranded —
  // that screen has no "continue" action for non-billing roles.
  useEffect(() => {
    if (!navigationReady || !hydrated || !user || blocked) return;
    if (meLoading || billingLoading) return;
    if (!route.startsWith('/billing/locked')) return;
    return safeReplace('/(tabs)/home');
  }, [billingLoading, blocked, hydrated, meLoading, navigationReady, route, safeReplace, user]);


  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const globalObject = globalThis as typeof globalThis & {
      addEventListener?: typeof globalThis.addEventListener;
      removeEventListener?: typeof globalThis.removeEventListener;
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const rejection = event.reason;
      if (!isSubscriptionRequiredError(rejection)) return;
      event.preventDefault();
      router.replace(`/billing/locked?reason=${rejection.reason ?? reason}`);
    };

    const handleError = (event: Event) => {
      const errorEvent = event as ErrorEvent;
      if (!isSubscriptionRequiredError(errorEvent.error)) return;
      errorEvent.preventDefault();
      router.replace(`/billing/locked?reason=${errorEvent.error.reason ?? reason}`);
    };

    globalObject.addEventListener?.('unhandledrejection', handleUnhandledRejection);
    globalObject.addEventListener?.('error', handleError);
    return () => {
      globalObject.removeEventListener?.('unhandledrejection', handleUnhandledRejection);
      globalObject.removeEventListener?.('error', handleError);
    };
  }, [reason]);

  return children as never;
}
