import * as THREE from 'three';
import { createEnvironment, createArena } from './environment.js';
import { Penguin } from './penguin.js';
import { skinThumb } from './thumbs.js';
import { sfx } from './sfx.js';
import { net } from './net.js';
import { MAX_AIM, PENGUIN_RADIUS, WATER_LEVEL } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);
const INTERP_DELAY = 80; // ms behind the newest server snapshot

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Flat glowing arrow lying on the ice, pointing along +z from the origin. */
class Arrow {
  constructor() {
    this.group = new THREE.Group();
    this.color = new THREE.Color();
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
    const fade = new THREE.CanvasTexture(c);
    const mk = (opacity, map, glow = false) => new THREE.MeshBasicMaterial({
      color: 0xd8ff3a, transparent: true, opacity, depthWrite: false, map,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.mats = [mk(0.9, fade), mk(0.95, null), mk(0.25, fade, true), mk(0.3, null, true)];

    const shaftGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    shaftGeo.scale(1, 1, -1); // so +z of the plane is the far end (uv v=1)
    const head = new THREE.Shape();
    head.moveTo(-0.62, 0); head.lineTo(0.62, 0); head.lineTo(0, 1.0); head.lineTo(-0.62, 0);
    // ShapeGeometry is in XY; after rotateX(+90deg) its y axis points along +z
    const headGeo = new THREE.ShapeGeometry(head).rotateX(Math.PI / 2);
    this.shaft = new THREE.Mesh(shaftGeo, this.mats[0]);
    this.head = new THREE.Mesh(headGeo, this.mats[1]);
    this.glowShaft = new THREE.Mesh(shaftGeo, this.mats[2]);
    this.glowHead = new THREE.Mesh(headGeo, this.mats[3]);
    for (const m of [this.glowShaft, this.glowHead, this.shaft, this.head]) {
      m.renderOrder = 5;
      this.group.add(m);
    }
    this.group.position.y = 0.04;
  }

  set(from, dx, dz, opacity = 1) {
    const len = Math.hypot(dx, dz);
    this.group.visible = len > 0.25;
    if (!this.group.visible) return;
    const power = Math.min(1, len / MAX_AIM);
    const start = PENGUIN_RADIUS * 0.9;
    const total = Math.max(0.6, len);
    const headLen = Math.min(1.1, total * 0.45);
    const shaftLen = Math.max(0.01, total - headLen - start * 0.3);
    this.group.position.set(from.x, 0.04, from.z);
    this.group.rotation.y = Math.atan2(dx, dz);
    this.shaft.scale.set(0.42, 1, shaftLen);
    this.shaft.position.z = start * 0.3;
    this.glowShaft.scale.set(0.9, 1, shaftLen);
    this.glowShaft.position.z = start * 0.3;
    this.head.position.z = start * 0.3 + shaftLen;
    this.head.scale.set(1, 1, headLen);
    this.glowHead.position.z = this.head.position.z - 0.12;
    this.glowHead.scale.set(1.45, 1, headLen + 0.3);
    // green -> yellow -> orange as power grows
    this.color.setHSL(0.24 - power * 0.17, 1, 0.55);
    for (const m of this.mats) m.color.copy(this.color);
    this.mats[0].opacity = 0.9 * opacity; this.mats[1].opacity = 0.95 * opacity;
    this.mats[2].opacity = 0.25 * opacity; this.mats[3].opacity = 0.3 * opacity;
  }

  hide() { this.group.visible = false; }

  dispose() {
    this.group.removeFromParent();
    this.shaft.geometry.dispose();
    this.head.geometry.dispose();
    this.mats[0].map.dispose();
    for (const m of this.mats) m.dispose();
  }
}

/** CPU particles for snow spray and water splashes. */
class Particles {
  constructor(scene, max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0.9, depthWrite: false }));
    this.points.frustumCulled = false;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    scene.add(this.points);
  }

  emit(x, y, z, count, { speed = 3, up = 4, life = 0.8 } = {}) {
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * speed;
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s], i * 3);
      this.life[i] = life * (0.5 + Math.random() * 0.5);
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 14 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -999;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

export class Game {
  constructor(start, youId) {
    this.youId = youId;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 900);
    this.env = createEnvironment(this.scene, { shadowSize: 15 });
    this.arena = createArena(start.half);
    this.scene.add(this.arena.group);
    this.particles = new Particles(this.scene);
    this.rings = [];
    this.time = 0;
    this.shake = 0;
    this.phase = 'intro';
    this.phaseEndsAt = 0;
    this.matchStart = performance.now();
    this.snaps = [];
    this.timeOffset = null;
    this.aim = { x: 0, z: 0 };
    this.lastAimSent = 0;
    this.aimDirty = false;
    this.pointer = null;
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.myArrow = new Arrow();
    this.scene.add(this.myArrow.group);
    this.revealArrows = [];
    this.lastTick = -1;

