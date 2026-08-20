import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TextInput } from 'react-native-paper';
import { CommandButton, CommandText, StatusPill } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';
import { useResponsive } from '../lib/responsive';
import { StadiumUnitDetailModal, type StadiumZoneItem } from './StadiumUnitDetailModal';
import Stadium3DModel from './Stadium3DModel';

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

  // ── 5. LUXURY SUITES (LEVEL 300 & 400 · 80 SUITES) ─────────────────────
  {
    id: 'zone-300-suites',
    name: 'Luxury Suites & Loge Boxes (Level 300 & 400 · 80 Suites)',
    code: 'SUITES-300-400',
    level: '3',
    department: 'premium_hospitality',
    category: 'luxury_suites',
    unitsCount: 80,
    openCount: 80,
    alertCount: 0,
    units: [
      // ── Level 300 West Sideline Founders Suites (301–320) ──
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
            { id: 'po-301-5', name: 'Executive Pastry Chef Grand Dessert Cart', quantity: 26, category: 'dessert', status: 'prepped', scheduledTime: 'Halftime' },
          ],
          inSuiteOrders: [
            { id: 'iso-301-1', orderedAt: '1:15 PM (Q1 08:42)', orderedBy: 'Suite Host Tablet', items: '2x Casamigos Reposado Carafe, 1x Extra Ice Bucket', totalCents: 24000, status: 'fulfilled' },
            { id: 'iso-301-2', orderedAt: '1:50 PM (Q2 02:15)', orderedBy: 'Attendant Alice T.', items: '1x Crispy Hot Wings Platter (30ct), 4x Diet Coke', totalCents: 9500, status: 'delivering' },
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
        name: 'Suite 304 · Chevron Energy Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 26,
        stadiumZone: 'West Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '304',
          suiteholder: 'Chevron Global Energy',
          tier: 'Founders Suite',
          guestCount: 24,
          beoNumber: 'BEO-NFL-2026-904',
          beoPackageName: 'Prime Steaks & Vintage Cellar',
        },
      },
      {
        id: 'u-305',
        code: 'SUITE-305',
        name: 'Suite 305 · Valero Refining Suite',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 22,
        stadiumZone: 'West Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '305',
          suiteholder: 'Valero Energy Corporation',
          tier: 'Executive Luxury Suite',
          guestCount: 20,
          beoNumber: 'BEO-NFL-2026-905',
          beoPackageName: 'Texas Smokehouse & Craft Ale Bar',
        },
      },
      {
        id: 'u-306',
        code: 'SUITE-306',
        name: 'Suite 306 · H-E-B Culinary Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 30,
        stadiumZone: 'West Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '306',
          suiteholder: 'H-E-B Food & Grocery',
          tier: 'Founders Suite',
          guestCount: 28,
          beoNumber: 'BEO-NFL-2026-906',
          beoPackageName: 'Texas Prime Brisket & Farm Fresh Tapas',
        },
      },
      {
        id: 'u-307',
        code: 'SUITE-307',
        name: 'Suite 307 · ConocoPhillips Energy Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 24,
        stadiumZone: 'West Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '307',
          suiteholder: 'ConocoPhillips Corporation',
          tier: 'Executive Luxury Suite',
          guestCount: 22,
          beoNumber: 'BEO-NFL-2026-907',
          beoPackageName: 'Prime Tenderloin & Cabernet Reserve',
        },
      },
      {
        id: 'u-308',
        code: 'SUITE-308',
        name: 'Suite 308 · Sysco Corporate Dining Suite',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 26,
        stadiumZone: 'West Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '308',
          suiteholder: 'Sysco Corporation',
          tier: 'Founders Suite',
          guestCount: 25,
          beoNumber: 'BEO-NFL-2026-908',
          beoPackageName: 'Artisan Chef Signature Tasting Menu',
        },
      },
      {
        id: 'u-309',
        code: 'SUITE-309',
        name: 'Suite 309 · Baker Hughes Technology Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 22,
        stadiumZone: 'West Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '309',
          suiteholder: 'Baker Hughes',
          tier: 'Executive Luxury Suite',
          guestCount: 20,
          beoNumber: 'BEO-NFL-2026-909',
          beoPackageName: 'Gourmet Sliders & Craft Spirits',
        },
      },
      {
        id: 'u-310',
        code: 'SUITE-310',
        name: 'Suite 310 · Halliburton 50-Yardline Box',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 32,
        stadiumZone: 'West Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '310',
          suiteholder: 'Halliburton Energy Services',
          tier: 'Founders Midfield Box',
          guestCount: 30,
          beoNumber: 'BEO-NFL-2026-910',
          beoPackageName: 'Presidential Gold Hospitality Package',
        },
      },
      ...Array.from({ length: 10 }, (_, i) => {
        const num = 311 + i;
        const sponsors = ['Crown Castle', 'CenterPoint Energy', 'Phillips 66', 'Occidental Petroleum', 'NRG Energy', 'Woodside Energy', 'LyondellBasell', 'Houston Methodist', 'Memorial Hermann', 'MD Anderson Cancer Center'];
        const sponsor = sponsors[i] ?? `Corporate Partner ${num}`;
        return {
          id: `u-${num}`,
          code: `SUITE-${num}`,
          name: `Suite ${num} · ${sponsor}`,
          department: 'premium_hospitality',
          type: 'premium_suite' as const,
          capacity: 22,
          stadiumZone: 'West Suite Tower Level 3',
          level: '3',
          status: 'open' as const,
          suiteDetails: {
            suiteNumber: String(num),
            suiteholder: sponsor,
            tier: 'Executive Luxury Suite',
            guestCount: 20,
            beoNumber: `BEO-NFL-2026-${num}`,
            beoPackageName: 'Gourmet Gameday Suite Buffet',
            menuPackage: 'Prime carving meats, artisan flatbreads, craft beverages',
          },
        };
      }),

      // ── Level 300 East Sideline Corporate Suites (321–340) ──
      {
        id: 'u-321',
        code: 'SUITE-321',
        name: 'Suite 321 · Vanguard Tech Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 24,
        stadiumZone: 'East Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '321',
          suiteholder: 'Vanguard Tech Corporation',
          tier: 'Executive Luxury Suite',
          guestCount: 22,
          beoNumber: 'BEO-NFL-2026-921',
          beoPackageName: 'Coastal Seafood & Champagne',
        },
      },
      {
        id: 'u-322',
        code: 'SUITE-322',
        name: 'Suite 322 · Meridian Health Skybox',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 26,
        stadiumZone: 'East Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '322',
          suiteholder: 'Meridian Health Network',
          tier: 'Founders Suite',
          guestCount: 24,
          beoNumber: 'BEO-NFL-2026-922',
          beoPackageName: 'Grand Mediterranean Tapas & Prime Tenderloin',
        },
      },
      {
        id: 'u-323',
        code: 'SUITE-323',
        name: 'Suite 323 · NFL League Executive Box',
        department: 'premium_hospitality',
        type: 'premium_suite',
        capacity: 35,
        stadiumZone: 'East Suite Tower Level 3',
        level: '3',
        status: 'open',
        suiteDetails: {
          suiteNumber: '323',
          suiteholder: 'NFL League Executive Office',
          tier: 'Commissioner Skybox',
          guestCount: 32,
          beoNumber: 'BEO-NFL-2026-923',
          beoPackageName: 'Presidential Diamond Hospitality Banquet',
        },
      },
      ...Array.from({ length: 17 }, (_, i) => {
        const num = 324 + i;
        const sponsors = ['Waste Management', 'Kinder Morgan', 'Enterprise Products', 'KBR Inc', 'Cheniere Energy', 'Calpine', 'Insperity', 'Prosperity Bancshares', 'Group 1 Automotive', 'Quanta Services', 'Westlake Chemical', 'Service Corporation', 'Camden Property', 'Coterra Energy', 'APA Corporation', 'Southwestern Energy', 'EOG Resources'];
        const sponsor = sponsors[i] ?? `Corporate Partner ${num}`;
        return {
          id: `u-${num}`,
          code: `SUITE-${num}`,
          name: `Suite ${num} · ${sponsor}`,
          department: 'premium_hospitality',
          type: 'premium_suite' as const,
          capacity: 22,
          stadiumZone: 'East Suite Tower Level 3',
          level: '3',
          status: 'open' as const,
          suiteDetails: {
            suiteNumber: String(num),
            suiteholder: sponsor,
            tier: 'Executive Luxury Suite',
            guestCount: 20,
            beoNumber: `BEO-NFL-2026-${num}`,
            beoPackageName: 'Executive Gameday Spread & Bar',
            menuPackage: 'Gourmet slider bar, charcuterie towers, open premium bar',
          },
        };
      }),

      // ── Level 300 North & South Endzone Suites (341–360) ──
      ...Array.from({ length: 20 }, (_, i) => {
        const num = 341 + i;
        const isNorth = i < 10;
        const sponsors = ['Texas Medical Center', 'United Airlines', 'BMC Software', 'American Campus', 'Academy Sports', 'Kirby Corp', 'Powell Industries', 'Stewart Information', 'Comfort Systems', 'Main Street Capital', 'Stage Stores', 'Landmark Graphics', 'Weatherford', 'Nabors Industries', 'Oceaneering', 'McDermott International', 'Helix Energy', 'Noble Corp', 'Transocean', 'Diamond Offshore'];
        const sponsor = sponsors[i] ?? `Endzone Partner ${num}`;
        return {
          id: `u-${num}`,
          code: `SUITE-${num}`,
          name: `Suite ${num} · ${sponsor}`,
          department: 'premium_hospitality',
          type: 'premium_suite' as const,
          capacity: 24,
          stadiumZone: isNorth ? 'North Endzone Suite Ring' : 'South Endzone Suite Ring',
          level: '3',
          status: 'open' as const,
          suiteDetails: {
            suiteNumber: String(num),
            suiteholder: sponsor,
            tier: isNorth ? 'North Touchdown Suite' : 'South Touchdown Suite',
            guestCount: 22,
            beoNumber: `BEO-NFL-2026-${num}`,
            beoPackageName: 'Touchdown Terrace Buffet & Spirits',
            menuPackage: 'BBQ ribs, Texas sausages, mac & cheese, craft beer tubs',
          },
        };
      }),

      // ── Level 400 Loge & Chairman Suites (401–440) ──
      ...Array.from({ length: 40 }, (_, i) => {
        const num = 401 + i;
        const isWest = i < 20;
        return {
          id: `u-${num}`,
          code: `SUITE-${num}`,
          name: `Suite ${num} · ${isWest ? 'West' : 'East'} Loge Suite ${num}`,
          department: 'premium_hospitality',
          type: 'premium_suite' as const,
          capacity: 18,
          stadiumZone: isWest ? 'Level 400 West Loge' : 'Level 400 East Loge',
          level: '4',
          status: 'open' as const,
          suiteDetails: {
            suiteNumber: String(num),
            suiteholder: `Loge Member #${num}`,
            tier: 'Level 400 Loge Suite',
            guestCount: 16,
            beoNumber: `BEO-NFL-2026-${num}`,
            beoPackageName: 'Loge Box Gameday Hospitality',
            menuPackage: 'Artisan sandwiches, chips & dip, craft beers, wine',
          },
        };
      }),
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
                        style={{ color: isActive ? '#FFFFFF' : '#1D2420', fontWeight: '700' }}
                      >
                        {lvl.label}
                      </CommandText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Actual GLB renderer in 3D mode; the architectural plan remains available in 2D mode.
                Explicit height here (see interactiveModelFrame below for why the frame's own
                base style can no longer carry `flex: 1`) — without it the WebGL canvas grew to
                over 12,000px tall on web, rendering off-screen and pushing every control below
                it, including the Stadium F&B Workflows buttons on the outer page, far out of
                reach. */}
            {viewPerspective === '3d_isometric' ? (
              <View style={[styles.interactiveModelFrame, { height: isMobile ? 300 : 380 }]}>
                <Stadium3DModel
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

                        {/* Architectural Micro-Suite Grid (Realistic stadium suite cells) */}
                        <View style={styles.microSuitesGridRing}>
                          {filteredFloorSuites.map((unit) => {
                            const isSelected = selectedUnitId === unit.id;
                            const hasBeo = Boolean(unit.suiteDetails?.beoNumber);
                            const suiteNum = unit.suiteDetails?.suiteNumber ?? unit.code.replace('SUITE-', '');
                            return (
                              <Pressable
                                key={unit.id}
                                onPress={() => handleUnitPress(unit, 'zone-300-suites')}
                                style={[
                                  styles.microSuiteCell,
                                  isSelected ? styles.microSuiteCellActive : null,
                                ]}
                              >
                                <View style={styles.microSuiteHeader}>
                                  <View
                                    style={[
                                      styles.microSuiteStatusDot,
                                      {
                                        backgroundColor: hasBeo
                                          ? '#2E7D32'
                                          : isSelected
                                            ? '#FFD700'
                                            : '#90A4AE',
                                      },
                                    ]}
                                  />
                                  <Text
                                    numberOfLines={1}
                                    style={[
                                      styles.microSuiteNumberText,
                                      isSelected ? styles.microSuiteNumberTextActive : null,
                                    ]}
                                  >
                                    {suiteNum}
                                  </Text>
                                </View>
                                <Text
                                  numberOfLines={1}
                                  style={[
                                    styles.microSuiteHolderMini,
                                    isSelected ? styles.microSuiteHolderMiniActive : null,
                                  ]}
                                >
                                  {unit.suiteDetails?.suiteholder?.split(' ')[0] ?? unit.code}
                                </Text>
                                {isSelected ? (
                                  <View style={styles.microSuiteActivePill}>
                                    <Text style={styles.microSuiteActivePillText}>★</Text>
                                  </View>
                                ) : null}
                              </Pressable>
                            );
                          })}
                        </View>

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
  interactiveModelFrame: {
    // No `flex` here: `flex: 1` sets `flex-basis: 0%`, which wins over an
    // explicit `height` in flex sizing — the inline `height` override at the
    // call site was being ignored, and this frame (and the WebGL canvas
    // inside it) grew to fill whatever free space its row sibling (the
    // unclamped, often much taller sector directory) left available on the
    // page's ScrollView, well past 12,000px on a real venue's worth of zones.
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#08131F',
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
  ringLabelHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  xfinityBadge: {
    backgroundColor: '#8A2BE2',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  xfinityText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
  },
  /* ── 3D Gate Tower Architectural Structures ── */
  gateNorthWrapper: {
    width: '94%',
    alignItems: 'center',
    zIndex: 10,
  },
  gateSouthWrapper: {
    width: '94%',
    alignItems: 'center',
    zIndex: 10,
  },
  gateTowerStructure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    borderRadius: 12,
    borderWidth: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  gateNorthTower: {
    backgroundColor: '#001E3D',
    borderColor: '#0055A5',
  },
  gateSouthTower: {
    backgroundColor: '#38070D',
    borderColor: '#C62828',
  },
  gatePylonPillarLeft: {
    width: 8,
    height: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 4,
  },
  gatePylonPillarRight: {
    width: 8,
    height: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 4,
  },
  gateTowerCenterHub: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  gateFordBadge: {
    backgroundColor: '#003366',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  gateFordText: {
    color: '#FFFFFF',
    fontStyle: 'italic',
    fontWeight: '900',
    fontSize: 15,
    letterSpacing: 1,
  },
  gateBadgeSub: {
    color: '#B0C4DE',
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  gateKrogerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#D50A0A',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  gateKrogerText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 14,
  },
  gateTowerTitle: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  turnstileBayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  turnstileCanopy: {
    width: 14,
    height: 3,
    backgroundColor: '#00E5FF',
    borderRadius: 2,
  },
  turnstileMetaText: {
    color: '#B0C4DE',
    fontSize: 9,
    fontWeight: '600',
  },
  gateTowerActive: {
    borderColor: '#FFD700',
    borderWidth: 3,
    transform: [{ translateY: -4 }, { scale: 1.02 }],
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 16,
    elevation: 16,
  },
  architecturalActiveBadge: {
    position: 'absolute',
    top: -10,
    right: 14,
    backgroundColor: '#FFD700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  architecturalActiveBadgeText: {
    color: '#013369',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },

  /* ── Side Gate Towers (West Phillips 66 & East Xfinity) ── */
  middleGatesSideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 6,
  },
  sideGateTowerWest: {
    width: 64,
    minHeight: 160,
    backgroundColor: '#1E0C10',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#C62828',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    gap: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  sideGateTowerEast: {
    width: 64,
    minHeight: 160,
    backgroundColor: '#1A0B28',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#7B1FA2',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    gap: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
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
  sideGateTowerText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  sideGatePylonFin: {
    width: '80%',
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    marginVertical: 2,
  },
  sideGateTowerSub: {
    color: '#B0BEC5',
    fontSize: 7,
    textAlign: 'center',
    fontWeight: '600',
  },
  sideGateActiveIndicator: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    marginTop: 4,
  },
  sideGateActiveIndicatorText: {
    color: '#013369',
    fontSize: 7,
    fontWeight: '900',
  },

  /* ── Jumbotrons ── */
  jumbotronDisplayBox: {
    width: '86%',
    alignItems: 'center',
  },
  jumboScreenNorth: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#021224',
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
    backgroundColor: '#021224',
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

  /* ── Level 500/600 Upper Bowl: Grandstand Seating Sectors ── */
  outerUpperDeckRingRed: {
    width: '100%',
    backgroundColor: '#4A050D',
    borderRadius: 36,
    borderWidth: 3,
    borderColor: '#B71C1C',
    padding: spacing.sm,
    alignItems: 'center',
    gap: spacing.xs,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 10,
  },
  stadiumTierBadgeRed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#B71C1C',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#EF5350',
  },
  tierPillRedText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  upperDeckSectors: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    gap: 6,
  },
  grandstandSeatingSection: {
    flex: 1,
    minHeight: 64,
    backgroundColor: '#7F131D',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#9E1C27',
    padding: 5,
    justifyContent: 'space-between',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  grandstandSectionActive: {
    backgroundColor: '#B71C1C',
    borderColor: '#FFD700',
    borderWidth: 2.5,
    transform: [{ translateY: -5 }, { scale: 1.04 }],
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 14,
    elevation: 14,
  },
  grandstandFloodlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  floodlightDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  floodlightDotActive: {
    backgroundColor: '#FFD700',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 4,
  },
  grandstandSectionCode: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  steppedSeatsContainer: {
    gap: 2,
    marginVertical: 2,
  },
  seatRowLine: {
    height: 2,
    backgroundColor: '#E57373',
    borderRadius: 1,
  },
  grandstandLowerDeck: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  grandstandTitleText: {
    flex: 1,
    color: '#FFCDD2',
    fontSize: 9,
    fontWeight: '700',
  },
  vomitoryTunnelArch: {
    backgroundColor: '#260307',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  vomitoryTunnelText: {
    color: '#B0BEC5',
    fontSize: 6,
    fontWeight: '800',
  },
  grandstandActiveHalo: {
    position: 'absolute',
    top: -8,
    right: 4,
    backgroundColor: '#FFD700',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  grandstandActiveHaloText: {
    color: '#013369',
    fontSize: 7,
    fontWeight: '900',
  },

  /* ── Level 300 & 400 Luxury Suites: Glass Cantilevered Pavilions ── */
  suitesTierRing: {
    flex: 1,
    backgroundColor: '#101720',
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#D4AF37',
    padding: spacing.xs,
    alignItems: 'center',
    gap: spacing.xs,
  },
  stadiumTierBadgeGold: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#7A5A1A',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  tierPillGoldText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  suitesGridRing: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
    gap: 6,
  },
  suitePavilionBox: {
    flexGrow: 1,
    flexBasis: 100,
    minHeight: 56,
    backgroundColor: '#1E2835',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#B8860B',
    overflow: 'hidden',
  },
  suitePavilionActive: {
    backgroundColor: '#2A3B4E',
    borderColor: '#FFD700',
    borderWidth: 2.5,
    transform: [{ translateY: -5 }, { scale: 1.04 }],
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 14,
    elevation: 14,
  },
  suiteGlassFacade: {
    backgroundColor: 'rgba(0, 229, 255, 0.12)',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#B8860B',
  },
  suiteBalconyRail: {
    height: 2,
    backgroundColor: '#D4AF37',
    width: '100%',
    marginBottom: 2,
  },
  suiteCodeText: {
    fontSize: 11,
    fontWeight: '900',
  },
  suiteBeoChip: {
    backgroundColor: '#7A5A1A',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  suiteBeoChipText: {
    color: '#FFD700',
    fontSize: 7,
    fontWeight: '900',
  },
  suiteLoungeInterior: {
    padding: 4,
  },
  suiteholderText: {
    fontSize: 10,
    fontWeight: '800',
  },
  suiteTierSub: {
    fontSize: 8,
    fontWeight: '600',
  },
  suiteActiveBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: '#FFD700',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  suiteActiveBadgeText: {
    color: '#013369',
    fontSize: 7,
    fontWeight: '900',
  },

  /* ── Level 200 Club Level: Curved Terrace ── */
  clubTierRing: {
    width: '98%',
    backgroundColor: '#071524',
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#1E3A5F',
    padding: 6,
    alignItems: 'center',
    gap: spacing.xs,
  },
  ribbonLedDisplay: {
    width: '100%',
    backgroundColor: '#001020',
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
    gap: 6,
  },
  clubTerraceSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 42,
    backgroundColor: '#0E2238',
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#1E4976',
    paddingHorizontal: 8,
  },
  clubTerraceActive: {
    backgroundColor: '#013369',
    borderColor: '#FFD700',
    borderWidth: 2.5,
    transform: [{ translateY: -4 }, { scale: 1.03 }],
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 12,
    elevation: 12,
  },
  clubArmchairIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 229, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clubTerraceTitle: {
    fontSize: 11,
    fontWeight: '800',
  },
  clubTerraceSub: {
    fontSize: 8,
    color: '#81D4FA',
  },
  clubActivePill: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  clubActivePillText: {
    color: '#013369',
    fontSize: 7,
    fontWeight: '900',
  },

  /* ── Level 100 Main Concourse: Culinary Storefront Plazas ── */
  concourseLevelRing: {
    width: '98%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#CBD5CD',
    padding: 6,
    alignItems: 'center',
    gap: 6,
  },
  stadiumTierBadgeNavy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#013369',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tierPillNavyText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  concoursePerimeterRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-around',
    gap: 6,
  },
  concourseHubStorefront: {
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
    backgroundColor: '#F1F6F2',
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#CBD5CD',
    overflow: 'hidden',
  },
  concourseAwningStripe: {
    height: 4,
    backgroundColor: '#013369',
    width: '100%',
  },
  concourseHubActive: {
    backgroundColor: '#013369',
    borderColor: '#FFD700',
    borderWidth: 2.5,
    transform: [{ translateY: -4 }, { scale: 1.03 }],
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 12,
    elevation: 12,
  },
  concourseHubCode: {
    fontSize: 11,
    fontWeight: '900',
  },
  concourseHubName: {
    fontSize: 9,
    fontWeight: '700',
  },

  /* ── Playing Field Core & Sideline Compounds ── */
  fieldAndSidelinesCore: {
    width: '100%',
    backgroundColor: '#01142F',
    borderRadius: 14,
    padding: 6,
    gap: 4,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  endzoneRowWrapper: {
    flexDirection: 'row',
    width: '100%',
    gap: 6,
  },
  fieldBunkerVault: {
    flex: 1,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#D4AF37',
    backgroundColor: '#382510',
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  fieldBunkerVaultActive: {
    backgroundColor: '#7A5A1A',
    borderColor: '#FFD700',
    borderWidth: 2.5,
    transform: [{ translateY: -4 }, { scale: 1.03 }],
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 12,
    elevation: 12,
  },
  fieldBunkerTitle: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 11,
  },
  fieldBunkerSub: {
    color: '#E8D2A8',
    fontSize: 8,
    fontWeight: '600',
  },
  bunkerActiveTag: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  bunkerActiveTagText: {
    color: '#013369',
    fontSize: 7,
    fontWeight: '900',
  },

  endzoneTurfSection: {
    flex: 1.6,
    borderRadius: 6,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: '#00143F',
  },
  goalpostStanchion: {
    position: 'absolute',
    top: 2,
  },
  goalpostIcon: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '900',
  },
  endzoneTurfText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 2,
  },
  endzoneTurfSub: {
    color: '#90CAF9',
    fontSize: 8,
    fontWeight: '600',
  },

  centerFieldAndSidelinesRow: {
    flexDirection: 'row',
    width: '100%',
    minHeight: 130,
    gap: 6,
  },
  sidelineBenchTurf: {
    width: 72,
    borderRadius: 6,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: '#001E3D',
    gap: 2,
  },
  sidelineBenchText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 9,
    textAlign: 'center',
  },
  sidelineBenchSub: {
    color: '#81D4FA',
    fontSize: 7,
    textAlign: 'center',
  },
  sidelineYardMarkerPylon: {
    width: 6,
    height: 6,
    backgroundColor: '#FF5722',
    borderRadius: 3,
  },
  fieldPartActive: {
    borderColor: '#FFD700',
    borderWidth: 2.5,
    backgroundColor: '#013369',
    transform: [{ translateY: -4 }, { scale: 1.03 }],
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 14,
    elevation: 14,
  },

  actualPlayingField: {
    flex: 1,
    backgroundColor: '#1E6F3B',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderWidth: 2,
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

  /* ── Level 0 Lockers Compound ── */
  undergroundLockerCompound: {
    width: '100%',
    backgroundColor: '#0A121A',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#263238',
    padding: spacing.sm,
    gap: 6,
  },
  stadiumTierBadgeDark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#263238',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tierPillDarkText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  lockersGridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  lockerRoomCompoundCard: {
    flexGrow: 1,
    flexBasis: 160,
    padding: 6,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#37474F',
    gap: 2,
  },
  lockerRoomActive: {
    borderColor: '#FFD700',
    borderWidth: 2.5,
    backgroundColor: '#013369',
    transform: [{ translateY: -4 }, { scale: 1.03 }],
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 12,
    elevation: 12,
  },
  lockerCodeText: {
    fontSize: 11,
    fontWeight: '900',
  },
  lockerNameText: {
    fontSize: 10,
    fontWeight: '700',
  },
  lockerActiveDot: {
    alignSelf: 'flex-end',
    backgroundColor: '#FFD700',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  lockerActiveDotText: {
    color: '#013369',
    fontSize: 7,
    fontWeight: '900',
  },

  /* ── Floating BEO & Amenities HUD Pop-Up ── */
  floatingBeoHudOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
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

  // ── SUITE FLOOR SELECTOR & DROPDOWN STYLES ──
  suiteFloorTabsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
    backgroundColor: '#FAF5EA',
    borderBottomWidth: 1,
    borderBottomColor: '#F0E6D2',
  },
  suiteFloorTabBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2D4B7',
  },
  suiteFloorTabBtnActive: {
    backgroundColor: '#8A5D23',
    borderColor: '#684518',
  },
  suiteFloorTabText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#684518',
  },
  suiteFloorTabTextActive: {
    color: '#FFFFFF',
  },
  suiteDropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginHorizontal: 8,
    marginTop: 6,
    marginBottom: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#DFCBB0',
  },
  suiteDropdownTriggerOpen: {
    borderColor: '#8A5D23',
    backgroundColor: '#FFFDF9',
  },
  suiteDropdownTriggerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  suiteDropdownTriggerText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D2420',
    flex: 1,
  },
  suiteDropdownTriggerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  suiteDropdownTriggerCount: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8A5D23',
    backgroundColor: '#FDF7EB',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  suiteDropdownMenuBox: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 8,
    marginBottom: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#8A5D23',
    padding: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  suiteDropdownSearchRow: {
    marginBottom: 6,
  },
  suiteDropdownSearchInput: {
    backgroundColor: '#FDFBF7',
    fontSize: 11,
    height: 36,
  },
  suiteDropdownScrollList: {
    maxHeight: 220,
  },
  suiteDropdownItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F5EFE6',
  },
  suiteDropdownItemRowActive: {
    backgroundColor: '#F7F1E5',
    borderBottomColor: '#E2D4B7',
  },
  suiteDropdownItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  suiteStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  suiteDropdownItemNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8A5D23',
  },
  suiteDropdownItemHolder: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1D2420',
    flexShrink: 1,
  },
  suiteDropdownItemTier: {
    fontSize: 9,
    color: '#78909C',
    marginTop: 1,
  },
  suiteDropdownItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 6,
  },
  suiteDropdownBeoPill: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  suiteDropdownBeoPillText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#2E7D32',
  },
  suiteDropdownOpenText: {
    fontSize: 8,
    fontWeight: '700',
    color: '#90A4AE',
  },

  // ── ARCHITECTURAL MICRO-SUITE GRID STYLES ──
  microSuitesGridRing: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    padding: 8,
    backgroundColor: '#FAF5EC',
    justifyContent: 'flex-start',
  },
  microSuiteCell: {
    width: 58,
    height: 38,
    backgroundColor: '#FFFFFF',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#DFD2BC',
    paddingHorizontal: 4,
    paddingVertical: 3,
    justifyContent: 'space-between',
    position: 'relative',
  },
  microSuiteCellActive: {
    borderColor: '#FFD700',
    borderWidth: 2,
    backgroundColor: '#013369',
    shadowColor: '#FFD700',
    shadowOpacity: 0.6,
    shadowRadius: 5,
    elevation: 3,
    transform: [{ scale: 1.06 }],
  },
  microSuiteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  microSuiteStatusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  microSuiteNumberText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8A5D23',
  },
  microSuiteNumberTextActive: {
    color: '#FFD700',
  },
  microSuiteHolderMini: {
    fontSize: 8,
    fontWeight: '600',
    color: '#546E7A',
  },
  microSuiteHolderMiniActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  microSuiteActivePill: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FFD700',
    borderRadius: 6,
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  microSuiteActivePillText: {
    fontSize: 8,
    color: '#013369',
    fontWeight: '900',
  },
});
