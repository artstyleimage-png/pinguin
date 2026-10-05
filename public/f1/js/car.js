import * as THREE from 'three';
import { locate } from './tracks.js';

// Fictional teams. power / grip / drag are multipliers around 1.0.
export const CARS = [
  { id: 'rosso', name: 'Rosso Corsa', main: 0xd40000, second: 0xffd400, accent: 0x111111, power: 1.05, grip: 0.98, drag: 1.02, note: 'Самый мощный мотор' },
  { id: 'argento', name: 'Silver Arrow', main: 0xc8ced6, second: 0x00a19c, accent: 0x111111, power: 1.0, grip: 1.0, drag: 0.97, note: 'Сбалансированная, хорошая аэродинамика' },
  { id: 'toro', name: 'Blue Bull', main: 0x1b2a55, second: 0xe8002d, accent: 0xffc906, power: 0.99, grip: 1.06, drag: 1.03, note: 'Лучшее сцепление в поворотах' },
  { id: 'papaya', name: 'Papaya', main: 0xff8000, second: 0x2a9ad8, accent: 0x111111, power: 1.0, grip: 1.04, drag: 1.0, note: 'Шустрая и послушная' },
  { id: 'verde', name: 'Racing Green', main: 0x006f62, second: 0xcedc00, accent: 0x111111, power: 0.98, grip: 0.99, drag: 0.93, note: 'Максималка на прямых' },
  { id: 'bleu', name: 'Bleu Alpin', main: 0x0b5fd8, second: 0xff87bc, accent: 0xffffff, power: 1.01, grip: 1.01, drag: 0.99, note: 'Ровная во всём' },
];

// Speed (km/h) each gear reaches at the rev limiter.
const GEAR_TOP = [92, 132, 168, 204, 240, 276, 312, 348];
export const REDLINE = 12500;
export const MAXRPM = 13200;
export const IDLE = 4200;

const mats = new Map();
function m(color, o = {}) {
  const k = color + JSON.stringify(o);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.35, ...o }));
  return mats.get(k);
}
const BOX = new THREE.BoxGeometry(1, 1, 1);

function add(g, geo, mat, p, s, rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...p);
  mesh.scale.set(...s);
  mesh.rotation.set(...rot);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

