import * as THREE from 'three';
import { SKIN_BY_ID } from '../shared/skins.js';

// Shared geometry: every penguin is built from the same handful of shapes.
const G = {
  sphere: new THREE.SphereGeometry(1, 32, 24),
  sphereLo: new THREE.SphereGeometry(1, 16, 12),
  cone: new THREE.ConeGeometry(1, 1, 20),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 24),
  torus: new THREE.TorusGeometry(1, 0.25, 12, 32),
  box: new THREE.BoxGeometry(1, 1, 1),
};
for (const g of Object.values(G)) g.userData.shared = true;

const matCache = new Map();
function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0, ...opts });
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return matCache.get(key);
}

function mesh(geo, material, { pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0] } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * A chubby cartoon penguin (~1.9 m tall, ~0.8 m radius) standing on y = 0
 * and facing +z. `update()` drives idle / slide / fall animations.
 */
export class Penguin {
  constructor(skinId = 'classic') {
    this.root = new THREE.Group();     // positioned by the game
    this.tilt = new THREE.Group();     // lean & wobble
    this.root.add(this.tilt);
    this.body = new THREE.Group();     // rebuilt on skin change
    this.tilt.add(this.body);
    this.time = Math.random() * 10;
    this.blink = 2 + Math.random() * 3;
    this.expression = 'normal';
    this.speed = 0;
    this.flap = 0;
    this.setSkin(skinId);
  }

