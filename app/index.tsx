import { Redirect } from "expo-router";
import { useAuthStore, type AuthState } from "../lib/auth-store";

export default function Index() {
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);

  if (!hydrated) {
    return null;
  }

  // Stadium Wrangler is provisioned by an administrator: staff sign in with
  // their assigned email and six-digit PIN. There is no public onboarding.
  const href = !user
    ? "/(auth)/sign-in"
    : !venue
      ? "/(auth)/no-venue"
      : "/(tabs)/home";
  return <Redirect href={href} />;
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
