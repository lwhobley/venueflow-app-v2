import { Redirect, Tabs } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { ColorValue } from "react-native";
import { useDesignTheme } from "../../lib/theme";
import { useAuthStore, type AuthState } from "../../lib/auth-store";
import { CarouselTabBar } from "../../components/CarouselTabBar";
import { useI18n } from "../../lib/i18n";
import { useAuthenticatedSession } from "../../lib/auth-readiness";

const icon =
  (name: keyof typeof MaterialCommunityIcons.glyphMap) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <MaterialCommunityIcons name={name} size={size} color={String(color)} />
  );

export default function TabsLayout() {
  const localUser = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const fullName = localUser?.full_name ?? "Profile";
  const { t } = useI18n();
  const palette = useDesignTheme();
  useAuthenticatedSession();

  if (hydrated && !localUser) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (hydrated && localUser && !venue) {
    return <Redirect href="/(auth)/no-venue" />;
  }

  return (
    <Tabs
      tabBar={(props) => <CarouselTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: String(palette.primary),
        tabBarInactiveTintColor: String(palette.muted),
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Command", tabBarIcon: icon("view-dashboard") }}
      />
      <Tabs.Screen
        name="facility"
        options={{ title: "Stadium F&B", tabBarIcon: icon("stadium") }}
      />
      <Tabs.Screen
        name="clock"
        options={{ title: "Time Clock", tabBarIcon: icon("clock-outline") }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: "Rosters",
          tabBarIcon: icon("calendar-week"),
        }}
      />
      <Tabs.Screen
        name="guests"
        options={{
          title: "CRM",
          tabBarIcon: icon("account-heart-outline"),
        }}
      />
      <Tabs.Screen
        name="integrations"
        options={{
          title: "POS & Hardware",
          tabBarIcon: icon("connection"),
        }}
      />
      <Tabs.Screen
        name="sales"
        options={{
          title: "Concessions POS",
          tabBarIcon: icon("cash-register"),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{ title: "Event Radio", tabBarIcon: icon("chat-outline") }}
      />
      <Tabs.Screen
        name="bar-stock"
        options={{
          title: "Inventory",
          href: "/bar-stock",
          tabBarIcon: icon("clipboard-text-outline"),
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: "BEOs & Docs",
          tabBarIcon: icon("file-document-multiple-outline"),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports & Recon",
          tabBarIcon: icon("chart-box-outline"),
        }}
      />
      <Tabs.Screen
        name="staff"
        options={{
          title: "Staff & Union",
          tabBarIcon: icon("account-group"),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: fullName || t("nav.profileFallback"),
          tabBarIcon: icon("account-circle"),
        }}
      />
    </Tabs>
  );
}
