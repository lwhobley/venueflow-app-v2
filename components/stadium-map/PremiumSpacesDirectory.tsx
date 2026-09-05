import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { StadiumZoneItem } from '../StadiumUnitDetailModal';
import {
  type PremiumSpaceGroup,
  type PremiumStatusTone,
  resolveUnitStatus,
} from './premium-spaces';
import { styles } from './StadiumVenueMap.styles';

export interface PremiumSpacesDirectoryProps {
  groups: PremiumSpaceGroup[];
  expandedGroupId: string | null;
  onToggleGroup: (groupId: string) => void;
  onSelectUnit: (unit: StadiumZoneItem) => void;
  selectedUnitId?: string | null;
  searchQuery?: string;
  showTitle?: boolean;
}

function getStatusBadgeStyle(tone: PremiumStatusTone): { bg: string; text: string; border: string } {
  switch (tone) {
    case 'good':
      return { bg: '#E8F5E9', text: '#1B5E20', border: '#C8E6C9' };
    case 'warn':
      return { bg: '#FFF3E0', text: '#E65100', border: '#FFE0B2' };
    case 'danger':
      return { bg: '#FFEBEE', text: '#C62828', border: '#FFCDD2' };
    case 'info':
      return { bg: '#E1F5FE', text: '#0277BD', border: '#B3E5FC' };
    case 'neutral':
    default:
      return { bg: '#F5F5F5', text: '#616161', border: '#E0E0E0' };
  }
}

