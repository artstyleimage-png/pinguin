import * as THREE from 'three';
import { Penguin } from '../../js/penguin.js';
import { SKINS } from '../../shared/skins.js';
import { ROAD } from './world.js';
import { wrap, clamp, mat } from './vehicles.js';

export const WEAPONS = {
  fists: { name: 'Кулаки', icon: '👊', melee: true },
  pistol: { name: 'Пистолет', icon: '🔫', dmg: 28, rate: 0.22, mag: 12, reload: 1.1, spread: 0.012, range: 120, auto: false },
  smg: { name: 'Автомат', icon: '🔫', dmg: 15, rate: 0.075, mag: 32, reload: 1.5, spread: 0.035, range: 100, auto: true },
  shotgun: { name: 'Дробовик', icon: '💥', dmg: 13, pellets: 9, rate: 0.75, mag: 6, reload: 1.8, spread: 0.08, range: 40, auto: false },
  rpg: { name: 'Гранатомёт', icon: '🚀', dmg: 150, rate: 1, mag: 1, reload: 1.6, spread: 0, range: 300, auto: false, rocket: true },
};
export const WEAPON_ORDER = ['fists', 'pistol', 'smg', 'shotgun', 'rpg'];

const GUN_GEO = new THREE.BoxGeometry(1, 1, 1);
const PED_SKINS = SKINS.filter((s) => s.rarity !== 'legendary').map((s) => s.id);
const GRAVITY = 24;

function addGun(penguin) {
  const gun = new THREE.Group();
  const m = new THREE.Mesh(GUN_GEO, mat(0x222428, { metalness: 0.7, roughness: 0.3 }));
  m.scale.set(0.14, 0.2, 0.7);
  m.position.z = 0.25;
  m.castShadow = true;
  gun.add(m);
  gun.position.set(-0.72, 1.05, 0.35);
  gun.visible = false;
  penguin.root.add(gun);
  return { group: gun, mesh: m };
}

function addCopHat(penguin) {
  const b = penguin.body;
  const hat = mat(0x1a2a5a);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.28, 20), hat);
  cap.position.set(0, 1.95, 0);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.5, 0.12, 20), hat);
  top.position.set(0, 2.12, 0.04);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.3), mat(0x111111));
  visor.position.set(0, 1.86, 0.48);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.04), mat(0xffd34a, { metalness: 0.9, emissive: 0x664400, emissiveIntensity: 0.4 }));
  badge.position.set(0.25, 1.15, 0.66);
  for (const m of [cap, top, visor, badge]) { m.castShadow = true; b.add(m); }
}

/** Common body for anything that walks: the player, pedestrians and cops. */
class Walker {
  constructor(game, skin, x, z) {
    this.game = game;
    this.penguin = new Penguin(skin);
    this.root = this.penguin.root;
    game.scene.add(this.root);
    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.onGround = true;
    this.knock = 0;
    this.lieAngle = 0;
    this.radius = 0.45;
  }

  physics(dt, wish, accel, airAccel = 6) {
    const world = this.game.world;
    const k = this.onGround ? accel : airAccel;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, k * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, k * dt);
    this.integrate(dt, world);
  }

  integrate(dt, world) {
    this.vel.y -= GRAVITY * dt;
    const prevY = this.pos.y;
    this.pos.addScaledVector(this.vel, dt);
    const hit = world.pushOut(this.pos, this.radius, this.pos.y, 1.8, 0.55);
    this.wallHit = hit;
    if (hit) {
      const vn = this.vel.x * hit.nx + this.vel.z * hit.nz;
      if (vn < 0) { this.vel.x -= hit.nx * vn; this.vel.z -= hit.nz * vn; }
    }
    const ceil = world.ceilingAt(this.pos.x, this.pos.z, prevY + 0.5);
    if (this.pos.y + 1.8 > ceil && prevY + 1.8 <= ceil + 0.01) { this.pos.y = ceil - 1.8; this.vel.y = Math.min(0, this.vel.y); }
    const g = world.groundAt(this.pos.x, this.pos.z, Math.max(this.pos.y, prevY), 0.55, 0.25);
    this.landSpeed = 0;
    if (this.pos.y <= g) {
      if (!this.onGround) this.landSpeed = -this.vel.y;
      this.pos.y = g;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.onGround && this.vel.y <= 0 && this.pos.y - g < 0.45) {
      this.pos.y = g;
      this.vel.y = 0;
    } else this.onGround = false;
    const B = 340;
    this.pos.x = clamp(this.pos.x, -B, B);
    this.pos.z = clamp(this.pos.z, -B, B);
  }

  faceToward(yaw, rate, dt) {
    this.yaw += clamp(wrap(yaw - this.yaw), -rate * dt, rate * dt);
  }

  sync(dt, anim = {}) {
    this.penguin.update(dt, anim);
    this.root.position.copy(this.pos);
    this.root.rotation.set(this.lieAngle, this.yaw, 0, 'YXZ');
  }

  remove() {
    this.root.removeFromParent();
  }
}

