import * as THREE from 'three';
import { N, LANE, roadLine, BOUND, HALF as HALF_W } from './world.js';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, ...opts }));
  return matCache.get(key);
}
const WRECK = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 1 });
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const SPH = new THREE.SphereGeometry(1, 20, 14);

function part(parent, geo, material, pos, scale, rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.set(...rot);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export const SPECS = {
  car: { r: 1.05, offs: 1.25, mass: 1200, accel: 15, max: 36, rev: 10, grip: 7, drift: 1.3, steer: 2.1, hp: 100, h: 1.5, half: [1, 0.8, 2.25], enter: 3.2 },
  sport: { r: 1.05, offs: 1.25, mass: 1100, accel: 21, max: 50, rev: 11, grip: 6.5, drift: 1.05, steer: 2.3, hp: 90, h: 1.3, half: [1, 0.7, 2.25], enter: 3.2 },
  muscle: { r: 1.05, offs: 1.3, mass: 1400, accel: 19, max: 46, rev: 11, grip: 5.2, drift: 0.9, steer: 2.1, hp: 120, h: 1.4, half: [1, 0.75, 2.35], enter: 3.2 },
  police: { r: 1.05, offs: 1.25, mass: 1300, accel: 19, max: 46, rev: 11, grip: 7, drift: 1.2, steer: 2.2, hp: 130, h: 1.5, half: [1, 0.8, 2.25], enter: 3.2 },
  moto: { r: 0.55, offs: 0.6, mass: 260, accel: 24, max: 52, rev: 6, grip: 9, drift: 1.6, steer: 2.6, hp: 60, h: 1.4, half: [0.4, 0.7, 1.1], enter: 2.4 },
  tank: { r: 1.8, offs: 1.4, mass: 9000, accel: 9, max: 15, rev: 8, grip: 14, drift: 10, steer: 1.3, hp: 700, h: 2.4, half: [1.9, 1.2, 3.2], enter: 4.5 },
  heli: { r: 2.2, offs: 0, mass: 2500, hp: 220, h: 3, half: [1.5, 1.4, 3.5], enter: 4.5 },
};

const CAR_COLORS = [0xd8262a, 0x2a6cff, 0xf3c41c, 0xf2f2f2, 0x35c995, 0x1a1a1a, 0xf06aa8, 0xff7a1a, 0x7a4cc0, 0x8a9bb0];

function buildCar(model, color) {
  const g = new THREE.Group();
  const low = model === 'sport' ? 0.85 : 1;
  const police = model === 'police';
  const bodyMat = mat(police ? 0x16181d : color, { metalness: 0.5, roughness: 0.3 });
  const glass = mat(0x1b2a3a, { metalness: 0.6, roughness: 0.1 });
  part(g, BOX, bodyMat, [0, 0.72 * low, 0], [2, 0.7 * low, 4.4]);
  part(g, BOX, glass, [0, 1.3 * low, -0.25], [1.72, 0.6 * low, 2.1]);
  part(g, BOX, police ? mat(0xf4f4f4) : bodyMat, [0, 1.62 * low, -0.3], [1.76, 0.08, 1.9]);
  if (police) {
    part(g, BOX, mat(0xf4f4f4), [0, 0.8, 0], [2.02, 0.4, 2.2]);
    const red = part(g, BOX, mat(0xff2020, { emissive: 0xff0000, emissiveIntensity: 0 }), [0.35, 1.75, -0.3], [0.6, 0.18, 0.35]);
    const blue = part(g, BOX, mat(0x2050ff, { emissive: 0x0040ff, emissiveIntensity: 0 }), [-0.35, 1.75, -0.3], [0.6, 0.18, 0.35]);
    red.material = red.material.clone();
    blue.material = blue.material.clone();
    g.userData.lightbar = [red, blue];
  }
  if (model === 'sport') part(g, BOX, bodyMat, [0, 1.15, -2.05], [1.9, 0.08, 0.45]);
  if (model === 'muscle') {
    part(g, BOX, mat(0xf2f2f2), [0.25, 1.08, 1.2], [0.25, 0.02, 2]);
    part(g, BOX, mat(0xf2f2f2), [-0.25, 1.08, 1.2], [0.25, 0.02, 2]);
    part(g, BOX, mat(0x222222), [0, 1.15, 1.2], [0.6, 0.18, 0.8]);
  }
  const head = mat(0xfff6d0, { emissive: 0xfff2b0, emissiveIntensity: 0.6 });
  const tail = mat(0xff3030, { emissive: 0xff1010, emissiveIntensity: 0.5 });
  for (const s of [-1, 1]) {
    part(g, BOX, head, [s * 0.7, 0.8 * low, 2.2], [0.4, 0.18, 0.05]);
    part(g, BOX, tail, [s * 0.7, 0.85 * low, -2.2], [0.4, 0.15, 0.05]);
  }
  const wheels = [];
  const tyre = mat(0x161616, { roughness: 0.9, metalness: 0 });
  const rim = mat(0xbfc5cc, { metalness: 0.8 });
  for (const [x, z] of [[1, 1.35], [-1, 1.35], [1, -1.35], [-1, -1.35]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x * 0.92, 0.4, z);
    const spin = new THREE.Group();
    pivot.add(spin);
    part(spin, CYL, tyre, [0, 0, 0], [0.4, 0.32, 0.4], [0, 0, Math.PI / 2]);
    part(spin, BOX, rim, [x * 0.12, 0, 0], [0.1, 0.5, 0.12]);
    g.add(pivot);
    wheels.push({ pivot, spin, front: z > 0, x: x * 0.92, z });
  }
  return { group: g, wheels };
}

function buildMoto(color) {
  const g = new THREE.Group();
  const body = mat(color, { metalness: 0.5, roughness: 0.3 });
  const dark = mat(0x222222);
  part(g, BOX, dark, [0, 0.6, 0], [0.25, 0.3, 1.5]);
  part(g, BOX, body, [0, 0.85, 0.3], [0.45, 0.35, 0.8]);
  part(g, BOX, mat(0x111111), [0, 0.92, -0.35], [0.38, 0.12, 0.8]);
  part(g, BOX, body, [0, 0.95, 0.85], [0.5, 0.3, 0.2], [-0.4, 0, 0]);
  part(g, CYL, mat(0xbfc5cc, { metalness: 0.9 }), [0, 1.15, 0.72], [0.04, 0.9, 0.04], [0, 0, Math.PI / 2]);
  part(g, BOX, mat(0xfff6d0, { emissive: 0xfff2b0, emissiveIntensity: 0.8 }), [0, 0.95, 0.98], [0.2, 0.15, 0.05]);
  const wheels = [];
  for (const z of [0.75, -0.7]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.36, z);
    const spin = new THREE.Group();
    pivot.add(spin);
    part(spin, CYL, mat(0x161616, { roughness: 0.9 }), [0, 0, 0], [0.36, 0.16, 0.36], [0, 0, Math.PI / 2]);
    part(spin, BOX, mat(0xbfc5cc, { metalness: 0.8 }), [0, 0, 0], [0.18, 0.5, 0.1]);
    g.add(pivot);
    wheels.push({ pivot, spin, front: z > 0, x: 0, z });
  }
  return { group: g, wheels };
}

