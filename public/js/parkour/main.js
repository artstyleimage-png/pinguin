import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createEnvironment } from '../environment.js';
import { Penguin } from '../penguin.js';
import { sfx } from '../sfx.js';
import { SKIN_BY_ID } from '../../shared/skins.js';
import { LEVELS } from '../../shared/parkour-levels.js';
import { PHYS, Run, top } from '../../shared/parkour-physics.js';

const $ = (id) => document.getElementById(id);
const STEP = 1 / 120;
const touchUI = matchMedia('(pointer: coarse)').matches;
if (touchUI) document.body.classList.add('touching');

// ------------------------------------------------------------ progress

const SAVE_KEY = 'pp-progress';
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; }
}
const progress = loadProgress();
function saveProgress() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); } catch { /* storage blocked */ }
}
const unlocked = (i) => i === 0 || !!progress[LEVELS[i - 1].id]?.done;
const starCount = (rec) => (rec ? !!rec.done + !!rec.allFish + !!rec.fast : 0);

function equippedSkin() {
  const fromUrl = new URLSearchParams(location.search).get('skin');
  if (fromUrl && SKIN_BY_ID[fromUrl]) return fromUrl;
  try {
    const p = JSON.parse(localStorage.getItem('pb-offline-profile'));
    if (p && SKIN_BY_ID[p.equipped]) return p.equipped;
  } catch { /* ignore */ }
  return 'classic';
}

function fmt(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// ------------------------------------------------------------ renderer & scene

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);
const env = createEnvironment(scene, { shadowSize: 22, bergMin: 95 });
env.sun.shadow.camera.far = 120;
scene.add(env.sun.target);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------ materials

function crackTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e4eef6';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(70,120,160,.75)';
  g.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    let x = 128, y = 128, a = (i / 7) * Math.PI * 2;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      a += Math.sin(i * 7 + k * 3) * 0.6;
      x += Math.cos(a) * 24; y += Math.sin(a) * 24;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function stripeTexture(a, b, n = 8) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect((i * 256) / n, 0, 256 / n + 1, 32);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  for (let x = 0; x < 32; x++) for (let y = 0; y < 6; y++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
    g.fillRect(x * 16, y * 16, 16, 16);
  }
  g.fillStyle = '#ffe03a';
  g.fillRect(120, 14, 272, 68);
  g.fillStyle = '#1b2a55';
  g.font = 'italic 56px "Lilita One", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('ФИНИШ', 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const M = {
  pillar: new THREE.MeshStandardMaterial({ color: 0x8fcbeb, roughness: 0.35, emissive: 0x1d5f8a, emissiveIntensity: 0.12 }),
  snow: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
  ice: new THREE.MeshPhysicalMaterial({ color: 0x9fe6ff, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0x2a8ac0, emissiveIntensity: 0.25 }),
  iceSide: new THREE.MeshPhysicalMaterial({ color: 0x6fc4ec, roughness: 0.1, transparent: true, opacity: 0.85 }),
  crumble: new THREE.MeshStandardMaterial({ map: crackTexture(), roughness: 0.6, transparent: true }),
  springBase: new THREE.MeshStandardMaterial({ color: 0x4a5a72, roughness: 0.5, metalness: 0.4 }),
  spring: new THREE.MeshStandardMaterial({ color: 0xff4f9a, roughness: 0.35, emissive: 0x80104a, emissiveIntensity: 0.35 }),
  mover: new THREE.MeshStandardMaterial({ map: stripeTexture('#ffb534', '#2b2b3a', 10), roughness: 0.5 }),
  pole: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.6, roughness: 0.3 }),
  flagOff: new THREE.MeshStandardMaterial({ color: 0xe23b3b, side: THREE.DoubleSide, roughness: 0.7 }),
  flagOn: new THREE.MeshStandardMaterial({ color: 0x45e05a, side: THREE.DoubleSide, roughness: 0.7, emissive: 0x1a7a20, emissiveIntensity: 0.5 }),
  banner: new THREE.MeshStandardMaterial({ map: checkerTexture(), side: THREE.DoubleSide, roughness: 0.6 }),
  bar: new THREE.MeshStandardMaterial({ map: stripeTexture('#ffffff', '#e23b3b', 12), roughness: 0.4 }),
  hub: new THREE.MeshStandardMaterial({ color: 0x39404d, metalness: 0.6, roughness: 0.35 }),
  fish: new THREE.MeshStandardMaterial({ color: 0xff9a3c, roughness: 0.3, metalness: 0.2, emissive: 0x803000, emissiveIntensity: 0.35 }),
  fishFin: new THREE.MeshStandardMaterial({ color: 0xffc23c, roughness: 0.3, emissive: 0x804000, emissiveIntensity: 0.3 }),
  eye: new THREE.MeshStandardMaterial({ color: 0x111111 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x0a2440, transparent: true, opacity: 0.35, depthWrite: false }),
};

