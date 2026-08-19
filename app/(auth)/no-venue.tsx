import { Image, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Button, Text } from "react-native-paper";
import { authColors, spacing, type } from "../../lib/theme";
import { useAuthStore, type AuthState } from "../../lib/auth-store";


const logoSource = require("../../assets/stadium-wrangler-logo.png");

export default function NoVenueScreen() {
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);

  const returnToSignIn = () => {
    clearSession();
    router.replace("/(auth)/sign-in");
  };

  return (
    <View style={styles.page}>
      <View style={styles.content}>
        <View style={styles.card}>
          <Image source={logoSource} style={styles.logo} />
          <Text style={styles.kicker}>ACCOUNT AUTHENTICATED</Text>
          <Text style={styles.title}>No venue assigned</Text>
          <Text style={styles.body}>
            Your PIN is valid, but this account is not assigned to a stadium or
            arena. Ask an organization administrator to assign a venue before
            signing in again.
          </Text>
          <Button
            mode="contained"
            buttonColor={authColors.primary}
            textColor={authColors.buttonText}
            onPress={returnToSignIn}
            style={styles.btn}
            contentStyle={{ height: 48 }}
          >
            Return to sign in
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    alignItems: "center",
    gap: spacing.lg,
  },
  logo: {
    width: "100%",
    maxWidth: 340,
    height: 186,
    resizeMode: "contain",
  },
  kicker: {
    ...type.micro,
    color: authColors.muted,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  title: { ...type.title, color: authColors.text, textAlign: "center" },
  body: {
    ...type.body,
    color: authColors.muted,
    textAlign: "center",
    maxWidth: 420,
    lineHeight: 22,
  },
  btn: {
    borderRadius: 8,
    width: "100%",
    maxWidth: 280,
  },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
