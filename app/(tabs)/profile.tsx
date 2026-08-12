import { Alert, Platform, ScrollView, View } from "react-native";
import { useState } from "react";
import { router } from "expo-router";
import { Button, Card, Text } from "react-native-paper";
import { useMutation, useQuery } from "../../lib/railway-hooks";
import { useAuthActions } from "../../lib/railway-hooks";
import { api } from "../../lib/railway-api";
import { colors, radius, spacing } from "../../lib/theme";
import { useAuthStore, type AuthState } from "../../lib/auth-store";
import { useAuthenticatedSession } from "../../lib/auth-readiness";
import { canManageBilling, canManageVenue } from "../../lib/permissions";
import { useI18n } from "../../lib/i18n";

export default function ProfileScreen() {
  const { t } = useI18n();
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const { isReady } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : "skip");
  const serverRole = me?.profile.role ?? null;
  const allAccess = me?.profile.allAccess ?? false;
  const canManage = Boolean(
    serverRole && canManageVenue(serverRole, allAccess),
  );
  const canViewBilling = Boolean(
    serverRole && canManageBilling(serverRole, allAccess),
  );
  const { signOut } = useAuthActions();
  const deleteAccount = useMutation(api.app.deleteMyAccount);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const onLogout = async () => {
    try {
      await signOut();
    } finally {
      clearSession();
      router.replace("/(auth)/sign-in");
    }
  };

  const onOpenStaff = () => {
    router.push("/(tabs)/staff");
  };

  const onOpenBilling = () => {
    router.push(Platform.OS === "web" ? "/billing" : "/billing/paywall");
  };

  const onDeleteAccount = async () => {
    setDeleting(true);
    try {
      await deleteAccount({});
      clearSession();
      router.replace("/(auth)/sign-in");
    } catch (e) {
      Alert.alert(
        t("profile.deleteError.title"),
        e instanceof Error ? e.message : t("profile.deleteError.default"),
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: spacing.xxl,
      }}
    >
      <Card
        style={{
          backgroundColor: colors.surface,
          marginBottom: spacing.md,
          borderRadius: radius.soft,
        }}
      >
        <Card.Content style={{ gap: 6 }}>
          <Text variant="headlineSmall" style={{ fontWeight: "700" }}>
            {t("profile.title")}
          </Text>
          <Text>{user?.full_name}</Text>
          <Text style={{ color: colors.muted }}>{user?.email}</Text>
          <Text style={{ color: colors.muted }}>{user?.job_title}</Text>
          <Text style={{ color: colors.muted }}>
            {venue?.name ?? t("profile.individualAccount")}
          </Text>
        </Card.Content>
      </Card>

      {canManage ? (
        <Button
          mode="contained"
          buttonColor={colors.primary}
          onPress={onOpenStaff}
          style={{ marginBottom: spacing.sm }}
        >
          {t("profile.manageStaff")}
        </Button>
      ) : null}

      {canManage ? (
        <Button
          mode="outlined"
          textColor={colors.primary}
          icon="map-marker-radius"
          onPress={() => router.push("/venue/settings")}
          style={{ marginBottom: spacing.sm }}
        >
          {t("profile.venueLocation")}
        </Button>
      ) : null}

      {canViewBilling ? (
        <Button
          mode="outlined"
          textColor={colors.primary}
          onPress={onOpenBilling}
          style={{ marginBottom: spacing.sm }}
        >
          {t("profile.billing")}
        </Button>
      ) : null}

      <Button
        mode="outlined"
        textColor={colors.primary}
        icon="notebook-outline"
        onPress={() => router.push("/logbook")}
        style={{ marginBottom: spacing.sm }}
      >
        {t("profile.shiftLogbook")}
      </Button>

      <Button
        mode="outlined"
        textColor={colors.primary}
        icon="clipboard-check-outline"
        onPress={() => router.push("/checklist")}
        style={{ marginBottom: spacing.sm }}
      >
        {t("profile.checklist")}
      </Button>

      <Button
        mode="outlined"
        textColor={colors.primary}
        icon="help-circle-outline"
        onPress={() => router.push("/help")}
        style={{ marginBottom: spacing.sm }}
      >
        {t("profile.helpGuide")}
      </Button>

      <Button
        mode="outlined"
        textColor={colors.primary}
        onPress={onLogout}
        style={{ marginBottom: spacing.sm }}
      >
        {t("profile.signOut")}
      </Button>

      <Card
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.soft,
          marginTop: spacing.md,
        }}
      >
        <Card.Content style={{ gap: spacing.sm }}>
          <Text
            variant="titleMedium"
            style={{ fontWeight: "800", color: colors.danger }}
          >
            {t("profile.accountDeletion.title")}
          </Text>
          <Text style={{ color: colors.muted }}>
            {t("profile.accountDeletion.description")}
          </Text>
          {!confirmDelete ? (
            <Button
              mode="outlined"
              textColor={colors.danger}
              icon="delete-outline"
              onPress={() => setConfirmDelete(true)}
            >
              {t("profile.accountDeletion.startButton")}
            </Button>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <Text style={{ color: colors.danger, fontWeight: "700" }}>
                {t("profile.accountDeletion.confirmWarning")}
              </Text>
              <Button
                mode="contained"
                buttonColor={colors.danger}
                icon="delete-forever-outline"
                loading={deleting}
                disabled={deleting}
                onPress={() => void onDeleteAccount()}
              >
                {t("profile.accountDeletion.confirmButton")}
              </Button>
              <Button
                mode="text"
                textColor={colors.primary}
                disabled={deleting}
                onPress={() => setConfirmDelete(false)}
              >
                {t("profile.accountDeletion.cancelButton")}
              </Button>
            </View>
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}