// redraw the finish banner once the display font has loaded
document.fonts?.ready.then(() => { M.banner.map.dispose(); M.banner.map = checkerTexture(); });

function box(w, h, d, mat, r = 0.18) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, h / 2 - 0.01, w / 2 - 0.01, d / 2 - 0.01)), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function platformMesh(b) {
  const g = new THREE.Group();
  const w = b.hx * 2, h = b.hy * 2, d = b.hz * 2;
  if (b.type === 'ice') {
    const body = box(w, h, d, M.iceSide);
    const cap = box(w + 0.08, 0.3, d + 0.08, M.ice, 0.12);
    cap.position.y = h / 2 - 0.15;
    g.add(body, cap);
  } else if (b.type === 'crumble') {
    const m = box(w, h, d, M.crumble.clone(), 0.12);
    g.add(m);
    g.userData.fade = m.material;
  } else if (b.type === 'bounce') {
    g.add(box(w, h, d, M.springBase));
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.42, Math.min(w, d) * 0.46, 0.22, 28), M.spring);
    pad.position.y = h / 2 + 0.02;
    pad.castShadow = pad.receiveShadow = true;
    g.add(pad);
    g.userData.pad = pad;
  } else {
    g.add(box(w, h, d, b.spec.move ? M.mover : M.pillar));
    const cap = box(w + 0.14, 0.32, d + 0.14, M.snow, 0.14);
    cap.position.y = h / 2 - 0.1;
    g.add(cap);
  }
  return g;
}

function fishMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), M.fish);
  body.scale.set(1.25, 0.8, 0.5);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.3, 4), M.fishFin);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -0.48;
  tail.scale.z = 0.3;
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 4), M.fishFin);
  fin.position.set(0, 0.26, 0);
  fin.scale.z = 0.3;
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), M.eye);
    eye.position.set(0.24, 0.06, s * 0.13);
    g.add(eye);
  }
  g.add(body, tail, fin);
  for (const m of [body, tail, fin]) m.castShadow = true;
  return g;
}

function flagMesh() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 10), M.pole);
  pole.position.y = 1.3;
  pole.castShadow = true;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7, 8, 1), M.flagOff);
  cloth.geometry.translate(0.55, 0, 0);
  cloth.position.y = 2.2;
  cloth.castShadow = true;
  g.add(pole, cloth);
  g.userData.cloth = cloth;
  return g;
}

function finishMesh(halfWidth) {
  const g = new THREE.Group();
  const x = Math.min(halfWidth - 0.4, 2.8);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 4, 12), M.pole);
    post.position.set(s * x, 2, 0);
    post.castShadow = true;
    g.add(post);
  }
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(x * 2 + 0.3, 0.75), M.banner);
  banner.position.y = 3.7;
  banner.castShadow = true;
  g.add(banner);
  return g;
}

function hazardMesh(h) {
  const g = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.6, 16), M.hub);
  hub.position.y = -0.15;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(h.r, h.r, h.len * 2, 14), M.bar);
  bar.rotation.z = Math.PI / 2;
  hub.castShadow = bar.castShadow = true;
  g.add(hub, bar);
  return g;
}

