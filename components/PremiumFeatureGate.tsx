import React from 'react';

// Wraps premium-only features (Integrations, CRM). Intro access unlocks these
// features until it expires; after that the user must upgrade. When billing is
// disabled (local/dev builds) the feature is always unlocked.
export function PremiumFeatureGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { me, isAuthLoading } = useAuthenticatedSession();
  const { isPremium, isLoading } = useA0Purchases();
  const allAccess = hasAllAccess(me?.profile?.allAccess);

  // Avoid flashing the upsell while entitlement or profile is still resolving.
  if (isLoading || isAuthLoading || me === undefined) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  const trial = getTrialState(me?.profile?.trialEndsAt ?? null);
  if (!config.billingEnabled || allAccess || isPremium || trial.active) {
    return <>{children}</>;
  }

  const headline = 'Intro access has ended';
  const body = `Upgrade to a paid plan to unlock ${feature} and the rest of Venue Wrangler.`;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, flexGrow: 1, justifyContent: 'center' }}>
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm, alignItems: 'center' }}>
          <Text variant="headlineSmall" style={{ fontWeight: '800', color: colors.primary, textAlign: 'center' }}>{headline}</Text>
          <Text style={{ color: colors.muted, textAlign: 'center' }}>{body}</Text>
          <Button
            mode="contained"
            buttonColor={colors.primary}
            icon="lock-open-variant"
            style={{ marginTop: spacing.sm }}
            onPress={() => router.push(Platform.OS === 'web' ? '/billing' : '/billing/paywall')}
          >
            Upgrade now
          </Button>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

