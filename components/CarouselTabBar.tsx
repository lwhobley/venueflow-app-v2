import type { ComponentProps } from 'react';
import type { Tabs } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDesignTheme } from '../lib/theme';
import { useResponsive } from '../lib/responsive';

type ExpoTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
type TabRoute = ExpoTabBarProps['state']['routes'][number];

const phoneLabels: Record<string, string> = {
  integrations: 'Hardware',
  sales: 'POS',
  chat: 'Radio',
  documents: 'Docs',
  reports: 'Reports',
  staff: 'Staff',
  profile: 'Profile',
};

export function CarouselTabBar({ state, descriptors, navigation }: ExpoTabBarProps) {
  const insets = useSafeAreaInsets();
  const palette = useDesignTheme();
  const { isPhone } = useResponsive();

  const visible = state.routes.filter((route: TabRoute) => {
    const { options } = descriptors[route.key];
    return (options as { href?: string | null }).href !== null;
  });

  return (
    <View
      style={{
        backgroundColor: palette.backgroundAlt,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.divider,
        paddingBottom: insets.bottom,
      }}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, alignItems: 'center' }}>
        {visible.map((route: TabRoute) => {
          const { options } = descriptors[route.key];
          const activeIndex = state.routes.findIndex((r: TabRoute) => r.key === route.key);
          const isFocused = state.index === activeIndex;
          const color = isFocused ? palette.primary : palette.muted;
          const label = (options.title ?? route.name) as string;
          const displayLabel = isPhone ? phoneLabels[route.name] ?? label : label;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Pressable key={route.key} onPress={onPress} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={isFocused ? { selected: true } : {}} style={{ minWidth: isPhone ? 56 : 66, paddingTop: 9, paddingBottom: 7, paddingHorizontal: 8, marginHorizontal: 3, alignItems: 'center', gap: 3, borderBottomWidth: 2, borderBottomColor: isFocused ? palette.primary : 'transparent' }}>
              {options.tabBarIcon?.({ focused: isFocused, color, size: 21 })}
              <Text numberOfLines={1} style={{ color, fontSize: 10.5, fontWeight: isFocused ? '700' : '500', letterSpacing: 0.1 }}>{displayLabel}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