// ------------------------------------------------------------ particles

const particles = [];
const partGeo = new THREE.SphereGeometry(1, 8, 6);
function burst(pos, { color = 0xffffff, n = 10, speed = 3, up = 2, size = 0.12, life = 0.6, gravity = 9 } = {}) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(pos);
    m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.6);
    scene.add(m);
    particles.push({ m, v: new THREE.Vector3(Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s), life, max: life, gravity });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.v.y -= p.gravity * dt;
    p.m.position.addScaledVector(p.v, dt);
    p.m.material.opacity = Math.max(0, p.life / p.max);
    if (p.life <= 0) {
      scene.remove(p.m);
      p.m.material.dispose();
      particles.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------ course

let course = null;   // { group, level, items... } for the scene
let run = null;

function buildCourse(level) {
  if (course) {
    scene.remove(course.group);
    course.group.traverse((o) => { if (o.geometry && o.geometry !== partGeo) o.geometry.dispose(); });
  }
  run = new Run(level);
  const group = new THREE.Group();
  const plats = run.world.bodies.map((b) => {
    const m = platformMesh(b);
    group.add(m);
    return { b, m, prevState: b.state };
  });
  const fish = level.fish.map((f, i) => {
    const m = fishMesh();
    m.position.set(...f);
    m.userData.phase = i;
    group.add(m);
    return m;
  });
  const flags = level.checkpoints.map((c) => {
    const m = flagMesh();
    m.position.set(c[0] + 1.3, c[1], c[2] - 0.6);
    group.add(m);
    return m;
  });
  const fin = level.finish;
  const finBody = run.world.bodies.find((b) => Math.abs(b.x - fin[0]) < 0.01 && Math.abs(b.z - fin[2]) < 0.01 && Math.abs(top(b) - fin[1]) < 0.01);
  const finish = finishMesh(finBody ? Math.min(finBody.hx, finBody.hz) : 3);
  finish.position.set(...fin);
  const prev = run.world.bodies[run.world.bodies.indexOf(finBody) - 1];
  if (prev) finish.rotation.y = Math.atan2(prev.x - fin[0], prev.z - fin[2]); // banner faces the approach
  group.add(finish);
  const hazards = run.world.hazards.map((h) => {
    const m = hazardMesh(h);
    m.position.set(h.x, h.y, h.z);
    group.add(m);
    return { h, m };
  });
  scene.add(group);
  course = { group, level, plats, fish, flags, hazards, lastCheckpoint: -1 };
  syncCourse(0);
}

function syncCourse(t) {
  for (const p of course.plats) {
    const { b, m } = p;
    m.position.set(b.x, b.y - b.drop, b.z);
    if (b.type === 'crumble') {
      const shake = b.state === 'shaking' ? 0.06 : 0;
      m.position.x += Math.sin(t * 70) * shake;
      m.position.z += Math.cos(t * 63) * shake;
      m.userData.fade.opacity = b.state === 'gone' ? Math.max(0, 1 - b.drop / 4) : 1;
      m.visible = m.userData.fade.opacity > 0.01;
      if (p.prevState !== 'gone' && b.state === 'gone') {
        sfx.crack();
        burst(new THREE.Vector3(b.x, top(b), b.z), { color: 0xd8ecf8, n: 14, speed: 2.5, up: 1.5, size: 0.16 });
      }
      if (p.prevState === 'idle' && b.state === 'shaking') sfx.crack();
    }
    if (b.type === 'bounce') {
      const pad = m.userData.pad;
      pad.scale.y += (1 - pad.scale.y) * 0.15;
    }
    p.prevState = b.state;
  }
  course.fish.forEach((m, i) => {
    m.visible = !run.fish[i];
    m.rotation.y = t * 2 + m.userData.phase;
    m.position.y = course.level.fish[i][1] + Math.sin(t * 3 + m.userData.phase) * 0.12;
  });
  course.flags.forEach((f, i) => {
    const cloth = f.userData.cloth;
    cloth.material = i <= run.checkpoint ? M.flagOn : M.flagOff;
    cloth.rotation.y = Math.sin(t * 3 + i) * 0.25;
  });
  for (const { h, m } of course.hazards) m.rotation.y = -h.angle;
}

// ------------------------------------------------------------ player

const penguin = new Penguin(equippedSkin());
penguin.root.scale.setScalar(0.62);
penguin.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
scene.add(penguin.root);
let facing = 0;
const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), M.shadow);
blob.rotation.x = -Math.PI / 2;
scene.add(blob);

