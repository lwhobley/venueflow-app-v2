import { useCallback, useEffect } from 'react';
import { router, useRootNavigationState, useSegments } from 'expo-router';
import { useAuthStore, type AuthState } from '../lib/auth-store';
import { useApiQuery } from '../lib/api-client';

function isAllowedAuthRoute(route: string) {
  return route.startsWith('/(auth)/') || route.startsWith('/billing') || route.startsWith('/settings');
}

export function SubscriptionGate({ children }: { children?: unknown }) {
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const token = useAuthStore((state: AuthState) => state.token);
  const setSession = useAuthStore((state: AuthState) => state.setSession);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const { data: me, isLoading: meLoading } = useApiQuery<any | null>(
    ['app', 'me'],
    '/v1/app/me',
    hydrated && Boolean(user) && Boolean(token),
  );
  const route = `/${segments.join('/')}`;
  const navigationReady = Boolean(rootNavigationState?.key);
  const authRoute = route.startsWith('/(auth)/');
  const signedOutProtectedRoute = hydrated && (!user || !token) && !authRoute;
  const profileMissing = hydrated && Boolean(user) && Boolean(token) && !meLoading && me === null;

  // Safe navigation deferral
  const safeReplace = useCallback((href: Parameters<typeof router.replace>[0]) => {
    const timer = setTimeout(() => {
      try {
        router.replace(href);
      } catch {
        // Navigator not ready yet; effect re-runs when state settles.
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
        ? {
            id: me.venue._id,
            name: me.venue.name,
            latitude: me.venue.latitude,
            longitude: me.venue.longitude,
            geofence_radius_m: me.venue.geofenceRadiusM,
          }
        : null,
    });
  }, [me, user, setSession]);

  return children as never;
}

