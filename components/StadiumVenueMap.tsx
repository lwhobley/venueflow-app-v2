import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TextInput } from 'react-native-paper';
import { CommandButton, CommandText, StatusPill } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';
import { useResponsive } from '../lib/responsive';
import { StadiumUnitDetailModal, type StadiumZoneItem } from './StadiumUnitDetailModal';
import Stadium3DModel from './Stadium3DModel';
import { COMPREHENSIVE_STADIUM_ZONES, type StadiumZoneData } from './stadium-map/zone-data';
import { styles } from './stadium-map/StadiumVenueMap.styles';

// Static stadium zone/unit data and component styles were split out into
// components/stadium-map/ to keep this file to the actual component logic —
// see zone-data.ts and StadiumVenueMap.styles.ts. Re-exported here so any
// existing `from './StadiumVenueMap'` import of these keeps working.
export { COMPREHENSIVE_STADIUM_ZONES, type StadiumZoneData };

export function StadiumVenueMap({
  initialZoneId,
  initialSelectedUnitId,
  onSelectUnit,
}: {
  initialZoneId?: string;
  initialSelectedUnitId?: string;
  onSelectUnit?: (unit: StadiumZoneItem) => void;
}) {
  const palette = useDesignTheme();
  const { width: windowWidth, isMobile } = useResponsive();

  const [mobileTab, setMobileTab] = useState<'map' | 'directory'>('map');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedZoneId, setSelectedZoneId] = useState<string>(initialZoneId ?? 'ALL');
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(initialSelectedUnitId ?? 'u-302');
  const [activeModalUnit, setActiveModalUnit] = useState<StadiumZoneItem | null>(null);
  const [viewPerspective, setViewPerspective] = useState<'3d_isometric' | '2d_plan'>('3d_isometric');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    stadium_gates: true,
    field_sidelines: true,
    concourse_bunkers: true,
    concourse_service_areas: true,
    locker_rooms_aux: true,
    luxury_suites: true,
    club_level: true,
    upper_deck: false,
  });

  const zonesState = COMPREHENSIVE_STADIUM_ZONES;

  // Selected Unit Data for live floating HUD
  const activeSelectedUnit = useMemo(() => {
    if (!selectedUnitId) return null;
    for (const z of zonesState) {
      const found = z.units.find((u) => u.id === selectedUnitId);
      if (found) return { unit: found, zone: z };
    }
    return null;
  }, [selectedUnitId, zonesState]);

  // Toggle category in sidebar
  const toggleCategory = (catKey: string) => {
    setExpandedCategories((prev) => ({ ...prev, [catKey]: !prev[catKey] }));
  };

  // Grouped Categories for sidebar
  const categoryGroups = useMemo(() => {
    const groups: Record<string, { label: string; icon: string; zones: StadiumZoneData[] }> = {
      stadium_gates: {
        label: 'Main Entry Gates (4)',
        icon: 'door-sliding',
        zones: zonesState.filter((z) => z.category === 'stadium_gates'),
      },
      field_sidelines: {
        label: 'Field, Sidelines & Endzones (4)',
        icon: 'stadium-variant',
        zones: zonesState.filter((z) => z.category === 'field_sidelines'),
      },
      concourse_bunkers: {
        label: 'VIP Field Bunkers (2)',
        icon: 'shield-crown',
        zones: zonesState.filter((z) => z.category === 'concourse_bunkers'),
      },
      concourse_service_areas: {
        label: 'Concourse 100 Outlets (8)',
        icon: 'storefront-outline',
        zones: zonesState.filter((z) => z.category === 'concourse_service_areas'),
      },
      locker_rooms_aux: {
        label: 'Team Lockers & Aux Suites (6)',
        icon: 'locker',
        zones: zonesState.filter((z) => z.category === 'locker_rooms_aux'),
      },
      luxury_suites: {
        label: 'Luxury Suites 300 & 400 (80)',
        icon: 'glass-cocktail',
        zones: zonesState.filter((z) => z.category === 'luxury_suites'),
      },
      club_level: {
        label: 'Club Level 200 (2)',
        icon: 'trophy-award',
        zones: zonesState.filter((z) => z.category === 'club_level'),
      },
      upper_deck: {
        label: 'Upper Deck 400 (3)',
        icon: 'stairs-up',
        zones: zonesState.filter((z) => z.category === 'upper_deck'),
      },
    };
    return groups;
  }, [zonesState]);

  // Suite Floor Selection & Dropdown State
  const [suiteFloorTab, setSuiteFloorTab] = useState<'all' | '300_west' | '300_east' | '300_endzones' | '400_loge'>('all');
  const [isSuiteDropdownOpen, setIsSuiteDropdownOpen] = useState(false);
  const [suiteDropdownQuery, setSuiteDropdownQuery] = useState('');

  const luxurySuitesZone = useMemo(() => {
    return zonesState.find((z) => z.id === 'zone-300-suites');
  }, [zonesState]);

  const allSuites = useMemo(() => {
    return luxurySuitesZone?.units ?? [];
  }, [luxurySuitesZone]);

  const filteredFloorSuites = useMemo(() => {
    if (suiteFloorTab === 'all') return allSuites;
    if (suiteFloorTab === '300_west') {
      return allSuites.filter((s) => {
        const num = parseInt(s.suiteDetails?.suiteNumber ?? '0', 10);
        return num >= 301 && num <= 320;
      });
    }
    if (suiteFloorTab === '300_east') {
      return allSuites.filter((s) => {
        const num = parseInt(s.suiteDetails?.suiteNumber ?? '0', 10);
        return num >= 321 && num <= 340;
      });
    }
    if (suiteFloorTab === '300_endzones') {
      return allSuites.filter((s) => {
        const num = parseInt(s.suiteDetails?.suiteNumber ?? '0', 10);
        return num >= 341 && num <= 360;
      });
    }
    if (suiteFloorTab === '400_loge') {
      return allSuites.filter((s) => {
        const num = parseInt(s.suiteDetails?.suiteNumber ?? '0', 10);
        return num >= 401 && num <= 440;
      });
    }
    return allSuites;
  }, [allSuites, suiteFloorTab]);

  const dropdownFilteredSuites = useMemo(() => {
    let list = allSuites;
    if (suiteFloorTab !== 'all') {
      list = filteredFloorSuites;
    }
    if (!suiteDropdownQuery.trim()) return list;
    const q = suiteDropdownQuery.toLowerCase();
    return list.filter(
      (s) =>
        s.code.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.suiteDetails?.suiteholder && s.suiteDetails.suiteholder.toLowerCase().includes(q)) ||
        (s.suiteDetails?.suiteNumber && s.suiteDetails.suiteNumber.toLowerCase().includes(q))
    );
  }, [allSuites, filteredFloorSuites, suiteFloorTab, suiteDropdownQuery]);

  const totalUnitsCount = useMemo(() => {
    return zonesState.reduce((sum, z) => sum + z.units.length, 0);
  }, [zonesState]);

  // Click Handler
  const handleUnitPress = (unit: StadiumZoneItem, zoneId?: string) => {
    setSelectedUnitId(unit.id);
    if (zoneId) setSelectedZoneId(zoneId);
    if (onSelectUnit) onSelectUnit(unit);
  };

  return (
    <View style={styles.container}>
      {/* Top Search & 3D Controls Bar */}
      <View style={[styles.topSearchBar, { borderBottomColor: palette.divider }]}>
        <View style={styles.searchRow}>
          <TextInput
            placeholder="Search Suite #, Gate, Team Locker, Concourse Outlets, Bunker, BEOs..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            mode="outlined"
            outlineColor="#DDE1DA"
            activeOutlineColor="#17643B"
            textColor="#1D2420"
            placeholderTextColor="#68706A"
            style={styles.searchInput}
            dense
            left={<TextInput.Icon icon="magnify" color="#17643B" />}
            right={searchQuery ? <TextInput.Icon icon="close" onPress={() => setSearchQuery('')} /> : undefined}
          />
          <View style={styles.viewModeToggle}>
            <Pressable
              onPress={() => setViewPerspective('3d_isometric')}
              style={[
                styles.perspectiveBtn,
                { backgroundColor: viewPerspective === '3d_isometric' ? '#013369' : '#FFFFFF' },
              ]}
            >
              <MaterialCommunityIcons
                name="cube-outline"
                size={16}
                color={viewPerspective === '3d_isometric' ? '#FFFFFF' : '#013369'}
              />
              <CommandText
                palette={palette}
                variant="caption"
                style={{ color: viewPerspective === '3d_isometric' ? '#FFFFFF' : '#013369', fontWeight: '800' }}
              >
                3D SPATIAL
              </CommandText>
            </Pressable>
            <Pressable
              onPress={() => setViewPerspective('2d_plan')}
              style={[
                styles.perspectiveBtn,
                { backgroundColor: viewPerspective === '2d_plan' ? '#013369' : '#FFFFFF' },
              ]}
            >
              <MaterialCommunityIcons
                name="floor-plan"
                size={16}
                color={viewPerspective === '2d_plan' ? '#FFFFFF' : '#013369'}
              />
              <CommandText
                palette={palette}
                variant="caption"
                style={{ color: viewPerspective === '2d_plan' ? '#FFFFFF' : '#013369', fontWeight: '800' }}
              >
                PLAN
              </CommandText>
            </Pressable>
          </View>
        </View>

        {/* Mobile View Switcher Tab Bar */}
        {isMobile ? (
          <View style={styles.mobileTabSwitcher}>
            <Pressable
              onPress={() => setMobileTab('map')}
              style={[
                styles.mobileTabBtn,
                {
                  backgroundColor: mobileTab === 'map' ? '#013369' : '#EEF5F0',
                  borderColor: mobileTab === 'map' ? '#013369' : '#B6D6BE',
                },
              ]}
            >
              <MaterialCommunityIcons
                name="stadium-variant"
                size={16}
                color={mobileTab === 'map' ? '#FFFFFF' : '#013369'}
              />
              <Text
                style={{
                  color: mobileTab === 'map' ? '#FFFFFF' : '#013369',
                  fontWeight: '800',
                  fontSize: 12,
                }}
              >
                3D Stadium Model
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setMobileTab('directory')}
              style={[
                styles.mobileTabBtn,
                {
                  backgroundColor: mobileTab === 'directory' ? '#013369' : '#EEF5F0',
                  borderColor: mobileTab === 'directory' ? '#013369' : '#B6D6BE',
                },
              ]}
            >
              <MaterialCommunityIcons
                name="format-list-group"
                size={16}
                color={mobileTab === 'directory' ? '#FFFFFF' : '#013369'}
              />
              <Text
                style={{
                  color: mobileTab === 'directory' ? '#FFFFFF' : '#013369',
                  fontWeight: '800',
                  fontSize: 12,
                }}
              >
                Sector Directory ({totalUnitsCount})
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Main Operations Split Layout */}
      <View style={[styles.mainLayout, { flexDirection: isMobile ? 'column' : 'row' }]}>
        {/* LEFT / TAB 1: Categorized Dropdown Directory */}
        {(!isMobile || mobileTab === 'directory') && (
          <View
            style={[
              styles.sidebarList,
              {
                width: isMobile ? '100%' : 330,
                borderRightWidth: isMobile ? 0 : 1,
                borderRightColor: palette.divider,
                borderBottomWidth: isMobile ? 1 : 0,
                borderBottomColor: palette.divider,
              },
            ]}
          >
            <View style={[styles.sidebarHeader, { borderBottomColor: palette.divider }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialCommunityIcons name="format-list-group" size={18} color="#013369" />
                <CommandText palette={palette} variant="label" style={{ color: '#013369', fontWeight: '800' }}>
                  SPATIAL SECTOR DIRECTORY
                </CommandText>
              </View>
              <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>
                {isMobile ? 'Tap any area of service to glow in 3D & view BEOs' : 'Click any unit to focus on 3D spatial model'}
              </CommandText>
            </View>

            <ScrollView style={{ flex: 1, maxHeight: isMobile ? 480 : undefined }} showsVerticalScrollIndicator={false}>
              {Object.entries(categoryGroups).map(([catKey, catData]) => {
                const isExpanded = expandedCategories[catKey] ?? true;
                const allUnitsInCat = catData.zones.flatMap((z) => z.units);
                const filteredInCat = searchQuery.trim()
                  ? allUnitsInCat.filter(
                      (u) =>
                        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        u.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        u.suiteDetails?.suiteholder?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        u.suiteDetails?.beoPackageName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        u.standDetails?.concept?.toLowerCase().includes(searchQuery.toLowerCase()),
                    )
                  : allUnitsInCat;

                if (searchQuery.trim() && filteredInCat.length === 0) return null;

                return (
                  <View key={catKey} style={[styles.categoryAccordion, { borderBottomColor: palette.divider }]}>
                    <Pressable
                      onPress={() => toggleCategory(catKey)}
                      style={({ pressed }) => [
                        styles.categoryHeader,
                        { opacity: pressed ? 0.7 : 1, backgroundColor: '#F7F7F4' },
                      ]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                        <MaterialCommunityIcons name={catData.icon as any} size={18} color="#013369" />
                        <CommandText
                          palette={palette}
                          variant="body"
                          style={{ fontWeight: '700', fontSize: 13, color: '#1D2420', flex: 1 }}
                        >
                          {catData.label}
                        </CommandText>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={styles.countBadge}>
                          <CommandText
                            palette={palette}
                            variant="caption"
                            style={{ color: '#013369', fontWeight: '700', fontSize: 11 }}
                          >
                            {filteredInCat.length}
                          </CommandText>
                        </View>
                        <MaterialCommunityIcons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color="#68706A"
                        />
                      </View>
                    </Pressable>

                    {isExpanded ? (
                      <View style={styles.unitsSublist}>
                        {filteredInCat.map((unit) => {
                          const isSelected = selectedUnitId === unit.id;
                          const hasBeo = Boolean(unit.suiteDetails?.beoNumber);
                          const hasInSeat = Boolean(
                            unit.suiteDetails?.inSeatOrders?.length || unit.standDetails?.inSeatOrders?.length,
                          );

                          return (
                            <Pressable
                              key={unit.id}
                              onPress={() => handleUnitPress(unit)}
                              style={({ pressed }) => [
                                styles.unitSidebarItem,
                                isSelected ? styles.unitSidebarItemSelected : null,
                                { opacity: pressed ? 0.7 : 1 },
                              ]}
                            >
                              <View style={{ flex: 1, gap: 2 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <CommandText
                                    palette={palette}
                                    variant="caption"
                                    style={{ fontWeight: '800', color: isSelected ? '#013369' : '#1D2420' }}
                                  >
                                    {unit.code}
                                  </CommandText>
                                  <StatusPill
                                    palette={palette}
                                    tone={
                                      unit.status === 'open'
                                        ? 'good'
                                        : unit.status === 'incident'
                                          ? 'danger'
                                          : 'neutral'
                                    }
                                  >
                                    {unit.status.toUpperCase()}
                                  </StatusPill>
                                  {hasBeo ? (
                                    <View style={styles.beoIndicator}>
                                      <CommandText
                                        palette={palette}
                                        variant="caption"
                                        style={{ color: '#8A5D23', fontSize: 10, fontWeight: '700' }}
                                      >
                                        BEO READY
                                      </CommandText>
                                    </View>
                                  ) : null}
                                </View>
                                <CommandText
                                  palette={palette}
                                  variant="body"
                                  style={{ fontWeight: '700', fontSize: 13, color: '#1D2420' }}
                                >
                                  {unit.name}
                                </CommandText>
                                {unit.suiteDetails?.suiteholder ? (
                                  <CommandText
                                    palette={palette}
                                    variant="caption"
                                    style={{ color: '#013369', fontWeight: '600' }}
                                  >
                                    Holder: {unit.suiteDetails.suiteholder}
                                  </CommandText>
                                ) : unit.standDetails?.concept ? (
                                  <CommandText
                                    palette={palette}
                                    variant="caption"
                                    style={{ color: '#013369', fontWeight: '600' }}
                                  >
                                    {unit.standDetails.concept}
                                  </CommandText>
                                ) : null}
                                {hasInSeat ? (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                    <MaterialCommunityIcons name="seat-passenger" size={12} color="#013369" />
                                    <CommandText
                                      palette={palette}
                                      variant="caption"
                                      style={{ color: '#013369', fontSize: 11, fontWeight: '600' }}
                                    >
                                      Active In-Seat Orders
                                    </CommandText>
                                  </View>
                                ) : null}
                              </View>
                              <MaterialCommunityIcons
                                name={isSelected ? 'star-check' : 'chevron-right'}
                                size={18}
                                color={isSelected ? '#FFB300' : '#B8C2BA'}
                              />
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* RIGHT / TAB 2: Full 3D Spatial Model & Clickable Service Areas */}
        {(!isMobile || mobileTab === 'map') && (
          <View style={[styles.mapCanvas, { width: isMobile ? '100%' : undefined }]}>
            {/* Level & Gate Filter Bar */}
            <View style={[styles.canvasHeader, { borderBottomColor: palette.divider }]}>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialCommunityIcons name="stadium" size={18} color="#013369" />
                  <CommandText palette={palette} variant="label" style={{ color: '#013369', fontWeight: '900', letterSpacing: 0.5 }}>
                    ISOMETRIC FOOTBALL STADIUM · 3D SPATIAL MODEL
                  </CommandText>
                </View>
                <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>
                  Click any service zone to illuminate area & inspect live BEO / catering amenities
                </CommandText>
              </View>

              {/* Level Selector Buttons */}
              <View style={styles.levelFilterRow}>
                {[
                  { id: 'ALL', label: '3D All Levels' },
                  { id: 'zone-stadium-gates', label: 'Entry Gates (4)' },
                  { id: 'zone-field-sidelines', label: 'Field & Sidelines' },
                  { id: 'zone-concourse-bunkers', label: 'VIP Bunkers (2)' },
                  { id: 'zone-concourse-service-areas', label: 'Concourse 100' },
                  { id: 'zone-300-suites', label: 'Suites 300' },
                  { id: 'zone-200-club', label: 'Club 200' },
                  { id: 'zone-400-upper', label: 'Upper 400 Deck' },
                  { id: 'zone-locker-rooms-aux', label: 'Lockers (6)' },
                ].map((lvl) => {
                  const isActive = selectedZoneId === lvl.id;
                  return (
                    <Pressable
                      key={lvl.id}
                      onPress={() => setSelectedZoneId(lvl.id)}
                      style={[
                        styles.levelPill,
                        {
                          backgroundColor: isActive ? '#013369' : '#F7F7F4',
                          borderColor: isActive ? '#013369' : '#DDE1DA',
                        },
                      ]}
                    >
                      <CommandText
                        palette={palette}
                        variant="caption"
                        style={{ color: isActive ? '#FFFFFF' : '#1D2420', fontWeight: '700', fontSize: 10, lineHeight: 13 }}
                      >
                        {lvl.label}
                      </CommandText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Actual GLB renderer in 3D mode; the architectural plan remains available in 2D mode. */}
            {viewPerspective === '3d_isometric' ? (
              <View style={[styles.interactiveModelFrame, { height: isMobile ? 300 : 380 }]}>
                <Stadium3DModel
                  highlightCategory={activeSelectedUnit?.zone.category ?? null}
                  dom={{
                    scrollEnabled: false,
                    contentInsetAdjustmentBehavior: 'never',
                    style: { width: '100%', height: '100%' },
                  }}
                />
              </View>
            ) : (
            <ScrollView horizontal contentContainerStyle={styles.canvasScrollInner} showsHorizontalScrollIndicator={true}>
              <ScrollView contentContainerStyle={styles.stadium3DContainer} showsVerticalScrollIndicator={false}>
                <View
                  style={[
                    styles.stadiumPerspectiveWrapper,
                    { width: isMobile ? Math.max(340, windowWidth - 32) : 840 },
                    styles.planTransform,
                  ]}
                >
                  {/* ── TOP: RETRACTABLE ROOF RAILS & STEEL ARCHES ── */}
                  <View style={styles.roofTrussSuperstructure}>
                    <View style={styles.roofRailTrack} />
                    <View style={styles.roofBadgePill}>
                      <MaterialCommunityIcons name="weather-sunny" size={12} color="#013369" />
                      <Text style={styles.roofBadgeText}>RETRACTABLE ROOF SUPERSTRUCTURE · ARCHITECTURAL CUTAWAY</Text>
                    </View>
                    <View style={styles.roofRailTrack} />
                  </View>

                  {/* ── NORTH GATE TOWER: FORD GATE (North Entrance Plaza) ── */}
                  <View style={styles.gateNorthWrapper}>
                    {zonesState
                      .find((z) => z.id === 'zone-stadium-gates')
                      ?.units.filter((u) => u.id === 'u-gate-ford')
                      .map((unit) => {
                        const isSelected = selectedUnitId === unit.id;
                        return (
                          <Pressable
                            key={unit.id}
                            onPress={() => handleUnitPress(unit, 'zone-stadium-gates')}
                            style={[
                              styles.gateTowerStructure,
                              styles.gateNorthTower,
                              isSelected ? styles.gateTowerActive : null,
                            ]}
                          >
                            <View style={styles.gatePylonPillarLeft} />
                            <View style={styles.gateTowerCenterHub}>
                              <View style={styles.gateFordBadge}>
                                <Text style={styles.gateFordText}>Ford</Text>
                                <Text style={styles.gateBadgeSub}>GATE PORTAL</Text>
                              </View>
                              <View style={{ alignItems: 'center' }}>
                                <Text style={styles.gateTowerTitle}>
                                  NORTH ARRIVAL PLAZA · TURNSTILES & VIP PORTAL
                                </Text>
                                <View style={styles.turnstileBayRow}>
                                  <View style={styles.turnstileCanopy} />
                                  <Text style={styles.turnstileMetaText}>16 Electronic Scanning Gates · Fast-Track VIP</Text>
                                  <View style={styles.turnstileCanopy} />
                                </View>
                              </View>
                            </View>
                            <View style={styles.gatePylonPillarRight} />
                            {isSelected ? (
                              <View style={styles.architecturalActiveBadge}>
                                <Text style={styles.architecturalActiveBadgeText}>★ SELECTED GATE PORTAL</Text>
                              </View>
                            ) : null}
                          </Pressable>
                        );
                      })}
                  </View>

                  {/* ── NORTH JUMBOTRON HD VIDEOBOARD ── */}
                  <View style={styles.jumbotronDisplayBox}>
                    <View style={styles.jumboScreenNorth}>
                      <MaterialCommunityIcons name="television-play" size={14} color="#00E5FF" />
                      <Text style={styles.jumboScreenText}>NORTH ENDZONE HD SCOREBOARD & LIVE GAMEDAY REPLAY</Text>
                    </View>
                  </View>

                  {/* ── LEVEL 500/600 UPPER BOWL (TEXANS RED GRANDSTAND TIERS) ── */}
                  <View style={styles.outerUpperDeckRingRed}>
                    <View style={styles.ringLabelHeader}>
                      <View style={styles.stadiumTierBadgeRed}>
                        <MaterialCommunityIcons name="stairs-up" size={12} color="#FFFFFF" />
                        <Text style={styles.tierPillRedText}>
                          LEVEL 500 / 600 · UPPER BOWL (RAKED SEATING GRANDSTANDS)
                        </Text>
                      </View>
                    </View>

                    {/* Grandstand Seating Sectors with Raked Stepped Rows */}
                    <View style={styles.upperDeckSectors}>
                      {zonesState
                        .find((z) => z.id === 'zone-400-upper')
                        ?.units.map((unit) => {
                          const isSelected = selectedUnitId === unit.id;
                          return (
                            <Pressable
                              key={unit.id}
                              onPress={() => handleUnitPress(unit, 'zone-400-upper')}
                              style={[
                                styles.grandstandSeatingSection,
                                isSelected ? styles.grandstandSectionActive : null,
                              ]}
                            >
                              {/* Stadium Floodlight Top Beacon */}
                              <View style={styles.grandstandFloodlightRow}>
                                <View style={[styles.floodlightDot, isSelected ? styles.floodlightDotActive : null]} />
                                <Text style={styles.grandstandSectionCode}>{unit.code}</Text>
                                <View style={[styles.floodlightDot, isSelected ? styles.floodlightDotActive : null]} />
                              </View>

                              {/* Stepped Physical Seat Rows */}
                              <View style={styles.steppedSeatsContainer}>
                                <View style={[styles.seatRowLine, { opacity: 0.9 }]} />
                                <View style={[styles.seatRowLine, { opacity: 0.75 }]} />
                                <View style={[styles.seatRowLine, { opacity: 0.6 }]} />
                              </View>

                              {/* Section Title & Vomitory Arch */}
                              <View style={styles.grandstandLowerDeck}>
                                <Text numberOfLines={1} style={styles.grandstandTitleText}>
                                  {unit.name.split('·')[1]?.trim() ?? unit.name}
                                </Text>
                                <View style={styles.vomitoryTunnelArch}>
                                  <Text style={styles.vomitoryTunnelText}>GATE EXIT</Text>
                                </View>
                              </View>

                              {isSelected ? (
                                <View style={styles.grandstandActiveHalo}>
                                  <Text style={styles.grandstandActiveHaloText}>★ ACTIVE GRANDSTAND</Text>
                                </View>
                              ) : null}
                            </Pressable>
                          );
                        })}
                    </View>

                    {/* ── WEST & EAST GATE TOWERS FLANKING SUITES ── */}
                    <View style={styles.middleGatesSideRow}>
                      {/* WEST: Phillips 66 Gate Tower */}
                      {zonesState
                        .find((z) => z.id === 'zone-stadium-gates')
                        ?.units.filter((u) => u.id === 'u-gate-p66')
                        .map((unit) => {
                          const isSelected = selectedUnitId === unit.id;
                          return (
                            <Pressable
                              key={unit.id}
                              onPress={() => handleUnitPress(unit, 'zone-stadium-gates')}
                              style={[
                                styles.sideGateTowerWest,
                                isSelected ? styles.gateTowerActive : null,
                              ]}
                            >
                              <View style={styles.p66Badge}>
                                <Text style={styles.p66TextTop}>PHILLIPS</Text>
                                <Text style={styles.p66TextBottom}>66</Text>
                              </View>
                              <Text style={styles.sideGateTowerText}>WEST GATE TOWER</Text>
                              <View style={styles.sideGatePylonFin} />
                              <Text style={styles.sideGateTowerSub}>Suiteholder & Media Elevators</Text>
                              {isSelected ? (
                                <View style={styles.sideGateActiveIndicator}>
                                  <Text style={styles.sideGateActiveIndicatorText}>ACTIVE</Text>
                                </View>
                              ) : null}
                            </Pressable>
                          );
                        })}

                      {/* ── LEVEL 300 & 400 LUXURY SUITE RINGS (EXECUTIVE GLASS PAVILIONS · 80 SUITES) ── */}
                      <View style={styles.suitesTierRing}>
                        <View style={styles.ringLabelHeader}>
                          <View style={styles.stadiumTierBadgeGold}>
                            <MaterialCommunityIcons name="glass-cocktail" size={12} color="#FFFFFF" />
                            <Text style={styles.tierPillGoldText}>
                              LEVEL 300 / 400 · EXECUTIVE SUITES & LOGE BOXES ({allSuites.length} SUITES)
                            </Text>
                          </View>
                        </View>

                        {/* Suite Floor Quadrant Filter Tabs */}
                        <View style={styles.suiteFloorTabsRow}>
                          <Pressable
                            onPress={() => setSuiteFloorTab('all')}
                            style={[
                              styles.suiteFloorTabBtn,
                              suiteFloorTab === 'all' ? styles.suiteFloorTabBtnActive : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.suiteFloorTabText,
                                suiteFloorTab === 'all' ? styles.suiteFloorTabTextActive : null,
                              ]}
                            >
                              All Suites ({allSuites.length})
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setSuiteFloorTab('300_west')}
                            style={[
                              styles.suiteFloorTabBtn,
                              suiteFloorTab === '300_west' ? styles.suiteFloorTabBtnActive : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.suiteFloorTabText,
                                suiteFloorTab === '300_west' ? styles.suiteFloorTabTextActive : null,
                              ]}
                            >
                              L300 West (301-320)
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setSuiteFloorTab('300_east')}
                            style={[
                              styles.suiteFloorTabBtn,
                              suiteFloorTab === '300_east' ? styles.suiteFloorTabBtnActive : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.suiteFloorTabText,
                                suiteFloorTab === '300_east' ? styles.suiteFloorTabTextActive : null,
                              ]}
                            >
                              L300 East (321-340)
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setSuiteFloorTab('300_endzones')}
                            style={[
                              styles.suiteFloorTabBtn,
                              suiteFloorTab === '300_endzones' ? styles.suiteFloorTabBtnActive : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.suiteFloorTabText,
                                suiteFloorTab === '300_endzones' ? styles.suiteFloorTabTextActive : null,
                              ]}
                            >
                              L300 Endzones (341-360)
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setSuiteFloorTab('400_loge')}
                            style={[
                              styles.suiteFloorTabBtn,
                              suiteFloorTab === '400_loge' ? styles.suiteFloorTabBtnActive : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.suiteFloorTabText,
                                suiteFloorTab === '400_loge' ? styles.suiteFloorTabTextActive : null,
                              ]}
                            >
                              L400 Loge (401-440)
                            </Text>
                          </Pressable>
                        </View>

                        {/* Interactive Suite Floor Dropdown Bar */}
                        <Pressable
                          onPress={() => setIsSuiteDropdownOpen(!isSuiteDropdownOpen)}
                          style={[
                            styles.suiteDropdownTrigger,
                            isSuiteDropdownOpen ? styles.suiteDropdownTriggerOpen : null,
                          ]}
                        >
                          <View style={styles.suiteDropdownTriggerLeft}>
                            <MaterialCommunityIcons
                              name="format-list-bulleted-square"
                              size={15}
                              color="#8A5D23"
                            />
                            <Text numberOfLines={1} style={styles.suiteDropdownTriggerText}>
                              {activeSelectedUnit?.zone.id === 'zone-300-suites'
                                ? `Selected: ${activeSelectedUnit.unit.name} (${activeSelectedUnit.unit.suiteDetails?.beoNumber ? '★ BEO Ready' : 'Open'})`
                                : `▾ Select Suite from Floor Dropdown (${filteredFloorSuites.length} available)...`}
                            </Text>
                          </View>
                          <View style={styles.suiteDropdownTriggerRight}>
                            <Text style={styles.suiteDropdownTriggerCount}>
                              {filteredFloorSuites.length} Suites
                            </Text>
                            <MaterialCommunityIcons
                              name={isSuiteDropdownOpen ? 'chevron-up' : 'chevron-down'}
                              size={16}
                              color="#8A5D23"
                            />
                          </View>
                        </Pressable>

                        {/* Expandable Suite Dropdown Menu Drawer */}
                        {isSuiteDropdownOpen ? (
                          <View style={styles.suiteDropdownMenuBox}>
                            <View style={styles.suiteDropdownSearchRow}>
                              <TextInput
                                placeholder="Search Suite #, Sponsor, Tier, or BEO..."
                                value={suiteDropdownQuery}
                                onChangeText={setSuiteDropdownQuery}
                                mode="outlined"
                                outlineColor="#F0E6D2"
                                activeOutlineColor="#8A5D23"
                                textColor="#1D2420"
                                placeholderTextColor="#8C7A6B"
                                style={styles.suiteDropdownSearchInput}
                                dense
                                left={<TextInput.Icon icon="magnify" color="#8A5D23" />}
                                right={
                                  suiteDropdownQuery ? (
                                    <TextInput.Icon
                                      icon="close"
                                      onPress={() => setSuiteDropdownQuery('')}
                                    />
                                  ) : undefined
                                }
                              />
                            </View>

                            <ScrollView
                              style={styles.suiteDropdownScrollList}
                              nestedScrollEnabled
                              showsVerticalScrollIndicator
                            >
                              {dropdownFilteredSuites.map((suite) => {
                                const isSelected = selectedUnitId === suite.id;
                                const hasBeo = Boolean(suite.suiteDetails?.beoNumber);
                                return (
                                  <Pressable
                                    key={suite.id}
                                    onPress={() => {
                                      handleUnitPress(suite, 'zone-300-suites');
                                      setIsSuiteDropdownOpen(false);
                                    }}
                                    style={[
                                      styles.suiteDropdownItemRow,
                                      isSelected ? styles.suiteDropdownItemRowActive : null,
                                    ]}
                                  >
                                    <View style={styles.suiteDropdownItemLeft}>
                                      <View
                                        style={[
                                          styles.suiteStatusDot,
                                          {
                                            backgroundColor: hasBeo
                                              ? '#2E7D32'
                                              : isSelected
                                                ? '#FFD700'
                                                : '#B0BEC5',
                                          },
                                        ]}
                                      />
                                      <View>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                          <Text
                                            style={[
                                              styles.suiteDropdownItemNumber,
                                              isSelected ? { color: '#013369', fontWeight: '800' } : null,
                                            ]}
                                          >
                                            {suite.code}
                                          </Text>
                                          <Text
                                            numberOfLines={1}
                                            style={[
                                              styles.suiteDropdownItemHolder,
                                              isSelected ? { color: '#013369', fontWeight: '700' } : null,
                                            ]}
                                          >
                                            {suite.suiteDetails?.suiteholder ?? suite.name}
                                          </Text>
                                        </View>
                                        <Text style={styles.suiteDropdownItemTier}>
                                          {suite.stadiumZone} · {suite.suiteDetails?.tier ?? 'Suite'} (Cap: {suite.capacity ?? 20})
                                        </Text>
                                      </View>
                                    </View>
                                    <View style={styles.suiteDropdownItemRight}>
                                      {hasBeo ? (
                                        <View style={styles.suiteDropdownBeoPill}>
                                          <Text style={styles.suiteDropdownBeoPillText}>BEO READY</Text>
                                        </View>
                                      ) : (
                                        <Text style={styles.suiteDropdownOpenText}>OPEN</Text>
                                      )}
                                      {isSelected ? (
                                        <MaterialCommunityIcons name="check-circle" size={15} color="#2E7D32" />
                                      ) : null}
                                    </View>
                                  </Pressable>
                                );
                              })}
                            </ScrollView>
                          </View>
                        ) : null}

                        {/* ── LEVEL 200 CLUB TIER (CURVED TERRACE + 360° LED RIBBON BOARD) ── */}
                        <View style={styles.clubTierRing}>
                          {/* 360 Dynamic LED Ribbon Banner */}
                          <View style={styles.ribbonLedDisplay}>
                            <Text style={styles.ribbonLedText}>
                              ★ HOUSTON TEXANS · CLUB LEVEL 200 TERRACE · 360° LED HOSPITALITY RIBBON ★
                            </Text>
                          </View>

                          <View style={styles.clubSectorsRow}>
                            {zonesState
                              .find((z) => z.id === 'zone-200-club')
                              ?.units.map((unit) => {
                                const isSelected = selectedUnitId === unit.id;
                                return (
                                  <Pressable
                                    key={unit.id}
                                    onPress={() => handleUnitPress(unit, 'zone-200-club')}
                                    style={[
                                      styles.clubTerraceSection,
                                      isSelected ? styles.clubTerraceActive : null,
                                    ]}
                                  >
                                    <View style={styles.clubArmchairIndicator}>
                                      <MaterialCommunityIcons
                                        name="trophy-award"
                                        size={14}
                                        color={isSelected ? '#FFD700' : '#00E5FF'}
                                      />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                      <Text style={[styles.clubTerraceTitle, { color: isSelected ? '#FFFFFF' : '#E0E7FF' }]}>
                                        {unit.name}
                                      </Text>
                                      <Text style={styles.clubTerraceSub}>Premium Lounge & Bar Service</Text>
                                    </View>
                                    {isSelected ? (
                                      <View style={styles.clubActivePill}>
                                        <Text style={styles.clubActivePillText}>ACTIVE</Text>
                                      </View>
                                    ) : null}
                                  </Pressable>
                                );
                              })}
                          </View>

                          {/* ── LEVEL 100 MAIN CONCOURSE (8 SERVICE HUBS + 2 VIP BUNKERS) ── */}
                          <View style={styles.concourseLevelRing}>
                            <View style={styles.ringLabelHeader}>
                              <View style={styles.stadiumTierBadgeNavy}>
                                <MaterialCommunityIcons name="storefront" size={12} color="#FFFFFF" />
                                <Text style={styles.tierPillNavyText}>
                                  LEVEL 100 · CONCOURSE 8 CULINARY HUBS & FIELD ENTRYWAYS
                                </Text>
                              </View>
                            </View>

                            {/* Top / North Concourse Outlets */}
                            <View style={styles.concoursePerimeterRow}>
                              {zonesState
                                .find((z) => z.id === 'zone-concourse-service-areas')
                                ?.units.slice(2, 6)
                                .map((unit) => {
                                  const isSelected = selectedUnitId === unit.id;
                                  return (
                                    <Pressable
                                      key={unit.id}
                                      onPress={() => handleUnitPress(unit, 'zone-concourse-service-areas')}
                                      style={[
                                        styles.concourseHubStorefront,
                                        isSelected ? styles.concourseHubActive : null,
                                      ]}
                                    >
                                      <View style={styles.concourseAwningStripe} />
                                      <View style={{ padding: 4, alignItems: 'center' }}>
                                        <Text style={[styles.concourseHubCode, { color: isSelected ? '#FFFFFF' : '#013369' }]}>
                                          {unit.code}
                                        </Text>
                                        <Text numberOfLines={1} style={[styles.concourseHubName, { color: isSelected ? '#FFFFFF' : '#1D2420' }]}>
                                          {unit.name.split('·')[1]?.trim() ?? unit.name}
                                        </Text>
                                      </View>
                                    </Pressable>
                                  );
                                })}
                            </View>

                            {/* ── INNER CORE: FOOTBALL FIELD, ENDZONES, SIDELINES & BUNKERS ── */}
                            <View style={styles.fieldAndSidelinesCore}>
                              {/* North Endzone & North Bunker */}
                              <View style={styles.endzoneRowWrapper}>
                                {/* North Bunker Club (Underground Vault) */}
                                {zonesState
                                  .find((z) => z.id === 'zone-concourse-bunkers')
                                  ?.units.filter((u) => u.id === 'u-bunker-north')
                                  .map((unit) => {
                                    const isSelected = selectedUnitId === unit.id;
                                    return (
                                      <Pressable
                                        key={unit.id}
                                        onPress={() => handleUnitPress(unit, 'zone-concourse-bunkers')}
                                        style={[
                                          styles.fieldBunkerVault,
                                          isSelected ? styles.fieldBunkerVaultActive : null,
                                        ]}
                                      >
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                          <MaterialCommunityIcons name="shield-crown" size={14} color="#D4AF37" />
                                          <Text style={styles.fieldBunkerTitle}>NORTH BUNKER</Text>
                                        </View>
                                        <Text style={styles.fieldBunkerSub}>Chef Carving Vault</Text>
                                        {isSelected ? (
                                          <View style={styles.bunkerActiveTag}>
                                            <Text style={styles.bunkerActiveTagText}>ACTIVE</Text>
                                          </View>
                                        ) : null}
                                      </Pressable>
                                    );
                                  })}

                                {/* North Endzone Turf */}
                                {zonesState
                                  .find((z) => z.id === 'zone-field-sidelines')
                                  ?.units.filter((u) => u.id === 'u-endzone-north')
                                  .map((unit) => {
                                    const isSelected = selectedUnitId === unit.id;
                                    return (
                                      <Pressable
                                        key={unit.id}
                                        onPress={() => handleUnitPress(unit, 'zone-field-sidelines')}
                                        style={[
                                          styles.endzoneTurfSection,
                                          isSelected ? styles.fieldPartActive : null,
                                        ]}
                                      >
                                        <View style={styles.goalpostStanchion}>
                                          <Text style={styles.goalpostIcon}>⫽</Text>
                                        </View>
                                        <Text style={styles.endzoneTurfText}>TEXANS</Text>
                                        <Text style={styles.endzoneTurfSub}>North Goalpost Lounge</Text>
                                      </Pressable>
                                    );
                                  })}
                              </View>

                              {/* Center Field + Sidelines Split */}
                              <View style={styles.centerFieldAndSidelinesRow}>
                                {/* West / Home Sideline Bench Area */}
                                {zonesState
                                  .find((z) => z.id === 'zone-field-sidelines')
                                  ?.units.filter((u) => u.id === 'u-side-home')
                                  .map((unit) => {
                                    const isSelected = selectedUnitId === unit.id;
                                    return (
                                      <Pressable
                                        key={unit.id}
                                        onPress={() => handleUnitPress(unit, 'zone-field-sidelines')}
                                        style={[
                                          styles.sidelineBenchTurf,
                                          isSelected ? styles.fieldPartActive : null,
                                        ]}
                                      >
                                        <MaterialCommunityIcons name="shield-account" size={14} color="#FFFFFF" />
                                        <Text style={styles.sidelineBenchText}>HOME BENCH</Text>
                                        <Text style={styles.sidelineBenchSub}>Hydration & VIP</Text>
                                        <View style={styles.sidelineYardMarkerPylon} />
                                      </Pressable>
                                    );
                                  })}

                                {/* 3D Regulation NFL Gridiron Playing Field */}
                                <View style={styles.actualPlayingField}>
                                  {/* Yard Line Stripes */}
                                  <View style={styles.fieldYardGrid}>
                                    <Text style={styles.yardNumText}>10</Text>
                                    <Text style={styles.yardNumText}>20</Text>
                                    <Text style={styles.yardNumText}>30</Text>
                                    <Text style={styles.yardNumText}>40</Text>
                                    <Text style={[styles.yardNumText, { fontWeight: '900', color: '#FFD700' }]}>50</Text>
                                    <Text style={styles.yardNumText}>40</Text>
                                    <Text style={styles.yardNumText}>30</Text>
                                    <Text style={styles.yardNumText}>20</Text>
                                    <Text style={styles.yardNumText}>10</Text>
                                  </View>

                                  {/* Midfield Houston Texans Bull Logo */}
                                  <View style={styles.midfieldLogoCircle}>
                                    <MaterialCommunityIcons name="bullhorn" size={18} color="#FFFFFF" />
                                    <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 }}>
                                      TEXANS
                                    </Text>
                                  </View>
                                </View>

                                {/* East / Visiting Sideline Bench Area */}
                                {zonesState
                                  .find((z) => z.id === 'zone-field-sidelines')
                                  ?.units.filter((u) => u.id === 'u-side-visiting')
                                  .map((unit) => {
                                    const isSelected = selectedUnitId === unit.id;
                                    return (
                                      <Pressable
                                        key={unit.id}
                                        onPress={() => handleUnitPress(unit, 'zone-field-sidelines')}
                                        style={[
                                          styles.sidelineBenchTurf,
                                          isSelected ? styles.fieldPartActive : null,
                                        ]}
                                      >
                                        <MaterialCommunityIcons name="broadcast" size={14} color="#FFFFFF" />
                                        <Text style={styles.sidelineBenchText}>VISITING BENCH</Text>
                                        <Text style={styles.sidelineBenchSub}>Media & VIP</Text>
                                        <View style={styles.sidelineYardMarkerPylon} />
                                      </Pressable>
                                    );
                                  })}
                              </View>

                              {/* South Endzone & South Bunker */}
                              <View style={styles.endzoneRowWrapper}>
                                {/* South Bunker Club (Underground Vault) */}
                                {zonesState
                                  .find((z) => z.id === 'zone-concourse-bunkers')
                                  ?.units.filter((u) => u.id === 'u-bunker-south')
                                  .map((unit) => {
                                    const isSelected = selectedUnitId === unit.id;
                                    return (
                                      <Pressable
                                        key={unit.id}
                                        onPress={() => handleUnitPress(unit, 'zone-concourse-bunkers')}
                                        style={[
                                          styles.fieldBunkerVault,
                                          isSelected ? styles.fieldBunkerVaultActive : null,
                                        ]}
                                      >
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                          <MaterialCommunityIcons name="shield-crown" size={14} color="#D4AF37" />
                                          <Text style={styles.fieldBunkerTitle}>SOUTH BUNKER</Text>
                                        </View>
                                        <Text style={styles.fieldBunkerSub}>Sommelier Vault</Text>
                                        {isSelected ? (
                                          <View style={styles.bunkerActiveTag}>
                                            <Text style={styles.bunkerActiveTagText}>ACTIVE</Text>
                                          </View>
                                        ) : null}
                                      </Pressable>
                                    );
                                  })}

                                {/* South Endzone Turf */}
                                {zonesState
                                  .find((z) => z.id === 'zone-field-sidelines')
                                  ?.units.filter((u) => u.id === 'u-endzone-south')
                                  .map((unit) => {
                                    const isSelected = selectedUnitId === unit.id;
                                    return (
                                      <Pressable
                                        key={unit.id}
                                        onPress={() => handleUnitPress(unit, 'zone-field-sidelines')}
                                        style={[
                                          styles.endzoneTurfSection,
                                          isSelected ? styles.fieldPartActive : null,
                                        ]}
                                      >
                                        <View style={styles.goalpostStanchion}>
                                          <Text style={styles.goalpostIcon}>⫽</Text>
                                        </View>
                                        <Text style={styles.endzoneTurfText}>TEXANS</Text>
                                        <Text style={styles.endzoneTurfSub}>South RedZone Depot</Text>
                                      </Pressable>
                                    );
                                  })}
                              </View>
                            </View>

                            {/* Bottom / South Concourse Outlets */}
                            <View style={styles.concoursePerimeterRow}>
                              {zonesState
                                .find((z) => z.id === 'zone-concourse-service-areas')
                                ?.units.slice(0, 2)
                                .concat(
                                  zonesState.find((z) => z.id === 'zone-concourse-service-areas')?.units.slice(6, 8) ?? [],
                                )
                                .map((unit) => {
                                  const isSelected = selectedUnitId === unit.id;
                                  return (
                                    <Pressable
                                      key={unit.id}
                                      onPress={() => handleUnitPress(unit, 'zone-concourse-service-areas')}
                                      style={[
                                        styles.concourseHubStorefront,
                                        isSelected ? styles.concourseHubActive : null,
                                      ]}
                                    >
                                      <View style={styles.concourseAwningStripe} />
                                      <View style={{ padding: 4, alignItems: 'center' }}>
                                        <Text style={[styles.concourseHubCode, { color: isSelected ? '#FFFFFF' : '#013369' }]}>
                                          {unit.code}
                                        </Text>
                                        <Text numberOfLines={1} style={[styles.concourseHubName, { color: isSelected ? '#FFFFFF' : '#1D2420' }]}>
                                          {unit.name.split('·')[1]?.trim() ?? unit.name}
                                        </Text>
                                      </View>
                                    </Pressable>
                                  );
                                })}
                            </View>
                          </View>
                        </View>
                      </View>

                      {/* EAST: xfinity Gate Tower */}
                      {zonesState
                        .find((z) => z.id === 'zone-stadium-gates')
                        ?.units.filter((u) => u.id === 'u-gate-xfinity')
                        .map((unit) => {
                          const isSelected = selectedUnitId === unit.id;
                          return (
                            <Pressable
                              key={unit.id}
                              onPress={() => handleUnitPress(unit, 'zone-stadium-gates')}
                              style={[
                                styles.sideGateTowerEast,
                                isSelected ? styles.gateTowerActive : null,
                              ]}
                            >
                              <View style={styles.xfinityBadge}>
                                <Text style={styles.xfinityText}>xfinity</Text>
                              </View>
                              <Text style={styles.sideGateTowerText}>EAST GATE TOWER</Text>
                              <View style={styles.sideGatePylonFin} />
                              <Text style={styles.sideGateTowerSub}>Club Level Escalators</Text>
                              {isSelected ? (
                                <View style={styles.sideGateActiveIndicator}>
                                  <Text style={styles.sideGateActiveIndicatorText}>ACTIVE</Text>
                                </View>
                              ) : null}
                            </Pressable>
                          );
                        })}
                    </View>
                  </View>

                  {/* ── SOUTH JUMBOTRON HD VIDEOBOARD ── */}
                  <View style={styles.jumbotronDisplayBox}>
                    <View style={styles.jumboScreenSouth}>
                      <MaterialCommunityIcons name="television-play" size={14} color="#00E5FF" />
                      <Text style={styles.jumboScreenText}>SOUTH ENDZONE HD SCOREBOARD & METRIC HUD</Text>
                    </View>
                  </View>

                  {/* ── SOUTH GATE TOWER: KROGER GATE (South Plaza & Turnstiles) ── */}
                  <View style={styles.gateSouthWrapper}>
                    {zonesState
                      .find((z) => z.id === 'zone-stadium-gates')
                      ?.units.filter((u) => u.id === 'u-gate-kroger')
                      .map((unit) => {
                        const isSelected = selectedUnitId === unit.id;
                        return (
                          <Pressable
                            key={unit.id}
                            onPress={() => handleUnitPress(unit, 'zone-stadium-gates')}
                            style={[
                              styles.gateTowerStructure,
                              styles.gateSouthTower,
                              isSelected ? styles.gateTowerActive : null,
                            ]}
                          >
                            <View style={styles.gatePylonPillarLeft} />
                            <View style={styles.gateTowerCenterHub}>
                              <View style={styles.gateKrogerBadge}>
                                <MaterialCommunityIcons name="cart-outline" size={12} color="#FFFFFF" />
                                <Text style={styles.gateKrogerText}>Kroger</Text>
                                <Text style={styles.gateBadgeSub}>GATE PORTAL</Text>
                              </View>
                              <View style={{ alignItems: 'center' }}>
                                <Text style={styles.gateTowerTitle}>
                                  SOUTH ENTRANCE PLAZA · HIGH-SPEED TURNSTILES
                                </Text>
                                <View style={styles.turnstileBayRow}>
                                  <View style={styles.turnstileCanopy} />
                                  <Text style={styles.turnstileMetaText}>20 Express Gates · Merch Pavilion & Ingress</Text>
                                  <View style={styles.turnstileCanopy} />
                                </View>
                              </View>
                            </View>
                            <View style={styles.gatePylonPillarRight} />
                            {isSelected ? (
                              <View style={styles.architecturalActiveBadge}>
                                <Text style={styles.architecturalActiveBadgeText}>★ SELECTED GATE PORTAL</Text>
                              </View>
                            ) : null}
                          </Pressable>
                        );
                      })}
                  </View>

                  {/* ── UNDERGROUND / LEVEL 0: ATHLETE COMPOUND & PERFORMER AUX SUITES ── */}
                  <View style={styles.undergroundLockerCompound}>
                    <View style={styles.ringLabelHeader}>
                      <View style={styles.stadiumTierBadgeDark}>
                        <MaterialCommunityIcons name="locker" size={12} color="#FFFFFF" />
                        <Text style={styles.tierPillDarkText}>
                          LEVEL 0 · ATHLETE COMPOUND & PERFORMER AUX SUITES
                        </Text>
                      </View>
                    </View>

                    <View style={styles.lockersGridRow}>
                      {zonesState
                        .find((z) => z.id === 'zone-locker-rooms-aux')
                        ?.units.map((unit) => {
                          const isSelected = selectedUnitId === unit.id;
                          const isHome = unit.id === 'u-lck-home';
                          const isVisit = unit.id === 'u-lck-visiting';
                          const isHeadliner = unit.id === 'u-aux-headliner';

                          return (
                            <Pressable
                              key={unit.id}
                              onPress={() => handleUnitPress(unit, 'zone-locker-rooms-aux')}
                              style={[
                                styles.lockerRoomCompoundCard,
                                isSelected ? styles.lockerRoomActive : null,
                                {
                                  backgroundColor: isSelected
                                    ? '#013369'
                                    : isHome
                                      ? '#0A2E1C'
                                      : isVisit
                                        ? '#1E1430'
                                        : isHeadliner
                                          ? '#2A2008'
                                          : '#1C2530',
                                },
                              ]}
                            >
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <MaterialCommunityIcons
                                  name={
                                    isHome || isVisit
                                      ? 'shield-account'
                                      : isHeadliner
                                        ? 'star-face'
                                        : 'account-group'
                                  }
                                  size={16}
                                  color={isSelected ? '#FFD700' : '#FFFFFF'}
                                />
                                <Text style={[styles.lockerCodeText, { color: isSelected ? '#FFFFFF' : '#E0E7FF' }]}>
                                  {unit.code}
                                </Text>
                              </View>
                              <Text
                                numberOfLines={1}
                                style={[styles.lockerNameText, { color: isSelected ? '#FFFFFF' : '#CFD8DC' }]}
                              >
                                {unit.name}
                              </Text>
                              {isSelected ? (
                                <View style={styles.lockerActiveDot}>
                                  <Text style={styles.lockerActiveDotText}>ACTIVE</Text>
                                </View>
                              ) : null}
                            </Pressable>
                          );
                        })}
                    </View>
                  </View>
                </View>
              </ScrollView>
            </ScrollView>
            )}

            {/* ── FLOATING BEO & AMENITIES EVENT HUD POP-UP ── */}
            {activeSelectedUnit ? (
              <View style={styles.floatingBeoHudOverlay}>
                <View style={styles.floatingBeoHudHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <View style={styles.glowingBeaconDot} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.floatingBeoHudCode}>{activeSelectedUnit.unit.code}</Text>
                        <Text style={styles.floatingBeoZonePill}>{activeSelectedUnit.zone.name}</Text>
                      </View>
                      <Text numberOfLines={1} style={styles.floatingBeoHudTitle}>
                        {activeSelectedUnit.unit.name}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => setSelectedUnitId(null)}
                    style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, padding: 4 }]}
                  >
                    <MaterialCommunityIcons name="close-circle-outline" size={22} color="#68706A" />
                  </Pressable>
                </View>

                {/* BEO or Concession Amenities Preview Content */}
                <View style={styles.floatingBeoContentBody}>
                  {activeSelectedUnit.unit.suiteDetails?.beoNumber ? (
                    <View style={styles.beoDetailsBox}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <MaterialCommunityIcons name="file-document-check" size={16} color="#8A5D23" />
                          <Text style={styles.beoNumberLabel}>
                            BEO #{activeSelectedUnit.unit.suiteDetails.beoNumber}
                          </Text>
                        </View>
                        <View style={styles.beoStatusTag}>
                          <Text style={styles.beoStatusTagText}>EVENT CATERING CONFIRMED</Text>
                        </View>
                      </View>

                      <Text style={styles.beoPackageTitle}>
                        {activeSelectedUnit.unit.suiteDetails.beoPackageName ?? 'Executive Hospitality Buffet'}
                      </Text>
                      
                      {activeSelectedUnit.unit.suiteDetails.suiteholder ? (
                        <Text style={styles.beoSuiteholderText}>
                          Holder: <Text style={{ fontWeight: '700' }}>{activeSelectedUnit.unit.suiteDetails.suiteholder}</Text> · {activeSelectedUnit.unit.suiteDetails.guestCount ?? 20} Guests
                        </Text>
                      ) : null}

                      {activeSelectedUnit.unit.suiteDetails.beoPreOrders && activeSelectedUnit.unit.suiteDetails.beoPreOrders.length > 0 ? (
                        <View style={styles.beoItemsList}>
                          {activeSelectedUnit.unit.suiteDetails.beoPreOrders.slice(0, 3).map((item) => (
                            <View key={item.id} style={styles.beoItemRow}>
                              <Text style={styles.beoItemQty}>{item.quantity}x</Text>
                              <Text numberOfLines={1} style={styles.beoItemName}>{item.name}</Text>
                              <Text style={styles.beoItemStatus}>{item.status.toUpperCase()}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ) : activeSelectedUnit.unit.standDetails?.concept ? (
                    <View style={styles.standAmenitiesBox}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <MaterialCommunityIcons name="silverware-fork-knife" size={16} color="#013369" />
                        <Text style={styles.standConceptHeader}>Event Amenities & Culinary Service</Text>
                      </View>
                      <Text style={styles.standConceptDesc}>{activeSelectedUnit.unit.standDetails.concept}</Text>
                      <View style={styles.standMetricsRow}>
                        <Text style={styles.standMetricItem}>
                          POS Terminals: <Text style={{ fontWeight: '700' }}>{activeSelectedUnit.unit.standDetails.terminalCount ?? 4}</Text>
                        </Text>
                        <Text style={styles.standMetricItem}>
                          Event Staff: <Text style={{ fontWeight: '700' }}>{activeSelectedUnit.unit.standDetails.hierarchy?.assignedStaff.length ?? 3} On Duty</Text>
                        </Text>
                      </View>
                    </View>
                  ) : null}

                  {/* Action Buttons */}
                  <View style={styles.floatingHudActionRow}>
                    <Pressable
                      onPress={() => setActiveModalUnit(activeSelectedUnit.unit)}
                      style={({ pressed }) => [
                        styles.hudPrimaryBtn,
                        { opacity: pressed ? 0.8 : 1 },
                      ]}
                    >
                      <MaterialCommunityIcons name="clipboard-text-search" size={16} color="#FFFFFF" />
                      <Text style={styles.hudPrimaryBtnText}>Open Full BEO & Staff Roster</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        )}
      </View>

      {/* Unit Detail Modal Drawer */}
      {activeModalUnit ? (
        <StadiumUnitDetailModal
          visible={Boolean(activeModalUnit)}
          unit={activeModalUnit}
          onClose={() => setActiveModalUnit(null)}
        />
      ) : null}
    </View>
  );
}
