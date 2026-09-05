import { Redirect } from 'expo-router';


export default function CreateVenueScreen() {
  return <Redirect href="/(auth)/invite-check" />;
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
