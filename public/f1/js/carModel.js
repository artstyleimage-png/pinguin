import * as THREE from 'three';
import * as TX from './textures.js';

// 2026-style car: 3.4 m wheelbase, 1.9 m wide, 18" wheels, no beam wing.
// Coordinates: +z forward, +x to the driver's left, y up, wheels on y = 0.
export const DIM = { wheelbase: 3.4, frontZ: 1.72, rearZ: -1.68, frontX: 0.8, rearX: 0.76, tyreR: 0.36, frontW: 0.29, rearW: 0.37 };

/** Superellipse ring (n = 2 ellipse, n > 2 boxier). */
function ring(w, h, n, seg) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    pts.push([(w / 2) * Math.sign(c) * Math.abs(c) ** (2 / n), (h / 2) * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return pts;
}

/** Smooth body through cross-sections [{z, w, h, y, x?, n?, top?}] (top shifts the upper half for flat bottoms). */
function loft(sections, { seg = 48, capStart = true, capEnd = true } = {}) {
  const pos = [];
  const idx = [];
  const uv = [];
  sections.forEach((s, k) => {
    const pts = ring(s.w, s.h, s.n ?? 2.6, seg);
    pts.forEach(([x, y], i) => {
      uv.push(i / seg, k / Math.max(1, sections.length - 1));
      // flatten the underside: real tubs sit on a flat floor
      const yy = y < 0 ? y * (s.flat ?? 1) : y;
      pos.push((s.x ?? 0) + x, s.y + yy, s.z);
    });
  });
  const S = sections.length;
  for (let k = 0; k < S - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i, b = k * seg + ((i + 1) % seg), c = (k + 1) * seg + i, d = (k + 1) * seg + ((i + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
  }
  const cap = (k, flip) => {
    const s = sections[k];
    const ci = pos.length / 3;
    pos.push(s.x ?? 0, s.y, s.z);
    uv.push(0.5, 0.5);
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i, b = k * seg + ((i + 1) % seg);
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  if (capStart) cap(0, true);
  if (capEnd) cap(S - 1, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** NACA-style cambered airfoil extruded across the car (inverted to make downforce). */
function wing(chord, span, { t = 0.11, camber = 0.07 } = {}) {
  const shape = new THREE.Shape();
  const N = 24;
  const upper = [], lower = [];
  for (let i = 0; i <= N; i++) {
    const x = (1 - Math.cos((i / N) * Math.PI)) / 2;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const p = 0.4;
    const yc = x < p ? (camber / (p * p)) * (2 * p * x - x * x) : (camber / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x);
    upper.push([x * chord, (-yc + yt) * chord]);
    lower.push([x * chord, (-yc - yt) * chord]);
  }
  shape.moveTo(upper[0][0], upper[0][1]);
  for (const [x, y] of upper) shape.lineTo(x, y);
  for (let i = lower.length - 1; i >= 0; i--) shape.lineTo(lower[i][0], lower[i][1]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 2 });
  geo.translate(0, 0, -span / 2);
  geo.rotateY(Math.PI / 2); // chord runs to -z (leading edge at z = 0), span along x
  geo.computeVertexNormals();
  return geo;
}

function plate(points, thick) {
  // side plate: outline in (z, y), extruded thickness along x
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  geo.translate(0, 0, -thick / 2);
  geo.rotateY(-Math.PI / 2); // shape x -> car z, depth -> car x
  return geo;
}

function rod(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}

function mesh(geo, mat, parent, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.scale.set(...scale);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const COMPOUND_COLORS = { soft: 0xe8202a, medium: 0xffd400, hard: 0xf2f2f2, inter: 0x2fb34a, wet: 0x1f6fe0 };

function tyreGeo(w) {
  const hw = w / 2;
  const pts = [[0.232, -hw * 0.86], [0.262, -hw * 0.97], [0.31, -hw * 1.0], [0.345, -hw * 0.95], [0.358, -hw * 0.8], [0.36, -hw * 0.4],
    [0.36, hw * 0.4], [0.358, hw * 0.8], [0.345, hw * 0.95], [0.31, hw * 1.0], [0.262, hw * 0.97], [0.232, hw * 0.86]];
  const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 48);
  geo.rotateZ(Math.PI / 2);
  return geo;
}

/**
 * Builds the car. opts.ghost gives a translucent copy for record replays.
 * Returns handles for animated parts (wheels, active aero flaps, steering wheel, shift lights).
 */
export function buildCar(spec, { ghost = false, compound = 'medium', number = 1 } = {}) {
  const g = new THREE.Group();
  const carb = TX.carbonReal();
  const extra = ghost ? { transparent: true, opacity: 0.32, depthWrite: false } : {};
  const flakes = TX.flakes();
  // satin livery (most modern liveries are semi-matt) with a light clearcoat and fine flake
  const paint = new THREE.MeshPhysicalMaterial({ color: spec.main, metalness: 0.2, roughness: 0.48, normalMap: flakes, normalScale: new THREE.Vector2(0.06, 0.06), clearcoat: 0.35, clearcoatRoughness: 0.22, envMapIntensity: 0.55, ...extra });
  const paint2 = new THREE.MeshPhysicalMaterial({ color: spec.second, metalness: 0.2, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1, ...extra });
  const accent = new THREE.MeshPhysicalMaterial({ color: spec.accent, metalness: 0.2, roughness: 0.4, clearcoat: 0.6, ...extra });
  const cf = new THREE.MeshPhysicalMaterial({ map: carb.map, normalMap: carb.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.45, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.15, color: 0x2e2e30, ...extra });
  const black = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.6, metalness: 0.1, ...extra });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.25, metalness: 0.95, ...extra });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.78, metalness: 0, ...extra });

  // ---------- monocoque, nose and engine cover ----------
  mesh(loft([
    { z: 2.78, w: 0.16, h: 0.1, y: 0.22, n: 2.2, flat: 0.6 },
    { z: 2.55, w: 0.24, h: 0.15, y: 0.25, n: 2.3, flat: 0.6 },
    { z: 2.1, w: 0.33, h: 0.24, y: 0.31, n: 2.5, flat: 0.6 },
    { z: 1.55, w: 0.44, h: 0.34, y: 0.39, n: 2.7, flat: 0.5 },
    { z: 1.05, w: 0.6, h: 0.48, y: 0.46, n: 3, flat: 0.5 },
    { z: 0.55, w: 0.74, h: 0.56, y: 0.5, n: 3.2, flat: 0.45 },
    { z: 0.0, w: 0.8, h: 0.6, y: 0.5, n: 3.2, flat: 0.45 },
    { z: -0.7, w: 0.66, h: 0.58, y: 0.49, n: 3, flat: 0.45 },
    { z: -1.4, w: 0.44, h: 0.44, y: 0.44, n: 2.8, flat: 0.5 },
    { z: -2.05, w: 0.26, h: 0.28, y: 0.38, n: 2.5, flat: 0.6 },
    { z: -2.45, w: 0.16, h: 0.18, y: 0.36, n: 2.3, flat: 0.6 },
  ]), paint, g);
  // airbox / roll hoop and engine cover spine
  mesh(loft([
    { z: 0.14, w: 0.26, h: 0.2, y: 0.95, n: 2.4 },
    { z: -0.1, w: 0.34, h: 0.36, y: 0.88, n: 2.6 },
    { z: -0.6, w: 0.3, h: 0.32, y: 0.8, n: 2.6 },
    { z: -1.3, w: 0.18, h: 0.2, y: 0.68, n: 2.4 },
    { z: -2.0, w: 0.06, h: 0.08, y: 0.55, n: 2.2 },
  ]), paint, g);
  mesh(new THREE.CircleGeometry(0.1, 20), black, g, [0, 0.95, 0.142], [0, 0, 0], [1.1, 0.8, 1]); // airbox inlet
  mesh(plate([[0.0, 0.0], [-1.6, -0.3], [-1.6, -0.38], [0.0, -0.08]], 0.012), paint2, g, [0, 1.04, -0.25]); // shark fin
  // T-camera
  mesh(new THREE.BoxGeometry(0.08, 0.05, 0.16), new THREE.MeshStandardMaterial({ color: number % 2 ? 0x111111 : 0xffd400, roughness: 0.5, ...extra }), g, [0, 1.09, 0.1]);

  // cockpit opening and headrest
  mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshBasicMaterial({ color: 0x050506, ...extra }), g, [0, 0.796, 0.6], [-Math.PI / 2 + 0.06, 0, 0], [0.56, 0.8, 1]);
  mesh(loft([{ z: 0.32, w: 0.66, h: 0.12, y: 0.82, n: 2.2 }, { z: 0.1, w: 0.7, h: 0.18, y: 0.84, n: 2.4 }]), black, g);

  // ---------- sidepods ----------
  for (const s of [-1, 1]) {
    mesh(loft([
      { z: 0.62, w: 0.36, h: 0.3, y: 0.52, x: s * 0.6, n: 3.4, flat: 0.8 },
      { z: 0.35, w: 0.48, h: 0.38, y: 0.5, x: s * 0.6, n: 3.4, flat: 0.8 },
      { z: -0.3, w: 0.46, h: 0.34, y: 0.45, x: s * 0.58, n: 3, flat: 0.8 },
      { z: -1.0, w: 0.32, h: 0.24, y: 0.36, x: s * 0.52, n: 2.6, flat: 0.8 },
      { z: -1.55, w: 0.14, h: 0.12, y: 0.28, x: s * 0.42, n: 2.2 },
    ]), paint, g);
    mesh(new THREE.CircleGeometry(0.17, 24), black, g, [s * 0.6, 0.53, 0.625], [0, 0, 0], [1, 0.8, 1]); // radiator inlet
    // mirrors
    // aerodynamic housing with the glass facing back
    mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), paint, g, [s * 0.52, 0.86, 0.655], [Math.PI / 2, 0, 0], [0.08, 0.06, 0.035]);
    mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshStandardMaterial({ color: 0xc8d8e8, metalness: 1, roughness: 0.03, ...extra }), g, [s * 0.52, 0.86, 0.653], [0, Math.PI, 0], [0.078, 0.033, 1]);
    g.add(rod(new THREE.Vector3(s * 0.36, 0.8, 0.66), new THREE.Vector3(s * 0.48, 0.86, 0.66), 0.012, cf));
  }

  // ---------- floor & diffuser ----------
  const outline = [[0.32, 1.35], [0.62, 0.95], [0.75, 0.75], [0.78, -0.9], [0.62, -1.3], [0.5, -1.45], [0.5, -2.1]];
  const fs = new THREE.Shape();
  fs.moveTo(-outline[0][0], outline[0][1]);
  for (const [x, z] of outline) fs.lineTo(x, z);
  for (let i = outline.length - 1; i >= 0; i--) fs.lineTo(-outline[i][0], outline[i][1]);
  const floorGeo = new THREE.ExtrudeGeometry(fs, { depth: 0.025, bevelEnabled: false });
  floorGeo.rotateX(Math.PI / 2);
  mesh(floorGeo, cf, g, [0, 0.085, 0]);
  for (const s of [-1, 1]) mesh(plate([[1.0, 0], [0.7, 0.08], [0.3, 0.06], [0.2, 0]], 0.012), cf, g, [s * 0.72, 0.06, 0]); // floor fences
  mesh(plate([[-1.6, 0], [-2.4, 0.26], [-2.45, 0.3], [-1.6, 0.02]], 1.0), cf, g, [0, 0.06, 0]); // diffuser ramp
  for (const s of [-1, 0, 1]) mesh(plate([[-1.7, 0], [-2.42, 0.25], [-2.42, 0.02]], 0.01), cf, g, [s * 0.32, 0.06, 0]);
  // plank
  mesh(new THREE.BoxGeometry(0.3, 0.012, 2.6), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9, ...extra }), g, [0, 0.068, -0.2]);

  // ---------- front wing (active flaps) ----------
  const fw = new THREE.Group();
  fw.position.set(0, 0.11, 2.92);
  g.add(fw);
  mesh(wing(0.34, 1.78, { camber: 0.05 }), cf, fw, [0, 0, 0], [0.05, 0, 0]);
  const frontFlaps = [];
  [[0.2, 0.06, -0.24, 0.32], [0.16, 0.12, -0.36, 0.55]].forEach(([chord, y, z, aoa], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(0, y, z + chord * 0.1);
    fw.add(pivot);
    mesh(wing(chord, 1.66 - i * 0.12, { camber: 0.08 }), i ? paint2 : cf, pivot, [0, 0, chord * 0.1]);
    pivot.rotation.x = aoa;
    frontFlaps.push({ pivot, corner: aoa, straight: aoa * 0.25 });
  });
  for (const s of [-1, 1]) mesh(plate([[0.05, -0.04], [0.05, 0.16], [-0.18, 0.26], [-0.55, 0.26], [-0.55, -0.04]], 0.018), paint2, fw, [s * 0.9, 0, 0]);
  // nose pylons down to the wing
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.02, 0.14, 0.3), cf, g, [s * 0.08, 0.17, 2.75]);

  // ---------- rear wing (active flap) ----------
  const rw = new THREE.Group();
  rw.position.set(0, 0.84, -2.18);
  g.add(rw);
  mesh(wing(0.38, 1.0, { camber: 0.09 }), paint, rw, [0, 0, 0], [0.12, 0, 0]);
  const flapPivot = new THREE.Group();
  flapPivot.position.set(0, 0.11, -0.3);
  rw.add(flapPivot);
  mesh(wing(0.24, 1.0, { camber: 0.1 }), paint2, flapPivot, [0, 0, 0]);
  flapPivot.rotation.x = 0.55;
  const rearFlap = { pivot: flapPivot, corner: 0.55, straight: 0.05 };
  for (const s of [-1, 1]) {
    mesh(plate([[0.15, -0.32], [0.15, 0.2], [0.0, 0.3], [-0.55, 0.3], [-0.62, 0.15], [-0.62, -0.32]], 0.018), paint, rw, [s * 0.51, 0, 0]);
    mesh(new THREE.PlaneGeometry(0.6, 0.15), new THREE.MeshBasicMaterial({ map: TX.board(spec.name.toUpperCase(), 'rgba(0,0,0,0)', '#ffffff', 512, 128, 'italic 900 64px "Titillium Web", Arial'), transparent: true, ...extra }), rw, [s * 0.522, 0.0, -0.22], [0, s * Math.PI / 2, 0]);
  }
  // swan-neck pylon + crash structure + rain light
  mesh(plate([[0.05, -0.6], [0.0, 0.1], [-0.12, 0.12], [-0.08, -0.6]], 0.03), cf, rw, [0, 0, -0.1]);
  const rainLight = mesh(new THREE.BoxGeometry(0.14, 0.06, 0.03), new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff0a0a, emissiveIntensity: 0.3, ...extra }), g, [0, 0.36, -2.54]);

  // ---------- halo ----------
  const haloCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.37, 0.8, 0.2), new THREE.Vector3(-0.38, 0.95, 0.42), new THREE.Vector3(-0.26, 1.0, 0.74),
    new THREE.Vector3(0, 1.02, 0.86), new THREE.Vector3(0.26, 1.0, 0.74), new THREE.Vector3(0.38, 0.95, 0.42), new THREE.Vector3(0.37, 0.8, 0.2),
  ]);
  mesh(new THREE.TubeGeometry(haloCurve, 48, 0.03, 10), paint, g);
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.02, 0.86), new THREE.Vector3(0, 0.92, 1.0), new THREE.Vector3(0, 0.78, 1.12)]), 12, 0.03, 8), paint, g);

  // ---------- driver ----------
  const helmet = new THREE.Group();
  helmet.position.set(0, 0.86, 0.42);
  g.add(helmet);
  mesh(new THREE.SphereGeometry(0.15, 32, 24), new THREE.MeshPhysicalMaterial({ map: TX.helmetLivery(spec.main, spec.second, number), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, ...extra }), helmet, [0, 0, 0], [0, 0, 0], [1, 1.02, 1.12]);
  mesh(new THREE.SphereGeometry(0.152, 24, 8, -1.1, 2.2, 1.25, 0.38), new THREE.MeshStandardMaterial({ color: 0x111418, metalness: 0.9, roughness: 0.08, ...extra }), helmet, [0, 0, 0], [0, 0, 0], [1, 1.02, 1.12]);
  mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), accent, helmet, [0, 0.15, 0]);

  // ---------- cockpit internals (seen in first person) ----------
  const cockpit = new THREE.Group();
  g.add(cockpit);
  const sw = new THREE.Group();
  sw.position.set(0, 0.79, 0.74);
  sw.rotation.x = -0.6;
  cockpit.add(sw);
  const swShape = new THREE.Shape();
  swShape.moveTo(-0.14, -0.06); swShape.lineTo(-0.15, 0.05); swShape.quadraticCurveTo(-0.12, 0.085, 0, 0.085); swShape.quadraticCurveTo(0.12, 0.085, 0.15, 0.05); swShape.lineTo(0.14, -0.06); swShape.quadraticCurveTo(0, -0.1, -0.14, -0.06);
  const swGeo = new THREE.ExtrudeGeometry(swShape, { depth: 0.03, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 2 });
  swGeo.translate(0, 0, -0.015);
  swGeo.rotateY(Math.PI);
  mesh(swGeo, cf, sw);
  for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.13, 12), rubber, sw, [s * 0.155, -0.005, -0.01], [0, 0, s * 0.12]);
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.04, 12, 10), new THREE.MeshStandardMaterial({ color: spec.second, roughness: 0.7, ...extra }), sw, [s * 0.155, 0.01, -0.03], [0, 0, 0], [0.9, 1.3, 1]);
  // display
  const disp = document.createElement('canvas');
  disp.width = 256; disp.height = 128;
  const dispTex = new THREE.CanvasTexture(disp);
  dispTex.colorSpace = THREE.SRGBColorSpace;
  mesh(new THREE.PlaneGeometry(0.12, 0.06), new THREE.MeshBasicMaterial({ map: dispTex, toneMapped: false }), sw, [0, 0.01, -0.022], [0, Math.PI, 0]);
  // shift LEDs
  const leds = [];
  for (let i = 0; i < 15; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false });
    mesh(new THREE.BoxGeometry(0.009, 0.006, 0.004), m, sw, [(7 - i) * 0.0125, 0.068, -0.02]);
    leds.push(m);
  }
  // buttons / rotaries
  const btnCol = [0xe10600, 0x2bd46b, 0xffd400, 0x1e5bc6, 0xffffff, 0xff8000];
  for (let i = 0; i < 6; i++) mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 10), new THREE.MeshStandardMaterial({ color: btnCol[i], ...extra }), sw, [(i < 3 ? 1 : -1) * (0.075 + (i % 3) * 0.018), -0.04, -0.022], [Math.PI / 2, 0, 0]);
  // cockpit side pads
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.06, 0.08, 0.5), black, cockpit, [s * 0.3, 0.8, 0.55]);

  // ---------- wheels, brakes and suspension ----------
  const wheels = [];
  for (const [front, side] of [[true, 1], [true, -1], [false, 1], [false, -1]]) {
    const z = front ? DIM.frontZ : DIM.rearZ, x = side * (front ? DIM.frontX : DIM.rearX), w = front ? DIM.frontW : DIM.rearW;
    const pivot = new THREE.Group();
    pivot.position.set(x, DIM.tyreR, z);
    g.add(pivot);
    const spin = new THREE.Group();
    pivot.add(spin);
    mesh(tyreGeo(w), ghost ? rubber : new THREE.MeshStandardMaterial({ map: TX.sidewall(`#${COMPOUND_COLORS[compound].toString(16).padStart(6, '0')}`, compound.toUpperCase()), roughness: 0.82, metalness: 0 }), spin);
    // wheel cover (2026 rims carry flat covers)
    const cover = mesh(new THREE.CylinderGeometry(0.232, 0.232, w * 0.9, 36), metal, spin, [0, 0, 0], [0, 0, Math.PI / 2]);
    cover.castShadow = false;
    mesh(new THREE.CircleGeometry(0.11, 24), paint2, spin, [side * (w * 0.45 + 0.002), 0, 0], [0, side * Math.PI / 2, 0]);
    for (let k = 0; k < 5; k++) mesh(new THREE.BoxGeometry(0.004, 0.2, 0.012), black, spin, [side * (w * 0.45 + 0.003), 0, 0], [(k / 5) * Math.PI * 2, 0, 0]);
    // brake duct / drum (does not spin)
    mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 20), cf, pivot, [-side * (w / 2 + 0.05), 0, 0], [0, 0, Math.PI / 2]);
    const brakeGlow = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff3a00, emissiveIntensity: 0, ...extra });
    mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 24), brakeGlow, pivot, [-side * (w / 2 + 0.115), 0, 0], [0, Math.PI / 2, 0]);
    wheels.push({ pivot, spin, front, side, brakeGlow });
    // wishbones and push/pull rods to the chassis
    const hub = new THREE.Vector3(x - side * (w / 2 + 0.05), DIM.tyreR, z);
    const inner = front ? 0.18 : 0.2;
    for (const [dy, dz] of [[0.1, 0.18], [0.1, -0.18], [-0.08, 0.2], [-0.08, -0.2]]) {
      g.add(rod(new THREE.Vector3(hub.x, hub.y + dy * 0.6, hub.z), new THREE.Vector3(side * inner, DIM.tyreR + dy, z + dz), 0.014, cf));
    }
    g.add(rod(new THREE.Vector3(hub.x, hub.y - 0.06, hub.z), new THREE.Vector3(side * 0.12, DIM.tyreR + 0.24, z + (front ? -0.25 : 0.25)), 0.012, cf));
  }

  // ---------- livery details ----------
  const num = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: TX.numberDecal(number, '#ffffff'), transparent: true, depthWrite: false, ...extra }));
  num.position.set(0, 0.42, 1.98);
  num.rotation.set(-Math.PI / 2 + 0.17, 0, 0);
  g.add(num);
  for (const s of [-1, 1]) {
    const nameDecal = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.16), new THREE.MeshBasicMaterial({ map: TX.board(spec.name.toUpperCase(), 'rgba(0,0,0,0)', spec.decal || '#ffffff', 512, 128, 'italic 900 70px "Titillium Web", Arial'), transparent: true, depthWrite: false, ...extra }));
    nameDecal.position.set(s * 0.835, 0.5, -0.25);
    nameDecal.rotation.y = s * Math.PI / 2;
    g.add(nameDecal);
    mesh(new THREE.BoxGeometry(0.01, 0.06, 1.2), accent, g, [s * 0.83, 0.38, -0.3]);
  }

  // exhaust and a soft contact shadow under the floor
  mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.22, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x7a6a5a, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide, ...extra }), g, [0, 0.5, -2.42], [Math.PI / 2, 0, 0]);
  if (!ghost) {
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 5.4), new THREE.MeshBasicMaterial({ map: TX.blobShadow(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.015, -0.1);
    shadow.renderOrder = 2;
    g.add(shadow);
  }
  if (ghost) g.traverse((c) => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
  return { group: g, wheels, frontFlaps, rearFlap, steering: sw, display: { canvas: disp, ctx: disp.getContext('2d'), tex: dispTex }, leds, helmet, rainLight, cockpit };
}

export { COMPOUND_COLORS };
