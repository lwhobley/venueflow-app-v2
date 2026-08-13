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
    // Text/icons drawn on top of `primary` fills (light-green in dark mode).
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
    // Text/icons drawn on top of `primary` fills (dark-green in light mode).
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
  background: "transparent",
  surface: "transparent",
  primary: designPalettes.dark.primary,
  text: designPalettes.dark.charcoal,
  muted: designPalettes.dark.muted,
  border: designPalettes.dark.muted,
  danger: designPalettes.dark.danger,
  success: designPalettes.dark.success,
  buttonText: designPalettes.dark.buttonText,
  highlight: "transparent",
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

// Editorial system rule: at most two radii anywhere in the UI. `sharp` is for
// nearly everything (inputs, tags, buttons, most panels); `soft` is reserved
// for the handful of surfaces that read as genuine "cards" (modals, sheets,
// the rare stat tile). The old sm/md/lg/xl/pill keys are kept so the ~50
// existing call sites don't need touching, but they now all resolve to one
// of the two allowed values.
export const radius = {
  sharp: 0,
  soft: 8,
  sm: 0,
  md: 0,
  lg: 8,
  xl: 8,
  pill: 8,
};

// The command system uses native-feeling sans typography throughout. It keeps
// dense, data-backed screens legible and avoids a different type personality
// on every tab.
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
    fontWeight: "700",
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.4,
    fontWeight: "700",
  },
  display: {
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -0.6,
    fontWeight: "700",
  },
} as const;

// No default drop shadow — surfaces are separated by hairline rules and
// whitespace, not elevation. Kept only for the rare truly-floating surface
// (a modal/sheet over content), used explicitly, never as a card default.
export const shadow = {
  shadowColor: designPalettes.light.shadow,
  shadowOpacity: 0.05,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 1,
} as const;

export const authCardStyle = {
  backgroundColor: "transparent",
  borderRadius: 0,
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
    roundness: radius.sharp,
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
