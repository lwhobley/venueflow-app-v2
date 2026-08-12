import { Image, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Button, Card, Text } from "react-native-paper";
import { authCardStyle, authColors, spacing, type } from "../../lib/theme";
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
        <Image source={logoSource} style={styles.logo} />
        <Card style={styles.card}>
          <Card.Content style={styles.cardContent}>
            <Text style={styles.kicker}>ACCOUNT AUTHENTICATED</Text>
            <Text style={styles.title}>No venue assigned</Text>
            <Text style={styles.body}>
              Your PIN is valid, but this account is not assigned to a stadium
              or arena. Ask an organization administrator to assign a venue
              before signing in again.
            </Text>
            <Button
              mode="contained"
              buttonColor={authColors.primary}
              textColor={authColors.buttonText}
              onPress={returnToSignIn}
            >
              Return to sign in
            </Button>
          </Card.Content>
        </Card>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: authColors.background },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.xl,
  },
  logo: {
    width: "100%",
    maxWidth: 340,
    height: 186,
    resizeMode: "contain",
  },
  card: { ...authCardStyle, width: "100%", maxWidth: 480 },
  cardContent: { alignItems: "center", gap: spacing.lg },
  kicker: {
    ...type.micro,
    color: authColors.muted,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  title: { ...type.title, color: authColors.text, textAlign: "center" },
  body: {
    ...type.body,
    color: authColors.text,
    textAlign: "center",
    maxWidth: 420,
  },
});
