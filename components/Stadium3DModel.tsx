'use dom';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type FloorLevelId = 'all' | 'level_0' | 'level_100' | 'level_200' | 'level_300' | 'level_500' | 'roof';
export type FloorViewMode = 'highlight' | 'isolate' | 'exploded';
export type CameraPreset = 'isometric' | 'top_plan' | 'pitch_cam' | 'suite_cam';

export interface StadiumAreaPin {
  id: string;
  code: string;
  name: string;
  floor: FloorLevelId;
  pos: [number, number, number];
  category: string;
  capacity: string;
  concept: string;
  status: string;
  icon?: string;
}

export const STADIUM_AREA_PINS: StadiumAreaPin[] = [
  // ── LEVEL 0: ATHLETE COMPOUND & FIELD CORE ──
  {
    id: 'side-home',
    code: 'SIDE-HOME',
    name: 'Home Sideline & Hydration',
    floor: 'level_0',
    pos: [-5, 0.4, 0],
    category: 'Team Operations',
    capacity: '120 Pax',
    concept: 'Team Performance Hydration & VIP Sideline Pass',
    status: 'Active',
  },
  {
    id: 'side-visit',
    code: 'SIDE-VISIT',
    name: 'Visiting Sideline & Media Deck',
    floor: 'level_0',
    pos: [5, 0.4, 0],
    category: 'Broadcast & Media',
    capacity: '120 Pax',
    concept: 'Visiting Bench Service & Network Camera Operations',
    status: 'Active',
  },
  {
    id: 'endzone-n',
    code: 'ENDZONE-N',
    name: 'North Endzone Lounge',
    floor: 'level_0',
    pos: [0, 0.4, -9],
    category: 'Field Hospitality',
    capacity: '250 Pax',
    concept: 'Field-Level Goalpost Bar & Mobile In-Seat Dispatch',
    status: 'Open',
  },
  {
    id: 'endzone-s',
    code: 'ENDZONE-S',
    name: 'South Endzone Lounge',
    floor: 'level_0',
    pos: [0, 0.4, 9],
    category: 'Field Hospitality',
    capacity: '250 Pax',
    concept: 'Red Zone Patio & Field Level Suites',
    status: 'Open',
  },
  {
    id: 'lck-home',
    code: 'LCK-HOME',
    name: 'Texans Home Locker Compound',
    floor: 'level_0',
    pos: [-7, 0.4, -6],
    category: 'Athlete Compound',
    capacity: '75 Athletes',
    concept: 'Hydrotherapy, Strategy Theatres & Recovery Suites',
    status: 'Restricted',
  },
  {
    id: 'lck-visit',
    code: 'LCK-VISIT',
    name: 'Visiting Team Locker Suite',
    floor: 'level_0',
    pos: [7, 0.4, -6],
    category: 'Athlete Compound',
    capacity: '75 Athletes',
    concept: 'Visiting Team Official Locker Suite & Staging',
    status: 'Active',
  },
  {
    id: 'aux-headliner',
    code: 'AUX-HEAD',
    name: 'Headliner Performer Suite 101',
    floor: 'level_0',
    pos: [-7, 0.4, 6],
    category: 'VIP Auxiliary',
    capacity: '30 VIPs',
    concept: 'Green Room Luxury Hospitality & Private Dressing',
    status: '★ BEO Ready',
  },

  // ── LEVEL 100: MAIN CONCOURSE & HUBS & BUNKERS ──
  {
    id: 'gate-n',
    code: 'GATE-N',
    name: 'Ford North Main Gate',
    floor: 'level_100',
    pos: [0, 2.8, -14],
    category: 'Main Entry Gate',
    capacity: '18 Turnstiles',
    concept: 'High-Throughput Fast-Pass & Digital Credential Bay',
    status: 'Open',
  },
  {
    id: 'gate-s',
    code: 'GATE-S',
    name: 'Amegy South Main Gate',
    floor: 'level_100',
    pos: [0, 2.8, 14],
    category: 'Main Entry Gate',
    capacity: '16 Turnstiles',
    concept: 'South Plaza Entry & ADA Accessibility Portal',
    status: 'Open',
  },
  {
    id: 'bunker-n',
    code: 'BUNKER-N',
    name: 'North Bunker Vault',
    floor: 'level_100',
    pos: [0, 1.2, -11.5],
    category: 'VIP Field Bunker',
    capacity: '150 VIPs',
    concept: 'Prime Rib Carving Station & Sommelier Reserve Cellar',
    status: '★ BEO Ready',
  },
  {
    id: 'bunker-s',
    code: 'BUNKER-S',
    name: 'South Bunker Club',
    floor: 'level_100',
    pos: [0, 1.2, 11.5],
    category: 'VIP Field Bunker',
    capacity: '150 VIPs',
    concept: 'Private Speakeasy & Craft Spirits Lounge',
    status: '★ BEO Ready',
  },
  {
    id: 'hub-killens',
    code: 'HUB-101',
    name: "Killen's Texas Barbecue Hub",
    floor: 'level_100',
    pos: [-9, 2.2, -6],
    category: 'Concourse F&B',
    capacity: '6 POS Terminals',
    concept: 'Smoked Prime Brisket, Sausage Links & BBQ Sides',
    status: 'Open',
  },
  {
    id: 'hub-trill',
    code: 'HUB-102',
    name: 'Trill Burgers Hub',
    floor: 'level_100',
    pos: [9, 2.2, -6],
    category: 'Concourse F&B',
    capacity: '8 POS Terminals',
    concept: 'OG Smashburgers, Signature Sauce & Seasoned Fries',
    status: 'Open',
  },
  {
    id: 'hub-budlight',
    code: 'HUB-103',
    name: 'Bud Light Cantina Hub',
    floor: 'level_100',
    pos: [-9, 2.2, 6],
    category: 'Concourse F&B',
    capacity: '6 POS Terminals',
    concept: 'Ice Cold Drafts, Loaded Nachos & Signature Cocktails',
    status: 'Open',
  },
  {
    id: 'hub-crown',
    code: 'HUB-104',
    name: 'Crown Royal Craft Hub',
    floor: 'level_100',
    pos: [9, 2.2, 6],
    category: 'Concourse F&B',
    capacity: '4 POS Terminals',
    concept: 'Handcrafted Cocktails & Premium Spirits Bar',
    status: 'Open',
  },

  // ── LEVEL 200: CLUB LEVEL TERRACES & LED RIBBON ──
  {
    id: 'club-w',
    code: 'CLUB-WEST',
    name: 'West Club Terrace & Lounge',
    floor: 'level_200',
    pos: [-10, 3.4, 0],
    category: 'Club Level',
    capacity: '850 Members',
    concept: 'Plush Armchairs, Chef Carvery Stations & Premium Bar',
    status: 'Open',
  },
  {
    id: 'club-e',
    code: 'CLUB-EAST',
    name: 'East Club Terrace & Bar',
    floor: 'level_200',
    pos: [10, 3.4, 0],
    category: 'Club Level',
    capacity: '850 Members',
    concept: 'Cocktail Lounge, 50-Yard Sightlines & Sommelier Bar',
    status: 'Open',
  },
  {
    id: 'ribbon-led',
    code: 'LED-360',
    name: '360° Dynamic LED Ribbon',
    floor: 'level_200',
    pos: [0, 3.6, -11],
    category: 'LED Display System',
    capacity: 'Full Perimeter',
    concept: 'Live Game Stats, Highlights & Dynamic Brand Animations',
    status: 'Active',
  },

  // ── LEVEL 300/400: LUXURY EXECUTIVE SUITES ──
  {
    id: 'suite-301',
    code: 'SUITE-301',
    name: 'Founders Skybox 301',
    floor: 'level_300',
    pos: [-10.8, 4.4, -3],
    category: 'VIP Skybox',
    capacity: '28 Guests',
    concept: 'Caviar, Champagne & Private Chef Hospitality Buffet',
    status: '★ BEO Ready',
  },
  {
    id: 'suite-302',
    code: 'SUITE-302',
    name: 'Executive Suite 302',
    floor: 'level_300',
    pos: [-10.8, 4.4, 0],
    category: 'Luxury Suite',
    capacity: '22 Guests',
    concept: 'Gourmet Sliders, Craft Beer & Charcuterie Boards',
    status: '★ BEO Ready',
  },
  {
    id: 'suite-303',
    code: 'SUITE-303',
    name: 'Chairman Suite 303',
    floor: 'level_300',
    pos: [-10.8, 4.4, 3],
    category: 'Luxury Suite',
    capacity: '24 Guests',
    concept: 'Private Sommelier Bar, Seafood Platter & Hot Entrees',
    status: 'Open',
  },
  {
    id: 'suite-321',
    code: 'SUITE-321',
    name: 'East Loge Suite 321',
    floor: 'level_300',
    pos: [10.8, 4.4, -3],
    category: 'Loge Suite',
    capacity: '20 Guests',
    concept: 'Tailgate Buffet & Chilled Beverages Bar',
    status: '★ BEO Ready',
  },
  {
    id: 'suite-322',
    code: 'SUITE-322',
    name: 'East Loge Suite 322',
    floor: 'level_300',
    pos: [10.8, 4.4, 0],
    category: 'Loge Suite',
    capacity: '20 Guests',
    concept: 'Executive Hospitality Service & Warm Hors doeuvres',
    status: '★ BEO Ready',
  },
  {
    id: 'suite-323',
    code: 'SUITE-323',
    name: 'East Loge Suite 323',
    floor: 'level_300',
    pos: [10.8, 4.4, 3],
    category: 'Loge Suite',
    capacity: '20 Guests',
    concept: 'Private Balcony, Barista Station & Wine Flights',
    status: 'Open',
  },

  // ── LEVEL 500/600: UPPER GRANDSTAND BOWL ──
  {
    id: 'deck-500-n',
    code: 'DECK-500-N',
    name: 'North Grandstand Deck 500',
    floor: 'level_500',
    pos: [0, 6.4, -13.5],
    category: 'Upper Seating Bowl',
    capacity: '6,200 Seats',
    concept: 'Panoramic Endzone Sightline & Express Grab-and-Go',
    status: 'Open',
  },
  {
    id: 'deck-500-s',
    code: 'DECK-500-S',
    name: 'South Grandstand Deck 500',
    floor: 'level_500',
    pos: [0, 6.4, 13.5],
    category: 'Upper Seating Bowl',
    capacity: '6,200 Seats',
    concept: 'Upper Bowl Seating & High-Capacity Draft Stations',
    status: 'Open',
  },
  {
    id: 'pylon-nw',
    code: 'PYLON-NW',
    name: 'NW Corner Floodlight Mast',
    floor: 'level_500',
    pos: [-13.5, 9.5, -18],
    category: 'Field Lighting',
    capacity: '2.4M Lumens',
    concept: 'Broadcast-Standard LED Stadium Floodlight Array',
    status: 'Active',
  },
  {
    id: 'pylon-ne',
    code: 'PYLON-NE',
    name: 'NE Corner Floodlight Mast',
    floor: 'level_500',
    pos: [13.5, 9.5, -18],
    category: 'Field Lighting',
    capacity: '2.4M Lumens',
    concept: 'Broadcast-Standard LED Stadium Floodlight Array',
    status: 'Active',
  },

  // ── ROOF SUPERSTRUCTURE & JUMBOTRONS ──
  {
    id: 'roof-arches',
    code: 'ROOF-ARCH',
    name: 'Retractable Roof Steel Arches',
    floor: 'roof',
    pos: [0, 10.5, 0],
    category: 'Roof Superstructure',
    capacity: 'Bi-Parting',
    concept: 'Climate-Controlled Mechanized Retractable Roof Arch',
    status: 'Open',
  },
  {
    id: 'jumbo-n',
    code: 'JUMBO-N',
    name: 'North 4K Ultra-HD Jumbotron',
    floor: 'roof',
    pos: [0, 8.8, -17.5],
    category: 'Video Screen',
    capacity: '14,000 sq ft',
    concept: 'Ultra-High-Definition Instant Replays & Live Scoreboard',
    status: 'Active',
  },
  {
    id: 'jumbo-s',
    code: 'JUMBO-S',
    name: 'South 4K Ultra-HD Jumbotron',
    floor: 'roof',
    pos: [0, 8.8, 17.5],
    category: 'Video Screen',
    capacity: '14,000 sq ft',
    concept: 'Ultra-High-Definition Instant Replays & Live Scoreboard',
    status: 'Active',
  },
];

