'use dom';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { findZoneByMeshName } from './stadium-model-bindings';
import { applyHighlights, disposeScene, isolateMaterials } from './scene-resources';
import { computeCameraFraming, type ModelBounds } from './camera-framing';
import { createLoadCompletionGate, getRenderableViewport } from './stadium-render-lifecycle';
import type { CameraPresetId, OperationalHighlightStatus, Stadium3DCanvasProps } from './stadium-3d.types';

/** Structural volumes whose shadows read at stadium scale. */
const SHADOW_CASTING_MESH = /^(Node_)?(Bowl_|Suites_|Upper_|Gate_|Roof_|Exterior_|Jumbotron_|Ext_)/;

// Asset reference bundled by Metro
// @ts-ignore
import nrgStadiumGlbAsset from '../../assets/nrg-stadium.glb';

function StadiumScene({
  selectedZoneId,
  highlightedZones,
  cameraPreset = 'overview',
  autoRotate = false,
  resetToken = 0,
  active = true,
  reducedMotion = false,
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

  // Real bounds of the loaded model, filled once geometry exists. Framing is
  // derived from these rather than from hardcoded preset coordinates.
  const modelBoundsRef = useRef<ModelBounds | null>(null);
  const presetRef = useRef<CameraPresetId>(cameraPreset);
  presetRef.current = cameraPreset;
  const frameToPresetRef = useRef<() => void>(() => undefined);

  const transitioning = useRef(true);
  const needsRender = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const onSelectRef = useRef(onSelectZone);
  onSelectRef.current = onSelectZone;

  // Current props mirror refs
  const selectedZoneIdRef = useRef<string | null>(selectedZoneId);
  selectedZoneIdRef.current = selectedZoneId;

  const highlightedZonesRef = useRef<Record<string, OperationalHighlightStatus>>(highlightedZones);
  highlightedZonesRef.current = highlightedZones;

  const autoRotateRef = useRef<boolean>(autoRotate);
  autoRotateRef.current = autoRotate;

  useEffect(() => {
    if (active) needsRender.current = true;
  }, [active]);

  // Track pointer for tap vs drag detection
  const pointerDownPosRef = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });

  // Re-frame whenever the preset changes or the user resets the camera.
  useEffect(() => {
    frameToPresetRef.current();
  }, [cameraPreset, resetToken]);

  // Main Scene Setup
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let failed = false;
    let hasRenderableSize = false;
    const loadCompletionGate = createLoadCompletionGate(onLoadComplete);
    const fail = () => {
      if (disposed || failed) return;
      failed = true;
      onLoadError?.('The 3D renderer stopped. Retry or open the Operations Map.');
    };

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

    // Capped below the device ratio: 2x on a 3x phone already quadruples the
    // fragment cost, and this scene is read at arm's length on a handset.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
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

    // Derives camera placement from the model's real bounds and the current
    // aspect. Until geometry exists there is nothing to frame, so this no-ops
    // and is re-run by captureModelBounds() once the model is in the scene.
    const frameToPreset = () => {
      const bounds = modelBoundsRef.current;
      if (!bounds) return;
      const framing = computeCameraFraming(presetRef.current, bounds, camera.fov, camera.aspect);
      targetCamPosRef.current.set(...framing.position);
      targetCamLookRef.current.set(...framing.target);
      controls.minDistance = framing.minDistance;
      controls.maxDistance = framing.maxDistance;
      transitioning.current = true;
      needsRender.current = true;
    };
    frameToPresetRef.current = frameToPreset;

    const captureModelBounds = (root: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      modelBoundsRef.current = {
        center: [sphere.center.x, sphere.center.y, sphere.center.z],
        radius: sphere.radius,
        minY: box.min.y,
        height: box.max.y - box.min.y,
      };
      // A fixed 48-unit plaza dwarfed the auto-fitted model and filled the
      // frame with empty ground; keep it just wider than the model footprint.
      const plazaRadius = Math.max(sphere.radius * 1.25, 1);
      groundRing.scale.set(plazaRadius, 1, plazaRadius);
      groundRing.position.set(sphere.center.x, box.min.y, sphere.center.z);
      frameToPreset();
    };

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
    const groundRing = new THREE.Group();
    scene.add(groundRing);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1, 96),
      new THREE.MeshStandardMaterial({
        color: '#08121E',
        roughness: 0.95,
        metalness: 0.1,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    groundRing.add(ground);

    // Concentric Plaza Rings, sized as fractions of the plaza radius.
    [0.5, 0.71, 0.92].forEach((r) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r, r + 0.0032, 64),
        new THREE.MeshBasicMaterial({ color: '#10253A', side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
      groundRing.add(ring);
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
    const useFallback = () => {
      if (disposed || failed || hasModelLoaded) return;
      try {
        buildProceduralStadium(modelGroup);
        isolateMaterials(modelGroup);
        captureModelBounds(modelGroup);
        applyHighlights(modelGroup, selectedZoneIdRef.current, highlightedZonesRef.current);
        needsRender.current = true;
        hasModelLoaded = true;
        loadCompletionGate.markModelReady(true);
      } catch { fail(); }
    };

    // Timeout guard: if GLB takes > 7s, generate procedural stadium bowl so screen is never blank
    const loadTimeout = setTimeout(() => {
      useFallback();
    }, 7000);

    if (assetUri) {
      loader.load(
        assetUri,
        (gltf) => {
          clearTimeout(loadTimeout);
          if (disposed || failed || hasModelLoaded) { disposeScene(gltf.scene); return; }
          hasModelLoaded = true;
          try {

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
          // Shadow-casting every mesh doubles the draw calls for yard lines and
          // endzone lettering that cast nothing legible. Restrict casting to the
          // large structural volumes; everything still receives.
          gltf.scene.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              mesh.castShadow = SHADOW_CASTING_MESH.test(mesh.name);
              mesh.receiveShadow = true;
            }
          });

          isolateMaterials(gltf.scene);
          modelGroup.add(gltf.scene);
          captureModelBounds(modelGroup);
          applyHighlights(modelGroup, selectedZoneIdRef.current, highlightedZonesRef.current);
          needsRender.current = true;
          onLoadProgress?.(100);
          loadCompletionGate.markModelReady();
          } catch { disposeScene(gltf.scene); fail(); }
        },
        (xhr) => {
          if (!disposed && !failed && !hasModelLoaded && xhr.lengthComputable && xhr.total > 0) {
            const percent = Math.round((xhr.loaded / xhr.total) * 100);
            onLoadProgress?.(percent);
          }
        },
        (error) => {
          clearTimeout(loadTimeout);
          // Fall back gracefully to built-in procedural stadium bowl
          useFallback();
        }
      );
    } else {
      clearTimeout(loadTimeout);
      useFallback();
    }

    // 7. Tap / Raycasting Detection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const handlePointerDown = (e: PointerEvent) => {
      transitioning.current = false;
      if (!e.isPrimary) { pointerDownPosRef.current.time = -Infinity; return; }
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY, time: performance.now() };
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!e.isPrimary) return;
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
              onSelectRef.current(binding.zoneId);
              break;
            }
          }
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    const stopTransition = () => { transitioning.current = false; };
    controls.addEventListener('start', stopTransition);
    const contextLost = (event: Event) => { event.preventDefault(); fail(); };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    // Only treat an error as a renderer failure when it actually originates in
    // the 3D stack. A global handler tore the scene down for unrelated errors
    // elsewhere in the WebView, turning a working view into a false failure.
    const isRendererError = (value: unknown): boolean => {
      const message = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? '');
      return /webgl|three|gltf|glb|context lost|out of memory/i.test(message);
    };
    const onWindowError = (event: ErrorEvent) => { if (isRendererError(event.error ?? event.message)) fail(); };
    const onRejection = (event: PromiseRejectionEvent) => { if (isRendererError(event.reason)) fail(); };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onRejection);

    // 8. Resize Observer
    const handleResize = () => {
      if (!hostRef.current || !rendererRef.current || !cameraRef.current) return;
      const viewport = getRenderableViewport(hostRef.current.clientWidth, hostRef.current.clientHeight);
      hasRenderableSize = viewport !== null;
      if (!viewport) return;
      rendererRef.current.setSize(viewport.width, viewport.height, false);
      needsRender.current = true;
      cameraRef.current.aspect = viewport.width / viewport.height;
      cameraRef.current.updateProjectionMatrix();
      // Aspect changes what fits, so re-derive the framing.
      frameToPresetRef.current();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(host);
    handleResize();

    // 9. Animation Render Loop
    let animationFrame = 0;

    const animate = () => {
      if (disposed || failed) return;
      if (activeRef.current && hasRenderableSize) {
        try {
        // Subtle auto-rotation when enabled and user not interacting
        if (autoRotateRef.current && !reducedMotionRef.current && !transitioning.current) {
          controls.autoRotate = true;
          controls.autoRotateSpeed = 0.8;
        } else {
          controls.autoRotate = false;
        }

        const changed = controls.update();
        const moving = transitioning.current;

        // Smoothly interpolate camera towards target preset
        if (transitioning.current) {
          const amount = reducedMotionRef.current ? 1 : 0.12;
          camera.position.lerp(targetCamPosRef.current, amount);
          controls.target.lerp(targetCamLookRef.current, amount);
          camera.lookAt(controls.target);
          if (camera.position.distanceTo(targetCamPosRef.current) < 0.02 && controls.target.distanceTo(targetCamLookRef.current) < 0.02) transitioning.current = false;
        }

        if (changed || moving || needsRender.current) {
          renderer.render(scene, camera);
          needsRender.current = false;
          loadCompletionGate.reportRenderedFrame();
        }
        } catch { fail(); return; }
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animate();

    // 10. Resource Cleanup on Unmount
    return () => {
      disposed = true;
      clearTimeout(loadTimeout);
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onRejection);
      controls.removeEventListener('start', stopTransition);
      controls.dispose();

      // Dispose geometries and materials
      disposeScene(scene);

      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // Update dynamic zone highlights when highlightedZones or selectedZoneId changes
  useEffect(() => {
    const modelGroup = modelRootRef.current;
    if (!modelGroup) return;

    applyHighlights(modelGroup, selectedZoneId, highlightedZones);
    needsRender.current = true;
  }, [selectedZoneId, highlightedZones]);

  return (
    <div
      ref={hostRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        backgroundColor: '#060D15',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    />
  );
}

class CanvasBoundary extends React.Component<React.PropsWithChildren<{ onError?: (message: string) => void }>, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError?.('The stadium scene could not initialize. Open the Operations Map or retry.'); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function Stadium3DCanvas(props: Stadium3DCanvasProps) {
  return <CanvasBoundary onError={props.onLoadError}><StadiumScene {...props} /></CanvasBoundary>;
}

// Simplified geometry when the bundled asset cannot load.
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
