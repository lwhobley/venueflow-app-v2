import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { appApi } from '../../lib/api-client';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { authCardStyle, authColors as colors, authInputProps as inputProps, spacing, type } from '../../lib/theme';
import { Kicker } from '../../components/AppCard';
import { useI18n } from '../../lib/i18n';


export default function VerifyEmailScreen() {
  const { t } = useI18n();
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const user = useAuthStore((state: AuthState) => state.user);
  const setSession = useAuthStore((state: AuthState) => state.setSession);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const token = useAuthStore((state: AuthState) => state.token);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const verify = async () => {
    if (!code.trim()) {
      Alert.alert(t('verifyEmail.codeRequiredTitle'), t('verifyEmail.codeRequiredMessage'));
      return;
    }
    setSubmitting(true);
    try {
      await appApi.verifyEmail({ code: code.trim() });
      const redemption = typeof invite === 'string' && invite
        ? await appApi.redeemInvite(invite)
        : await appApi.redeemMyInvite();
      if (redemption.redeemed && redemption.profile) {
        setSession({
          user: {
            id: redemption.profile._id,
            email: redemption.profile.email,
            full_name: redemption.profile.fullName,
            email_verified: true,
            role: redemption.profile.role,
            job_title: redemption.profile.jobTitle,
            venue_id: redemption.profile.venueId ?? null,
            all_access: redemption.profile.allAccess === true,
          },
          venue: redemption.venue
            ? {
                id: redemption.venue._id,
                name: redemption.venue.name,
                latitude: redemption.venue.latitude,
                longitude: redemption.venue.longitude,
                geofence_radius_m: redemption.venue.geofenceRadiusM,
              }
            : null,
          token,
        });
        const venueName = redemption.venue?.name;
        if (venueName) {
          Alert.alert(
            t('verifyEmail.welcomeTitle'),
            t('verifyEmail.welcomeMessage', { venueName }),
            [{ text: t('verifyEmail.getStarted'), onPress: () => router.replace('/(tabs)/home') }],
          );
        } else {
          router.replace('/(tabs)/home');
        }
        return;
      }
      if (user) {
        setSession({
          user: { ...user, email_verified: true },
          venue,
          token,
        });
      }
      router.replace(venue ? '/(tabs)/home' : '/(auth)/team-choice');
    } catch (error) {
      Alert.alert(t('verifyEmail.verifyFailedTitle'), error instanceof Error ? error.message : t('verifyEmail.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      await appApi.resendVerification();
      Alert.alert(t('verifyEmail.resendSuccessTitle'), t('verifyEmail.resendSuccessMessage', { email: user?.email ?? t('verifyEmail.defaultEmail') }));
    } catch (error) {
      Alert.alert(t('verifyEmail.resendFailedTitle'), error instanceof Error ? error.message : t('verifyEmail.tryAgain'));
    } finally {
      setResending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
        <View style={{ gap: 6, alignItems: 'center' }}>
          <Kicker>{t('verifyEmail.kicker')}</Kicker>
          <Text style={{ ...type.title, color: colors.text, textAlign: 'center' }}>
            {t('verifyEmail.title')}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
            {t('verifyEmail.subtitle', { email: user?.email ?? t('verifyEmail.defaultEmail') })}
          </Text>
        </View>

        <Card style={styles.card}>
          <Card.Content style={{ gap: spacing.md }}>
            <TextInput
              {...inputProps}
              label={t('verifyEmail.codeLabel')}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoCapitalize="none"
              mode="outlined"
              maxLength={8}
              returnKeyType="go"
              onSubmitEditing={() => void verify()}
            />

            <Button mode="contained" buttonColor={colors.primary} textColor={colors.buttonText} loading={submitting} onPress={() => void verify()}>
              {t('verifyEmail.verifyButton')}
            </Button>
            <Button mode="text" textColor={colors.primary} loading={resending} onPress={() => void resend()}>
              {t('verifyEmail.resendButton')}
            </Button>
          </Card.Content>
        </Card>

        <Button
          mode="text"
          textColor={colors.muted}
          onPress={() => {
            clearSession();
            router.replace('/(auth)/welcome');
          }}
        >
          {t('verifyEmail.signOut')}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: {
    ...authCardStyle,
  },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
