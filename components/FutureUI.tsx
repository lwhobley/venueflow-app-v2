import { ReactNode } from "react";
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { DesignPalette, fontFamily, radius, shadowSoft, spacing } from "../lib/theme";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
type CommandTextVariant =
  | "hero"
  | "title"
  | "label"
  | "body"
  | "caption"
  | "metric";

export function CommandSurface({
  palette,
  children,
  style,
  strong,
  inset,
}: {
  palette: DesignPalette;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  strong?: boolean;
  inset?: boolean;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: strong
            ? palette.surface
            : inset
              ? palette.surfaceSoft
              : "transparent",
          borderWidth: strong ? StyleSheet.hairlineWidth : 0,
          borderColor: strong ? palette.border : "transparent",
          borderRadius: strong ? radius.lg : radius.md,
          padding: inset ? spacing.md : spacing.lg,
          overflow: "hidden",
          ...(strong ? shadowSoft : null),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function CommandText({
  palette,
  children,
  variant = "body",
  style,
}: {
  palette: DesignPalette;
  children: ReactNode;
  variant?: CommandTextVariant;
  style?: StyleProp<TextStyle>;
}) {
  const styles: Record<CommandTextVariant, TextStyle> = {
    hero: { color: palette.charcoal, fontSize: 30, lineHeight: 36, letterSpacing: -0.4, fontWeight: "600", fontFamily: fontFamily.display },
    title: { color: palette.charcoal, fontSize: 19, lineHeight: 25, letterSpacing: -0.2, fontWeight: "600", fontFamily: fontFamily.display },
    label: { color: palette.muted, fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
    body: { color: palette.charcoal, fontSize: 14, lineHeight: 21, fontWeight: "500" },
    caption: { color: palette.muted, fontSize: 12, lineHeight: 17, fontWeight: "500" },
    metric: { color: palette.charcoal, fontSize: 28, lineHeight: 33, letterSpacing: -0.5, fontWeight: "700" },
  };
  return <Text style={[styles[variant], style]}>{children}</Text>;
}

export function CommandButton({
  palette,
  children,
  icon,
  selected,
  onPress,
  style,
  accessibilityLabel,
}: {
  palette: DesignPalette;
  children: ReactNode;
  icon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected ? { selected: true } : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 36,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: radius.pill,
          borderWidth: selected ? 0 : StyleSheet.hairlineWidth,
          borderColor: palette.border,
          backgroundColor: selected ? palette.primary : palette.surfaceSoft,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: pressed ? 0.72 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {icon ? (
        <MaterialCommunityIcons name={icon} size={15} color={selected ? palette.buttonText : palette.muted} />
      ) : null}
      <Text numberOfLines={1} style={{ color: selected ? palette.buttonText : palette.charcoal, fontSize: 12.5, fontWeight: "600", letterSpacing: 0.1 }}>
        {children}
      </Text>
    </Pressable>
  );
}

export function StatusPill({
  palette,
  children,
  tone = "neutral",
}: {
  palette: DesignPalette;
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "danger";
}) {
  const toneColor =
    tone === "good" ? palette.success : tone === "warn" ? palette.warning : tone === "danger" ? palette.danger : palette.primary;
  return (
    <View style={{ borderRadius: radius.pill, backgroundColor: `${toneColor}18`, paddingHorizontal: 10, paddingVertical: 5, alignSelf: "flex-start" }}>
      <Text numberOfLines={1} style={{ color: toneColor, fontSize: 11, fontWeight: "700" }}>
        {children}
      </Text>
    </View>
  );
}

export function MiniTrend({ palette, values }: { palette: DesignPalette; values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: 34 }}>
      {values.map((value, index) => (
        <View
          key={`${value}-${index}`}
          style={{
            width: 6,
            height: Math.max(6, (value / max) * 34),
            borderRadius: radius.pill,
            backgroundColor: index === values.length - 1 ? palette.primary : `${palette.primary}44`,
          }}
        />
      ))}
    </View>
  );
}
