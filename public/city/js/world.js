import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// City layout: an N x N grid of blocks separated by roads. Road centre lines
// sit at -HALF + k * CELL (k = 0..N); the island ends a little past the outer ring road.
export const CELL = 80;
export const N = 7;
export const ROAD = 16;
export const WALK = 4;
export const HALF = (N * CELL) / 2;
export const BOUND = HALF + 34;
export const LANE = 4;

export const roadLine = (k) => -HALF + k * CELL;

export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const BLOCK_TYPES = {
  '2,3': 'bank', '5,1': 'bank',
  '1,5': 'hideout', '4,5': 'spray',
  '6,6': 'military', '0,0': 'heliport',
  '5,4': 'plaza', '3,3': 'park', '1,1': 'park',
  '4,2': 'parkour', '2,1': 'hospital', '3,5': 'police',
};

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function facadeTexture() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#e9e5df';
    g.fillRect(0, 0, 256, 256);
    const r = rng(3);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const lit = r() < 0.15;
      const grd = g.createLinearGradient(0, y * 64 + 12, 0, y * 64 + 52);
      grd.addColorStop(0, lit ? '#ffe9a8' : '#3f5f80');
      grd.addColorStop(1, lit ? '#f2c76a' : '#1c2c40');
      g.fillStyle = grd;
      g.fillRect(x * 64 + 12, y * 64 + 12, 40, 42);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x * 64 + 14, y * 64 + 14, 12, 38);
      g.fillStyle = '#b9b3aa';
      g.fillRect(x * 64 + 8, y * 64 + 54, 48, 4);
    }
  });
}

function roadTexture() {
  return canvasTex(128, 256, (g) => {
    g.fillStyle = '#3d4046';
    g.fillRect(0, 0, 128, 256);
    const r = rng(9);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)';
      g.fillRect(r() * 128, r() * 256, 2, 2);
    }
    g.fillStyle = '#f2c230';
    g.fillRect(61, 0, 2, 256);
    g.fillRect(65, 0, 2, 256);
    g.fillStyle = '#e8e8e8';
    g.fillRect(6, 0, 3, 256);
    g.fillRect(119, 0, 3, 256);
    for (let y = 0; y < 256; y += 64) { g.fillRect(31, y, 3, 32); g.fillRect(94, y, 3, 32); }
  });
}

function signTexture(text, bg, fg) {
  return canvasTex(512, 128, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = fg;
    g.lineWidth = 8;
    g.strokeRect(8, 8, 496, 112);
    g.fillStyle = fg;
    g.font = 'bold 76px "Lilita One", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 68);
  }, false);
}

function padTexture(letter, color) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = 'rgba(0,0,0,0)';
    g.clearRect(0, 0, 256, 256);
    g.strokeStyle = color;
    g.lineWidth = 14;
    g.beginPath(); g.arc(128, 128, 110, 0, Math.PI * 2); g.stroke();
    g.fillStyle = color;
    g.font = 'bold 150px "Lilita One", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 128, 136);
  }, false);
}

const tmpColor = new THREE.Color();