    this.players = new Map();
    const tags = $('nameTags');
    tags.innerHTML = '';
    for (const p of start.players) {
      const penguin = new Penguin(p.skin);
      this.scene.add(penguin.root);
      const tag = document.createElement('div');
      tag.className = 'tag' + (p.id === youId ? ' me' : '');
      tag.textContent = p.name;
      tags.appendChild(tag);
      this.players.set(p.id, {
        ...p, penguin, tag, state: 'ice', x: 0, y: 0, z: 0, yaw: 0, speed: 0,
        exprUntil: 0, outAt: 0, drift: new THREE.Vector2(),
      });
    }

    this.buildHud();
    this.resize(innerWidth / innerHeight);
  }

  get me() { return this.players.get(this.youId); }

  buildHud() {
    const icons = $('playerIcons');
    icons.innerHTML = '';
    // you first, like the reference HUD
    const list = [...this.players.values()].sort((a, b) => (a.id === this.youId ? -1 : b.id === this.youId ? 1 : 0));
    for (const p of list) {
      const el = document.createElement('div');
      el.className = 'picon' + (p.id === this.youId ? ' me' : '');
      el.title = p.name;
      el.innerHTML = `<img src="${skinThumb(p.skin)}" alt="">`;
      icons.appendChild(el);
      p.icon = el;
    }
    $('killfeed').innerHTML = '';
    $('results').classList.add('hidden');
    $('roundLabel').textContent = 'ICE BRAWL';
    this.updateAlive();
  }

  updateAlive() {
    const alive = [...this.players.values()].filter((p) => p.state !== 'out').length;
    $('aliveLabel').textContent = `Осталось пингвинов: ${alive}`;
  }

  flash(text, ms = 1200) {
    const el = $('bigText');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  feed(html) {
    const kf = $('killfeed');
    const d = document.createElement('div');
    d.innerHTML = html;
    kf.prepend(d);
    while (kf.children.length > 5) kf.lastChild.remove();
    setTimeout(() => d.remove(), 6000);
  }

  // ------------------------------------------------------------ server events

  onPhase(msg) {
    this.phase = msg.phase;
    this.phaseEndsAt = performance.now() + msg.duration;
    this.arena.setHalf(msg.half);
    const me = this.me;
    const alive = me && me.state !== 'out';
    if (msg.round) $('roundLabel').textContent = `РАУНД ${msg.round}`;
    if (msg.phase === 'intro') {
      $('phaseLabel').textContent = 'ГОТОВЬСЯ';
      $('phaseSub').textContent = 'Скоро старт…';
      this.flash('ICE BRAWL!', 1800);
    } else if (msg.phase === 'aim') {
      this.aim = { x: 0, z: 0 };
      $('phaseLabel').textContent = alive ? (matchMedia('(pointer: coarse)').matches ? 'ЦЕЛЬСЯ ПАЛЬЦЕМ!' : 'ЦЕЛЬСЯ МЫШКОЙ!') : 'НАБЛЮДЕНИЕ';
      $('phaseSub').textContent = alive ? 'СТОЛКНИ ИХ В ВОДУ!' : 'Тебя сбили — смотри, кто победит';
      this.flash(`РАУНД ${msg.round}`, 1000);
      for (const p of this.players.values()) if (p.state === 'ice') p.penguin.setExpression('normal');
    } else if (msg.phase === 'slide') {
      $('phaseLabel').textContent = 'СКОЛЬЖЕНИЕ!';
      $('phaseSub').textContent = '';
      this.myArrow.hide();
      this.flash('ВПЕРЁД!', 700);
      sfx.go();
    } else if (msg.phase === 'melt') {
      $('phaseLabel').textContent = 'ЛЬДИНА ТАЕТ!';
      $('phaseSub').textContent = 'Держись ближе к центру';
      this.flash('ЛЁД ТАЕТ!', 1300);
      sfx.crack();
      this.shake = 0.4;
    } else if (msg.phase === 'end') {
      $('phaseLabel').textContent = 'КОНЕЦ!';
      $('phaseSub').textContent = '';
      this.myArrow.hide();
    }
  }

  onLaunch(msg) {
    // briefly reveal everybody's arrows
    for (const [id, [dx, dz]] of Object.entries(msg.aims)) {
      const p = this.players.get(id);
      if (!p || (dx === 0 && dz === 0)) continue;
      const a = new Arrow();
      a.set(p, dx, dz, 1);
      this.scene.add(a.group);
      this.revealArrows.push({ arrow: a, from: { x: p.x, z: p.z }, dx, dz, life: 0.7 });
      p.penguin.setExpression('shock');
      p.exprUntil = this.time + 0.4;
    }
  }

  onState(msg) {
    const now = performance.now();
    const offset = msg.t - now;
    if (this.timeOffset === null || offset > this.timeOffset) this.timeOffset = offset;
    else this.timeOffset += (offset - this.timeOffset) * 0.05;
    const map = new Map();
    for (const [id, x, y, z, yaw, falling, speed] of msg.p) map.set(id, { x, y, z, yaw, falling, speed });
    this.snaps.push({ t: msg.t, map });
    if (this.snaps.length > 40) this.snaps.shift();
  }

  onBump(msg) {
    const power = msg.power;
    sfx.bump(power);
    this.shake = Math.min(0.6, this.shake + power * 0.04);
    this.particles.emit(msg.x, 1.0, msg.z, Math.min(40, 8 + power * 3), { speed: 4, up: 3, life: 0.5 });
    for (const id of [msg.a, msg.b]) {
      const p = this.players.get(id);
      if (!p || p.state === 'out') continue;
      p.penguin.setExpression(power > 6 ? 'dizzy' : 'shock');
      p.exprUntil = this.time + (power > 6 ? 1.6 : 0.7);
    }
  }

  onOut(msg) {
    const p = this.players.get(msg.id);
    if (!p) return;
    p.state = 'out';
    p.outAt = this.time;
    p.x = msg.x; p.z = msg.z;
    p.drift.set(msg.x, msg.z).normalize().multiplyScalar(0.25);
    p.penguin.setExpression('out');
    p.icon.classList.add('out');
    p.tag.classList.add('out');
    if (msg.left) {
      p.penguin.root.visible = false;
      p.tag.style.display = 'none';
      this.feed(`<b>${esc(p.name)}</b> вышел из игры`);
    } else {
      this.splash(msg.x, msg.z);
      const killer = msg.by && this.players.get(msg.by);
      this.feed(killer
        ? `<b>${esc(killer.name)}</b> столкнул <b>${esc(p.name)}</b> в воду`
        : `<b>${esc(p.name)}</b> упал в воду`);
      if (msg.id === this.youId) this.flash('ПЛЮХ! ТЫ В ВОДЕ', 1800);
      else if (msg.by === this.youId) this.flash('СБИЛ!', 900);
    }
    if (msg.id === this.youId) {
      this.myArrow.hide();
      $('phaseLabel').textContent = 'НАБЛЮДЕНИЕ';
    }
    this.updateAlive();
  }

  splash(x, z) {
    sfx.splash();
    this.particles.emit(x, WATER_LEVEL + 0.1, z, 70, { speed: 3.5, up: 7, life: 1.1 });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, WATER_LEVEL + 0.15, z);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, life: 1.2 });
  }

  // ------------------------------------------------------------ input

  setPointer(ndcX, ndcY) {
    this.pointer = { x: ndcX, y: ndcY };
  }

  updateAim() {
    const me = this.me;
    if (this.phase !== 'aim' || !me || me.state !== 'ice' || !this.pointer) {
      this.myArrow.hide();
      return;
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return;
    let dx = hit.x - me.x, dz = hit.z - me.z;
    const len = Math.hypot(dx, dz);
    if (len > MAX_AIM) { dx *= MAX_AIM / len; dz *= MAX_AIM / len; }
    if (Math.abs(dx - this.aim.x) > 0.01 || Math.abs(dz - this.aim.z) > 0.01) {
      this.aim = { x: dx, z: dz };
      this.aimDirty = true;
    }
    this.myArrow.set(me, dx, dz);
    if (len > 0.3) me.yaw = Math.atan2(dx, dz);
    const now = performance.now();
    if (this.aimDirty && now - this.lastAimSent > 80) {
      net.send('aim', { x: Math.round(this.aim.x * 100) / 100, z: Math.round(this.aim.z * 100) / 100 });
      this.lastAimSent = now;
      this.aimDirty = false;
    }
  }

  // ------------------------------------------------------------ frame

  resize(aspect) {
    this.camera.aspect = aspect;
    // keep the whole arena in view on narrow (portrait) screens
    const dist = aspect >= 1.5 ? 1 : Math.min(2.4, 1.5 / aspect);
    this.camera.fov = 45;
    this.camBase = new THREE.Vector3(0, 13 * dist, 21 * dist);
    this.camera.updateProjectionMatrix();
  }

  interpolate() {
    if (!this.snaps.length || this.timeOffset === null) return;
    const renderT = performance.now() + this.timeOffset - INTERP_DELAY;
    let a = this.snaps[0], b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].t <= renderT) { a = this.snaps[i]; b = this.snaps[i + 1] || null; break; }
    }
    const k = b ? (renderT - a.t) / (b.t - a.t) : 0;
    for (const [id, sa] of a.map) {
      const p = this.players.get(id);
      if (!p || p.state === 'out') continue;
      const sb = b && b.map.get(id);
      const lerp = (u, v) => (sb ? u + (v - u) * k : u);
      p.x = lerp(sa.x, sb?.x); p.y = lerp(sa.y, sb?.y); p.z = lerp(sa.z, sb?.z);
      p.speed = lerp(sa.speed, sb?.speed);
      p.state = sa.falling ? 'falling' : 'ice';
      if (this.phase !== 'aim' || id !== this.youId) {
        let dy = (sb ? sb.yaw : sa.yaw) - sa.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        p.yaw = sa.yaw + dy * k;
      }
    }
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.env.update(t);
    this.arena.update(dt);
    this.interpolate();
    this.updateAim();
    this.particles.update(dt);

    for (const p of this.players.values()) {
      const pg = p.penguin;
      if (p.state === 'out') {
        // bob in the water, dazed, drifting away from the floe
        const since = t - p.outAt;
        p.x += p.drift.x * dt; p.z += p.drift.y * dt;
        pg.root.position.set(p.x, WATER_LEVEL - 0.75 + Math.sin(t * 2 + p.x) * 0.08 - Math.min(0.4, since * 0.1), p.z);
        pg.root.rotation.y += dt * 0.4;
        pg.update(dt, { swimming: true });
      } else {
        pg.root.position.set(p.x, p.y, p.z);
        let d = p.yaw - pg.root.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        pg.root.rotation.y += d * Math.min(1, dt * 12);
        pg.update(dt, { speed: p.speed, falling: p.state === 'falling' });
        if (p.exprUntil && t > p.exprUntil) { pg.setExpression('normal'); p.exprUntil = 0; }
        if (p.speed > 3 && Math.random() < dt * p.speed * 2) {
          this.particles.emit(p.x, 0.1, p.z, 2, { speed: 1, up: 1.5, life: 0.4 });
        }
      }
    }

    for (const r of this.revealArrows) {
      r.life -= dt;
      r.arrow.set(r.from, r.dx, r.dz, Math.max(0, r.life / 0.7));
      if (r.life <= 0) r.arrow.dispose();
    }
    this.revealArrows = this.revealArrows.filter((r) => r.life > 0);

    for (const r of this.rings) {
      r.life -= dt;
      const s = 1 + (1.2 - r.life) * 3;
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = Math.max(0, r.life / 1.2) * 0.8;
      if (r.life <= 0) { r.mesh.removeFromParent(); r.mesh.geometry.dispose(); }
    }
    this.rings = this.rings.filter((r) => r.life > 0);

    // camera with a little shake on hard bumps
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const s = this.shake * this.shake;
    this.camera.position.set(
      this.camBase.x + (Math.random() - 0.5) * s,
      this.camBase.y + (Math.random() - 0.5) * s,
      this.camBase.z + (Math.random() - 0.5) * s,
    );
    this.camera.lookAt(0, -1.2, -0.3);

    this.updateTimer();
    this.updateTags();
  }

  updateTimer() {
    const el = $('timer');
    if (this.phase === 'aim' || this.phase === 'intro') {
      const left = Math.max(0, this.phaseEndsAt - performance.now());
      const sec = Math.ceil(left / 1000);
      el.textContent = `0:${String(sec).padStart(2, '0')}`;
      el.classList.toggle('urgent', this.phase === 'aim' && sec <= 3);
      if (this.phase === 'aim' && sec <= 3 && sec > 0 && sec !== this.lastTick) sfx.tick();
      this.lastTick = sec;
    } else {
      const total = Math.floor((performance.now() - this.matchStart) / 1000);
      el.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      el.classList.remove('urgent');
    }
  }

  updateTags() {
    const v = new THREE.Vector3();
    const w = innerWidth, h = innerHeight;
    for (const p of this.players.values()) {
      if (p.tag.style.display === 'none') continue;
      v.copy(p.penguin.root.position);
      v.y += 2.35;
      v.project(this.camera);
      if (v.z > 1) { p.tag.style.opacity = 0; continue; }
      p.tag.style.opacity = '';
      p.tag.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
      p.tag.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
    }
  }

  dispose() {
    $('nameTags').innerHTML = '';
    clearTimeout(this.flashTimer);
    $('bigText').classList.remove('show');
    // free per-match GPU resources; penguin geometry/materials are shared and kept
    this.scene.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (m.userData.shared) continue;
        m.map?.dispose();
        m.dispose();
      }
    });
  }
}
