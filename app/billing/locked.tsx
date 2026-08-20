import { Linking, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Text } from 'react-native-paper';
import { colors, spacing, type, authCardStyle } from '../../lib/theme';
import { Kicker } from '../../components/AppCard';
import { config } from '../../lib/config';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { canManageBilling } from '../../lib/permissions';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { useI18n } from '../../lib/i18n';

const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

export default function BillingLockedScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ reason?: string }>();
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { me } = useAuthenticatedSession();
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason ?? 'never_subscribed';
  const canPay = Boolean(me?.profile && canManageBilling(me.profile.role, me.profile.allAccess));
  const headlineByReason: Record<string, string> = {
    trial_expired: t('billingLocked.headlineTrialExpired'),
    trial_active: t('billingLocked.headlineTrialActive'),
    payment_failed: t('billingLocked.headlinePaymentFailed'),
    cancelled: t('billingLocked.headlineCancelled'),
    never_subscribed: t('billingLocked.headlineNeverSubscribed'),
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center' }}>
        <View style={{ ...authCardStyle, padding: spacing.lg, gap: spacing.sm }}>
          <Kicker>{t('billingLocked.kicker')}</Kicker>
          <Text style={{ ...type.title, color: colors.charcoal }}>{headlineByReason[reason] ?? headlineByReason.never_subscribed}</Text>
          <Text style={{ color: colors.muted }}>{t('billingLocked.reactivateBody')}</Text>
          <Text style={{ color: colors.muted }}>{t('billingLocked.venueLabel', { venue: venue?.name ?? t('billingLocked.noVenueSelected') })}</Text>
          <Text style={{ color: colors.muted }}>{t('billingLocked.signedInAs', { email: user?.email ?? t('billingLocked.unknownEmail') })}</Text>

          <Text style={{ ...type.heading, color: colors.charcoal, marginTop: spacing.sm }}>{t('billingLocked.subscribeHeading')}</Text>
          <Text style={{ color: colors.muted }}>
            Choose Single Venue Standard ($99.99/mo) or Multi-Venue Pro ($399.00/mo for up to 5 venues) to activate your account.
          </Text>

          {!config.billingEnabled ? (
            <>
              <Text style={{ color: colors.muted }}>{t('billingLocked.billingDisabledBody')}</Text>
              <Button mode="contained" buttonColor={colors.primary} onPress={() => router.replace('/(tabs)/home')}>
                {t('billingLocked.backToApp')}
              </Button>
            </>
          ) : canPay ? (
            <>
              <Button mode="contained" buttonColor={colors.primary} onPress={() => router.push('/billing/paywall')}>
                {t('billingLocked.subscribe')}
              </Button>
              <Button mode="outlined" textColor={colors.primary} onPress={() => void Linking.openURL(APPLE_SUBSCRIPTIONS_URL)}>
                {t('billingLocked.manageSubscription')}
              </Button>
            </>
          ) : (
            <Text style={{ color: colors.muted }}>{t('billingLocked.inactiveNotice')}</Text>
          )}

          <Button mode="text" textColor={colors.primary} onPress={() => router.replace('/(auth)/welcome')}>
            {t('billingLocked.signOut')}
          </Button>
          <Button mode="text" textColor={colors.primary} onPress={() => Linking.openURL('mailto:support@venuewrangler.com')}>
            {t('billingLocked.contactSupport')}
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}
