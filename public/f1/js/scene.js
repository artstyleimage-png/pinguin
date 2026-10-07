import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

export const THEMES = {
  park: { grass: [0.3, 0.5, 0.19], gravel: [0.8, 0.72, 0.56], trees: 'broadleaf', hills: 0x5d7a45, far: 'hills' },
  mountain: { grass: [0.28, 0.45, 0.2], gravel: [0.72, 0.68, 0.6], trees: 'pine', hills: 0x5f7060, far: 'mountains' },
  street: { grass: [0.36, 0.45, 0.25], gravel: [0.7, 0.68, 0.64], trees: 'city', hills: 0x7f858c, far: 'city' },
  desert: { grass: [0.74, 0.62, 0.42], gravel: [0.85, 0.74, 0.55], trees: 'palm', hills: 0xb89a6a, far: 'dunes' },
  polygon: { grass: [0.3, 0.5, 0.19], gravel: [0.8, 0.72, 0.56], trees: 'none', hills: 0x6a7a5a, far: 'hills' },
};

const lerp = (a, b, t) => a + (b - a) * t;

/** Ribbon between lateral offsets a and b (left positive) following the centre line. */
function ribbon(T, a, b, { ya = 0, yb = 0, vScale = 20, uScale = 1, colorFn = null, from = 0, to = T.n, closed = true, limitInner = false } = {}) {
  const pos = [], uv = [], col = [], idx = [];
  const count = to - from + (closed && to - from === T.n ? 1 : 0);
  for (let k = 0; k < count; k++) {
    const i = (from + k) % T.n;
    const p = T.pts[i], nr = T.nrm[i];
    let oa = typeof a === 'function' ? a(i) : a, ob = typeof b === 'function' ? b(i) : b;
    if (limitInner) {
      const r = Math.abs(T.curv[i]) > 1e-5 ? 0.9 / Math.abs(T.curv[i]) : 1e9;
      if (T.curv[i] > 0) { oa = Math.min(oa, r); ob = Math.min(ob, r); }
      if (T.curv[i] < 0) { oa = Math.max(oa, -r); ob = Math.max(ob, -r); }
    }
    const yA = typeof ya === 'function' ? ya(i) : p.y + ya;
    const yB = typeof yb === 'function' ? yb(i) : p.y + yb;
    pos.push(p.x + nr.x * oa, yA, p.z + nr.z * oa, p.x + nr.x * ob, yB, p.z + nr.z * ob);
    const v = (k * T.step) / vScale;
    uv.push(0, v, uScale, v);
    if (colorFn) { const c = colorFn(i); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
    if (k < count - 1) { const q = k * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colorFn) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function add(scene, geo, mat, { shadow = false, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = receive;
  scene.add(m);
  return m;
}

/** Contiguous index ranges where pred(i) holds. */
function ranges(n, pred, pad = 0) {
  const out = [];
  let i = 0;
  while (i < n) {
    if (!pred(i)) { i++; continue; }
    let j = i;
    while (j < n && pred(j)) j++;
    out.push([Math.max(0, i - pad), Math.min(n, j + pad)]);
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------- vegetation
function cardCluster(r, cards, radius, height, seed) {
  const rand = TX.rng(seed);
  const geos = [];
  for (let k = 0; k < cards; k++) {
    const g = new THREE.PlaneGeometry(radius * 1.25, radius * 1.25);
    g.rotateY(rand() * Math.PI);
    g.rotateX((rand() - 0.5) * 0.9);
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * radius * 0.55;
    g.translate(Math.cos(a) * d, height + (rand() - 0.3) * radius * 0.7, Math.sin(a) * d);
    geos.push(g);
  }
  const m = mergeGeometries(geos);
  // fake ambient occlusion: darker toward the bottom/inside
  const pos = m.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = (pos.getY(i) - (height - radius)) / (radius * 2);
    const v = 0.55 + Math.max(0, Math.min(1, y)) * 0.55;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
  }
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return m;
}

function treeKind(kind) {
  if (kind === 'broadleaf') {
    return [0, 1, 2].map((v) => ({
      trunk: new THREE.CylinderGeometry(0.16, 0.3, 5, 7).translate(0, 2.5, 0),
      crown: mergeGeometries([cardCluster(null, 20, 2.8, 6.4 + v * 0.6, 40 + v), cardCluster(null, 12, 2.1, 5.0, 50 + v).translate(1.4, 0, 0.5), cardCluster(null, 12, 2.0, 5.3, 60 + v).translate(-1.2, 0.3, -0.8)]),
      leaf: TX.leaves([0.24 + v * 0.03, 0.4 - v * 0.03, 0.14], 3 + v),
    }));
  }
  if (kind === 'pine') {
    return [0, 1].map((v) => {
      const geos = [];
      for (let k = 0; k < 6; k++) {
        const r = 2.6 - k * 0.38, y = 2.6 + k * 1.35;
        const c = new THREE.ConeGeometry(r, 2.4, 9, 1, true);
        c.translate(0, y, 0);
        geos.push(c);
      }
      const crown = mergeGeometries(geos);
      const pos = crown.attributes.position;
      const rand = TX.rng(9 + v);
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.85 + rand() * 0.3), pos.getY(i) + (rand() - 0.5) * 0.3, pos.getZ(i) * (0.85 + rand() * 0.3));
      crown.computeVertexNormals();
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { const k = 0.6 + (pos.getY(i) / 11) * 0.5; col.set([k, k, k], i * 3); }
      crown.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return { trunk: new THREE.CylinderGeometry(0.15, 0.28, 3, 7).translate(0, 1.5, 0), crown, solid: 0x2c4a2c };
    });
  }
  if (kind === 'palm') {
    return [0, 1].map((v) => {
      const lean = 0.6 + v * 0.5;
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.3, 3, 0), new THREE.Vector3(lean, 6.5, 0), new THREE.Vector3(lean * 1.4, 8.5, 0)]);
      const trunk = new THREE.TubeGeometry(curve, 10, 0.2, 7);
      const top = curve.getPoint(1);
      const fronds = [];
      for (let k = 0; k < 9; k++) {
        const f = new THREE.PlaneGeometry(1.1, 4.2, 1, 4);
        const pos = f.attributes.position;
        for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) + 2.1; pos.setXYZ(i, pos.getX(i) * (1 - y / 5), y, -0.12 * y * y); }
        f.rotateX(-0.35);
        f.rotateY((k / 9) * Math.PI * 2);
        f.translate(top.x, top.y, top.z);
        fronds.push(f);
      }
      return { trunk, crown: mergeGeometries(fronds), leaf: TX.leaves([0.3, 0.42, 0.14], 21) };
    });
  }
  return [];
}