export class Player extends Walker {
  constructor(game, x, z) {
    super(game, 'classic', x, z);
    this.isPlayer = true;
    this.hp = 100;
    this.vehicle = null;
    this.weapons = ['fists'];
    this.weapon = 'fists';
    this.mag = {};
    this.fireCd = 0;
    this.reloadT = 0;
    this.punchCd = 0;
    this.punchSide = 1;
    this.punchAnim = 0;
    this.mantle = null;
    this.slide = 0;
    this.wallJumps = 0;
    this.lastWall = null;
    this.coyote = 0;
    this.aimT = 0;
    this.hurtT = 0;
    this.gun = addGun(this.penguin);
    this.radius = 0.5;
  }

  give(weapon) {
    if (!this.weapons.includes(weapon)) {
      this.weapons.push(weapon);
      this.weapons.sort((a, b) => WEAPON_ORDER.indexOf(a) - WEAPON_ORDER.indexOf(b));
    }
    this.mag[weapon] = WEAPONS[weapon].mag;
    this.selectWeapon(weapon);
  }

  selectWeapon(w) {
    if (!this.weapons.includes(w)) return;
    this.weapon = w;
    this.reloadT = 0;
    if (this.mag[w] === undefined) this.mag[w] = WEAPONS[w].mag ?? 0;
    const s = w === 'rpg' ? [0.3, 0.3, 1.3] : w === 'shotgun' ? [0.16, 0.2, 1.0] : w === 'smg' ? [0.14, 0.24, 0.8] : [0.12, 0.2, 0.5];
    this.gun.mesh.scale.set(...s);
    this.gun.mesh.position.z = s[2] / 2 - 0.1;
    this.gun.mesh.material = mat(w === 'rpg' ? 0x4b5a32 : 0x222428, { metalness: 0.7, roughness: 0.3 });
  }

  cycleWeapon(dir) {
    const i = this.weapons.indexOf(this.weapon);
    this.selectWeapon(this.weapons[(i + dir + this.weapons.length) % this.weapons.length]);
  }

  hurt(amount, from) {
    if (this.game.state !== 'play') return;
    this.hp -= amount;
    this.hurtT = 0.3;
    this.regenDelay = 6;
    this.game.hud.damage(from);
    if (this.hp <= 0) { this.hp = 0; this.game.wasted(); }
  }

  /** Look for a ledge in front: returns the top position to climb to, or null. */
  findLedge(dir, reach) {
    const w = this.game.world;
    for (const d of [0.75, 1.05]) {
      const px = this.pos.x + dir.x * d, pz = this.pos.z + dir.z * d;
      const top = w.groundAt(px, pz, this.pos.y + reach, 0, 0.05);
      if (top < this.pos.y + 0.75) continue;
      if (w.blockedAt(px, pz, top, top + 1.8)) continue;
      if (w.blockedAt(this.pos.x, this.pos.z, this.pos.y + 1.8, top + 1.8)) continue;
      const tx = px + dir.x * 0.35, tz = pz + dir.z * 0.35;
      return new THREE.Vector3(tx, top, tz);
    }
    return null;
  }

