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
    background: "#172019",
    backgroundAlt: "#1D2820",
    surface: "#1D2820",
    surfaceStrong: "#243026",
    surfaceSoft: "#2A382D",
    glass: "#1D2820",
    primary: "#7ECA98",
    secondary: "#E1A853",
    charcoal: "#F7F7F4",
    muted: "#B8C2BA",
    border: "#3A493D",
    divider: "#334136",
    success: "#7ECA98",
    danger: "#F09A90",
    warning: "#E1A853",
    info: "#9FC8DB",
    cream: "#283B2D",
    glow: "#283B2D",
    shadow: "#000000",
    buttonText: "#172019",
  },
  light: {
    mode: "light" as const,
    background: "#F7F7F4",
    backgroundAlt: "#FFFFFF",
    surface: "#FFFFFF",
    surfaceStrong: "#FFFFFF",
    surfaceSoft: "#F1F2EE",
    glass: "#FFFFFF",
    primary: "#17643B",
    secondary: "#A86514",
    charcoal: "#1D2420",
    muted: "#68706A",
    border: "#DDE1DA",
    divider: "#E5E8E2",
    success: "#17643B",
    danger: "#B4483F",
    warning: "#A86514",
    info: "#4A6678",
    cream: "#EEF5F0",
    glow: "#EEF5F0",
    shadow: "#69736B",
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

export const accents = [
  { bg: "#EEF5F0", fg: "#1D2420", icon: "#17643B" },
  { bg: "#FFF4DE", fg: "#1D2420", icon: "#A86514" },
  { bg: "#EEF3F7", fg: "#1D2420", icon: "#4A6678" },
  { bg: "#F8EEE8", fg: "#1D2420", icon: "#A35E35" },
  { bg: "#F0F1E9", fg: "#1D2420", icon: "#63705A" },
  { bg: "#FBEDEC", fg: "#1D2420", icon: "#B4483F" },
] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
};

export const radius = {
  sharp: 6,
  soft: 14,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
};

export const fontFamily = {
  display: undefined,
  displayItalic: undefined,
  displayMedium: undefined,
} as const;

export const type = {
  micro: { fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
  label: { fontSize: 13, lineHeight: 18, letterSpacing: 0.4 },
  subtitle: { fontSize: 14, lineHeight: 20, letterSpacing: 0.1 },
  body: { fontSize: 15, lineHeight: 22, letterSpacing: 0 },
  bodyLarge: { fontSize: 17, lineHeight: 24, letterSpacing: 0 },
  heading: {
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.2,
    fontWeight: "700" as const,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.4,
    fontWeight: "700" as const,
  },
  display: {
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -0.6,
    fontWeight: "700" as const,
  },
} as const;

export const shadow = {
  shadowColor: designPalettes.light.shadow,
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
} as const;

export const shadowSoft = {
  shadowColor: designPalettes.light.shadow,
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
} as const;

export const shadowFloat = {
  shadowColor: designPalettes.light.shadow,
  shadowOpacity: 0.12,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 6,
} as const;

export const authCardStyle = {
  backgroundColor: "transparent",
  borderRadius: 16,
  borderWidth: 0,
  borderColor: "transparent",
} as const;

export const glass = {
  backgroundColor: "transparent",
  borderWidth: 0,
  borderColor: "transparent",
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