function plantTrees(scene, spots, kind, quality) {
  const kinds = treeKind(kind);
  if (!kinds.length || !spots.length) return;
  const bark = new THREE.MeshStandardMaterial({ map: TX.bark(), color: kind === 'palm' ? 0xc8b090 : 0xffffff, roughness: 0.95 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  kinds.forEach((kd, v) => {
    const mine = spots.filter((_, i) => i % kinds.length === v);
    const trunk = new THREE.InstancedMesh(kd.trunk, bark, mine.length);
    const crownMat = kd.leaf
      ? new THREE.MeshStandardMaterial({ map: kd.leaf, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85 })
      : new THREE.MeshStandardMaterial({ color: kd.solid, vertexColors: true, roughness: 0.9, flatShading: true });
    const crown = new THREE.InstancedMesh(kd.crown, crownMat, mine.length);
    const col = new THREE.Color();
    mine.forEach(([x, y, z, s, rot], i) => {
      m4.compose(new THREE.Vector3(x, y - 0.1, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(s, s, s));
      trunk.setMatrixAt(i, m4);
      crown.setMatrixAt(i, m4);
      crown.setColorAt(i, col.setHSL(0.27 + (rot % 0.06) - 0.03, 0.3, 0.45 + (s % 0.2)));
    });
    trunk.castShadow = crown.castShadow = quality > 0;
    crown.receiveShadow = true;
    scene.add(trunk, crown);
  });
}

// ---------------------------------------------------------------- environment
export function buildGround(scene, theme, y, quality, night = false) {
  // the photographed sky panorama is the horizon now: just a big ground plane here
  const sand = theme.trees === 'palm';
  let mat;
  if (sand) {
    const gr = TX.grass(theme.grass);
    const map = gr.map.clone(); map.needsUpdate = true; map.repeat.set(500, 500);
    mat = new THREE.MeshStandardMaterial({ map, roughness: 0.97 });
  } else {
    mat = new THREE.MeshStandardMaterial({ map: TX.photoGrass(600, 600), roughness: 0.95, color: 0xd8dccf });
  }
  const ground = add(scene, new THREE.PlaneGeometry(9000, 9000), mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = y;
  if (theme.far === 'city') {
    const r = TX.rng(77);
    const n = quality ? 160 : 80;
    const fac = TX.facade();
    const bm = TX.worldUV(new THREE.MeshStandardMaterial({ map: fac.map, emissiveMap: fac.emissiveMap, emissive: night ? 0xffffff : 0x000000, emissiveIntensity: night ? 1.4 : 0, roughness: 0.45, metalness: 0.4 }), 26);
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), bm, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = 1300 + r() * 1500;
      m4.makeScale(30 + r() * 50, 40 + r() * 220, 30 + r() * 50).setPosition(Math.cos(a) * d, y, Math.sin(a) * d);
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, new THREE.Color().setHSL(0.58, 0.06, 0.6 + r() * 0.3));
    }
    scene.add(inst);
  }
}

function clearOfTrack(T, x, z, margin) {
  const m2 = margin * margin;
  for (let i = 0; i < T.n; i += 3) {
    const p = T.pts[i];
    if ((p.x - x) ** 2 + (p.z - z) ** 2 < m2) return false;
  }
  return true;
}

export function buildTrackScene(scene, T, { night = false, quality = 1 } = {}) {
  const def = T.def;
  const theme = THEMES[def.theme];
  const r = TX.rng(def.id.length * 977 + 13);
  const half = T.half;
  const base = T.minY - 0.3;
  const wet = [];
  const out = { lights: [], wet, lamps: [] };
  buildGround(scene, theme, base, quality, night);

  // embankments sloping down to the ground plane
  const gr = TX.grass(theme.grass);
  const grassMat = theme.trees === 'palm'
    ? new THREE.MeshStandardMaterial({ map: gr.map, normalMap: gr.normalMap, roughness: 0.95 })
    : new THREE.MeshStandardMaterial({ map: TX.photoGrass(1, 1), normalMap: gr.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.95, color: 0xd8dccf });
  const ground = (i) => T.pts[i].y * 0.12 + base * 0.88 - 0.05;
  for (const side of [1, -1]) {
    const wall = side > 0 ? (i) => T.wallL[i] : (i) => -T.wallR[i];
    add(scene, ribbon(T, (i) => wall(i) + side * 0.3, (i) => wall(i) + side * 80, { ya: -0.08, yb: ground, vScale: 14, uScale: 5, limitInner: true }), grassMat);
  }
  // grass run-off between kerb and wall, with gravel traps on top
  for (const side of [1, -1]) {
    const geo = side > 0
      ? ribbon(T, half + 1.4, (i) => T.wallL[i] + 0.4, { ya: -0.03, yb: -0.07, vScale: 14, uScale: 2, limitInner: true })
      : ribbon(T, (i) => -T.wallR[i] - 0.4, -half - 1.4, { ya: -0.07, yb: -0.03, vScale: 14, uScale: 2, limitInner: true });
    add(scene, geo, grassMat);
  }
  const gv = TX.gravel(theme.gravel);
  const gravelMat = new THREE.MeshStandardMaterial({ map: gv.map, normalMap: gv.normalMap, roughness: 1 });
  for (const side of [1, -1]) {
    const flag = side > 0 ? T.gravelL : T.gravelR;
    for (const [from, to] of ranges(T.n, (i) => flag[i])) {
      const geo = side > 0
        ? ribbon(T, half + 3.2, (i) => T.wallL[i] - 0.6, { ya: 0.0, yb: -0.02, vScale: 6, uScale: 3, from, to, closed: false, limitInner: true })
        : ribbon(T, (i) => -T.wallR[i] + 0.6, -half - 3.2, { ya: -0.02, yb: 0.0, vScale: 6, uScale: 3, from, to, closed: false, limitInner: true });
      add(scene, geo, gravelMat);
    }
  }
  // paved strip beyond the kerbs
  const pa = TX.plainAsphalt();
  const paveMat = new THREE.MeshStandardMaterial({ map: pa.map, normalMap: pa.normalMap, roughness: 0.9, color: 0xb8b8b8 });
  for (const side of [1, -1]) add(scene, side > 0 ? ribbon(T, half + 1.35, half + 3.2, { ya: -0.005, yb: -0.02, vScale: 8 }) : ribbon(T, -half - 3.2, -half - 1.35, { ya: -0.02, yb: -0.005, vScale: 8 }), paveMat);
  wet.push({ mat: paveMat, rough: 0.9, color: new THREE.Color(0xb8b8b8) });

  // the racing surface
  const as = TX.asphalt();
  const asphaltMat = new THREE.MeshStandardMaterial({ map: as.map, roughnessMap: as.roughnessMap, normalMap: as.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 1, vertexColors: true });
  // rubber laid down in the braking zones before corners
  const brake = new Float32Array(T.n);
  for (let i = 0; i < T.n; i++) {
    let b = 0;
    for (let j = 0; j < 80; j += 2) if (Math.abs(T.curv[(i + j) % T.n]) > 1 / 140) { b = Math.max(b, 1 - j / 80); }
    brake[i] = b;
  }
  const rubberCol = new THREE.Color();
  add(scene, ribbon(T, half + 0.15, -half - 0.15, { vScale: T.def.width, colorFn: (i) => rubberCol.setScalar(1 - 0.16 * brake[i] - 0.03 * Math.sin(i * 0.37) ** 2) }), asphaltMat);
  wet.push({ mat: asphaltMat, rough: 1, color: new THREE.Color(0xffffff) });

  // kerbs: raised red/white with a ridge
  const red = new THREE.Color(0xc81e1a), white = new THREE.Color(0xeeeeee);
  const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  wet.push({ mat: kerbMat, rough: 0.55, color: new THREE.Color(0xffffff) });
  for (const [from, to] of ranges(T.n, (i) => Math.abs(T.curv[i]) > 1 / 320, 7)) {
    const cf = (k) => (Math.floor(k / 1.5) % 2 ? red : white);
    add(scene, ribbon(T, half + 1.4, half + 0.6, { ya: 0.03, yb: 0.08, colorFn: cf, from, to, closed: false }), kerbMat);
    add(scene, ribbon(T, half + 0.6, half - 0.15, { ya: 0.08, yb: 0.01, colorFn: cf, from, to, closed: false }), kerbMat);
    add(scene, ribbon(T, -half + 0.15, -half - 0.6, { ya: 0.01, yb: 0.08, colorFn: cf, from, to, closed: false }), kerbMat);
    add(scene, ribbon(T, -half - 0.6, -half - 1.4, { ya: 0.08, yb: 0.03, colorFn: cf, from, to, closed: false }), kerbMat);
  }

  buildBarriers(scene, T, def, quality);
  buildStartArea(scene, T, out, r);
  buildTrackside(scene, T, r, out, night, quality);

  // trees
  const spots = [];
  const target = theme.trees === 'city' ? 0 : quality >= 2 ? 900 : quality >= 1 ? 600 : 300;
  for (let tries = 0; tries < target * 3 && spots.length < target; tries++) {
    const k = Math.floor(r() * T.n);
    const side = r() < 0.5 ? 1 : -1;
    const w = side > 0 ? T.wallL[k] : T.wallR[k];
    const o = w + 8 + r() * r() * 75;
    const p = T.pts[k], nr = T.nrm[k];
    const x = p.x + nr.x * o * side, z = p.z + nr.z * o * side;
    if (!clearOfTrack(T, x, z, half + T.def.runoff + 6)) continue;
    const t = Math.min(1, (o - w) / 80);
    const y = lerp(p.y - 0.08, ground(k), t);
    spots.push([x, y, z, 0.75 + r() * 0.6, r() * Math.PI * 2]);
  }
  plantTrees(scene, spots, theme.trees, quality);
  if (theme.trees === 'city') buildCityBlocks(scene, T, r, quality, night);
  return out;
}

function buildBarriers(scene, T, def, quality) {
  const steel = new THREE.MeshStandardMaterial({ color: 0xc4cad0, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide });
  const concrete = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const fenceTex = TX.fence();
  const fenceMap = fenceTex.clone(); fenceMap.needsUpdate = true; fenceMap.repeat.set(1, 1);
  const fenceMat = new THREE.MeshStandardMaterial({ map: fenceMap, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5, transparent: false });
  const postGeos = [];
  for (const side of [1, -1]) {
    const off = side > 0 ? (k) => T.wallL[k] : (k) => -T.wallR[k];
    const wallY = (h) => (k) => T.pts[k].y + h;
    if (def.wall === 'concrete') {
      const red = new THREE.Color(0xc81e1a), white = new THREE.Color(0xe8e8e8);
      const cf = (k) => (Math.floor(k / 4) % 2 ? red : white);
      add(scene, ribbon(T, off, off, { ya: wallY(-0.3), yb: wallY(1.1), colorFn: cf }), concrete, { shadow: true });
      add(scene, ribbon(T, (k) => off(k) + side * 0.3, (k) => off(k) + side * 0.3, { ya: wallY(1.1), yb: wallY(4.2), vScale: 1.2, uScale: 3 }), fenceMat);
    } else {
      // tyre bundles / tecpro on corners, armco elsewhere
      for (const [h0, h1] of [[0.35, 0.62], [0.7, 0.97]]) add(scene, ribbon(T, off, off, { ya: wallY(h0), yb: wallY(h1) }), steel, { shadow: true });
      add(scene, ribbon(T, (k) => off(k) + side * 0.4, (k) => off(k) + side * 0.4, { ya: wallY(1.0), yb: wallY(3.8), vScale: 1.2, uScale: 3 }), fenceMat);
      if (def.wall === 'tyres' || true) {
        const tec = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
        const c1 = new THREE.Color(def.wall === 'tyres' ? 0x2b5fd0 : 0xd8211c), c2 = new THREE.Color(0xf0f0f0);
        for (const [from, to] of ranges(T.n, (i) => (side > 0 ? T.gravelL[i] : T.gravelR[i]), 4)) {
          add(scene, ribbon(T, (k) => off(k) - side * 0.6, (k) => off(k) - side * 0.6, { ya: wallY(0), yb: wallY(1.1), colorFn: (k) => (Math.floor(k / 1) % 2 ? c1 : c2), from, to, closed: false }), tec, { shadow: true });
        }
      }
    }
    for (let k = 0; k < T.n; k += 2) {
      const p = T.pts[k], nr = T.nrm[k];
      const o = off(k) + side * (def.wall === 'concrete' ? 0.3 : 0.4);
      const g = new THREE.BoxGeometry(0.08, 4.2, 0.08);
      g.translate(p.x + nr.x * o, p.y + 1.9, p.z + nr.z * o);
      postGeos.push(g);
    }
  }
  const posts = mergeGeometries(postGeos);
  add(scene, posts, new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.7, roughness: 0.4 }), { shadow: quality > 1 });
}

