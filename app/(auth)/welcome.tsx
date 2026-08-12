import { Redirect } from "expo-router";

export default function WelcomeRedirect() {
  return <Redirect href="/(auth)/sign-in" />;
}
