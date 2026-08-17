import { useEffect, useRef } from 'react';
import { useAuthStore, type AuthState } from './auth-store';
import { canManageBilling, canManageVenue } from './permissions';
import { useQuery } from './railway-hooks';
import { api } from './railway-api';

export function useAuthenticatedSession() {
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const token = useAuthStore((state: AuthState) => state.token);
  const isReady = hydrated && Boolean(user) && Boolean(token);

  const { data: me, isLoading } = useQuery(api.app.getMe, isReady ? {} : 'skip');

  // Hydrate the venue list from the server (getMe returns venues). This runs
  // in the always-mounted authed tree, so it covers every sign-in path and
  // drops venues the user was revoked from.
  const setVenues = useAuthStore((state: AuthState) => state.setVenues);
  useEffect(() => {
    if (me?.venues) setVenues(me.venues);
  }, [me?.venues, setVenues]);

  // Cache the last resolved role keyed by venue so a venue switch never shows
  // the previous venue's permissions during the refetch window.
  const venueId = venue?.id ?? null;
  const lastKnown = useRef<{ venueId: string | null; role: string | null; allAccess: boolean | null } | null>(null);
  useEffect(() => {
    if (me?.profile) {
      lastKnown.current = { venueId, role: me.profile.role ?? null, allAccess: me.profile.allAccess === true };
    }
  }, [me?.profile?.role, me?.profile?.allAccess, venueId]);

  const cached = lastKnown.current?.venueId === venueId ? lastKnown.current : null;
  const role = me?.profile.role ?? cached?.role ?? null;
  const allAccess = me?.profile.allAccess ?? cached?.allAccess ?? false;
  const canManage = canManageVenue(role, allAccess);
  const canViewBilling = canManageBilling(role, allAccess);

  return {
    hydrated,
    user,
    venue,
    me,
    role,
    allAccess,
    canManage,
    canManageBilling: canViewBilling,
    isAuthenticated: Boolean(token),
    isAuthLoading: isLoading,
    isReady,
  };
}
