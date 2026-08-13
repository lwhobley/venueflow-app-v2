import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TextInput } from 'react-native-paper';
import { CommandButton, CommandText, StatusPill } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';
import { StadiumUnitDetailModal, type StadiumZoneItem } from './StadiumUnitDetailModal';

export interface StadiumZoneData {
  id: string;
  name: string;
  code: string;
  level: string;
  department: string;
  category: 'lower_bowl' | 'club_level' | 'luxury_suites' | 'upper_deck' | 'commissary_boh';
  unitsCount: number;
  openCount: number;
  alertCount: number;
  units: StadiumZoneItem[];
}

const DEFAULT_STADIUM_ZONES: StadiumZoneData[] = [
  {
    id: 'zone-100-north',
    name: 'North Concourse (100 Level)',
    code: '100-NORTH',
    level: '1',
    department: 'concessions',
    category: 'lower_bowl',
    unitsCount: 6,
    openCount: 5,
    alertCount: 1,
    units: [
      { id: 'u-101', code: 'STAND-101', name: 'Gridiron Smokehouse', department: 'concessions', type: 'concession_stand', capacity: 1500, stadiumZone: 'North Concourse', level: '1', status: 'open', standDetails: { standNumber: '101', concept: 'Smoked BBQ & Brisket', terminalCount: 6, cashBeginningCents: 150000, cashGrossCents: 1240000 } },
      { id: 'u-102', code: 'STAND-102', name: 'Touchdown Tacos & Tequila', department: 'concessions', type: 'concession_stand', capacity: 1200, stadiumZone: 'North Concourse', level: '1', status: 'open', standDetails: { standNumber: '102', concept: 'Street Tacos & Drafts', terminalCount: 4, cashBeginningCents: 100000, cashGrossCents: 890000 } },
      { id: 'u-103', code: 'CART-103', name: 'Endzone Craft Beer Portable', department: 'beverage_operations', type: 'portable_cart', capacity: 600, stadiumZone: 'North Concourse', level: '1', status: 'open', standDetails: { standNumber: '103', concept: 'Local Craft Taps', terminalCount: 2, cashBeginningCents: 50000, cashGrossCents: 410000 } },
      { id: 'u-104', code: 'STAND-104', name: 'Gridiron Classic Dogs & Fries', department: 'concessions', type: 'concession_stand', capacity: 1800, stadiumZone: 'North Concourse', level: '1', status: 'restricted', standDetails: { standNumber: '104', concept: 'Jumbo Dogs & Loaded Fries', terminalCount: 6, cashBeginningCents: 150000, cashGrossCents: 980000, lowStockItems: ['Jumbo Buns (12 par left)', 'Nacho Cheese Bags'] } },
      { id: 'u-105', code: 'KIOSK-105', name: 'Express Beverage & Snacks Kiosk', department: 'concessions', type: 'grab_and_go', capacity: 800, stadiumZone: 'North Concourse', level: '1', status: 'open', standDetails: { standNumber: '105', concept: 'Self-Checkout Grab & Go', terminalCount: 4, cashBeginningCents: 80000, cashGrossCents: 620000 } },
      { id: 'u-106', code: 'BAR-106', name: 'North Goal Line Lounge Bar', department: 'beverage_operations', type: 'bar', capacity: 900, stadiumZone: 'North Concourse', level: '1', status: 'open', standDetails: { standNumber: '106', concept: 'Full Liquor & Specialty Cocktails', terminalCount: 4, cashBeginningCents: 120000, cashGrossCents: 750000 } },
    ],
  },
  {
    id: 'zone-100-east',
    name: 'East Sideline Concourse (100 Level)',
    code: '100-EAST',
    level: '1',
    department: 'concessions',
    category: 'lower_bowl',
    unitsCount: 5,
    openCount: 4,
    alertCount: 1,
    units: [
      { id: 'u-110', code: 'STAND-110', name: 'Sideline Burgers & Shakes', department: 'concessions', type: 'concession_stand', capacity: 1600, stadiumZone: 'East Sideline', level: '1', status: 'open', standDetails: { standNumber: '110', concept: 'Smashburgers & Fries', terminalCount: 6, cashBeginningCents: 150000, cashGrossCents: 1120000 } },
      { id: 'u-111', code: 'STAND-111', name: 'Artisan Pizza Kitchen', department: 'concessions', type: 'concession_stand', capacity: 1400, stadiumZone: 'East Sideline', level: '1', status: 'open', standDetails: { standNumber: '111', concept: 'Stone Hearth Slices', terminalCount: 4, cashBeginningCents: 100000, cashGrossCents: 940000 } },
      { id: 'u-112', code: 'STAND-112', name: 'Bavarian Pretzel & Brat Hub', department: 'concessions', type: 'concession_stand', capacity: 1100, stadiumZone: 'East Sideline', level: '1', status: 'incident', standDetails: { standNumber: '112', concept: 'Pretzels & German Sausages', terminalCount: 4, cashBeginningCents: 100000, cashGrossCents: 340000, lowStockItems: ['Mustard Pump Dispenser Jammed', 'Bratwurst 86-Warning'] } },
      { id: 'u-113', code: 'CART-113', name: 'East Plaza Draft Cart', department: 'beverage_operations', type: 'portable_cart', capacity: 500, stadiumZone: 'East Sideline', level: '1', status: 'open', standDetails: { standNumber: '113', concept: 'Rapid Pour Beer', terminalCount: 2, cashBeginningCents: 50000, cashGrossCents: 380000 } },
      { id: 'u-114', code: 'KIOSK-114', name: 'Sideline Hydration Express', department: 'concessions', type: 'grab_and_go', capacity: 700, stadiumZone: 'East Sideline', level: '1', status: 'open', standDetails: { standNumber: '114', concept: 'Water, Electrolytes & Popcorn', terminalCount: 3, cashBeginningCents: 60000, cashGrossCents: 490000 } },
    ],
  },
  {
    id: 'zone-100-south',
    name: 'South Concourse (100 Level)',
    code: '100-SOUTH',
    level: '1',
    department: 'concessions',
    category: 'lower_bowl',
    unitsCount: 4,
    openCount: 4,
    alertCount: 0,
    units: [
      { id: 'u-120', code: 'STAND-120', name: 'South Endzone BBQ Pit', department: 'concessions', type: 'concession_stand', capacity: 1500, stadiumZone: 'South Concourse', level: '1', status: 'open', standDetails: { standNumber: '120', concept: 'Pulled Pork & Smoked Turkey', terminalCount: 5, cashBeginningCents: 120000, cashGrossCents: 870000 } },
      { id: 'u-121', code: 'STAND-121', name: 'Stadium Nacho Mountain', department: 'concessions', type: 'concession_stand', capacity: 1300, stadiumZone: 'South Concourse', level: '1', status: 'open', standDetails: { standNumber: '121', concept: 'Loaded Souvenir Helmet Nachos', terminalCount: 4, cashBeginningCents: 100000, cashGrossCents: 790000 } },
      { id: 'u-122', code: 'BAR-122', name: 'South Deck Cantina Bar', department: 'beverage_operations', type: 'bar', capacity: 850, stadiumZone: 'South Concourse', level: '1', status: 'open', standDetails: { standNumber: '122', concept: 'Margaritas & Cold Cans', terminalCount: 4, cashBeginningCents: 100000, cashGrossCents: 690000 } },
      { id: 'u-123', code: 'KIOSK-123', name: 'South Express Snacks', department: 'concessions', type: 'grab_and_go', capacity: 650, stadiumZone: 'South Concourse', level: '1', status: 'open', standDetails: { standNumber: '123', concept: 'Pre-packaged Quick Eats', terminalCount: 3, cashBeginningCents: 60000, cashGrossCents: 410000 } },
    ],
  },
  {
    id: 'zone-100-west',
    name: 'West Sideline Concourse (100 Level)',
    code: '100-WEST',
    level: '1',
    department: 'concessions',
    category: 'lower_bowl',
    unitsCount: 4,
    openCount: 4,
    alertCount: 0,
    units: [
      { id: 'u-130', code: 'STAND-130', name: 'Prime Smashburgers West', department: 'concessions', type: 'concession_stand', capacity: 1600, stadiumZone: 'West Sideline', level: '1', status: 'open', standDetails: { standNumber: '130', concept: 'Double Patties & Garlic Fries', terminalCount: 6, cashBeginningCents: 150000, cashGrossCents: 1050000 } },
      { id: 'u-131', code: 'STAND-131', name: 'Crispy Tender Shack', department: 'concessions', type: 'concession_stand', capacity: 1400, stadiumZone: 'West Sideline', level: '1', status: 'open', standDetails: { standNumber: '131', concept: 'Hand-Breaded Tenders & Dips', terminalCount: 5, cashBeginningCents: 120000, cashGrossCents: 960000 } },
      { id: 'u-132', code: 'BAR-132', name: 'West Club Taphouse', department: 'beverage_operations', type: 'bar', capacity: 950, stadiumZone: 'West Sideline', level: '1', status: 'open', standDetails: { standNumber: '132', concept: '24-Tap Craft Wall', terminalCount: 4, cashBeginningCents: 120000, cashGrossCents: 820000 } },
      { id: 'u-133', code: 'CART-133', name: 'West Sideline Pretzel Cart', department: 'concessions', type: 'portable_cart', capacity: 500, stadiumZone: 'West Sideline', level: '1', status: 'open', standDetails: { standNumber: '133', concept: 'Warm Bavarian Pretzels', terminalCount: 2, cashBeginningCents: 50000, cashGrossCents: 310000 } },
    ],
  },
  {
    id: 'zone-200-club',
    name: '200 Club Level & VIP Lounges',
    code: '200-CLUB',
    level: '2',
    department: 'premium_hospitality',
    category: 'club_level',
    unitsCount: 5,
    openCount: 5,
    alertCount: 0,
    units: [
      { id: 'u-201', code: 'CLUB-EAST', name: 'Champions Club East Lounge', department: 'premium_hospitality', type: 'premium_club', capacity: 800, stadiumZone: 'Club Level', level: '2', status: 'open', suiteDetails: { suiteNumber: 'CLUB-E', beoNumber: 'BEO-2026-CLUB1', hostName: 'VIP Club Members', guestCount: 420, menuPackage: 'Chef carving station, seafood raw bar, sommelier pairings', attendantName: 'Marcus Vance' } },
      { id: 'u-202', code: 'CLUB-WEST', name: 'Crown VIP West Lounge', department: 'premium_hospitality', type: 'premium_club', capacity: 800, stadiumZone: 'Club Level', level: '2', status: 'open', suiteDetails: { suiteNumber: 'CLUB-W', beoNumber: 'BEO-2026-CLUB2', hostName: 'Platinum Ticket Holders', guestCount: 380, menuPackage: 'Charcuterie displays, flatbreads, high-end cocktail bar', attendantName: 'Elena Rostova' } },
      { id: 'u-203', code: 'LOGE-201', name: 'Loge Box Hospitality 201-210', department: 'premium_hospitality', type: 'loge_hospitality', capacity: 120, stadiumZone: 'Club Level', level: '2', status: 'open', suiteDetails: { suiteNumber: 'LOGE-NORTH', beoNumber: 'BEO-2026-LOGE1', hostName: 'Corporate Reserved Loge', guestCount: 88, menuPackage: 'In-seat gourmet delivery, champagne toast', attendantName: 'Derek Shaw' } },
      { id: 'u-204', code: 'BAR-204', name: 'Reserve Cellar Wine Bar', department: 'beverage_operations', type: 'bar', capacity: 300, stadiumZone: 'Club Level', level: '2', status: 'open', standDetails: { standNumber: '204', concept: 'Curated Wine & Whiskey List', terminalCount: 3, cashBeginningCents: 150000, cashGrossCents: 1380000 } },
      { id: 'u-205', code: 'KITCH-205', name: 'Club Level Finishing Kitchen', department: 'culinary_production', type: 'production_kitchen', capacity: 400, stadiumZone: 'Club Level', level: '2', status: 'open' },
    ],
  },
  {
    id: 'zone-300-suites',
    name: '300 Luxury Suite Tower',
    code: '300-SUITES',
    level: '3',
    department: 'premium_hospitality',
    category: 'luxury_suites',
    unitsCount: 8,
    openCount: 7,
    alertCount: 1,
    units: [
      { id: 'u-301', code: 'SUITE-301', name: 'Founders Luxury Suite 301', department: 'premium_hospitality', type: 'premium_suite', capacity: 30, stadiumZone: 'Suite Tower North', level: '3', status: 'open', suiteDetails: { suiteNumber: '301', beoNumber: 'BEO-NFL-301', hostName: 'Acme Capital Group', guestCount: 24, menuPackage: 'A5 Wagyu Sliders, King Crab Legs, Dom Pérignon', attendantName: 'Chloe Bennett' } },
      { id: 'u-302', code: 'SUITE-302', name: 'Executive Suite 302', department: 'premium_hospitality', type: 'premium_suite', capacity: 25, stadiumZone: 'Suite Tower North', level: '3', status: 'open', suiteDetails: { suiteNumber: '302', beoNumber: 'BEO-NFL-302', hostName: 'Nexus Tech Partners', guestCount: 20, menuPackage: 'Artisanal Charcuterie, Filet Medallions, Craft Bourbon Bar', attendantName: 'Chloe Bennett' } },
      { id: 'u-303', code: 'SUITE-303', name: 'Skybox Suite 303', department: 'premium_hospitality', type: 'premium_suite', capacity: 20, stadiumZone: 'Suite Tower North', level: '3', status: 'open', suiteDetails: { suiteNumber: '303', beoNumber: 'BEO-NFL-303', hostName: 'Sterling Media', guestCount: 18, menuPackage: 'Game Day Classic Feast & Local Drafts', attendantName: 'Liam Walker' } },
      { id: 'u-304', code: 'SUITE-304', name: 'Presidential Suite 304', department: 'premium_hospitality', type: 'premium_suite', capacity: 35, stadiumZone: 'Suite Tower North', level: '3', status: 'restricted', suiteDetails: { suiteNumber: '304', beoNumber: 'BEO-NFL-304', hostName: 'Chairman VIP Delegation', guestCount: 30, menuPackage: 'Full bespoke chef station & premium champagne bar', attendantName: 'Liam Walker', replenishmentPending: true } },
      { id: 'u-305', code: 'SUITE-310', name: 'Luxury Suite 310 (South)', department: 'premium_hospitality', type: 'premium_suite', capacity: 25, stadiumZone: 'Suite Tower South', level: '3', status: 'open', suiteDetails: { suiteNumber: '310', beoNumber: 'BEO-NFL-310', hostName: 'Vanguard Global', guestCount: 22, menuPackage: 'Prime Rib Carving & Sommelier Selection', attendantName: 'Rachel Miller' } },
      { id: 'u-306', code: 'SUITE-311', name: 'Luxury Suite 311 (South)', department: 'premium_hospitality', type: 'premium_suite', capacity: 25, stadiumZone: 'Suite Tower South', level: '3', status: 'open', suiteDetails: { suiteNumber: '311', beoNumber: 'BEO-NFL-311', hostName: 'Horizon Real Estate', guestCount: 19, menuPackage: 'Texas Smokehouse & Craft IPAs', attendantName: 'Rachel Miller' } },
      { id: 'u-307', code: 'SUITE-312', name: 'Luxury Suite 312 (South)', department: 'premium_hospitality', type: 'premium_suite', capacity: 20, stadiumZone: 'Suite Tower South', level: '3', status: 'open', suiteDetails: { suiteNumber: '312', beoNumber: 'BEO-NFL-312', hostName: 'Redline Auto Group', guestCount: 16, menuPackage: 'Stadium Favorites & Premium Well Bar', attendantName: 'Nathan Fox' } },
      { id: 'u-308', code: 'SUITE-PANTRY-3', name: '3rd Floor Suite Service Pantry', department: 'culinary_production', type: 'commissary', capacity: 100, stadiumZone: 'Suite Tower Central', level: '3', status: 'open' },
    ],
  },
  {
    id: 'zone-400-upper',
    name: '400 Upper Concourse & Skyline Deck',
    code: '400-UPPER',
    level: '4',
    department: 'concessions',
    category: 'upper_deck',
    unitsCount: 4,
    openCount: 4,
    alertCount: 0,
    units: [
      { id: 'u-401', code: 'STAND-401', name: 'Skyline Burgers North', department: 'concessions', type: 'concession_stand', capacity: 1800, stadiumZone: 'Upper Concourse', level: '4', status: 'open', standDetails: { standNumber: '401', concept: 'Fast Burgers & Fries', terminalCount: 6, cashBeginningCents: 150000, cashGrossCents: 780000 } },
      { id: 'u-402', code: 'STAND-402', name: 'High Altitude Hot Dogs & Brews', department: 'concessions', type: 'concession_stand', capacity: 1600, stadiumZone: 'Upper Concourse', level: '4', status: 'open', standDetails: { standNumber: '402', concept: 'Hot Dogs & Jumbo Cans', terminalCount: 5, cashBeginningCents: 120000, cashGrossCents: 650000 } },
      { id: 'u-403', code: 'KIOSK-403', name: 'Upper Deck Grab & Go East', department: 'concessions', type: 'grab_and_go', capacity: 900, stadiumZone: 'Upper Concourse', level: '4', status: 'open', standDetails: { standNumber: '403', concept: 'Self-Serve Beverages & Snacks', terminalCount: 4, cashBeginningCents: 80000, cashGrossCents: 520000 } },
      { id: 'u-404', code: 'KIOSK-404', name: 'Upper Deck Grab & Go West', department: 'concessions', type: 'grab_and_go', capacity: 900, stadiumZone: 'Upper Concourse', level: '4', status: 'open', standDetails: { standNumber: '404', concept: 'Self-Serve Beverages & Snacks', terminalCount: 4, cashBeginningCents: 80000, cashGrossCents: 510000 } },
    ],
  },
  {
    id: 'zone-boh-kitchen',
    name: 'Central Commissary & Main Production',
    code: 'BOH-COMMISSARY',
    level: 'BOH',
    department: 'culinary_production',
    category: 'commissary_boh',
    unitsCount: 3,
    openCount: 3,
    alertCount: 0,
    units: [
      { id: 'u-501', code: 'COMM-MAIN', name: 'Central Commissary Warehouse', department: 'culinary_production', type: 'commissary', capacity: 5000, stadiumZone: 'Tunnel Level BOH', level: 'BOH', status: 'open' },
      { id: 'u-502', code: 'KITCH-MAIN', name: 'Main Production Prep Kitchen', department: 'culinary_production', type: 'production_kitchen', capacity: 4000, stadiumZone: 'Tunnel Level BOH', level: 'BOH', status: 'open' },
      { id: 'u-503', code: 'BAKERY-MAIN', name: 'Stadium Bakeshop & Pastry', department: 'culinary_production', type: 'production_kitchen', capacity: 2000, stadiumZone: 'Tunnel Level BOH', level: 'BOH', status: 'open' },
    ],
  },
];

