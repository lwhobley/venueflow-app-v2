import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { StadiumZoneItem } from '../StadiumUnitDetailModal';
import type { StadiumZoneData } from './zone-data';
import { resolveUnitStatus } from './premium-spaces';
import {
  MOBILE_STADIUM_LEVELS,
  getMobileLevelForZone,
  getMobileLevelSpaces,
  type MobileStadiumLevelId,
} from './mobile-stadium-levels';

type Props = {
  zones: StadiumZoneData[];
  initialZoneId?: string;
  selectedUnitId: string | null;
  onSelectUnit: (unit: StadiumZoneItem) => void;
};

export function MobileStadiumNavigator({ zones, initialZoneId, selectedUnitId, onSelectUnit }: Props) {
  const [levelId, setLevelId] = useState<MobileStadiumLevelId>(() => getMobileLevelForZone(initialZoneId));
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const level = MOBILE_STADIUM_LEVELS.find((candidate) => candidate.id === levelId) ?? MOBILE_STADIUM_LEVELS[1];
  const spaces = useMemo(() => getMobileLevelSpaces(zones, levelId), [levelId, zones]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>STADIUM OPERATIONS MAP</Text>
        <Text style={styles.title}>Browse by level</Text>
        <Text style={styles.subtitle}>Choose a level, then tap a space to open its BEO, staffing and service details.</Text>
      </View>

      <View style={styles.selectorArea}>
        <Text style={styles.selectorLabel}>STADIUM LEVEL</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: levelMenuOpen }}
          accessibilityLabel={`Choose stadium level. Current selection ${level.label}`}
          onPress={() => setLevelMenuOpen((open) => !open)}
          style={({ pressed }) => [styles.selector, pressed ? styles.pressed : null]}
        >
          <View style={styles.selectorTextWrap}>
            <Text style={styles.selectorText}>{level.label}</Text>
            <Text numberOfLines={1} style={styles.selectorDescription}>{level.description}</Text>
          </View>
          <MaterialCommunityIcons name={levelMenuOpen ? 'chevron-up' : 'chevron-down'} size={24} color="#013369" />
        </Pressable>

        {levelMenuOpen ? (
          <View style={styles.levelMenu}>
            {MOBILE_STADIUM_LEVELS.map((option) => {
              const selected = option.id === levelId;
              const count = getMobileLevelSpaces(zones, option.id).length;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setLevelId(option.id);
                    setLevelMenuOpen(false);
                  }}
                  style={({ pressed }) => [styles.levelOption, selected ? styles.levelOptionSelected : null, pressed ? styles.pressed : null]}
                >
                  <View style={styles.levelOptionTextWrap}>
                    <Text style={[styles.levelOptionTitle, selected ? styles.levelOptionTitleSelected : null]}>{option.label}</Text>
                    <Text numberOfLines={1} style={styles.levelOptionDescription}>{option.description}</Text>
                  </View>
                  <Text style={[styles.levelCount, selected ? styles.levelCountSelected : null]}>{count}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <View accessibilityLabel={`Stadium diagram highlighting ${level.label}`} style={styles.modelCard}>
        <View style={styles.modelRoof} />
        {[...MOBILE_STADIUM_LEVELS].reverse().map((tier, index) => {
          const selected = tier.id === levelId;
          return (
            <View
              key={tier.id}
              style={[
                styles.modelTier,
                { width: `${82 - index * 7}%` },
                selected ? styles.modelTierSelected : null,
              ]}
            >
              <Text style={[styles.modelTierText, selected ? styles.modelTierTextSelected : null]}>
                {tier.shortLabel}
              </Text>
            </View>
          );
        })}
        <View style={styles.modelField}>
          <View style={styles.fieldLine} />
          <Text style={styles.fieldText}>{level.label.toUpperCase()}</Text>
          <View style={styles.fieldLine} />
        </View>
      </View>

      <View style={styles.listHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.listTitle}>{level.label}</Text>
          <Text style={styles.listSubtitle}>{spaces.length} service {spaces.length === 1 ? 'space' : 'spaces'}</Text>
        </View>
        <View style={styles.selectedLevelBadge}><Text style={styles.selectedLevelBadgeText}>{level.shortLabel}</Text></View>
      </View>

      <View style={styles.spaceList}>
        {spaces.map((unit) => {
          const selected = unit.id === selectedUnitId;
          const status = resolveUnitStatus(unit);
          const subtitle = unit.suiteDetails?.suiteholder ?? unit.standDetails?.concept ?? unit.stadiumZone;
          return (
            <Pressable
              key={unit.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${unit.name}. ${status.accessibilityText}`}
              onPress={() => onSelectUnit(unit)}
              style={({ pressed }) => [styles.spaceCard, selected ? styles.spaceCardSelected : null, pressed ? styles.pressed : null]}
            >
              <View style={[styles.statusDot, { backgroundColor: status.color }]} />
              <View style={styles.spaceTextWrap}>
                <View style={styles.spaceTitleRow}>
                  <Text style={styles.spaceCode}>{unit.code}</Text>
                  <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                </View>
                <Text numberOfLines={2} style={styles.spaceName}>{unit.name}</Text>
                {subtitle ? <Text numberOfLines={1} style={styles.spaceMeta}>{subtitle}</Text> : null}
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color="#6B7785" />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#D9E1E8', overflow: 'hidden' },
  header: { padding: 16, paddingBottom: 12, gap: 3 },
  eyebrow: { color: '#17643B', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#071527', fontSize: 24, lineHeight: 29, fontWeight: '800' },
  subtitle: { color: '#5E6A78', fontSize: 13, lineHeight: 18 },
  selectorArea: { paddingHorizontal: 12, paddingBottom: 12, gap: 5, zIndex: 2 },
  selectorLabel: { color: '#5E6A78', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  selector: { minHeight: 56, borderRadius: 10, borderWidth: 1.5, borderColor: '#013369', backgroundColor: '#F7FAFC', paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectorTextWrap: { flex: 1, minWidth: 0 },
  selectorText: { color: '#013369', fontSize: 15, fontWeight: '800' },
  selectorDescription: { color: '#687482', fontSize: 11, marginTop: 1 },
  levelMenu: { borderRadius: 10, borderWidth: 1, borderColor: '#C9D5E1', backgroundColor: '#FFFFFF', overflow: 'hidden' },
  levelOption: { minHeight: 52, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E4E9EE' },
  levelOptionSelected: { backgroundColor: '#EAF2FA' },
  levelOptionTextWrap: { flex: 1, minWidth: 0 },
  levelOptionTitle: { color: '#17212B', fontSize: 14, fontWeight: '700' },
  levelOptionTitleSelected: { color: '#013369', fontWeight: '900' },
  levelOptionDescription: { color: '#687482', fontSize: 10, marginTop: 1 },
  levelCount: { minWidth: 28, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 12, overflow: 'hidden', backgroundColor: '#EDF0F3', color: '#4F5C69', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  levelCountSelected: { backgroundColor: '#013369', color: '#FFFFFF' },
  modelCard: { height: 226, marginHorizontal: 12, borderRadius: 14, backgroundColor: '#07131F', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 16, gap: 5, overflow: 'hidden' },
  modelRoof: { width: '62%', height: 8, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 2, borderBottomWidth: 0, borderColor: '#56718A', marginBottom: 1 },
  modelTier: { height: 23, borderRadius: 12, borderWidth: 1, borderColor: '#365069', backgroundColor: '#10283C', alignItems: 'center', justifyContent: 'center' },
  modelTierSelected: { backgroundColor: '#00D7EA', borderColor: '#8BF5FF', transform: [{ scale: 1.04 }] },
  modelTierText: { color: '#AFC1D1', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  modelTierTextSelected: { color: '#002B3B' },
  modelField: { width: '55%', height: 42, borderRadius: 7, borderWidth: 1.5, borderColor: '#9BD5AE', backgroundColor: '#17643B', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 8, marginTop: 3 },
  fieldLine: { width: 1, height: '75%', backgroundColor: 'rgba(255,255,255,0.65)' },
  fieldText: { flex: 1, color: '#FFFFFF', fontSize: 8, fontWeight: '900', letterSpacing: 0.4, textAlign: 'center' },
  listHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 18, paddingBottom: 10 },
  listTitle: { color: '#071527', fontSize: 18, fontWeight: '800' },
  listSubtitle: { color: '#687482', fontSize: 12, marginTop: 1 },
  selectedLevelBadge: { minWidth: 44, height: 30, borderRadius: 15, backgroundColor: '#013369', alignItems: 'center', justifyContent: 'center' },
  selectedLevelBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  spaceList: { paddingHorizontal: 12, paddingBottom: 14, gap: 8 },
  spaceCard: { minHeight: 70, borderRadius: 10, borderWidth: 1, borderColor: '#DCE3E9', backgroundColor: '#FFFFFF', paddingHorizontal: 11, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  spaceCardSelected: { borderColor: '#00BFD3', borderWidth: 2, backgroundColor: '#F0FCFD' },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  spaceTextWrap: { flex: 1, minWidth: 0, gap: 2 },
  spaceTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  spaceCode: { flex: 1, color: '#013369', fontSize: 11, fontWeight: '900' },
  statusText: { fontSize: 10, fontWeight: '800' },
  spaceName: { color: '#18232D', fontSize: 13, lineHeight: 17, fontWeight: '700' },
  spaceMeta: { color: '#687482', fontSize: 10 },
  pressed: { opacity: 0.68 },
});
