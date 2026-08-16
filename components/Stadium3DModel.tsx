'use dom';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const stadiumModel = require('../assets/nrg-stadium.glb') as string;

type Stadium3DModelProps = {
  dom?: import('expo/dom').DOMProps;
};

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

export default function Stadium3DModel(_props: Stadium3DModelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#08131f');

    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 2000);
    camera.position.set(8, 6, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
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
    controls.minDistance = 2;
    controls.maxDistance = 60;
    controls.maxPolarAngle = Math.PI * 0.88;

    scene.add(new THREE.HemisphereLight('#d7ecff', '#17251b', 2.4));
    const keyLight = new THREE.DirectionalLight('#ffffff', 4.2);
    keyLight.position.set(8, 14, 10);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight('#78b7ff', 2.1);
    fillLight.position.set(-10, 5, -7);
    scene.add(fillLight);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(18, 96),
      new THREE.MeshStandardMaterial({ color: '#123c24', roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    scene.add(ground);

    let loadedModel: THREE.Object3D | null = null;
    let disposed = false;

    new GLTFLoader().load(
      stadiumModel,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }

        loadedModel = gltf.scene;
        const bounds = new THREE.Box3().setFromObject(loadedModel);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        loadedModel.position.sub(center);
        loadedModel.position.y += size.y / 2;
        loadedModel.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        scene.add(loadedModel);

        const radius = Math.max(size.x, size.y, size.z) * 0.5;
        const distance = Math.max(radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), 4);
        camera.near = Math.max(distance / 1000, 0.01);
        camera.far = distance * 100;
        camera.position.set(distance * 0.75, distance * 0.5, distance * 0.9);
        camera.updateProjectionMatrix();
        controls.target.set(0, size.y * 0.18, 0);
        controls.minDistance = distance * 0.28;
        controls.maxDistance = distance * 2.5;
        controls.update();
        setStatus('ready');
      },
      undefined,
      (error) => {
        console.error('Failed to load the stadium GLB model', error);
        if (!disposed) setStatus('error');
      },
    );

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

    let animationFrame = 0;
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      if (loadedModel) disposeObject(loadedModel);
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 520,
        overflow: 'hidden',
        background: '#08131f',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {status !== 'ready' ? (
        <div
          role={status === 'error' ? 'alert' : 'status'}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            textAlign: 'center',
            background: 'rgba(8, 19, 31, 0.86)',
            fontWeight: 700,
          }}
        >
          {status === 'error'
            ? 'The stadium model could not be loaded. Check the network connection and reload.'
            : 'Loading interactive stadium model…'}
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          padding: '7px 10px',
          borderRadius: 6,
          background: 'rgba(1, 51, 105, 0.88)',
          fontSize: 12,
          fontWeight: 700,
          pointerEvents: 'none',
        }}
      >
        Drag to orbit · Pinch or scroll to zoom · Right-drag to pan
      </div>
    </div>
  );
}