function groundBelow(p) {
  let best = -Infinity;
  for (const b of run.world.bodies) {
    if (!b.solid) continue;
    const t = top(b);
    if (t <= p.y + 0.05 && Math.abs(p.x - b.x) <= b.hx && Math.abs(p.z - b.z) <= b.hz && t > best) best = t;
  }
  return best;
}

// ------------------------------------------------------------ camera

const cam = { yaw: 0, pitch: 0.38, dist: 7.5, target: new THREE.Vector3(), orbit: 0 };

function snapCamera() {
  const s = run.spawn;
  cam.yaw = s.yaw;
  cam.pitch = 0.38;
  cam.target.set(run.player.x, run.player.y + 1.2, run.player.z);
  facing = s.yaw + Math.PI;
}

function placeCamera(dt, follow = true) {
  if (follow) {
    const p = run.player;
    const k = 1 - Math.exp(-dt * 10);
    cam.target.x += (p.x - cam.target.x) * k;
    cam.target.z += (p.z - cam.target.z) * k;
    cam.target.y += (p.y + 1.2 - cam.target.y) * (1 - Math.exp(-dt * 5));
  }
  const cp = Math.cos(cam.pitch);
  camera.position.set(
    cam.target.x + Math.sin(cam.yaw) * cp * cam.dist,
    cam.target.y + Math.sin(cam.pitch) * cam.dist,
    cam.target.z + Math.cos(cam.yaw) * cp * cam.dist,
  );
  camera.lookAt(cam.target);
  env.sun.position.set(cam.target.x + 18, cam.target.y + 30, cam.target.z + 14);
  env.sun.target.position.copy(cam.target);
}

// ------------------------------------------------------------ input

const keys = new Set();
let jumpQueued = false;
let jumpHeld = false;
const stick = { x: 0, y: 0, id: null };

addEventListener('keydown', (e) => {
  if (e.repeat && e.code === 'Space') { e.preventDefault(); return; }
  keys.add(e.code);
  if (state !== 'play') return;
  if (e.code === 'Space') { jumpQueued = true; jumpHeld = true; e.preventDefault(); }
  if (e.code === 'KeyR') toCheckpoint();
  if (e.code === 'Escape' || e.code === 'KeyP') pause(true);
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Space') jumpHeld = false;
});
addEventListener('blur', () => { keys.clear(); jumpHeld = false; if (state === 'play') pause(true); });

function moveInput() {
  let f = 0, r = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) r += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) r -= 1;
  f += -stick.y; r += stick.x;
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  return { x: fx * f + rx * r, z: fz * f + rz * r };
}

function look(dx, dy, k) {
  cam.yaw -= dx * k;
  cam.pitch = Math.min(1.25, Math.max(-0.15, cam.pitch + dy * k));
}

// mouse: pointer lock when available, otherwise drag to look
let dragging = null;
const locked = () => document.pointerLockElement === canvas;
canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (state !== 'play') return;
  if (e.pointerType === 'mouse' && !locked() && canvas.requestPointerLock) {
    try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* not allowed here */ }
  }
  dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