function buildStartArea(scene, T, out, r) {
  const p0 = T.pts[0], t0 = T.tan[0];
  const yaw0 = Math.atan2(t0.x, t0.z);
  // chequered line + grid slots
  const chk = document.createElement('canvas');
  chk.width = 512; chk.height = 32;
  const cg = chk.getContext('2d');
  for (let x = 0; x < 32; x++) for (let y = 0; y < 2; y++) { cg.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; cg.fillRect(x * 16, y * 16, 16, 16); }
  const ct = new THREE.CanvasTexture(chk);
  ct.colorSpace = THREE.SRGBColorSpace;
  const lg = new THREE.Group();
  const line = new THREE.Mesh(new THREE.PlaneGeometry(T.def.width, 1.2), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
  line.rotation.x = -Math.PI / 2;
  line.receiveShadow = true;
  lg.add(line);
  lg.position.set(p0.x, p0.y + 0.01, p0.z);
  lg.rotation.y = yaw0;
  scene.add(lg);
  const slotMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  for (let g = 0; g < 12; g++) {
    const k = (T.n - Math.round((10 + g * 8) / T.step)) % T.n;
    const p = T.pts[k], t = T.tan[k], nr = T.nrm[k];
    const side = g % 2 ? -1 : 1;
    const grp = new THREE.Group();
    for (const [w, d, x, z] of [[2.2, 0.14, 0, 0], [0.14, 1.0, -1.03, -0.45], [0.14, 1.0, 1.03, -0.45]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), slotMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0, z);
      m.receiveShadow = true;
      grp.add(m);
    }
    grp.position.set(p.x + nr.x * side * 3, p.y + 0.012, p.z + nr.z * side * 3);
    grp.rotation.y = Math.atan2(t.x, t.z);
    scene.add(grp);
  }

  // start gantry with five pairs of red lights
  const gantry = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x23262c, metalness: 0.7, roughness: 0.35 });
  const span = T.def.width + 6;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.3, 0.9), steel);
  beam.position.y = 7.2;
  beam.castShadow = true;
  gantry.add(beam);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.8, 0.6), steel);
    post.position.set((s * span) / 2, 3.9, 0);
    post.castShadow = true;
    gantry.add(post);
  }
  for (let k = 0; k < 5; k++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a0000, emissive: 0xff1010, emissiveIntensity: 0 });
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.2, 0.2), steel);
    pod.position.set((k - 2) * 1.0, 7.2, -0.55);
    gantry.add(pod);
    for (const row of [0, 1]) {
      const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.22, 18), mat);
      bulb.position.set((k - 2) * 1.0, 7.45 - row * 0.5, -0.66);
      bulb.rotation.y = Math.PI;
      gantry.add(bulb);
    }
    out.lights.push(mat);
  }
  const nameBoard = new THREE.Mesh(new THREE.PlaneGeometry(span - 4, 1.0), new THREE.MeshBasicMaterial({ map: TX.board(T.def.name.toUpperCase(), '#101114', '#ffffff', 1024, 96, 'italic 900 70px "Titillium Web", Arial') }));
  nameBoard.position.set(0, 8.4, -0.46);
  nameBoard.rotation.y = Math.PI;
  gantry.add(nameBoard);
  gantry.position.set(p0.x, p0.y, p0.z);
  gantry.rotation.y = yaw0;
  scene.add(gantry);

  // grandstands (left) and pit building with garages (right) along the main straight
  const crowd = TX.crowd();
  const crowdMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 1 });
  const standMat = new THREE.MeshStandardMaterial({ color: 0xdde1e6, roughness: 0.7, metalness: 0.2 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.5, metalness: 0.4 });
  const teams = [0xd40000, 0x00a19c, 0x1b2a55, 0xff8000, 0x006f62, 0x0b5fd8, 0xffffff, 0x8a8f96, 0x2a2d33, 0xe8002d];
  for (let g = -4; g <= 4; g++) {
    const k = (Math.round((g * 40) / T.step) + T.n) % T.n;
    const p = T.pts[k], t = T.tan[k], nr = T.nrm[k];
    const yaw = Math.atan2(t.x, t.z);
    const stand = new THREE.Group();
    for (let row = 0; row < 9; row++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(38, 0.9, 1.6), crowdMat);
      step.position.set(0, 0.6 + row * 0.85, row * 1.5);
      step.castShadow = step.receiveShadow = true;
      stand.add(step);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(38, 10, 0.5), standMat);
    back.position.set(0, 5, 14);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(39, 0.35, 17), roofMat);
    roof.position.set(0, 10.6, 6.5);
    roof.rotation.x = -0.08;
    for (const m of [back, roof]) { m.castShadow = m.receiveShadow = true; stand.add(m); }
    const o = T.wallL[k] + 10;
    stand.position.set(p.x + nr.x * o, p.y, p.z + nr.z * o);
    stand.rotation.y = yaw + Math.PI / 2;
    scene.add(stand);

    // pit building: garages with team colours and a hospitality level above
    const pk = T.wallR[k] + 16;
    const pit = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 40), new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.4, metalness: 0.3 }));
    body.position.y = 4.5;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(14.2, 3, 40.2), new THREE.MeshStandardMaterial({ color: 0x1d2a38, roughness: 0.05, metalness: 0.9 }));
    glass.position.y = 6.5;
    pit.add(body, glass);
    for (let d = 0; d < 4; d++) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 4.2), new THREE.MeshStandardMaterial({ color: teams[(g + 4 + d) % teams.length], roughness: 0.5, emissive: teams[(g + 4 + d) % teams.length], emissiveIntensity: 0.08 }));
      door.position.set(7.05, 2.1, -15 + d * 10);
      door.rotation.y = Math.PI / 2;
      pit.add(door);
    }
    pit.traverse((m) => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
    pit.position.set(p.x - nr.x * pk, p.y, p.z - nr.z * pk);
    pit.rotation.y = yaw + Math.PI;
    scene.add(pit);
    // pit lane surface
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(9, 41), new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.9 }));
    lane.rotation.x = -Math.PI / 2;
    const lo = T.wallR[k] + 4.5;
    lane.position.set(p.x - nr.x * lo, p.y - 0.02, p.z - nr.z * lo);
    lane.rotation.z = -yaw;
    lane.rotation.order = 'YXZ';
    lane.rotation.set(-Math.PI / 2, yaw, 0, 'YXZ');
    lane.receiveShadow = true;
    scene.add(lane);
  }
  void r;
}

