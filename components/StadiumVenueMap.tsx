import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TextInput } from 'react-native-paper';
import { CommandButton, CommandText, StatusPill } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';
import { useResponsive } from '../lib/responsive';
import { StadiumUnitDetailModal, type StadiumZoneItem } from './StadiumUnitDetailModal';

export interface StadiumZoneData {
  id: string;
  name: string;
  code: string;
  level: string;
  department: string;
  category:
    | 'field_sidelines'
    | 'concourse_bunkers'
    | 'concourse_service_areas'
    | 'locker_rooms_aux'
    | 'luxury_suites'
    | 'club_level'
    | 'upper_deck'
    | 'stadium_gates'
    | 'commissary_boh';
  unitsCount: number;
  openCount: number;
  alertCount: number;
  units: StadiumZoneItem[];
}

export const COMPREHENSIVE_STADIUM_ZONES: StadiumZoneData[] = [
  // ── 1. FIELD, SIDELINES & ENDZONES ──────────────────────────────────────
  {
    id: 'zone-field-sidelines',
    name: 'Field Level, Sidelines & Endzones',
    code: 'FIELD-SIDE',
    level: '0',
    department: 'field_operations',
    category: 'field_sidelines',
    unitsCount: 4,
    openCount: 4,
    alertCount: 0,
    units: [
      {
        id: 'u-side-home',
        code: 'SIDE-HOME',
        name: 'Home Sideline Service Area & Hydration Station',
        department: 'field_operations',
        type: 'sideline_service_area',
        capacity: 120,
        stadiumZone: 'West Field Perimeter',
        level: '0',
        status: 'open',
        standDetails: {
          standNumber: 'SIDE-H-01',
          concept: 'Team Performance Hydration & VIP Sideline Hospitality',
          terminalCount: 2,
          cashGrossCents: 450000,
          inSeatOrders: [
            { id: 'side-h-1', seatLocation: 'Home Sideline Bench VIP 1', customerName: 'Team Ops Lead', orderedAt: '1:10 PM', items: '24x Electrolyte Carafes, 12x Chilled Towels', totalCents: 0, status: 'delivered', runnerName: 'Runner David K.' },
            { id: 'side-h-2', seatLocation: 'Home Bench Row A', customerName: 'Media VIP Passholder', orderedAt: '1:35 PM', items: '2x Cold Brew, 2x Protein Fuel Packs', totalCents: 2400, status: 'delivered', runnerName: 'Runner David K.' },
          ],
          hierarchy: {
            director: { name: 'Derrick Vance', title: 'Director of Field & Gameday Operations', radioChannel: 'Ch 2 - Field Command' },
            manager: { name: 'Tariq Al-Mansoor', title: 'Sideline & Tunnel Operations Manager', status: 'on_duty', radioChannel: 'Ch 2 - Field Command' },
            assignedStaff: [
              { name: 'David Kim', role: 'Lead Field Hospitality Runner', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
              { name: 'Samantha Cruz', role: 'Sideline Hydration Attendant', status: 'on_duty', shift: '10:30 - Close', geofenceVerified: true },
              { name: 'Leo Martinez', role: 'Field Access Credential Escort', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-side-visiting',
        code: 'SIDE-VISIT',
        name: 'Visiting Sideline Service Area & Media Deck',
        department: 'field_operations',
        type: 'sideline_service_area',
        capacity: 120,
        stadiumZone: 'East Field Perimeter',
        level: '0',
        status: 'open',
        standDetails: {
          standNumber: 'SIDE-V-01',
          concept: 'Visiting Team Bench Service & Broadcast Crew Support',
          terminalCount: 2,
          cashGrossCents: 380000,
          inSeatOrders: [
            { id: 'side-v-1', seatLocation: 'Visiting Bench Station 2', customerName: 'Visiting Equipment Staff', orderedAt: '1:15 PM', items: '16x Isotonic Water Packs, Fresh Fruit Trays', totalCents: 0, status: 'delivered', runnerName: 'Runner Chloe B.' },
            { id: 'side-v-2', seatLocation: 'Field Broadcast Camera 4', customerName: 'Network Director', orderedAt: '1:40 PM', items: '4x Espresso Cans, 2x Chicken Wraps', totalCents: 3600, status: 'fulfilling', runnerName: 'Runner Chloe B.' },
          ],
          hierarchy: {
            director: { name: 'Derrick Vance', title: 'Director of Field & Gameday Operations', radioChannel: 'Ch 2 - Field Command' },
            manager: { name: 'Tariq Al-Mansoor', title: 'Sideline & Tunnel Operations Manager', status: 'on_duty', radioChannel: 'Ch 2 - Field Command' },
            assignedStaff: [
              { name: 'Chloe Bennett', role: 'Visiting Sideline Runner', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
              { name: 'Andre Washington', role: 'Broadcast Hospitality Attendant', status: 'on_duty', shift: '10:30 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-endzone-north',
        code: 'ENDZONE-N',
        name: 'North Endzone Goalpost Lounge & Mobile Depot',
        department: 'field_hospitality',
        type: 'endzone_lounge',
        capacity: 250,
        stadiumZone: 'North Field Endzone',
        level: '0',
        status: 'open',
        standDetails: {
          standNumber: 'EZ-N-100',
          concept: 'Field-Level Goalpost Bar & Endzone In-Seat Dispatch',
          terminalCount: 4,
          cashGrossCents: 890000,
          inSeatOrders: [
            { id: 'ez-n-1', seatLocation: 'North Endzone Field Row 1, Seat 12', customerName: 'Brandon Ross', orderedAt: '1:22 PM', items: '2x Double Smashburger, 2x Draft Hazy IPA', totalCents: 4800, status: 'delivered', runnerName: 'Runner Maya S.' },
            { id: 'ez-n-2', seatLocation: 'North Endzone Field Row 2, Seat 4', customerName: 'Jessica Taylor', orderedAt: '1:48 PM', items: '1x Loaded Pulled Pork Nachos, 2x Souvenir Soda', totalCents: 3400, status: 'fulfilling', runnerName: 'Runner Maya S.' },
          ],
          hierarchy: {
            director: { name: 'Eleanor Vance', title: 'VP of Premium Hospitality', radioChannel: 'Ch 1 - Executive' },
            manager: { name: 'Jason Sterling', title: 'Field Clubs & Endzone Manager', status: 'on_duty', radioChannel: 'Ch 3 - Concourse North' },
            assignedStaff: [
              { name: 'Maya Santos', role: 'Lead Field Runner', status: 'on_duty', shift: '11:00 - Close', geofenceVerified: true },
              { name: 'Craig O’Connor', role: 'Head Bartender', status: 'on_duty', shift: '11:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-endzone-south',
        code: 'ENDZONE-S',
        name: 'South Endzone Touchdown Terrace & Fan Deck',
        department: 'field_hospitality',
        type: 'endzone_lounge',
        capacity: 300,
        stadiumZone: 'South Field Endzone',
        level: '0',
        status: 'open',
        standDetails: {
          standNumber: 'EZ-S-100',
          concept: 'Open-Air Field Bar & High-Volume Mobile Order Pickup',
          terminalCount: 6,
          cashGrossCents: 1120000,
          inSeatOrders: [
            { id: 'ez-s-1', seatLocation: 'South Endzone Row 1, Seat 18', customerName: 'Tyler Hayes', orderedAt: '1:18 PM', items: '3x Craft Draft Lager, 1x Giant Bavarian Pretzel', totalCents: 5200, status: 'delivered', runnerName: 'Runner Liam P.' },
            { id: 'ez-s-2', seatLocation: 'South Endzone Row 3, Seat 8', customerName: 'Kelly Green', orderedAt: '1:52 PM', items: '2x Crispy Tenders Basket, 2x Lemonade', totalCents: 3800, status: 'fulfilling', runnerName: 'Runner Liam P.' },
          ],
          hierarchy: {
            director: { name: 'Eleanor Vance', title: 'VP of Premium Hospitality', radioChannel: 'Ch 1 - Executive' },
            manager: { name: 'Jason Sterling', title: 'Field Clubs & Endzone Manager', status: 'on_duty', radioChannel: 'Ch 3 - Concourse North' },
            assignedStaff: [
              { name: 'Liam Patel', role: 'Lead Field Runner', status: 'on_duty', shift: '11:00 - Close', geofenceVerified: true },
              { name: 'Zoe Morales', role: 'Bar Attendant', status: 'on_duty', shift: '11:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
    ],
  },

  // ── 2. CONCOURSE TWO BUNKERS ────────────────────────────────────────────
  {
    id: 'zone-concourse-bunkers',
    name: 'Concourse VIP Field Bunkers (2)',
    code: 'BUNKERS-100',
    level: '1',
    department: 'premium_hospitality',
    category: 'concourse_bunkers',
    unitsCount: 2,
    openCount: 2,
    alertCount: 0,
    units: [
      {
        id: 'u-bunker-north',
        code: 'BUNKER-NORTH',
        name: 'North Bunker Club & Field Vault',
        department: 'premium_hospitality',
        type: 'concourse_bunker',
        capacity: 180,
        stadiumZone: 'North Concourse Level 100 Tunnel Access',
        level: '1',
        status: 'open',
        suiteDetails: {
          suiteNumber: 'BUNKER-N',
          suiteholder: 'Founders Club Members & Field Suite All-Access',
          tier: 'Sub-Field Luxury Bunker',
          hostName: 'Chef Antoine DuBois (Executive Chef)',
          guestCount: 165,
          beoNumber: 'BEO-BUNKER-2026-N01',
          beoPackageName: 'Chef Action Carving & Top-Shelf Bourbon Vault',
          menuPackage: 'A5 Wagyu carving board, chilled King Crab legs, artisanal charcuterie, Allocated Bourbon & Champagne bar',
          attendantName: 'Rachel Green (Lead Sommelier)',
          beoPreOrders: [
            { id: 'bn-1', name: 'A5 Miyazaki Wagyu Strip Carving Station', quantity: 150, category: 'entree', status: 'delivered', scheduledTime: 'Kickoff - 45m' },
            { id: 'bn-2', name: 'Colossal Alaskan King Crab & Raw Bar Tower', quantity: 4, category: 'appetizer', status: 'delivered', scheduledTime: 'Pre-Game', dietaryNotes: 'Shellfish' },
            { id: 'bn-3', name: 'Pappy Van Winkle & Blanton’s Flight Bar', quantity: 180, category: 'bar', status: 'active', scheduledTime: 'All Game' },
            { id: 'bn-4', name: 'Warm Molten Valrhona Chocolate Lava Cakes', quantity: 150, category: 'dessert', status: 'prepped', scheduledTime: 'Halftime' },
          ],
          inSuiteOrders: [
            { id: 'iso-bn-1', orderedAt: '1:12 PM', orderedBy: 'Member Table 4', items: '2x Macallan 18yr Neat, 1x Osetra Caviar Service', totalCents: 45000, status: 'fulfilled' },
            { id: 'iso-bn-2', orderedAt: '1:45 PM', orderedBy: 'Member Table 8', items: '1x Truffle Fries Board, 2x Veuve Clicquot', totalCents: 32000, status: 'delivering' },
          ],
          hierarchy: {
            director: { name: 'Eleanor Vance', title: 'VP of Premium Hospitality', radioChannel: 'Ch 1 - Executive' },
            manager: { name: 'Dominic Rossi', title: 'Bunker Clubs General Manager', status: 'on_duty', radioChannel: 'Ch 5 - Bunker VIP' },
            assignedStaff: [
              { name: 'Rachel Green', role: 'Lead Sommelier & Host', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
              { name: 'Sean Connolly', role: 'Master Mixologist', status: 'on_duty', shift: '10:30 - Close', geofenceVerified: true },
              { name: 'Katelyn Miller', role: 'VIP Floor Attendant', status: 'on_duty', shift: '11:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-bunker-south',
        code: 'BUNKER-SOUTH',
        name: 'South Bunker Founders Lounge & Taproom',
        department: 'premium_hospitality',
        type: 'concourse_bunker',
        capacity: 160,
        stadiumZone: 'South Concourse Level 100 Tunnel Access',
        level: '1',
        status: 'open',
        suiteDetails: {
          suiteNumber: 'BUNKER-S',
          suiteholder: 'Apex Chairman & Legacy Suite Syndicate',
          tier: 'Sub-Field Luxury Bunker',
          hostName: 'Danielle Brooks',
          guestCount: 140,
          beoNumber: 'BEO-BUNKER-2026-S02',
          beoPackageName: 'Smoked Prime Brisket & Craft Reserve Taproom',
          menuPackage: '16-hr smoked Texas brisket, lobster mac & cheese, craft beer cellar, artisanal cocktail station',
          attendantName: 'Gabriel Torres (Lead Attendant)',
          beoPreOrders: [
            { id: 'bs-1', name: 'Texas Prime Brisket & Jalapeno Sausage Spread', quantity: 140, category: 'entree', status: 'delivered', scheduledTime: 'Kickoff - 30m' },
            { id: 'bs-2', name: 'Maine Lobster Mac & Cheese Skillets', quantity: 140, category: 'entree', status: 'delivered', scheduledTime: 'Kickoff' },
            { id: 'bs-3', name: 'Craft IPA & Microbrew Tasting Wall (12 Taps)', quantity: 140, category: 'bar', status: 'active', scheduledTime: 'All Game' },
            { id: 'bs-4', name: 'Artisan Bourbon Pecan Pie with Sweet Cream', quantity: 140, category: 'dessert', status: 'prepped', scheduledTime: 'Halftime' },
          ],
          inSuiteOrders: [
            { id: 'iso-bs-1', orderedAt: '1:25 PM', orderedBy: 'Bunker South Lounge Table 2', items: '1x Don Julio 1942 Bottle Service', totalCents: 48000, status: 'fulfilled' },
          ],
          hierarchy: {
            director: { name: 'Eleanor Vance', title: 'VP of Premium Hospitality', radioChannel: 'Ch 1 - Executive' },
            manager: { name: 'Dominic Rossi', title: 'Bunker Clubs General Manager', status: 'on_duty', radioChannel: 'Ch 5 - Bunker VIP' },
            assignedStaff: [
              { name: 'Gabriel Torres', role: 'Lead Attendant', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
              { name: 'Amber Lewis', role: 'Private Bartender', status: 'on_duty', shift: '10:30 - Close', geofenceVerified: true },
            ],
          },
        },
      },
    ],
  },

  // ── 3. CONCOURSE 8 SERVICE AREAS THROUGHOUT ─────────────────────────────
  {
    id: 'zone-concourse-service-areas',
    name: 'Concourse 100 Service Areas (8 Outlets)',
    code: 'CONC-8-AREAS',
    level: '1',
    department: 'concessions',
    category: 'concourse_service_areas',
    unitsCount: 8,
    openCount: 8,
    alertCount: 0,
    units: [
      {
        id: 'u-c101',
        code: 'SVC-101',
        name: 'East Concourse 101 · Yardline Smokehouse & BBQ',
        department: 'concessions',
        type: 'concourse_service_area',
        capacity: null,
        stadiumZone: 'East Concourse 100',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: 'ST-101',
          concept: 'Oak-Smoked Brisket, Pulled Pork, BBQ Platters',
          terminalCount: 6,
          cashBeginningCents: 60000,
          cashGrossCents: 1420000,
          lowStockItems: ['Apple Cider Slaw (8 portions remaining)'],
          inSeatOrders: [
            { id: 'c101-1', seatLocation: 'Sec 102, Row 14, Seat 5', customerName: 'Adam Reed', orderedAt: '1:24 PM', items: '2x Brisket Sandwich Combo, 2x Draft Beer', totalCents: 4400, status: 'delivered', runnerName: 'Runner Ben G.' },
          ],
          hierarchy: {
            director: { name: 'Marcus Sterling', title: 'Director of General Concessions', radioChannel: 'Ch 3 - Concessions Main' },
            manager: { name: 'Carlos Gutierrez', title: 'East Concourse 100 Stand Manager', status: 'on_duty', radioChannel: 'Ch 3 - Concessions Main' },
            assignedStaff: [
              { name: 'Ben Garcia', role: 'Head Smoke Cook', status: 'on_duty', shift: '09:30 - Close', geofenceVerified: true },
              { name: 'Hannah Wright', role: 'Cashier & POS Operator', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
              { name: 'Tony Vance', role: 'Expediter', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-c103',
        code: 'SVC-103',
        name: 'East Concourse 103 · Craft Beer & Draft Express Hub',
        department: 'concessions',
        type: 'concourse_service_area',
        capacity: null,
        stadiumZone: 'East Concourse 100',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: 'ST-103',
          concept: '24-Tap High-Speed Draft & Hard Seltzer Bar',
          terminalCount: 8,
          cashBeginningCents: 80000,
          cashGrossCents: 2150000,
          hierarchy: {
            director: { name: 'Marcus Sterling', title: 'Director of General Concessions', radioChannel: 'Ch 3 - Concessions Main' },
            manager: { name: 'Carlos Gutierrez', title: 'East Concourse 100 Stand Manager', status: 'on_duty', radioChannel: 'Ch 3 - Concessions Main' },
            assignedStaff: [
              { name: 'Samantha Cole', role: 'Lead Pour Master', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
              { name: 'Jordan Rivera', role: 'Draft Technician', status: 'on_duty', shift: '09:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-c108',
        code: 'SVC-108',
        name: 'North Concourse 108 · Goalpost Tacos & Cantina',
        department: 'concessions',
        type: 'concourse_service_area',
        capacity: null,
        stadiumZone: 'North Concourse 100',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: 'ST-108',
          concept: 'Birria Tacos, Street Corn, Frozen Margaritas',
          terminalCount: 6,
          cashBeginningCents: 60000,
          cashGrossCents: 1680000,
          hierarchy: {
            director: { name: 'Marcus Sterling', title: 'Director of General Concessions', radioChannel: 'Ch 3 - Concessions Main' },
            manager: { name: 'Valerie Gomez', title: 'North Concourse Stand Manager', status: 'on_duty', radioChannel: 'Ch 4 - Concessions North' },
            assignedStaff: [
              { name: 'Mateo Silva', role: 'Line Chef', status: 'on_duty', shift: '09:30 - Close', geofenceVerified: true },
              { name: 'Daniela Reyes', role: 'POS Cashier', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-c112',
        code: 'SVC-112',
        name: 'North Concourse 112 · Blitz Pretzel & Bavarian Taphouse',
        department: 'concessions',
        type: 'concourse_service_area',
        capacity: null,
        stadiumZone: 'North Concourse 100',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: 'ST-112',
          concept: 'Warm Jumbo Pretzels, Beer Cheese, German Pilsners',
          terminalCount: 4,
          cashBeginningCents: 40000,
          cashGrossCents: 980000,
          hierarchy: {
            director: { name: 'Marcus Sterling', title: 'Director of General Concessions', radioChannel: 'Ch 3 - Concessions Main' },
            manager: { name: 'Valerie Gomez', title: 'North Concourse Stand Manager', status: 'on_duty', radioChannel: 'Ch 4 - Concessions North' },
            assignedStaff: [
              { name: 'Lucas Meyer', role: 'Baking Attendant', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-c118',
        code: 'SVC-118',
        name: 'West Concourse 118 · 50-Yardline Prime Burger & Grille',
        department: 'concessions',
        type: 'concourse_service_area',
        capacity: null,
        stadiumZone: 'West Concourse 100',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: 'ST-118',
          concept: 'Certified Angus Smashburgers, Truffle Fries, Shakes',
          terminalCount: 8,
          cashBeginningCents: 80000,
          cashGrossCents: 2450000,
          hierarchy: {
            director: { name: 'Marcus Sterling', title: 'Director of General Concessions', radioChannel: 'Ch 3 - Concessions Main' },
            manager: { name: 'Derrick Hall', title: 'West Concourse Stand Manager', status: 'on_duty', radioChannel: 'Ch 3 - Concessions Main' },
            assignedStaff: [
              { name: 'Kevin O’Neal', role: 'Lead Grill Master', status: 'on_duty', shift: '09:00 - Close', geofenceVerified: true },
              { name: 'Ashley Cooper', role: 'Cashier & Expediter', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-c122',
        code: 'SVC-122',
        name: 'West Concourse 122 · High-Velocity Cocktails & Spirits',
        department: 'concessions',
        type: 'concourse_service_area',
        capacity: null,
        stadiumZone: 'West Concourse 100',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: 'ST-122',
          concept: 'Rapid-Pour Premium Spirits, Canned Cocktails, Wine',
          terminalCount: 6,
          cashBeginningCents: 60000,
          cashGrossCents: 1890000,
          hierarchy: {
            director: { name: 'Marcus Sterling', title: 'Director of General Concessions', radioChannel: 'Ch 3 - Concessions Main' },
            manager: { name: 'Derrick Hall', title: 'West Concourse Stand Manager', status: 'on_duty', radioChannel: 'Ch 3 - Concessions Main' },
            assignedStaff: [
              { name: 'Brittany Scott', role: 'Head Bartender', status: 'on_duty', shift: '10:30 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-c128',
        code: 'SVC-128',
        name: 'South Concourse 128 · Touchdown Pizza & Italian Kitchen',
        department: 'concessions',
        type: 'concourse_service_area',
        capacity: null,
        stadiumZone: 'South Concourse 100',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: 'ST-128',
          concept: 'Brick-Oven Style Slices, Garlic Knots, Italian Sodas',
          terminalCount: 6,
          cashBeginningCents: 60000,
          cashGrossCents: 1540000,
          hierarchy: {
            director: { name: 'Marcus Sterling', title: 'Director of General Concessions', radioChannel: 'Ch 3 - Concessions Main' },
            manager: { name: 'Marco Bellini', title: 'South Concourse Stand Manager', status: 'on_duty', radioChannel: 'Ch 4 - Concessions South' },
            assignedStaff: [
              { name: 'Gianna Rossi', role: 'Pizza Chef', status: 'on_duty', shift: '09:30 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-c134',
        code: 'SVC-134',
        name: 'South Concourse 134 · Gridiron Sweet Treats & Gelato',
        department: 'concessions',
        type: 'concourse_service_area',
        capacity: null,
        stadiumZone: 'South Concourse 100',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: 'ST-134',
          concept: 'Gourmet Churros, Gelato Cups, Funnel Cakes, Coffee',
          terminalCount: 4,
          cashBeginningCents: 40000,
          cashGrossCents: 820000,
          hierarchy: {
            director: { name: 'Marcus Sterling', title: 'Director of General Concessions', radioChannel: 'Ch 3 - Concessions Main' },
            manager: { name: 'Marco Bellini', title: 'South Concourse Stand Manager', status: 'on_duty', radioChannel: 'Ch 4 - Concessions South' },
            assignedStaff: [
              { name: 'Emily Clark', role: 'Dessert Station Lead', status: 'on_duty', shift: '10:30 - Close', geofenceVerified: true },
            ],
          },
        },
      },
    ],
  },

  // ── 4. LOCKER ROOMS & AUXILIARY PERFORMER ROOMS ─────────────────────────
  {
    id: 'zone-locker-rooms-aux',
    name: 'Team Locker Rooms & Auxiliary Performer Suites',
    code: 'LOCKERS-BOH',
    level: '0',
    department: 'facilities_operations',
    category: 'locker_rooms_aux',
    unitsCount: 6,
    openCount: 6,
    alertCount: 0,
    units: [
      {
        id: 'u-lck-home',
        code: 'LCK-HOME',
        name: 'Home Team Primary Locker Room & Fuel Kitchen',
        department: 'facilities_operations',
        type: 'team_locker_room',
        capacity: 85,
        stadiumZone: 'West Player Tunnel Level 0',
        level: '0',
        status: 'restricted',
        suiteDetails: {
          suiteNumber: 'HOME-LOCKER',
          suiteholder: 'Home NFL Franchise · Team Operations',
          tier: 'Athletic Compound',
          hostName: 'Dr. Robert Hayes (Head of Sports Performance)',
          guestCount: 68,
          beoNumber: 'BEO-ATHLETIC-2026-001',
          beoPackageName: 'High-Performance Gameday Athlete Nutrition',
          menuPackage: 'Sous-vide chicken breast, grilled salmon, organic quinoa bowls, custom smoothie bar, cold-press hydration',
          attendantName: 'Chef Malik Jackson',
          beoPreOrders: [
            { id: 'hl-1', name: 'Pre-Game High-Carb Fuel Buffet (Organic Rice, Sweet Potato, Salmon)', quantity: 65, category: 'entree', status: 'delivered', scheduledTime: 'Kickoff - 2h' },
            { id: 'hl-2', name: 'Post-Game Protein Recovery Station (Flank Steak, Grilled Veg)', quantity: 65, category: 'entree', status: 'prepped', scheduledTime: 'Post-Game' },
            { id: 'hl-3', name: 'Organic Cold-Pressed Juices & Electrolytes (100 Bottles)', quantity: 100, category: 'beverage', status: 'delivered', scheduledTime: 'Pre-Game' },
          ],
          hierarchy: {
            director: { name: 'Derrick Vance', title: 'Director of Field & Gameday Operations', radioChannel: 'Ch 2 - Field Command' },
            manager: { name: 'Franklin Pierce', title: 'Locker & Athlete Facilities Manager', status: 'on_duty', radioChannel: 'Ch 2 - Field Command' },
            assignedStaff: [
              { name: 'Chef Malik Jackson', role: 'Lead Performance Nutrition Chef', status: 'on_duty', shift: '07:00 - Close', geofenceVerified: true },
              { name: 'Darnell Harris', role: 'Athlete Service Attendant', status: 'on_duty', shift: '08:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-lck-visiting',
        code: 'LCK-VISIT',
        name: 'Visiting Team Official Locker Room & Training Quarters',
        department: 'facilities_operations',
        type: 'team_locker_room',
        capacity: 85,
        stadiumZone: 'East Player Tunnel Level 0',
        level: '0',
        status: 'restricted',
        suiteDetails: {
          suiteNumber: 'VISIT-LOCKER',
          suiteholder: 'Visiting NFL Franchise Delegation',
          tier: 'Athletic Compound',
          hostName: 'Visiting Travel Secretary',
          guestCount: 65,
          beoNumber: 'BEO-ATHLETIC-2026-002',
          beoPackageName: 'Visiting Delegation Pre & Post-Game Hospitality',
          menuPackage: 'Hot breakfast sandwiches, pre-game lean proteins, post-game charcuterie & recovery boxes',
          attendantName: 'Chef Sarah Collins',
          beoPreOrders: [
            { id: 'vl-1', name: 'Visiting Pre-Game Lean Protein Buffet', quantity: 60, category: 'entree', status: 'delivered', scheduledTime: 'Kickoff - 2h' },
            { id: 'vl-2', name: 'Post-Game Travel Boxed Meals (Steak / Salmon / Vegan)', quantity: 65, category: 'entree', status: 'prepped', scheduledTime: 'Post-Game' },
          ],
          hierarchy: {
            director: { name: 'Derrick Vance', title: 'Director of Field & Gameday Operations', radioChannel: 'Ch 2 - Field Command' },
            manager: { name: 'Franklin Pierce', title: 'Locker & Athlete Facilities Manager', status: 'on_duty', radioChannel: 'Ch 2 - Field Command' },
            assignedStaff: [
              { name: 'Sarah Collins', role: 'Visiting Locker Attendant', status: 'on_duty', shift: '08:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-aux-headliner',
        code: 'AUX-HEADLINER',
        name: 'Halftime Headliner Green Room & Dressing Suite A',
        department: 'entertainment_hospitality',
        type: 'aux_performer_room',
        capacity: 25,
        stadiumZone: 'South Tunnel Level 0 Backstage',
        level: '0',
        status: 'restricted',
        suiteDetails: {
          suiteNumber: 'GREEN-ROOM-A',
          suiteholder: 'Live Nation / Halftime Show Talent Artist',
          tier: 'VIP Performer Suite',
          hostName: 'Artist Tour Manager (Rider Verified)',
          guestCount: 18,
          beoNumber: 'BEO-SHOW-2026-001',
          beoPackageName: 'A-List Tour Hospitality Rider & Organic Green Room',
          menuPackage: 'Organic cold-pressed ginger turmeric shots, vegan sushi platter, Manuka honey, sparkling artisan water, Dom Pérignon',
          attendantName: 'Elena Rostova (VIP Artist Host)',
          beoPreOrders: [
            { id: 'hr-1', name: 'Organic Cold-Pressed Juice & Wellness Bar', quantity: 18, category: 'beverage', status: 'delivered', scheduledTime: '11:00 AM' },
            { id: 'hr-2', name: 'Artisan Vegan & Raw Sushi Tasting Platter', quantity: 4, category: 'appetizer', status: 'delivered', scheduledTime: '12:30 PM' },
            { id: 'hr-3', name: 'Dom Pérignon & Vintage Champagne (4 btls)', quantity: 4, category: 'bar', status: 'delivered', scheduledTime: 'Pre-Show' },
          ],
          hierarchy: {
            director: { name: 'Eleanor Vance', title: 'VP of Premium Hospitality', radioChannel: 'Ch 1 - Executive' },
            manager: { name: 'Natasha Romanova', title: 'Entertainment & Performer Host Lead', status: 'on_duty', radioChannel: 'Ch 6 - Backstage VIP' },
            assignedStaff: [
              { name: 'Elena Rostova', role: 'Dedicated Artist Host', status: 'on_duty', shift: '10:00 - Show End', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-aux-band',
        code: 'AUX-BAND',
        name: 'Performer Auxiliary Dressing Room B (Band & Production)',
        department: 'entertainment_hospitality',
        type: 'aux_performer_room',
        capacity: 40,
        stadiumZone: 'South Tunnel Level 0 Backstage',
        level: '0',
        status: 'restricted',
        suiteDetails: {
          suiteNumber: 'GREEN-ROOM-B',
          suiteholder: 'Halftime Show Musicians & Stage Production Crew',
          tier: 'Production Compound',
          guestCount: 35,
          beoNumber: 'BEO-SHOW-2026-002',
          beoPackageName: 'Band & Crew High-Energy Catering',
          menuPackage: 'Gourmet slider bar, energy drink tubs, artisan flatbreads, coffee & espresso bar',
          hierarchy: {
            director: { name: 'Eleanor Vance', title: 'VP of Premium Hospitality', radioChannel: 'Ch 1 - Executive' },
            manager: { name: 'Natasha Romanova', title: 'Entertainment & Performer Host Lead', status: 'on_duty', radioChannel: 'Ch 6 - Backstage VIP' },
            assignedStaff: [
              { name: 'Corey Taylor', role: 'Band Hospitality Runner', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-aux-referee',
        code: 'AUX-REFS',
        name: 'Referees & League Officials Operations Locker Room',
        department: 'facilities_operations',
        type: 'aux_performer_room',
        capacity: 15,
        stadiumZone: 'North Tunnel Level 0',
        level: '0',
        status: 'restricted',
        suiteDetails: {
          suiteNumber: 'OFFICIALS-01',
          suiteholder: 'League Officiating Crew & Replay Command',
          tier: 'Official Operations',
          guestCount: 12,
          beoNumber: 'BEO-LEAGUE-2026-001',
          beoPackageName: 'Officials Pre-Game & Halftime Refreshment',
          menuPackage: 'Fresh fruit platters, energy protein bars, gourmet coffee, sports drinks',
          hierarchy: {
            director: { name: 'Derrick Vance', title: 'Director of Field & Gameday Operations', radioChannel: 'Ch 2 - Field Command' },
            manager: { name: 'Franklin Pierce', title: 'Locker & Athlete Facilities Manager', status: 'on_duty', radioChannel: 'Ch 2 - Field Command' },
            assignedStaff: [
              { name: 'Tyler Brooks', role: 'Officials Hospitality Attendant', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-aux-cheer',
        code: 'AUX-CHEER',
        name: 'Cheer & Mascot Aux Staging Locker Room',
        department: 'facilities_operations',
        type: 'aux_performer_room',
        capacity: 35,
        stadiumZone: 'East Tunnel Level 0',
        level: '0',
        status: 'open',
        suiteDetails: {
          suiteNumber: 'SPIRIT-01',
          suiteholder: 'Stadium Entertainment & Mascot Team',
          tier: 'Performer Dressing',
          guestCount: 30,
          menuPackage: 'Hydration tubs, fresh wraps, energy snacks',
          hierarchy: {
            director: { name: 'Derrick Vance', title: 'Director of Field & Gameday Operations', radioChannel: 'Ch 2 - Field Command' },
            manager: { name: 'Franklin Pierce', title: 'Locker & Athlete Facilities Manager', status: 'on_duty', radioChannel: 'Ch 2 - Field Command' },
            assignedStaff: [
              { name: 'Paige Morgan', role: 'Cheer Compound Attendant', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
    ],
  },

  // ── 5. LUXURY SUITES 300 ────────────────────────────────────────────────
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
        name: 'Suite 301 · Founders Skybox (Apex Global)',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 28,
        stadiumZone: 'West Suite Tower Level 3',
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
          ],
          hierarchy: {
            director: { name: 'Eleanor Vance', title: 'VP of Premium Hospitality', radioChannel: 'Ch 1 - Executive' },
            manager: { name: 'Sarah Jenkins', title: 'Suite Level 300 Floor Manager', status: 'on_duty', radioChannel: 'Ch 4 - Suites North' },
            assignedStaff: [
              { name: 'Alice Taylor', role: 'Lead Suite Attendant', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
              { name: 'Marcus Chen', role: 'Hospitality Runner', status: 'on_duty', shift: '11:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-302',
        code: 'SUITE-302',
        name: 'Suite 302 · Redline Private Capital Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 24,
        stadiumZone: 'West Suite Tower Level 3',
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
          hierarchy: {
            director: { name: 'Eleanor Vance', title: 'VP of Premium Hospitality', radioChannel: 'Ch 1 - Executive' },
            manager: { name: 'Sarah Jenkins', title: 'Suite Level 300 Floor Manager', status: 'on_duty', radioChannel: 'Ch 4 - Suites North' },
            assignedStaff: [
              { name: 'David Miller', role: 'Suite Attendant', status: 'on_duty', shift: '10:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-303',
        code: 'SUITE-303',
        name: 'Suite 303 · Summit Wealth Partners',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 20,
        stadiumZone: 'West Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '303',
          suiteholder: 'Summit Wealth Partners',
          tier: 'Executive Luxury Suite',
          guestCount: 18,
          beoNumber: 'BEO-NFL-2026-903',
          beoPackageName: 'Artisan BBQ & Tap Platter',
          menuPackage: 'Smoked brisket, jalapeño sausage, mac & cheese, craft beer',
        },
      },
      {
        id: 'u-304',
        code: 'SUITE-304',
        name: 'Suite 304 · Vanguard Tech Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 22,
        stadiumZone: 'East Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '304',
          suiteholder: 'Vanguard Tech Corporation',
          tier: 'Executive Luxury Suite',
          guestCount: 20,
          beoNumber: 'BEO-NFL-2026-904',
          beoPackageName: 'Coastal Seafood & Champagne',
        },
      },
      {
        id: 'u-305',
        code: 'SUITE-305',
        name: 'Suite 305 · Meridian Health Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 24,
        stadiumZone: 'East Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '305',
          suiteholder: 'Meridian Health Network',
          tier: 'Founders Suite',
          guestCount: 24,
          beoNumber: 'BEO-NFL-2026-905',
          beoPackageName: 'Grand Mediterranean Tapas & Prime Tenderloin',
        },
      },
      {
        id: 'u-306',
        code: 'SUITE-306',
        name: 'Suite 306 · League Commissioner Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 35,
        stadiumZone: '50-Yardline Midfield Skybox',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '306',
          suiteholder: 'NFL League Executive Office',
          tier: 'Commissioner Skybox',
          guestCount: 32,
          beoNumber: 'BEO-NFL-2026-906',
          beoPackageName: 'Presidential Diamond Hospitality Banquet',
        },
      },
    ],
  },

  // ── 6. CLUB LEVEL 200 ───────────────────────────────────────────────────
  {
    id: 'zone-200-club',
    name: '200 Club Level & Lounges',
    code: '200-CLUB',
    level: '2',
    department: 'premium_hospitality',
    category: 'club_level',
    unitsCount: 2,
    openCount: 2,
    alertCount: 0,
    units: [
      {
        id: 'u-club-east',
        code: 'CLUB-EAST',
        name: 'Champions Club East & Oyster Bar',
        department: 'premium_hospitality',
        type: 'club_lounge',
        capacity: 450,
        stadiumZone: 'East Club Tier Level 2',
        level: '2',
        status: 'open',
        standDetails: {
          standNumber: 'CL-201',
          concept: 'Chef Action Oyster Bar, Carving Station, Craft Mixology',
          terminalCount: 12,
          cashGrossCents: 4200000,
        },
      },
      {
        id: 'u-club-west',
        code: 'CLUB-WEST',
        name: 'Gridiron Club West & 50-Yardline Bar',
        department: 'premium_hospitality',
        type: 'club_lounge',
        capacity: 480,
        stadiumZone: 'West Club Tier Level 2',
        level: '2',
        status: 'open',
        standDetails: {
          standNumber: 'CL-202',
          concept: 'Panoramic 50-Yardline Premium Taproom & Grill',
          terminalCount: 14,
          cashGrossCents: 4850000,
        },
      },
    ],
  },

  // ── 7. UPPER DECK 400 ───────────────────────────────────────────────────
  {
    id: 'zone-400-upper',
    name: '400 Upper Deck Concourse & Skyline Bars',
    code: '400-UPPER',
    level: '4',
    department: 'concessions',
    category: 'upper_deck',
    unitsCount: 3,
    openCount: 3,
    alertCount: 0,
    units: [
      {
        id: 'u-401',
        code: 'SKY-401',
        name: 'Skyline Terrace Bar & Craft Drafts',
        department: 'concessions',
        type: 'upper_concessions',
        capacity: null,
        stadiumZone: 'Upper Deck South Skyline',
        level: '4',
        status: 'open',
        standDetails: {
          standNumber: 'UD-401',
          concept: 'High-Volume Canned Spirits & Draft Express',
          terminalCount: 8,
          cashGrossCents: 1650000,
        },
      },
      {
        id: 'u-408',
        code: 'UD-408',
        name: 'Upper North 408 · Redzone Tenders & Fries',
        department: 'concessions',
        type: 'upper_concessions',
        capacity: null,
        stadiumZone: 'Upper Deck North',
        level: '4',
        status: 'open',
        standDetails: {
          standNumber: 'UD-408',
          concept: 'Crispy Chicken Baskets, Jumbo Pretzels, Sodas',
          terminalCount: 6,
          cashGrossCents: 1100000,
        },
      },
    ],
  },
  // ── 8. MAIN BRANDED ENTRY GATES ─────────────────────────────────────────
  {
    id: 'zone-stadium-gates',
    name: 'Main Stadium Entry Gates & Welcome Plazas',
    code: 'STAD-GATES',
    level: '1',
    department: 'guest_services',
    category: 'stadium_gates',
    unitsCount: 4,
    openCount: 4,
    alertCount: 0,
    units: [
      {
        id: 'u-gate-ford',
        code: 'GATE-FORD',
        name: 'Ford Gate (North) · VIP Arrival & North Concourse Hub',
        department: 'guest_services',
        type: 'entry_gate',
        capacity: 12000,
        stadiumZone: 'North Entrance Plaza',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: 'GATE-FORD-01',
          concept: 'Ford Signature Blue Plaza · VIP Guest Welcome, Ticket Scanning & Event Concierge',
          terminalCount: 16,
          cashGrossCents: 420000,
          inSeatOrders: [],
          hierarchy: {
            director: { name: 'Elena Rostova', title: 'Director of Guest Services & Fan Experience', radioChannel: 'Ch 1 - Command' },
            manager: { name: 'Marcus Sterling', title: 'North Gate Operations Manager', status: 'on_duty', radioChannel: 'Ch 4 - Gates & Security' },
            assignedStaff: [
              { name: 'Chloe Vance', role: 'VIP Arrival Lead', status: 'on_duty', shift: '09:00 - Close', geofenceVerified: true },
              { name: 'Julian Ortiz', role: 'Turnstile & Scanner Tech', status: 'on_duty', shift: '09:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-gate-kroger',
        code: 'GATE-KROGER',
        name: 'Kroger Gate (South) · South Plaza & Fan Express Entry',
        department: 'guest_services',
        type: 'entry_gate',
        capacity: 15000,
        stadiumZone: 'South Entrance Plaza',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: 'GATE-KROGER-01',
          concept: 'Kroger Fresh Gate · Express Turnstiles, Gameday Merch & Quick Refreshment Depot',
          terminalCount: 20,
          cashGrossCents: 680000,
          inSeatOrders: [],
          hierarchy: {
            director: { name: 'Elena Rostova', title: 'Director of Guest Services & Fan Experience', radioChannel: 'Ch 1 - Command' },
            manager: { name: 'Brenda Washington', title: 'South Gate Operations Manager', status: 'on_duty', radioChannel: 'Ch 4 - Gates & Security' },
            assignedStaff: [
              { name: 'Devon Miles', role: 'South Turnstile Supervisor', status: 'on_duty', shift: '09:00 - Close', geofenceVerified: true },
              { name: 'Kendra Harris', role: 'Guest Hospitality Greeter', status: 'on_duty', shift: '09:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-gate-p66',
        code: 'GATE-P66',
        name: 'Phillips 66 Gate (West) · Luxury Suite & Media Credential Entry',
        department: 'guest_services',
        type: 'entry_gate',
        capacity: 8000,
        stadiumZone: 'West Entrance Plaza',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: 'GATE-P66-01',
          concept: 'Phillips 66 Premium Gate · Dedicated Suiteholder Fast-Track, VIP Elevators & Media Check-In',
          terminalCount: 12,
          cashGrossCents: 310000,
          inSeatOrders: [],
          hierarchy: {
            director: { name: 'Elena Rostova', title: 'Director of Guest Services & Fan Experience', radioChannel: 'Ch 1 - Command' },
            manager: { name: 'Arthur Pendelton', title: 'West Premium Entry Manager', status: 'on_duty', radioChannel: 'Ch 4 - Gates & Security' },
            assignedStaff: [
              { name: 'Sofia Rodriguez', role: 'Suiteholder VIP Concierge', status: 'on_duty', shift: '09:30 - Close', geofenceVerified: true },
              { name: 'Tyler Reed', role: 'Credential Verification Lead', status: 'on_duty', shift: '09:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
      {
        id: 'u-gate-xfinity',
        code: 'GATE-XFINITY',
        name: 'xfinity Gate (East) · East Concourse & Club Escalators',
        department: 'guest_services',
        type: 'entry_gate',
        capacity: 14000,
        stadiumZone: 'East Entrance Plaza',
        level: '1',
        status: 'open',
        standDetails: {
          standNumber: 'GATE-XFINITY-01',
          concept: 'xfinity Gigabit Gate · Club Level Direct Escalators & High-Speed Fan Check-in',
          terminalCount: 18,
          cashGrossCents: 540000,
          inSeatOrders: [],
          hierarchy: {
            director: { name: 'Elena Rostova', title: 'Director of Guest Services & Fan Experience', radioChannel: 'Ch 1 - Command' },
            manager: { name: 'Darnell Jackson', title: 'East Gate Operations Manager', status: 'on_duty', radioChannel: 'Ch 4 - Gates & Security' },
            assignedStaff: [
              { name: 'Aaliyah Brown', role: 'Club Level Access Host', status: 'on_duty', shift: '09:30 - Close', geofenceVerified: true },
              { name: 'Lucas Chang', role: 'Turnstile Tech Specialist', status: 'on_duty', shift: '09:00 - Close', geofenceVerified: true },
            ],
          },
        },
      },
    ],
  },
];

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
  const { width: windowWidth, isMobile, preferListFirst } = useResponsive();

  const [mobileTab, setMobileTab] = useState<'map' | 'directory'>(preferListFirst ? 'directory' : 'map');
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
        label: 'Luxury Suites 300 (6)',
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
                    NRG STADIUM · 3D SPATIAL MODEL
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
                        style={{ color: isActive ? '#FFFFFF' : '#1D2420', fontWeight: '700' }}
                      >
                        {lvl.label}
                      </CommandText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* 3D Visual Stadium Bowl Canvas */}
            <ScrollView horizontal contentContainerStyle={styles.canvasScrollInner} showsHorizontalScrollIndicator={true}>
              <ScrollView contentContainerStyle={styles.stadium3DContainer} showsVerticalScrollIndicator={false}>
                <View
                  style={[
                    styles.stadiumPerspectiveWrapper,
                    { width: isMobile ? Math.max(340, windowWidth - 32) : 840 },
                    viewPerspective === '3d_isometric' ? styles.isometricTransform : styles.planTransform,
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

                  {/* ── NORTH GATE: FORD GATE (North Plaza & Arrival) ── */}
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
                              styles.gateNorthBanner,
                              isSelected ? styles.serviceAreaGlowActive : null,
                            ]}
                          >
                            <View style={styles.gateFordBadge}>
                              <Text style={styles.gateFordText}>Ford</Text>
                              <Text style={styles.gateBadgeSub}>GATE</Text>
                            </View>
                            <View style={{ alignItems: 'center' }}>
                              <CommandText
                                palette={palette}
                                variant="caption"
                                style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 11, letterSpacing: 0.5 }}
                              >
                                NORTH PLAZA · VIP ARRIVAL & EXPEDITION
                              </CommandText>
                              <Text style={{ color: '#B0C4DE', fontSize: 9 }}>
                                16 Turnstiles · Ticket Scanning · Concierge Hospitality
                              </Text>
                            </View>
                            {isSelected ? (
                              <View style={styles.activeGlowBeacon}>
                                <Text style={styles.activeGlowBeaconText}>★ ACTIVE SERVICE AREA</Text>
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

                  {/* ── LEVEL 500/600 UPPER BOWL (TEXANS ICONIC RED DECK) ── */}
                  <View style={styles.outerUpperDeckRingRed}>
                    <View style={styles.ringLabelHeader}>
                      <CommandText palette={palette} variant="caption" style={styles.tierPillRed}>
                        LEVEL 500 / 600 · UPPER BOWL (TEXANS RED DECK)
                      </CommandText>
                    </View>

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
                                styles.sectorBlock,
                                styles.upperDeckSectorRed,
                                isSelected ? styles.serviceAreaGlowActive : null,
                              ]}
                            >
                              <CommandText
                                palette={palette}
                                variant="caption"
                                style={{ color: isSelected ? '#FFFFFF' : '#FFEBEB', fontWeight: '900', fontSize: 11 }}
                              >
                                {unit.code}
                              </CommandText>
                              <Text
                                numberOfLines={1}
                                style={{ color: isSelected ? '#FFFFFF' : '#FFCDD2', fontSize: 10, fontWeight: '600' }}
                              >
                                {unit.name.split('·')[1]?.trim() ?? unit.name}
                              </Text>
                              {isSelected ? (
                                <View style={styles.miniActiveIndicator}>
                                  <Text style={styles.miniActiveIndicatorText}>ACTIVE</Text>
                                </View>
                              ) : null}
                            </Pressable>
                          );
                        })}
                    </View>

                    {/* ── WEST & EAST GATES WRAPPER AROUND SUITES ── */}
                    <View style={styles.middleGatesSideRow}>
                      {/* WEST: Phillips 66 Gate */}
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
                                styles.gateSidePillWest,
                                isSelected ? styles.serviceAreaGlowActive : null,
                              ]}
                            >
                              <View style={styles.p66Badge}>
                                <Text style={styles.p66TextTop}>PHILLIPS</Text>
                                <Text style={styles.p66TextBottom}>66</Text>
                              </View>
                              <Text style={styles.gateSideText}>WEST GATE · SUITEHOLDER & MEDIA</Text>
                            </Pressable>
                          );
                        })}

                      {/* ── LEVEL 300 & 400 LUXURY SUITE RINGS (EXECUTIVE GLASS) ── */}
                      <View style={styles.suitesTierRing}>
                        <View style={styles.ringLabelHeader}>
                          <CommandText palette={palette} variant="caption" style={styles.tierPillGold}>
                            LEVEL 300 / 400 · LUXURY SUITES & VIP OWNERS BOXES
                          </CommandText>
                        </View>

                        <View style={styles.suitesGridRing}>
                          {zonesState
                            .find((z) => z.id === 'zone-300-suites')
                            ?.units.map((unit) => {
                              const isSelected = selectedUnitId === unit.id;
                              const hasBeo = Boolean(unit.suiteDetails?.beoNumber);
                              return (
                                <Pressable
                                  key={unit.id}
                                  onPress={() => handleUnitPress(unit, 'zone-300-suites')}
                                  style={[
                                    styles.sectorBlock,
                                    styles.suiteSectorBlock,
                                    isSelected ? styles.serviceAreaGlowActive : null,
                                  ]}
                                >
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <MaterialCommunityIcons
                                      name="glass-cocktail"
                                      size={12}
                                      color={isSelected ? '#FFFFFF' : '#8A5D23'}
                                    />
                                    <CommandText
                                      palette={palette}
                                      variant="caption"
                                      style={{
                                        color: isSelected ? '#FFFFFF' : '#8A5D23',
                                        fontWeight: '800',
                                        fontSize: 11,
                                      }}
                                    >
                                      {unit.code}
                                    </CommandText>
                                  </View>
                                  <Text
                                    numberOfLines={1}
                                    style={{
                                      color: isSelected ? '#FFFFFF' : '#1D2420',
                                      fontSize: 10,
                                      fontWeight: '700',
                                    }}
                                  >
                                    {unit.suiteDetails?.suiteholder ?? unit.name}
                                  </Text>
                                  {hasBeo ? (
                                    <View style={styles.miniBeoDot}>
                                      <Text style={{ color: '#FFFFFF', fontSize: 8, fontWeight: '900' }}>
                                        BEO READY
                                      </Text>
                                    </View>
                                  ) : null}
                                  {isSelected ? (
                                    <View style={styles.miniActiveIndicator}>
                                      <Text style={styles.miniActiveIndicatorText}>★ ACTIVE</Text>
                                    </View>
                                  ) : null}
                                </Pressable>
                              );
                            })}
                        </View>

                        {/* ── LEVEL 200 CLUB TIER (TEXANS NAVY + 360° LED RIBBON BOARD) ── */}
                        <View style={styles.clubTierRing}>
                          {/* 360 LED Ribbon Banner */}
                          <View style={styles.ribbonLedDisplay}>
                            <Text style={styles.ribbonLedText}>
                              ★ HOUSTON TEXANS · CLUB LEVEL 200 · LIVE GAMEDAY HOSPITALITY ★
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
                                      styles.sectorBlock,
                                      styles.clubSectorBlock,
                                      isSelected ? styles.serviceAreaGlowActive : null,
                                    ]}
                                  >
                                    <MaterialCommunityIcons
                                      name="trophy-award"
                                      size={14}
                                      color={isSelected ? '#FFFFFF' : '#013369'}
                                    />
                                    <CommandText
                                      palette={palette}
                                      variant="caption"
                                      style={{
                                        color: isSelected ? '#FFFFFF' : '#013369',
                                        fontWeight: '800',
                                        fontSize: 11,
                                      }}
                                    >
                                      {unit.name}
                                    </CommandText>
                                  </Pressable>
                                );
                              })}
                          </View>

                          {/* ── LEVEL 100 MAIN CONCOURSE (8 SERVICE HUBS + 2 VIP BUNKERS) ── */}
                          <View style={styles.concourseLevelRing}>
                            <View style={styles.ringLabelHeader}>
                              <CommandText palette={palette} variant="caption" style={styles.tierPillConcourse}>
                                LEVEL 100 · LOWER NAVY BOWL & 8 CONCOURSE CULINARY HUBS
                              </CommandText>
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
                                        styles.sectorBlock,
                                        styles.concourseOutletBlock,
                                        isSelected ? styles.serviceAreaGlowActive : null,
                                      ]}
                                    >
                                      <CommandText
                                        palette={palette}
                                        variant="caption"
                                        style={{
                                          color: isSelected ? '#FFFFFF' : '#013369',
                                          fontWeight: '800',
                                          fontSize: 11,
                                        }}
                                      >
                                        {unit.code}
                                      </CommandText>
                                      <Text
                                        numberOfLines={1}
                                        style={{ color: isSelected ? '#FFFFFF' : '#1D2420', fontSize: 10 }}
                                      >
                                        {unit.name.split('·')[1]?.trim() ?? unit.name}
                                      </Text>
                                    </Pressable>
                                  );
                                })}
                            </View>

                            {/* ── INNER CORE: FOOTBALL FIELD, ENDZONES, SIDELINES & BUNKERS ── */}
                            <View style={styles.fieldAndSidelinesCore}>
                              {/* North Endzone & North Bunker */}
                              <View style={styles.endzoneRowWrapper}>
                                {/* North Bunker Club */}
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
                                          styles.bunkerBox,
                                          isSelected ? styles.serviceAreaGlowActiveGold : null,
                                        ]}
                                      >
                                        <MaterialCommunityIcons name="shield-crown" size={14} color="#D4AF37" />
                                        <CommandText
                                          palette={palette}
                                          variant="caption"
                                          style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 11 }}
                                        >
                                          NORTH BUNKER
                                        </CommandText>
                                        <Text style={{ color: '#E8D2A8', fontSize: 9 }}>Chef Carving Vault</Text>
                                      </Pressable>
                                    );
                                  })}

                                {/* North Endzone Lounge (Texans Navy) */}
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
                                          styles.endzoneBlock,
                                          isSelected ? styles.serviceAreaGlowActive : null,
                                        ]}
                                      >
                                        <CommandText
                                          palette={palette}
                                          variant="caption"
                                          style={{ color: '#FFFFFF', fontWeight: '900', letterSpacing: 2 }}
                                        >
                                          TEXANS
                                        </CommandText>
                                        <Text style={{ color: '#A3D9B5', fontSize: 9 }}>North Endzone Lounge</Text>
                                      </Pressable>
                                    );
                                  })}
                              </View>

                              {/* Center Field + Sidelines Split */}
                              <View style={styles.centerFieldAndSidelinesRow}>
                                {/* West / Home Sideline Service Area */}
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
                                          styles.sidelineStrip,
                                          isSelected ? styles.serviceAreaGlowActive : null,
                                        ]}
                                      >
                                        <CommandText
                                          palette={palette}
                                          variant="caption"
                                          style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 10 }}
                                        >
                                          HOME
                                        </CommandText>
                                        <Text style={{ color: '#A3D9B5', fontSize: 8 }}>Hydration</Text>
                                      </Pressable>
                                    );
                                  })}

                                {/* 3D Playing Field (Regulation Gridiron) */}
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
                                    <MaterialCommunityIcons name="bullhorn" size={16} color="#FFFFFF" />
                                    <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>
                                      TEXANS
                                    </Text>
                                  </View>
                                </View>

                                {/* East / Visiting Sideline Service Area */}
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
                                          styles.sidelineStrip,
                                          isSelected ? styles.serviceAreaGlowActive : null,
                                        ]}
                                      >
                                        <CommandText
                                          palette={palette}
                                          variant="caption"
                                          style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 10 }}
                                        >
                                          VISIT
                                        </CommandText>
                                        <Text style={{ color: '#A3D9B5', fontSize: 8 }}>Media Deck</Text>
                                      </Pressable>
                                    );
                                  })}
                              </View>

                              {/* South Endzone & South Bunker */}
                              <View style={styles.endzoneRowWrapper}>
                                {/* South Bunker Club */}
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
                                          styles.bunkerBox,
                                          isSelected ? styles.serviceAreaGlowActiveGold : null,
                                        ]}
                                      >
                                        <MaterialCommunityIcons name="shield-crown" size={14} color="#D4AF37" />
                                        <CommandText
                                          palette={palette}
                                          variant="caption"
                                          style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 11 }}
                                        >
                                          SOUTH BUNKER
                                        </CommandText>
                                        <Text style={{ color: '#E8D2A8', fontSize: 9 }}>Reserve Sommelier</Text>
                                      </Pressable>
                                    );
                                  })}

                                {/* South Endzone Lounge (Texans Navy) */}
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
                                          styles.endzoneBlock,
                                          isSelected ? styles.serviceAreaGlowActive : null,
                                        ]}
                                      >
                                        <CommandText
                                          palette={palette}
                                          variant="caption"
                                          style={{ color: '#FFFFFF', fontWeight: '900', letterSpacing: 2 }}
                                        >
                                          TEXANS
                                        </CommandText>
                                        <Text style={{ color: '#A3D9B5', fontSize: 9 }}>South RedZone Depot</Text>
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
                                        styles.sectorBlock,
                                        styles.concourseOutletBlock,
                                        isSelected ? styles.serviceAreaGlowActive : null,
                                      ]}
                                    >
                                      <CommandText
                                        palette={palette}
                                        variant="caption"
                                        style={{
                                          color: isSelected ? '#FFFFFF' : '#013369',
                                          fontWeight: '800',
                                          fontSize: 11,
                                        }}
                                      >
                                        {unit.code}
                                      </CommandText>
                                      <Text
                                        numberOfLines={1}
                                        style={{ color: isSelected ? '#FFFFFF' : '#1D2420', fontSize: 10 }}
                                      >
                                        {unit.name.split('·')[1]?.trim() ?? unit.name}
                                      </Text>
                                    </Pressable>
                                  );
                                })}
                            </View>
                          </View>
                        </View>
                      </View>

                      {/* EAST: xfinity Gate */}
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
                                styles.gateSidePillEast,
                                isSelected ? styles.serviceAreaGlowActive : null,
                              ]}
                            >
                              <View style={styles.xfinityBadge}>
                                <Text style={styles.xfinityText}>xfinity</Text>
                              </View>
                              <Text style={styles.gateSideText}>EAST GATE · CLUB ESCALATORS</Text>
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

                  {/* ── SOUTH GATE: KROGER GATE (South Plaza & Fan Turnstiles) ── */}
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
                              styles.gateSouthBanner,
                              isSelected ? styles.serviceAreaGlowActive : null,
                            ]}
                          >
                            <View style={styles.gateKrogerBadge}>
                              <MaterialCommunityIcons name="cart-outline" size={12} color="#FFFFFF" />
                              <Text style={styles.gateKrogerText}>Kroger</Text>
                              <Text style={styles.gateBadgeSub}>GATE</Text>
                            </View>
                            <View style={{ alignItems: 'center' }}>
                              <CommandText
                                palette={palette}
                                variant="caption"
                                style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 11, letterSpacing: 0.5 }}
                              >
                                SOUTH PLAZA · FAN EXPRESS & REFRESHMENT
                              </CommandText>
                              <Text style={{ color: '#FFCDD2', fontSize: 9 }}>
                                20 Turnstiles · Merch Plaza · High-Volume Fan Ingress
                              </Text>
                            </View>
                            {isSelected ? (
                              <View style={styles.activeGlowBeacon}>
                                <Text style={styles.activeGlowBeaconText}>★ ACTIVE SERVICE AREA</Text>
                              </View>
                            ) : null}
                          </Pressable>
                        );
                      })}
                  </View>

                  {/* ── UNDERGROUND / LEVEL 0: TEAM LOCKERS & PERFORMER AUX SUITES ── */}
                  <View style={styles.undergroundLockerCompound}>
                    <View style={styles.ringLabelHeader}>
                      <CommandText palette={palette} variant="caption" style={styles.tierPillUnderground}>
                        LEVEL 0 · ATHLETE COMPOUND & PERFORMER AUX SUITES
                      </CommandText>
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
                                styles.lockerRoomCard,
                                isSelected ? styles.serviceAreaGlowActive : null,
                                {
                                  backgroundColor: isSelected
                                    ? '#013369'
                                    : isHome
                                      ? '#E8F5E9'
                                      : isVisit
                                        ? '#EDE7F6'
                                        : isHeadliner
                                          ? '#FFF8E1'
                                          : '#F5F5F5',
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
                                  color={isSelected ? '#FFFFFF' : '#1D2420'}
                                />
                                <CommandText
                                  palette={palette}
                                  variant="caption"
                                  style={{
                                    color: isSelected ? '#FFFFFF' : '#1D2420',
                                    fontWeight: '800',
                                    fontSize: 11,
                                  }}
                                >
                                  {unit.code}
                                </CommandText>
                              </View>
                              <Text
                                numberOfLines={1}
                                style={{
                                  color: isSelected ? '#FFFFFF' : '#1D2420',
                                  fontWeight: '700',
                                  fontSize: 11,
                                }}
                              >
                                {unit.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                    </View>
                  </View>
                </View>
              </ScrollView>
            </ScrollView>

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  topSearchBar: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    height: 40,
    fontSize: 13,
  },
  viewModeToggle: {
    flexDirection: 'row',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#013369',
    overflow: 'hidden',
  },
  perspectiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  mobileTabSwitcher: {
    flexDirection: 'row',
    gap: 6,
  },
  mobileTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  mainLayout: {
    flex: 1,
  },
  sidebarList: {
    backgroundColor: '#FFFFFF',
  },
  sidebarHeader: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    gap: 2,
  },
  categoryAccordion: {
    borderBottomWidth: 1,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  countBadge: {
    backgroundColor: '#EEF5F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  unitsSublist: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 6,
    backgroundColor: '#FAFAFA',
  },
  unitSidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.sm,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E8E2',
    backgroundColor: '#FFFFFF',
  },
  unitSidebarItemSelected: {
    backgroundColor: '#F0F7FF',
    borderColor: '#013369',
    borderLeftWidth: 4,
    borderLeftColor: '#013369',
  },
  beoIndicator: {
    backgroundColor: '#FDF3E3',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E8D2A8',
  },
  mapCanvas: {
    flex: 1,
    backgroundColor: '#0A1118',
    position: 'relative',
  },
  canvasHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  levelFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  levelPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    borderWidth: 1,
  },
  canvasScrollInner: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stadium3DContainer: {
    padding: spacing.md,
    alignItems: 'center',
  },
  stadiumPerspectiveWrapper: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  isometricTransform: {
    transform: [{ perspective: 1200 }, { rotateX: '18deg' }],
  },
  planTransform: {
    transform: [],
  },

  /* ── Roof Structure ── */
  roofTrussSuperstructure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 12,
    marginVertical: 2,
  },
  roofRailTrack: {
    flex: 1,
    height: 3,
    backgroundColor: '#37474F',
    borderRadius: 2,
  },
  roofBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECEFF1',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    marginHorizontal: 8,
    borderWidth: 1,
    borderColor: '#CFD8DC',
  },
  roofBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#013369',
    letterSpacing: 0.5,
  },

  /* ── Gates ── */
  gateNorthWrapper: {
    width: '92%',
    alignItems: 'center',
    zIndex: 10,
  },
  gateNorthBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: '#002244',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#0055A5',
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#0055A5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  gateFordBadge: {
    backgroundColor: '#003366',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  gateFordText: {
    color: '#FFFFFF',
    fontStyle: 'italic',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1,
  },
  gateBadgeSub: {
    color: '#B0C4DE',
    fontSize: 8,
    fontWeight: '800',
  },

  gateSouthWrapper: {
    width: '92%',
    alignItems: 'center',
    zIndex: 10,
  },
  gateSouthBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: '#3E0A10',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#D50A0A',
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#D50A0A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  gateKrogerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#D50A0A',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  gateKrogerText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 13,
  },

  middleGatesSideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 6,
  },
  gateSidePillWest: {
    width: 58,
    minHeight: 140,
    backgroundColor: '#1E0E10',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#D50A0A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    gap: 6,
  },
  p66Badge: {
    backgroundColor: '#D50A0A',
    borderRadius: 4,
    padding: 3,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  p66TextTop: {
    color: '#FFFFFF',
    fontSize: 6,
    fontWeight: '900',
  },
  p66TextBottom: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  gateSideText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
    textAlign: 'center',
  },

  gateSidePillEast: {
    width: 58,
    minHeight: 140,
    backgroundColor: '#1A0E26',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#8A2BE2',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    gap: 6,
  },
  xfinityBadge: {
    backgroundColor: '#8A2BE2',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  xfinityText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
  },

  /* ── Jumbotrons ── */
  jumbotronDisplayBox: {
    width: '84%',
    alignItems: 'center',
  },
  jumboScreenNorth: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#031428',
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#00E5FF',
    paddingVertical: 4,
    paddingHorizontal: 12,
    width: '100%',
    shadowColor: '#00E5FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  jumboScreenSouth: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#031428',
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#00E5FF',
    paddingVertical: 4,
    paddingHorizontal: 12,
    width: '100%',
    shadowColor: '#00E5FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  jumboScreenText: {
    color: '#00E5FF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },

  /* ── Red Upper Bowl ── */
  outerUpperDeckRingRed: {
    width: '100%',
    backgroundColor: '#680B15',
    borderRadius: 36,
    borderWidth: 2.5,
    borderColor: '#D50A0A',
    padding: spacing.sm,
    alignItems: 'center',
    gap: spacing.xs,
    shadowColor: '#D50A0A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  tierPillRed: {
    backgroundColor: '#D50A0A',
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  upperDeckSectorRed: {
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
    backgroundColor: '#8E121E',
    borderColor: '#A81826',
  },

  /* ── Active Service Area Glowing Effect ── */
  serviceAreaGlowActive: {
    borderColor: '#FFD700',
    borderWidth: 3,
    backgroundColor: '#013369',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 14,
    elevation: 12,
  },
  serviceAreaGlowActiveGold: {
    borderColor: '#FFD700',
    borderWidth: 3,
    backgroundColor: '#7A5A35',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 14,
    elevation: 12,
  },
  activeGlowBeacon: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activeGlowBeaconText: {
    color: '#013369',
    fontSize: 8,
    fontWeight: '900',
  },
  miniActiveIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: '#FFD700',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  miniActiveIndicatorText: {
    color: '#013369',
    fontSize: 7,
    fontWeight: '900',
  },

  /* ── Suites Ring ── */
  suitesTierRing: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#E8D2A8',
    padding: spacing.xs,
    alignItems: 'center',
    gap: spacing.xs,
  },
  ringLabelHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  tierPillGold: {
    backgroundColor: '#8A5D23',
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  suitesGridRing: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
    gap: 4,
  },
  sectorBlock: {
    borderRadius: 6,
    padding: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DDE1DA',
  },
  suiteSectorBlock: {
    flexGrow: 1,
    flexBasis: 96,
    minHeight: 48,
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: '#FFF9F0',
    borderColor: '#E8D2A8',
  },
  miniBeoDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#8A5D23',
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 3,
  },

  /* ── Club Level ── */
  clubTierRing: {
    width: '98%',
    backgroundColor: '#0B1C2E',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#1E3A5F',
    padding: 6,
    alignItems: 'center',
    gap: spacing.xs,
  },
  ribbonLedDisplay: {
    width: '100%',
    backgroundColor: '#001428',
    borderRadius: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00E5FF',
  },
  ribbonLedText: {
    color: '#00E5FF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  clubSectorsRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 4,
  },
  clubSectorBlock: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    minHeight: 38,
    backgroundColor: '#13283E',
    borderColor: '#24486E',
  },

  /* ── Concourse 100 ── */
  concourseLevelRing: {
    width: '98%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#CBD5CD',
    padding: 6,
    alignItems: 'center',
    gap: 6,
  },
  tierPillConcourse: {
    backgroundColor: '#013369',
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  concoursePerimeterRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-around',
    gap: 4,
  },
  concourseOutletBlock: {
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    backgroundColor: '#F1F6F2',
  },

  /* ── Playing Field Core ── */
  fieldAndSidelinesCore: {
    width: '100%',
    backgroundColor: '#01142F',
    borderRadius: 14,
    padding: 6,
    gap: 4,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  endzoneRowWrapper: {
    flexDirection: 'row',
    width: '100%',
    gap: 4,
  },
  bunkerBox: {
    flex: 1,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#D4AF37',
    backgroundColor: '#4A341E',
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endzoneBlock: {
    flex: 1.6,
    borderRadius: 6,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: '#00143F',
  },
  centerFieldAndSidelinesRow: {
    flexDirection: 'row',
    width: '100%',
    minHeight: 125,
    gap: 4,
  },
  sidelineStrip: {
    width: 68,
    borderRadius: 6,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: '#001C38',
  },
  actualPlayingField: {
    flex: 1,
    backgroundColor: '#1E6F3B',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  fieldYardGrid: {
    position: 'absolute',
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  yardNumText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    opacity: 0.85,
  },
  midfieldLogoCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(1, 20, 63, 0.75)',
    borderRadius: 50,
    padding: 8,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },

  /* ── Level 0 Lockers & Aux ── */
  undergroundLockerCompound: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#37474F',
    padding: spacing.sm,
    gap: 6,
  },
  tierPillUnderground: {
    backgroundColor: '#37474F',
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  lockersGridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  lockerRoomCard: {
    flexGrow: 1,
    flexBasis: 160,
    padding: 6,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#DDE1DA',
    gap: 2,
  },
  upperDeckSectors: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    gap: 4,
  },

  /* ── Floating BEO & Amenities HUD Pop-Up ── */
  floatingBeoHudOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FFD700',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 20,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  floatingBeoHudHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#ECEFF1',
    paddingBottom: 6,
  },
  glowingBeaconDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFD700',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 6,
  },
  floatingBeoHudCode: {
    fontSize: 12,
    fontWeight: '900',
    color: '#013369',
  },
  floatingBeoZonePill: {
    fontSize: 10,
    fontWeight: '700',
    color: '#68706A',
    backgroundColor: '#ECEFF1',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  floatingBeoHudTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1D2420',
  },
  floatingBeoContentBody: {
    gap: 6,
  },
  beoDetailsBox: {
    backgroundColor: '#FFFDF9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E8D2A8',
    padding: 8,
    gap: 4,
  },
  beoNumberLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8A5D23',
  },
  beoStatusTag: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  beoStatusTagText: {
    color: '#2E7D32',
    fontSize: 8,
    fontWeight: '800',
  },
  beoPackageTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1D2420',
  },
  beoSuiteholderText: {
    fontSize: 11,
    color: '#68706A',
  },
  beoItemsList: {
    gap: 2,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F0E6D2',
    paddingTop: 4,
  },
  beoItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  beoItemQty: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8A5D23',
    width: 24,
  },
  beoItemName: {
    flex: 1,
    fontSize: 10,
    color: '#1D2420',
  },
  beoItemStatus: {
    fontSize: 8,
    fontWeight: '800',
    color: '#2E7D32',
  },
  standAmenitiesBox: {
    backgroundColor: '#F0F7FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#B0D4FF',
    padding: 8,
    gap: 3,
  },
  standConceptHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#013369',
  },
  standConceptDesc: {
    fontSize: 11,
    color: '#1D2420',
  },
  standMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  standMetricItem: {
    fontSize: 10,
    color: '#68706A',
  },
  floatingHudActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 2,
  },
  hudPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#013369',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
  },
  hudPrimaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
  },
});
