import * as THREE from 'three';
import { World, LANE, roadLine, N, HALF } from './world.js';
import { FX } from './fx.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { audio } from './audio.js';
import { Vehicle, wrap, clamp, mat } from './vehicles.js';
import { Player, Ped, WEAPONS, WEAPON_ORDER } from './actors.js';
import { Penguin } from '../../js/penguin.js';

const SAVE_KEY = 'penguin-city-save';
const tmpV = new THREE.Vector3();

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; }
}

class Game {
  constructor() {
    const canvas = document.getElementById('scene');
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa9d4f5);
    this.scene.fog = new THREE.Fog(0xbfdcf2, 120, 520);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1500);

    const hemi = new THREE.HemisphereLight(0xdcefff, 0x6a6a50, 1.25);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70; sc.right = sc.top = 70; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.addSky();

    this.world = new World(this.scene);
    this.fx = new FX(this.scene);
    this.fx.pixelRatio = this.renderer.getPixelRatio();
    this.hud = new HUD(this.world);
    this.input = new Input(canvas);
    this.audio = audio;

    const save = loadSave();
    this.money = save.money || 0;
    this.fishFound = new Set(save.fish || []);
    this.bestDrift = save.bestDrift || 0;
    this.loot = 0;
    this.wanted = 0;
    this.escapeT = 0;
    this.seen = false;
    this.bustT = 0;
    this.drift = { score: 0, mult: 1, time: 0, idle: 0 };
    this.state = 'menu';
    this.timeScale = 1;
    this.cam = { yaw: Math.PI, pitch: 0.25, dist: 6, idle: 0, fov: 70, mode: 0 };
    this.vehicles = [];
    this.peds = [];
    this.projectiles = [];
    this.cash = [];
    this.heist = null;
    this.copTimer = 0;
    this.spawnTimer = 0;
    this.saveTimer = 0;
    this.fullmap = false;

    const sp = this.world.spawnPoint || new THREE.Vector3();
    this.player = new Player(this, sp.x, sp.z);
    for (const w of save.weapons || []) if (WEAPONS[w] && w !== 'fists') this.player.give(w);
    this.player.selectWeapon('fists');
    this.player.yaw = Math.PI;

    for (const s of this.world.vehicleSpawns) {
      const v = this.addVehicle(new Vehicle(s.kind, { model: s.model, color: s.color, x: s.x, z: s.z, yaw: s.yaw }));
      v.persistent = true;
      v.home = s;
    }
    this.makePickups();
    this.makeFish();
    this.updateObjective();

    addEventListener('resize', () => this.resize());
    this.resize();
    this.setupMenu();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  addSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec3 vP;
          void main(){ float y = max(vP.y, 0.0);
            vec3 c = mix(vec3(0.75,0.86,0.95), vec3(0.25,0.55,0.9), pow(y, 0.5));
            gl_FragColor = vec4(c, 1.0); }`,
      }),
    );
    this.sky = sky;
    this.scene.add(sky);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setupMenu() {
    const menu = document.getElementById('menu');
    const play = document.getElementById('playBtn');
    const start = () => {
      audio.unlock();
      menu.classList.add('hidden');
      this.state = this.state === 'menu' ? 'play' : this.state;
      this.input.enabled = true;
      if (!this.input.touch) this.canvas.requestPointerLock?.();
    };
    play.addEventListener('click', start);
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'play' && !this.input.touch) this.pause();
    };
    document.getElementById('resetBtn').addEventListener('click', () => {
      if (!confirm('Сбросить деньги, оружие и найденных рыбок?')) return;
      try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
      location.reload();
    });
    document.getElementById('muteBtn').addEventListener('click', (e) => {
      e.target.textContent = audio.toggle() ? '🔇 Звук выкл' : '🔊 Звук вкл';
    });
    document.getElementById('muteBtn').textContent = audio.muted ? '🔇 Звук выкл' : '🔊 Звук вкл';
  }

  pause() {
    this.state = 'menu';
    this.input.enabled = false;
    document.getElementById('playBtn').textContent = 'ПРОДОЛЖИТЬ';
    document.getElementById('menu').classList.remove('hidden');
    audio.loops({});
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: Math.floor(this.money), weapons: this.player.weapons, fish: [...this.fishFound], bestDrift: Math.floor(this.bestDrift),
      }));
    } catch { /* ignore */ }
  }

  // ---------------- entities ----------------
  addVehicle(v) {
    this.vehicles.push(v);
    this.scene.add(v.mesh);
    v.mesh.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    return v;
  }

  removeVehicle(v) {
    v.mesh.removeFromParent();
    if (v.riderPenguin) v.riderPenguin.root.removeFromParent();
    this.vehicles.splice(this.vehicles.indexOf(v), 1);
  }

  addRider(v) {
    const p = new Penguin(['classic', 'blueberry', 'chilly', 'mint', 'iceberg'][Math.floor(Math.random() * 5)]);
    p.root.scale.setScalar(0.85);
    p.root.position.set(0, 0.55, -0.3);
    p.tilt.rotation.x = 0.3;
    v.group.add(p.root);
    v.riderPenguin = p;
  }

  makePickups() {
    this.pickups = [];
    for (const p of this.world.pickups) {
      const g = new THREE.Group();
      if (p.health) {
        const red = mat(0xff3344, { emissive: 0xaa0011, emissiveIntensity: 0.6 });
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.3), red));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), red));
      } else {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, p.weapon === 'rpg' ? 1.4 : 0.9), mat(p.weapon === 'rpg' ? 0x4b5a32 : 0x30343a, { metalness: 0.7, emissive: 0x223344, emissiveIntensity: 0.5 }));
        g.add(m);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 8, 32), new THREE.MeshBasicMaterial({ color: p.health ? 0xff5566 : 0x66d9ff, transparent: true, opacity: 0.8 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.8;
      g.add(ring);
      g.position.copy(p.pos);
      this.scene.add(g);
      this.pickups.push({ ...p, mesh: g, respawn: 0 });
    }
  }

  makeFish() {
    const gold = mat(0xffc93a, { metalness: 0.8, roughness: 0.25, emissive: 0x8a5a00, emissiveIntensity: 0.5 });
    this.fish = this.world.fish.map((pos, i) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), gold);
      body.scale.set(1.4, 0.8, 0.45);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.5, 4), gold);
      tail.rotation.z = Math.PI / 2;
      tail.position.x = -0.7;
      g.add(body, tail);
      g.position.copy(pos);
      const found = this.fishFound.has(i);
      g.visible = !found;
      this.scene.add(g);
      return { pos, mesh: g, found };
    });
    this.hud.fish(this.fishFound.size, this.fish.length);
  }

  playerPos() { return this.player.vehicle ? this.player.vehicle.pos : this.player.pos; }
  playerVel() { return this.player.vehicle ? this.player.vehicle.vel : this.player.vel; }

  obstaclesNear(pos, r) {
    const out = [];
    for (const v of this.vehicles) if (Math.abs(v.pos.x - pos.x) < r && Math.abs(v.pos.z - pos.z) < r) out.push(v);
    for (const p of this.peds) if (p.state !== 'dead' && Math.abs(p.pos.x - pos.x) < r && Math.abs(p.pos.z - pos.z) < r) out.push(p);
    if (!this.player.vehicle) out.push(this.player);
    return out;
  }

  // ---------------- wanted level ----------------
  addWanted(level, reason) {
    const before = this.wanted;
    this.wanted = Math.min(5, Math.max(this.wanted, level));
    this.escapeT = 0;
    if (this.wanted > before && reason) this.hud.popup(reason, '#ff6a6a');
  }

  bumpWanted(reason) { this.addWanted(Math.min(5, this.wanted + 1), reason); }

  copNear(pos, r) {
    for (const p of this.peds) if (p.cop && p.state !== 'dead' && p.pos.distanceTo(pos) < r) return true;
    for (const v of this.vehicles) if (v.cop && !v.dead && v.pos.distanceTo(pos) < r) return true;
    return false;
  }

  scarePeds(pos, r) {
    for (const p of this.peds) if (p.pos.distanceTo(pos) < r) p.scare(pos);
  }

  // ---------------- combat ----------------
  traceShot(o, d, range, ignore) {
    let best = { t: range, point: null, normal: null };
    const wh = this.world.raycast(o, d, range);
    if (wh) best = { t: wh.t, point: wh.point, normal: wh.normal, world: true };
    for (const v of this.vehicles) {
      if (v === ignore || v.pos.distanceToSquared(o) > (range + 6) ** 2) continue;
      const t = v.rayHit(o, d, best.t);
      if (t != null && t < best.t) best = { t, vehicle: v };
    }
    const sphere = (c, r) => {
      const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const cc = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - cc;
      if (disc < 0) return null;
      let t = -b - Math.sqrt(disc);
      if (t < 0) t = -b + Math.sqrt(disc);
      return t >= 0 ? t : null;
    };
    for (const p of this.peds) {
      if (p === ignore || p.state === 'dead') continue;
      if (p.pos.distanceToSquared(o) > (range + 2) ** 2) continue;
      const lying = p.state === 'ko';
      const t = sphere(tmpV.set(p.pos.x, p.pos.y + (lying ? 0.4 : 1.0), p.pos.z), lying ? 0.8 : 0.75);
      if (t != null && t < best.t) best = { t, ped: p };
    }
    const pl = this.player;
    if (ignore !== pl && !pl.vehicle) {
      const t = sphere(tmpV.set(pl.pos.x, pl.pos.y + 1, pl.pos.z), 0.7);
      if (t != null && t < best.t) best = { t, player: true };
    }
    if (!best.point) best.point = o.clone().addScaledVector(d, best.t);
    if (!best.normal) best.normal = d.clone().negate();
    return best;
  }

  /** Point the crosshair is on. */
  aimPoint(ignore) {
    const o = this.camera.position.clone();
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    o.addScaledVector(d, this.cam.dist * 0.9);
    const hit = this.traceShot(o, d, 300, ignore);
    return hit.point;
  }

  playerFire(p, w) {
    const v = p.vehicle;
    const muzzle = v
      ? v.pos.clone().add(new THREE.Vector3(0, v.kind === 'heli' ? 0.8 : 1.9, 0)).addScaledVector(v.forward, v.kind === 'heli' ? 2.8 : 0)
      : p.pos.clone().add(new THREE.Vector3(0, 1.15, 0)).add(new THREE.Vector3(Math.sin(p.yaw) * 0.9 - Math.cos(p.yaw) * 0.72, 0, Math.cos(p.yaw) * 0.9 + Math.sin(p.yaw) * 0.72));
    const target = this.aimPoint(v || p);
    const dir = target.clone().sub(muzzle).normalize();
    this.fx.muzzle(muzzle, dir);
    this.fx.flash(muzzle, 6, 0.05);
    if (w.rocket) {
      this.launchRocket(muzzle, dir, p, w.dmg);
      audio.rocket();
    } else {
      audio.shot(w === WEAPONS.shotgun ? 'shotgun' : w === WEAPONS.smg || w.heli ? 'smg' : 'pistol');
      const n = w.pellets || 1;
      for (let i = 0; i < n; i++) {
        const d = dir.clone();
        d.x += (Math.random() - 0.5) * w.spread * 2;
        d.y += (Math.random() - 0.5) * w.spread * 2;
        d.z += (Math.random() - 0.5) * w.spread * 2;
        d.normalize();
        const hit = this.traceShot(muzzle, d, w.range, v || p);
        this.applyHit(hit, w.dmg, d, p);
        if (i < 3) this.fx.tracers.add(muzzle, hit.point);
      }
    }
    if (this.copNear(muzzle, 35)) this.addWanted(1, 'Стрельба при полиции!');
    this.scarePeds(muzzle, 40);
  }

  applyHit(hit, dmg, dir, from) {
    if (hit.ped) {
      const ped = hit.ped;
      const wasCop = ped.cop;
      ped.hit(dmg, dir.clone().multiplyScalar(dmg > 40 ? 8 : 2.5), from);
      if (from === this.player && wasCop) this.addWanted(2, 'Нападение на полицейского!');
      this.fx.feathers(hit.point, 4);
    } else if (hit.vehicle) {
      const v = hit.vehicle;
      v.damage(dmg * (v.kind === 'tank' ? 0.15 : 0.5), this, from);
      this.fx.impact(hit.point, hit.normal || dir.clone().negate(), 0xffe08a);
      if (from === this.player && v.cop) this.addWanted(2, 'Стрельба по полиции!');
    } else if (hit.player) {
      this.player.hurt(dmg * 0.35, from);
      audio.hurt();
    } else if (hit.world) {
      this.fx.impact(hit.point, hit.normal);
    }
  }

  npcFire(shooter, eye, aim, d) {
    const pv = this.player.vehicle;
    const chance = clamp(0.55 - d / 70, 0.12, 0.5) * (pv ? 1 : Math.hypot(this.player.vel.x, this.player.vel.z) > 6 ? 0.55 : 1);
    let target = aim.clone();
    const hits = Math.random() < chance;
    if (!hits) target.add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.3) * 2, (Math.random() - 0.5) * 4));
    const dir = target.clone().sub(eye).normalize();
    this.fx.muzzle(eye, dir);
    const vol = clamp(1 - eye.distanceTo(this.playerPos()) / 80, 0.1, 1);
    audio.shot('pistol', vol * 0.8);
    if (hits) {
      if (pv) pv.damage(5, this, shooter); else this.player.hurt(6, shooter);
      this.fx.tracers.add(eye, target, 0xffb0a0);
    } else {
      const hit = this.traceShot(eye, dir, 80, shooter);
      if (hit.world) this.fx.impact(hit.point, hit.normal);
      this.fx.tracers.add(eye, hit.point, 0xffb0a0);
    }
  }

  launchRocket(pos, dir, owner, dmg, speed = 55, shell = false) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.8, 8), mat(shell ? 0x3a3a33 : 0x6b7350));
    m.rotation.x = Math.PI / 2;
    const g = new THREE.Group();
    g.add(m);
    g.position.copy(pos);
    g.lookAt(pos.clone().add(dir));
    this.scene.add(g);
    this.projectiles.push({ pos: pos.clone(), vel: dir.clone().multiplyScalar(speed), owner, dmg, mesh: g, life: 6, shell });
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const r = this.projectiles[i];
      r.life -= dt;
      const step = r.vel.length() * dt;
      const d = r.vel.clone().normalize();
      const ignore = r.owner.vehicle || r.owner;
      const hit = this.traceShot(r.pos, d, step, ignore);
      const ownerV = r.owner.isPlayer ? r.owner.vehicle : r.owner;
      const hitSelf = hit.vehicle && hit.vehicle === ownerV;
      if ((hit.t < step && !hitSelf) || r.life <= 0) {
        r.mesh.removeFromParent();
        this.projectiles.splice(i, 1);
        this.explode(hit.point.clone().addScaledVector(d, -0.3), r.shell ? 6 : 7, r.dmg, r.owner);
        continue;
      }
      r.pos.addScaledVector(r.vel, dt);
      r.mesh.position.copy(r.pos);
      this.fx.smoke.emit(r.pos.x, r.pos.y, r.pos.z, { life: 0.8, size: 0.5, grow: 1.5, color: 0xcccccc, alpha: 0.6 });
      this.fx.glow.emit(r.pos.x, r.pos.y, r.pos.z, { life: 0.08, size: 0.6, color: 0xffa040 });
    }
  }

  explode(pos, radius, dmg, by, source) {
    this.fx.explosion(pos, radius / 7);
    const dist = pos.distanceTo(this.camera.position);
    audio.explosion(clamp(1.2 - dist / 150, 0.15, 1));
    this.fx.shake = Math.max(this.fx.shake, clamp(1.2 - dist / 60, 0, 1.2));
    const byPlayer = by === this.player || (by && by.isPlayer);
    for (const v of this.vehicles) {
      if (v === source) continue;
      const d = v.pos.distanceTo(pos);
      if (d < radius) {
        const k = 1 - d / radius;
        v.damage(dmg * k * (v.kind === 'tank' ? 0.3 : 1), this, by);
        const push = tmpV.subVectors(v.pos, pos).setY(0).normalize().multiplyScalar(14 * k * (v.kind === 'tank' ? 0.1 : 1));
        v.vel.add(push);
        if (v.kind !== 'heli' && v.kind !== 'tank' && v.onGround) { v.vel.y = 7 * k; v.onGround = false; v.airTime = 0; }
        if (byPlayer && v.cop) this.addWanted(Math.min(5, this.wanted + 1), 'Взорвана полицейская машина!');
      }
    }
    for (const p of this.peds) {
      const d = p.pos.distanceTo(pos);
      if (d < radius * 1.3) {
        const k = 1 - d / (radius * 1.3);
        const imp = tmpV.subVectors(p.pos, pos).setY(0).normalize().multiplyScalar(18 * k).add(new THREE.Vector3(0, 10 * k, 0));
        p.hit(dmg * k, imp.clone(), by);
      } else if (d < 40) p.scare(pos);
    }
    if (!this.player.vehicle || this.player.vehicle === source) {
      const d = this.player.pos.distanceTo(pos);
      if (d < radius && !this.player.vehicle) {
        const k = 1 - d / radius;
        this.player.hurt(dmg * k * 0.6, by);
        this.player.vel.add(tmpV.subVectors(this.player.pos, pos).setY(0).normalize().multiplyScalar(12 * k));
        this.player.vel.y = 8 * k;
        this.player.onGround = false;
      }
    }
    if (byPlayer && this.copNear(pos, 50)) this.addWanted(2, 'Взрыв!');
  }

  melee(p) {
    const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const strong = Math.hypot(p.vel.x, p.vel.z) > 7 || !p.onGround;
    let any = false;
    for (const ped of this.peds) {
      if (ped.state === 'dead') continue;
      const to = tmpV.subVectors(ped.pos, p.pos);
      to.y = 0;
      const d = to.length();
      if (d > 2.1 || Math.abs(ped.pos.y - p.pos.y) > 1.5) continue;
      if (d > 0.3 && to.normalize().dot(f) < 0.35) continue;
      const imp = f.clone().multiplyScalar(strong ? 11 : 5).add(new THREE.Vector3(0, strong ? 6 : 2, 0));
      const wasCop = ped.cop;
      ped.hit(strong ? 30 : 18, imp, p);
      if (wasCop) this.addWanted(2, 'Нападение на полицейского!');
      else if (this.copNear(ped.pos, 30)) this.addWanted(1, 'Драка на глазах у полиции!');
      any = true;
      this.scarePeds(ped.pos, 15);
      if (strong) this.hud.popup('НОКАУТ!', '#ffd34a');
    }
    for (const v of this.vehicles) {
      if (v.pos.distanceTo(p.pos) < v.spec.r + 1.6 && !v.dead) {
        tmpV.subVectors(v.pos, p.pos).setY(0).normalize();
        if (tmpV.dot(f) > 0.3) { v.damage(3, this, p); v.vel.addScaledVector(f, v.kind === 'moto' ? 2 : 0.4); any = true; }
      }
    }
    if (any) { audio.punch(); this.fx.shake = Math.max(this.fx.shake, 0.15); } else audio.whoosh();
  }

  slideHits(p) {
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (sp < 5) return;
    let n = 0;
    for (const ped of this.peds) {
      if (ped.state === 'dead' || ped.state === 'ko') continue;
      if (ped.pos.distanceTo(p.pos) < 1.3) {
        ped.hit(12, new THREE.Vector3(p.vel.x * 0.7, 6, p.vel.z * 0.7), p);
        if (ped.cop) this.addWanted(2, 'Сбил полицейского!');
        n++;
        audio.punch();
      }
    }
    if (n) {
      this.slideCombo = (this.slideCombo || 0) + n;
      this.hud.popup(this.slideCombo >= 3 ? `СТРАЙК x${this.slideCombo}!` : 'КЕГЛЯ!', '#ffd34a');
      if (this.slideCombo >= 3) this.earn(50 * this.slideCombo);
    }
  }

  onPedDown(ped, from) {
    const byPlayer = from === this.player || (from && from.driver === 'player');
    if (byPlayer) {
      if (ped.cop) this.bumpWanted('Полицейский выведен из строя!');
      else if (this.wanted < 1) this.addWanted(1, 'Нападение на прохожего!');
    }
    // drop some cash
    const amount = ped.cop ? 40 + Math.floor(Math.random() * 60) : 10 + Math.floor(Math.random() * 50);
    const m = new THREE.Mesh(this.fx.coinGeo, this.fx.coinMat);
    m.position.copy(ped.pos).add(new THREE.Vector3(0, 0.6, 0));
    m.rotation.x = Math.PI / 2;
    this.scene.add(m);
    this.cash.push({ mesh: m, amount, t: 30 });
    if (ped.cop && Math.random() < 0.4) {
      const w = ['pistol', 'smg', 'shotgun'][Math.floor(Math.random() * 3)];
      this.cash.push({ mesh: m.clone(), amount: 0, weapon: w, t: 30 });
    }
  }

  earn(amount, label) {
    this.money += amount;
    audio.cash();
    if (label) this.hud.popup(`${label} +$${amount}`, '#7cff6a');
  }

  // ---------------- vehicles ----------------
  onCrash(v, impact, point) {
    const k = v.kind === 'tank' ? 0.1 : v.kind === 'heli' ? 1.6 : 1;
    v.damage(Math.max(0, impact - 6) * 2.2 * k, this);
    if (v.driver === 'player') {
      audio.crash(impact / 5);
      this.fx.shake = Math.max(this.fx.shake, Math.min(0.6, impact / 30));
      if (impact > 9 && this.drift.score > 0) {
        this.hud.popup('ДРИФТ ПРОВАЛЕН', '#ff6a6a');
        this.drift = { score: 0, mult: 1, time: 0, idle: 0 };
      }
      if (v.kind === 'moto' && impact > 14) this.bail(v);
    }
    for (let i = 0; i < 6; i++) this.fx.glow.emit(point.x, point.y, point.z, { vx: (Math.random() - 0.5) * 8, vy: Math.random() * 5, vz: (Math.random() - 0.5) * 8, life: 0.4, size: 0.12, color: 0xffd080, gravity: 15 });
  }

  onLand(v, air) {
    if (v.driver !== 'player') return;
    if (air > 0.9) {
      const bonus = Math.round(air * 120);
      this.earn(bonus, `ТРЮК ${air.toFixed(1)}с`);
    }
    if (air > 0.3) this.fx.dust(v.pos);
  }

  bail(v) {
    // thrown off the motorbike
    this.exitVehicle(true);
    const p = this.player;
    p.vel.set(v.vel.x * 0.8, 7, v.vel.z * 0.8);
    p.onGround = false;
    p.hurt(15, null);
    this.hud.popup('ВЫЛЕТЕЛ С БАЙКА!', '#ff9a4a');
  }

  tryEnter() {
    const p = this.player;
    if (p.vehicle) { this.exitVehicle(); return; }
    let best = null, bd = Infinity;
    for (const v of this.vehicles) {
      if (v.dead || v.burning > 0) continue;
      const d = Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z);
      if (d < v.spec.enter + 1 && d < bd && Math.abs(v.pos.y - p.pos.y) < 3) { bd = d; best = v; }
    }
    if (!best) return;
    const v = best;
    if (v.ai) {
      // carjack: throw the driver out
      const side = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
      const ped = new Ped(this, v.pos.x + side.x * 2.2, v.pos.z + side.z * 2.2, { cop: !!v.cop });
      ped.pos.y = v.pos.y;
      ped.hit(0, side.clone().multiplyScalar(4).add(new THREE.Vector3(0, 3, 0)), p);
      if (!v.cop) ped.scare(p.pos);
      this.peds.push(ped);
      if (v.riderPenguin) { v.riderPenguin.root.removeFromParent(); v.riderPenguin = null; }
      if (v.cop) this.addWanted(2, 'Угон полицейской машины!');
      v.ai = null;
      this.hud.popup('УГОН!', '#ffd34a');
    }
    if (v.kind === 'tank' && !v.stolen) { v.stolen = true; this.addWanted(3, 'Угон танка у армии!'); }
    v.driver = 'player';
    v.persistent = true;
    v.sirenOn = false;
    p.vehicle = v;
    p.slide = 0;
    p.lieAngle = 0;
    if (v.kind === 'moto') {
      v.group.add(p.root);
      p.root.position.set(0, 0.55, -0.3);
      p.root.rotation.set(0.25, 0, 0);
      p.root.visible = true;
    } else p.root.visible = false;
    this.cam.idle = 2;
    audio.click();
  }

  exitVehicle(force = false) {
    const p = this.player;
    const v = p.vehicle;
    if (!v) return;
    if (!force && v.kind !== 'heli' && v.speed > 12) return;
    const side = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
    const r = v.kind === 'heli' || v.kind === 'tank' ? 3.2 : 1.9;
    p.pos.set(v.pos.x + side.x * r, v.pos.y + 0.2, v.pos.z + side.z * r);
    const hit = this.world.pushOut(p.pos, 0.5, p.pos.y, 1.8, 0.5);
    if (hit && hit.depth > 1) p.pos.set(v.pos.x - side.x * r, v.pos.y + 0.2, v.pos.z - side.z * r);
    p.vel.set(v.vel.x * 0.5, 0, v.vel.z * 0.5);
    p.onGround = false;
    p.yaw = v.yaw;
    this.scene.add(p.root);
    p.root.visible = true;
    p.root.scale.setScalar(1);
    v.driver = null;
    v.input = { throttle: 0, steer: 0, handbrake: true, boost: false, up: v.kind === 'heli' ? -1 : 0 };
    p.vehicle = null;
    this.drift = { score: 0, mult: 1, time: 0, idle: 0 };
  }

  vehicleCollisions(dt) {
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (Math.abs(a.pos.x - b.pos.x) > 9 || Math.abs(a.pos.z - b.pos.z) > 9) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 2.5) continue;
        for (const [ax, az] of a.circles()) for (const [bx, bz] of b.circles()) {
          const dx = bx - ax, dz = bz - az;
          const d = Math.hypot(dx, dz);
          const min = a.spec.r + b.spec.r;
          if (d >= min || d < 1e-4) continue;
          const nx = dx / d, nz = dz / d;
          const ima = 1 / a.spec.mass, imb = 1 / b.spec.mass;
          const pen = min - d;
          const sa = ima / (ima + imb), sb = imb / (ima + imb);
          a.pos.x -= nx * pen * sa; a.pos.z -= nz * pen * sa;
          b.pos.x += nx * pen * sb; b.pos.z += nz * pen * sb;
          const rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
          if (rv < 0) {
            const jimp = (-(1.3) * rv) / (ima + imb);
            a.vel.x -= nx * jimp * ima; a.vel.z -= nz * jimp * ima;
            b.vel.x += nx * jimp * imb; b.vel.z += nz * jimp * imb;
            const impact = -rv;
            if (impact > 4) {
              const pt = new THREE.Vector3((ax + bx) / 2, a.pos.y + 0.8, (az + bz) / 2);
              const kA = b.kind === 'tank' ? 5 : 1, kB = a.kind === 'tank' ? 5 : 1;
              a.damage(Math.max(0, impact - 4) * 2 * kA * (a.kind === 'tank' ? 0.05 : 1), this, b.driver === 'player' ? this.player : null);
              b.damage(Math.max(0, impact - 4) * 2 * kB * (b.kind === 'tank' ? 0.05 : 1), this, a.driver === 'player' ? this.player : null);
              if (a.driver === 'player' || b.driver === 'player') {
                audio.crash(impact / 5);
                const other = a.driver === 'player' ? b : a;
                if (other.cop && impact > 8) this.addWanted(1, 'Таран полиции!');
                if (impact > 10 && this.drift.score > 0) { this.drift = { score: 0, mult: 1, time: 0, idle: 0 }; this.hud.popup('ДРИФТ ПРОВАЛЕН', '#ff6a6a'); }
              }
              for (let k = 0; k < 5; k++) this.fx.glow.emit(pt.x, pt.y, pt.z, { vx: (Math.random() - 0.5) * 8, vy: Math.random() * 5, vz: (Math.random() - 0.5) * 8, life: 0.4, size: 0.12, color: 0xffd080, gravity: 15 });
              // traffic gets scared and gives up its lane
              for (const v of [a, b]) if (v.ai && v.ai.mode === 'traffic' && impact > 8) v.ai.cruise = 18;
            }
          }
        }
      }
    }
    // vehicles vs walkers
    for (const v of vs) {
      const sp = v.speed;
      if (sp < 3 || v.kind === 'heli' && !v.onGround) continue;
      for (const [cx, cz] of v.circles()) {
        for (const ped of this.peds) {
          if (ped.state === 'dead' && sp < 8) continue;
          if (Math.abs(ped.pos.y - v.pos.y) > 2) continue;
          const d = Math.hypot(ped.pos.x - cx, ped.pos.z - cz);
          if (d < v.spec.r + 0.45) {
            if (ped.state === 'ko' || ped.state === 'dead') {
              if (ped.state === 'ko' && sp > 8) ped.hit(sp, new THREE.Vector3(v.vel.x * 0.4, 3, v.vel.z * 0.4), v.driver === 'player' ? this.player : v);
              continue;
            }
            const wasCop = ped.cop;
            ped.hit(sp * 3.2, new THREE.Vector3(v.vel.x * 0.9, 4 + sp * 0.3, v.vel.z * 0.9), v.driver === 'player' ? this.player : v);
            audio.punch();
            if (v.driver === 'player') {
              if (wasCop) this.addWanted(2, 'Сбил полицейского!');
              this.scarePeds(ped.pos, 25);
            }
          }
        }
        const p = this.player;
        if (!p.vehicle && v.driver !== 'player' && Math.abs(p.pos.y - v.pos.y) < 2 && !p.mantle) {
          const d = Math.hypot(p.pos.x - cx, p.pos.z - cz);
          if (d < v.spec.r + 0.5) {
            p.hurt(sp * 1.8, v);
            p.vel.set(v.vel.x * 0.9, 5 + sp * 0.2, v.vel.z * 0.9);
            p.onGround = false;
            audio.punch();
          }
        }
      }
    }
  }

  // ---------------- spawning ----------------
  spawnTraffic(near, minD, maxD, opts = {}) {
    for (let tries = 0; tries < 12; tries++) {
      const axis = Math.random() < 0.5 ? 'x' : 'z';
      const line = Math.floor(Math.random() * (N + 1));
      const seg = Math.floor(Math.random() * N);
      const along = roadLine(seg) + 20 + Math.random() * 40;
      const sign = Math.random() < 0.5 ? 1 : -1;
      const dir = axis === 'z' ? { x: 0, z: sign } : { x: sign, z: 0 };
      const right = { x: -dir.z, z: dir.x };
      const x = axis === 'z' ? roadLine(line) + right.x * LANE : along;
      const z = axis === 'z' ? along : roadLine(line) + right.z * LANE;
      const d = Math.hypot(x - near.x, z - near.z);
      if (d < minD || d > maxD) continue;
      if (this.vehicles.some((v) => Math.hypot(v.pos.x - x, v.pos.z - z) < 10)) continue;
      const roll = Math.random();
      const kind = opts.cop ? 'car' : roll < 0.14 ? 'moto' : 'car';
      const model = opts.cop ? 'police' : opts.model || (roll > 0.9 ? 'sport' : roll > 0.8 ? 'muscle' : 'car');
      const v = this.addVehicle(opts.tank ? new Vehicle('tank', { x, z }) : new Vehicle(kind, { model, x, z }));
      v.setupTraffic(axis, line, sign);
      v.vel.set(Math.sin(v.yaw) * 8, 0, Math.cos(v.yaw) * 8);
      if (kind === 'moto') this.addRider(v);
      return v;
    }
    return null;
  }

  manageSpawns(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 0.5;
    const pp = this.playerPos();
    // pedestrians
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const d = p.pos.distanceTo(pp);
      if (d > 150 || (p.state === 'dead' && p.deadT > 25 && d > 40)) {
        p.remove();
        this.peds.splice(i, 1);
      }
    }
    const civs = this.peds.filter((p) => !p.cop).length;
    if (civs < 22) {
      for (let k = 0; k < 3; k++) {
        const pt = this.world.sidewalkPoint(pp, 35, 120);
        if (pt) this.peds.push(new Ped(this, pt.x, pt.z, { block: pt.block }));
      }
    }
    // traffic
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      const d = v.pos.distanceTo(pp);
      if (v.driver === 'player') continue;
      if (v.persistent && !v.dead) {
        // parked specials respawn at home if lost far away
        if (d > 300 && v.home && Math.hypot(v.pos.x - v.home.x, v.pos.z - v.home.z) > 5) {
          v.pos.set(v.home.x, 0, v.home.z); v.yaw = v.home.yaw; v.vel.set(0, 0, 0);
        }
        continue;
      }
      if (d > 260 || (v.dead && d > 120) || (v.dead && v.deadTime > 60)) {
        if (v.persistent && v.home) {
          // replace a destroyed special vehicle at its spawn
          const s = v.home;
          this.removeVehicle(v);
          if (Math.hypot(s.x - pp.x, s.z - pp.z) > 80) {
            const nv = this.addVehicle(new Vehicle(s.kind, { model: s.model, color: s.color, x: s.x, z: s.z, yaw: s.yaw }));
            nv.persistent = true;
            nv.home = s;
          }
          continue;
        }
        this.removeVehicle(v);
      }
    }
    const traffic = this.vehicles.filter((v) => v.ai && v.ai.mode === 'traffic').length;
    if (traffic < 20) this.spawnTraffic(pp, 70, 200);
  }

  managePolice(dt) {
    this.copTimer -= dt;
    const pp = this.playerPos();
    // wanted decay when out of sight
    let seen = false;
    for (const p of this.peds) if (p.cop && p.state === 'chase' && p.pos.distanceTo(pp) < 50) seen = true;
    for (const v of this.vehicles) if (v.cop && !v.dead && v.ai && v.pos.distanceTo(pp) < (v.kind === 'heli' ? 90 : 55)) seen = true;
    this.seen = seen;
    if (this.wanted > 0) {
      this.escapeT += seen ? -dt * 2 : dt;
      this.escapeT = Math.max(0, this.escapeT);
      if (this.escapeT > 8 + this.wanted * 2.5) {
        this.wanted--;
        this.escapeT = 0;
        if (this.wanted === 0) { this.hud.popup('ТЫ ОТОРВАЛСЯ ОТ ПОЛИЦИИ', '#7cff6a'); this.callOffCops(); }
      }
    }
    if (this.copTimer > 0) return;
    this.copTimer = 1;
    if (this.wanted === 0) return;
    const cars = this.vehicles.filter((v) => v.cop && !v.dead && v.ai && v.kind === 'car');
    const want = [0, 1, 2, 3, 4, 5][this.wanted];
    if (cars.length < want) {
      const v = this.spawnTraffic(pp, 70, 140, { cop: true });
      if (v) { v.cop = true; v.ai.mode = 'chase'; v.sirenOn = true; v.persistent = false; v.deployed = false; }
    }
    if (this.wanted >= 4 && !this.vehicles.some((v) => v.cop && v.kind === 'heli' && !v.dead)) {
      const a = Math.random() * Math.PI * 2;
      const h = this.addVehicle(new Vehicle('heli', { x: pp.x + Math.cos(a) * 120, z: pp.z + Math.sin(a) * 120, y: 45, color: 0x1a2a5a }));
      h.cop = true; h.rotor = 1; h.driver = 'ai'; h.ai = { mode: 'heli' }; h.onGround = false;
    }
    if (this.wanted >= 5 && !this.vehicles.some((v) => v.cop && v.kind === 'tank' && !v.dead)) {
      const v = this.spawnTraffic(pp, 90, 160, { tank: true });
      if (v) { v.cop = true; v.ai.mode = 'chase'; v.driver = 'ai'; }
    }
    // cop cars that reached the player let officers out
    const copsOnFoot = this.peds.filter((p) => p.cop && p.state !== 'dead').length;
    for (const v of cars) {
      if (!v.deployed && copsOnFoot < 10 && v.ai.dist < 16 && v.speed < 4 && !this.player.vehicle) {
        v.deployed = true;
        const side = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
        for (const s of [1, -1]) {
          const c = new Ped(this, v.pos.x + side.x * 2 * s, v.pos.z + side.z * 2 * s, { cop: true });
          this.peds.push(c);
        }
      }
    }
    // keep a few cops on foot near the player
    if (copsOnFoot < Math.min(2 + this.wanted, 6) && !this.player.vehicle && Math.random() < 0.4) {
      const pt = this.world.sidewalkPoint(pp, 40, 80);
      if (pt) this.peds.push(new Ped(this, pt.x, pt.z, { cop: true }));
    }
  }

  callOffCops() {
    for (const v of this.vehicles) {
      if (!v.cop || v.dead) continue;
      v.sirenOn = false;
      if (v.kind === 'heli') { v.ai = { mode: 'leave' }; v.leaving = true; continue; }
      if (v.ai) {
        const axisZ = Math.abs(v.pos.x - roadLine(Math.round((v.pos.x + HALF) / 80))) < 8;
        v.setupTraffic(axisZ ? 'z' : 'x', axisZ ? Math.round((v.pos.x + HALF) / 80) : Math.round((v.pos.z + HALF) / 80), Math.random() < 0.5 ? 1 : -1);
      }
    }
    for (const p of this.peds) if (p.cop && p.state === 'chase') { p.state = 'walk'; p.snapToBlock(); }
  }

  updateCopWeapons(dt) {
    const pp = this.playerPos();
    for (const v of this.vehicles) {
      if (!v.cop || v.dead || !v.ai || this.wanted === 0) continue;
      const d = v.pos.distanceTo(pp);
      if (v.kind === 'heli' && v.ai.mode !== 'leave') {
        if (d < 90 && v.fireCd <= 0) {
          const eye = v.pos.clone().add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(v.forward, 2.5);
          const aim = pp.clone().add(new THREE.Vector3(0, 1, 0));
          if (this.world.lineClear(eye, aim)) { this.npcFire(v, eye, aim, d * 1.4); v.fireCd = 0.18; } else v.fireCd = 0.5;
          v.burst = (v.burst || 0) + 1;
          if (v.burst > 12) { v.burst = 0; v.fireCd = 2.5; }
        }
      } else if (v.kind === 'tank') {
        v.turretTarget = Math.atan2(pp.x - v.pos.x, pp.z - v.pos.z);
        if (d < 80 && v.fireCd <= 0) {
          const eye = v.pos.clone().add(new THREE.Vector3(0, 2.4, 0));
          const aim = pp.clone().add(new THREE.Vector3(0, 0.8, 0));
          if (this.world.lineClear(eye, aim)) {
            const dir = aim.clone().sub(eye).normalize();
            dir.x += (Math.random() - 0.5) * 0.06; dir.z += (Math.random() - 0.5) * 0.06;
            this.launchRocket(eye.addScaledVector(dir, 4), dir.normalize(), v, 90, 45, true);
            audio.shot('tank', clamp(1 - d / 100, 0.2, 1));
            v.fireCd = 4.5;
          } else v.fireCd = 1;
        }
      } else if (v.kind === 'car' && this.player.vehicle && this.wanted >= 2 && d < 28 && v.fireCd <= 0) {
        const eye = v.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
        const aim = pp.clone().add(new THREE.Vector3(0, 0.8, 0));
        if (this.world.lineClear(eye, aim)) { this.npcFire(v, eye, aim, d); v.fireCd = 0.9; } else v.fireCd = 0.6;
      }
    }
  }

  // ---------------- missions & zones ----------------
  updateObjective() {
    const banks = this.world.zones.banks.filter((b) => b.cooldown <= 0).length;
    let text;
    if (this.loot > 0) text = this.wanted > 0 ? '💰 Оторвись от копов и вези деньги в <b>УБЕЖИЩЕ</b>' : '💰 Вези деньги в <b>УБЕЖИЩЕ</b> (зелёный $ на карте)';
    else if (this.heist) text = '🔓 Взламывай хранилище! Держи <b>E</b>';
    else if (banks) text = '🏦 Ограбь <b>банк</b> (жёлтый $ на карте) · дрифтуй, прыгай, собирай 🐟';
    else text = '🏦 Банки закрыты на пересменку. Покатайся, подрифти, найди всех рыбок!';
    if (text !== this._obj) { this._obj = text; this.hud.objective(text); }
  }

  updateZones(dt, inp) {
    const p = this.player;
    const pp = this.playerPos();
    let hint = '';
    const z = this.world.zones;
    // banks
    for (const b of z.banks) {
      if (b.cooldown > 0) {
        b.cooldown -= dt;
        if (b.cooldown <= 0) { b.door.rotation.set(Math.PI / 2, 0, 0); b.door.position.x = b.pos.x; b.wheel.visible = true; }
        continue;
      }
      const d = Math.hypot(pp.x - b.pos.x, pp.z - b.pos.z);
      if (!p.vehicle && d < 4) {
        if (!this.heist || this.heist.bank !== b) hint = 'Держи <kbd>E</kbd> — взломать хранилище';
        if (inp.interact) {
          if (!this.heist || this.heist.bank !== b) {
            this.heist = { bank: b, t: 0 };
            audio.alarm();
            this.addWanted(3, 'ОГРАБЛЕНИЕ БАНКА! Сработала сигнализация');
            this.scarePeds(b.pos, 60);
            this.copTimer = 3;
          }
          this.heist.t += dt;
          b.wheel.rotation.z += dt * 4;
          if (Math.random() < dt * 20) this.fx.glow.emit(b.wheel.position.x, b.wheel.position.y, b.wheel.position.z - 0.2, { vx: (Math.random() - 0.5) * 6, vy: Math.random() * 4, vz: -Math.random() * 3, life: 0.3, size: 0.1, color: 0xffd080, gravity: 15 });
          if (this.heist.t >= 6) {
            const amount = 4000 + Math.floor(Math.random() * 6000);
            this.loot += amount;
            b.cooldown = 150;
            b.door.rotation.set(Math.PI / 2, 0, 0);
            b.door.position.x = b.pos.x - 2.4;
            b.door.rotation.z = 0;
            b.wheel.visible = false;
            this.heist = null;
            audio.mission();
            // guards burst in through the front door
            for (let k = 0; k < 3; k++) this.peds.push(new Ped(this, b.entrance.x + (k - 1) * 4, b.entrance.z - 6, { cop: true }));
            this.hud.big('ХРАНИЛИЩЕ ВСКРЫТО!', `+$${amount} в сумке — вези в убежище`, 'good');
            setTimeout(() => this.state === 'play' && this.hud.big(''), 2500);
            for (let k = 0; k < 40; k++) this.fx.smoke.emit(b.pos.x, 2, b.pos.z, { vx: (Math.random() - 0.5) * 8, vy: 3 + Math.random() * 5, vz: -Math.random() * 6, life: 2, size: 0.3, color: 0x5fd35f, gravity: 6, drag: 1 });
          }
        }
      }
      if (this.heist && this.heist.bank === b && d > 6) this.heist = null;
    }
    this.hud.progress(this.heist ? this.heist.t / 6 : null, 'ВЗЛОМ ХРАНИЛИЩА');

    // hideout delivery
    const h = z.hideout;
    if (h && this.loot > 0 && Math.hypot(pp.x - h.pos.x, pp.z - h.pos.z) < h.r) {
      if (this.wanted > 0) hint = 'Копы на хвосте! Сначала оторвись от погони';
      else {
        const amount = this.loot;
        this.loot = 0;
        this.money += amount;
        audio.mission();
        this.hud.big('ДЕЛО СДЕЛАНО!', `+$${amount}`, 'good');
        setTimeout(() => this.state === 'play' && this.hud.big(''), 2500);
        this.save();
      }
    }
    // spray shop
    const s = z.spray;
    const v = p.vehicle;
    if (s && v && v.kind !== 'heli') {
      const inside = Math.hypot(v.pos.x - s.pos.x, v.pos.z - s.pos.z) < s.r;
      if (inside && !this.inSpray) {
        if (this.wanted > 0 || v.hp < v.spec.hp) {
          const cost = 250;
          if (this.money >= cost || this.wanted > 0) {
            this.money = Math.max(0, this.money - cost);
            this.wanted = 0;
            this.callOffCops();
            v.hp = v.spec.hp;
            if (v.kind === 'car' && v.model !== 'police') {
              const col = [0xd8262a, 0x2a6cff, 0xf3c41c, 0xf2f2f2, 0x35c995, 0x1a1a1a, 0xf06aa8][Math.floor(Math.random() * 7)];
              v.group.children[0].material = mat(col, { metalness: 0.5, roughness: 0.3 });
            }
            audio.mission();
            this.hud.popup(`ПОКРАСКА -$${cost}: розыск снят, машина как новая`, '#7cf');
          }
        } else this.hud.popup('Покраска: нечего чинить', '#ccc');
      }
      this.inSpray = inside;
    } else if (!v) this.inSpray = false;

    // pickups
    if (!p.vehicle) {
      for (const pk of this.pickups) {
        if (pk.respawn > 0) { pk.respawn -= dt; if (pk.respawn <= 0) pk.mesh.visible = true; continue; }
        if (p.pos.distanceTo(pk.pos) < 1.8) {
          pk.mesh.visible = false;
          pk.respawn = 45;
          audio.pickup();
          if (pk.health) { p.hp = 100; this.hud.popup('АПТЕЧКА +100', '#ff7a8a'); } else {
            p.give(pk.weapon);
            this.hud.popup(`${WEAPONS[pk.weapon].name.toUpperCase()}! (клавиша ${WEAPON_ORDER.indexOf(pk.weapon) + 1})`, '#66d9ff');
            this.save();
          }
        }
      }
      for (let i = 0; i < this.fish.length; i++) {
        const f = this.fish[i];
        if (f.found || p.pos.distanceTo(f.pos) > 1.8) continue;
        f.found = true;
        f.mesh.visible = false;
        this.fishFound.add(i);
        this.hud.fish(this.fishFound.size, this.fish.length);
        this.earn(250, `🐟 РЫБКА ${this.fishFound.size}/${this.fish.length}`);
        if (this.fishFound.size === this.fish.length) { this.earn(10000, 'ВСЕ РЫБКИ НАЙДЕНЫ!'); }
        this.save();
      }
    }
    for (let i = this.cash.length - 1; i >= 0; i--) {
      const c = this.cash[i];
      c.t -= dt;
      c.mesh.rotation.z += dt * 3;
      if (c.t <= 0) { c.mesh.removeFromParent(); this.cash.splice(i, 1); continue; }
      if (c.mesh.position.distanceTo(pp) < 2) {
        c.mesh.removeFromParent();
        this.cash.splice(i, 1);
        if (c.weapon) { p.give(c.weapon); this.hud.popup(WEAPONS[c.weapon].name.toUpperCase(), '#66d9ff'); }
        if (c.amount) this.earn(c.amount, '');
      }
    }

    // vehicle hint
    if (!p.vehicle && !hint) {
      for (const v of this.vehicles) {
        if (v.dead || v.burning > 0) continue;
        if (Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z) < v.spec.enter + 1 && Math.abs(v.pos.y - p.pos.y) < 3) {
          const name = { car: 'машину', moto: 'мотоцикл', tank: 'ТАНК', heli: 'вертолёт' }[v.kind];
          hint = `<kbd>F</kbd> — ${v.ai ? 'угнать' : 'сесть в'} ${name}`;
          break;
        }
      }
    } else if (p.vehicle && !hint) {
      const v = p.vehicle;
      hint = v.kind === 'heli'
        ? '<kbd>Пробел</kbd> вверх · <kbd>Shift</kbd> вниз · <kbd>W/S</kbd> наклон · <kbd>A/D</kbd> поворот · <kbd>ЛКМ</kbd> пулемёт · <kbd>F</kbd> выйти'
        : v.kind === 'tank'
          ? '<kbd>WASD</kbd> ехать · мышь — башня · <kbd>ЛКМ</kbd> выстрел · <kbd>F</kbd> выйти'
          : '<kbd>Пробел</kbd> ручник/дрифт · <kbd>Shift</kbd> нитро · <kbd>H</kbd> гудок · <kbd>F</kbd> выйти';
    }
    this.hud.hint(hint);
  }

  // ---------------- death / arrest ----------------
  wasted() {
    if (this.state !== 'play') return;
    this.state = 'wasted';
    this.endT = 3.5;
    audio.wasted();
    if (this.player.vehicle) this.exitVehicle(true);
    this.player.penguin.setExpression('out');
    const fee = Math.min(this.money, 100 + Math.floor(this.money * 0.05));
    this.money -= fee;
    this.hud.big('ПОТРАЧЕНО', `Больница: -$${fee}${this.loot ? ` · добыча $${this.loot} потеряна` : ''}`, 'bad');
    this.respawnAt = this.world.zones.hospital;
  }

  busted() {
    if (this.state !== 'play') return;
    this.state = 'wasted';
    this.endT = 3.5;
    audio.wasted();
    if (this.player.vehicle) this.exitVehicle(true);
    const fee = Math.min(this.money, 200 + Math.floor(this.money * 0.05));
    this.money -= fee;
    this.hud.big('ПОВЯЗАЛИ', `Залог: -$${fee}${this.loot ? ` · добыча $${this.loot} конфискована` : ''}`, 'blue');
    this.respawnAt = this.world.zones.police;
  }

  respawn() {
    const p = this.player;
    p.pos.copy(this.respawnAt || this.world.spawnPoint);
    p.vel.set(0, 0, 0);
    p.hp = 100;
    p.penguin.setExpression('normal');
    p.lieAngle = 0;
    p.slide = 0;
    this.loot = 0;
    this.wanted = 0;
    this.heist = null;
    this.callOffCops();
    for (let i = this.peds.length - 1; i >= 0; i--) if (this.peds[i].cop) { this.peds[i].remove(); this.peds.splice(i, 1); }
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.cop && v.kind !== 'car') this.removeVehicle(v);
    }
    this.state = 'play';
    this.timeScale = 1;
    this.hud.big('');
    this.save();
  }

  checkBusted(dt) {
    if (this.wanted === 0) { this.bustT = 0; return; }
    const p = this.player;
    const v = p.vehicle;
    let close = false;
    for (const c of this.peds) {
      if (!c.cop || c.state !== 'chase') continue;
      const d = c.pos.distanceTo(this.playerPos());
      if (!v && d < 1.7 && Math.hypot(p.vel.x, p.vel.z) < 3.5) close = true;
      if (v && v.kind !== 'tank' && v.kind !== 'heli' && d < 3.5 && v.speed < 1) close = true;
    }
    this.bustT = close ? this.bustT + dt : Math.max(0, this.bustT - dt * 2);
    if (this.bustT > (v ? 2.5 : 1.8)) this.busted();
  }

  // ---------------- player vehicle control ----------------
  drivePlayerVehicle(dt, inp) {
    const v = this.player.vehicle;
    const p = this.player;
    if (v.kind === 'heli') {
      v.input.throttle = inp.move.y;
      v.input.steer = -inp.move.x;
      v.input.up = (inp.jump ? 1 : 0) - (inp.down ? 1 : 0);
      v.input.strafe = inp.strafe;
    } else {
      v.input.throttle = inp.move.y;
      v.input.steer = -inp.move.x;
      v.input.handbrake = inp.jump;
      v.input.boost = inp.sprint;
    }
    if (inp.horn) audio.horn();
    if (v.kind === 'moto') {
      p.penguin.update(dt, { speed: 0 });
      p.root.rotation.set(0.25 + Math.min(0.3, v.speed * 0.01), 0, 0);
      for (const f of p.penguin.flippers) f.pivot.rotation.x = -1.2;
    }
    // weapons from vehicles
    if (v.kind === 'tank') {
      v.turretTarget = this.cam.yaw;
      v.barrelTarget = clamp(-this.cam.pitch + 0.2, -0.15, 0.4);
      if (inp.attackPressed && v.fireCd <= 0) {
        v.fireCd = 1.2;
        const ud = v.group.userData;
        const tip = new THREE.Vector3(0, 0, 4).applyMatrix4(ud.barrel.matrixWorld);
        const target = this.aimPoint(v);
        const dir = target.clone().sub(tip).normalize();
        this.launchRocket(tip, dir, p, 160, 70, true);
        audio.shot('tank');
        this.fx.explosion(tip, 0.15);
        this.fx.shake = 0.5;
        v.vel.addScaledVector(dir, -1.5);
      }
    } else if (v.kind === 'heli') {
      if (inp.attack && v.fireCd <= 0 && v.rotor > 0.5) {
        v.fireCd = 0.08;
        this.playerFire(p, { dmg: 16, spread: 0.02, range: 200, heli: true });
      }
    } else if (inp.attack && p.weapon !== 'fists' && p.weapon !== 'rpg' && p.weapon !== 'shotgun' && v.fireCd <= 0) {
      v.fireCd = WEAPONS[p.weapon].rate * 1.4;
      this.playerFire(p, WEAPONS[p.weapon]);
    }
    p.pos.copy(v.pos);
    if (v.dead) { this.exitVehicle(true); p.hurt(60, null); }
  }

  updateDrift(dt) {
    const v = this.player.vehicle;
    const d = this.drift;
    if (v && (v.kind === 'car' || v.kind === 'moto') && v.onGround && v.slip > 0.3 && v.speed > 9 && v.vF > 0) {
      d.time += dt;
      d.idle = 0;
      d.mult = Math.min(5, 1 + Math.floor(d.time / 1.5) * 0.5);
      d.score += v.speed * Math.min(v.slip, 1.2) * dt * 12 * d.mult;
    } else if (d.score > 0) {
      d.idle += dt;
      if (d.idle > 1.0 || !v) {
        const cash = Math.floor(d.score / 5);
        if (cash > 5) this.earn(cash, `ДРИФТ ${Math.floor(d.score)}`);
        if (d.score > this.bestDrift) { this.bestDrift = d.score; if (d.score > 500) this.hud.popup('НОВЫЙ РЕКОРД ДРИФТА!', '#ffd34a'); }
        this.drift = { score: 0, mult: 1, time: 0, idle: 0 };
      }
    }
    this.hud.setDrift(this.drift);
  }

  // ---------------- camera ----------------
  updateCamera(dt, inp) {
    const c = this.cam;
    const p = this.player;
    const v = p.vehicle;
    const sens = this.input.touch ? 0.004 : 0.0024;
    c.yaw -= inp.lookX * sens;
    c.pitch = clamp(c.pitch + inp.lookY * sens, -0.9, 1.25);
    if (inp.lookX || inp.lookY) c.idle = 0; else c.idle += dt;
    if (inp.camera) c.mode = (c.mode + 1) % 3;
    const aiming = !v && p.aimT > 0 && inp.aim;
    let target, dist, fov = 68;
    if (v) {
      const big = v.kind === 'heli' ? 15 : v.kind === 'tank' ? 11 : v.kind === 'moto' ? 6 : 8;
      dist = big * [1, 1.4, 0.7][c.mode];
      target = v.pos.clone().add(new THREE.Vector3(0, v.kind === 'heli' ? 2.5 : v.kind === 'tank' ? 3 : 1.6, 0));
      fov = 68 + Math.min(18, v.speed * 0.35);
      if (c.idle > 1.2 && v.kind !== 'tank' && (v.speed > 4 || v.kind === 'heli')) {
        const head = v.kind === 'heli' ? v.yaw : v.vF >= 0 ? Math.atan2(v.vel.x, v.vel.z) * 0.4 + v.yaw * 0.6 : v.yaw;
        const ang = v.kind === 'heli' ? v.yaw : wrap(head - v.yaw) + v.yaw;
        c.yaw += wrap(ang - c.yaw) * Math.min(1, dt * 2.5);
        c.pitch += ((v.kind === 'heli' ? 0.35 : 0.18) - c.pitch) * Math.min(1, dt * 1.5);
      }
    } else {
      dist = aiming ? 3.4 : 5.5 * [1, 1.4, 0.75][c.mode];
      target = p.pos.clone().add(new THREE.Vector3(0, aiming ? 2.0 : 1.7, 0));
      if (aiming) {
        target.add(new THREE.Vector3(-Math.cos(c.yaw) * 1.25, 0, Math.sin(c.yaw) * 1.25));
        fov = 50;
      }
    }
    c.fov += (fov - c.fov) * Math.min(1, dt * 6);
    c.dist += (dist - c.dist) * Math.min(1, dt * 8);
    const look = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), -Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch));
    const back = look.clone().negate();
    const hit = this.world.raycast(target, back, c.dist + 0.3, true);
    let d = c.dist;
    if (hit) d = Math.max(0.6, hit.t - 0.35);
    const pos = target.clone().addScaledVector(back, d);
    pos.y = Math.max(pos.y, 0.4);
    if (this.fx.shake > 0) {
      const s = this.fx.shake * 0.35;
      pos.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(pos.clone().add(look));
    if (Math.abs(this.camera.fov - c.fov) > 0.05) { this.camera.fov = c.fov; this.camera.updateProjectionMatrix(); }
    this.sun.position.set(target.x + 60, target.y + 120, target.z + 40);
    this.sun.target.position.copy(target);
    this.sky.position.copy(pos);
  }

  // ---------------- main loop ----------------
  frame() {
    const now = performance.now();
    let dt = this.fixedDt || Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const realDt = dt;
    const inp = this.state === 'menu' ? null : this.input.sample();
    if (inp?.pause && this.state === 'play') { document.exitPointerLock?.(); this.pause(); }
    if (inp?.mute) audio.toggle();
    if (inp?.map) { this.fullmap = !this.fullmap; this.hud.showFullmap(this.fullmap); }

    if (this.state === 'menu') {
      // slow orbit behind the menu
      this.cam.yaw += dt * 0.08;
      this.updateCamera(dt, { lookX: 0, lookY: 0 });
      this.fx.update(dt, this.camera);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.state === 'wasted') {
      this.timeScale = 0.3;
      this.endT -= dt;
      if (this.endT <= 0) this.respawn();
    }
    dt *= this.timeScale;
    const blank = { move: { x: 0, y: 0 }, lookX: inp.lookX, lookY: inp.lookY };
    const pin = this.state === 'play' ? inp : blank;
    const p = this.player;

    if (pin.enterPressed) this.tryEnter();
    if (p.vehicle) this.drivePlayerVehicle(dt, pin);
    else if (this.state === 'play') p.update(dt, pin);
    else {
      p.vel.x *= 0.9; p.vel.z *= 0.9;
      p.integrate(dt, this.world);
      p.lieAngle += (-1.45 - p.lieAngle) * Math.min(1, dt * 6);
      p.sync(dt, {});
      p.root.position.y += 0.6 * Math.min(1, -p.lieAngle / 1.45);
    }

    for (const v of this.vehicles) {
      if (v.ai && v.driver !== 'player') {
        if (v.ai.mode === 'leave') {
          v.input.up = 1; v.input.throttle = 1; v.input.steer = 0.2;
          if (v.pos.y > 120) v.dead = true;
        } else v.aiDrive(dt, this);
      }
      const far = v.pos.distanceTo(this.playerPos()) > 200;
      if (!far || v.driver) v.update(dt, this.world, this);
    }
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.leaving && v.dead) this.removeVehicle(v);
    }
    this.vehicleCollisions(dt);
    for (const ped of this.peds) ped.update(dt);
    this.updateProjectiles(dt);
    this.updateCopWeapons(dt);
    if (this.state === 'play') {
      this.manageSpawns(dt);
      this.managePolice(dt);
      this.checkBusted(dt);
      this.updateZones(dt, pin);
      this.updateDrift(dt);
      this.updateObjective();
    }

    // pickups & fish spin
    const t = performance.now() / 1000;
    for (const pk of this.pickups) { pk.mesh.rotation.y = t * 1.5; pk.mesh.position.y = pk.pos.y + Math.sin(t * 2) * 0.15; }
    for (const f of this.fish) if (!f.found) { f.mesh.rotation.y = t * 2; f.mesh.position.y = f.pos.y + Math.sin(t * 3 + f.pos.x) * 0.2; }

    this.updateCamera(realDt, pin);
    this.fx.update(dt, this.camera);
    this.hud.update(dt);
    this.updateHud();
    this.updateAudio(t);

    this.saveTimer += dt;
    if (this.saveTimer > 10) { this.saveTimer = 0; this.save(); }
    this.renderer.render(this.scene, this.camera);
  }

  updateHud() {
    const p = this.player;
    this.hud.setMoney(this.money, this.loot);
    this.hud.setWanted(this.wanted, !this.seen);
    this.hud.setWeapon(p);
    this.hud.setHealth(p.hp);
    this.hud.setVehicle(p.vehicle);
    const v = p.vehicle;
    const showX = (!v && (p.weapon !== 'fists' && p.aimT > 0)) || (v && (v.kind === 'tank' || v.kind === 'heli')) || (v && p.weapon !== 'fists' && this.input.mouse.left);
    this.hud.crosshair(showX && this.state === 'play', v ? v.kind : p.weapon);

    // map blips
    const blips = [];
    for (const b of this.world.zones.banks) blips.push({ x: b.pos.x, z: b.pos.z, icon: '$', color: b.cooldown > 0 ? '#777' : '#ffd34a', size: 15, edge: !this.loot && b.cooldown <= 0 });
    const h = this.world.zones.hideout;
    if (h) blips.push({ x: h.pos.x, z: h.pos.z, icon: '$', color: '#7cff6a', size: 15, edge: this.loot > 0 });
    const s = this.world.zones.spray;
    if (s) blips.push({ x: s.pos.x, z: s.pos.z, icon: '🎨', size: 13, edge: this.wanted > 0 });
    if (this.world.zones.hospital) blips.push({ x: this.world.zones.hospital.x, z: this.world.zones.hospital.z, icon: '+', color: '#ff5566', size: 14 });
    for (const pk of this.pickups) if (pk.mesh.visible && !pk.health) blips.push({ x: pk.pos.x, z: pk.pos.z, icon: '🔫', size: 12 });
    for (const f of this.fish) if (!f.found) blips.push({ x: f.pos.x, z: f.pos.z, color: '#ffc93a', size: 3 });
    for (const v of this.vehicles) {
      if (v.dead || v.driver === 'player') continue;
      if (v.cop) blips.push({ x: v.pos.x, z: v.pos.z, color: Math.floor(performance.now() / 250) % 2 ? '#ff3030' : '#3060ff', size: 5, edge: true });
      else if (v.kind === 'heli' || v.kind === 'tank') blips.push({ x: v.pos.x, z: v.pos.z, icon: v.kind === 'heli' ? '🚁' : '🪖', size: 13 });
    }
    for (const c of this.peds) if (c.cop && c.state === 'chase') blips.push({ x: c.pos.x, z: c.pos.z, color: '#5080ff', size: 3 });
    const pp = this.playerPos();
    this.hud.drawMinimap(pp.x, pp.z, this.cam.yaw, blips, p.vehicle && p.vehicle.speed > 20 ? 0.75 : 1);
    if (this.fullmap) this.hud.drawFullmap(pp.x, pp.z, this.cam.yaw, blips);
  }

  updateAudio(t) {
    const v = this.player.vehicle;
    let engine = 0, rpm = 0, rotor = 0, skid = 0, siren = 0;
    if (v && this.state === 'play') {
      if (v.kind === 'heli') rotor = v.rotor;
      else {
        engine = v.kind === 'tank' ? 1.3 : 1;
        const gear = v.speed / (v.spec.max / 5);
        rpm = Math.min(1.2, 0.15 + (gear % 1) * 0.7 + Math.min(1, gear / 5) * 0.3) * (v.kind === 'moto' ? 1.4 : v.kind === 'tank' ? 0.4 : 1);
        if (v.skidding) skid = Math.min(1, v.slip * 1.5 + 0.2);
      }
    }
    let nearestCop = Infinity, nearestHeli = Infinity;
    const pp = this.playerPos();
    for (const c of this.vehicles) {
      if (c.dead || !c.cop) continue;
      const d = c.pos.distanceTo(pp);
      if (c.kind === 'heli') nearestHeli = Math.min(nearestHeli, d);
      else if (c.sirenOn) nearestCop = Math.min(nearestCop, d);
    }
    siren = this.wanted > 0 ? clamp(1 - nearestCop / 120, 0, 1) : 0;
    rotor = Math.max(rotor, clamp(1 - nearestHeli / 150, 0, 1) * 0.7);
    audio.loops({ engine, rpm, rotor, siren, skid, t });
  }
}

window.game = new Game();