function buildTrackside(scene, T, r, out, night, quality) {
  // brake marker boards before heavy braking zones (end of an active-aero straight)
  const boardMats = [150, 100, 50].map((n) => new THREE.MeshStandardMaterial({ map: TX.board(String(n), '#f4f4f4', '#111', 256, 256, '900 150px "Titillium Web", Arial'), roughness: 0.6 }));
  for (let i = 0; i < T.n; i++) {
    const j = (i + 1) % T.n;
    if (!(T.aeroZone[i] && !T.aeroZone[j])) continue;
    // the zone ends ~250 m before the corner: put the boards 150/100/50 m before the end of the straight run
    let end = j;
    while (Math.abs(T.curv[end]) < 1 / 450 && end !== i) end = (end + 1) % T.n;
    [150, 100, 50].forEach((d, n) => {
      const k = (end - Math.round(d / T.step) + T.n) % T.n;
      const p = T.pts[k], t = T.tan[k], nr = T.nrm[k];
      const side = T.curv[end] > 0 ? -1 : 1;
      const o = (side > 0 ? T.wallL[k] : T.wallR[k]) - 0.8;
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), boardMats[n]);
      b.position.set(p.x + nr.x * o * side, p.y + 1.1, p.z + nr.z * o * side);
      b.rotation.y = Math.atan2(t.x, t.z) + Math.PI;
      scene.add(b);
    });
  }

  // advertising boards on the outside of corners
  const ads = [['APEX', '#111', '#ffd400'], ['TURBO', '#c8102e', '#fff'], ['GRIP', '#1e5bc6', '#fff'], ['PIT LANE', '#00a19c', '#fff'], ['V-MAX', '#ff8000', '#111'], ['RACE FUEL', '#0f1a2e', '#7cf']];
  const adMats = ads.map(([t, b, f]) => new THREE.MeshStandardMaterial({ map: TX.board(t, b, f), roughness: 0.6, side: THREE.DoubleSide }));
  for (let k = 0; k < T.n; k += 23) {
    if (Math.abs(T.curv[k]) < 1 / 260) continue;
    const side = T.curv[k] > 0 ? -1 : 1;
    const o = (side > 0 ? T.wallL[k] : T.wallR[k]) - 0.35;
    const p = T.pts[k], t = T.tan[k], nr = T.nrm[k];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 1), adMats[Math.floor(r() * adMats.length)]);
    m.position.set(p.x + nr.x * o * side, p.y + 0.55, p.z + nr.z * o * side);
    m.rotation.y = Math.atan2(t.x, t.z) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    scene.add(m);
  }

  // an advertising bridge over the longest straight
  let best = 0, bi = 0;
  for (let i = 0; i < T.n; i++) if (T.aeroZone[i]) { let run = 0; let j = i; while (T.aeroZone[j] && run < T.n) { run++; j = (j + 1) % T.n; } if (run > best) { best = run; bi = (i + Math.floor(run / 2)) % T.n; } }
  if (best) {
    const p = T.pts[bi], t = T.tan[bi];
    const br = new THREE.Group();
    const span = T.wallL[bi] + T.wallR[bi] + 2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 2.2, 3), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.5, metalness: 0.3 }));
    deck.position.y = 7.5;
    br.add(deck);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 7.5, 3), deck.material);
      leg.position.set((s * span) / 2, 3.75, 0);
      br.add(leg);
      const ad = new THREE.Mesh(new THREE.PlaneGeometry(span - 2, 1.8), new THREE.MeshStandardMaterial({ map: TX.board('GRAND PRIX · TIME ATTACK', '#c8102e', '#fff', 1024, 96, 'italic 900 64px "Titillium Web", Arial'), roughness: 0.5 }));
      ad.position.set(0, 7.5, s * 1.52);
      if (s < 0) ad.rotation.y = Math.PI;
      br.add(ad);
    }
    br.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    const nr = T.nrm[bi];
    const shift = (T.wallL[bi] - T.wallR[bi]) / 2;
    br.position.set(p.x + nr.x * shift, p.y, p.z + nr.z * shift);
    br.rotation.y = Math.atan2(t.x, t.z);
    scene.add(br);
  }

  // marshal posts
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xffd400, emissive: 0x332600, roughness: 0.6 });
  for (let k = 40; k < T.n; k += 160) {
    const side = T.curv[k] > 0 ? -1 : 1;
    const o = (side > 0 ? T.wallL[k] : T.wallR[k]) + 2;
    const p = T.pts[k], nr = T.nrm[k];
    const hut = new THREE.Mesh(new THREE.BoxGeometry(2, 2.4, 2), postMat);
    hut.position.set(p.x + nr.x * o * side, p.y + 1.2, p.z + nr.z * o * side);
    hut.castShadow = true;
    scene.add(hut);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), flagMat);
    light.position.copy(hut.position).add(new THREE.Vector3(0, 1.5, 0));
    scene.add(light);
  }

  // floodlights: poles everywhere, glowing heads + light pools when it is dark
  const poleGeo = [], headGeo = [];
  const pools = [];
  for (let k = 0; k < T.n; k += 22) {
    const side = (k / 22) % 2 ? 1 : -1;
    const o = (side > 0 ? T.wallL[k] : T.wallR[k]) + 3;
    const p = T.pts[k], nr = T.nrm[k];
    const x = p.x + nr.x * o * side, z = p.z + nr.z * o * side;
    poleGeo.push(new THREE.CylinderGeometry(0.12, 0.2, 14, 6).translate(x, p.y + 7, z));
    const hx = p.x + nr.x * (o - 3.5) * side, hz = p.z + nr.z * (o - 3.5) * side;
    poleGeo.push(new THREE.BoxGeometry(0.2, 0.2, 1).lookAt(new THREE.Vector3(nr.x * side, 0, nr.z * side)).translate((x + hx) / 2, p.y + 14, (z + hz) / 2));
    headGeo.push(new THREE.BoxGeometry(1.4, 0.25, 0.8).translate(hx, p.y + 13.9, hz));
    pools.push([p.x + nr.x * (o - 9) * side, p.y + 0.03, p.z + nr.z * (o - 9) * side]);
    out.lamps.push(new THREE.Vector3(hx, p.y + 13, hz));
  }
  add(scene, mergeGeometries(poleGeo), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.7, roughness: 0.4 }), { shadow: false });
  add(scene, mergeGeometries(headGeo), new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xfff4dd, emissiveIntensity: night ? 4 : 0, roughness: 0.4 }));
  if (night) {
    const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: TX.lightPool(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }), pools.length);
    const m4 = new THREE.Matrix4();
    pools.forEach(([x, y, z], i) => { m4.makeTranslation(x, y, z); inst.setMatrixAt(i, m4); });
    scene.add(inst);
  }
  void quality;
}