addEventListener('pointermove', (e) => {
  if (state !== 'play') return;
  if (locked()) { look(e.movementX, e.movementY, 0.0026); return; }
  if (dragging && dragging.id === e.pointerId) {
    look(e.clientX - dragging.x, e.clientY - dragging.y, e.pointerType === 'mouse' ? 0.005 : 0.007);
    dragging.x = e.clientX; dragging.y = e.clientY;
  }
});
addEventListener('pointerup', (e) => { if (dragging && dragging.id === e.pointerId) dragging = null; });
addEventListener('pointercancel', () => { dragging = null; });
canvas.addEventListener('wheel', (e) => { cam.dist = Math.min(13, Math.max(4, cam.dist + e.deltaY * 0.004)); }, { passive: true });
document.addEventListener('pointerlockchange', () => {
  $('lockHint').classList.toggle('hidden', locked() || touchUI || state !== 'play');
  if (!locked() && state === 'play' && wasLocked) pause(true);
  wasLocked = locked();
});
let wasLocked = false;

// touch: virtual stick + jump button
const stickEl = $('stick'), knob = $('stickKnob');
stickEl.addEventListener('pointerdown', (e) => {
  stick.id = e.pointerId;
  stickEl.setPointerCapture(e.pointerId);
  moveStick(e);
});
stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) moveStick(e); });
const endStick = (e) => {
  if (e.pointerId !== stick.id) return;
  stick.id = null; stick.x = stick.y = 0;
  knob.style.transform = '';
};
stickEl.addEventListener('pointerup', endStick);
stickEl.addEventListener('pointercancel', endStick);
function moveStick(e) {
  const r = stickEl.getBoundingClientRect();
  let x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
  let y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  stick.x = x; stick.y = y;
  knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
}
const jumpBtn = $('jumpBtn');
jumpBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); sfx.unlock(); jumpQueued = true; jumpHeld = true; });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) jumpBtn.addEventListener(ev, () => { jumpHeld = false; });

// ------------------------------------------------------------ game flow

let state = 'menu';   // menu | play | pause | done
let levelIndex = 0;
let banner = null;
let hintText = '';

function show(id, on) { $(id).classList.toggle('hidden', !on); }

function showBanner(text, ms = 1300) {
  const el = $('banner');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(banner);
  banner = setTimeout(() => el.classList.remove('show'), ms);
}

function renderMenu() {
  const grid = $('levelGrid');
  grid.innerHTML = '';
  LEVELS.forEach((l, i) => {
    const rec = progress[l.id];
    const open = unlocked(i);
    const card = document.createElement('button');
    card.className = 'level-card';
    card.disabled = !open;
    const stars = starCount(rec);
    card.innerHTML = `
      <span class="num">ТРАССА ${i + 1}</span>
      <b></b><p></p>
      <div class="meta"><span class="stars">${[0, 1, 2].map((k) => `<span class="${k < stars ? 'on' : ''}">★</span>`).join('')}</span>
      <span>${rec?.best ? '⏱ ' + fmt(rec.best) : open ? 'Не пройдена' : ''}</span></div>
      ${open ? '' : '<span class="lock">🔒</span>'}`;
    card.querySelector('b').textContent = l.name;
    card.querySelector('p').textContent = open ? l.sub : 'Пройди предыдущую трассу, чтобы открыть';
    card.onclick = () => { sfx.click(); startLevel(i); };
    grid.appendChild(card);
  });
}

function openMenu() {
  state = 'menu';
  if (document.exitPointerLock && locked()) document.exitPointerLock();
  show('menu', true); show('hud', false); show('pause', false); show('done', false);
  renderMenu();
  if (!course || course.level !== LEVELS[0]) { buildCourse(LEVELS[0]); }
}

function startLevel(i) {
  levelIndex = i;
  buildCourse(LEVELS[i]);
  state = 'play';
  show('menu', false); show('hud', true); show('pause', false); show('done', false);
  show('touch', touchUI);
  $('lockHint').classList.toggle('hidden', touchUI);
  $('levelName').textContent = `${i + 1}. ${LEVELS[i].name}`;
  cam.dist = camera.aspect < 1 ? 10 : 7.5;
  snapCamera();
  placeCamera(0, false);
  showBanner(LEVELS[i].name, 1600);
  updateHud();
}

function toCheckpoint() {
  if (state !== 'play' || run.finished) return;
  run.respawn();
  snapCamera();
}

