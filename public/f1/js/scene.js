import * as THREE from 'three';
import { THEMES } from './tracks.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function asphaltTex(lines = true) {
  return canvasTex(256, 512, (g) => {
    g.fillStyle = '#3a3c40';
    g.fillRect(0, 0, 256, 512);
    const r = rng(5);
    for (let i = 0; i < 6000; i++) {
      const v = Math.floor(40 + r() * 40);
      g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
      g.fillRect(r() * 256, r() * 512, 1.5, 1.5);
    }
    // darker racing line in the middle
    const grd = g.createLinearGradient(0, 0, 256, 0);
    grd.addColorStop(0.3, 'rgba(0,0,0,0)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.12)');
    grd.addColorStop(0.7, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 512);
    if (lines) {
      g.fillStyle = '#f2f2f2';
      g.fillRect(3, 0, 6, 512);
      g.fillRect(247, 0, 6, 512);
    }
  });
}

function crowdTex() {
  return canvasTex(256, 64, (g) => {
    const r = rng(11);
    g.fillStyle = '#2a2d33';
    g.fillRect(0, 0, 256, 64);
    const cols = ['#e10600', '#ffffff', '#ffd400', '#1e5bc6', '#ff8000', '#00a19c', '#111'];
    for (let i = 0; i < 900; i++) {
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.fillRect(Math.floor(r() * 128) * 2, Math.floor(r() * 32) * 2, 2, 2);
    }
  });
}