interface Props {
  initialZoneId?: string;
  onSelectUnit?: (unit: StadiumZoneItem) => void;
  compact?: boolean;
}

export function StadiumVenueMap({ initialZoneId, onSelectUnit, compact = false }: Props) {
  const palette = useDesignTheme();
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(initialZoneId ?? null);
  const [activeUnit, setActiveUnit] = useState<StadiumZoneItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [zonesState, setZonesState] = useState<StadiumZoneData[]>(DEFAULT_STADIUM_ZONES);

  const selectedZone = useMemo(() => {
    return zonesState.find((z) => z.id === selectedZoneId) ?? null;
  }, [zonesState, selectedZoneId]);

  const filteredUnits = useMemo(() => {
    let list: StadiumZoneItem[] = [];
    if (selectedZone) {
      list = selectedZone.units;
    } else {
      list = zonesState.flatMap((z) => z.units);
    }

    if (departmentFilter !== 'all') {
      list = list.filter((u) => u.department === departmentFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((u) => u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q));
    }

    return list;
  }, [zonesState, selectedZone, departmentFilter, searchQuery]);

  const handleUnitPress = (unit: StadiumZoneItem) => {
    setActiveUnit(unit);
    onSelectUnit?.(unit);
  };

  const handleStatusChange = (unitId: string, newStatus: StadiumZoneItem['status']) => {
    setZonesState((prev) =>
      prev.map((zone) => ({
        ...zone,
        units: zone.units.map((u) => (u.id === unitId ? { ...u, status: newStatus } : u)),
        openCount: zone.units.filter((u) => (u.id === unitId ? newStatus === 'open' : u.status === 'open')).length,
        alertCount: zone.units.filter((u) => (u.id === unitId ? newStatus === 'incident' || newStatus === 'restricted' : u.status === 'incident' || u.status === 'restricted')).length,
      })),
    );
    if (activeUnit && activeUnit.id === unitId) {
      setActiveUnit({ ...activeUnit, status: newStatus });
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      {/* Stadium Top Bar & Breadcrumb Navigation */}
      <View style={[styles.topBar, { borderBottomColor: palette.divider }]}>
        <View style={styles.breadcrumbRow}>
          <Pressable
            onPress={() => setSelectedZoneId(null)}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 4 })}
          >
            <MaterialCommunityIcons name="stadium" size={18} color="#074426" />
            <CommandText palette={palette} variant="label" style={{ color: selectedZoneId ? palette.muted : '#074426' }}>
              STADIUM BOWL
            </CommandText>
          </Pressable>

          {selectedZone ? (
            <>
              <MaterialCommunityIcons name="chevron-right" size={18} color={palette.muted} />
              <CommandText palette={palette} variant="label" style={{ color: '#074426' }}>
                {selectedZone.code}
              </CommandText>
            </>
          ) : null}
        </View>

        {selectedZone ? (
          <Pressable
            onPress={() => setSelectedZoneId(null)}
            style={[styles.resetButton, { backgroundColor: palette.background, borderColor: palette.border }]}
          >
            <MaterialCommunityIcons name="arrow-left" size={14} color={palette.charcoal} />
            <CommandText palette={palette} variant="caption" style={{ fontWeight: '700' }}>All Zones</CommandText>
          </Pressable>
        ) : null}
      </View>

      {/* Level 1: Stadium Visual Bowl Schematic (Clickable Zones) */}
      {!selectedZone && (
        <View style={styles.bowlSection}>
          <View style={styles.fieldSchematic}>
            {/* 50 Yard Field Center */}
            <View style={styles.turfField}>
              <View style={styles.yardLine} />
              <View style={[styles.yardLine, { top: '50%' }]} />
              <View style={[styles.yardLine, { bottom: '0%' }]} />
              <CommandText palette={palette} variant="label" style={styles.turfText}>
                50 · TURF FIELD
              </CommandText>
            </View>

            {/* Clickable Stadium Zone Rings */}
            {/* North Concourse */}
            <Pressable
              onPress={() => setSelectedZoneId('zone-100-north')}
              style={({ pressed }) => [
                styles.zoneRing,
                styles.zoneNorth,
                { opacity: pressed ? 0.75 : 1, backgroundColor: '#074426' },
              ]}
            >
              <View style={styles.zonePillContent}>
                <CommandText palette={palette} variant="caption" style={styles.zoneTextWhite}>
                  NORTH 100 CONCOURSE (6 Stands)
                </CommandText>
                <View style={styles.alertBadge}><CommandText palette={palette} variant="caption" style={styles.badgeText}>1 Alert</CommandText></View>
              </View>
            </Pressable>

            {/* East Sideline */}
            <Pressable
              onPress={() => setSelectedZoneId('zone-100-east')}
              style={({ pressed }) => [
                styles.zoneRing,
                styles.zoneEast,
                { opacity: pressed ? 0.75 : 1, backgroundColor: '#0E5C36' },
              ]}
            >
              <CommandText palette={palette} variant="caption" style={styles.zoneTextWhite}>
                EAST SIDELINE 100 (5 Stands)
              </CommandText>
            </Pressable>

            {/* South Concourse */}
            <Pressable
              onPress={() => setSelectedZoneId('zone-100-south')}
              style={({ pressed }) => [
                styles.zoneRing,
                styles.zoneSouth,
                { opacity: pressed ? 0.75 : 1, backgroundColor: '#074426' },
              ]}
            >
              <CommandText palette={palette} variant="caption" style={styles.zoneTextWhite}>
                SOUTH 100 CONCOURSE (4 Stands)
              </CommandText>
            </Pressable>

            {/* West Sideline */}
            <Pressable
              onPress={() => setSelectedZoneId('zone-100-west')}
              style={({ pressed }) => [
                styles.zoneRing,
                styles.zoneWest,
                { opacity: pressed ? 0.75 : 1, backgroundColor: '#0E5C36' },
              ]}
            >
              <CommandText palette={palette} variant="caption" style={styles.zoneTextWhite}>
                WEST SIDELINE 100 (4 Stands)
              </CommandText>
            </Pressable>

            {/* Luxury Suites Tier Bar */}
            <Pressable
              onPress={() => setSelectedZoneId('zone-300-suites')}
              style={({ pressed }) => [
                styles.suiteTierButton,
                { opacity: pressed ? 0.75 : 1, backgroundColor: '#7A5A35' },
              ]}
            >
              <MaterialCommunityIcons name="shield-crown-outline" size={16} color="#FFFFFF" />
              <CommandText palette={palette} variant="caption" style={styles.zoneTextWhite}>
                300 LUXURY SUITES TOWER (8 Suites Active)
              </CommandText>
              <View style={styles.suitePill}><CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', fontWeight: '800' }}>VIP</CommandText></View>
            </Pressable>

            {/* 200 Club Level Tier Bar */}
            <Pressable
              onPress={() => setSelectedZoneId('zone-200-club')}
              style={({ pressed }) => [
                styles.clubTierButton,
                { opacity: pressed ? 0.75 : 1, backgroundColor: '#4C3B24' },
              ]}
            >
              <MaterialCommunityIcons name="glass-cocktail" size={16} color="#FFFFFF" />
              <CommandText palette={palette} variant="caption" style={styles.zoneTextWhite}>
                200 CLUB LEVEL & VIP LOUNGES (5 Lounges)
              </CommandText>
            </Pressable>
          </View>
        </View>
      )}

      {/* Filter & Search Bar */}
      <View style={[styles.filterBar, { borderBottomColor: palette.divider }]}>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search stand, suite, bar (e.g. Suite 304, Stand 101)…"
          dense
          mode="outlined"
          textColor={palette.charcoal}
          outlineColor={palette.border}
          activeOutlineColor="#074426"
          style={{ backgroundColor: palette.background, height: 38, fontSize: 13 }}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 4 }}>
          {[
            ['all', 'All Units'],
            ['concessions', '🌭 Concessions'],
            ['premium_hospitality', '🍾 Luxury Suites'],
            ['beverage_operations', '🍺 Bars & Carts'],
            ['culinary_production', '👨‍🍳 Kitchens & Commissary'],
          ].map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setDepartmentFilter(key)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: departmentFilter === key ? '#074426' : palette.background,
                  borderColor: departmentFilter === key ? '#074426' : palette.border,
                },
              ]}
            >
              <CommandText
                palette={palette}
                variant="caption"
                style={{ color: departmentFilter === key ? '#FFFFFF' : palette.charcoal, fontWeight: '700' }}
              >
                {label}
              </CommandText>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Level 2 / 3: Detailed Stand & Suite Cards Grid */}
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CommandText palette={palette} variant="label">
            {selectedZone ? selectedZone.name.toUpperCase() : `ALL STADIUM UNITS (${filteredUnits.length})`}
          </CommandText>
          <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
            Tap any unit to inspect BEO, stand sheet & status
          </CommandText>
        </View>

        <View style={styles.unitsGrid}>
          {filteredUnits.map((unit) => {
            const isSuite = unit.type === 'premium_suite' || unit.type === 'premium_club';
            const statusColor =
              unit.status === 'open' ? palette.success :
              unit.status === 'restricted' ? palette.warning :
              unit.status === 'incident' ? '#D32F2F' : palette.muted;

            return (
              <Pressable
                key={unit.id}
                onPress={() => handleUnitPress(unit)}
                style={({ pressed }) => [
                  styles.unitCard,
                  {
                    backgroundColor: palette.background,
                    borderColor: unit.status === 'incident' ? '#D32F2F' : palette.border,
                    borderLeftColor: statusColor,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <View style={styles.unitCardTop}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <MaterialCommunityIcons
                      name={isSuite ? 'glass-cocktail' : unit.type === 'bar' ? 'glass-mug-variant' : 'storefront-outline'}
                      size={18}
                      color="#074426"
                    />
                    <CommandText palette={palette} variant="body" style={{ fontWeight: '800' }}>
                      {unit.code}
                    </CommandText>
                  </View>
                  <View style={[styles.unitStatusDot, { backgroundColor: statusColor }]} />
                </View>

                <CommandText palette={palette} variant="body" style={{ fontWeight: '600' }}>
                  {unit.name}
                </CommandText>

                <View style={styles.unitMetaRow}>
                  <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                    {unit.stadiumZone || 'Concourse'}
                  </CommandText>
                  {isSuite && unit.suiteDetails?.hostName ? (
                    <CommandText palette={palette} variant="caption" style={{ color: '#7A5A35', fontWeight: '700' }}>
                      {unit.suiteDetails.hostName}
                    </CommandText>
                  ) : null}
                  {unit.standDetails?.terminalCount ? (
                    <CommandText palette={palette} variant="caption" style={{ color: '#074426', fontWeight: '700' }}>
                      {unit.standDetails.terminalCount} POS
                    </CommandText>
                  ) : null}
                </View>

                {unit.standDetails?.lowStockItems?.length ? (
                  <View style={styles.lowStockBadge}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={12} color="#D32F2F" />
                    <CommandText palette={palette} variant="caption" style={{ color: '#D32F2F', fontSize: 11 }}>
                      {unit.standDetails.lowStockItems[0]}
                    </CommandText>
                  </View>
                ) : null}

                {unit.suiteDetails?.replenishmentPending ? (
                  <View style={styles.replenishBadge}>
                    <MaterialCommunityIcons name="clock-alert-outline" size={12} color="#8A6B2D" />
                    <CommandText palette={palette} variant="caption" style={{ color: '#8A6B2D', fontSize: 11 }}>
                      Replenishment requested
                    </CommandText>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Unit Detail Modal */}
      <StadiumUnitDetailModal
        visible={Boolean(activeUnit)}
        unit={activeUnit}
        onClose={() => setActiveUnit(null)}
        onStatusChange={handleStatusChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  bowlSection: {
    padding: spacing.md,
    backgroundColor: '#0F2618',
    alignItems: 'center',
  },
  fieldSchematic: {
    width: '100%',
    maxWidth: 580,
    aspectRatio: 1.6,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#26543A',
    backgroundColor: '#071F13',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  turfField: {
    width: '46%',
    height: '52%',
    backgroundColor: '#1E6B3E',
    borderWidth: 1,
    borderColor: '#70A381',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  yardLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  turfText: {
    color: '#D9EBDD',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1,
  },
  zoneRing: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#397853',
  },
  zoneNorth: {
    top: 8,
    left: 16,
    right: 16,
  },
  zoneSouth: {
    bottom: 8,
    left: 16,
    right: 16,
  },
  zoneEast: {
    right: 8,
    top: '32%',
    bottom: '32%',
    width: '24%',
  },
  zoneWest: {
    left: 8,
    top: '32%',
    bottom: '32%',
    width: '24%',
  },
  zonePillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  zoneTextWhite: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 10,
    textAlign: 'center',
  },
  alertBadge: {
    backgroundColor: '#D32F2F',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  suiteTierButton: {
    position: 'absolute',
    top: 40,
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#B8976C',
  },
  suitePill: {
    backgroundColor: '#074426',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  clubTierButton: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#7A5A35',
  },
  filterBar: {
    padding: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    borderWidth: 1,
  },
  unitsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  unitCard: {
    width: '48%',
    minWidth: 150,
    flexGrow: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderLeftWidth: 4,
    padding: spacing.sm,
    gap: 4,
  },
  unitCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  unitStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  unitMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  lowStockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFEBEE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  replenishBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
});
