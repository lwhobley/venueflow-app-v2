import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';
import { spacing } from './theme';

/** Phone-first content width (iPhone SE–Pro Max class). */
export const PHONE_BREAKPOINT = 480;
/** Tablet portrait / large phone landscape. */
export const TABLET_BREAKPOINT = 768;
/** Desktop web shell. */
export const DESKTOP_BREAKPOINT = 900;
export const DESKTOP_CONTENT_MAX_WIDTH = 840;

export type LayoutSize = 'phone' | 'tablet' | 'desktop';

export type ResponsiveInfo = {
  width: number;
  height: number;
  size: LayoutSize;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isMobile: boolean;
  pagePadding: number;
  tileMinWidth: number;
  preferListFirst: boolean;
};

export function useResponsive(): ResponsiveInfo {
  const { width, height } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
  const isTablet = !isDesktop && width >= TABLET_BREAKPOINT;
  const isPhone = !isDesktop && !isTablet;
  const isMobile = width < 800;
  const size: LayoutSize = isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone';

  return {
    width,
    height,
    size,
    isPhone,
    isTablet,
    isDesktop,
    isMobile,
    pagePadding: isPhone ? spacing.md : isTablet ? spacing.lg : spacing.xl,
    tileMinWidth: isPhone ? 148 : 160,
    preferListFirst: isPhone,
  };
}

export function useIsDesktop() {
  const { isDesktop } = useResponsive();
  return isDesktop;
}

export function useIsMobile() {
  const { isMobile } = useResponsive();
  return isMobile;
}

export function useDesktopContentStyle(base: ViewStyle = {}) {
  const { isDesktop, pagePadding } = useResponsive();
  return {
    ...base,
    padding: isDesktop ? spacing.xl : (base.padding ?? pagePadding),
    paddingBottom: isDesktop ? spacing.xxl : base.paddingBottom,
    width: '100%' as const,
    maxWidth: isDesktop ? base.maxWidth ?? DESKTOP_CONTENT_MAX_WIDTH : base.maxWidth,
    alignSelf: 'center' as const,
  };
}

export function useActionGridStyle(): ViewStyle {
  const { isPhone } = useResponsive();
  return {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: isPhone ? spacing.sm : spacing.md,
  };
}
