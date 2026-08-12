import { Redirect } from "expo-router";

export default function JoinRedirect() {
  return <Redirect href="/(auth)/sign-in" />;
}