function paint(geo, color, topColor = color) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const c1 = tmpColor.set(color).clone();
  const c2 = new THREE.Color(topColor);
  for (let i = 0; i < pos.count; i++) {
    const c = nrm.getY(i) > 0.5 ? c2 : c1;
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.grid = new Map();
    this.stamp = 0;
    this.buildingGeos = [];
    this.plainGeos = [];
    this.blocks = [];
    this.zones = { banks: [], hideout: null, spray: null, hospital: null, police: null };
    this.vehicleSpawns = [];
    this.pickups = [];
    this.fish = [];
    this.trees = [];
    this.lamps = [];
    this.mapFeatures = [];
    this.r = rng(1234);
    this.build();
  }

  // ---------- colliders ----------
  addCollider(c) {
    c.id = this.colliders.length;
    c.mark = 0;
    this.colliders.push(c);
    const s = 16;
    for (let ix = Math.floor(c.minX / s); ix <= Math.floor(c.maxX / s); ix++) {
      for (let iz = Math.floor(c.minZ / s); iz <= Math.floor(c.maxZ / s); iz++) {
        const k = ix * 10007 + iz;
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(c);
      }
    }
    return c;
  }

  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const s = 16;
    const st = ++this.stamp;
    for (let ix = Math.floor(minX / s); ix <= Math.floor(maxX / s); ix++) {
      for (let iz = Math.floor(minZ / s); iz <= Math.floor(maxZ / s); iz++) {
        const list = this.grid.get(ix * 10007 + iz);
        if (!list) continue;
        for (const c of list) {
          if (c.mark === st) continue;
          c.mark = st;
          out.push(c);
        }
      }
    }
    return out;
  }

  topAt(c, x, z) {
    if (!c.ramp) return c.maxY;
    const { axis, dir } = c.ramp;
    let f = axis === 'x' ? (x - c.minX) / (c.maxX - c.minX) : (z - c.minZ) / (c.maxZ - c.minZ);
    if (dir < 0) f = 1 - f;
    return c.minY + (c.maxY - c.minY) * Math.min(1, Math.max(0, f));
  }

  /** Highest walkable surface under (x, z) that is no more than `step` above y. */
  groundAt(x, z, y, step = 0.6, r = 0.2) {
    let best = 0;
    for (const c of this.query(x - r, z - r, x + r, z + r, this._q1 || (this._q1 = []))) {
      if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) continue;
      const t = this.topAt(c, Math.min(c.maxX, Math.max(c.minX, x)), Math.min(c.maxZ, Math.max(c.minZ, z)));
      if (t <= y + step && t > best) best = t;
    }
    return best;
  }

  /** True if a solid overlaps the vertical span [y0, y1] at (x, z). */
  blockedAt(x, z, y0, y1) {
    for (const c of this.query(x, z, x, z, this._q1 || (this._q1 = []))) {
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (c.minY < y1 && this.topAt(c, x, z) > y0 + 0.02) return true;
    }
    return false;
  }

  /** Lowest ceiling above y at (x,z) (Infinity if open sky). */
  ceilingAt(x, z, y) {
    let best = Infinity;
    for (const c of this.query(x, z, x, z, this._q1 || (this._q1 = []))) {
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (c.minY > y && c.minY < best) best = c.minY;
    }
    return best;
  }

  /**
   * Pushes a vertical cylinder (centre pos.x/pos.z, radius r, from feet to feet+h)
   * out of every solid it overlaps. Returns the deepest contact or null.
   */
  pushOut(pos, r, feet, h, step = 0.6) {
    let hit = null;
    const list = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, this._q2 || (this._q2 = []));
    for (let pass = 0; pass < 2; pass++) {
      for (const c of list) {
        if (c.minY >= feet + h) continue;
        const cx = Math.min(c.maxX, Math.max(c.minX, pos.x));
        const cz = Math.min(c.maxZ, Math.max(c.minZ, pos.z));
        if (this.topAt(c, cx, cz) <= feet + step) continue;
        let dx = pos.x - cx;
        let dz = pos.z - cz;
        let d = Math.hypot(dx, dz);
        let depth;
        if (d > 1e-5) {
          if (d >= r) continue;
          dx /= d; dz /= d;
          depth = r - d;
        } else {
          // centre inside the box: leave by the nearest face
          const opts = [
            [pos.x - c.minX, -1, 0], [c.maxX - pos.x, 1, 0],
            [pos.z - c.minZ, 0, -1], [c.maxZ - pos.z, 0, 1],
          ].sort((a, b) => a[0] - b[0]);
          [depth, dx, dz] = opts[0];
          depth += r;
        }
        pos.x += dx * depth;
        pos.z += dz * depth;
        if (!hit || depth > hit.depth) hit = { nx: dx, nz: dz, depth, c, top: c.ramp ? null : c.maxY };
      }
    }
    return hit;
  }

  /** Ray vs every solid box and the ground plane. dir must be normalised. */
  raycast(o, d, maxDist, ignoreGround = false) {
    let best = maxDist;
    let hit = null;
    const ix = 1 / (d.x || 1e-9), iy = 1 / (d.y || 1e-9), iz = 1 / (d.z || 1e-9);
    const ex = o.x + d.x * maxDist, ez = o.z + d.z * maxDist;
    const list = maxDist < 200
      ? this.query(Math.min(o.x, ex), Math.min(o.z, ez), Math.max(o.x, ex), Math.max(o.z, ez), this._q3 || (this._q3 = []))
      : this.colliders;
    for (const c of list) {
      let t1 = (c.minX - o.x) * ix, t2 = (c.maxX - o.x) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
      let nAxis = 0;
      t1 = (c.minY - o.y) * iy; t2 = (c.maxY - o.y) * iy;
      let a = Math.min(t1, t2), b = Math.max(t1, t2);
      if (a > tmin) { tmin = a; nAxis = 1; }
      tmax = Math.min(tmax, b);
      t1 = (c.minZ - o.z) * iz; t2 = (c.maxZ - o.z) * iz;
      a = Math.min(t1, t2); b = Math.max(t1, t2);
      if (a > tmin) { tmin = a; nAxis = 2; }
      tmax = Math.min(tmax, b);
      if (tmax < Math.max(tmin, 0) || tmin > best || tmin < 0) continue;
      if (c.ramp) {
        const px = o.x + d.x * tmin, pz = o.z + d.z * tmin;
        if (o.y + d.y * tmin > this.topAt(c, px, pz) + 0.05) continue;
      }
      best = tmin;
      const n = new THREE.Vector3();
      if (nAxis === 0) n.x = -Math.sign(d.x); else if (nAxis === 1) n.y = -Math.sign(d.y); else n.z = -Math.sign(d.z);
      hit = { t: tmin, c, normal: n };
    }
    if (!ignoreGround && d.y < 0) {
      const t = -o.y / d.y;
      if (t >= 0 && t < best) { best = t; hit = { t, c: null, normal: new THREE.Vector3(0, 1, 0) }; }
    }
    if (hit) hit.point = new THREE.Vector3().copy(o).addScaledVector(d, hit.t);
    return hit;
  }

  lineClear(a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-3) return true;
    d.divideScalar(len);
    return !this.raycast(a, d, len - 0.3);
  }

  // ---------- geometry helpers ----------
  /** Solid box. (x, z) is the centre, y the bottom. */
  box(x, y, z, w, h, d, color, { collide = true, building = false, top = color, rot = 0 } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (building) {
      const uv = geo.attributes.uv;
      for (let f = 0; f < 6; f++) {
        for (let v = 0; v < 4; v++) {
          const i = f * 4 + v;
          if (f === 2 || f === 3) { uv.setXY(i, 0.01, 0.99); continue; }
          const width = f < 2 ? d : w;
          uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(width / 4)) / 4, uv.getY(i) * Math.max(1, Math.round(h / 4)) / 4);
        }
      }
    }
    paint(geo, color, top);
    if (rot) geo.rotateY(rot);
    geo.translate(x, y + h / 2, z);
    (building ? this.buildingGeos : this.plainGeos).push(geo.toNonIndexed());
    if (collide) {
      const hw = rot ? Math.max(w, d) / 2 : w / 2, hd = rot ? Math.max(w, d) / 2 : d / 2;
      return this.addCollider({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, minY: y, maxY: y + h });
    }
    return null;
  }

  /** Wedge ramp rising toward `dir` ('+x','-x','+z','-z'). (x, z) is the centre. */
  ramp(x, z, w, len, h, dir, color = 0xc9a24a, y = 0) {
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(len, 0), new THREE.Vector2(len, h)]);
    let geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    geo.clearGroups();
    geo.translate(-len / 2, 0, -w / 2);
    const rot = { '+x': 0, '-z': Math.PI / 2, '-x': Math.PI, '+z': -Math.PI / 2 }[dir];
    geo.rotateY(rot);
    if (geo.index) geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    paint(geo, color, 0xe0c27a);
    geo.translate(x, y, z);
    this.plainGeos.push(geo);
    const alongX = dir[1] === 'x';
    const hx = alongX ? len / 2 : w / 2, hz = alongX ? w / 2 : len / 2;
    this.addCollider({
      minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, minY: y, maxY: y + h,
      ramp: { axis: dir[1], dir: dir[0] === '+' ? 1 : -1 },
    });
    this.mapFeatures.push({ type: 'ramp', x, z, w: hx * 2, d: hz * 2 });
  }

  decal(tex, x, z, size, y = 0.07, rotation = 0) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    m.rotation.set(-Math.PI / 2, 0, rotation);
    m.position.set(x, y, z);
    this.scene.add(m);
  }

  sign(text, x, y, z, rotY, w = 8, bg = '#14325a', fg = '#ffd34a') {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg) }));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    this.scene.add(m);
    return m;
  }

  // ---------- city ----------
  build() {
    const scene = this.scene;
    const r = this.r;

    // island, beach and sea
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(BOUND * 2 + 40, BOUND * 2 + 40), new THREE.MeshStandardMaterial({ color: 0xe6d3a0, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = -0.02;
    sand.receiveShadow = true;
    scene.add(sand);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 30, HALF * 2 + 30), new THREE.MeshStandardMaterial({ color: 0x7fb069, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = 0.0;
    grass.receiveShadow = true;
    scene.add(grass);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x2a7fc0, roughness: 0.15, metalness: 0.2 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.4;
    scene.add(sea);

    // roads
    const roadTex = roadTexture();
    const len = HALF * 2 + ROAD;
    for (let k = 0; k <= N; k++) {
      for (const axis of ['x', 'z']) {
        const t = roadTex.clone();
        t.needsUpdate = true;
        t.repeat.set(1, len / 32);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, len), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
        m.rotation.x = -Math.PI / 2;
        if (axis === 'x') { m.rotation.z = Math.PI / 2; m.position.set(0, 0.04, roadLine(k)); } else m.position.set(roadLine(k), 0.05, 0);
        m.receiveShadow = true;
        scene.add(m);
      }
    }
    // intersections: plain asphalt squares so the lane markings don't cross
    const interMat = new THREE.MeshStandardMaterial({ color: 0x3d4046, roughness: 0.9 });
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, ROAD), interMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(roadLine(i), 0.06, roadLine(j));
      m.receiveShadow = true;
      scene.add(m);
    }

    // blocks
    const walkMat = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.95 });
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x0 = roadLine(i) + ROAD / 2, x1 = roadLine(i + 1) - ROAD / 2;
      const z0 = roadLine(j) + ROAD / 2, z1 = roadLine(j + 1) - ROAD / 2;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const type = BLOCK_TYPES[`${i},${j}`] || (Math.max(Math.abs(i - 3), Math.abs(j - 3)) <= 1 ? 'downtown' : Math.max(Math.abs(i - 3), Math.abs(j - 3)) === 2 ? 'city' : 'residential');
      const block = { i, j, x0, x1, z0, z1, cx, cz, type };
      this.blocks.push(block);
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), walkMat);
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(cx, 0.03, cz);
      walk.receiveShadow = true;
      scene.add(walk);
      const inner = { x0: x0 + WALK, x1: x1 - WALK, z0: z0 + WALK, z1: z1 - WALK };
      const fn = this[`block_${type}`];
      if (fn) fn.call(this, block, inner, r); else this.block_buildings(block, inner, r);
      // street lamps on the corners
      for (const [lx, lz] of [[x0 + 1.2, z0 + 1.2], [x1 - 1.2, z0 + 1.2], [x0 + 1.2, z1 - 1.2], [x1 - 1.2, z1 - 1.2]]) this.lamps.push([lx, lz]);
    }

    this.finishMeshes();
  }

  ground(color, b, y = 0.035) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0), new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((b.x0 + b.x1) / 2, y, (b.z0 + b.z1) / 2);
    m.receiveShadow = true;
    this.scene.add(m);
  }

  block_buildings(block, inner, r) {
    const { type } = block;
    const W = inner.x1 - inner.x0, D = inner.z1 - inner.z0;
    const split = type === 'residential' ? 3 : r() < 0.4 ? 1 : 2;
    const lotW = W / split, lotD = D / split;
    const palette = type === 'downtown'
      ? [0xa9c4dc, 0xd7d2c8, 0x8fa3b5, 0xc7b8a0, 0xe0d6c2]
      : type === 'city' ? [0xd9a37a, 0xc98b73, 0xe2c79b, 0xb9c4c9, 0xd6cfc0] : [0xf2d6a8, 0xe9b8a0, 0xbfd8e8, 0xd8e8c0, 0xf0f0e6];
    for (let a = 0; a < split; a++) for (let b = 0; b < split; b++) {
      if (type === 'residential' && a === 1 && b === 1) {
        // inner courtyard with a tree and a crate stack for climbing
        this.tree(inner.x0 + lotW * 1.5, inner.z0 + lotD * 1.5);
        continue;
      }
      const inset = 1 + r() * 2;
      const w = lotW - inset * 2, d = lotD - inset * 2;
      const x = inner.x0 + lotW * (a + 0.5), z = inner.z0 + lotD * (b + 0.5);
      let h = type === 'downtown' ? 24 + r() * 56 : type === 'city' ? 8 + r() * 18 : 4.5 + r() * 4;
      h = Math.round(h / 4) * 4 || 4;
      if (type === 'residential') h = 5 + Math.floor(r() * 2) * 2.5;
      const color = palette[Math.floor(r() * palette.length)];
      const roof = new THREE.Color(color).multiplyScalar(0.55).getHex();
      this.box(x, 0, z, w, h, d, color, { building: true, top: roof });
      this.mapFeatures.push({ type: 'building', x, z, w, d, h });
      if (type === 'downtown' && r() < 0.6) {
        // stepped top
        this.box(x, h, z, w * 0.6, h * 0.3, d * 0.6, color, { building: true, top: roof });
      }
      // roof clutter
      if (h < 30) {
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) this.box(x + (r() - 0.5) * (w - 4), h, z + (r() - 0.5) * (d - 4), 1.6 + r(), 1.2, 1.6 + r(), 0x9aa0a6);
      }
      // stair of crates up the wall so low roofs are reachable on foot
      if (h <= 14 && r() < 0.7) {
        this.climbChain(x, z, w, d, h, r);
        // a fish (collectible) on some of the reachable roofs
        if (r() < 0.4) this.fish.push(new THREE.Vector3(x, h + 1.2, z));
      }
    }
  }

  climbChain(x, z, w, d, h, r) {
    const side = Math.floor(r() * 4);
    const steps = Math.ceil(h / 2.4);
    for (let s = 0; s < steps; s++) {
      const top = Math.min(h, (s + 1) * 2.4);
      const along = (s - steps / 2) * 2.2;
      let px, pz;
      if (side === 0) { px = x - w / 2 - 1.1; pz = z + along; } else if (side === 1) { px = x + w / 2 + 1.1; pz = z - along; } else if (side === 2) { px = x - along; pz = z - d / 2 - 1.1; } else { px = x + along; pz = z + d / 2 + 1.1; }
      this.box(px, 0, pz, 2.2, top, 2.2, s % 2 ? 0x8b6a3e : 0xa57f4a, { top: 0xc49a5c });
    }
  }

  tree(x, z) {
    this.trees.push([x, z]);
    this.addCollider({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4, minY: 0, maxY: 3, tree: true });
  }

  block_park(block, inner, r) {
    this.ground(0x6aa84f, block, 0.035);
    for (let k = 0; k < 18; k++) {
      const x = inner.x0 + 3 + r() * (inner.x1 - inner.x0 - 6), z = inner.z0 + 3 + r() * (inner.z1 - inner.z0 - 6);
      if (Math.abs(x - block.cx) < 12 && Math.abs(z - block.cz) < 12) continue;
      this.tree(x, z);
    }
    // stunt ramps
    this.ramp(block.cx - 8, block.cz, 6, 12, 3, '+x');
    this.ramp(block.cx + 10, block.cz, 6, 8, 2.2, '-x');
    // small pond-ish fountain
    this.box(block.cx, 0, block.cz + 10, 5, 0.8, 5, 0xbfc7cc, { top: 0x4aa3df });
    this.pickups.push({ weapon: 'smg', pos: new THREE.Vector3(block.cx, 1, block.cz - 6) });
  }

  block_plaza(block, inner) {
    this.ground(0x4a4d53, block, 0.036);
    const c = { x: block.cx, z: block.cz };
    // drift circle markings
    const ring = canvasTex(512, 512, (g) => {
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 6;
      g.setLineDash([30, 20]);
      g.beginPath(); g.arc(256, 256, 200, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(256, 256, 90, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      g.font = 'bold 64px "Lilita One", Impact, sans-serif';
      g.fillStyle = 'rgba(255,210,60,0.85)';
      g.textAlign = 'center';
      g.fillText('DRIFT', 256, 278);
    }, false);
    this.decal(ring, c.x, c.z, 56, 0.08);
    this.box(c.x, 0, c.z, 3, 0.6, 3, 0xff7a1a);
    this.ramp(inner.x0 + 6, inner.z0 + 8, 5, 10, 2.4, '+x', 0xdb4b3a);
    this.ramp(inner.x1 - 6, inner.z1 - 8, 5, 10, 2.4, '-x', 0xdb4b3a);
    this.vehicleSpawns.push({ kind: 'car', model: 'sport', x: c.x - 18, z: c.z - 18, yaw: 0.7 });
    this.vehicleSpawns.push({ kind: 'car', model: 'sport', x: c.x + 18, z: c.z - 18, yaw: -0.7, color: 0x2a6cff });
    this.vehicleSpawns.push({ kind: 'moto', x: c.x - 20, z: c.z + 18, yaw: 2.4 });
    this.mapFeatures.push({ type: 'plaza', x: c.x, z: c.z });
  }

  block_parkour(block, inner, r) {
    this.ground(0x8d8f93, block, 0.036);
    const x0 = inner.x0, z0 = inner.z0;
    const colors = [0xd9483b, 0x2f7fd1, 0x38a35a, 0xe5a52e, 0x8b5cc7];
    // shipping containers in staircases
    for (let k = 0; k < 6; k++) {
      const x = x0 + 6 + k * 8, z = z0 + 8;
      const stack = 1 + (k % 4);
      for (let s = 0; s < stack; s++) this.box(x, s * 2.6, z, 6, 2.6, 12, colors[(k + s) % colors.length], { top: 0x777777 });
    }
    // rooftop run: low buildings with gaps
    const hs = [4, 6, 7.5, 9, 10.5, 12];
    for (let k = 0; k < hs.length; k++) {
      const x = x0 + 5 + k * 9, z = z0 + 34;
      this.box(x, 0, z, 6, hs[k], 10, 0xcfc4b0, { building: true, top: 0x7a6f5e });
      this.fish.push(new THREE.Vector3(x, hs[k] + 1, z));
    }
    // scaffolding tower to the top
    for (let s = 0; s < 5; s++) this.box(x0 + 52 - (s % 2) * 2.5, 2.1 + s * 2.4, z0 + 46, 2.2, 0.3, 3, 0x6d7b88);
    this.box(x0 + 52, 0, z0 + 50, 4, 14.5, 4, 0x5b6773, { top: 0xffd34a });
    this.fish.push(new THREE.Vector3(x0 + 52, 15.6, z0 + 50));
    this.box(x0 + 30, 0, z0 + 22, 3, 1.2, 3, 0x8b6a3e);
    this.box(x0 + 33, 0, z0 + 22, 3, 2.4, 3, 0x8b6a3e);
    this.pickups.push({ weapon: 'shotgun', pos: new THREE.Vector3(x0 + 30, 2.6 * 4 + 1, z0 + 8) });
    this.box(x0 + 5, 0, z0 + 27.5, 3, 2, 3, 0x8b6a3e);
    this.mapFeatures.push({ type: 'parkour', x: block.cx, z: block.cz });
  }

  bankBuilding(block, inner) {
    const x = block.cx, z = block.cz + 4;
    const W = 34, D = 26, H = 9, T = 1;
    const marble = 0xeee6d6;
    // walls (front faces -z, with a wide door)
    this.box(x, 0, z + D / 2 - T / 2, W, H, T, marble, { building: false });
    this.box(x - W / 2 + T / 2, 0, z, T, H, D, marble);
    this.box(x + W / 2 - T / 2, 0, z, T, H, D, marble);
    const door = 6;
    const fw = (W - door) / 2;
    this.box(x - W / 2 + fw / 2, 0, z - D / 2 + T / 2, fw, H, T, marble);
    this.box(x + W / 2 - fw / 2, 0, z - D / 2 + T / 2, fw, H, T, marble);
    this.box(x, 4, z - D / 2 + T / 2, door, H - 4, T, marble);
    this.box(x, H, z, W + 2, 1.2, D + 2, 0xd8cfbe, { top: 0x8a8070 });
    this.box(x, H + 1.2, z - 2, W - 6, 2.5, D - 8, 0xeee6d6, { top: 0x9a9080 });
    // columns & steps
    for (let k = -2; k <= 2; k++) {
      if (k === 0) continue;
      this.box(x + k * 6.5, 0, z - D / 2 - 2, 1.4, H, 1.4, 0xf6f0e2);
    }
    this.box(x, 0, z - D / 2 - 2.5, W, 0.3, 4, 0xd5ccbc, { collide: false });
    // interior: counters and vault
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 2, D - 2), new THREE.MeshStandardMaterial({ color: 0xb98a5a, roughness: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, 0.045, z);
    this.scene.add(floor);
    this.box(x - 9, 0, z + 1, 10, 1.2, 1.4, 0x6b4a2b);
    this.box(x + 9, 0, z + 1, 10, 1.2, 1.4, 0x6b4a2b);
    const vault = new THREE.Vector3(x, 0, z + D / 2 - 2.2);
    const vdoor = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.6, 32), new THREE.MeshStandardMaterial({ color: 0x9aa4ae, metalness: 0.85, roughness: 0.3 }));
    vdoor.rotation.x = Math.PI / 2;
    vdoor.position.set(x, 2.8, z + D / 2 - 1.3);
    this.scene.add(vdoor);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 8, 24), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 }));
    wheel.position.set(x, 2.8, z + D / 2 - 1.7);
    this.scene.add(wheel);
    this.sign('БАНК', x, H - 1.5, z - D / 2 - 0.6, Math.PI, 12, '#0f2a4a', '#ffd34a');
    this.zones.banks.push({ pos: vault, door: vdoor, wheel, entrance: new THREE.Vector3(x, 0, z - D / 2 - 5), cooldown: 0, name: block.i === 2 ? 'Central Bank' : 'Ice Bank' });
    this.mapFeatures.push({ type: 'building', x, z, w: W, d: D, h: H, bank: true });
  }

  block_bank(block, inner, r) {
    this.ground(0xcfc8b8, block, 0.036);
    this.bankBuilding(block, inner, r);
    // a couple of side buildings behind
    this.box(inner.x0 + 4, 0, inner.z1 - 4, 8, 14, 8, 0xc7b8a0, { building: true, top: 0x6a6050 });
    this.box(inner.x1 - 4, 0, inner.z1 - 4, 8, 18, 8, 0xa9c4dc, { building: true, top: 0x5a6a7a });
  }

  block_hideout(block, inner, r) {
    this.ground(0x9a9488, block, 0.036);
    const x = block.cx, z = block.cz + 6;
    // garage: three walls, open front facing -z
    this.box(x, 0, z + 9, 20, 6, 1, 0x5a4636);
    this.box(x - 10, 0, z, 1, 6, 18, 0x5a4636);
    this.box(x + 10, 0, z, 1, 6, 18, 0x5a4636);
    this.box(x, 6, z, 22, 0.8, 20, 0x3b2e24, { top: 0x2b221c });
    this.sign('УБЕЖИЩЕ', x, 7.5, z - 10.1, Math.PI, 10, '#2b1c12', '#7cff6a');
    this.zones.hideout = { pos: new THREE.Vector3(x, 0, z), r: 7 };
    this.decal(padTexture('$', 'rgba(124,255,106,0.85)'), x, z, 10, 0.08);
    this.box(inner.x0 + 6, 0, inner.z0 + 6, 10, 8, 10, 0xe9b8a0, { building: true, top: 0x7a5a4a });
    this.climbChain(inner.x0 + 6, inner.z0 + 6, 10, 10, 8, r);
    this.vehicleSpawns.push({ kind: 'car', model: 'muscle', x: x - 4, z: z + 2, yaw: Math.PI, color: 0x1a1a1a });
    this.vehicleSpawns.push({ kind: 'moto', x: x + 5, z: z + 3, yaw: Math.PI, color: 0xd8262a });
    this.pickups.push({ weapon: 'pistol', pos: new THREE.Vector3(x + 2, 1, z - 2) });
    this.spawnPoint = new THREE.Vector3(x, 0, z - 14);
  }

  block_spray(block, inner, r) {
    this.ground(0x9aa0a6, block, 0.036);
    const x = block.cx, z = block.cz;
    this.box(x, 0, z + 7, 14, 6, 1, 0x2f6fb0);
    this.box(x - 7, 0, z, 1, 6, 14, 0x2f6fb0);
    this.box(x + 7, 0, z, 1, 6, 14, 0x2f6fb0);
    this.box(x, 6, z, 16, 0.8, 16, 0x1f4f80);
    this.sign('ПОКРАСКА', x, 7.4, z - 8.1, Math.PI, 10, '#1f4f80', '#ffffff');
    this.zones.spray = { pos: new THREE.Vector3(x, 0, z), r: 5 };
    this.box(inner.x0 + 6, 0, inner.z1 - 6, 10, 10, 10, 0xd9a37a, { building: true, top: 0x6a5040 });
    this.box(inner.x1 - 6, 0, inner.z1 - 6, 10, 7, 10, 0xd6cfc0, { building: true, top: 0x6a6050 });
  }

  block_military(block, inner) {
    this.ground(0x8a8f6a, block, 0.036);
    const { x0, x1, z0, z1 } = inner;
    const fence = 0x4f5a3a;
    const gate = 10;
    this.box((x0 + x1) / 2, 0, z1, x1 - x0, 3, 0.6, fence);
    this.box(x0, 0, (z0 + z1) / 2, 0.6, 3, z1 - z0, fence);
    this.box(x1, 0, (z0 + z1) / 2, 0.6, 3, z1 - z0, fence);
    const fw = (x1 - x0 - gate) / 2;
    this.box(x0 + fw / 2, 0, z0, fw, 3, 0.6, fence);
    this.box(x1 - fw / 2, 0, z0, fw, 3, 0.6, fence);
    this.box(block.cx - 14, 0, z1 - 10, 16, 7, 12, 0x6b7350, { top: 0x4b5338 });
    this.box(block.cx + 14, 0, z1 - 10, 16, 7, 12, 0x6b7350, { top: 0x4b5338 });
    this.sign('АРМИЯ', block.cx, 4.5, z0 - 0.5, Math.PI, 8, '#2f3a22', '#e8e0b0');
    this.box(block.cx - gate / 2 - 1, 0, z0, 0.8, 4, 0.8, 0xffffff, { collide: false });
    this.vehicleSpawns.push({ kind: 'tank', x: block.cx - 8, z: block.cz - 2, yaw: Math.PI });
    this.vehicleSpawns.push({ kind: 'tank', x: block.cx + 8, z: block.cz - 2, yaw: Math.PI });
    this.pickups.push({ weapon: 'rpg', pos: new THREE.Vector3(block.cx, 1, block.cz + 8) });
    this.mapFeatures.push({ type: 'military', x: block.cx, z: block.cz });
  }

  block_heliport(block, inner) {
    this.ground(0x55595f, block, 0.036);
    const tex = padTexture('H', 'rgba(255,255,255,0.9)');
    for (const [dx, dz] of [[-14, -10], [14, -10], [0, 14]]) {
      this.decal(tex, block.cx + dx, block.cz + dz, 16, 0.08);
    }
    this.vehicleSpawns.push({ kind: 'heli', x: block.cx - 14, z: block.cz - 10, yaw: 0.6 });
    this.vehicleSpawns.push({ kind: 'heli', x: block.cx + 14, z: block.cz - 10, yaw: -0.4, color: 0xffcf33 });
    this.box(block.cx, 0, inner.z1 - 4, 20, 6, 6, 0xd7d2c8, { building: true, top: 0x5a5a5a });
    this.mapFeatures.push({ type: 'heliport', x: block.cx, z: block.cz });
  }

  block_hospital(block, inner) {
    this.ground(0xcfd8cf, block, 0.036);
    const x = block.cx, z = block.cz + 8;
    this.box(x, 0, z, 40, 16, 22, 0xf4f4f0, { building: true, top: 0x9aa0a6 });
    this.sign('БОЛЬНИЦА', x, 12, z - 11.1, Math.PI, 12, '#ffffff', '#d8262a');
    this.zones.hospital = new THREE.Vector3(x, 0, z - 18);
    this.pickups.push({ health: true, pos: new THREE.Vector3(x - 6, 1, z - 16) });
    this.mapFeatures.push({ type: 'building', x, z, w: 40, d: 22, h: 16 });
  }

  block_police(block, inner) {
    this.ground(0xb7bcc2, block, 0.036);
    const x = block.cx, z = block.cz + 8;
    this.box(x, 0, z, 34, 12, 20, 0x2c4a7a, { building: true, top: 0x1a2a40 });
    this.sign('ПОЛИЦИЯ', x, 9.5, z - 10.1, Math.PI, 12, '#14325a', '#ffffff');
    this.zones.police = new THREE.Vector3(x, 0, z - 16);
    this.vehicleSpawns.push({ kind: 'car', model: 'police', x: x - 10, z: z - 18, yaw: Math.PI / 2 });
    this.vehicleSpawns.push({ kind: 'car', model: 'police', x: x + 10, z: z - 18, yaw: Math.PI / 2 });
    this.mapFeatures.push({ type: 'building', x, z, w: 34, d: 20, h: 12 });
  }

  finishMeshes() {
    const facade = facadeTexture();
    const bmat = new THREE.MeshStandardMaterial({ map: facade, vertexColors: true, roughness: 0.75 });
    const pmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    for (const [geos, mat] of [[this.buildingGeos, bmat], [this.plainGeos, pmat]]) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    }
    this.buildingGeos = this.plainGeos = null;

    // trees (instanced)
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 8), new THREE.MeshStandardMaterial({ color: 0x7a5233 }), this.trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.2, 1), new THREE.MeshStandardMaterial({ color: 0x3f8f3a, flatShading: true }), this.trees.length);
    const m4 = new THREE.Matrix4();
    this.trees.forEach(([x, z], i) => {
      m4.makeTranslation(x, 1.5, z);
      trunk.setMatrixAt(i, m4);
      const s = 0.8 + ((i * 37) % 10) / 20;
      m4.makeScale(s, s * 1.1, s).setPosition(x, 4, z);
      crown.setMatrixAt(i, m4);
    });
    trunk.castShadow = crown.castShadow = true;
    this.scene.add(trunk, crown);

    // street lamps (decorative)
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), new THREE.MeshStandardMaterial({ color: 0x40464e }), this.lamps.length);
    const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe08a, emissiveIntensity: 0.6 }), this.lamps.length);
    this.lamps.forEach(([x, z], i) => {
      m4.makeTranslation(x, 3, z);
      pole.setMatrixAt(i, m4);
      m4.makeTranslation(x, 6.1, z);
      bulb.setMatrixAt(i, m4);
    });
    this.scene.add(pole, bulb);
  }

  /** Random point on a sidewalk ring of a random block, near `near` if given. */
  sidewalkPoint(near, minD = 0, maxD = Infinity) {
    for (let tries = 0; tries < 30; tries++) {
      const b = this.blocks[Math.floor(Math.random() * this.blocks.length)];
      const side = Math.floor(Math.random() * 4);
      const t = Math.random();
      const x = side < 2 ? b.x0 + 2 + t * (b.x1 - b.x0 - 4) : side === 2 ? b.x0 + 2 : b.x1 - 2;
      const z = side >= 2 ? b.z0 + 2 + t * (b.z1 - b.z0 - 4) : side === 0 ? b.z0 + 2 : b.z1 - 2;
      if (near) {
        const d = Math.hypot(x - near.x, z - near.z);
        if (d < minD || d > maxD) continue;
      }
      return { x, z, block: b };
    }
    return null;
  }

  blockAt(x, z) {
    const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return null;
    return this.blocks[i * N + j];
  }
}
