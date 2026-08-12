import { Redirect } from "expo-router";

export default function InviteAcceptRedirect() {
  return <Redirect href="/(auth)/sign-in" />;
}