export const FLOOR_LEVEL_OPTIONS: { id: FloorLevelId; label: string; sub: string; icon: string; count: number }[] = [
  { id: 'all', label: '🏢 All Levels (Full Stadium Bowl)', sub: 'Complete 3D Architectural Bowl & Superstructure', icon: '🏢', count: 24 },
  { id: 'level_0', label: '🏃 Level 0 · Athlete Compound & Pitch', sub: 'Playing Field, Goalposts, Lockers & Performer Aux', icon: '🏃', count: 7 },
  { id: 'level_100', label: '🏟️ Level 100 · Concourse & Culinary Hubs', sub: 'Main Gate Towers, 8 Service Hubs & Field Bunkers', icon: '🏟️', count: 8 },
  { id: 'level_200', label: '🍸 Level 200 · Club Level Terraces', sub: 'East & West Club Lounges & 360° LED Ribbon', icon: '🍸', count: 3 },
  { id: 'level_300', label: '👑 Level 300/400 · Luxury Skybox Suites', sub: 'Founders Skyboxes, Private Balconies & BEOs', icon: '👑', count: 6 },
  { id: 'level_500', label: '🚩 Level 500/600 · Upper Grandstands', sub: 'Upper Seating Tiers & Corner Floodlight Pylons', icon: '🚩', count: 4 },
  { id: 'roof', label: '🏗️ Roof Superstructure & Jumbotrons', sub: 'Steel Retractable Arches & 4K Endzone Screens', icon: '🏗️', count: 3 },
];

