import { useState } from "react";
import {
  Alert,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { Button, Text, TextInput } from "react-native-paper";
import { appApi } from "../../lib/api-client";
import { authColors, spacing, type } from "../../lib/theme";
import { Kicker } from "../../components/AppCard";
import { useAuthStore, type AuthState } from "../../lib/auth-store";

const logoSource = require("../../assets/stadium-wrangler-logo.png");
const turfSource = require("../../assets/stadium-turf-texture.png");

export default function SignInScreen() {
  const setSession = useAuthStore((state: AuthState) => state.setSession);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@") || !/^\d{6}$/.test(pin)) {
      const message =
        "Enter the email assigned by your administrator and your six-digit access PIN.";
      setFormError(message);
      Alert.alert("Check your access details", message);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      clearSession();
      const { profile, venue, token } = await appApi.pinAuth({
        email: normalizedEmail,
        pin,
        flow: "signIn",
      });
      setSession({
        user: {
          id: profile._id,
          email: profile.email,
          full_name: profile.fullName,
          email_verified: profile.emailVerified === true,
          role: profile.role,
          job_title: profile.jobTitle,
          venue_id: profile.venueId ?? null,
          all_access: profile.allAccess === true,
        },
        venue: venue
          ? {
              id: venue._id,
              name: venue.name,
              latitude: venue.latitude,
              longitude: venue.longitude,
              geofence_radius_m: venue.geofenceRadiusM,
            }
          : null,
        token,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(venue ? "/(tabs)/home" : "/(auth)/no-venue");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to sign in. Please try again.";
      setFormError(message);
      Alert.alert("Sign in failed", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ImageBackground source={turfSource} resizeMode="cover" style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.branding}>
            <Image source={logoSource} style={styles.logo} />
            <Kicker>Stadium F&B operations</Kicker>
            <Text
              style={{
                ...type.title,
                color: authColors.text,
                textAlign: "center",
              }}
            >
              Administrator Access
            </Text>
            <Text variant="bodyMedium" style={styles.subtitle}>
              Administrator access only. Sign in with your assigned email and
              six-digit PIN.
            </Text>
          </View>

          <View style={styles.form}>
            {formError ? (
              <Text selectable style={styles.error}>
                {formError}
              </Text>
            ) : null}
            <TextInput
              label="Administrator email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              mode="outlined"
              outlineColor={authColors.border}
              activeOutlineColor={authColors.primary}
              textColor={authColors.text}
              placeholderTextColor={authColors.muted}
              style={styles.input}
            />
            <TextInput
              label="Six-digit administrator PIN"
              value={pin}
              onChangeText={(value) =>
                setPin(value.replace(/\D/g, "").slice(0, 6))
              }
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              mode="outlined"
              outlineColor={authColors.border}
              activeOutlineColor={authColors.primary}
              textColor={authColors.text}
              style={styles.input}
            />
            <Button
              mode="contained"
              buttonColor={authColors.primary}
              textColor={authColors.buttonText}
              loading={submitting}
              onPress={() => void submit()}
            >
              Enter Stadium Wrangler
            </Button>
          </View>

          <Text selectable style={styles.help}>
            Need administrator access or a new PIN? Contact the venue owner.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: "center",
    gap: spacing.xl,
    padding: spacing.lg,
  },
  branding: { alignItems: "center", gap: spacing.sm },
  logo: {
    width: "100%",
    maxWidth: 340,
    aspectRatio: 1024 / 559,
    resizeMode: "contain",
  },
  subtitle: { color: authColors.muted, textAlign: "center", maxWidth: 360 },
  form: { gap: spacing.md },
  input: { backgroundColor: "rgba(9, 57, 29, 0.18)" },
  error: { color: "#FFE1D9", textAlign: "center" },
  help: { color: authColors.muted, fontSize: 13, textAlign: "center" },
});