function pause(on) {
  if (on && state !== 'play') return;
  if (!on && state !== 'pause') return;
  state = on ? 'pause' : 'play';
  keys.clear(); jumpHeld = false;
  show('pause', on);
  if (on && locked()) { wasLocked = false; document.exitPointerLock(); }
  if (!on && !touchUI && canvas.requestPointerLock) {
    try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* ignore */ }
  }
}

function finishLevel() {
  const level = LEVELS[levelIndex];
  const rec = progress[level.id] || {};
  const allFish = run.fishCount === level.fish.length;
  const fast = run.time <= level.par;
  const newBest = !rec.best || run.time < rec.best;
  progress[level.id] = {
    done: true,
    best: newBest ? +run.time.toFixed(2) : rec.best,
    allFish: rec.allFish || allFish,
    fast: rec.fast || fast,
  };
  saveProgress();
  const stars = 1 + allFish + fast;
  $('doneStars').innerHTML = [0, 1, 2].map((k) => `<span class="${k < stars ? 'on' : ''}">★</span>`).join('');
  $('doneTime').textContent = fmt(run.time);
  $('doneBest').textContent = newBest ? 'НОВЫЙ РЕКОРД!' : `рекорд ${fmt(rec.best)}`;
  $('doneFish').textContent = `${run.fishCount}/${level.fish.length}`;
  $('doneDeaths').textContent = run.deaths;
  const notes = [];
  if (!allFish) notes.push('★ собери всех рыбок');
  if (!fast) notes.push(`★ пройди быстрее ${fmt(level.par)}`);
  $('doneNote').textContent = notes.length ? `Ещё звёзды: ${notes.join(' · ')}` : 'Идеально! Все три звезды.';
  const last = levelIndex === LEVELS.length - 1;
  $('nextBtn').textContent = last ? 'К ТРАССАМ' : 'ДАЛЬШЕ';
  state = 'done';
  if (locked()) { wasLocked = false; document.exitPointerLock(); }
  show('done', true);
  show('touch', false);
  show('lockHint', false);
}

$('pauseBtn').onclick = () => { sfx.click(); pause(true); };
$('resumeBtn').onclick = () => { sfx.click(); pause(false); };
$('restartBtn').onclick = () => { sfx.click(); startLevel(levelIndex); };
$('menuBtn').onclick = () => { sfx.click(); openMenu(); };
$('retryBtn').onclick = () => { sfx.click(); startLevel(levelIndex); };
$('doneMenuBtn').onclick = () => { sfx.click(); openMenu(); };
$('nextBtn').onclick = () => {
  sfx.click();
  if (levelIndex < LEVELS.length - 1) startLevel(levelIndex + 1); else openMenu();
};
const muteBtn = $('muteBtn');
muteBtn.textContent = sfx.muted ? '🔇' : '🔊';
muteBtn.onclick = () => { muteBtn.textContent = sfx.toggle() ? '🔇' : '🔊'; };

function updateHud() {
  $('clock').textContent = fmt(run.time);
  $('fishCount').textContent = `${run.fishCount}/${course.level.fish.length}`;
  $('deathCount').textContent = run.deaths;
  // tutorial hints near their spot on the course
  const p = run.player;
  const h = (course.level.hints || []).find((k) => Math.abs(p.z - k.z) < 4);
  let text = h ? h.text : '';
  if (touchUI) text = text.replace(/пробел/i, 'кнопку ⤒').replace(/^кнопку ⤒ — прыжок/, '⤒ — прыжок');
  if (text !== hintText) {
    hintText = text;
    const el = $('hint');
    if (text) el.textContent = text;
    el.classList.toggle('show', !!text);
  }
}

// ------------------------------------------------------------ main loop