  setSkin(skinId) {
    const skin = SKIN_BY_ID[skinId] || SKIN_BY_ID.classic;
    this.skinId = skin.id;
    this.body.clear();
    const frost = skin.accessory === 'frost';
    const gold = skin.accessory === 'crown';
    const bodyMat = frost
      ? mat(skin.body, { roughness: 0.1, metalness: 0.1, emissive: 0x2a7fb0, emissiveIntensity: 0.35, transparent: true, opacity: 0.88 })
      : gold ? mat(skin.body, { roughness: 0.28, metalness: 0.75 }) : mat(skin.body);
    const bellyMat = mat(skin.belly, frost ? { roughness: 0.15, emissive: 0x6fcfff, emissiveIntensity: 0.25 } : {});
    const beakMat = mat(skin.beak, { roughness: 0.35 });
    const feetMat = mat(skin.feet, { roughness: 0.5 });
    const b = this.body;

    // body + belly
    b.add(mesh(G.sphere, bodyMat, { pos: [0, 0.95, 0], scale: [0.8, 0.98, 0.74] }));
    b.add(mesh(G.sphere, bellyMat, { pos: [0, 0.82, 0.24], scale: [0.62, 0.74, 0.54] }));
    // little hair tuft
    for (let i = -1; i <= 1; i++) {
      b.add(mesh(G.cone, bodyMat, { pos: [i * 0.07, 1.95, -0.05 - Math.abs(i) * 0.03], scale: [0.06, 0.22, 0.06], rot: [-0.3, 0, i * 0.5] }));
    }

    // eyes: big googly eyes sitting on top of the face
    this.eyes = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.24, 1.5, 0.52);
      eye.rotation.y = side * 0.25;
      const white = mesh(G.sphere, mat(0xffffff, { roughness: 0.2 }), { scale: [0.25, 0.27, 0.22] });
      eye.add(white);
      const pupil = mesh(G.sphereLo, mat(0x111111, { roughness: 0.1 }), { pos: [0, 0, 0.17], scale: [0.11, 0.12, 0.07] });
      eye.add(pupil);
      const shine = mesh(G.sphereLo, mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 }), { pos: [0.04, 0.05, 0.235], scale: [0.03, 0.03, 0.015] });
      eye.add(shine);
      // "X" eyes for knocked-out penguins
      const x = new THREE.Group();
      x.position.z = 0.2;
      x.add(mesh(G.box, mat(0x111111), { scale: [0.04, 0.22, 0.03], rot: [0, 0, 0.785] }));
      x.add(mesh(G.box, mat(0x111111), { scale: [0.04, 0.22, 0.03], rot: [0, 0, -0.785] }));
      x.visible = false;
      eye.add(x);
      b.add(eye);
      this.eyes.push({ group: eye, white, pupil, shine, x, side });
    }

    // beak (upper + lower so it can open when shocked)
    this.beakLower = mesh(G.cone, beakMat, { pos: [0, 1.22, 0.74], scale: [0.11, 0.26, 0.07], rot: [Math.PI / 2 + 0.25, 0, 0] });
    b.add(mesh(G.cone, beakMat, { pos: [0, 1.28, 0.75], scale: [0.14, 0.32, 0.09], rot: [Math.PI / 2 - 0.05, 0, 0] }));
    b.add(this.beakLower);

    // flippers on pivots at the shoulders
    this.flippers = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.7, 1.22, 0);
      pivot.add(mesh(G.sphere, bodyMat, { pos: [side * 0.08, -0.4, 0], scale: [0.11, 0.46, 0.26], rot: [0, 0, side * 0.12] }));
      b.add(pivot);
      this.flippers.push({ pivot, side });
    }

    // feet
    this.feet = [];
    for (const side of [-1, 1]) {
      const foot = mesh(G.sphere, feetMat, { pos: [side * 0.27, 0.05, 0.32], scale: [0.2, 0.07, 0.3], rot: [0, side * -0.2, 0] });
      b.add(foot);
      this.feet.push(foot);
    }

    if (skin.accessory) this.addAccessory(skin.accessory);
    this.setExpression(this.expression);
  }

  addAccessory(kind) {
    const b = this.body;
    if (kind === 'goggles') {
      const strap = mesh(G.cyl, mat(0x3a3f4a), { pos: [0, 1.52, 0], scale: [0.79, 0.12, 0.73] });
      b.add(strap);
      for (const e of this.eyes) {
        const ring = mesh(G.torus, mat(0xb8c2cc, { metalness: 0.8, roughness: 0.25 }), { scale: [0.27, 0.27, 0.27], pos: [0, 0, 0.12] });
        const glass = mesh(G.sphereLo, mat(0xcfefff, { transparent: true, opacity: 0.3, roughness: 0 }), { scale: [0.26, 0.26, 0.1], pos: [0, 0, 0.18] });
        e.group.add(ring, glass);
      }
    } else if (kind === 'santa') {
      b.add(mesh(G.cyl, mat(0xffffff, { roughness: 0.9 }), { pos: [0, 1.82, -0.02], scale: [0.55, 0.14, 0.52] }));
      b.add(mesh(G.cone, mat(0xd8262a), { pos: [0.08, 2.18, -0.1], scale: [0.5, 0.65, 0.48], rot: [-0.25, 0, -0.3] }));
      b.add(mesh(G.sphereLo, mat(0xffffff, { roughness: 0.9 }), { pos: [0.27, 2.42, -0.2], scale: [0.11, 0.11, 0.11] }));
    } else if (kind === 'pirate') {
      b.add(mesh(G.cyl, mat(0x1b1b1f), { pos: [0, 1.95, 0], scale: [0.75, 0.08, 0.5] }));
      b.add(mesh(G.sphere, mat(0x1b1b1f), { pos: [0, 2.0, 0], scale: [0.48, 0.28, 0.42] }));
      b.add(mesh(G.sphereLo, mat(0xf2f2f2), { pos: [0, 2.08, 0.38], scale: [0.07, 0.07, 0.03] }));
      const patch = this.eyes[0];
      patch.group.add(mesh(G.cyl, mat(0x111111), { pos: [0, 0, 0.17], scale: [0.2, 0.06, 0.2], rot: [Math.PI / 2, 0, 0] }));
      patch.pupil.visible = false;
      patch.shine.visible = false;
      patch.isPatched = true;
      b.add(mesh(G.cyl, mat(0x111111), { pos: [0, 1.62, 0.02], scale: [0.79, 0.025, 0.75], rot: [0.35, 0, -0.25] }));
    } else if (kind === 'viking') {
      const metal = mat(0x9aa4ae, { metalness: 0.8, roughness: 0.3 });
      b.add(mesh(G.sphere, metal, { pos: [0, 1.78, 0], scale: [0.66, 0.4, 0.62] }));
      b.add(mesh(G.cyl, mat(0x8a6a3a, { metalness: 0.4 }), { pos: [0, 1.7, 0], scale: [0.68, 0.08, 0.64] }));
      for (const s of [-1, 1]) {
        b.add(mesh(G.cone, mat(0xf3ead2), { pos: [s * 0.68, 2.05, 0], scale: [0.12, 0.5, 0.12], rot: [0, 0, -s * 0.9] }));
      }
    } else if (kind === 'ninja') {
      b.add(mesh(G.cyl, mat(0xd82a2a), { pos: [0, 1.66, 0], scale: [0.8, 0.13, 0.74] }));
      for (const s of [-1, 1]) {
        b.add(mesh(G.box, mat(0xd82a2a), { pos: [s * 0.12, 1.5, -0.8], scale: [0.1, 0.4, 0.03], rot: [0.4, 0, s * 0.4] }));
      }
    } else if (kind === 'tophat') {
      const hat = mat(0x16161a, { roughness: 0.3 });
      b.add(mesh(G.cyl, hat, { pos: [0, 1.92, -0.02], scale: [0.48, 0.05, 0.48] }));
      b.add(mesh(G.cyl, hat, { pos: [0, 2.2, -0.02], scale: [0.32, 0.55, 0.32] }));
      b.add(mesh(G.cyl, mat(0xc22b3a), { pos: [0, 2.0, -0.02], scale: [0.33, 0.1, 0.33] }));
      // bow tie
      for (const s of [-1, 1]) b.add(mesh(G.cone, mat(0xc22b3a), { pos: [s * 0.1, 1.08, 0.74], scale: [0.09, 0.16, 0.05], rot: [0, 0, s * Math.PI / 2] }));
      b.add(mesh(G.sphereLo, mat(0xc22b3a), { pos: [0, 1.08, 0.76], scale: [0.05, 0.05, 0.04] }));
    } else if (kind === 'crown') {
      const gold = mat(0xffd34a, { metalness: 0.9, roughness: 0.2, emissive: 0x6a4a00, emissiveIntensity: 0.3 });
      b.add(mesh(G.cyl, gold, { pos: [0, 1.98, 0], scale: [0.36, 0.18, 0.36] }));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.add(mesh(G.cone, gold, { pos: [Math.sin(a) * 0.31, 2.17, Math.cos(a) * 0.31], scale: [0.07, 0.2, 0.07] }));
        b.add(mesh(G.sphereLo, mat(i % 2 ? 0xe02a4a : 0x2a8ae0, { roughness: 0.1 }), { pos: [Math.sin(a) * 0.36, 1.98, Math.cos(a) * 0.36], scale: [0.04, 0.04, 0.04] }));
      }
    } else if (kind === 'frost') {
      const crystal = mat(0xdff6ff, { roughness: 0.05, emissive: 0x9fe4ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 });
      for (let i = 0; i < 5; i++) {
        const a = -0.9 + i * 0.45;
        b.add(mesh(G.cone, crystal, { pos: [Math.sin(a) * 0.35, 1.95 - Math.abs(a) * 0.12, -0.15], scale: [0.07, 0.3 - Math.abs(a) * 0.1, 0.07], rot: [-0.3, 0, -a * 0.7] }));
      }
    }
  }

  /** normal | shock | dizzy | out */
  setExpression(expr) {
    this.expression = expr;
    for (const e of this.eyes) {
      const out = expr === 'out';
      e.x.visible = out && !e.isPatched;
      e.pupil.visible = !out && !e.isPatched;
      e.shine.visible = !out && !e.isPatched;
      const k = expr === 'shock' ? 1.15 : 1;
      e.white.scale.set(0.25 * k, 0.27 * k, 0.22 * k);
      const pk = expr === 'shock' ? 0.6 : 1;
      e.pupil.scale.set(0.11 * pk, 0.12 * pk, 0.07);
      e.pupil.position.set(0, 0, 0.17);
    }
  }

  /**
   * @param {number} dt seconds
   * @param {{speed?:number, falling?:boolean, swimming?:boolean, aiming?:boolean}} s
   */
  update(dt, s = {}) {
    this.time += dt;
    const t = this.time;
    const speed = s.speed ?? 0;
    this.speed += (speed - this.speed) * Math.min(1, dt * 8);
    const sp = Math.min(1, this.speed / 10);

    // lean forward while sliding, wobble side to side
    let lean = sp * 0.3;
    let roll = Math.sin(t * 9) * 0.08 * sp;
    let bob = Math.abs(Math.sin(t * 2.2)) * 0.03 * (1 - sp);
    if (s.falling) { lean = 0.5; roll = Math.sin(t * 20) * 0.2; }
    if (s.swimming) { lean = -0.15; roll = Math.sin(t * 1.7) * 0.15; bob = Math.sin(t * 2) * 0.06; }
    this.tilt.rotation.x += (lean - this.tilt.rotation.x) * Math.min(1, dt * 10);
    this.tilt.rotation.z = roll;
    this.tilt.position.y = bob;

    // flippers: flap when sliding or falling, gentle sway when idle
    const flapTarget = s.falling ? 1 : s.swimming ? 0.7 : sp;
    this.flap += (flapTarget - this.flap) * Math.min(1, dt * 6);
    for (const f of this.flippers) {
      const idle = Math.sin(t * 2 + f.side) * 0.08;
      const flap = this.flap * (0.9 + Math.sin(t * (s.falling ? 30 : 14)) * 0.5);
      f.pivot.rotation.z = f.side * (0.1 + idle + flap);
    }
    // feet paddle
    for (let i = 0; i < 2; i++) this.feet[i].rotation.x = s.falling || s.swimming ? Math.sin(t * 15 + i * Math.PI) * 0.6 : 0;

    // blinking & expression details
    this.blink -= dt;
    const blinking = this.blink < 0.12 && this.expression === 'normal';
    if (this.blink < 0) this.blink = 2 + Math.random() * 4;
    for (const e of this.eyes) {
      e.group.scale.y = blinking ? 0.15 : 1;
      if (this.expression === 'dizzy' && !e.isPatched) {
        e.pupil.position.x = Math.cos(t * 12 + e.side) * 0.08;
        e.pupil.position.y = Math.sin(t * 12 + e.side) * 0.08;
      } else if (this.expression === 'normal' && !e.isPatched) {
        e.pupil.position.x = Math.sin(t * 0.7) * 0.03;
      }
    }
    const open = this.expression === 'shock' || s.falling ? 0.35 : 0;
    this.beakLower.rotation.x += (Math.PI / 2 + 0.25 + open - this.beakLower.rotation.x) * Math.min(1, dt * 12);
  }

  dispose() {
    this.root.removeFromParent();
  }
}
