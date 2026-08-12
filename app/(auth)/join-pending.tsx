import { Redirect } from "expo-router";

export default function JoinPendingRedirect() {
  return <Redirect href="/(auth)/sign-in" />;
}