function boardTex(text, bg, fg) {
  const t = canvasTex(512, 128, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = fg;
    g.font = 'italic 900 78px "Titillium Web", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 66);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Ribbon between lateral offsets a and b (left positive) following the centre line. */
function ribbon(T, a, b, { ya = 0, yb = 0, uvScale = 20, colorFn = null, from = 0, to = T.n, close = true, limitInner = false } = {}) {
  const pos = [], uv = [], col = [], idx = [];
  const count = to - from + (close && to - from === T.n ? 1 : 0);
  for (let k = 0; k < count; k++) {
    const i = (from + k) % T.n;
    const p = T.pts[i], nr = T.nrm[i];
    let oa = typeof a === 'function' ? a(i) : a, ob = typeof b === 'function' ? b(i) : b;
    if (limitInner) {
      // keep ribbons from folding over themselves inside tight corners
      const r = Math.abs(T.curv[i]) > 1e-5 ? 0.9 / Math.abs(T.curv[i]) : 1e9;
      if (T.curv[i] > 0) { oa = Math.min(oa, r); ob = Math.min(ob, r); }
      if (T.curv[i] < 0) { oa = Math.max(oa, -r); ob = Math.max(ob, -r); }
    }
    const yA = typeof ya === 'function' ? ya(i) : p.y + ya;
    const yB = typeof yb === 'function' ? yb(i) : p.y + yb;
    pos.push(p.x + nr.x * oa, yA, p.z + nr.z * oa, p.x + nr.x * ob, yB, p.z + nr.z * ob);
    const v = (k * T.step) / uvScale;
    uv.push(0, v, 1, v);
    if (colorFn) { const c = colorFn(i); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
    if (k < count - 1) {
      const q = k * 2;
      idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colorFn) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildSky(scene, theme) {
  const [top, horizon] = theme.sky;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float y = max(vP.y,0.0); gl_FragColor = vec4(mix(horizon, top, pow(y,0.55)),1.0); }',
    }),
  );
  scene.add(sky);
  return sky;
}

export function buildTrackScene(scene, T) {
  const def = T.def;
  const theme = THEMES[def.theme];
  const r = rng(def.id.length * 977 + 13);
  const out = { lights: [], gantryZ: 0 };
  const half = T.half;
  const base = T.minY - 0.3;

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = base;
  ground.receiveShadow = true;
  scene.add(ground);

  // embankments: wide ribbons that slope from the track down to the ground
  const groundMat = new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1 });
  const slopeY = (side) => (i) => T.pts[i].y * 0.15 + base * 0.85 - 0.05;
  for (const side of [1, -1]) {
    const wall = side > 0 ? (i) => T.wallL[i] : (i) => -T.wallR[i];
    const m = new THREE.Mesh(ribbon(T, (i) => wall(i) + side * 0.5, (i) => wall(i) + side * 70, { ya: -0.06, yb: slopeY(side), limitInner: true }), groundMat);
    m.receiveShadow = true;
    scene.add(m);
  }
  // run-off between kerb and wall
  const runMat = new THREE.MeshStandardMaterial({ color: theme.runoff, roughness: 1 });
  for (const side of [1, -1]) {
    const geo = side > 0
      ? ribbon(T, half + 1.4, (i) => T.wallL[i] + 0.6, { ya: -0.03, yb: -0.06, limitInner: true })
      : ribbon(T, (i) => -T.wallR[i] - 0.6, -half - 1.4, { ya: -0.06, yb: -0.03, limitInner: true });
    const m = new THREE.Mesh(geo, runMat);
    m.receiveShadow = true;
    scene.add(m);
  }
  // asphalt
  const asphalt = new THREE.Mesh(ribbon(T, half, -half, { uvScale: 24 }), new THREE.MeshStandardMaterial({ map: asphaltTex(), roughness: 0.92 }));
  asphalt.receiveShadow = true;
  scene.add(asphalt);

  // kerbs on corners
  const red = new THREE.Color(0xd8211c), white = new THREE.Color(0xf4f4f4);
  const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const corner = (i) => Math.abs(T.curv[i]) > 1 / 300;
  let i = 0;
  while (i < T.n) {
    if (!corner(i)) { i++; continue; }
    let j = i;
    while (j < T.n && (corner(j) || corner(Math.min(T.n - 1, j + 4)))) j++;
    const from = Math.max(0, i - 6), to = Math.min(T.n, j + 6);
    const cf = (k) => (Math.floor(k / 2) % 2 ? red : white);
    scene.add(new THREE.Mesh(ribbon(T, half + 1.4, half - 0.2, { ya: 0.06, yb: 0.02, colorFn: cf, from, to, close: false }), kerbMat));
    scene.add(new THREE.Mesh(ribbon(T, -half + 0.2, -half - 1.4, { ya: 0.02, yb: 0.06, colorFn: cf, from, to, close: false }), kerbMat));
    i = j + 1;
  }

  // barriers
  const wallH = def.wall === 'concrete' ? 1.3 : 1.0;
  const wallColor = def.wall === 'concrete' ? (k) => (Math.floor(k / 3) % 2 ? red : white)
    : def.wall === 'tyres' ? (k) => (Math.floor(k / 2) % 2 ? new THREE.Color(0x1a1a1a) : new THREE.Color(0x2b5fd0)) : () => new THREE.Color(0xb8c0c8);
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: def.wall === 'armco' ? 0.6 : 0, side: THREE.DoubleSide });
  for (const side of [1, -1]) {
    const off = side > 0 ? (k) => T.wallL[k] : (k) => -T.wallR[k];
    const pos = [], col = [], idx = [];
    for (let k = 0; k <= T.n; k++) {
      const q = k % T.n;
      const p = T.pts[q], nr = T.nrm[q];
      const o = off(q);
      const x = p.x + nr.x * o, z = p.z + nr.z * o;
      pos.push(x, p.y - 0.4, z, x, p.y + wallH, z);
      const c = wallColor(q);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (k < T.n) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, wallMat);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  // start / finish line (chequered) and grid slots
  const chk = canvasTex(256, 32, (g) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 16, y * 16, 16, 16); }
  });
  const p0 = T.pts[0], t0 = T.tan[0];
  const yaw0 = Math.atan2(t0.x, t0.z);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(T.def.width, 2), new THREE.MeshBasicMaterial({ map: chk }));
  line.rotation.x = -Math.PI / 2;
  const lg = new THREE.Group();
  lg.add(line);
  lg.position.set(p0.x, p0.y + 0.03, p0.z);
  lg.rotation.y = yaw0;
  scene.add(lg);
  const slotMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  for (let g = 0; g < 6; g++) {
    const k = (T.n - Math.round((12 + g * 8) / T.step)) % T.n;
    const p = T.pts[k], t = T.tan[k], nr = T.nrm[k];
    const side = g % 2 ? -1 : 1;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.25), slotMat);
    m.rotation.x = -Math.PI / 2;
    const gg = new THREE.Group();
    gg.add(m);
    gg.position.set(p.x + nr.x * side * 3, p.y + 0.03, p.z + nr.z * side * 3);
    gg.rotation.y = Math.atan2(t.x, t.z);
    scene.add(gg);
  }

  // start gantry with five red lights
  const gantry = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.4 });
  const span = T.def.width + 6;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.2, 0.8), steel);
  beam.position.y = 7;
  gantry.add(beam);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.6, 0.5), steel);
    post.position.set((s * span) / 2, 3.8, 0);
    post.castShadow = true;
    gantry.add(post);
  }
  for (let k = 0; k < 5; k++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff0000, emissiveIntensity: 0 });
    for (const row of [0, 1]) {
      const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16), mat);
      bulb.position.set((k - 2) * 1.0, 6.8 + row * 0.6 - 0.3, -0.42);
      bulb.rotation.y = Math.PI;
      gantry.add(bulb);
    }
    out.lights.push(mat);
  }
  const startBoard = new THREE.Mesh(new THREE.PlaneGeometry(span - 6, 1.1), new THREE.MeshBasicMaterial({ map: boardTex(T.def.name.toUpperCase(), '#111', '#fff'), side: THREE.DoubleSide }));
  startBoard.position.set(0, 8.3, -0.45);
  startBoard.rotation.y = Math.PI; // readable for cars approaching the line
  gantry.add(startBoard);
  gantry.position.set(p0.x, p0.y, p0.z);
  gantry.rotation.y = yaw0;
  scene.add(gantry);

  // grandstands and pit building along the main straight
  const crowd = new THREE.MeshStandardMaterial({ map: crowdTex(), roughness: 1 });
  const standMat = new THREE.MeshStandardMaterial({ color: 0xd0d4da, roughness: 0.8 });
  for (let g = -3; g <= 3; g++) {
    const k = (Math.round((g * 34) / T.step) + T.n) % T.n;
    const p = T.pts[k], t = T.tan[k], nr = T.nrm[k];
    const o = T.wallL[k] + 9;
    const stand = new THREE.Group();
    for (let row = 0; row < 6; row++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 2), row % 2 ? crowd : crowd);
      step.position.set(0, 0.5 + row * 1, row * 2);
      stand.add(step);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(30, 8, 0.6), standMat);
    back.position.set(0, 4, 12);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(31, 0.4, 13), standMat);
    roof.position.set(0, 8.2, 6);
    stand.add(back, roof);
    stand.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    stand.position.set(p.x + nr.x * o, p.y, p.z + nr.z * o);
    stand.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
    scene.add(stand);
    // pit building on the other side
    const pk = T.wallR[k] + 7;
    const pit = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 32), new THREE.MeshStandardMaterial({ color: g % 2 ? 0xe9ecef : 0xdfe3e8, roughness: 0.7 }));
    pit.position.set(p.x - nr.x * pk, p.y + 3, p.z - nr.z * pk);
    pit.rotation.y = Math.atan2(t.x, t.z);
    pit.castShadow = pit.receiveShadow = true;
    scene.add(pit);
  }

  // advertising boards on the outside of corners
  const ads = [['TURBO', '#e10600', '#fff'], ['APEX', '#111', '#ffd400'], ['GRIP', '#1e5bc6', '#fff'], ['PIT LANE', '#00a19c', '#fff'], ['VMAX', '#ff8000', '#111']].map(([t, b, f]) => new THREE.MeshBasicMaterial({ map: boardTex(t, b, f), side: THREE.DoubleSide }));
  for (let k = 0; k < T.n; k += 37) {
    if (Math.abs(T.curv[k]) < 1 / 250) continue;
    const side = T.curv[k] > 0 ? -1 : 1; // outside of the corner
    const o = (side > 0 ? T.wallL[k] : T.wallR[k]) + 1.5;
    const p = T.pts[k], t = T.tan[k], nr = T.nrm[k];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), ads[Math.floor(r() * ads.length)]);
    m.position.set(p.x + nr.x * o * side, p.y + 1.6, p.z + nr.z * o * side);
    m.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
    scene.add(m);
  }

  scatterScenery(scene, T, theme, r);
  return out;
}

