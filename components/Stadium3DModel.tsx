'use dom';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let primaryStadiumAsset: any = null;
let fallbackStadiumAsset: any = null;

try {
  primaryStadiumAsset = require('../assets/Meshy_AI_Isometric_Football_St_0815110828_generate.glb');
} catch {
  // Asset optional
}

try {
  fallbackStadiumAsset = require('../assets/nrg-stadium.glb');
} catch {
  // Asset optional
}

type Stadium3DModelProps = {
  /**
   * The currently selected unit's zone category (e.g. 'luxury_suites'), or
   * null/undefined for none. Drives a glowing highlight ring around the
   * matching tier of whichever model is loaded.
   */
  highlightCategory?: string | null;
  dom?: import('expo/dom').DOMProps;
};

/**
 * Maps each StadiumZoneData category to a vertical position (0 = ground,
 * 1 = roofline) and a color for the highlight ring. None of the three
 * possible loaded models (the Meshy AI asset, the nrg-stadium fallback, or
 * the procedural fallback) share addressable per-suite geometry — the Meshy
 * asset in particular is a single fused, unnamed mesh with no sub-parts to
 * select. A ring wrapping the model at the tier's real-world height works
 * uniformly across all three and matches the granularity the app's own zone
 * categories actually support (tier-level, not per-suite).
 */
const CATEGORY_HIGHLIGHT: Record<string, { heightFraction: number; color: string; label: string }> = {
  field_sidelines: { heightFraction: 0.03, color: '#2ECC71', label: 'Field & Sidelines' },
  stadium_gates: { heightFraction: 0.05, color: '#00E5FF', label: 'Entry Gates' },
  locker_rooms_aux: { heightFraction: 0.08, color: '#42A5F5', label: 'Locker Rooms' },
  commissary_boh: { heightFraction: 0.1, color: '#8D6E63', label: 'Commissary / BOH' },
  concourse_service_areas: { heightFraction: 0.18, color: '#FF7043', label: 'Concourse Service' },
  concourse_bunkers: { heightFraction: 0.2, color: '#FFB300', label: 'Concourse Bunkers' },
  club_level: { heightFraction: 0.36, color: '#AB47BC', label: 'Club Level' },
  luxury_suites: { heightFraction: 0.52, color: '#FFD700', label: 'Luxury Suites' },
  upper_deck: { heightFraction: 0.8, color: '#EF5350', label: 'Upper Deck' },
};

function resolveAssetUri(asset: any): string | null {
  if (!asset) return null;
  if (typeof asset === 'string') return asset;
  if (typeof asset === 'object') {
    if (typeof asset.default === 'string') return asset.default;
    if (typeof asset.uri === 'string') return asset.uri;
    if (typeof asset.localUri === 'string') return asset.localUri;
    if (asset.default && typeof asset.default === 'object') {
      if (typeof asset.default.uri === 'string') return asset.default.uri;
    }
  }
  return null;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      material.dispose();
    });
  });
}

/**
 * Creates an authentic procedural 3D architectural football stadium model
 * with playing field, yardlines, endzones, goalposts, raked grandstands,
 * luxury suite tier, 360° LED ribbon, jumbotrons, and floodlight pylons.
 */
