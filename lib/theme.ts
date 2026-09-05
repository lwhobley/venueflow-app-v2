import { MD3DarkTheme, MD3LightTheme } from "react-native-paper";
import { create } from "zustand";

type ThemeMode = "dark" | "light";

type AppearanceState = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

export const useAppearanceStore = create<AppearanceState>((set) => ({
  mode: "light",
  setMode: (mode) => set({ mode }),
  toggleMode: () =>
    set((state) => ({ mode: state.mode === "dark" ? "light" : "dark" })),
}));

export const designPalettes = {
  dark: {
    mode: "dark" as const,
    background: "#07111F",
    backgroundAlt: "#0C1A2E",
    surface: "#0F2138",
    surfaceStrong: "#132A45",
    surfaceSoft: "#183552",
    glass: "#0F2138",
    primary: "#5B9BD5",
    secondary: "#FF5A5A",
    charcoal: "#F5F7FA",
    muted: "#9AA8BC",
    border: "#2A3F5C",
    divider: "#1E3250",
    success: "#5B9BD5",
    danger: "#FF6B6B",
    warning: "#F0B429",
    info: "#7EB6E8",
    cream: "#132A45",
    glow: "#132A45",
    shadow: "#000000",
    buttonText: "#07111F",
  },
  light: {
    mode: "light" as const,
    background: "#F4F6F9",
    backgroundAlt: "#FFFFFF",
    surface: "#FFFFFF",
    surfaceStrong: "#FFFFFF",
    surfaceSoft: "#E8EEF5",
    glass: "#FFFFFF",
    primary: "#013369",
    secondary: "#D50A0A",
    charcoal: "#0A1628",
    muted: "#5A6577",
    border: "#D0D8E4",
    divider: "#E2E8F0",
    success: "#013369",
    danger: "#D50A0A",
    warning: "#C45C12",
    info: "#2E5A8F",
    cream: "#E8EEF5",
    glow: "#E8EEF5",
    shadow: "#3A4A63",
    buttonText: "#FFFFFF",
  },
} as const;

export type DesignPalette = (typeof designPalettes)[ThemeMode];

export const useDesignTheme = () => {
  const mode = useAppearanceStore((state) => state.mode);
  return designPalettes[mode];
};

export const colors = designPalettes.light;

export const authColors = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  primary: designPalettes.light.primary,
  text: designPalettes.light.charcoal,
  muted: designPalettes.light.muted,
  border: designPalettes.light.border,
  danger: designPalettes.light.danger,
  success: designPalettes.light.success,
  buttonText: designPalettes.light.buttonText,
  highlight: designPalettes.light.surfaceSoft,
};

export const authInputProps = {
  outlineColor: authColors.border,
  activeOutlineColor: authColors.primary,
  textColor: authColors.text,
  placeholderTextColor: authColors.muted,
  style: { backgroundColor: authColors.surface },
};

// Screens index this list by fixed position (accents[0] .. accents[5]) for KPI
// tiles and callout cards, so it must keep at least six entries — a shorter
// list crashes those screens with "cannot read properties of undefined".
export const accents = [
  { bg: designPalettes.light.primary, fg: "#FFFFFF", icon: designPalettes.light.primary },
  { bg: designPalettes.light.secondary, fg: "#FFFFFF", icon: designPalettes.light.secondary },
  { bg: designPalettes.light.info, fg: "#FFFFFF", icon: designPalettes.light.info },
  { bg: designPalettes.light.warning, fg: "#FFFFFF", icon: designPalettes.light.warning },
  { bg: designPalettes.light.charcoal, fg: "#FFFFFF", icon: designPalettes.light.charcoal },
  { bg: designPalettes.light.shadow, fg: "#FFFFFF", icon: designPalettes.light.shadow },
];

/**
 * Palette for the stadium operations consoles (KDS, stand sheets, commissary,
 * runner and kiosk screens). Those run on wall-mounted kitchen displays and
 * back-of-house tablets, so they stay dark regardless of the app's light/dark
 * setting — but they were each hardcoding the same slate ramp inline, which
 * meant a dozen near-identical hex values and no single place to adjust them.
 */
export const opsConsole = {
  background: "#0F172A",
  surface: "#1E293B",
  border: "#334155",
  text: "#F8FAFC",
  textStrong: "#FFFFFF",
  muted: "#94A3B8",
  mutedDim: "#64748B",
  subtle: "#CBD5E1",
  accent: "#3B82F6",
  accentSoft: "#38BDF8",
  good: "#10B981",
  warn: "#F59E0B",
  danger: "#EF4444",
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, huge: 64,
};

export const radius = {
  sharp: 6, soft: 14, sm: 10, md: 14, lg: 18, xl: 24, pill: 999,
};

// Loaded via useFonts() in app/_layout.tsx. These string literals must match
// the keys passed there exactly, or React Native silently falls back to the
// system font with no warning.
export const fontFamily = {
  display: "Fraunces_600SemiBold",
  displayItalic: "Fraunces_600SemiBold_Italic",
  displayMedium: "Fraunces_500Medium",
} as const;

export const type = {
  micro: { fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
  label: { fontSize: 13, lineHeight: 18, letterSpacing: 0.4 },
  subtitle: { fontSize: 14, lineHeight: 20, letterSpacing: 0.1 },
  body: { fontSize: 15, lineHeight: 22, letterSpacing: 0 },
  bodyLarge: { fontSize: 17, lineHeight: 24, letterSpacing: 0 },
  heading: { fontSize: 20, lineHeight: 26, letterSpacing: -0.2, fontWeight: "700" as const },
  title: { fontSize: 28, lineHeight: 34, letterSpacing: -0.4, fontWeight: "600" as const, fontFamily: fontFamily.display },
  display: { fontSize: 40, lineHeight: 44, letterSpacing: -0.6, fontWeight: "600" as const, fontFamily: fontFamily.display },
} as const;

export const shadow = {
  shadowColor: designPalettes.light.shadow,
  shadowOpacity: 0.08, shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 }, elevation: 3,
} as const;

export const shadowSoft = {
  shadowColor: designPalettes.light.shadow,
  shadowOpacity: 0.06, shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 }, elevation: 2,
} as const;

export const shadowFloat = {
  shadowColor: designPalettes.light.shadow,
  shadowOpacity: 0.12, shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 }, elevation: 6,
} as const;

export const authCardStyle = {
  backgroundColor: "transparent", borderRadius: 16, borderWidth: 0, borderColor: "transparent",
} as const;

export const glass = {
  backgroundColor: "transparent", borderWidth: 0, borderColor: "transparent",
} as const;

export const makePaperTheme = (mode: ThemeMode) => {
  const palette = designPalettes[mode];
  const base = mode === "dark" ? MD3DarkTheme : MD3LightTheme;
  return {
    ...base,
    dark: mode === "dark",
    roundness: radius.md,
    colors: {
      ...base.colors,
      primary: palette.primary,
      secondary: palette.secondary,
      background: palette.background,
      surface: palette.surfaceStrong,
      onSurface: palette.charcoal,
      onBackground: palette.charcoal,
      outline: palette.border,
      error: palette.danger,
      elevation: {
        ...base.colors.elevation,
        level1: palette.surface,
        level2: palette.surfaceSoft,
      },
    },
  };
};

export const lightTheme = makePaperTheme("light");
export const darkTheme = makePaperTheme("dark");
