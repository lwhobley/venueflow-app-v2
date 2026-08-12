import { Redirect } from "expo-router";

export default function InviteCheckRedirect() {
  return <Redirect href="/(auth)/sign-in" />;
}
