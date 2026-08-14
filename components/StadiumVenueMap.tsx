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
  category: 'luxury_suites' | 'club_level' | 'lower_bowl' | 'upper_deck' | 'commissary_boh';
  unitsCount: number;
  openCount: number;
  alertCount: number;
  units: StadiumZoneItem[];
}

const DEFAULT_STADIUM_ZONES: StadiumZoneData[] = [
  {
    id: 'zone-300-suites',
    name: '300 Luxury Suites & Owners Skyboxes',
    code: '300-SUITES',
    level: '3',
    department: 'premium_hospitality',
    category: 'luxury_suites',
    unitsCount: 6,
    openCount: 6,
    alertCount: 0,
    units: [
      {
        id: 'u-301',
        code: 'SUITE-301',
        name: 'Suite 301 · Founders Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 28,
        stadiumZone: 'West Suite Tower',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '301',
          suiteholder: 'Apex Global Technologies',
          tier: 'Founders Suite',
          hostName: 'Marcus Sterling (VP VIP Hospitality)',
          guestCount: 26,
          beoNumber: 'BEO-NFL-2026-901',
          beoPackageName: 'Touchdown Luxury Banquet & Raw Bar',
          menuPackage: 'Prime Rib carving board, artisanal sliders, chilled Gulf shrimp, premium open bar',
          attendantName: 'Sarah Jenkins (Lead Attendant)',
          beoPreOrders: [
            { id: 'po-301-1', name: 'Prime Rib Carving Station w/ Au Jus & Horseradish', quantity: 26, category: 'entree', status: 'delivered', scheduledTime: 'Kickoff - 30m' },
            { id: 'po-301-2', name: 'Jumbo Poached Gulf Shrimp Cocktail Platter', quantity: 2, category: 'appetizer', status: 'delivered', scheduledTime: 'Pre-Game', dietaryNotes: 'Contains Shellfish' },
            { id: 'po-301-3', name: 'Dom Pérignon Vintage Champagne (3 btls)', quantity: 3, category: 'bar', status: 'delivered', scheduledTime: 'Pre-Game' },
            { id: 'po-301-4', name: 'Artisanal Truffle Mac & Vermont White Cheddar', quantity: 2, category: 'entree', status: 'active', scheduledTime: 'Kickoff' },
            { id: 'po-301-5', name: 'Executive Pastry Chef Grand Dessert Cart', quantity: 26, category: 'dessert', status: 'prepped', scheduledTime: 'Halftime', dietaryNotes: 'Includes Nut-Free options' },
          ],
          inSuiteOrders: [
            { id: 'iso-301-1', orderedAt: '1:15 PM (Q1 08:42)', orderedBy: 'Suite Host Tablet', items: '2x Casamigos Reposado Carafe, 1x Extra Ice Bucket', totalCents: 24000, status: 'fulfilled' },
            { id: 'iso-301-2', orderedAt: '1:50 PM (Q2 02:15)', orderedBy: 'Attendant Alice T.', items: '1x Crispy Hot Wings Platter (30ct), 4x Diet Coke', totalCents: 9500, status: 'delivering' },
          ],
          inSeatOrders: [
            { id: 'seat-301-1', seatLocation: 'Suite 301 · Seat 1A', customerName: 'Marcus Sterling', orderedAt: '1:20 PM', items: '1x Prime Smashburger, 1x Craft IPA', totalCents: 3200, status: 'delivered', runnerName: 'Runner Marcus C.' },
            { id: 'seat-301-2', seatLocation: 'Suite 301 · Seat 2B', customerName: 'David K.', orderedAt: '1:45 PM', items: '1x Loaded Souvenir Nachos, 2x Sparkling Water', totalCents: 2800, status: 'fulfilling', runnerName: 'Runner Elena R.' },
          ],
          hierarchy: {
            director: { name: 'Eleanor Vance', title: 'VP of Premium Hospitality', radioChannel: 'Ch 1 - Executive' },
            manager: { name: 'Sarah Jenkins', title: 'Suite Level 300 Floor Manager', status: 'on_duty', radioChannel: 'Ch 4 - Suites North' },
            assignedStaff: [
              { name: 'Alice Taylor', role: 'Lead Suite Attendant', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
              { name: 'Marcus Chen', role: 'Hospitality Runner', status: 'on_duty', shift: '11:00 - Close', geofenceVerified: true },
              { name: 'Elena Rostova', role: 'Private Bartender', status: 'on_duty', shift: '11:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-302',
        code: 'SUITE-302',
        name: 'Suite 302 · Redline Capital Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 24,
        stadiumZone: 'West Suite Tower',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '302',
          suiteholder: 'Redline Private Capital',
          tier: 'Executive Luxury Suite',
          hostName: 'Victoria Hastings',
          guestCount: 22,
          beoNumber: 'BEO-NFL-2026-902',
          beoPackageName: 'Gridiron Gourmet Feast & Craft Spirits',
          menuPackage: 'Smoked tenderloin, hot honey chicken sliders, charcuterie tower, specialty cocktails',
          attendantName: 'David Miller (Lead)',
          beoPreOrders: [
            { id: 'po-302-1', name: 'Center-Cut Beef Tenderloin Carving Station', quantity: 22, category: 'entree', status: 'delivered', scheduledTime: 'Kickoff - 15m' },
            { id: 'po-302-2', name: 'Artisan Charcuterie & Import Cheese Tower', quantity: 2, category: 'appetizer', status: 'delivered', scheduledTime: 'Pre-Game' },
            { id: 'po-302-3', name: 'Veuve Clicquot Yellow Label (4 btls)', quantity: 4, category: 'bar', status: 'delivered', scheduledTime: 'Pre-Game' },
            { id: 'po-302-4', name: 'Bavarian Warm Pretzel Bites & Fondue', quantity: 22, category: 'appetizer', status: 'active', scheduledTime: 'Halftime' },
          ],
          inSuiteOrders: [
            { id: 'iso-302-1', orderedAt: '1:32 PM (Q1 02:18)', orderedBy: 'Attendant David M.', items: '1x Macallan 12yr Scotch Carafe, 2x Club Soda', totalCents: 26000, status: 'fulfilled' },
          ],
          inSeatOrders: [
            { id: 'seat-302-1', seatLocation: 'Suite 302 · Seat 3A', customerName: 'Victoria H.', orderedAt: '1:40 PM', items: '1x Grilled Chicken Caesar, 1x Espresso Martini', totalCents: 3400, status: 'delivered', runnerName: 'Runner David L.' },
          ],
          hierarchy: {
            director: { name: 'Eleanor Vance', title: 'VP of Premium Hospitality', radioChannel: 'Ch 1 - Executive' },
            manager: { name: 'Sarah Jenkins', title: 'Suite Level 300 Floor Manager', status: 'on_duty', radioChannel: 'Ch 4 - Suites North' },
            assignedStaff: [
              { name: 'David Miller', role: 'Lead Suite Attendant', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
              { name: 'David Lee', role: 'Hospitality Runner', status: 'on_duty', shift: '11:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-303',
        code: 'SUITE-303',
        name: 'Suite 303 · Delta SkySuite',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 24,
        stadiumZone: 'East Suite Tower',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '303',
          suiteholder: 'Delta Airlines VIP',
          tier: 'Presidential Suite',
          hostName: 'Gregory Vance',
          guestCount: 24,
          beoNumber: 'BEO-NFL-2026-903',
          beoPackageName: 'Championship Seafood & Prime Carving',
          menuPackage: 'Maine lobster rolls, wagyu sliders, craft cocktail bar, dessert flight',
          attendantName: 'Rachel Kim (Lead)',
        },
      },
      {
        id: 'u-304',
        code: 'SUITE-304',
        name: 'Suite 304 · Johnson Foundation Suite',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 20,
        stadiumZone: 'East Suite Tower',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '304',
          suiteholder: 'Johnson Family Trust',
          tier: 'Executive Luxury Suite',
          hostName: 'Arthur Johnson',
          guestCount: 18,
          beoNumber: 'BEO-NFL-2026-904',
          beoPackageName: 'Traditional Stadium Classic Hospitality',
          menuPackage: 'Gourmet burgers, bratwurst board, craft beer kegerator, pretzel bar',
          attendantName: 'Rachel Kim (Lead)',
        },
      },
      {
        id: 'u-305',
        code: 'SUITE-305',
        name: 'Suite 305 · Crown & Anchor Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 22,
        stadiumZone: 'North Suite Corridor',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '305',
          suiteholder: 'Crown & Anchor Partners',
          tier: 'Executive Luxury Suite',
          hostName: 'Siddharth Patel',
          guestCount: 20,
          beoNumber: 'BEO-NFL-2026-905',
          beoPackageName: 'Artisanal Smoked Meats & Raw Bar',
          menuPackage: 'Smoked brisket, crab claws, craft bourbon tasting, signature desserts',
          attendantName: 'Liam O’Connor',
        },
      },
      {
        id: 'u-306',
        code: 'SUITE-306',
        name: 'Suite 306 · Owners Club Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 32,
        stadiumZone: 'South Suite Corridor',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '306',
          suiteholder: 'Stadium Ownership Group',
          tier: 'Owners Grand Suite',
          hostName: 'Executive Host Staff',
          guestCount: 30,
          beoNumber: 'BEO-NFL-2026-906',
          beoPackageName: 'Master Chef Grand Reserve Banquet',
          menuPackage: 'Dry-aged tomahawk ribeye, caviar service, vintage champagne bar, artisan patisserie',
          attendantName: 'Elena Rostova (Lead)',
        },
      },
    ],
  },
  {
    id: 'zone-200-club',
    name: '200 Club Level & VIP Lounges',
    code: '200-CLUB',
    level: '2',
    department: 'premium_hospitality',
    category: 'club_level',
    unitsCount: 4,
    openCount: 4,
    alertCount: 0,
    units: [
      {
        id: 'u-201',
        code: 'CLUB-50',
        name: 'The 50-Yard Line Champions Club',
        department: 'premium_hospitality',
        type: 'premium_club',
        capacity: 1200,
        stadiumZone: 'Midfield Level 2',
        level: '2',
        status: 'open',
        suiteDetails: {
          suiteNumber: 'Club-50',
          suiteholder: 'Champions Club Members (Open Seating & Reserved Booths)',
          tier: 'VIP Club Lounge',
          hostName: 'Chef Julian Moretti',
          guestCount: 850,
          beoNumber: 'BEO-CLUB-2026-50',
          beoPackageName: 'Continuous Action Station & Chef Rotisserie',
          menuPackage: 'Live carving, artisan flatbreads, craft mixology, seafood bar',
          hierarchy: {
            director: { name: 'Eleanor Vance', title: 'VP of Premium Hospitality', radioChannel: 'Ch 1 - Exec' },
            manager: { name: 'Julian Moretti', title: 'Club Level Executive Manager', status: 'on_duty', radioChannel: 'Ch 3 - Club 50' },
            assignedStaff: [
              { name: 'Chloe Bennett', role: 'Captain', status: 'on_duty', shift: '09:00 - Close', geofenceVerified: true },
              { name: 'Samira Khan', role: 'Head Bartender', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-202',
        code: 'CABANA-FIELD',
        name: 'North Field Cabanas (Field Level)',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 160,
        stadiumZone: 'North Endzone Turf Level',
        level: '0',
        status: 'open',
        suiteDetails: {
          suiteNumber: 'Cabanas 1-8',
          suiteholder: 'Field Level Corporate Sponsors',
          tier: 'Field Level Cabana Box',
          hostName: 'Tessa Morgan',
          guestCount: 140,
          beoNumber: 'BEO-CABANA-2026-01',
          beoPackageName: 'Fieldside Grill & Chilled Beer Buckets',
          menuPackage: 'Smashburgers, grilled sausages, loaded street corn, craft beer coolers',
        },
      },
      {
        id: 'u-203',
        code: 'BAR-CLUB-EAST',
        name: 'East Sideline VIP Craft Lounge Bar',
        department: 'beverage_operations',
        type: 'bar',
        capacity: 450,
        stadiumZone: 'East Club Level',
        level: '2',
        status: 'open',
      },
      {
        id: 'u-204',
        code: 'BUFFET-CLUB-WEST',
        name: 'West Club Artisan Chef Carvery',
        department: 'premium_hospitality',
        type: 'premium_club',
        capacity: 600,
        stadiumZone: 'West Club Level',
        level: '2',
        status: 'open',
      },
    ],
  },
  {
    id: 'zone-100-lower',
    name: '100 Lower Bowl Concessions & Stands',
    code: '100-CONCOURSE',
    level: '1',
    department: 'concessions',
    category: 'lower_bowl',
    unitsCount: 5,
    openCount: 4,
    alertCount: 1,
    units: [
      {
        id: 'u-101',
        code: 'STAND-101',
        name: 'Gridiron Smokehouse BBQ',
        department: 'concessions',
        type: 'concession_stand',
        capacity: 1500,
        stadiumZone: 'North Concourse 100',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: '101',
          concept: 'Smoked Brisket, Pulled Pork & Drafts',
          terminalCount: 6,
          cashBeginningCents: 150000,
          cashGrossCents: 1240000,
          inSeatOrders: [
            { id: 'seat-101-1', seatLocation: 'Section 102 · Row 12 Seat 4', customerName: 'Jason P.', orderedAt: '1:18 PM', items: '2x Brisket Sandwiches, 2x Draft Beers', totalCents: 4400, status: 'delivered', runnerName: 'Runner Kevin B.' },
            { id: 'seat-101-2', seatLocation: 'Section 103 · Row 8 Seat 11', customerName: 'Amanda R.', orderedAt: '1:54 PM', items: '1x Pulled Pork Platter, 1x Soft Drink', totalCents: 2400, status: 'fulfilling', runnerName: 'Runner Kevin B.' },
          ],
          hierarchy: {
            director: { name: 'Robert King', title: 'Director of Concessions & Retail', radioChannel: 'Ch 2 - Concessions' },
            manager: { name: 'Carlos Gutierrez', title: '100 Level Stand Supervisor', status: 'on_duty', radioChannel: 'Ch 5 - Concourse North' },
            assignedStaff: [
              { name: 'Kevin Brown', role: 'Stand Lead', status: 'on_duty', shift: '10:30 - Close', geofenceVerified: true },
              { name: 'Maya Lin', role: 'Lead Cashier', status: 'on_duty', shift: '11:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-102',
        code: 'STAND-102',
        name: 'Touchdown Tacos & Tequila',
        department: 'concessions',
        type: 'concession_stand',
        capacity: 1200,
        stadiumZone: 'North Concourse 100',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: '102',
          concept: 'Street Tacos, Nachos & Canned Cocktails',
          terminalCount: 5,
          cashBeginningCents: 120000,
          cashGrossCents: 980000,
        },
      },
      {
        id: 'u-104',
        code: 'STAND-104',
        name: 'Gridiron Classic Dogs & Loaded Fries',
        department: 'concessions',
        type: 'concession_stand',
        capacity: 1800,
        stadiumZone: 'East Sideline 100',
        level: '1',
        status: 'restricted',
        standDetails: {
          standNumber: '104',
          concept: 'Jumbo Stadium Dogs & Loaded Fries',
          terminalCount: 6,
          cashBeginningCents: 150000,
          cashGrossCents: 890000,
          lowStockItems: ['Jumbo All-Beef Hot Dogs (8 par left)', 'Nacho Cheese Dispenser Bag'],
        },
      },
      {
        id: 'u-105',
        code: 'KIOSK-105',
        name: 'Express Grab & Go Market',
        department: 'concessions',
        type: 'grab_and_go',
        capacity: 900,
        stadiumZone: 'East Sideline 100',
        level: '1',
        status: 'open',
      },
      {
        id: 'u-106',
        code: 'BAR-106',
        name: 'Goal Line Craft Taphouse',
        department: 'beverage_operations',
        type: 'bar',
        capacity: 1100,
        stadiumZone: 'South Concourse 100',
        level: '1',
        status: 'open',
      },
    ],
  },
  {
    id: 'zone-400-upper',
    name: '400 Upper Deck Outlets & Portables',
    code: '400-UPPER',
    level: '4',
    department: 'concessions',
    category: 'upper_deck',
    unitsCount: 3,
    openCount: 3,
    alertCount: 0,
    units: [
      { id: 'u-401', code: 'STAND-401', name: 'Upper Deck Burger & Dog Station', department: 'concessions', type: 'concession_stand', capacity: 1400, stadiumZone: 'Upper Deck West', level: '4', status: 'open' },
      { id: 'u-402', code: 'CART-402', name: 'High Altitude Draft Beer Portable', department: 'beverage_operations', type: 'portable_cart', capacity: 600, stadiumZone: 'Upper Deck East', level: '4', status: 'open' },
      { id: 'u-403', code: 'KIOSK-403', name: 'Sky High Snack & Pretzel Kiosk', department: 'concessions', type: 'grab_and_go', capacity: 750, stadiumZone: 'Upper Deck North', level: '4', status: 'open' },
    ],
  },
  {
    id: 'zone-boh-kitchen',
    name: 'Commissary, Bakery & Prep Kitchens (BOH)',
    code: 'BOH-COMMISSARY',
    level: 'BOH',
    department: 'culinary_production',
    category: 'commissary_boh',
    unitsCount: 3,
    openCount: 3,
    alertCount: 0,
    units: [
      { id: 'u-501', code: 'COMM-MAIN', name: 'Central Commissary Distribution Warehouse', department: 'culinary_production', type: 'commissary', capacity: 5000, stadiumZone: 'Tunnel Level BOH', level: 'BOH', status: 'open' },
      { id: 'u-502', code: 'KITCH-MAIN', name: 'Main Production Prep Kitchen', department: 'culinary_production', type: 'production_kitchen', capacity: 4000, stadiumZone: 'Tunnel Level BOH', level: 'BOH', status: 'open' },
      { id: 'u-503', code: 'BAKERY-MAIN', name: 'Stadium Bakeshop & Pastry Facility', department: 'culinary_production', type: 'production_kitchen', capacity: 2000, stadiumZone: 'Tunnel Level BOH', level: 'BOH', status: 'open' },
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
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(initialZoneId ?? 'zone-300-suites');
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [activeUnit, setActiveUnit] = useState<StadiumZoneItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    luxury_suites: true,
    club_level: true,
    lower_bowl: true,
    upper_deck: false,
    commissary_boh: false,
  });
  const [zonesState, setZonesState] = useState<StadiumZoneData[]>(DEFAULT_STADIUM_ZONES);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleUnitPress = (unit: StadiumZoneItem, zoneId?: string) => {
    setSelectedUnitId(unit.id);
    if (zoneId) setSelectedZoneId(zoneId);
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

  // Group zones into categories for the running sidebar list
  const categoryGroups = useMemo(() => {
    const categories: Record<string, { label: string; icon: string; zones: StadiumZoneData[] }> = {
      luxury_suites: { label: 'Luxury Suites & Owners Boxes (300 Level)', icon: 'glass-cocktail', zones: [] },
      club_level: { label: 'Club Lounges & VIP (200 Level)', icon: 'trophy-award', zones: [] },
      lower_bowl: { label: 'Lower Bowl Concessions & Bars (100 Level)', icon: 'food-hot-dog', zones: [] },
      upper_deck: { label: 'Upper Deck Outlets & Portables (400 Level)', icon: 'stairs', zones: [] },
      commissary_boh: { label: 'Commissary & Prep Kitchens (BOH)', icon: 'chef-hat', zones: [] },
    };

    zonesState.forEach((zone) => {
      if (categories[zone.category]) {
        categories[zone.category].zones.push(zone);
      }
    });

    return categories;
  }, [zonesState]);

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF', borderColor: palette.border }]}>
      {/* Search and Operational Bar */}
      <View style={[styles.topSearchBar, { borderBottomColor: palette.divider }]}>
        <View style={styles.searchRow}>
          <TextInput
            placeholder="Search by Suite #, Suiteholder, BEO item, Stand, or Staff..."
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
        </View>
      </View>

      {/* Main Operations Split Layout */}
      <View style={styles.mainLayout}>
        {/* LEFT / TOP: Categorized Dropdown Sidebar */}
        <View style={[styles.sidebarList, { borderRightColor: palette.divider }]}>
          <View style={[styles.sidebarHeader, { borderBottomColor: palette.divider }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialCommunityIcons name="format-list-group" size={18} color="#17643B" />
              <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800' }}>
                OUTLETS & SPACES BY CATEGORY
              </CommandText>
            </View>
            <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>
              Click any room to highlight on map
            </CommandText>
          </View>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {Object.entries(categoryGroups).map(([catKey, catData]) => {
              const isExpanded = expandedCategories[catKey] ?? true;
              const allUnitsInCat = catData.zones.flatMap((z) => z.units);
              const filteredInCat = searchQuery.trim()
                ? allUnitsInCat.filter((u) =>
                    u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    u.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    u.suiteDetails?.suiteholder?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    u.suiteDetails?.beoPackageName?.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                : allUnitsInCat;

              if (searchQuery.trim() && filteredInCat.length === 0) return null;

              return (
                <View key={catKey} style={[styles.categoryAccordion, { borderBottomColor: palette.divider }]}>
                  <Pressable
                    onPress={() => toggleCategory(catKey)}
                    style={({ pressed }) => [styles.categoryHeader, { opacity: pressed ? 0.7 : 1, backgroundColor: '#F7F7F4' }]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <MaterialCommunityIcons name={catData.icon as any} size={18} color="#17643B" />
                      <CommandText palette={palette} variant="body" style={{ fontWeight: '700', fontSize: 13, color: '#1D2420', flex: 1 }}>
                        {catData.label}
                      </CommandText>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={styles.countBadge}>
                        <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '700', fontSize: 11 }}>
                          {filteredInCat.length}
                        </CommandText>
                      </View>
                      <MaterialCommunityIcons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#68706A" />
                    </View>
                  </Pressable>

                  {isExpanded ? (
                    <View style={styles.unitsSublist}>
                      {filteredInCat.map((unit) => {
                        const isSelected = selectedUnitId === unit.id;
                        const hasBeo = Boolean(unit.suiteDetails?.beoNumber);
                        const hasInSeat = Boolean(unit.suiteDetails?.inSeatOrders?.length || unit.standDetails?.inSeatOrders?.length);

                        return (
                          <Pressable
                            key={unit.id}
                            onPress={() => handleUnitPress(unit)}
                            style={({ pressed }) => [
                              styles.unitSidebarItem,
                              {
                                opacity: pressed ? 0.7 : 1,
                                backgroundColor: isSelected ? '#EEF5F0' : '#FFFFFF',
                                borderColor: isSelected ? '#17643B' : '#E5E8E2',
                              },
                            ]}
                          >
                            <View style={{ flex: 1, gap: 2 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <CommandText palette={palette} variant="caption" style={{ fontWeight: '800', color: isSelected ? '#17643B' : '#1D2420' }}>
                                  {unit.code}
                                </CommandText>
                                <StatusPill palette={palette} tone={unit.status === 'open' ? 'good' : unit.status === 'incident' ? 'danger' : 'warn'}>
                                  {unit.status.toUpperCase()}
                                </StatusPill>
                                {hasBeo ? (
                                  <View style={styles.beoIndicator}>
                                    <CommandText palette={palette} variant="caption" style={{ color: '#8A5D23', fontSize: 10, fontWeight: '700' }}>
                                      BEO READY
                                    </CommandText>
                                  </View>
                                ) : null}
                              </View>
                              <CommandText palette={palette} variant="body" style={{ fontWeight: '600', fontSize: 13, color: '#1D2420' }}>
                                {unit.name}
                              </CommandText>
                              {unit.suiteDetails?.suiteholder ? (
                                <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontWeight: '600' }}>
                                  Holder: {unit.suiteDetails.suiteholder}
                                </CommandText>
                              ) : null}
                              {hasInSeat ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                  <MaterialCommunityIcons name="seat-passenger" size={12} color="#17643B" />
                                  <CommandText palette={palette} variant="caption" style={{ color: '#17643B', fontSize: 11 }}>
                                    Active In-Seat Orders
                                  </CommandText>
                                </View>
                              ) : null}
                            </View>
                            <MaterialCommunityIcons name="chevron-right" size={18} color={isSelected ? '#17643B' : '#B8C2BA'} />
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

        {/* RIGHT / MAIN: Visual Stadium Operations Map Canvas */}
        <View style={styles.mapCanvas}>
          <View style={[styles.canvasHeader, { borderBottomColor: palette.divider }]}>
            <View>
              <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800' }}>
                INTERACTIVE STADIUM FLOORPLAN
              </CommandText>
              <CommandText palette={palette} variant="caption" style={{ color: '#68706A' }}>
                Tap sections, suites, or club levels to inspect real-time BEO menus, in-seat orders, and staff
              </CommandText>
            </View>

            {/* Level Selector Pills */}
            <View style={styles.levelFilterRow}>
              {zonesState.map((zone) => {
                const isZoneActive = selectedZoneId === zone.id;
                return (
                  <Pressable
                    key={zone.id}
                    onPress={() => setSelectedZoneId(zone.id)}
                    style={[
                      styles.levelPill,
                      {
                        backgroundColor: isZoneActive ? '#17643B' : '#F7F7F4',
                        borderColor: isZoneActive ? '#17643B' : '#DDE1DA',
                      },
                    ]}
                  >
                    <CommandText palette={palette} variant="caption" style={{ color: isZoneActive ? '#FFFFFF' : '#1D2420', fontWeight: '700' }}>
                      {zone.code}
                    </CommandText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Interactive Visual Map Layout */}
          <ScrollView horizontal={false} contentContainerStyle={styles.stadiumBowlContainer}>
            {/* Visual Stadium Oval Layout */}
            <View style={styles.stadiumOval}>
              {/* Center Field Representation */}
              <View style={styles.playingField}>
                <View style={styles.fieldYardLine} />
                <View style={styles.fieldMidfield}>
                  <CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', fontWeight: '900', letterSpacing: 2 }}>
                    VENUE WRANGLER FIELD
                  </CommandText>
                </View>
                <View style={styles.fieldYardLine} />
              </View>

              {/* Suites & Stands Overlay Grid */}
              <View style={styles.zonesGrid}>
                {zonesState.map((zone) => {
                  const isZoneFocused = selectedZoneId === zone.id;

                  return (
                    <View
                      key={zone.id}
                      style={[
                        styles.zoneCardOverlay,
                        {
                          borderColor: isZoneFocused ? '#17643B' : '#DDE1DA',
                          borderWidth: isZoneFocused ? 2 : 1,
                          backgroundColor: isZoneFocused ? '#F4FAF6' : '#FFFFFF',
                        },
                      ]}
                    >
                      <View style={styles.zoneCardHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <MaterialCommunityIcons
                            name={zone.category === 'luxury_suites' ? 'glass-cocktail' : zone.category === 'club_level' ? 'trophy-award' : 'storefront-outline'}
                            size={16}
                            color="#17643B"
                          />
                          <CommandText palette={palette} variant="label" style={{ color: '#17643B', fontWeight: '800' }}>
                            {zone.name}
                          </CommandText>
                        </View>
                        <StatusPill palette={palette} tone={zone.alertCount > 0 ? 'warn' : 'good'}>
                          {zone.unitsCount} OUTLETS
                        </StatusPill>
                      </View>

                      {/* Units within Zone */}
                      <View style={styles.unitBadgesGrid}>
                        {zone.units.map((unit) => {
                          const isUnitSelected = selectedUnitId === unit.id;
                          const hasBeo = Boolean(unit.suiteDetails?.beoNumber);

                          return (
                            <Pressable
                              key={unit.id}
                              onPress={() => handleUnitPress(unit, zone.id)}
                              style={({ pressed }) => [
                                styles.unitInteractiveBadge,
                                {
                                  opacity: pressed ? 0.7 : 1,
                                  backgroundColor: isUnitSelected ? '#17643B' : '#FFFFFF',
                                  borderColor: isUnitSelected ? '#17643B' : '#DDE1DA',
                                },
                              ]}
                            >
                              <CommandText
                                palette={palette}
                                variant="caption"
                                style={{
                                  color: isUnitSelected ? '#FFFFFF' : '#1D2420',
                                  fontWeight: '700',
                                  fontSize: 12,
                                }}
                              >
                                {unit.code}
                              </CommandText>
                              {unit.suiteDetails?.suiteholder ? (
                                <CommandText
                                  palette={palette}
                                  variant="caption"
                                  style={{
                                    color: isUnitSelected ? '#D9EBDD' : '#68706A',
                                    fontSize: 10,
                                    maxWidth: 110,
                                  }}
                                >
                                  {unit.suiteDetails.suiteholder}
                                </CommandText>
                              ) : null}
                              {hasBeo ? (
                                <View style={[styles.beoDot, { backgroundColor: isUnitSelected ? '#E1A853' : '#17643B' }]} />
                              ) : null}
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        </View>
      </View>

      {/* Comprehensive Operational Detail Modal / Drawer */}
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
  topSearchBar: {
    padding: spacing.sm,
    borderBottomWidth: 1,
    backgroundColor: '#FFFFFF',
  },
  searchRow: {
    width: '100%',
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    fontSize: 13,
  },
  mainLayout: {
    flexDirection: 'row',
    minHeight: 640,
  },
  sidebarList: {
    width: '38%',
    maxWidth: 380,
    minWidth: 280,
    borderRightWidth: 1,
    backgroundColor: '#FFFFFF',
  },
  sidebarHeader: {
    padding: spacing.sm,
    borderBottomWidth: 1,
    gap: 2,
    backgroundColor: '#FAF7F0',
  },
  categoryAccordion: {
    borderBottomWidth: 1,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  countBadge: {
    backgroundColor: '#EEF5F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  unitsSublist: {
    padding: spacing.xs,
    gap: spacing.xs,
    backgroundColor: '#FAF8F5',
  },
  unitSidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
  },
  beoIndicator: {
    backgroundColor: '#FFF4DE',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  mapCanvas: {
    flex: 1,
    backgroundColor: '#FDFBF7',
  },
  canvasHeader: {
    padding: spacing.sm,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    backgroundColor: '#FFFFFF',
  },
  levelFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  levelPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  stadiumBowlContainer: {
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stadiumOval: {
    width: '100%',
    maxWidth: 820,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#17643B',
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    gap: spacing.md,
  },
  playingField: {
    height: 100,
    borderRadius: 12,
    backgroundColor: '#074426',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  fieldYardLine: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  fieldMidfield: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  zonesGrid: {
    gap: spacing.md,
  },
  zoneCardOverlay: {
    borderRadius: 10,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  zoneCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  unitBadgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  unitInteractiveBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    gap: 2,
    position: 'relative',
  },
  beoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    position: 'absolute',
    top: 4,
    right: 4,
  },
});