function buildCityBlocks(scene, T, r, quality, night) {
  const n = quality >= 1 ? 260 : 140;
  const fac = TX.facade();
  const bm = TX.worldUV(new THREE.MeshStandardMaterial({ map: fac.map, emissiveMap: fac.emissiveMap, emissive: night ? 0xffffff : 0x000000, emissiveIntensity: night ? 1.4 : 0, roughness: 0.45, metalness: 0.35 }), 26);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), bm, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const palette = [0xd9c7a8, 0xc9a68a, 0xa9b8c8, 0xe6e2da, 0x8f9aa6, 0xd5b18a, 0x6f7f8f];
  let placed = 0;
  for (let tries = 0; tries < n * 6 && placed < n; tries++) {
    const k = Math.floor(r() * T.n);
    const side = r() < 0.5 ? 1 : -1;
    const size = 12 + r() * 16;
    const o = (side > 0 ? T.wallL[k] : T.wallR[k]) + 6 + size / 2 + r() * 40;
    const p = T.pts[k], nr = T.nrm[k], t = T.tan[k];
    const x = p.x + nr.x * o * side, z = p.z + nr.z * o * side;
    if (!clearOfTrack(T, x, z, T.half + T.def.runoff + 4 + size * 0.75)) continue;
    const hgt = 10 + r() * r() * 70;
    m4.compose(new THREE.Vector3(x, p.y - 0.2, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(t.x, t.z)), new THREE.Vector3(size, hgt, size * (0.8 + r() * 0.5)));
    inst.setMatrixAt(placed, m4);
    inst.setColorAt(placed, new THREE.Color(palette[placed % palette.length]));
    placed++;
  }
  inst.count = placed;
  inst.castShadow = inst.receiveShadow = true;
  scene.add(inst);
}