const pos = new THREE.Vector3();
function handle(events, before) {
  const p = run.player;
  pos.set(p.x, p.y, p.z);
  for (const e of events) {
    if (e === 'jump') sfx.jump();
    else if (e === 'doublejump') { sfx.doubleJump(); burst(pos, { n: 8, speed: 2, up: -1, size: 0.1, life: 0.4 }); }
    else if (e === 'land') { sfx.land(); burst(pos, { n: 8, speed: 2.5, up: 1, size: 0.1, life: 0.4 }); }
    else if (e === 'bounce') {
      sfx.boing();
      const pad = course.plats.find(({ b }) => b.type === 'bounce' && Math.abs(p.x - b.x) <= b.hx + PHYS.radius && Math.abs(p.z - b.z) <= b.hz + PHYS.radius);
      if (pad) pad.m.userData.pad.scale.y = 0.3;
    } else if (e === 'fish') {
      sfx.fish();
      burst(pos.clone().setY(p.y + 0.8), { color: 0xffb64a, n: 12, speed: 3, up: 2, size: 0.09 });
    } else if (e === 'checkpoint') {
      sfx.checkpoint();
      showBanner('ЧЕКПОИНТ!');
    } else if (e === 'hit') {
      sfx.bump(8);
      penguin.setExpression('dizzy');
      setTimeout(() => penguin.setExpression('normal'), 900);
    } else if (e === 'fall') {
      sfx.splash();
      burst(new THREE.Vector3(before.x, -1, before.z), { color: 0x9fdcff, n: 22, speed: 3.5, up: 6, size: 0.16, life: 0.9, gravity: 14 });
      snapCamera();
    } else if (e === 'finish') {
      sfx.win();
      showBanner('ФИНИШ!', 2000);
      const finishedRun = run;
      setTimeout(() => { if (state === 'play' && run === finishedRun) finishLevel(); }, 1400);
      for (let i = 0; i < 4; i++) {
        burst(pos.clone().setY(p.y + 2), { color: [0xffe03a, 0xff4f9a, 0x45e05a, 0x4aa3ff][i], n: 14, speed: 5, up: 6, size: 0.12, life: 1.6, gravity: 7 });
      }
    }
  }
}

const timer = new THREE.Timer();
let acc = 0;
let clockT = 0;
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(0.05, timer.getDelta());
  clockT += dt;

  if (state === 'play' || (state === 'done' && run)) {
    acc += state === 'play' ? dt : 0;
    while (acc >= STEP) {
      acc -= STEP;
      const before = { x: run.player.x, y: run.player.y, z: run.player.z };
      const input = { ...moveInput(), jumpPressed: jumpQueued, jumpHeld };
      jumpQueued = false;
      const events = run.step(input, STEP);
      if (events.length) handle(events, before);
    }
    const p = run.player;
    const sp = Math.hypot(p.vx, p.vz);
    if (run.finished) facing += dt * 6;
    else if (sp > 0.5) {
      const want = Math.atan2(p.vx, p.vz);
      let d = want - facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      facing += d * Math.min(1, dt * 14);
    }
    penguin.root.position.set(p.x, p.y, p.z);
    penguin.root.rotation.y = facing;
    penguin.update(dt, { speed: p.onGround ? sp * 1.2 : 0, falling: !p.onGround && p.vy < -4 });
    const g = groundBelow(p);
    blob.visible = g > -Infinity && !p.onGround;
    if (blob.visible) {
      blob.position.set(p.x, g + 0.03, p.z);
      blob.scale.setScalar(Math.max(0.35, 1 - (p.y - g) * 0.08));
    }
    if (state === 'play') updateHud();
    placeCamera(dt);
  } else if (state === 'menu' && run) {
    // slow orbit around the first course behind the level select
    cam.orbit += dt * 0.08;
    cam.target.set(0, 3, 8);
    cam.yaw = cam.orbit;
    cam.pitch = 0.42;
    cam.dist = 34;
    run.world.update(dt);
    penguin.root.position.set(run.player.x, run.player.y, run.player.z);
    penguin.root.rotation.y = Math.PI;
    penguin.update(dt, {});
    blob.visible = false;
    placeCamera(dt, false);
  } else if (state === 'pause') {
    placeCamera(0, false);
  }

  if (course) syncCourse(clockT);
  updateParticles(dt);
  env.update(clockT);
  renderer.render(scene, camera);
});

openMenu();
$('loading').classList.add('gone');
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