function createProceduralStadium(): THREE.Group {
  const stadiumGroup = new THREE.Group();
  stadiumGroup.name = 'ProceduralStadium';

  // 1. Field Base Turf
  const fieldGeo = new THREE.BoxGeometry(14, 0.4, 24);
  const fieldMat = new THREE.MeshStandardMaterial({
    color: '#1E6F3B',
    roughness: 0.8,
    metalness: 0.1,
  });
  const fieldMesh = new THREE.Mesh(fieldGeo, fieldMat);
  fieldMesh.position.y = 0.2;
  fieldMesh.receiveShadow = true;
  stadiumGroup.add(fieldMesh);

  // 2. Endzones (North & South)
  const endzoneGeo = new THREE.BoxGeometry(13.6, 0.42, 2.8);
  const endzoneNorthMat = new THREE.MeshStandardMaterial({ color: '#00143F', roughness: 0.7 });
  const endzoneNorth = new THREE.Mesh(endzoneGeo, endzoneNorthMat);
  endzoneNorth.position.set(0, 0.21, -10.2);
  stadiumGroup.add(endzoneNorth);

  const endzoneSouthMat = new THREE.MeshStandardMaterial({ color: '#B71C1C', roughness: 0.7 });
  const endzoneSouth = new THREE.Mesh(endzoneGeo, endzoneSouthMat);
  endzoneSouth.position.set(0, 0.21, 10.2);
  stadiumGroup.add(endzoneSouth);

  // 3. Yard Line Strips
  const lineMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
  for (let z = -8; z <= 8; z += 2) {
    const lineGeo = new THREE.BoxGeometry(13.4, 0.43, 0.08);
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.set(0, 0.215, z);
    stadiumGroup.add(line);
  }

  // 4. Goalposts (North & South)
  const goalpostMat = new THREE.MeshStandardMaterial({ color: '#FFD700', metalness: 0.8, roughness: 0.2 });
  [-11.5, 11.5].forEach((zPos) => {
    const postGroup = new THREE.Group();
    // Base post
    const basePole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2), goalpostMat);
    basePole.position.y = 1.1;
    postGroup.add(basePole);
    // Crossbar
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6), goalpostMat);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.y = 2.2;
    postGroup.add(crossbar);
    // Uprights
    [-1.25, 1.25].forEach((xPos) => {
      const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6), goalpostMat);
      upright.position.set(xPos, 3.5, 0);
      postGroup.add(upright);
    });
    postGroup.position.set(0, 0.4, zPos);
    stadiumGroup.add(postGroup);
  });

  // 5. Lower Bowl Grandstand Seating Tier (Navy)
  const lowerBowlGeo = new THREE.CylinderGeometry(14, 11, 2.8, 48, 1, true);
  const lowerBowlMat = new THREE.MeshStandardMaterial({
    color: '#0A1C30',
    roughness: 0.6,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  const lowerBowl = new THREE.Mesh(lowerBowlGeo, lowerBowlMat);
  lowerBowl.position.y = 1.8;
  lowerBowl.scale.set(1.1, 1, 1.35);
  stadiumGroup.add(lowerBowl);

  // 6. Luxury Suites & 360° LED Ribbon Tier (Gold & Cyan)
  const suitesRingGeo = new THREE.CylinderGeometry(14.8, 14.2, 0.9, 48, 1, true);
  const suitesRingMat = new THREE.MeshStandardMaterial({
    color: '#D4AF37',
    roughness: 0.3,
    metalness: 0.7,
    side: THREE.DoubleSide,
  });
  const suitesRing = new THREE.Mesh(suitesRingGeo, suitesRingMat);
  suitesRing.position.y = 3.65;
  suitesRing.scale.set(1.12, 1, 1.37);
  stadiumGroup.add(suitesRing);

  // LED Ribbon Band
  const ledBandGeo = new THREE.CylinderGeometry(14.9, 14.85, 0.25, 48, 1, true);
  const ledBandMat = new THREE.MeshBasicMaterial({ color: '#00E5FF', side: THREE.DoubleSide });
  const ledBand = new THREE.Mesh(ledBandGeo, ledBandMat);
  ledBand.position.y = 3.3;
  ledBand.scale.set(1.12, 1, 1.37);
  stadiumGroup.add(ledBand);

  // 7. Upper Grandstand Seating Tier (Red Bowl)
  const upperBowlGeo = new THREE.CylinderGeometry(18, 15, 3.4, 48, 1, true);
  const upperBowlMat = new THREE.MeshStandardMaterial({
    color: '#7F131D',
    roughness: 0.6,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  const upperBowl = new THREE.Mesh(upperBowlGeo, upperBowlMat);
  upperBowl.position.y = 5.6;
  upperBowl.scale.set(1.14, 1, 1.39);
  stadiumGroup.add(upperBowl);

  // 8. Outer Facade Wall (Silver & Steel)
  const facadeGeo = new THREE.CylinderGeometry(18.2, 18.2, 7.2, 48, 1, true);
  const facadeMat = new THREE.MeshStandardMaterial({
    color: '#37474F',
    roughness: 0.4,
    metalness: 0.6,
    side: THREE.DoubleSide,
  });
  const facade = new THREE.Mesh(facadeGeo, facadeMat);
  facade.position.y = 3.8;
  facade.scale.set(1.145, 1, 1.395);
  stadiumGroup.add(facade);

  // 9. Jumbotrons (North & South Endzone Displays)
  const jumboGeo = new THREE.BoxGeometry(6.4, 2.2, 0.4);
  const jumboScreenMat = new THREE.MeshBasicMaterial({ color: '#00E5FF' });
  const jumboFrameMat = new THREE.MeshStandardMaterial({ color: '#021224', metalness: 0.9 });

  [-17.8, 17.8].forEach((zPos) => {
    const jumboGroup = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(6.8, 2.6, 0.6), jumboFrameMat);
    const screen = new THREE.Mesh(jumboGeo, jumboScreenMat);
    screen.position.z = zPos > 0 ? -0.2 : 0.2;
    jumboGroup.add(frame);
    jumboGroup.add(screen);
    jumboGroup.position.set(0, 8.4, zPos);
    stadiumGroup.add(jumboGroup);
  });

  // 10. Corner Floodlight Pylon Towers (4 Towers)
  const pylonGeo = new THREE.CylinderGeometry(0.35, 0.5, 11, 12);
  const pylonMat = new THREE.MeshStandardMaterial({ color: '#455A64', metalness: 0.8 });
  const floodlightHeadGeo = new THREE.BoxGeometry(2, 1.2, 0.8);
  const floodlightHeadMat = new THREE.MeshBasicMaterial({ color: '#FFF8E7' });

  const cornerPositions = [
    [-13.5, -18],
    [13.5, -18],
    [-13.5, 18],
    [13.5, 18],
  ];

  cornerPositions.forEach(([xPos, zPos]) => {
    const towerGroup = new THREE.Group();
    const mast = new THREE.Mesh(pylonGeo, pylonMat);
    mast.position.y = 5.5;
    towerGroup.add(mast);

    const head = new THREE.Mesh(floodlightHeadGeo, floodlightHeadMat);
    head.position.y = 11.2;
    head.lookAt(0, 0, 0);
    towerGroup.add(head);

    towerGroup.position.set(xPos, 0, zPos);
    stadiumGroup.add(towerGroup);
  });

  // 11. Roof Truss Arches
  const archGeo = new THREE.TorusGeometry(18, 0.3, 16, 64, Math.PI);
  const archMat = new THREE.MeshStandardMaterial({ color: '#CFD8DC', metalness: 0.9, roughness: 0.2 });
  [-8, 0, 8].forEach((zPos) => {
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(0, 4.2, zPos);
    arch.scale.set(1, 0.75, 1);
    stadiumGroup.add(arch);
  });

  return stadiumGroup;
}

export default function Stadium3DModel({ highlightCategory }: Stadium3DModelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  // Mutable, read every animation frame — a ref (not state) so changing the
  // highlighted category doesn't re-run the scene-setup effect below and
  // reload/rebuild the whole WebGL scene on every click.
  const highlightRef = useRef<{
    category: string | null;
    ring: THREE.Mesh | null;
    ringGroup: THREE.Group | null;
    modelHeight: number;
  }>({ category: highlightCategory ?? null, ring: null, ringGroup: null, modelHeight: 0 });

  // Sync the prop into the ref without tearing down the scene.
  useEffect(() => {
    highlightRef.current.category = highlightCategory ?? null;
  }, [highlightCategory]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#08131f');

    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 2000);
    camera.position.set(24, 20, 32);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-label', 'Rotatable three-dimensional stadium model');
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = true;
    controls.minDistance = 6;
    controls.maxDistance = 120;
    controls.maxPolarAngle = Math.PI * 0.88;

    // Ambient & Hemisphere Lighting
    scene.add(new THREE.HemisphereLight('#E1F5FE', '#17251B', 2.6));

    // Key Stadium Floodlight
    const keyLight = new THREE.DirectionalLight('#FFFFFF', 4.5);
    keyLight.position.set(20, 36, 26);
    keyLight.castShadow = true;
    scene.add(keyLight);

    // Cyan/Blue Stadium Ambient Rim Fill
    const fillLight = new THREE.DirectionalLight('#78B7FF', 2.8);
    fillLight.position.set(-24, 18, -20);
    scene.add(fillLight);

    // Warm Gold Field Accent
    const goldLight = new THREE.DirectionalLight('#FFE082', 1.6);
    goldLight.position.set(0, 28, 0);
    scene.add(goldLight);

    // Ground Plaza Base
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(42, 96),
      new THREE.MeshStandardMaterial({ color: '#0A1522', roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    // Highlight ring: a glowing halo that wraps around whichever model is
    // loaded, at the vertical height matching the clicked zone's category.
    // Built once at unit scale (radius 1) and repositioned/rescaled per
    // frame in the render loop below — see CATEGORY_HIGHLIGHT and
    // finalizeLoadedModel for how its target height/radius are derived.
    const ringGeometry = new THREE.TorusGeometry(1, 0.02, 12, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: '#FFFFFF',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    const highlightRing = new THREE.Mesh(ringGeometry, ringMaterial);
    highlightRing.rotation.x = Math.PI / 2;
    highlightRing.visible = false;
    const highlightRingGroup = new THREE.Group();
    highlightRingGroup.add(highlightRing);
    scene.add(highlightRingGroup);
    highlightRef.current.ring = highlightRing;
    highlightRef.current.ringGroup = highlightRingGroup;

    let activeModel: THREE.Object3D | null = null;
    let disposed = false;

    const finalizeLoadedModel = (model: THREE.Object3D, isFallback = false) => {
      if (disposed) {
        disposeObject(model);
        return;
      }
      activeModel = model;
      const bounds = new THREE.Box3().setFromObject(activeModel);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      activeModel.position.sub(center);
      activeModel.position.y += size.y / 2;
      activeModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(activeModel);

      // After the repositioning above, the model's world-space Y range is
      // exactly [0, size.y] and it is centered on the X/Z origin — so the
      // ring only needs the model's height and footprint radius to place
      // itself at any tier, regardless of which model this is.
      highlightRef.current.modelHeight = size.y;
      const footprintRadius = Math.max(size.x, size.z) / 2;
      highlightRingGroup.userData.footprintRadius = footprintRadius;

      const radius = Math.max(size.x, size.y, size.z) * 0.5;
      const distance = Math.max(radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), 12);
      camera.near = Math.max(distance / 1000, 0.01);
      camera.far = distance * 100;
      camera.position.set(distance * 0.8, distance * 0.65, distance * 1.05);
      camera.updateProjectionMatrix();
      controls.target.set(0, size.y * 0.2, 0);
      controls.minDistance = distance * 0.25;
      controls.maxDistance = distance * 3.0;
      controls.update();
      setStatus(isFallback ? 'fallback' : 'ready');
    };

    const loadProceduralFallback = () => {
      const proceduralModel = createProceduralStadium();
      finalizeLoadedModel(proceduralModel, true);
    };

    const tryLoadGlb = (uri: string, onFail: () => void) => {
      new GLTFLoader().load(
        uri,
        (gltf) => {
          finalizeLoadedModel(gltf.scene, false);
        },
        undefined,
        (err) => {
          console.warn('GLB load failed for', uri, err);
          onFail();
        },
      );
    };

    // Load Primary GLB -> Secondary GLB -> Procedural 3D Model
    const primaryUri = resolveAssetUri(primaryStadiumAsset);
    const fallbackUri = resolveAssetUri(fallbackStadiumAsset);

    if (primaryUri) {
      tryLoadGlb(primaryUri, () => {
        if (fallbackUri && fallbackUri !== primaryUri) {
          tryLoadGlb(fallbackUri, loadProceduralFallback);
        } else {
          loadProceduralFallback();
        }
      });
    } else if (fallbackUri) {
      tryLoadGlb(fallbackUri, loadProceduralFallback);
    } else {
      loadProceduralFallback();
    }

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

    const updateHighlight = () => {
      const { category, ring, ringGroup, modelHeight } = highlightRef.current;
      if (!ring || !ringGroup) return;
      const config = category ? CATEGORY_HIGHLIGHT[category] : undefined;
      const footprintRadius = (ringGroup.userData.footprintRadius as number | undefined) ?? 0;
      if (!config || modelHeight <= 0 || footprintRadius <= 0) {
        ring.visible = false;
        return;
      }
      const ringRadius = footprintRadius * 1.06;
      ringGroup.position.set(0, config.heightFraction * modelHeight, 0);
      ring.scale.setScalar(ringRadius);
      // A gentle pulse — noticeably "lit" without being distracting.
      const pulse = (Math.sin(performance.now() / 420) + 1) / 2; // 0..1
      const material = ring.material as THREE.MeshBasicMaterial;
      material.color.set(config.color);
      material.opacity = 0.35 + pulse * 0.45;
      ring.visible = true;
    };

    let animationFrame = 0;
    const render = () => {
      controls.update();
      updateHighlight();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      if (activeModel) disposeObject(activeModel);
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      highlightRef.current.ring = null;
      highlightRef.current.ringGroup = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const activeHighlight = highlightCategory ? CATEGORY_HIGHLIGHT[highlightCategory] : undefined;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 200,
        overflow: 'hidden',
        background: '#08131f',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />

      {activeHighlight ? (
        <div
          style={{
            position: 'absolute',
            right: 12,
            top: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 12px',
            borderRadius: 6,
            background: 'rgba(8, 19, 31, 0.92)',
            border: `1px solid ${activeHighlight.color}`,
            boxShadow: `0 4px 14px rgba(0, 0, 0, 0.45), 0 0 10px ${activeHighlight.color}55`,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: 5,
              background: activeHighlight.color,
              boxShadow: `0 0 6px 2px ${activeHighlight.color}`,
            }}
          />
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.3, color: '#FFFFFF' }}>
            HIGHLIGHTING · {activeHighlight.label.toUpperCase()}
          </span>
        </div>
      ) : null}

      {status === 'loading' ? (
        <div
          role="status"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            textAlign: 'center',
            background: 'rgba(8, 19, 31, 0.88)',
            fontWeight: 700,
            fontSize: 14,
            color: '#00E5FF',
          }}
        >
          Loading 3D Stadium Model…
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          padding: '7px 12px',
          borderRadius: 6,
          background: 'rgba(1, 51, 105, 0.92)',
          border: '1px solid #00E5FF',
          fontSize: 11,
          fontWeight: 800,
          color: '#FFFFFF',
          letterSpacing: 0.3,
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        }}
      >
        ✦ 3D ISOMETRIC STADIUM BOWL · Drag to orbit · Pinch / Scroll to zoom · Right-drag to pan
      </div>
    </div>
  );
}