function buildTank() {
  const g = new THREE.Group();
  const olive = mat(0x5b6b3a, { roughness: 0.8, metalness: 0.2 });
  const dark = mat(0x2b2b26, { roughness: 0.9 });
  part(g, BOX, olive, [0, 1.1, 0], [3.0, 1.0, 6.0]);
  part(g, BOX, olive, [0, 1.1, 3.1], [3.0, 0.6, 0.6], [0.5, 0, 0]);
  const wheels = [];
  for (const s of [-1, 1]) {
    part(g, BOX, dark, [s * 1.6, 0.55, 0], [0.8, 1.1, 6.4]);
    for (let k = -2; k <= 2; k++) {
      const spin = new THREE.Group();
      spin.position.set(s * 1.6, 0.45, k * 1.3);
      part(spin, CYL, mat(0x3a3a33), [0, 0, 0], [0.42, 0.85, 0.42], [0, 0, Math.PI / 2]);
      g.add(spin);
      wheels.push({ pivot: spin, spin, front: false, x: s * 1.6, z: k * 1.3, track: true });
    }
  }
  const turret = new THREE.Group();
  turret.position.set(0, 1.6, -0.3);
  part(turret, BOX, olive, [0, 0.45, 0], [2.3, 0.85, 2.8]);
  part(turret, CYL, olive, [0.6, 1.0, -0.6], [0.3, 0.3, 0.3]);
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.5, 1.3);
  part(barrel, CYL, dark, [0, 0, 1.9], [0.16, 3.8, 0.16], [Math.PI / 2, 0, 0]);
  part(barrel, CYL, dark, [0, 0, 3.7], [0.24, 0.5, 0.24], [Math.PI / 2, 0, 0]);
  turret.add(barrel);
  g.add(turret);
  g.userData.turret = turret;
  g.userData.barrel = barrel;
  return { group: g, wheels };
}