  update(dt, inp) {
    const game = this.game;
    this.fireCd -= dt;
    this.punchCd -= dt;
    this.hurtT -= dt;
    this.regenDelay = (this.regenDelay || 0) - dt;
    if (this.regenDelay < 0 && this.hp < 60) this.hp = Math.min(60, this.hp + dt * 4);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.mag[this.weapon] = WEAPONS[this.weapon].mag;
    }
    if (inp.weaponNext) this.cycleWeapon(inp.weaponNext);
    if (inp.weaponSlot != null) this.selectWeapon(WEAPON_ORDER[inp.weaponSlot]);

    // ---- mantle animation in progress
    if (this.mantle) {
      const m = this.mantle;
      m.t += dt / m.dur;
      const t = Math.min(1, m.t);
      const up = Math.min(1, t * 1.6);
      this.pos.set(
        m.from.x + (m.to.x - m.from.x) * Math.max(0, (t - 0.4) / 0.6),
        m.from.y + (m.to.y - m.from.y) * (1 - (1 - up) ** 2),
        m.from.z + (m.to.z - m.from.z) * Math.max(0, (t - 0.4) / 0.6),
      );
      if (t >= 1) { this.mantle = null; this.onGround = true; this.vel.set(0, 0, 0); }
      this.sync(dt, { speed: 6, falling: true });
      for (const f of this.penguin.flippers) f.pivot.rotation.x = -2.6;
      return;
    }

    const cy = game.cam.yaw;
    const fwd = new THREE.Vector3(Math.sin(cy), 0, Math.cos(cy));
    const right = new THREE.Vector3(-Math.cos(cy), 0, Math.sin(cy));
    const wish = fwd.clone().multiplyScalar(inp.move.y).addScaledVector(right, inp.move.x);
    if (wish.lengthSq() > 1) wish.normalize();
    const moving = wish.lengthSq() > 0.01;
    const armed = this.weapon !== 'fists';
    const aiming = inp.aim && armed;
    this.aimT = aiming || (armed && inp.attack) ? 0.6 : this.aimT - dt;
    const sprint = inp.sprint && !aiming;
    const speed = aiming ? 3.6 : sprint ? 10 : 5.2;

    if (this.onGround) { this.coyote = 0.12; this.wallJumps = 0; } else this.coyote -= dt;

