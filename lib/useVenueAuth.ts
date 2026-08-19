/**
 * Shared hook that combines the auth-store venue, authenticated session,
 * profile query, and manager permission check — previously duplicated
 * across 10+ screen files.
 */
import { useAuthStore, type AuthState } from './auth-store';
import { useAuthenticatedSession } from './auth-readiness';
import { useQuery } from './railway-hooks';
import { api } from './railway-api';
import { canManageVenue } from './permissions';

export function useVenueAuth() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const venues = useAuthStore((state: AuthState) => state.venues);
  const switchVenue = useAuthStore((state: AuthState) => state.switchVenue);
  const { isReady, user } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const profileLoading = isReady && me === undefined;
  const canManage = Boolean(
    me?.profile && canManageVenue(me.profile.role, me.profile.allAccess),
  );

  return { venue, venues, switchVenue, isReady, user, me, profileLoading, canManage } as const;
}