function buildHeli(color) {
  const g = new THREE.Group();
  const body = mat(color, { metalness: 0.4, roughness: 0.35 });
  const dark = mat(0x2a2d33);
  part(g, SPH, body, [0, 1.7, 0.2], [1.4, 1.25, 2.3]);
  part(g, SPH, mat(0x1b2a3a, { metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.85 }), [0, 1.9, 1.2], [1.1, 0.9, 1.3]);
  part(g, CYL, body, [0, 2.0, -3.2], [0.28, 4.5, 0.28], [Math.PI / 2 - 0.08, 0, 0]);
  part(g, BOX, body, [0, 2.7, -5.3], [0.12, 1.4, 0.9]);
  part(g, BOX, body, [0, 2.2, -5.0], [1.8, 0.1, 0.6]);
  for (const s of [-1, 1]) {
    part(g, BOX, dark, [s * 1.05, 0.08, 0.2], [0.12, 0.12, 3.6]);
    part(g, BOX, dark, [s * 0.9, 0.45, 0.9], [0.08, 0.7, 0.08], [0, 0, s * 0.3]);
    part(g, BOX, dark, [s * 0.9, 0.45, -0.6], [0.08, 0.7, 0.08], [0, 0, s * 0.3]);
  }
  part(g, CYL, dark, [0, 3.05, 0.2], [0.18, 0.5, 0.18]);
  const rotor = new THREE.Group();
  rotor.position.set(0, 3.3, 0.2);
  part(rotor, BOX, dark, [0, 0, 0], [11, 0.06, 0.4]);
  part(rotor, BOX, dark, [0, 0, 0], [0.4, 0.06, 11]);
  g.add(rotor);
  const tail = new THREE.Group();
  tail.position.set(0.2, 2.7, -5.4);
  part(tail, BOX, dark, [0, 0, 0], [0.05, 1.8, 0.2]);
  g.add(tail);
  g.userData.rotor = rotor;
  g.userData.tailRotor = tail;
  return { group: g, wheels: [] };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Vehicle {
  constructor(kind, { model = kind, color, x = 0, z = 0, yaw = 0, y = 0 } = {}) {
    this.kind = kind;
    this.model = kind === 'car' ? model : kind;
    this.spec = SPECS[this.model] || SPECS.car;
    this.color = color ?? CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    const built = kind === 'moto' ? buildMoto(this.color)
      : kind === 'tank' ? buildTank()
        : kind === 'heli' ? buildHeli(color ?? 0x2f6fd1)
          : buildCar(this.model, this.color);
    this.group = built.group;
    this.wheels = built.wheels;
    this.mesh = new THREE.Group();
    this.mesh.add(this.group);
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = yaw;
    this.yawRate = 0;
    this.pitch = 0;
    this.roll = 0;
    this.hp = this.spec.hp;
    this.onGround = true;
    this.driver = null;
    this.occupant = null;
    this.input = { throttle: 0, steer: 0, handbrake: false, boost: false, up: 0 };
    this.steerVis = 0;
    this.rotor = 0;
    this.burning = 0;
    this.dead = false;
    this.deadTime = 0;
    this.skidPts = [];
    this.slip = 0;
    this.nitro = 1;
    this.turretYaw = 0;
    this.turretTarget = yaw;
    this.barrelPitch = 0;
    this.barrelTarget = 0;
    this.fireCd = 0;
    this.ai = null;
    this.lastHit = null;
    this.id = Vehicle.nextId++;
    this.syncMesh(0);
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get vF() { return this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw); }
  get vS() { return this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw); }

  circles() {
    const f = this.spec.offs;
    const sx = Math.sin(this.yaw) * f, sz = Math.cos(this.yaw) * f;
    if (!f) return [[this.pos.x, this.pos.z]];
    return [[this.pos.x + sx, this.pos.z + sz], [this.pos.x - sx, this.pos.z - sz]];
  }

  damage(amount, game, by = null) {
    if (this.dead) return;
    this.hp -= amount;
    if (by) this.lastHit = by;
    if (this.hp <= 0 && !this.burning) {
      this.burning = this.kind === 'heli' ? 6 : 3.5;
    }
  }

  update(dt, world, game) {
    if (this.dead) {
      this.deadTime += dt;
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 2));
      if (this.kind === 'heli' && this.pos.y > 0) {
        this.pos.y = Math.max(world.groundAt(this.pos.x, this.pos.z, this.pos.y), this.pos.y - 15 * dt);
      }
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      if (Math.random() < dt * 6) game.fx.fire(new THREE.Vector3(this.pos.x, this.pos.y + 1, this.pos.z));
      this.syncMesh(dt);
      return;
    }
    if (this.burning > 0) {
      this.burning -= dt;
      game.fx.fire(new THREE.Vector3(this.pos.x, this.pos.y + 1.2, this.pos.z + 0));
      if (this.burning <= 0) this.explode(game);
    } else if (this.hp < this.spec.hp * 0.35 && Math.random() < dt * 8) {
      game.fx.smoke.emit(this.pos.x, this.pos.y + 1.3, this.pos.z, { vy: 2, life: 1.5, size: 0.8, grow: 1.5, color: 0x555555, alpha: 0.5 });
    }
    if (this.kind === 'heli') this.updateHeli(dt, world, game);
    else this.updateGround(dt, world, game);
    this.fireCd -= dt;
    this.pos.x = clamp(this.pos.x, -BOUND + 2, BOUND - 2);
    this.pos.z = clamp(this.pos.z, -BOUND + 2, BOUND - 2);
    this.syncMesh(dt);
  }

  explode(game) {
    this.dead = true;
    this.burning = 0;
    this.hp = 0;
    this.group.traverse((m) => { if (m.isMesh) m.material = WRECK; });
    this.vel.y = 0;
    game.explode(this.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 8, 110, this.lastHit, this);
    this.vel.x += (Math.random() - 0.5) * 4;
    this.vel.z += (Math.random() - 0.5) * 4;
    this.pitch = (Math.random() - 0.5) * 0.3;
    this.roll = (Math.random() - 0.5) * 0.5;
    if (this.kind !== 'heli') this.pos.y += 0;
  }

  updateGround(dt, world, game) {
    const s = this.spec;
    const inp = this.burning > 0 && this.driver !== 'player' ? { throttle: 0, steer: 0, handbrake: true } : this.input;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const sx = Math.cos(this.yaw), sz = -Math.sin(this.yaw);
    let vF = this.vel.x * fx + this.vel.z * fz;
    let vS = this.vel.x * sx + this.vel.z * sz;
    const tank = this.kind === 'tank';
    if (this.onGround) {
      const boosting = inp.boost && this.nitro > 0 && !tank;
      if (boosting) this.nitro = Math.max(0, this.nitro - dt * 0.25); else this.nitro = Math.min(1, this.nitro + dt * 0.06);
      const top = s.max * (boosting ? 1.35 : 1);
      const acc = s.accel * (boosting ? 1.8 : 1);
      if (inp.throttle > 0) {
        if (vF < -0.5) vF = Math.min(0, vF + 28 * dt * inp.throttle);
        else vF += acc * inp.throttle * dt * Math.max(0, 1 - (vF / top) ** 2);
      } else if (inp.throttle < 0) {
        if (vF > 0.5) vF = Math.max(0, vF + 28 * dt * inp.throttle);
        else vF = Math.max(-s.rev, vF + acc * 0.6 * inp.throttle * dt);
      } else {
        vF -= Math.sign(vF) * Math.min(Math.abs(vF), (1.5 + Math.abs(vF) * 0.15) * dt);
      }
      if (inp.handbrake) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 5 * dt);
      const grip = inp.handbrake ? s.drift : s.grip * (Math.abs(vS) > 6 && inp.throttle > 0 && !tank ? 0.35 : 1);
      vS *= Math.exp(-grip * dt);
      const speedK = tank ? 1 : clamp(Math.abs(vF) / 6, 0, 1) * (1 - 0.4 * clamp(Math.abs(vF) / s.max, 0, 1));
      let target = inp.steer * s.steer * speedK * (vF < -0.5 && !tank ? -1 : 1);
      if (tank && vF < -0.5) target = -target;
      if (inp.handbrake && !tank) target *= 1.6;
      this.yawRate += (target - this.yawRate) * Math.min(1, dt * (inp.handbrake ? 5 : 8));
    } else {
      this.yawRate *= Math.max(0, 1 - dt * 1.5);
      vF *= 1 - dt * 0.05;
    }
    this.yaw += this.yawRate * dt;
    this.slip = Math.abs(vF) > 3 ? Math.atan2(Math.abs(vS), Math.abs(vF)) : 0;
    // velocity stays in the old frame; the body rotates under it, which is what creates slip
    this.vel.x = fx * vF + sx * vS;
    this.vel.z = fz * vF + sz * vS;
    const nfx = Math.sin(this.yaw), nfz = Math.cos(this.yaw);
    const nsx = Math.cos(this.yaw), nsz = -Math.sin(this.yaw);

    const prevY = this.pos.y;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // walls
    for (const off of s.offs ? [s.offs, -s.offs] : [0]) {
      const c = { x: this.pos.x + nfx * off, z: this.pos.z + nfz * off };
      const ox = c.x, oz = c.z;
      const hit = world.pushOut(c, s.r, this.pos.y, s.h, 0.7);
      if (!hit) continue;
      this.pos.x += c.x - ox;
      this.pos.z += c.z - oz;
      const vn = this.vel.x * hit.nx + this.vel.z * hit.nz;
      if (vn < 0) {
        this.vel.x -= hit.nx * vn * 1.3;
        this.vel.z -= hit.nz * vn * 1.3;
        this.yawRate *= 0.5;
        if (-vn > 5) game.onCrash(this, -vn, new THREE.Vector3(c.x - hit.nx * s.r, this.pos.y + 0.8, c.z - hit.nz * s.r));
      }
    }

    // ground & ramps
    const g = world.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.8, 0.4);
    if (this.onGround && this.pos.y - g < 0.3) {
      this.vel.y = clamp((g - prevY) / Math.max(dt, 1e-3), -30, 30);
      this.pos.y = g;
    } else {
      if (this.onGround) this.airTime = 0;
      this.onGround = false;
      this.vel.y -= 24 * dt;
      this.pos.y += this.vel.y * dt;
      this.airTime = (this.airTime || 0) + dt;
      if (this.pos.y <= g) {
        if (this.vel.y < -9) {
          game.onCrash(this, -this.vel.y * 0.6, this.pos.clone());
        }
        game.onLand(this, this.airTime);
        this.pos.y = g;
        this.vel.y = 0;
        this.onGround = true;
      }
    }

    // visuals
    const sp = Math.abs(vF);
    if (this.onGround) {
      const pitchT = -Math.atan2(this.vel.y, Math.max(sp, 2)) * Math.sign(vF || 1);
      this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 10);
    } else {
      this.pitch += (clamp(-this.vel.y * 0.03, -0.5, 0.5) - this.pitch) * Math.min(1, dt * 2);
    }
    if (this.kind === 'moto') {
      this.roll += (clamp(-this.yawRate * sp * 0.05, -0.75, 0.75) - this.roll) * Math.min(1, dt * 6);
    } else {
      this.roll += (clamp(vS * 0.012 - this.yawRate * sp * 0.006, -0.12, 0.12) - this.roll) * Math.min(1, dt * 6);
    }
    this.steerVis += (inp.steer * 0.45 - this.steerVis) * Math.min(1, dt * 10);
    for (const w of this.wheels) {
      if (w.front) w.pivot.rotation.y = this.steerVis;
      if (w.track) w.spin.rotation.x += (vF + (w.x > 0 ? -1 : 1) * this.yawRate * 1.6) * dt / 0.42;
      else w.spin.rotation.x += vF * dt / 0.4;
    }

    // tyre marks & smoke
    const burnout = inp.throttle > 0.5 && sp < 6 && inp.handbrake;
    const skidding = this.onGround && !tank && (this.slip > 0.22 && sp > 6 || (inp.handbrake && sp > 4) || burnout);
    this.skidding = skidding;
    const rear = this.wheels.filter((w) => !w.front);
    rear.forEach((w, i) => {
      const wx = this.pos.x + nsx * w.x + nfx * w.z, wz = this.pos.z + nsz * w.x + nfz * w.z;
      const p = new THREE.Vector3(wx, this.pos.y, wz);
      if (skidding) {
        if (this.skidPts[i]) game.fx.skids.add(this.skidPts[i], p, this.kind === 'moto' ? 0.18 : 0.3);
        this.skidPts[i] = p;
        if (Math.random() < 0.5 * (this.driver === 'player' ? 1 : 0.4)) game.fx.tyreSmoke(p, this.kind === 'moto' ? 0.7 : 1);
      } else this.skidPts[i] = null;
    });
    if (tank && this.onGround && sp > 2 && Math.random() < 0.3) game.fx.dust(this.pos);

    if (tank) {
      const rel = wrap(this.turretTarget - this.yaw - this.turretYaw);
      this.turretYaw += clamp(rel, -1.4 * dt, 1.4 * dt);
      this.barrelPitch += clamp(this.barrelTarget - this.barrelPitch, -dt, dt);
    }
  }

  updateHeli(dt, world, game) {
    const inp = this.input;
    const piloted = !!this.driver && this.burning <= 0;
    this.rotor = clamp(this.rotor + (piloted ? dt * 0.6 : -dt * 0.25), 0, 1);
    const lift = this.rotor > 0.75;
    const g = world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5, 1.2, 1.4);
    const grounded = this.pos.y <= g + 0.02;

    if (this.burning > 0) {
      this.yawRate += dt * 4;
      this.vel.y -= 14 * dt;
    } else if (lift) {
      const targetVy = inp.up * 9;
      this.vel.y += (targetVy - this.vel.y) * Math.min(1, dt * 2.5);
    } else {
      this.vel.y -= 18 * dt * (1 - this.rotor);
      if (this.vel.y < -12) this.vel.y = -12;
    }
    const pitchT = lift && !grounded ? inp.throttle * 0.38 : 0;
    const rollT = lift && !grounded ? -(inp.strafe || 0) * 0.3 - inp.steer * 0.08 : 0;
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 3);
    this.roll += (rollT - this.roll) * Math.min(1, dt * 3);
    if (this.burning <= 0) {
      const yawT = lift ? inp.steer * 1.6 : 0;
      this.yawRate += (yawT - this.yawRate) * Math.min(1, dt * 4);
    }
    this.yaw += this.yawRate * dt;
    const f = this.forward;
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (lift && !grounded) {
      this.vel.addScaledVector(f, this.pitch * 75 * dt);
      this.vel.addScaledVector(side, -this.roll * 60 * dt);
    }
    const drag = grounded ? 6 : 0.55;
    this.vel.x *= Math.max(0, 1 - drag * dt);
    this.vel.z *= Math.max(0, 1 - drag * dt);
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y > 160) { this.pos.y = 160; this.vel.y = Math.min(0, this.vel.y); }

    const c = { x: this.pos.x, z: this.pos.z };
    const hit = world.pushOut(c, this.spec.r, this.pos.y + 0.3, 3, 0.2);
    if (hit) {
      this.pos.x = c.x; this.pos.z = c.z;
      const vn = this.vel.x * hit.nx + this.vel.z * hit.nz;
      if (vn < 0) {
        this.vel.x -= hit.nx * vn * 1.4;
        this.vel.z -= hit.nz * vn * 1.4;
        if (-vn > 4) game.onCrash(this, -vn, new THREE.Vector3(c.x - hit.nx * 2, this.pos.y + 2, c.z - hit.nz * 2));
      }
    }
    const g2 = world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5, 1.2, 1.4);
    if (this.pos.y < g2) {
      if (this.vel.y < -8) game.onCrash(this, -this.vel.y, this.pos.clone());
      this.pos.y = g2;
      this.vel.y = Math.max(0, this.vel.y);
      if (this.burning > 0) { this.burning = 0.001; }
    }
    this.onGround = this.pos.y <= g2 + 0.05;
    const ud = this.group.userData;
    ud.rotor.rotation.y += this.rotor * 28 * dt;
    ud.tailRotor.rotation.x += this.rotor * 40 * dt;
  }

  syncMesh(dt) {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    const ud = this.group.userData;
    if (ud.turret) {
      ud.turret.rotation.y = this.turretYaw;
      ud.barrel.rotation.x = -this.barrelPitch;
    }
    if (ud.lightbar && this.sirenOn) {
      const t = performance.now() / 1000;
      const on = Math.floor(t * 6) % 2;
      ud.lightbar[0].material.emissiveIntensity = on ? 3 : 0;
      ud.lightbar[1].material.emissiveIntensity = on ? 0 : 3;
    } else if (ud.lightbar) {
      ud.lightbar[0].material.emissiveIntensity = 0;
      ud.lightbar[1].material.emissiveIntensity = 0;
    }
  }

  /** Ray vs the vehicle's oriented box. Returns distance or null. */
  rayHit(o, d, maxDist) {
    const [hx, hy, hz] = this.spec.half;
    const cy = this.pos.y + hy + (this.kind === 'heli' ? 0.4 : 0.15);
    const cos = Math.cos(-this.yaw), sin = Math.sin(-this.yaw);
    const rx = o.x - this.pos.x, rz = o.z - this.pos.z;
    const lo = [rx * cos + rz * sin, o.y - cy, -rx * sin + rz * cos];
    const ld = [d.x * cos + d.z * sin, d.y, -d.x * sin + d.z * cos];
    const half = [hx, hy, hz];
    let tmin = 0, tmax = maxDist;
    for (let a = 0; a < 3; a++) {
      const inv = 1 / (ld[a] || 1e-9);
      let t1 = (-half[a] - lo[a]) * inv, t2 = (half[a] - lo[a]) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmax < tmin) return null;
    }
    return tmin;
  }

  // ---------- AI ----------
  setupTraffic(axis, k, dirSign) {
    // travelling along `axis` on road line k
    const dir = axis === 'z' ? { x: 0, z: dirSign } : { x: dirSign, z: 0 };
    this.ai = { mode: 'traffic', dir, line: k, nextDir: null, cruise: 11 + Math.random() * 5, stuck: 0, reverse: 0, honk: 0 };
    this.yaw = Math.atan2(dir.x, dir.z);
  }

  aiDrive(dt, game) {
    const ai = this.ai;
    if (!ai || this.burning > 0) { this.input.throttle = 0; this.input.handbrake = true; return; }
    if (this.kind === 'heli') { this.aiHeli(dt, game); return; }
    let target, desired;
    if (ai.mode === 'traffic') {
      const d = ai.dir;
      const right = { x: -d.z, z: d.x };
      const alongX = d.x !== 0;
      const sign = alongX ? d.x : d.z;
      const along = alongX ? this.pos.x : this.pos.z;
      // lane: road line `ai.line` (perpendicular coordinate) shifted to the right-hand side
      const laneCoord = roadLine(ai.line) + (alongX ? right.z : right.x) * LANE;
      target = alongX ? { x: along + sign * 12, z: laneCoord } : { x: laneCoord, z: along + sign * 12 };
      const rel = (along + HALF_W) / 80;
      const nextIdx = sign > 0 ? Math.floor(rel) + 1 : Math.ceil(rel) - 1;
      const rem = (roadLine(clamp(nextIdx, 0, N)) - along) * sign;
      desired = ai.cruise;
      if (ai.nextDir && ai.turnIdx !== nextIdx && ai.nextDir === d) ai.nextDir = null;
      if (!ai.nextDir && rem < 30 && nextIdx >= 0 && nextIdx <= N) {
        const opts = [];
        if (nextIdx + sign >= 0 && nextIdx + sign <= N) opts.push(d, d);
        for (const nd of [right, { x: -right.x, z: -right.z }]) {
          const step = nd.x !== 0 ? nd.x : nd.z;
          if (ai.line + step >= 0 && ai.line + step <= N) opts.push(nd);
        }
        ai.nextDir = opts[Math.floor(Math.random() * opts.length)] || { x: -d.x, z: -d.z };
        ai.turnIdx = nextIdx;
      }
      if (ai.nextDir && ai.nextDir !== d) {
        desired = Math.min(desired, 7.5);
        const nd = ai.nextDir;
        const nRight = { x: -nd.z, z: nd.x };
        const turnAt = roadLine(ai.turnIdx) + (alongX ? nRight.x : nRight.z) * LANE;
        const remTurn = (turnAt - along) * sign;
        if (remTurn < 4) {
          ai.dir = nd;
          ai.line = ai.turnIdx;
          ai.nextDir = null;
        }
      }
    } else if (ai.mode === 'chase') {
      const tp = game.playerPos();
      const tv = game.playerVel();
      target = { x: tp.x + tv.x * 0.6, z: tp.z + tv.z * 0.6 };
      const dist = Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z);
      // follow the road grid when far away
      if (dist > 35) {
        const nearX = roadLine(Math.round((this.pos.x + 280) / 80));
        const nearZ = roadLine(Math.round((this.pos.z + 280) / 80));
        const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z;
        const onZRoad = Math.abs(this.pos.x - nearX) < 7;
        const onXRoad = Math.abs(this.pos.z - nearZ) < 7;
        if (onZRoad && onXRoad) {
          ai.axis = Math.abs(dx) > Math.abs(dz) ? 'x' : 'z';
        } else if (onZRoad) ai.axis = 'z';
        else if (onXRoad) ai.axis = 'x';
        if (ai.axis === 'x' && onXRoad && Math.abs(dx) > 12) target = { x: this.pos.x + Math.sign(dx) * 25, z: nearZ };
        else if (ai.axis === 'z' && onZRoad && Math.abs(dz) > 12) target = { x: nearX, z: this.pos.z + Math.sign(dz) * 25 };
      }
      desired = dist > 60 ? 40 : dist > 20 ? 26 : game.player.vehicle ? 22 : 4;
      if (dist < 12 && !game.player.vehicle) desired = 0;
      ai.dist = dist;
    }

    // obstacles ahead (traffic only)
    const f = this.forward;
    if (ai.mode === 'traffic') {
      for (const o of game.obstaclesNear(this.pos, 16)) {
        if (o === this) continue;
        const rx = o.pos.x - this.pos.x, rz = o.pos.z - this.pos.z;
        const ahead = rx * f.x + rz * f.z;
        const lat = Math.abs(rx * f.z - rz * f.x);
        if (ahead > 0 && ahead < 14 && lat < 2.4) {
          desired = Math.min(desired, ahead < 7 ? 0 : 4);
          if (o.isPlayer && ahead < 8) {
            ai.honk -= dt;
            if (ai.honk < 0) { ai.honk = 3; if (o.isPlayer) game.audio.horn(); }
          }
        }
      }
    }

    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    let diff = wrap(want - this.yaw);
    const vF = this.vF;
    if (ai.reverse > 0) {
      ai.reverse -= dt;
      this.input.throttle = -1;
      this.input.steer = -Math.sign(diff);
      this.input.handbrake = false;
      return;
    }
    // a chasing cop drives in reverse rather than turning around in place when the target is behind
    this.input.steer = clamp(diff * 2.2, -1, 1);
    const err = desired - vF;
    this.input.throttle = clamp(err * 0.35, -1, 1);
    if (Math.abs(diff) > 1.2 && vF > 10) this.input.throttle = Math.min(this.input.throttle, -0.3);
    this.input.handbrake = ai.mode === 'chase' && Math.abs(diff) > 0.9 && vF > 14;
    // stuck detection
    if (this.input.throttle > 0.4 && Math.abs(vF) < 1.2) {
      ai.stuck += dt;
      if (ai.stuck > 1.6) { ai.stuck = 0; ai.reverse = 1.2; }
    } else ai.stuck = Math.max(0, ai.stuck - dt);
  }

  aiHeli(dt, game) {
    const ai = this.ai;
    const tp = game.playerPos();
    ai.t = (ai.t || 0) + dt;
    const goal = new THREE.Vector3(tp.x + Math.cos(ai.t * 0.4) * 30, Math.max(tp.y + 28, 30), tp.z + Math.sin(ai.t * 0.4) * 30);
    const to = goal.clone().sub(this.pos);
    const want = Math.atan2(tp.x - this.pos.x, tp.z - this.pos.z);
    this.input.steer = clamp(wrap(want - this.yaw) * 1.5, -1, 1);
    const f = this.forward;
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.input.throttle = clamp(to.dot(f) * 0.05, -1, 1);
    this.input.strafe = clamp(-to.dot(side) * 0.05, -1, 1);
    this.input.up = clamp(to.y * 0.2, -1, 1);
  }
}
Vehicle.nextId = 1;

export { wrap, clamp };
