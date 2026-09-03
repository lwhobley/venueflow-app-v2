import { Redirect } from "expo-router";
import { useAuthStore, type AuthState } from "../lib/auth-store";
import { useWorkspaceResolution } from "../lib/workspace-routing";

export default function Index() {
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { data: workspace, isLoading } = useWorkspaceResolution();

  if (!hydrated) {
    return null;
  }

  if (!user) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!venue) {
    return <Redirect href="/(auth)/no-venue" />;
  }

  // Wait for department workspace resolution
  if (isLoading) {
    return null;
  }

  // If user is not assigned to a department and has no broad admin bypass,
  // land on department-required screen
  if (workspace && !workspace.assigned) {
    return <Redirect href="/department-required" />;
  }

  const landingRoute = workspace?.defaultRoute ?? "/(tabs)/home";
  return <Redirect href={landingRoute as any} />;
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