/** Flat proving ground with a measured straight, cone slalom and skid-pad. */
export function buildPolygon(scene, { night = false, quality = 1 } = {}) {
  const out = { lights: [], wet: [], lamps: [] };
  buildGround(scene, THEMES.polygon, -0.05, quality, night);
  const pa = TX.plainAsphalt();
  const map = pa.map.clone(); map.needsUpdate = true; map.repeat.set(220, 220);
  const nm = pa.normalMap.clone(); nm.needsUpdate = true; nm.repeat.set(220, 220);
  const mat = new THREE.MeshStandardMaterial({ map, normalMap: nm, roughness: 0.9 });
  const pad = add(scene, new THREE.PlaneGeometry(3900, 3900), mat);
  pad.rotation.x = -Math.PI / 2;
  out.wet.push({ mat, rough: 0.9, color: new THREE.Color(0xffffff) });
  const line = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const x of [-8, 8]) {
    const m = add(scene, new THREE.PlaneGeometry(0.3, 2000), line);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.01, 1000);
  }
  for (let d = 0; d <= 2000; d += 100) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.4), new THREE.MeshStandardMaterial({ map: TX.board(`${d} м`, '#111', '#ffd400'), side: THREE.DoubleSide }));
    b.position.set(12, 1.8, d);
    b.rotation.y = -Math.PI / 2;
    scene.add(b);
    out.lamps.push(new THREE.Vector3(14, 12, d));
  }
  const cone = new THREE.ConeGeometry(0.3, 0.7, 12);
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5a00, roughness: 0.6 });
  const spots = [];
  for (let k = 0; k < 12; k++) spots.push([-60, 40 + k * 25]);
  for (let k = 0; k < 60; k++) { const a = (k / 60) * Math.PI * 2; spots.push([-250 + Math.cos(a) * 80, 300 + Math.sin(a) * 80]); }
  const inst = new THREE.InstancedMesh(cone, coneMat, spots.length);
  const m4 = new THREE.Matrix4();
  spots.forEach(([x, z], i) => { m4.makeTranslation(x, 0.35, z); inst.setMatrixAt(i, m4); });
  inst.castShadow = true;
  scene.add(inst);
  const hm = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.5, metalness: 0.5 });
  for (let k = 0; k < 6; k++) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(60, 18, 40), hm);
    h.position.set(-400 + k * 160, 9, -300);
    h.castShadow = h.receiveShadow = true;
    scene.add(h);
  }
  const poles = [];
  for (let d = 0; d <= 2000; d += 100) poles.push(new THREE.CylinderGeometry(0.15, 0.2, 14, 6).translate(16, 7, d));
  add(scene, mergeGeometries(poles), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.7, roughness: 0.4 }));
  if (night) {
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: TX.lightPool(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 21);
    for (let i = 0; i <= 20; i++) { m4.makeTranslation(4, 0.03, i * 100); pools.setMatrixAt(i, m4); }
    scene.add(pools);
  }
  return out;
}

/** Wet look: darker, glossier surfaces that mirror the sky. */
export function setWetness(list, w) {
  for (const { mat, rough, color } of list) {
    mat.roughness = lerp(rough, 0.18, w);
    mat.color.copy(color).multiplyScalar(1 - 0.5 * w);
    mat.envMapIntensity = lerp(1, 1.5, w);
  }
}