    // belly slide
    if (inp.crouchPressed && this.onGround && this.slide <= 0) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const dir = moving ? wish.clone().normalize() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const sp = Math.max(hs + 3, 11);
      this.vel.x = dir.x * sp; this.vel.z = dir.z * sp;
      this.slide = 0.4;
      this.yaw = Math.atan2(dir.x, dir.z);
      game.audio.whoosh();
    }
    if (this.slide > 0) {
      this.slide -= dt;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (inp.crouch && hs > 2.5) this.slide = Math.max(this.slide, 0.05);
      const dec = Math.max(0, hs - 2.2 * dt) / Math.max(hs, 1e-4);
      this.vel.x *= dec; this.vel.z *= dec;
      if (moving) {
        // gentle steering while sliding
        const target = Math.atan2(wish.x, wish.z);
        const cur = Math.atan2(this.vel.x, this.vel.z);
        const nyaw = cur + clamp(wrap(target - cur), -1.5 * dt, 1.5 * dt);
        this.vel.x = Math.sin(nyaw) * hs * dec; this.vel.z = Math.cos(nyaw) * hs * dec;
        this.yaw = nyaw;
      }
      if (this.onGround && Math.random() < 0.4) game.fx.dust(this.pos);
      this.integrate(dt, game.world);
      game.slideHits(this);
    } else {
      this.physics(dt, wish.clone().multiplyScalar(speed), 14, 4);
    }

    // jumping, mantling and wall jumps
    const dir = moving ? wish.clone().normalize() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (inp.jumpPressed) {
      const ledge = this.findLedge(dir, this.onGround ? 2.6 : 2.2);
      if (ledge && (this.onGround || this.vel.y > -12)) {
        this.startMantle(ledge);
      } else if (this.onGround || this.coyote > 0) {
        this.vel.y = 8.8;
        this.onGround = false;
        this.coyote = 0;
        if (this.slide > 0) { this.vel.x *= 1.1; this.vel.z *= 1.1; }
        this.slide = 0;
        game.audio.jump();
      } else if (this.lastWall && this.lastWall.t < 0.25 && this.wallJumps < 4) {
        const n = this.lastWall;
        this.vel.set(n.nx * 7.5 + dir.x * 2, 9.2, n.nz * 7.5 + dir.z * 2);
        this.yaw = Math.atan2(this.vel.x, this.vel.z);
        this.wallJumps++;
        this.lastWall = null;
        game.audio.jump();
        game.fx.dust(this.pos.clone().add(new THREE.Vector3(-n.nx * 0.5, 1, -n.nz * 0.5)));
        game.hud.popup('ОТСКОК ОТ СТЕНЫ!', '#7cf');
      }
    } else if (!this.onGround && moving && this.wallHit && this.vel.y > -10) {
      // auto-grab ledges when pushing into a wall mid-air
      const into = -(wish.x * this.wallHit.nx + wish.z * this.wallHit.nz);
      if (into > 0.5) {
        const ledge = this.findLedge(new THREE.Vector3(-this.wallHit.nx, 0, -this.wallHit.nz), 2.0);
        if (ledge) this.startMantle(ledge);
      }
    }
    if (this.wallHit && !this.onGround) this.lastWall = { nx: this.wallHit.nx, nz: this.wallHit.nz, t: 0 };
    if (this.lastWall) this.lastWall.t += dt;

    if (this.landSpeed > 18) {
      const dmg = (this.landSpeed - 18) * 6;
      this.hurt(dmg, null);
      game.audio.hurt();
    }
    if (this.landSpeed > 6) { game.audio.land(); game.fx.dust(this.pos); }

    // facing
    if (this.aimT > 0) this.faceToward(cy, 20, dt);
    else if (moving && this.slide <= 0) this.faceToward(Math.atan2(wish.x, wish.z), 12, dt);

    // attacks
    if (this.weapon === 'fists') {
      if (inp.attackPressed && this.punchCd <= 0) {
        this.punchCd = 0.32;
        this.punchSide *= -1;
        this.punchAnim = 0.2;
        if (!moving) this.yaw = cy;
        game.melee(this);
      }
    } else if (this.reloadT <= 0) {
      const w = WEAPONS[this.weapon];
      if (inp.reloadPressed && this.mag[this.weapon] < w.mag) this.startReload();
      else if ((w.auto ? inp.attack : inp.attackPressed) && this.fireCd <= 0) {
        if (this.mag[this.weapon] > 0) {
          this.fireCd = w.rate;
          this.mag[this.weapon]--;
          this.yaw = cy;
          game.playerFire(this, w);
          if (this.mag[this.weapon] === 0) this.startReload();
        } else this.startReload();
      }
    }

    // animation
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.lieAngle += ((this.slide > 0 ? 1.35 : 0) - this.lieAngle) * Math.min(1, dt * 12);
    this.sync(dt, { speed: this.slide > 0 ? 0 : hs * 1.2, falling: !this.onGround && this.vel.y < -6 });
    this.root.position.y += 0.5 * Math.max(0, this.lieAngle / 1.35);
    this.gun.group.visible = armed;
    this.punchAnim -= dt;
    const fl = this.penguin.flippers;
    if (this.punchAnim > 0) {
      const f = fl[this.punchSide > 0 ? 1 : 0];
      f.pivot.rotation.x = -1.6 * Math.sin((this.punchAnim / 0.2) * Math.PI);
    } else {
      fl[0].pivot.rotation.x = this.slide > 0 ? -2.8 : 0;
      fl[1].pivot.rotation.x = armed && this.aimT > 0 ? -1.45 : this.slide > 0 ? -2.8 : 0;
    }
    if (armed) {
      this.gun.group.rotation.x = this.aimT > 0 ? -game.cam.pitch * 0.8 : 0.6;
      this.gun.group.position.z = this.aimT > 0 ? 0.55 : 0.2;
    }
  }

  startMantle(to) {
    this.mantle = { from: this.pos.clone(), to, t: 0, dur: 0.38 + Math.max(0, to.y - this.pos.y) * 0.05 };
    this.slide = 0;
    this.game.audio.jump();
    if (to.y - this.pos.y > 1.5) this.game.hud.popup('ЗАЛЕЗ!', '#9f9');
  }

  startReload() {
    const w = WEAPONS[this.weapon];
    if (!w || w.melee || this.reloadT > 0) return;
    this.reloadT = w.reload;
    this.game.audio.reload();
  }
}

