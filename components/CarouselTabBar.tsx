import type { ComponentProps } from 'react';
import type { Tabs } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDesignTheme } from '../lib/theme';
import { useResponsive } from '../lib/responsive';
import { useI18n } from '../lib/i18n';

type ExpoTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
type TabRoute = ExpoTabBarProps['state']['routes'][number];

export function CarouselTabBar({ state, descriptors, navigation }: ExpoTabBarProps) {
  const insets = useSafeAreaInsets();
  const palette = useDesignTheme();
  const { isPhone } = useResponsive();
  const { t } = useI18n();

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
        paddingBottom: Math.max(insets.bottom, 6),
        paddingTop: 4,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, alignItems: 'center', gap: 2 }}
      >
        {visible.map((route: TabRoute) => {
          const { options } = descriptors[route.key];
          const activeIndex = state.routes.findIndex((r: TabRoute) => r.key === route.key);
          const isFocused = state.index === activeIndex;
          const color = isFocused ? palette.primary : palette.muted;
          const label = (options.title ?? route.name) as string;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={isFocused ? { selected: true } : {}}
              style={{
                minWidth: isPhone ? 58 : 68,
                paddingTop: 8,
                paddingBottom: 8,
                paddingHorizontal: 10,
                marginHorizontal: 2,
                alignItems: 'center',
                gap: 3,
                borderRadius: 14,
                backgroundColor: isFocused ? `${palette.primary}14` : 'transparent',
              }}
            >
              {options.tabBarIcon?.({ focused: isFocused, color, size: 21 })}
              <Text
                numberOfLines={1}
                style={{ color, fontSize: 10.5, fontWeight: isFocused ? '700' : '500', letterSpacing: 0.1 }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
        <View style={{ paddingHorizontal: 16, alignItems: 'flex-start', justifyContent: 'center', minHeight: 54 }}>
          <Text style={{ color: palette.charcoal, fontWeight: '700', fontSize: 13 }}>
            {t('common.venueWrangler')}
          </Text>
          <Text style={{ color: palette.muted, fontSize: 9, fontStyle: 'italic' }}>{t('common.loungeability')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}