export function PremiumSpacesDirectory({
  groups,
  expandedGroupId,
  onToggleGroup,
  onSelectUnit,
  selectedUnitId,
  searchQuery,
  showTitle = true,
}: PremiumSpacesDirectoryProps) {
  const normalizedQuery = (searchQuery ?? '').trim().toLowerCase();

  // Filter units by search query if supplied
  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return groups;

    return groups
      .map((grp) => {
        const matchingUnits = grp.units.filter((u) => {
          const codeMatch = u.code.toLowerCase().includes(normalizedQuery);
          const nameMatch = u.name.toLowerCase().includes(normalizedQuery);
          const holderMatch = Boolean(
            u.suiteDetails?.suiteholder &&
              u.suiteDetails.suiteholder.toLowerCase().includes(normalizedQuery),
          );
          const conceptMatch = Boolean(
            u.standDetails?.concept &&
              u.standDetails.concept.toLowerCase().includes(normalizedQuery),
          );
          return codeMatch || nameMatch || holderMatch || conceptMatch;
        });

        const alertCount = matchingUnits.reduce((acc, u) => {
          return resolveUnitStatus(u).label === 'Attention' ? acc + 1 : acc;
        }, 0);

        return {
          ...grp,
          units: matchingUnits,
          alertCount,
        };
      })
      .filter((grp) => grp.units.length > 0);
  }, [groups, normalizedQuery]);

  const totalSpaces = useMemo(() => {
    return filteredGroups.reduce((sum, g) => sum + g.units.length, 0);
  }, [filteredGroups]);

  if (filteredGroups.length === 0) {
    return null;
  }

  return (
    <View style={styles.premiumDirectoryContainer}>
      {showTitle ? (
        <View style={styles.premiumDirectoryHeader}>
          <View style={styles.premiumDirectoryTitleRow}>
            <MaterialCommunityIcons name="glass-cocktail" size={16} color="#8A5D23" />
            <Text style={styles.premiumDirectoryTitle}>PREMIUM SPACES DIRECTORY</Text>
          </View>
          <View style={styles.premiumDirectoryTotalBadge}>
            <Text style={styles.premiumDirectoryTotalText}>{totalSpaces} Spaces</Text>
          </View>
        </View>
      ) : null}

      {filteredGroups.map((group) => {
        const isExpanded = expandedGroupId === group.id;

        return (
          <View key={group.id} style={styles.premiumGroupCard}>
            {/* Expandable Group Header (48-52 dp touch target) */}
            <Pressable
              onPress={() => onToggleGroup(group.id)}
              accessibilityRole="button"
              // accessibilityState covers native; react-native-web only
              // reflects the aria prop, so both are needed for screen readers.
              accessibilityState={{ expanded: isExpanded }}
              aria-expanded={isExpanded}
              accessibilityLabel={`${group.title}, ${group.units.length} spaces${group.alertCount > 0 ? `, ${group.alertCount} alerts` : ''}`}
              style={({ pressed }) => [
                styles.premiumGroupHeader,
                isExpanded ? styles.premiumGroupHeaderExpanded : null,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={styles.premiumGroupLeft}>
                <MaterialCommunityIcons
                  name={isExpanded ? 'chevron-down' : 'chevron-right'}
                  size={18}
                  color={isExpanded ? '#8A5D23' : '#68706A'}
                />
                <MaterialCommunityIcons
                  name={group.icon}
                  size={18}
                  color={isExpanded ? '#8A5D23' : '#013369'}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.premiumGroupTitle,
                    isExpanded ? { color: '#8A5D23' } : null,
                  ]}
                >
                  {group.title}
                </Text>
              </View>

              <View style={styles.premiumGroupRight}>
                {group.alertCount > 0 ? (
                  <View style={styles.premiumGroupAlertBadge}>
                    <Text style={styles.premiumGroupAlertText}>
                      {group.alertCount} {group.alertCount === 1 ? 'alert' : 'alerts'}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.premiumGroupCountBadge}>
                  <Text style={styles.premiumGroupCountText}>{group.units.length}</Text>
                </View>
              </View>
            </Pressable>

            {/* Collapsible Units Sublist */}
            {isExpanded ? (
              <View style={styles.premiumUnitsList}>
                {group.units.map((unit) => {
                  const isSelected = selectedUnitId === unit.id;
                  const statusInfo = resolveUnitStatus(unit);
                  const statusColors = getStatusBadgeStyle(statusInfo.tone);

                  // Formatting clean title: if title is "Suite 301 · Sponsor", show Suite 301
                  const shortName = unit.name.includes('·')
                    ? unit.name.split('·')[0]?.trim() || unit.name
                    : unit.name;

                  const subtitle =
                    unit.suiteDetails?.suiteholder ??
                    unit.suiteDetails?.tier ??
                    unit.standDetails?.concept ??
                    unit.stadiumZone;

                  return (
                    <Pressable
                      key={unit.id}
                      onPress={() => onSelectUnit(unit)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${unit.name}, status ${statusInfo.label}`}
                      style={({ pressed }) => [
                        styles.premiumUnitRow,
                        isSelected ? styles.premiumUnitRowSelected : null,
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <View style={styles.premiumUnitLeft}>
                        <View style={styles.premiumUnitHeaderRow}>
                          <Text
                            style={[
                              styles.premiumUnitCode,
                              isSelected ? { color: '#013369' } : null,
                            ]}
                          >
                            {unit.code}
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.premiumUnitName,
                              isSelected ? { color: '#013369', fontWeight: '800' } : null,
                            ]}
                          >
                            {shortName}
                          </Text>
                        </View>
                        {subtitle ? (
                          <Text numberOfLines={1} style={styles.premiumUnitMeta}>
                            {subtitle}
                          </Text>
                        ) : null}
                      </View>

                      <View style={styles.premiumUnitRight}>
                        <View
                          style={[
                            styles.premiumStatusBadge,
                            {
                              backgroundColor: statusColors.bg,
                              borderColor: statusColors.border,
                              borderWidth: 1,
                            },
                          ]}
                        >
                          <Text style={[styles.premiumStatusText, { color: statusColors.text }]}>
                            {statusInfo.label}
                          </Text>
                        </View>
                        <MaterialCommunityIcons
                          name={isSelected ? 'star-check' : 'chevron-right'}
                          size={16}
                          color={isSelected ? '#FFB300' : '#B8C2BA'}
                        />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