export class Ped extends Walker {
  constructor(game, x, z, { cop = false, block = null } = {}) {
    super(game, cop ? 'blueberry' : PED_SKINS[Math.floor(Math.random() * PED_SKINS.length)], x, z);
    this.cop = cop;
    if (cop) addCopHat(this.penguin);
    this.hp = cop ? 70 : 40;
    this.state = cop ? 'chase' : 'walk';
    this.block = block;
    this.corner = 0;
    this.cornerDir = Math.random() < 0.5 ? 1 : -1;
    this.target = null;
    this.timer = 0;
    this.fireCd = 1 + Math.random();
    this.walkSpeed = 1.4 + Math.random() * 0.6;
    this.deadT = 0;
    if (cop) {
      this.gun = addGun(this.penguin);
      this.gun.group.visible = true;
      this.gun.mesh.scale.set(0.12, 0.2, 0.5);
    }
    if (block) this.snapToBlock();
    this.root.scale.setScalar(0.9 + Math.random() * 0.15);
    // only the main body casts a shadow: keeps the shadow pass cheap with many pedestrians
    this.root.traverse((m) => { if (m.isMesh) m.castShadow = false; });
    this.penguin.body.children[0].castShadow = true;
  }

  corners(b = this.block) {
    return [[b.x0 + 2, b.z0 + 2], [b.x1 - 2, b.z0 + 2], [b.x1 - 2, b.z1 - 2], [b.x0 + 2, b.z1 - 2]];
  }

  snapToBlock() {
    const b = this.game.world.blockAt(this.pos.x, this.pos.z) || this.block;
    if (!b) return;
    this.block = b;
    const cs = this.corners();
    let best = 0, bd = Infinity;
    cs.forEach(([x, z], i) => { const d = Math.hypot(x - this.pos.x, z - this.pos.z); if (d < bd) { bd = d; best = i; } });
    this.corner = best;
    this.target = new THREE.Vector3(cs[best][0], 0, cs[best][1]);
  }

  nextCorner() {
    const w = this.game.world;
    const b = this.block;
    if (Math.random() < 0.18) {
      // cross the street to a neighbouring block
      const c = this.corner;
      const across = ROAD + 4;
      const optsX = c === 1 || c === 2 ? 1 : -1;
      const optsZ = c === 2 || c === 3 ? 1 : -1;
      const alongX = Math.random() < 0.5;
      const nb = w.blockAt(this.target.x + (alongX ? optsX * across : 0), this.target.z + (alongX ? 0 : optsZ * across));
      if (nb) {
        const map = alongX ? { 0: 1, 1: 0, 2: 3, 3: 2 } : { 0: 3, 3: 0, 1: 2, 2: 1 };
        this.block = nb;
        this.corner = map[c];
        const cs = this.corners(nb);
        this.target = new THREE.Vector3(cs[this.corner][0], 0, cs[this.corner][1]);
        return;
      }
    }
    if (!b) return;
    this.corner = (this.corner + this.cornerDir + 4) % 4;
    const cs = this.corners();
    this.target = new THREE.Vector3(cs[this.corner][0], 0, cs[this.corner][1]);
  }

  scare(from) {
    if (this.cop || this.state === 'ko' || this.state === 'dead') return;
    if (this.state !== 'flee') this.game.audio.squawk();
    this.state = 'flee';
    this.threat = from.clone();
    this.timer = 5 + Math.random() * 4;
    this.penguin.setExpression('shock');
  }

