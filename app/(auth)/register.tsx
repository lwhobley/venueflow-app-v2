import { Redirect } from "expo-router";

export default function RegisterRedirect() {
  return <Redirect href="/(auth)/sign-in" />;
}