/** Builds an open-wheel race car facing +z, wheels touching y = 0. */
export function buildCarModel(spec, { ghost = false } = {}) {
  const g = new THREE.Group();
  const o = ghost ? { transparent: true, opacity: 0.35, depthWrite: false } : {};
  const main = m(spec.main, o), second = m(spec.second, o), carbon = m(0x16171a, { roughness: 0.5, metalness: 0.2, ...o });
  // floor and plank
  add(g, BOX, carbon, [0, 0.14, -0.2], [1.5, 0.05, 4.4]);
  // monocoque / tub
  add(g, BOX, main, [0, 0.47, 0.35], [0.78, 0.5, 2.6]);
  // nose, tapering down to the front wing
  const nose = new THREE.CylinderGeometry(0.12, 0.3, 1.7, 4, 1);
  nose.rotateX(Math.PI / 2);
  nose.rotateZ(Math.PI / 4);
  add(g, nose, main, [0, 0.36, 2.35], [1, 0.75, 1], [0.12, 0, 0]);
  // front wing: main plane + flap + endplates
  add(g, BOX, carbon, [0, 0.12, 3.05], [1.95, 0.05, 0.55]);
  add(g, BOX, second, [0, 0.2, 2.95], [1.85, 0.04, 0.3], [0.35, 0, 0]);
  for (const s of [-1, 1]) add(g, BOX, second, [s * 0.98, 0.2, 3.0], [0.03, 0.25, 0.7]);
  // sidepods
  for (const s of [-1, 1]) {
    add(g, BOX, main, [s * 0.62, 0.42, -0.1], [0.48, 0.42, 1.7]);
    add(g, BOX, carbon, [s * 0.62, 0.48, 0.78], [0.42, 0.3, 0.06]);
  }
  // engine cover sloping to the rear
  const cover = new THREE.CylinderGeometry(0.1, 0.32, 2.0, 4, 1);
  cover.rotateX(-Math.PI / 2);
  cover.rotateZ(Math.PI / 4);
  add(g, cover, main, [0, 0.72, -1.0], [1, 1.2, 1]);
  add(g, BOX, main, [0, 0.95, -0.15], [0.32, 0.45, 0.5]); // airbox
  add(g, BOX, carbon, [0, 1.05, 0.05], [0.24, 0.2, 0.08]);
  // cockpit, driver helmet and halo
  add(g, BOX, carbon, [0, 0.74, 0.65], [0.5, 0.06, 0.8]);
  add(g, new THREE.SphereGeometry(0.17, 16, 12), m(spec.second, o), [0, 0.83, 0.55], [1, 1, 1.1]);
  add(g, BOX, m(0x111111, { roughness: 0.1, metalness: 0.8, ...o }), [0, 0.86, 0.69], [0.22, 0.06, 0.05]);
  const halo = new THREE.TorusGeometry(0.36, 0.035, 8, 20, Math.PI);
  add(g, halo, carbon, [0, 0.92, 0.6], [1, 1.3, 1], [-Math.PI / 2, 0, 0]);
  add(g, BOX, carbon, [0, 0.86, 1.0], [0.05, 0.16, 0.05]);
  // rear wing
  add(g, BOX, main, [0, 1.0, -2.25], [1.0, 0.05, 0.4]);
  add(g, BOX, second, [0, 1.12, -2.38], [1.0, 0.04, 0.22], [-0.4, 0, 0]);
  for (const s of [-1, 1]) add(g, BOX, main, [s * 0.52, 0.85, -2.3], [0.03, 0.55, 0.65]);
  add(g, BOX, carbon, [0, 0.75, -2.15], [0.06, 0.4, 0.06]);
  add(g, BOX, carbon, [0, 0.3, -2.25], [0.9, 0.12, 0.3]); // diffuser / beam wing
  // team accent stripe
  add(g, BOX, m(spec.accent, o), [0, 0.725, 1.2], [0.5, 0.01, 0.9]);
  // number board on the nose
  add(g, BOX, m(0xffffff, o), [0, 0.49, 1.85], [0.3, 0.01, 0.3]);
  // rain light
  const rainLight = add(g, BOX, m(0x400000, { emissive: 0xff1010, emissiveIntensity: 0.4, ...o }), [0, 0.38, -2.42], [0.12, 0.08, 0.04]);
  // wheels + suspension
  const wheels = [];
  const tyre = m(0x141414, { roughness: 0.85, metalness: 0, ...o });
  const stripe = m(0xffd400, { roughness: 0.6, metalness: 0, ...o });
  const rim = m(0x2a2a2e, { metalness: 0.8, roughness: 0.3, ...o });
  for (const [x, z, w, front] of [[0.86, 1.78, 0.36, true], [-0.86, 1.78, 0.36, true], [0.84, -1.55, 0.44, false], [-0.84, -1.55, 0.44, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const spin = new THREE.Group();
    pivot.add(spin);
    const cyl = new THREE.CylinderGeometry(0.36, 0.36, w, 24);
    cyl.rotateZ(Math.PI / 2);
    add(spin, cyl, tyre, [0, 0, 0], [1, 1, 1]);
    const ring = new THREE.TorusGeometry(0.27, 0.025, 6, 24);
    ring.rotateY(Math.PI / 2);
    add(spin, ring, stripe, [Math.sign(x) * (w / 2 + 0.002), 0, 0], [1, 1, 1]);
    const hub = new THREE.CylinderGeometry(0.2, 0.2, w + 0.01, 6);
    hub.rotateZ(Math.PI / 2);
    add(spin, hub, rim, [0, 0, 0], [1, 1, 1]);
    g.add(pivot);
    wheels.push({ pivot, spin, front });
    // wishbones
    for (const dy of [-0.06, 0.08]) {
      const arm = add(g, BOX, carbon, [x / 2, 0.36 + dy, z], [Math.abs(x) - 0.3, 0.03, 0.05]);
      arm.rotation.z = Math.sign(x) * dy * 0.6;
    }
  }
  if (ghost) g.traverse((c) => { if (c.isMesh) c.castShadow = false; });
  return { group: g, wheels, rainLight };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Grip-limited, no-drift car model: the car always points where it goes; too much steering just understeers. */
export class Car {
  constructor(spec, track) {
    this.spec = spec;
    this.T = track;
    const built = buildCarModel(spec);
    this.mesh = built.group;
    this.wheels = built.wheels;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.v = 0;
    this.gear = 1;
    this.rpm = IDLE;
    this.steer = 0;
    this.shiftCut = 0;
    this.auto = true;
    this.pitch = 0;
    this.onTrack = true;
    this.surface = 'asphalt';
    this.loc = null;
    this.wallHit = 0;
    this.limiter = false;
    this.slope = 0;
  }

  place(x, y, z, yaw) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.v = 0;
    this.gear = 1;
    this.rpm = IDLE;
    this.steer = 0;
    this.loc = this.T ? locate(this.T, x, z) : null;
    this.sync(0);
  }

  gearTop(g = this.gear) { return GEAR_TOP[g - 1] / 3.6; }

  rpmFor(v, g) {
    if (g <= 0) return IDLE + Math.abs(v) * 200;
    return (Math.abs(v) / (GEAR_TOP[g - 1] / 3.6)) * REDLINE;
  }

  /** Returns a message if the shift was refused. */
  shift(dir) {
    if (dir > 0) {
      if (this.gear === -1) { if (Math.abs(this.v) < 1) this.gear = 1; return null; }
      if (this.gear >= GEAR_TOP.length) return null;
      this.gear++;
      this.shiftCut = 0.06;
      return 'up';
    }
    if (this.gear === 1) {
      if (Math.abs(this.v) < 1) { this.gear = -1; return 'rev'; }
      return null;
    }
    if (this.gear === -1) return null;
    if (this.rpmFor(this.v, this.gear - 1) > MAXRPM) return 'overrev';
    this.gear--;
    this.shiftCut = 0.08;
    return 'down';
  }

  power(rpm) {
    // power curve: rises to a plateau near 11 000 rpm, small drop to the redline
    const x = rpm / REDLINE;
    return clamp(0.25 + 1.15 * x - 0.4 * x * x, 0.15, 1);
  }

  update(dt, inp, events) {
    const s = this.spec;
    const T = this.T;
    // surface under the car
    let grip = s.grip, extraDrag = 0;
    let groundY = 0;
    if (T) {
      this.loc = locate(T, this.pos.x, this.pos.z, this.loc ? this.loc.i : -1);
      const L = this.loc;
      groundY = L.y;
      const ad = Math.abs(L.d);
      this.surface = ad < T.half + 0.3 ? 'asphalt' : ad < T.half + 1.5 ? 'kerb' : 'grass';
      if (this.surface === 'kerb') grip *= 0.93;
      if (this.surface === 'grass') { grip *= 0.42; extraDrag = 3 + Math.abs(this.v) * 0.06; }
      this.onTrack = ad < T.half + 2.2;
      const t = T.tan[L.i];
      const along = Math.sin(this.yaw) * t.x + Math.cos(this.yaw) * t.z;
      this.slope = L.slope * along;
    }

    // steering: slower and smaller at speed
    const target = clamp(inp.steer, -1, 1);
    const rate = inp.analog ? 12 : 3.2 + (Math.abs(target) < Math.abs(this.steer) || Math.sign(target) !== Math.sign(this.steer) ? 3 : 0);
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    const v = this.v;
    const av = Math.abs(v);

    // automatic gearbox
    if (this.auto && this.gear > 0) {
      const rpm = this.rpmFor(v, this.gear);
      if (rpm > REDLINE * 0.97 && this.gear < GEAR_TOP.length && inp.throttle > 0.2) { this.gear++; this.shiftCut = 0.05; events.push('up'); }
      else if (this.gear > 1 && this.rpmFor(v, this.gear - 1) < REDLINE * 0.78 && (rpm < REDLINE * 0.55 || inp.brake > 0.3)) { this.gear--; events.push('down'); }
    }
    // reverse: hold brake at a standstill; go forward again with throttle
    if (av < 0.4) {
      if (inp.brake > 0.5 && inp.throttle < 0.1 && this.gear > 0) {
        this.holdT = (this.holdT || 0) + dt;
        if (this.holdT > 0.45) { this.gear = -1; events.push('rev'); this.holdT = 0; }
      } else this.holdT = 0;
      if (this.gear === -1 && inp.throttle > 0.1) { this.gear = 1; events.push('up'); }
    }

    let a = 0;
    this.shiftCut -= dt;
    const rev = this.gear === -1;
    const drive = rev ? inp.brake : inp.throttle;
    const brake = rev ? inp.throttle : inp.brake;
    let rpm = this.rpmFor(v, this.gear);
    this.limiter = false;
    if (rev) {
      if (v > -6) a -= drive * 7;
      rpm = IDLE + av * 400 + drive * 2500;
    } else {
      const clutch = rpm < IDLE; // launching: clutch slips
      rpm = Math.max(rpm, IDLE + (clutch ? drive * 5000 : 0));
      if (rpm >= REDLINE) { this.limiter = true; rpm = REDLINE + Math.random() * 120; }
      if (this.shiftCut <= 0 && !this.limiter && drive > 0) {
        const P = 760000 * s.power * this.power(rpm) * 0.78; // W at the wheels
        let force = (P / Math.max(av, 4)) / 798;
        const traction = grip * (13 + 0.0042 * v * v);
        force = Math.min(force, traction);
        a += force * drive;
      }
      if (drive < 0.05 && this.gear > 0 && av > 0.5) a -= (0.6 + (rpm / REDLINE) * 1.4) * Math.sign(v); // engine braking
    }
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 18);
    // brakes
    if (brake > 0 && av > 0.05) {
      const dec = brake * (12 + 0.0045 * v * v) * Math.min(1, grip * 1.05);
      a -= Math.sign(v) * Math.min(dec, av / dt);
    }
    // drag, rolling, slope, run-off
    a -= Math.sign(v) * (0.00082 * s.drag * v * v + 0.4 + extraDrag);
    a -= 9.81 * Math.sin(Math.atan(this.slope));

    // cornering: yaw rate wanted by the wheels vs. what the tyres can hold
    const maxDelta = 0.34 / (1 + av / 22);
    const delta = this.steer * maxDelta;
    let yawRate = (v * Math.tan(delta)) / 3.6;
    const latMax = grip * (14 + 0.0046 * v * v);
    const need = Math.abs(yawRate * v);
    if (need > latMax && av > 1) {
      const capped = latMax / av;
      a -= Math.sign(v) * Math.min(12, (need - latMax) * 0.18); // scrubbing speed while understeering
      yawRate = Math.sign(yawRate) * capped;
      this.understeer = Math.min(1, (need - latMax) / latMax);
    } else this.understeer = 0;
    this.latG = Math.min(need, latMax) / 9.81;
    this.lonG = a / 9.81;

    const nv = v + a * dt;
    this.v = Math.sign(v) !== Math.sign(nv) && v !== 0 && !(drive > 0) ? 0 : nv;
    this.yaw += yawRate * dt;
    this.pos.x += Math.sin(this.yaw) * this.v * dt;
    this.pos.z += Math.cos(this.yaw) * this.v * dt;

    // walls
    if (T) {
      const L = locate(T, this.pos.x, this.pos.z, this.loc.i);
      const limL = T.wallL[L.i] - 1.05, limR = -(T.wallR[L.i] - 1.05);
      if (L.d > limL || L.d < limR) {
        const nr = T.nrm[L.i], t = T.tan[L.i];
        const over = L.d > limL ? L.d - limL : L.d - limR;
        this.pos.x -= nr.x * over;
        this.pos.z -= nr.z * over;
        const trackYaw = Math.atan2(t.x, t.z);
        const dir = Math.cos(this.yaw - trackYaw) >= 0 ? trackYaw : trackYaw + Math.PI;
        const angle = Math.abs(wrap(this.yaw - dir));
        const impact = Math.abs(this.v) * Math.sin(angle);
        this.yaw = dir + clamp(wrap(this.yaw - dir), -0.05, 0.05) - Math.sign(L.d) * 0.03 * Math.sign(this.v || 1);
        this.v *= Math.max(0.25, 1 - Math.sin(angle) * 1.4) * 0.97;
        if (impact > 2) events.push({ wall: impact });
      }
      this.loc = L;
      groundY = L.y;
    } else {
      const B = 1900;
      if (Math.abs(this.pos.x) > B || Math.abs(this.pos.z) > B) {
        this.pos.x = clamp(this.pos.x, -B, B);
        this.pos.z = clamp(this.pos.z, -B, B);
        this.v *= 0.5;
        events.push({ wall: 5 });
      }
    }
    this.pos.y += (groundY - this.pos.y) * Math.min(1, dt * 20);
    this.sync(dt);
  }

  sync(dt) {
    const T = this.T;
    let pitch = 0;
    if (T && this.loc) pitch = -Math.atan(this.slope);
    this.pitch += (pitch - this.pitch) * Math.min(1, dt * 8 || 1);
    const squat = clamp(-(this.lonG || 0) * 0.006, -0.02, 0.02);
    const roll = clamp((this.latG || 0) * 0.004 * -Math.sign(this.steer), -0.02, 0.02);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.pitch + squat, this.yaw, roll, 'YXZ');
    for (const w of this.wheels) {
      w.spin.rotation.x += (this.v * dt) / 0.36;
      if (w.front) w.pivot.rotation.y = this.steer * 0.3;
    }
  }
}