  hit(dmg, impulse, from) {
    if (this.state === 'dead') return;
    this.hp -= dmg;
    this.vel.add(impulse);
    if (impulse.lengthSq() > 9) { this.onGround = false; this.vel.y = Math.max(this.vel.y, 3); }
    this.game.fx.feathers(this.pos, 6);
    if (this.hp <= 0) {
      this.state = 'dead';
      this.penguin.setExpression('out');
      this.game.onPedDown(this, from);
      return;
    }
    if (this.cop) { this.state = 'ko'; this.timer = 1.2; return; }
    this.state = 'ko';
    this.timer = 1.5 + Math.random();
    this.penguin.setExpression('dizzy');
    if (from && from.isPlayer) this.threat = from.pos.clone();
  }

  update(dt) {
    const game = this.game;
    const p = game.player;
    this.timer -= dt;
    let wish = new THREE.Vector3();
    let anim = {};
    if (this.state === 'dead' || this.state === 'ko') {
      this.deadT += dt;
      const fric = this.onGround ? Math.max(0, 1 - dt * 5) : 1;
      this.vel.x *= fric; this.vel.z *= fric;
      this.integrate(dt, game.world);
      this.lieAngle += (-1.45 - this.lieAngle) * Math.min(1, dt * 8);
      if (this.state === 'ko' && this.timer <= 0 && this.onGround) {
        this.state = this.cop ? 'chase' : 'flee';
        this.timer = 6;
        this.lieAngle = 0;
        this.penguin.setExpression(this.cop ? 'normal' : 'shock');
        if (!this.threat) this.threat = p.pos.clone();
      }
      this.sync(dt, { speed: 0 });
      this.root.position.y += 0.6 * Math.min(1, -this.lieAngle / 1.45) * this.root.scale.y;
      return;
    }
    this.lieAngle *= 0.8;
    if (this.state === 'walk') {
      if (!this.target) this.snapToBlock();
      if (this.target) {
        const to = this.target.clone().sub(this.pos);
        to.y = 0;
        if (to.length() < 1) this.nextCorner();
        else wish = to.normalize().multiplyScalar(this.walkSpeed);
      }
    } else if (this.state === 'flee') {
      const away = this.pos.clone().sub(this.threat || p.pos);
      away.y = 0;
      if (away.lengthSq() < 0.01) away.set(1, 0, 0);
      wish = away.normalize().multiplyScalar(6.5);
      // try not to run into walls
      if (this.wallHit) wish.set(this.wallHit.nz * 6, 0, -this.wallHit.nx * 6);
      if (this.timer <= 0) { this.state = 'walk'; this.penguin.setExpression('normal'); this.snapToBlock(); }
      anim.falling = false;
    } else if (this.state === 'chase') {
      const tp = game.playerPos();
      const to = tp.clone().sub(this.pos);
      to.y = 0;
      const d = to.length();
      const inCar = !!p.vehicle;
      const want = d > (inCar ? 18 : 7) ? 6.2 : d > 1.2 && !inCar ? 4 : 0;
      if (d > 0.01) wish = to.clone().normalize().multiplyScalar(want);
      if (this.wallHit && want > 0) wish.add(new THREE.Vector3(this.wallHit.nx, 0, this.wallHit.nz).multiplyScalar(3));
      this.fireCd -= dt;
      if (game.wanted > 0 && d < 38 && this.fireCd <= 0) {
        const eye = this.pos.clone().add(new THREE.Vector3(0, 1.3, 0));
        const aim = tp.clone().add(new THREE.Vector3(0, 1, 0));
        if (game.world.lineClear(eye, aim)) {
          this.fireCd = 0.7 + Math.random() * 0.6;
          game.npcFire(this, eye, aim, d);
        } else this.fireCd = 0.3;
      }
      this.yaw = Math.atan2(to.x, to.z);
      if (game.wanted === 0) { this.state = 'walk'; this.snapToBlock(); }
    }
    this.physics(dt, wish, 8);
    if (wish.lengthSq() > 0.01 && this.state !== 'chase') this.faceToward(Math.atan2(wish.x, wish.z), 8, dt);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.sync(dt, { speed: hs * 1.3, ...anim });
    if (this.cop) this.penguin.flippers[1].pivot.rotation.x = this.state === 'chase' ? -1.4 : 0;
  }
}