function clearOfTrack(T, x, z, margin) {
  for (let i = 0; i < T.n; i += 2) {
    const p = T.pts[i];
    const dx = p.x - x, dz = p.z - z;
    if (dx * dx + dz * dz < margin * margin) return false;
  }
  return true;
}

function scatterScenery(scene, T, theme, r) {
  const items = [];
  const kind = theme.trees;
  for (let tries = 0; tries < 900 && items.length < 380; tries++) {
    const k = Math.floor(r() * T.n);
    const side = r() < 0.5 ? 1 : -1;
    const o = (side > 0 ? T.wallL[k] : T.wallR[k]) + 6 + r() * (kind === 'none' ? 25 : 60);
    const p = T.pts[k], nr = T.nrm[k];
    const scale = 0.7 + r() * 0.8;
    const foot = kind === 'none' ? (10 + scale * 8) * 0.75 : 3;
    const x = p.x + nr.x * (o + foot) * side, z = p.z + nr.z * (o + foot) * side;
    if (!clearOfTrack(T, x, z, T.half + T.def.runoff + 4 + foot)) continue;
    const y = p.y * 0.15 + (T.minY - 0.3) * 0.85 + (p.y - (p.y * 0.15 + (T.minY - 0.3) * 0.85)) * Math.max(0, 1 - (o - (side > 0 ? T.wallL[k] : T.wallR[k])) / 70);
    items.push([x, y, z, scale, r()]);
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  if (kind === 'none') {
    // city blocks
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, items.length);
    const palette = [0xd9c7a8, 0xc9a68a, 0xa9b8c8, 0xe6e2da, 0x8f9aa6, 0xd5b18a];
    items.forEach(([x, y, z, s, v], i) => {
      const h = 8 + v * 30;
      m4.compose(new THREE.Vector3(x, y + h / 2, z), q.setFromEuler(new THREE.Euler(0, v * 3, 0)), new THREE.Vector3(10 + s * 8, h, 10 + s * 8));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return;
  }
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 6);
  const crownGeo = kind === 'pine' ? new THREE.ConeGeometry(2.2, 7, 7) : kind === 'cactus' ? new THREE.CylinderGeometry(0.45, 0.5, 4, 8) : new THREE.IcosahedronGeometry(2.6, 1);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2e }), items.length);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: theme.scenery, flatShading: true }), items.length);
  items.forEach(([x, y, z, s], i) => {
    m4.compose(new THREE.Vector3(x, y + 1.5 * s, z), q.identity(), new THREE.Vector3(s, s, s));
    trunk.setMatrixAt(i, m4);
    const cy = kind === 'pine' ? 5.5 : kind === 'cactus' ? 2 : 4.5;
    m4.compose(new THREE.Vector3(x, y + cy * s, z), q.identity(), new THREE.Vector3(s, s, s));
    crown.setMatrixAt(i, m4);
  });
  trunk.castShadow = crown.castShadow = true;
  if (kind !== 'cactus') scene.add(trunk);
  scene.add(crown);
  if (kind === 'pine') {
    // distant mountains
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f7f74, flatShading: true });
    const c = T.box.getCenter(new THREE.Vector3());
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const h = 150 + r() * 200;
      const m = new THREE.Mesh(new THREE.ConeGeometry(h * 1.2, h, 6), mat);
      m.position.set(c.x + Math.cos(a) * 1600, T.minY + h / 2 - 10, c.z + Math.sin(a) * 1600);
      scene.add(m);
    }
  }
}

