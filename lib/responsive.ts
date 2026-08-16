import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';

export const BREAKPOINTS = {
  phone: 0,
  phablet: 480,
  tablet: 768,
  desktop: 1024,
  wide: 1280,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  if (width >= BREAKPOINTS.wide) return 'wide';
  if (width >= BREAKPOINTS.desktop) return 'desktop';
  if (width >= BREAKPOINTS.tablet) return 'tablet';
  if (width >= BREAKPOINTS.phablet) return 'phablet';
  return 'phone';
}

export function useIsDesktop() {
  const bp = useBreakpoint();
  return bp === 'desktop' || bp === 'wide';
}

export function useIsTabletOrLarger() {
  const bp = useBreakpoint();
  return bp === 'tablet' || bp === 'desktop' || bp === 'wide';
}

export function useContentMaxWidth(max = 1120): ViewStyle {
  const { width } = useWindowDimensions();
  if (width < BREAKPOINTS.tablet) return {};
  return {
    width: '100%',
    maxWidth: max,
    alignSelf: 'center',
  };
}

export function useGutters(base = 16): number {
  const bp = useBreakpoint();
  if (bp === 'wide' || bp === 'desktop') return base * 2;
  if (bp === 'tablet') return base * 1.5;
  return base;
}

export const webOnly = Platform.OS === 'web';
