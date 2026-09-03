import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { useAuthStore } from './auth-store';
import type { WorkspaceResolution } from './types';

export const WORKSPACE_QUERY_KEY = ['departments', 'workspace'];

export function useWorkspaceResolution() {
  const venueId = useAuthStore((s) => s.venue?.id);
  const token = useAuthStore((s) => s.token);

  return useQuery<WorkspaceResolution>({
    queryKey: [...WORKSPACE_QUERY_KEY, venueId],
    queryFn: async () => {
      return apiRequest<WorkspaceResolution>('/v1/departments/workspace');
    },
    enabled: Boolean(venueId && token),
    staleTime: 60_000,
  });
}

export function useSwitchWorkspace() {
  const queryClient = useQueryClient();
  const venueId = useAuthStore((s) => s.venue?.id);

  return useMutation({
    mutationFn: async (departmentId: string) => {
      return apiRequest<{ success: boolean; switchedDepartmentId: string }>('/v1/departments/switch', {
        method: 'POST',
        body: JSON.stringify({ departmentId }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...WORKSPACE_QUERY_KEY, venueId] });
      void queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
  });
}

/**
 * Validates if the user's effective operational areas permit access to a specific route path.
 */
export function isRouteAuthorizedForUser(
  workspace: WorkspaceResolution | undefined | null,
  pathname: string,
): { authorized: boolean; reason?: string } {
  if (!workspace) {
    return { authorized: false, reason: 'Workspace resolution pending' };
  }

  if (!workspace.assigned) {
    return { authorized: false, reason: 'Department assignment required' };
  }

  const areas = new Set(workspace.allowedOperationalAreas.map((a) => a.toLowerCase()));

  // Broad administrative access
  if (areas.has('operations') || areas.has('administrative') || workspace.effectiveRole === 'platform_admin' || workspace.effectiveRole === 'owner') {
    return { authorized: true };
  }

  const cleanPath = pathname.toLowerCase();

  // Concessions routes
  if (cleanPath.includes('/stand-sheet') || cleanPath.includes('/pos-aggregator')) {
    if (!areas.has('concession')) {
      return { authorized: false, reason: 'Concessions area authorization required' };
    }
    return { authorized: true };
  }

  // Culinary / KDS routes
  if (cleanPath.includes('/kds')) {
    if (!areas.has('culinary') && !areas.has('kitchen')) {
      return { authorized: false, reason: 'Culinary production area authorization required' };
    }
    return { authorized: true };
  }

  // Distro pickup routes
  if (cleanPath.includes('/distro-pickup')) {
    if (!areas.has('distro') && !areas.has('culinary') && !areas.has('catering') && !areas.has('suite')) {
      return { authorized: false, reason: 'Distribution pickup area authorization required' };
    }
    return { authorized: true };
  }

  // Suite attendant / premium routes
  if (cleanPath.includes('/suite-attendant')) {
    if (!areas.has('suite') && !areas.has('club')) {
      return { authorized: false, reason: 'Suites/Clubs area authorization required' };
    }
    return { authorized: true };
  }

  // Commissary / prep / catering routes
  if (cleanPath.includes('/commissary')) {
    if (!areas.has('catering') && !areas.has('culinary')) {
      return { authorized: false, reason: 'Catering or Commissary authorization required' };
    }
    return { authorized: true };
  }

  // Default allowed for general operational tab routes if assigned
  return { authorized: true };
}
