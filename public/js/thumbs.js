import * as THREE from 'three';
import { Penguin } from './penguin.js';

// Renders each skin once into a small PNG used by the locker, party list and HUD.
let renderer, scene, camera;
const cache = new Map();

export function skinThumb(skinId) {
  if (cache.has(skinId)) return cache.get(skinId);
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(192, 192, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6080a0, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(2, 3, 4);
    scene.add(key);
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 1.55, 4.4);
    camera.lookAt(0, 1.2, 0);
  }
  const p = new Penguin(skinId);
  p.root.rotation.y = -0.35;
  p.update(0.016);
  scene.add(p.root);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(p.root);
  cache.set(skinId, url);
  return url;
}