/** Flat proving ground: huge asphalt pad with a marked straight and cone gates. */
export function buildPolygon(scene) {
  const tex = canvasTex(512, 512, (g) => {
    g.fillStyle = '#4a4d53';
    g.fillRect(0, 0, 512, 512);
    const r = rng(3);
    for (let i = 0; i < 5000; i++) { const v = 60 + r() * 30; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(r() * 512, r() * 512, 1.5, 1.5); }
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, 512, 512);
  });
  tex.repeat.set(80, 80);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  pad.rotation.x = -Math.PI / 2;
  pad.receiveShadow = true;
  scene.add(pad);
  // the straight: 2 km with distance boards
  const line = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  for (const x of [-8, 8]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 2000), line);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, 1000);
    scene.add(m);
  }
  for (let d = 0; d <= 2000; d += 100) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.6), new THREE.MeshBasicMaterial({ map: boardTex(`${d} м`, '#111', '#ffd400'), side: THREE.DoubleSide }));
    b.position.set(12, 1.8, d);
    b.rotation.y = -Math.PI / 2;
    scene.add(b);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1, 0.15), line);
    post.position.set(12, 0.5, d);
    scene.add(post);
  }
  // cone slalom and a big circle to the side
  const cone = new THREE.ConeGeometry(0.3, 0.7, 10);
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a00 });
  for (let k = 0; k < 12; k++) {
    const m = new THREE.Mesh(cone, coneMat);
    m.position.set(-60, 0.35, 40 + k * 25);
    m.castShadow = true;
    scene.add(m);
  }
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    const m = new THREE.Mesh(cone, coneMat);
    m.position.set(-250 + Math.cos(a) * 80, 0.35, 300 + Math.sin(a) * 80);
    m.castShadow = true;
    scene.add(m);
  }
  // hangars on the horizon
  const hm = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.7 });
  for (let k = 0; k < 6; k++) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(60, 18, 40), hm);
    h.position.set(-400 + k * 160, 9, -300);
    h.castShadow = true;
    scene.add(h);
  }
}
