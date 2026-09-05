'use dom';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  CAMERA_PRESETS,
  STADIUM_ZONE_MODEL_BINDINGS,
  findZoneByMeshName,
  getHighlightColor,
} from './stadium-model-bindings';
import type { CameraPresetId, OperationalHighlightStatus, Stadium3DCanvasProps } from './stadium-3d.types';

// Asset reference bundled by Metro
// @ts-ignore
import nrgStadiumGlbAsset from '../../assets/nrg-stadium.glb';

export default function Stadium3DCanvas({
  selectedZoneId,
  highlightedZones,
  cameraPreset = 'overview',
  autoRotate = false,
  onSelectZone,
  onLoadProgress,
  onLoadComplete,
  onLoadError,
}: Stadium3DCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  // Refs to synchronize with Three.js animation loop without re-triggering effect
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRootRef = useRef<THREE.Group | null>(null);

  // Target camera position and look-at vector for smooth lerp transitions
  const targetCamPosRef = useRef<THREE.Vector3>(new THREE.Vector3(28, 24, 36));
  const targetCamLookRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 2, 0));

  // Cloned material cache to prevent cross-zone leaks
  const meshOriginalMaterialsRef = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());

  // Current props mirror refs
  const selectedZoneIdRef = useRef<string | null>(selectedZoneId);
  selectedZoneIdRef.current = selectedZoneId;

  const highlightedZonesRef = useRef<Record<string, OperationalHighlightStatus>>(highlightedZones);
  highlightedZonesRef.current = highlightedZones;

  const autoRotateRef = useRef<boolean>(autoRotate);
  autoRotateRef.current = autoRotate;

  // Track pointer for tap vs drag detection
  const pointerDownPosRef = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });

  // Update target camera based on preset changes
  useEffect(() => {
    const preset = CAMERA_PRESETS[cameraPreset] || CAMERA_PRESETS.overview;
    targetCamPosRef.current.set(preset.position[0], preset.position[1], preset.position[2]);
    targetCamLookRef.current.set(preset.target[0], preset.target[1], preset.target[2]);
  }, [cameraPreset]);

  // Main Scene Setup
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);

    // 1. Scene & Environment
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#060D15');
    scene.fog = new THREE.FogExp2('#060D15', 0.008);
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
    camera.position.set(28, 24, 36);
    cameraRef.current = camera;

    // 3. Renderer
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      onLoadError?.(`WebGL initialization failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
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
    rendererRef.current = renderer;

    // 4. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = true;
    controls.minDistance = 10;
    controls.maxDistance = 120;
    controls.minPolarAngle = 0.1;
    controls.maxPolarAngle = Math.PI * 0.48; // Prevent dipping below ground
    controls.target.set(0, 2, 0);
    controlsRef.current = controls;

    // 5. Lighting Setup (Cinematic Nighttime Operations Rig)
    const hemiLight = new THREE.HemisphereLight('#E3F2FD', '#0A1A10', 2.5);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#FFFFFF', 4.2);
    keyLight.position.set(24, 42, 28);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#00E5FF', 2.8);
    rimLight.position.set(-30, 20, -25);
    scene.add(rimLight);

    const goldAccent = new THREE.DirectionalLight('#FFD700', 1.8);
    goldAccent.position.set(0, 32, 0);
    scene.add(goldAccent);

    // Ground Plaza Base Slab
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(48, 96),
      new THREE.MeshStandardMaterial({
        color: '#08121E',
        roughness: 0.95,
        metalness: 0.1,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    // Concentric Plaza Rings
    [24, 34, 44].forEach((r) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r, r + 0.15, 64),
        new THREE.MeshBasicMaterial({ color: '#10253A', side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
      scene.add(ring);
    });

    // 6. GLB Model Loading with Fallback Procedural Bowl
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelRootRef.current = modelGroup;

    const assetUri =
      typeof nrgStadiumGlbAsset === 'string'
        ? nrgStadiumGlbAsset
        : (nrgStadiumGlbAsset?.uri || nrgStadiumGlbAsset?.default || '');

    const loader = new GLTFLoader();
    let hasModelLoaded = false;

    // Timeout guard: if GLB takes > 7s, generate procedural stadium bowl so screen is never blank
    const loadTimeout = setTimeout(() => {
      if (!hasModelLoaded) {
        buildProceduralStadium(modelGroup);
        hasModelLoaded = true;
        onLoadComplete?.();
      }
    }, 7000);

    if (assetUri) {
      loader.load(
        assetUri,
        (gltf) => {
          clearTimeout(loadTimeout);
          if (hasModelLoaded) return;
          hasModelLoaded = true;

          // Auto-scale and center the loaded model
          const bbox = new THREE.Box3().setFromObject(gltf.scene);
          const size = bbox.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const targetScale = maxDim > 0 ? 36 / maxDim : 1;
          gltf.scene.scale.set(targetScale, targetScale, targetScale);

          // Center at ground level
          const center = bbox.getCenter(new THREE.Vector3());
          gltf.scene.position.set(-center.x * targetScale, -bbox.min.y * targetScale, -center.z * targetScale);

          // Traverse meshes, enable shadows, store original materials
          gltf.scene.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;

              if (mesh.material) {
                meshOriginalMaterialsRef.current.set(
                  mesh,
                  Array.isArray(mesh.material) ? mesh.material.slice() : mesh.material.clone()
                );
              }
            }
          });

          modelGroup.add(gltf.scene);
          onLoadProgress?.(100);
          onLoadComplete?.();
        },
        (xhr) => {
          if (xhr.lengthComputable && xhr.total > 0) {
            const percent = Math.round((xhr.loaded / xhr.total) * 100);
            onLoadProgress?.(percent);
          }
        },
        (error) => {
          clearTimeout(loadTimeout);
          // Fall back gracefully to built-in procedural stadium bowl
          if (!hasModelLoaded) {
            buildProceduralStadium(modelGroup);
            hasModelLoaded = true;
            onLoadComplete?.();
          }
        }
      );
    } else {
      clearTimeout(loadTimeout);
      buildProceduralStadium(modelGroup);
      hasModelLoaded = true;
      onLoadComplete?.();
    }

    // 7. Tap / Raycasting Detection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY, time: performance.now() };
    };

    const handlePointerUp = (e: PointerEvent) => {
      const down = pointerDownPosRef.current;
      const dx = Math.abs(e.clientX - down.x);
      const dy = Math.abs(e.clientY - down.y);
      const duration = performance.now() - down.time;

      // Only treat as tap if pointer barely moved (<6px) and released quickly (<350ms)
      if (dx < 6 && dy < 6 && duration < 350) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(pointer, camera);
        const intersects = raycaster.intersectObjects(modelGroup.children, true);

        if (intersects.length > 0) {
          for (const hit of intersects) {
            const hitName = hit.object.name;
            const binding = findZoneByMeshName(hitName);
            if (binding) {
              onSelectZone(binding.zoneId);
              break;
            }
          }
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    // 8. Resize Observer
    const handleResize = () => {
      if (!hostRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = Math.max(hostRef.current.clientWidth, 1);
      const h = Math.max(hostRef.current.clientHeight, 1);
      rendererRef.current.setSize(w, h, false);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(host);

    // 9. Animation Render Loop
    let animationFrame = 0;
    let isPaused = false;

    const handleVisibilityChange = () => {
      isPaused = document.hidden;
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const animate = () => {
      if (!isPaused) {
        // Subtle auto-rotation when enabled and user not interacting
        if (autoRotateRef.current) {
          controls.autoRotate = true;
          controls.autoRotateSpeed = 0.8;
        } else {
          controls.autoRotate = false;
        }

        controls.update();

        // Smoothly interpolate camera towards target preset
        camera.position.lerp(targetCamPosRef.current, 0.05);
        controls.target.lerp(targetCamLookRef.current, 0.05);

        renderer.render(scene, camera);
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animate();

    // 10. Resource Cleanup on Unmount
    return () => {
      clearTimeout(loadTimeout);
      cancelAnimationFrame(animationFrame);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      controls.dispose();

      // Dispose geometries and materials
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          if (m.material) {
            if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
            else m.material.dispose();
          }
        }
      });

      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // Update dynamic zone highlights when highlightedZones or selectedZoneId changes
  useEffect(() => {
    const modelGroup = modelRootRef.current;
    if (!modelGroup) return;

    modelGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const binding = findZoneByMeshName(mesh.name);

        if (binding) {
          const isSelected = selectedZoneId === binding.zoneId;
          const status = isSelected
            ? 'selected'
            : highlightedZones[binding.zoneId] || 'normal';

          const { emissiveColor, intensity } = getHighlightColor(status);

          if (mesh.material && !Array.isArray(mesh.material)) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (mat.isMeshStandardMaterial) {
              mat.emissive = new THREE.Color(emissiveColor);
              mat.emissiveIntensity = intensity;
              mat.needsUpdate = true;
            }
          }
        }
      }
    });
  }, [selectedZoneId, highlightedZones]);

  return (
    <div
      ref={hostRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 440,
        backgroundColor: '#060D15',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    />
  );
}

// Procedural Stadium Bowl (Zero-Failure Fallback)
function buildProceduralStadium(group: THREE.Group) {
  // Turf
  const turf = new THREE.Mesh(
    new THREE.BoxGeometry(14, 0.4, 24),
    new THREE.MeshStandardMaterial({ color: '#1B6B38', roughness: 0.8, metalness: 0.1 })
  );
  turf.name = 'Field_GrassTurf';
  turf.position.y = 0.2;
  turf.receiveShadow = true;
  group.add(turf);

  // Endzones
  const ezN = new THREE.Mesh(
    new THREE.BoxGeometry(13.6, 0.42, 2.8),
    new THREE.MeshStandardMaterial({ color: '#00143F', roughness: 0.6 })
  );
  ezN.name = 'Endzone_North_Texans';
  ezN.position.set(0, 0.21, -10.2);
  group.add(ezN);

  const ezS = new THREE.Mesh(
    new THREE.BoxGeometry(13.6, 0.42, 2.8),
    new THREE.MeshStandardMaterial({ color: '#B71C1C', roughness: 0.6 })
  );
  ezS.name = 'Endzone_South_Texans';
  ezS.position.set(0, 0.21, 10.2);
  group.add(ezS);

  // Lower Bowl (100 Level)
  const bowl100 = new THREE.Mesh(
    new THREE.CylinderGeometry(13.2, 10.5, 1.6, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: '#0D2137', roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide })
  );
  bowl100.name = 'Bowl_100_LowerNavy';
  bowl100.position.y = 1.3;
  bowl100.scale.set(1.1, 1, 1.35);
  group.add(bowl100);

  // Club Level (200 Level) & LED Ribbon
  const bowl200 = new THREE.Mesh(
    new THREE.CylinderGeometry(14.8, 13.0, 1.8, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: '#132B4A', roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide })
  );
  bowl200.name = 'Bowl_200_ClubNavy';
  bowl200.position.y = 2.8;
  bowl200.scale.set(1.11, 1, 1.36);
  group.add(bowl200);

  // Suites Level (300 Level)
  const suites300 = new THREE.Mesh(
    new THREE.CylinderGeometry(15.6, 14.8, 1.2, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: '#D4AF37', roughness: 0.25, metalness: 0.8, side: THREE.DoubleSide })
  );
  suites300.name = 'Suites_300_Balcony';
  suites300.position.y = 4.3;
  suites300.scale.set(1.125, 1, 1.375);
  group.add(suites300);

  // Upper Deck (500 Level)
  const upperBowl = new THREE.Mesh(
    new THREE.CylinderGeometry(18.2, 15.4, 3.2, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: '#8A1522', roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide })
  );
  upperBowl.name = 'Bowl_500_UpperRed';
  upperBowl.position.y = 6.2;
  upperBowl.scale.set(1.14, 1, 1.39);
  group.add(upperBowl);

  // Gate Towers
  const gateMat = new THREE.MeshStandardMaterial({ color: '#ECEFF1', roughness: 0.3, metalness: 0.6 });
  [-14.5, 14.5].forEach((z, idx) => {
    const gate = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 1.8), gateMat);
    gate.name = idx === 0 ? 'Gate_Ford_Tower' : 'Gate_Kroger_Tower';
    gate.position.set(0, 2.2, z);
    group.add(gate);
  });
}
