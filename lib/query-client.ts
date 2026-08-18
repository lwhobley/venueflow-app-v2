import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

// useQuery() in railway-hooks.ts returns only `query.data`, by design (every
// screen treats loading/error the same way: undefined). That means a failed
// query — a stale/renamed route, a 404, a permissions error — previously left
// no trace anywhere: the screen just showed its loading or empty state
// forever, with nothing in the console to explain why. Logging every query
// and mutation failure here, once, at the client level, doesn't change what
// any screen renders, but it turns "this screen doesn't load, no idea why"
// into an inspectable error the moment it happens.
function logQueryFailure(kind: 'query' | 'mutation', key: unknown, error: unknown) {
  console.warn(`[${kind} failed] ${JSON.stringify(key)}:`, error instanceof Error ? error.message : error);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => logQueryFailure('query', query.queryKey, error),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => logQueryFailure('mutation', mutation.options.mutationKey, error),
  }),
  defaultOptions: {
    queries: {
      staleTime: 10000,
      gcTime: 300000,
    },
  },
});