type Stadium3DModelProps = {
  dom?: import('expo/dom').DOMProps;
};

interface ProjectedPin {
  pin: StadiumAreaPin;
  x: number;
  y: number;
  visible: boolean;
}

export default function Stadium3DModel(_props: Stadium3DModelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');

  // Interactive Floor Level & Mode State
  const [selectedFloor, setSelectedFloor] = useState<FloorLevelId>('all');
  const [floorViewMode, setFloorViewMode] = useState<FloorViewMode>('highlight');
  const [isFloorDropdownOpen, setIsFloorDropdownOpen] = useState(false);
  const [activeAreaDetail, setActiveAreaDetail] = useState<StadiumAreaPin | null>(null);
  const [projectedPins, setProjectedPins] = useState<ProjectedPin[]>([]);

  // Refs for 3D state update inside animation loop
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Group refs for individual floor level tiers
  const floorGroupsRef = useRef<Record<FloorLevelId, THREE.Group | null>>({
    all: null,
    level_0: null,
    level_100: null,
    level_200: null,
    level_300: null,
    level_500: null,
    roof: null,
  });

  // State mirror refs for animation loop
  const selectedFloorRef = useRef<FloorLevelId>('all');
  selectedFloorRef.current = selectedFloor;

  const floorViewModeRef = useRef<FloorViewMode>('highlight');
  floorViewModeRef.current = floorViewMode;

  // Target camera position for smooth interpolation
  const targetCamPosRef = useRef<THREE.Vector3>(new THREE.Vector3(24, 20, 32));
  const targetCamLookRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 3, 0));

  // Initialize Three.js Scene
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#060D15');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, host.clientWidth / host.clientHeight, 0.1, 1000);
    camera.position.set(24, 20, 32);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = true;
    controls.minDistance = 6;
    controls.maxDistance = 140;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.target.set(0, 3, 0);
    controlsRef.current = controls;

    // ── LIGHTING SETUP ──
    const hemiLight = new THREE.HemisphereLight('#E3F2FD', '#0A1A10', 2.8);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#FFFFFF', 4.8);
    keyLight.position.set(24, 40, 28);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    scene.add(keyLight);

    const cyanRimLight = new THREE.DirectionalLight('#00E5FF', 3.0);
    cyanRimLight.position.set(-28, 22, -24);
    scene.add(cyanRimLight);

    const goldAccentLight = new THREE.DirectionalLight('#FFD700', 2.2);
    goldAccentLight.position.set(0, 30, 0);
    scene.add(goldAccentLight);

    // Ground Plaza Base
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(46, 96),
      new THREE.MeshStandardMaterial({ color: '#09121D', roughness: 0.95, metalness: 0.1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    // Concentric Circular Plaza Accent Rings
    for (let r of [22, 32, 42]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r, r + 0.15, 64),
        new THREE.MeshBasicMaterial({ color: '#14283C', side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
      scene.add(ring);
    }

    // ── BUILD DISTINCT 3D FLOOR GROUPS ──

    // 1. LEVEL 0: Athlete Compound, Playing Field & Sidelines
    const groupLevel0 = new THREE.Group();
    groupLevel0.name = 'groupLevel0';

    // Playing Turf Surface
    const turfMesh = new THREE.Mesh(
      new THREE.BoxGeometry(14, 0.4, 24),
      new THREE.MeshStandardMaterial({ color: '#1B6B38', roughness: 0.8, metalness: 0.1 }),
    );
    turfMesh.position.y = 0.2;
    turfMesh.receiveShadow = true;
    groupLevel0.add(turfMesh);

    // Endzones
    const endzoneNorth = new THREE.Mesh(
      new THREE.BoxGeometry(13.6, 0.42, 2.8),
      new THREE.MeshStandardMaterial({ color: '#00143F', roughness: 0.6 }),
    );
    endzoneNorth.position.set(0, 0.21, -10.2);
    groupLevel0.add(endzoneNorth);

    const endzoneSouth = new THREE.Mesh(
      new THREE.BoxGeometry(13.6, 0.42, 2.8),
      new THREE.MeshStandardMaterial({ color: '#B71C1C', roughness: 0.6 }),
    );
    endzoneSouth.position.set(0, 0.21, 10.2);
    groupLevel0.add(endzoneSouth);

    // Yard Lines
    const lineMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
    for (let z = -8; z <= 8; z += 2) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.43, 0.1), lineMat);
      line.position.set(0, 0.215, z);
      groupLevel0.add(line);
    }

    // Goalposts
    const goalpostMat = new THREE.MeshStandardMaterial({ color: '#FFD700', metalness: 0.8, roughness: 0.2 });
    [-11.5, 11.5].forEach((zPos) => {
      const postGroup = new THREE.Group();
      const basePole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4), goalpostMat);
      basePole.position.y = 1.2;
      postGroup.add(basePole);
      const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.8), goalpostMat);
      crossbar.rotation.z = Math.PI / 2;
      crossbar.position.y = 2.4;
      postGroup.add(crossbar);
      [-1.35, 1.35].forEach((xPos) => {
        const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.8), goalpostMat);
        upright.position.set(xPos, 3.8, 0);
        postGroup.add(upright);
      });
      postGroup.position.set(0, 0.4, zPos);
      groupLevel0.add(postGroup);
    });

    // Sideline Benches & Compound Walls
    const benchHome = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.5, 12),
      new THREE.MeshStandardMaterial({ color: '#002C6C', roughness: 0.5 }),
    );
    benchHome.position.set(-6.2, 0.45, 0);
    groupLevel0.add(benchHome);

    const benchVisit = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.5, 12),
      new THREE.MeshStandardMaterial({ color: '#B71C1C', roughness: 0.5 }),
    );
    benchVisit.position.set(6.2, 0.45, 0);
    groupLevel0.add(benchVisit);

    // Underground Athlete Locker Rooms
    const lockerMat = new THREE.MeshStandardMaterial({ color: '#1B2838', roughness: 0.4, metalness: 0.5 });
    const lockerHome = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.8, 5), lockerMat);
    lockerHome.position.set(-8.5, 0.4, -6);
    groupLevel0.add(lockerHome);

    const lockerVisit = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.8, 5), lockerMat);
    lockerVisit.position.set(8.5, 0.4, -6);
    groupLevel0.add(lockerVisit);

    const auxPerformer = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 0.8, 5),
      new THREE.MeshStandardMaterial({ color: '#2A1F08', roughness: 0.4, metalness: 0.6 }),
    );
    auxPerformer.position.set(-8.5, 0.4, 6);
    groupLevel0.add(auxPerformer);

    scene.add(groupLevel0);
    floorGroupsRef.current.level_0 = groupLevel0;

    // 2. LEVEL 100: Main Concourse, Gate Towers, F&B Hubs & VIP Bunkers
    const groupLevel100 = new THREE.Group();
    groupLevel100.name = 'groupLevel100';

    // Concourse Ring Footprint
    const concourseRingGeo = new THREE.CylinderGeometry(13.2, 10.5, 1.6, 48, 1, true);
    const concourseRingMat = new THREE.MeshStandardMaterial({
      color: '#0D2137',
      roughness: 0.6,
      metalness: 0.3,
      side: THREE.DoubleSide,
    });
    const concourseRing = new THREE.Mesh(concourseRingGeo, concourseRingMat);
    concourseRing.position.y = 1.3;
    concourseRing.scale.set(1.1, 1, 1.35);
    groupLevel100.add(concourseRing);

    // Gate Towers (North & South Portals)
    const gateTowerMat = new THREE.MeshStandardMaterial({ color: '#ECEFF1', roughness: 0.3, metalness: 0.6 });
    [-14.5, 14.5].forEach((zPos, idx) => {
      const gateArch = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 1.8), gateTowerMat);
      gateArch.position.set(0, 2.2, zPos);
      groupLevel100.add(gateArch);

      const gateBanner = new THREE.Mesh(
        new THREE.BoxGeometry(6.5, 0.8, 2.0),
        new THREE.MeshBasicMaterial({ color: idx === 0 ? '#002C6C' : '#004B87' }),
      );
      gateBanner.position.set(0, 3.2, zPos);
      groupLevel100.add(gateBanner);
    });

    // 8 Concourse Hub Boxes (Storefront Outlets)
    const hubMat = new THREE.MeshStandardMaterial({ color: '#FFD700', metalness: 0.4, roughness: 0.3 });
    [
      [-9.8, -6],
      [9.8, -6],
      [-9.8, 6],
      [9.8, 6],
      [-11.5, 0],
      [11.5, 0],
    ].forEach(([xPos, zPos]) => {
      const hubBox = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 2.6), hubMat);
      hubBox.position.set(xPos, 2.1, zPos);
      groupLevel100.add(hubBox);
    });

    // VIP Bunkers
    const bunkerNorth = new THREE.Mesh(
      new THREE.BoxGeometry(5.5, 1.2, 2.2),
      new THREE.MeshStandardMaterial({ color: '#092113', roughness: 0.3, metalness: 0.7 }),
    );
    bunkerNorth.position.set(0, 1.2, -11.5);
    groupLevel100.add(bunkerNorth);

    const bunkerSouth = new THREE.Mesh(
      new THREE.BoxGeometry(5.5, 1.2, 2.2),
      new THREE.MeshStandardMaterial({ color: '#092113', roughness: 0.3, metalness: 0.7 }),
    );
    bunkerSouth.position.set(0, 1.2, 11.5);
    groupLevel100.add(bunkerSouth);

    scene.add(groupLevel100);
    floorGroupsRef.current.level_100 = groupLevel100;

    // 3. LEVEL 200: Club Level Terraces & 360° LED Ribbon
    const groupLevel200 = new THREE.Group();
    groupLevel200.name = 'groupLevel200';

    const clubBowlGeo = new THREE.CylinderGeometry(14.8, 13.0, 1.8, 48, 1, true);
    const clubBowlMat = new THREE.MeshStandardMaterial({
      color: '#132B4A',
      roughness: 0.5,
      metalness: 0.4,
      side: THREE.DoubleSide,
    });
    const clubBowl = new THREE.Mesh(clubBowlGeo, clubBowlMat);
    clubBowl.position.y = 2.8;
    clubBowl.scale.set(1.11, 1, 1.36);
    groupLevel200.add(clubBowl);

    // 360 Dynamic Glowing LED Ribbon
    const ledRibbonGeo = new THREE.CylinderGeometry(14.9, 14.85, 0.35, 48, 1, true);
    const ledRibbonMat = new THREE.MeshBasicMaterial({ color: '#00E5FF', side: THREE.DoubleSide });
    const ledRibbon = new THREE.Mesh(ledRibbonGeo, ledRibbonMat);
    ledRibbon.position.y = 3.6;
    ledRibbon.scale.set(1.115, 1, 1.365);
    groupLevel200.add(ledRibbon);

    scene.add(groupLevel200);
    floorGroupsRef.current.level_200 = groupLevel200;

    // 4. LEVEL 300/400: Luxury Executive Suites Tier
    const groupLevel300 = new THREE.Group();
    groupLevel300.name = 'groupLevel300';

    // Suites Ring Gold Tier
    const suitesRingGeo = new THREE.CylinderGeometry(15.6, 14.8, 1.2, 48, 1, true);
    const suitesRingMat = new THREE.MeshStandardMaterial({
      color: '#D4AF37',
      roughness: 0.25,
      metalness: 0.8,
      side: THREE.DoubleSide,
    });
    const suitesRing = new THREE.Mesh(suitesRingGeo, suitesRingMat);
    suitesRing.position.y = 4.3;
    suitesRing.scale.set(1.125, 1, 1.375);
    groupLevel300.add(suitesRing);

    // Suite Glass Balconies (Individual Skybox Units)
    const suiteGlassMat = new THREE.MeshStandardMaterial({
      color: '#E0F7FA',
      transparent: true,
      opacity: 0.7,
      roughness: 0.1,
      metalness: 0.9,
    });
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 2.4), suiteGlassMat);
      const x = Math.cos(angle) * 15.2 * 1.125;
      const z = Math.sin(angle) * 15.2 * 1.375;
      box.position.set(x, 4.3, z);
      box.lookAt(0, 4.3, 0);
      groupLevel300.add(box);
    }

    scene.add(groupLevel300);
    floorGroupsRef.current.level_300 = groupLevel300;

    // 5. LEVEL 500/600: Upper Grandstand Bowl & Corner Floodlights
    const groupLevel500 = new THREE.Group();
    groupLevel500.name = 'groupLevel500';

    const upperBowlGeo = new THREE.CylinderGeometry(18.2, 15.4, 3.2, 48, 1, true);
    const upperBowlMat = new THREE.MeshStandardMaterial({
      color: '#8A1522',
      roughness: 0.6,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    const upperBowl = new THREE.Mesh(upperBowlGeo, upperBowlMat);
    upperBowl.position.y = 6.2;
    upperBowl.scale.set(1.14, 1, 1.39);
    groupLevel500.add(upperBowl);

    // Outer Facade Wall
    const facadeGeo = new THREE.CylinderGeometry(18.5, 18.5, 7.6, 48, 1, true);
    const facadeMat = new THREE.MeshStandardMaterial({
      color: '#37474F',
      roughness: 0.4,
      metalness: 0.7,
      side: THREE.DoubleSide,
    });
    const facade = new THREE.Mesh(facadeGeo, facadeMat);
    facade.position.y = 4.2;
    facade.scale.set(1.145, 1, 1.395);
    groupLevel500.add(facade);

    // 4 Corner Floodlight Pylon Mast Towers
    const pylonGeo = new THREE.CylinderGeometry(0.35, 0.55, 12, 12);
    const pylonMat = new THREE.MeshStandardMaterial({ color: '#455A64', metalness: 0.85, roughness: 0.2 });
    const floodlightHeadGeo = new THREE.BoxGeometry(2.4, 1.4, 0.9);
    const floodlightHeadMat = new THREE.MeshBasicMaterial({ color: '#FFF8E7' });

    [
      [-13.5, -18],
      [13.5, -18],
      [-13.5, 18],
      [13.5, 18],
    ].forEach(([xPos, zPos]) => {
      const towerGroup = new THREE.Group();
      const mast = new THREE.Mesh(pylonGeo, pylonMat);
      mast.position.y = 6.0;
      towerGroup.add(mast);

      const head = new THREE.Mesh(floodlightHeadGeo, floodlightHeadMat);
      head.position.y = 12.2;
      head.lookAt(0, 0, 0);
      towerGroup.add(head);

      towerGroup.position.set(xPos, 0, zPos);
      groupLevel500.add(towerGroup);
    });

    scene.add(groupLevel500);
    floorGroupsRef.current.level_500 = groupLevel500;

    // 6. ROOF SUPERSTRUCTURE & 4K JUMBOTRONS
    const groupRoof = new THREE.Group();
    groupRoof.name = 'groupRoof';

    // Jumbotrons (North & South)
    const jumboGeo = new THREE.BoxGeometry(6.6, 2.4, 0.4);
    const jumboScreenMat = new THREE.MeshBasicMaterial({ color: '#00E5FF' });
    const jumboFrameMat = new THREE.MeshStandardMaterial({ color: '#010E1C', metalness: 0.9 });

    [-18.0, 18.0].forEach((zPos) => {
      const jumboGroup = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(7.0, 2.8, 0.6), jumboFrameMat);
      const screen = new THREE.Mesh(jumboGeo, jumboScreenMat);
      screen.position.z = zPos > 0 ? -0.25 : 0.25;
      jumboGroup.add(frame);
      jumboGroup.add(screen);
      jumboGroup.position.set(0, 8.8, zPos);
      groupRoof.add(jumboGroup);
    });

    // Retractable Steel Arches
    const archGeo = new THREE.TorusGeometry(18.2, 0.35, 16, 64, Math.PI);
    const archMat = new THREE.MeshStandardMaterial({ color: '#CFD8DC', metalness: 0.9, roughness: 0.2 });
    [-8, 0, 8].forEach((zPos) => {
      const arch = new THREE.Mesh(archGeo, archMat);
      arch.position.set(0, 4.8, zPos);
      arch.scale.set(1, 0.78, 1);
      groupRoof.add(arch);
    });

    scene.add(groupRoof);
    floorGroupsRef.current.roof = groupRoof;

    setStatus('ready');

    // Resize Handler
    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    // ── ANIMATION & RENDER LOOP ──
    let animationFrame = 0;
    const tempVec = new THREE.Vector3();
    let prevProjected: ProjectedPin[] = [];

    const render = () => {
      controls.update();

      // Smooth Camera Transition to Target Preset
      camera.position.lerp(targetCamPosRef.current, 0.05);
      controls.target.lerp(targetCamLookRef.current, 0.05);

      const activeFloor = selectedFloorRef.current;
      const activeMode = floorViewModeRef.current;

      // Update Floor Group Transformations and Visibilities based on mode
      const groups = floorGroupsRef.current;
      const floorKeys: FloorLevelId[] = ['level_0', 'level_100', 'level_200', 'level_300', 'level_500', 'roof'];

      floorKeys.forEach((fKey) => {
        const grp = groups[fKey];
        if (!grp) return;

        const isMatchingFloor = activeFloor === 'all' || activeFloor === fKey;

        if (activeMode === 'isolate') {
          grp.visible = isMatchingFloor;
          grp.position.y = 0;
        } else if (activeMode === 'exploded') {
          grp.visible = true;
          let targetY = 0;
          if (fKey === 'level_0') targetY = 0;
          else if (fKey === 'level_100') targetY = 2.4;
          else if (fKey === 'level_200') targetY = 5.2;
          else if (fKey === 'level_300') targetY = 8.6;
          else if (fKey === 'level_500') targetY = 12.4;
          else if (fKey === 'roof') targetY = 17.0;

          grp.position.y = THREE.MathUtils.lerp(grp.position.y, targetY, 0.08);
        } else {
          // Highlight Mode
          grp.visible = true;
          grp.position.y = THREE.MathUtils.lerp(grp.position.y, 0, 0.08);
        }
      });

      // Project 3D Area Pins to Screen Coordinates
      const hostWidth = host.clientWidth;
      const hostHeight = host.clientHeight;

      const activePins = STADIUM_AREA_PINS.filter((pin) => {
        if (activeFloor === 'all') return true;
        return pin.floor === activeFloor;
      });

      const updatedProjected: ProjectedPin[] = activePins.map((pin) => {
        tempVec.set(pin.pos[0], pin.pos[1], pin.pos[2]);

        // Offset position if in exploded mode
        if (activeMode === 'exploded') {
          if (pin.floor === 'level_100') tempVec.y += 2.4;
          else if (pin.floor === 'level_200') tempVec.y += 5.2;
          else if (pin.floor === 'level_300') tempVec.y += 8.6;
          else if (pin.floor === 'level_500') tempVec.y += 12.4;
          else if (pin.floor === 'roof') tempVec.y += 17.0;
        }

        tempVec.project(camera);

        const isVisible = tempVec.z < 1.0 && tempVec.z > -1.0;
        const screenX = (tempVec.x * 0.5 + 0.5) * hostWidth;
        const screenY = (-(tempVec.y * 0.5) + 0.5) * hostHeight;

        return {
          pin,
          x: screenX,
          y: screenY,
          visible: isVisible && screenX >= 10 && screenX <= hostWidth - 10 && screenY >= 10 && screenY <= hostHeight - 10,
        };
      });

      // Only trigger React state update if pin count, visibility, or positions changed meaningfully (>0.5px)
      let pinsChanged = updatedProjected.length !== prevProjected.length;
      if (!pinsChanged) {
        for (let i = 0; i < updatedProjected.length; i++) {
          const curr = updatedProjected[i];
          const prev = prevProjected[i];
          if (
            curr.pin.id !== prev.pin.id ||
            curr.visible !== prev.visible ||
            (curr.visible && (Math.abs(curr.x - prev.x) > 0.5 || Math.abs(curr.y - prev.y) > 0.5))
          ) {
            pinsChanged = true;
            break;
          }
        }
      }

      if (pinsChanged) {
        prevProjected = updatedProjected;
        setProjectedPins(updatedProjected);
      }

      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();

      // Clean up Three.js scene geometries and materials to prevent GPU resource leaks
      scene.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) {
          const mesh = object as THREE.Mesh;
          if (mesh.geometry) {
            mesh.geometry.dispose();
          }
          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((mat) => mat.dispose());
            } else {
              mesh.material.dispose();
            }
          }
        }
      });

      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // Floor Selection Handler
  const handleSelectFloor = (floorId: FloorLevelId) => {
    setSelectedFloor(floorId);
    setIsFloorDropdownOpen(false);
    setActiveAreaDetail(null);

    // Dynamic Camera Focus Angle based on chosen floor
    if (floorId === 'all') {
      targetCamPosRef.current.set(24, 20, 32);
      targetCamLookRef.current.set(0, 3, 0);
    } else if (floorId === 'level_0') {
      targetCamPosRef.current.set(12, 9, 16);
      targetCamLookRef.current.set(0, 0.4, 0);
    } else if (floorId === 'level_100') {
      targetCamPosRef.current.set(16, 13, 20);
      targetCamLookRef.current.set(0, 1.8, 0);
    } else if (floorId === 'level_200') {
      targetCamPosRef.current.set(17, 12, 19);
      targetCamLookRef.current.set(0, 3.2, 0);
    } else if (floorId === 'level_300') {
      targetCamPosRef.current.set(16, 10, 18);
      targetCamLookRef.current.set(0, 4.3, 0);
    } else if (floorId === 'level_500') {
      targetCamPosRef.current.set(26, 22, 34);
      targetCamLookRef.current.set(0, 6.0, 0);
    } else if (floorId === 'roof') {
      targetCamPosRef.current.set(28, 25, 36);
      targetCamLookRef.current.set(0, 9.0, 0);
    }
  };

  // Preset Camera Angles
  const applyCameraPreset = (preset: CameraPreset) => {
    if (preset === 'isometric') {
      targetCamPosRef.current.set(24, 20, 32);
      targetCamLookRef.current.set(0, 3, 0);
    } else if (preset === 'top_plan') {
      targetCamPosRef.current.set(0, 48, 0.1);
      targetCamLookRef.current.set(0, 0, 0);
    } else if (preset === 'pitch_cam') {
      targetCamPosRef.current.set(0, 2.5, 18);
      targetCamLookRef.current.set(0, 1.5, 0);
    } else if (preset === 'suite_cam') {
      targetCamPosRef.current.set(-18, 6.5, 14);
      targetCamLookRef.current.set(0, 4.0, 0);
    }
  };

  const currentOption = FLOOR_LEVEL_OPTIONS.find((o) => o.id === selectedFloor) ?? FLOOR_LEVEL_OPTIONS[0];

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 520,
        overflow: 'hidden',
        background: '#060D15',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        userSelect: 'none',
      }}
    >
      {/* 3D WebGL Host */}
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Loading Overlay */}
      {status === 'loading' ? (
        <div
          role="status"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(6, 13, 21, 0.92)',
            fontWeight: 800,
            fontSize: 15,
            color: '#00E5FF',
          }}
        >
          Rendering 3D Interactive Spatial Stadium Map…
        </div>
      ) : null}

      {/* ── 3D PROJECTED AREA PINS & LABELS OVERLAY ── */}
      {projectedPins.map(({ pin, x, y, visible }) => {
        if (!visible) return null;
        const isSelected = activeAreaDetail?.id === pin.id;
        const isBeo = pin.status.includes('BEO');

        return (
          <button
            key={pin.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActiveAreaDetail(pin);
            }}
            style={{
              position: 'absolute',
              left: `${x}px`,
              top: `${y}px`,
              transform: 'translate(-50%, -100%) translateY(-8px)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 8px',
              borderRadius: 6,
              background: isSelected
                ? '#FFD700'
                : isBeo
                  ? 'rgba(46, 125, 50, 0.95)'
                  : 'rgba(1, 44, 108, 0.92)',
              color: isSelected ? '#001E3D' : '#FFFFFF',
              border: isSelected ? '2px solid #FFFFFF' : '1px solid rgba(255, 255, 255, 0.3)',
              boxShadow: isSelected
                ? '0 0 16px rgba(255, 215, 0, 0.8), 0 4px 12px rgba(0, 0, 0, 0.6)'
                : '0 3px 8px rgba(0, 0, 0, 0.5)',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.3,
              whiteSpace: 'nowrap',
              zIndex: isSelected ? 30 : 10,
              transition: 'all 0.15s ease',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: isSelected ? '#001E3D' : isBeo ? '#69F0AE' : '#00E5FF',
              }}
            />
            <span>{pin.code}</span>
            <span style={{ opacity: 0.85, fontWeight: 600 }}>· {pin.name.split('·')[0]}</span>
            {isBeo ? (
              <span
                style={{
                  fontSize: 9,
                  backgroundColor: '#FFFFFF',
                  color: '#1B5E20',
                  padding: '1px 4px',
                  borderRadius: 3,
                  fontWeight: 900,
                }}
              >
                BEO
              </span>
            ) : null}
          </button>
        );
      })}

      {/* ── TOP-LEFT: INTERACTIVE FLOOR LEVEL SELECTOR DROPDOWN ── */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          maxWidth: 320,
        }}
      >
        <button
          type="button"
          onClick={() => setIsFloorDropdownOpen(!isFloorDropdownOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '8px 14px',
            borderRadius: 8,
            background: 'rgba(8, 24, 44, 0.95)',
            border: '1.5px solid #00E5FF',
            color: '#FFFFFF',
            boxShadow: '0 6px 18px rgba(0, 0, 0, 0.5)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#00E5FF', letterSpacing: 0.6 }}>
              VIEW BY STADIUM FLOOR LEVEL
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#FFFFFF', marginTop: 2 }}>
              {currentOption.label}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              backgroundColor: '#013369',
              padding: '3px 8px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 800,
              color: '#FFD700',
            }}
          >
            <span>{currentOption.count} Areas</span>
            <span>{isFloorDropdownOpen ? '▲' : '▼'}</span>
          </div>
        </button>

        {/* Dropdown Menu */}
        {isFloorDropdownOpen ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: 8,
              borderRadius: 8,
              background: 'rgba(6, 18, 34, 0.98)',
              border: '1.5px solid #00E5FF',
              boxShadow: '0 12px 28px rgba(0, 0, 0, 0.7)',
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            {FLOOR_LEVEL_OPTIONS.map((opt) => {
              const isCurrent = opt.id === selectedFloor;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectFloor(opt.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: isCurrent ? '#013369' : 'transparent',
                    border: isCurrent ? '1px solid #FFD700' : '1px solid transparent',
                    color: isCurrent ? '#FFFFFF' : '#CFD8DC',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: isCurrent ? '#FFD700' : '#FFFFFF' }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: 10, color: '#90A4AE', marginTop: 2 }}>{opt.sub}</div>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: isCurrent ? '#00E5FF' : '#78909C',
                      backgroundColor: 'rgba(255,255,255,0.06)',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                  >
                    {opt.count}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* ── TOP-RIGHT: 3D VIEW MODES & CAMERA PRESETS ── */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
        }}
      >
        {/* Floor View Mode Switcher */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'rgba(8, 24, 44, 0.95)',
            borderRadius: 8,
            border: '1px solid #37474F',
            padding: 3,
            gap: 2,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          }}
        >
          {(
            [
              { id: 'highlight', label: '✦ Highlight' },
              { id: 'isolate', label: '🔍 Isolate Floor' },
              { id: 'exploded', label: '💥 Exploded 3D' },
            ] as const
          ).map((m) => {
            const active = floorViewMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setFloorViewMode(m.id)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 5,
                  background: active ? '#00E5FF' : 'transparent',
                  color: active ? '#001E3D' : '#CFD8DC',
                  border: 'none',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Quick Camera Presets */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'rgba(8, 24, 44, 0.85)',
            borderRadius: 6,
            border: '1px solid #263238',
            padding: 3,
            gap: 4,
          }}
        >
          <span style={{ fontSize: 9, fontWeight: 800, color: '#78909C', paddingLeft: 6 }}>CAM:</span>
          {(
            [
              { id: 'isometric', label: 'Isometric' },
              { id: 'top_plan', label: 'Top Plan' },
              { id: 'pitch_cam', label: 'Pitch Cam' },
              { id: 'suite_cam', label: 'Suites' },
            ] as const
          ).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => applyCameraPreset(c.id)}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#ECEFF1',
                border: 'none',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── BOTTOM-RIGHT / CENTER: FOCUSED 3D AREA DETAIL CARD ── */}
      {activeAreaDetail ? (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            left: 12,
            maxWidth: 420,
            margin: '0 auto',
            zIndex: 50,
            padding: 12,
            borderRadius: 10,
            background: 'rgba(6, 20, 36, 0.96)',
            border: '1.5px solid #FFD700',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.8)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  backgroundColor: '#FFD700',
                  color: '#013369',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontWeight: 900,
                  fontSize: 11,
                }}
              >
                {activeAreaDetail.code}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#00E5FF' }}>
                {activeAreaDetail.category.toUpperCase()}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveAreaDetail(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#90A4AE',
                fontSize: 16,
                fontWeight: 900,
                cursor: 'pointer',
                padding: 4,
              }}
            >
              ✕
            </button>
          </div>

          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#FFFFFF' }}>{activeAreaDetail.name}</div>
            <div style={{ fontSize: 11, color: '#B0BEC5', marginTop: 2 }}>{activeAreaDetail.concept}</div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 11,
            }}
          >
            <div>
              <span style={{ color: '#90A4AE' }}>Capacity: </span>
              <span style={{ fontWeight: 800, color: '#FFFFFF' }}>{activeAreaDetail.capacity}</span>
            </div>
            <div>
              <span style={{ color: '#90A4AE' }}>Status: </span>
              <span
                style={{
                  fontWeight: 800,
                  color: activeAreaDetail.status.includes('BEO') ? '#69F0AE' : '#FFD700',
                }}
              >
                {activeAreaDetail.status}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── BOTTOM STATUS BAR ── */}
      <div
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          padding: '6px 12px',
          borderRadius: 6,
          background: 'rgba(1, 44, 108, 0.88)',
          border: '1px solid #00E5FF',
          fontSize: 11,
          fontWeight: 800,
          color: '#FFFFFF',
          letterSpacing: 0.3,
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        }}
      >
        ✦ 3D SPATIAL MAP · Showing: {currentOption.label} · Orbit: Drag · Zoom: Scroll/Pinch · Pan: Right-Drag
      </div>
    </div>
  );
}
