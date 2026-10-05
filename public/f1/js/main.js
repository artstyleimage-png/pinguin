import * as THREE from 'three';
import { TRACKS, THEMES, trackData } from './tracks.js';
import { buildTrackScene, buildPolygon, buildSky } from './scene.js';
import { Car, CARS, buildCarModel, REDLINE } from './car.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const REC_KEY = 'f1-records-v1';
const PREF_KEY = 'f1-prefs-v1';

function load(key, def) { try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ } }

export function fmt(t) {
  if (t == null || !isFinite(t)) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
function fmtDelta(d) { return `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(3)}`; }

// --------------------------------------------------------------------------
// Input: keyboard, gamepad and on-screen buttons
// --------------------------------------------------------------------------
const keys = new Set();
const pressed = new Set();
const touch = new Set();
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
for (const b of document.querySelectorAll('#touch [data-k]')) {
  const k = b.dataset.k;
  const on = (e) => { e.preventDefault(); touch.add(k); pressed.add(`T:${k}`); b.classList.add('down'); };
  const off = (e) => { e.preventDefault(); touch.delete(k); b.classList.remove('down'); };
  b.addEventListener('touchstart', on, { passive: false });
  b.addEventListener('touchend', off);
  b.addEventListener('touchcancel', off);
  b.addEventListener('mousedown', on);
  b.addEventListener('mouseup', off);
  b.addEventListener('mouseleave', off);
}
let padPrev = [];

function sampleInput() {
  const k = (c) => keys.has(c);
  const h = (...c) => c.some((x) => pressed.has(x));
  const inp = {
    throttle: k('KeyW') || k('ArrowUp') || touch.has('gas') ? 1 : 0,
    brake: k('KeyS') || k('ArrowDown') || k('Space') || touch.has('brake') ? 1 : 0,
    steer: (k('KeyA') || k('ArrowLeft') || touch.has('left') ? 1 : 0) - (k('KeyD') || k('ArrowRight') || touch.has('right') ? 1 : 0),
    up: h('KeyE', 'ShiftLeft', 'ShiftRight', 'PageUp', 'T:up'),
    down: h('KeyQ', 'ControlLeft', 'ControlRight', 'PageDown', 'T:down'),
    cam: h('KeyC', 'T:cam'),
    reset: h('KeyR'),
    pause: h('Escape', 'KeyP', 'T:pause'),
    mute: h('KeyN'),
    analog: false,
  };
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const gp = pads[0];
  if (gp) {
    const btn = (i) => gp.buttons[i] && (gp.buttons[i].value > 0.5 || gp.buttons[i].pressed);
    const edge = (i) => btn(i) && !padPrev[i];
    const ax = gp.axes[0] || 0;
    if (Math.abs(ax) > 0.08) { inp.steer = -Math.sign(ax) * ((Math.abs(ax) - 0.08) / 0.92) ** 1.4; inp.analog = true; }
    inp.throttle = Math.max(inp.throttle, gp.buttons[7]?.value || 0);
    inp.brake = Math.max(inp.brake, gp.buttons[6]?.value || 0);
    if (edge(5) || edge(1)) inp.up = true;
    if (edge(4) || edge(2)) inp.down = true;
    if (edge(3)) inp.cam = true;
    if (edge(9)) inp.pause = true;
    padPrev = gp.buttons.map((b) => b.value > 0.5 || b.pressed);
  }
  pressed.clear();
  return inp;
}

// --------------------------------------------------------------------------
// Game
// --------------------------------------------------------------------------
class Game {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);
    this.records = load(REC_KEY, {});
    const prefs = load(PREF_KEY, {});
    this.sel = { mode: prefs.mode || 'trial', track: prefs.track || 'lago', car: prefs.car || 'rosso', laps: prefs.laps || 3, box: prefs.box || 'auto', ghost: prefs.ghost ?? true };
    this.state = 'menu';
    this.camMode = 0;
    this.last = performance.now();
    addEventListener('resize', () => this.resize());
    this.resize();
    this.buildLeds();
    this.buildMenu();
    this.bindMenu();
    this.showroom();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  savePrefs() { store(PREF_KEY, this.sel); }

  // ---------------- menu ----------------
  buildMenu() {
    const tracks = $('tracks');
    tracks.innerHTML = '';
    for (const def of TRACKS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'track';
      b.dataset.id = def.id;
      const T = def.empty ? null : trackData(def);
      const rec = this.records[def.id];
      b.innerHTML = `<canvas width="320" height="200"></canvas><b>${def.name}</b>
        <div class="meta"><span>${def.tag}</span><span>${T ? (T.length / 1000).toFixed(2) + ' км' : '∞'}</span></div>
        <div class="rec">${def.empty ? (rec?.vmax ? `макс. ${Math.round(rec.vmax)} км/ч` : 'замеры разгона') : rec?.time ? `рекорд ${fmt(rec.time)}` : 'рекорда нет'}</div>`;
      this.drawPreview(b.querySelector('canvas'), T);
      b.addEventListener('click', () => { this.sel.track = def.id; if (def.empty) this.sel.mode = 'free'; this.refreshMenu(); this.savePrefs(); });
      tracks.appendChild(b);
    }
    if (!$('about')) {
      const about = document.createElement('p');
      about.className = 'about';
      about.id = 'about';
      tracks.after(about);
    }

    const cars = $('cars');
    cars.innerHTML = '';
    const bar = (label, v) => `<div class="stat">${label}<span><i style="width:${Math.round(((v - 0.9) / 0.18) * 100)}%"></i></span></div>`;
    for (const c of CARS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'car';
      b.dataset.id = c.id;
      const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
      b.innerHTML = `<div class="livery" style="background:linear-gradient(90deg, ${hex(c.main)} 0 65%, ${hex(c.second)} 65% 85%, ${hex(c.accent)} 85%)"></div>
        <b>${c.name}</b><small>${c.note}</small>${bar('Мотор', c.power)}${bar('Сцепление', c.grip)}${bar('Аэро', 2 - c.drag)}`;
      b.addEventListener('click', () => { this.sel.car = c.id; this.refreshMenu(); this.savePrefs(); this.showroom(); });
      cars.appendChild(b);
    }
    this.refreshMenu();
  }

  /** Listeners for the fixed menu and panel controls (bound once). */
  bindMenu() {
    for (const b of document.querySelectorAll('#modes button')) b.addEventListener('click', () => { this.sel.mode = b.dataset.mode; this.refreshMenu(); this.savePrefs(); });
    for (const b of document.querySelectorAll('#laps button')) b.addEventListener('click', () => { this.sel.laps = +b.dataset.laps; this.refreshMenu(); this.savePrefs(); });
    for (const b of document.querySelectorAll('#box button')) b.addEventListener('click', () => { this.sel.box = b.dataset.box; this.refreshMenu(); this.savePrefs(); });
    for (const b of document.querySelectorAll('#ghostOpt button')) b.addEventListener('click', () => { this.sel.ghost = b.dataset.ghost === '1'; this.refreshMenu(); this.savePrefs(); });
    $('go').addEventListener('click', () => this.start());
    $('mute').addEventListener('click', () => { audio.init(); $('mute').textContent = audio.toggle() ? 'Звук: выкл' : 'Звук: вкл'; });
    $('mute').textContent = audio.muted ? 'Звук: выкл' : 'Звук: вкл';
    $('resume').addEventListener('click', () => this.resume());
    $('restart').addEventListener('click', () => this.start());
    $('toMenu').addEventListener('click', () => this.toMenu());
    $('toggleBox').addEventListener('click', () => {
      this.sel.box = this.sel.box === 'auto' ? 'manual' : 'auto';
      if (this.car) this.car.auto = this.sel.box === 'auto';
      this.savePrefs();
      this.refreshMenu();
    });
    this.refreshMenu();
  }

  refreshMenu() {
    const def = TRACKS.find((t) => t.id === this.sel.track) || TRACKS[0];
    if (def.empty) this.sel.mode = 'free';
    for (const b of document.querySelectorAll('.track')) b.classList.toggle('on', b.dataset.id === this.sel.track);
    for (const b of document.querySelectorAll('.car')) b.classList.toggle('on', b.dataset.id === this.sel.car);
    for (const b of document.querySelectorAll('#modes button')) {
      b.classList.toggle('on', b.dataset.mode === this.sel.mode);
      b.disabled = def.empty && b.dataset.mode === 'trial';
    }
    for (const b of document.querySelectorAll('#laps button')) { b.classList.toggle('on', +b.dataset.laps === this.sel.laps); b.disabled = this.sel.mode !== 'trial'; }
    for (const b of document.querySelectorAll('#box button')) b.classList.toggle('on', b.dataset.box === this.sel.box);
    for (const b of document.querySelectorAll('#ghostOpt button')) b.classList.toggle('on', (b.dataset.ghost === '1') === this.sel.ghost);
    $('about').textContent = def.about;
    $('toggleBox').textContent = `Коробка: ${this.sel.box === 'auto' ? 'автомат' : 'ручная'}`;
  }

  drawPreview(cv, T) {
    const g = cv.getContext('2d');
    g.fillStyle = '#0f1215';
    g.fillRect(0, 0, cv.width, cv.height);
    if (!T) {
      g.strokeStyle = '#2f3540';
      g.lineWidth = 1;
      for (let x = 0; x < cv.width; x += 20) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, cv.height); g.stroke(); }
      for (let y = 0; y < cv.height; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(cv.width, y); g.stroke(); }
      g.strokeStyle = '#ffd400';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(cv.width / 2, cv.height - 10); g.lineTo(cv.width / 2, 10); g.stroke();
      return;
    }
    const map = this.mapTransform(T, cv.width, cv.height, 18);
    g.lineJoin = 'round';
    g.strokeStyle = '#3a414c';
    g.lineWidth = 9;
    this.strokeTrack(g, T, map);
    g.strokeStyle = '#f1f3f5';
    g.lineWidth = 3;
    this.strokeTrack(g, T, map);
    const [sx, sy] = map(T.pts[0].x, T.pts[0].z);
    g.fillStyle = '#e10600';
    g.fillRect(sx - 4, sy - 4, 8, 8);
  }

  mapTransform(T, w, h, pad) {
    const b = T.box;
    const sx = (w - pad * 2) / (b.max.x - b.min.x), sz = (h - pad * 2) / (b.max.z - b.min.z);
    const s = Math.min(sx, sz);
    const ox = (w - (b.max.x - b.min.x) * s) / 2, oz = (h - (b.max.z - b.min.z) * s) / 2;
    // mirror x so the map reads like the view from above with north up
    return (x, z) => [w - (ox + (x - b.min.x) * s), oz + (b.max.z - z) * s];
  }

  strokeTrack(g, T, map) {
    g.beginPath();
    T.pts.forEach((p, i) => { const [x, y] = map(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath();
    g.stroke();
  }

  /** The selected car turning slowly behind the menu. */
  showroom() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0e11);
    scene.add(new THREE.HemisphereLight(0xd8e4f0, 0x202428, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(6, 10, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff4a3a, 1.2);
    rim.position.set(-6, 3, -6);
    scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.35, metalness: 0.3 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const spec = CARS.find((c) => c.id === this.sel.car) || CARS[0];
    const { group } = buildCarModel(spec);
    scene.add(group);
    this.show = { scene, car: group, a: this.show?.a || 0.6 };
  }

  // ---------------- session ----------------
  start() {
    audio.init();
    const def = TRACKS.find((t) => t.id === this.sel.track) || TRACKS[0];
    const spec = CARS.find((c) => c.id === this.sel.car) || CARS[0];
    this.def = def;
    this.mode = def.empty ? 'free' : this.sel.mode;
    const theme = THEMES[def.theme];
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.fog = new THREE.Fog(theme.fog, 250, 2200);
    this.sky = buildSky(scene, theme);
    scene.add(new THREE.HemisphereLight(0xe6f0fa, 0x4a4a40, 1.15));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -60; sc.right = sc.top = 60; sc.near = 1; sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sun = sun;

    if (def.empty) {
      this.T = null;
      buildPolygon(scene);
      this.gantry = null;
    } else {
      this.T = trackData(def);
      this.gantry = buildTrackScene(scene, this.T);
    }
    this.car = new Car(spec, this.T);
    this.car.auto = this.sel.box === 'auto';
    scene.add(this.car.mesh);
    if (this.T) {
      const T = this.T;
      const k = (T.n - Math.round(14 / T.step)) % T.n;
      const p = T.pts[k], t = T.tan[k], nr = T.nrm[k];
      this.car.place(p.x + nr.x * 3, p.y, p.z + nr.z * 3, Math.atan2(t.x, t.z));
    } else this.car.place(0, 0, -20, 0);

    // ghost of the track record
    this.ghost = null;
    const rec = this.records[def.id];
    if (this.T && this.sel.ghost && rec?.ghost?.length) {
      const gspec = CARS.find((c) => c.id === rec.car) || spec;
      const gm = buildCarModel(gspec, { ghost: true }).group;
      gm.visible = false;
      scene.add(gm);
      this.ghost = { mesh: gm, data: rec.ghost };
    }

    this.lap = { n: 0, start: null, valid: true, sectors: [null, null, null], samples: [] };
    this.laps = [];
    this.bestSession = null;
    this.simT = 0;
    this.prevS = this.car.loc ? this.car.loc.s : 0;
    this.started = false;
    this.poly = { t0: null, best: rec && def.empty ? rec : {}, run: {} };
    this.camPos = null;
    this.msgT = 0;
    this.showMsg('');
    this.refreshMenu();
    $('menu').classList.add('hidden');
    $('panel').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('touch').classList.toggle('hidden', !isTouch);
    $('keysHint').classList.toggle('hidden', isTouch);
    $('polyBox').classList.toggle('hidden', !def.empty);
    document.querySelector('.tower:not(#polyBox)').classList.toggle('hidden', !!def.empty);
    $('minimap').classList.toggle('hidden', !!def.empty);
    $('trackName').textContent = def.name;
    $('recordLap').textContent = rec?.time ? `${fmt(rec.time)}` : '—';
    $('bestLap').textContent = '—';
    $('lastLap').textContent = '—';
    $('gearMode').textContent = this.car.auto ? 'АВТО' : 'РУЧНАЯ';
    this.updateSectors();
    if (this.mode === 'trial') {
      this.state = 'lights';
      this.lightsT = 0;
      this.lightsOutAt = 5 + 0.4 + Math.random() * 1.4;
      this.litCount = 0;
      $('start').classList.remove('hidden');
      for (const l of $('start').children) l.classList.remove('on');
      this.setGantry(0);
    } else {
      this.state = 'drive';
      $('start').classList.add('hidden');
      this.setGantry(0);
      if (this.T) this.showMsg('Свободная езда', 'круги засчитываются после пересечения финиша', '', 2.5);
    }
    if (this.T) this.mapBase = this.renderMapBase();
  }

  toMenu() {
    this.state = 'menu';
    audio.engine(0, 0, 0, false);
    $('hud').classList.add('hidden');
    $('touch').classList.add('hidden');
    $('panel').classList.add('hidden');
    $('menu').classList.remove('hidden');
    this.buildMenu();
    this.showroom();
  }

  pause() {
    if (this.state === 'paused' || this.state === 'menu') return;
    this.prevState = this.state;
    this.state = 'paused';
    audio.engine(0, 0, 0, false);
    $('panelTitle').textContent = 'Пауза';
    $('resume').textContent = 'Продолжить';
    $('panelBody').innerHTML = this.lapTable();
    $('resume').classList.remove('hidden');
    $('panel').classList.remove('hidden');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.prevState;
    $('panel').classList.add('hidden');
    this.last = performance.now();
  }

  lapTable() {
    if (!this.laps.length) return '<p class="tip">Пока нет завершённых кругов.</p>';
    const valid = this.laps.filter((l) => l.valid).map((l) => l.time);
    const best = valid.length ? Math.min(...valid) : null;
    const rows = this.laps.map((l, i) => `<tr class="${!l.valid ? 'bad' : l.time === best ? 'best' : ''}"><td>Круг ${i + 1}</td><td>${l.sectors.map((s) => (s ? s.toFixed(3) : '—')).join(' · ')}</td><td>${fmt(l.time)}</td></tr>`).join('');
    return `<table class="laps"><tbody>${rows}</tbody></table>`;
  }

  setGantry(n) {
    if (!this.gantry) return;
    this.gantry.lights.forEach((m, i) => { m.emissiveIntensity = i < n ? 3 : 0; m.color.setHex(i < n ? 0xff2020 : 0x330000); });
  }

  showMsg(text, sub = '', cls = '', dur = 0) {
    const el = $('msg');
    el.className = `msg ${cls}`;
    el.innerHTML = text ? `${text}${sub ? `<small>${sub}</small>` : ''}` : '';
    this.msgT = dur;
  }

  // ---------------- timing ----------------
  updateSectors() {
    const rec = this.records[this.def?.id];
    ['s1', 's2', 's3'].forEach((id, i) => {
      const el = $(id);
      const t = this.lap?.sectors[i];
      el.className = '';
      if (t == null) { el.textContent = `S${i + 1}`; return; }
      el.textContent = t.toFixed(3);
      const recS = rec?.sectors?.[i];
      const sesS = this.bestSectors?.[i];
      el.className = recS == null || t <= recS ? 'purple' : sesS == null || t <= sesS ? 'green' : 'yellow';
    });
  }

  timing(dt) {
    const T = this.T;
    const L = this.car.loc;
    const s = L.s, prev = this.prevS;
    const len = T.length;
    const lap = this.lap;
    const now = this.simT;
    const crossedFwd = prev > len * 0.75 && s < len * 0.25;
    const crossedBack = prev < len * 0.25 && s > len * 0.75;
    if (crossedBack && lap.start != null) { lap.valid = false; lap.backwards = true; }
    if (crossedFwd) {
      if (lap.start == null) {
        lap.start = now - (s / Math.max(1, Math.abs(this.car.v)));
        lap.n = 1;
      } else if (lap.sectors[0] != null && lap.sectors[1] != null && !lap.backwards) {
        const time = now - lap.start;
        lap.sectors[2] = time - lap.sectors[0] - lap.sectors[1];
        this.finishLap(time);
      } else {
        // missed part of the lap (reset or shortcut): restart the timer
        lap.start = now;
        lap.valid = true;
        lap.backwards = false;
        lap.sectors = [null, null, null];
        lap.samples = [];
      }
    }
    if (lap.start != null) {
      const t = now - lap.start;
      if (lap.sectors[0] == null && s > len / 3 && s < len * 0.66) { lap.sectors[0] = t; this.updateSectors(); }
      if (lap.sectors[0] != null && lap.sectors[1] == null && s > (len * 2) / 3 && s < len * 0.95) { lap.sectors[1] = t - lap.sectors[0]; this.updateSectors(); }
      if (!this.car.onTrack && lap.valid) {
        lap.valid = false;
        this.showMsg('ТРЕК-ЛИМИТ', 'круг не будет засчитан', 'red', 1.6);
      }
      // record samples for the ghost and the live delta
      this.sampleT = (this.sampleT || 0) + dt;
      if (this.sampleT >= 0.05) {
        this.sampleT = 0;
        const p = this.car.pos;
        lap.samples.push([+t.toFixed(3), +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +this.car.yaw.toFixed(3), +s.toFixed(1)]);
      }
    }
    this.prevS = s;
  }

  finishLap(time) {
    const lap = this.lap;
    const def = this.def;
    const rec = this.records[def.id];
    const entry = { time, valid: lap.valid, sectors: lap.sectors.slice() };
    this.laps.push(entry);
    let msg = fmt(time), sub = '', cls = '';
    if (lap.valid) {
      if (!this.bestSectors) this.bestSectors = entry.sectors.slice();
      else this.bestSectors = this.bestSectors.map((b, i) => Math.min(b, entry.sectors[i]));
      if (this.bestSession == null || time < this.bestSession) this.bestSession = time;
      if (!rec?.time || time < rec.time) {
        const gap = rec?.time ? ` (${fmtDelta(time - rec.time)})` : '';
        this.records[def.id] = { time, car: this.car.spec.id, sectors: entry.sectors, ghost: lap.samples, date: Date.now() };
        store(REC_KEY, this.records);
        $('recordLap').textContent = fmt(time);
        sub = `НОВЫЙ РЕКОРД ТРАССЫ${gap}`;
        cls = 'purple';
        audio.lap(true);
        // the new record becomes the ghost for the next lap
        if (this.sel.ghost) {
          if (!this.ghost) {
            const gm = buildCarModel(this.car.spec, { ghost: true }).group;
            this.scene.add(gm);
            this.ghost = { mesh: gm, data: lap.samples };
          } else this.ghost.data = lap.samples;
        }
      } else {
        sub = `${fmtDelta(time - rec.time)} к рекорду`;
        audio.lap(false);
      }
    } else {
      sub = 'круг не засчитан';
      cls = 'red';
      audio.lap(false);
    }
    $('lastLap').textContent = fmt(time);
    $('bestLap').textContent = fmt(this.bestSession);
    this.showMsg(msg, sub, cls, 3);

    const doneAll = this.mode === 'trial' && this.laps.length >= this.sel.laps;
    lap.start = this.simT;
    lap.n++;
    lap.valid = true;
    lap.sectors = [null, null, null];
    lap.samples = [];
    this.updateSectors();
    if (doneAll) this.finishSession();
  }

  finishSession() {
    this.state = 'drive';
    this.mode = 'free';
    const total = this.laps.reduce((a, l) => a + l.time, 0);
    setTimeout(() => {
      if (this.state === 'menu') return;
      this.prevState = this.state;
      this.state = 'paused';
      audio.engine(0, 0, 0, false);
      $('panelTitle').textContent = 'Финиш!';
      const rec = this.records[this.def.id];
      $('panelBody').innerHTML = `${this.lapTable()}<p class="tip">Общее время: <b>${fmt(total)}</b> · лучший круг: <b>${fmt(this.bestSession)}</b> · рекорд трассы: <b>${fmt(rec?.time)}</b></p>${this.laps.some((l) => l.valid && l.time === rec?.time) ? '<p class="record">Ты установил новый рекорд трассы!</p>' : ''}`;
      $('resume').textContent = 'Покататься ещё';
      $('panel').classList.remove('hidden');
    }, 1800);
  }

  liveDelta(t, s) {
    const g = this.records[this.def.id]?.ghost;
    if (!g || g.length < 10) return null;
    let lo = 0, hi = g.length - 1;
    if (s > g[hi][5]) return null;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (g[mid][5] < s) lo = mid + 1; else hi = mid; }
    return t - g[lo][0];
  }

  // ---------------- polygon (acceleration tests) ----------------
  polygonTimers(dt) {
    const P = this.poly;
    const kmh = Math.abs(this.car.v) * 3.6;
    if (kmh < 1) { P.t0 = null; P.armed = true; P.run = {}; }
    else if (P.armed && P.t0 == null && this.car.v > 0) { P.t0 = this.simT; P.armed = false; }
    if (P.t0 != null) {
      const t = this.simT - P.t0;
      for (const target of [100, 200, 300]) {
        if (!P.run[target] && kmh >= target) {
          P.run[target] = t;
          if (!P.best[`a${target}`] || t < P.best[`a${target}`]) { P.best[`a${target}`] = t; this.showMsg(`0–${target}: ${t.toFixed(2)} с`, 'лучший замер', 'purple', 2); audio.lap(true); } else this.showMsg(`0–${target}: ${t.toFixed(2)} с`, '', '', 1.5);
        }
      }
    }
    if (kmh > (P.best.vmax || 0)) P.best.vmax = kmh;
    for (const target of [100, 200, 300]) $(`acc${target}`).textContent = P.run[target] ? `${P.run[target].toFixed(2)} с` : P.best[`a${target}`] ? `лучш. ${P.best[`a${target}`].toFixed(2)}` : '—';
    $('vmax').textContent = `${Math.round(P.best.vmax || 0)} км/ч`;
    this.polySaveT = (this.polySaveT || 0) + dt;
    if (this.polySaveT > 3) { this.polySaveT = 0; this.records.polygon = P.best; store(REC_KEY, this.records); }
  }

  // ---------------- HUD ----------------
  buildLeds() {
    const box = $('leds');
    box.innerHTML = '';
    for (let i = 0; i < 15; i++) box.appendChild(document.createElement('i'));
  }

  updateDash() {
    const c = this.car;
    $('speed').textContent = Math.round(Math.abs(c.v) * 3.6);
    $('gear').textContent = c.gear === -1 ? 'R' : c.gear;
    $('rpm').textContent = Math.round(c.rpm / 100) * 100;
    const frac = (c.rpm - 9000) / (REDLINE - 9000);
    const lit = Math.max(0, Math.min(15, Math.round(frac * 15)));
    const leds = $('leds').children;
    for (let i = 0; i < 15; i++) leds[i].className = i < lit ? (i < 5 ? 'g' : i < 10 ? 'r' : 'b') : '';
    $('leds').classList.toggle('flash', c.limiter || c.rpm > REDLINE * 0.985);
  }

  renderMapBase() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 240;
    const g = cv.getContext('2d');
    this.map = this.mapTransform(this.T, 240, 240, 14);
    g.lineJoin = 'round';
    g.strokeStyle = '#3a414c';
    g.lineWidth = 8;
    this.strokeTrack(g, this.T, this.map);
    g.strokeStyle = '#d7dbe0';
    g.lineWidth = 3;
    this.strokeTrack(g, this.T, this.map);
    const [sx, sy] = this.map(this.T.pts[0].x, this.T.pts[0].z);
    g.fillStyle = '#e10600';
    g.fillRect(sx - 4, sy - 4, 8, 8);
    return cv;
  }

  drawMinimap() {
    const g = $('minimap').getContext('2d');
    g.clearRect(0, 0, 240, 240);
    g.drawImage(this.mapBase, 0, 0);
    if (this.ghost?.mesh.visible) {
      const [x, y] = this.map(this.ghost.mesh.position.x, this.ghost.mesh.position.z);
      g.fillStyle = 'rgba(178,92,255,0.9)';
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    }
    const [x, y] = this.map(this.car.pos.x, this.car.pos.z);
    g.fillStyle = '#ffd400';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  // ---------------- camera ----------------
  updateCamera(dt) {
    const c = this.car;
    const f = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    const speed = Math.abs(c.v);
    let pos, look, fov;
    if (this.camMode === 2) {
      // onboard, just above the driver's helmet
      pos = c.pos.clone().add(new THREE.Vector3(0, 1.12, 0)).addScaledVector(f, 0.35);
      pos.y += Math.sin(this.simT * 37) * Math.min(0.012, speed * 0.0002);
      look = pos.clone().addScaledVector(f, 10);
      look.y -= 0.6 + Math.sin(c.pitch) * 10;
      fov = 72 + Math.min(12, speed * 0.12);
      this.camPos = pos.clone();
    } else {
      const dist = this.camMode === 0 ? 6.4 : 11;
      const h = this.camMode === 0 ? 2.0 : 3.8;
      const want = c.pos.clone().addScaledVector(f, -dist).add(new THREE.Vector3(0, h, 0));
      if (!this.camPos || this.camPos.distanceTo(want) > 40) this.camPos = want.clone();
      // stiff along the car, a touch of lag sideways for a sense of speed
      this.camPos.lerp(want, Math.min(1, dt * 9));
      pos = this.camPos;
      look = c.pos.clone().addScaledVector(f, 4).add(new THREE.Vector3(0, 0.9, 0));
      fov = 62 + Math.min(16, speed * 0.16);
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4); this.camera.updateProjectionMatrix(); }
    this.sun.position.set(c.pos.x + 80, c.pos.y + 160, c.pos.z + 60);
    this.sun.target.position.copy(c.pos);
    this.sky.position.copy(pos);
  }

  // ---------------- loop ----------------
  frame() {
    const now = performance.now();
    const dt = this.fixedDt || Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'menu') {
      const s = this.show;
      s.a += dt * 0.35;
      this.camera.position.set(Math.sin(s.a) * 7.5, 2.6, Math.cos(s.a) * 7.5);
      this.camera.lookAt(0, 0.4, 0);
      if (this.camera.fov !== 40) { this.camera.fov = 40; this.camera.updateProjectionMatrix(); }
      this.renderer.render(s.scene, this.camera);
      return;
    }
    const inp = this.sampleInputOverride ? this.sampleInputOverride() : sampleInput();
    if (inp.pause) { if (this.state === 'paused') this.resume(); else this.pause(); }
    if (inp.mute) audio.toggle();
    if (this.state === 'paused') { this.renderer.render(this.scene, this.camera); return; }
    const c = this.car;
    if (inp.cam) this.camMode = (this.camMode + 1) % 3;
    c.mesh.visible = this.camMode !== 2;

    // start lights
    let held = false;
    if (this.state === 'lights') {
      this.lightsT += dt;
      const n = Math.min(5, Math.floor(this.lightsT));
      if (n !== this.litCount && n > 0) { this.litCount = n; audio.light(); }
      [...$('start').children].forEach((el, i) => el.classList.toggle('on', i < n && this.lightsT < this.lightsOutAt));
      this.setGantry(this.lightsT < this.lightsOutAt ? n : 0);
      held = true;
      if (this.lightsT >= this.lightsOutAt) {
        this.state = 'drive';
        audio.go();
        this.showMsg('СТАРТ!', '', '', 1.2);
        setTimeout(() => $('start').classList.add('hidden'), 900);
      }
    }

    if (inp.up || inp.down) {
      const r = c.shift(inp.up ? 1 : -1);
      if (r === 'overrev') { audio.deny(); document.querySelector('.gear').classList.add('deny'); setTimeout(() => document.querySelector('.gear').classList.remove('deny'), 300); } else if (r) audio.shift();
      if (r && r !== 'overrev' && c.auto && r !== 'rev') { /* manual override is fine in auto too */ }
    }
    if (inp.reset) this.resetToTrack();

    const events = [];
    const drive = held ? { ...inp, throttle: 0, brake: 1, steer: 0 } : inp;
    c.update(dt, drive, events);
    if (held) c.rpm = 4200 + inp.throttle * 7000; // revving on the grid
    for (const e of events) {
      if (e === 'up' || e === 'down') audio.shift();
      else if (e.wall) { audio.wall(e.wall); if (e.wall > 8) this.showMsg('УДАР!', '', 'red', 0.8); }
    }
    this.simT += dt;
    if (this.T && this.state === 'drive') this.timing(dt);
    if (!this.T) this.polygonTimers(dt);

    // ghost playback
    if (this.ghost) {
      const lap = this.lap;
      const gd = this.ghost.data;
      if (lap.start != null && gd.length > 1) {
        const t = this.simT - lap.start;
        let i = 0;
        while (i < gd.length - 2 && gd[i + 1][0] < t) i++;
        const a = gd[i], b = gd[i + 1];
        const u = Math.max(0, Math.min(1, (t - a[0]) / Math.max(1e-3, b[0] - a[0])));
        const visible = t <= gd[gd.length - 1][0];
        this.ghost.mesh.visible = visible;
        if (visible) {
          this.ghost.mesh.position.set(a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u);
          const dy = Math.atan2(Math.sin(b[4] - a[4]), Math.cos(b[4] - a[4]));
          this.ghost.mesh.rotation.y = a[4] + dy * u;
        }
      } else this.ghost.mesh.visible = false;
    }

    // HUD
    this.updateDash();
    if (this.T) {
      const lap = this.lap;
      const t = lap.start != null ? this.simT - lap.start : 0;
      $('curTime').textContent = fmt(t);
      $('lapNo').textContent = this.mode === 'trial' ? `КРУГ ${Math.min(Math.max(1, lap.n), this.sel.laps)}/${this.sel.laps}` : `КРУГ ${Math.max(1, lap.n)}`;
      $('invalid').classList.toggle('hidden', lap.valid || lap.start == null);
      const d = lap.start != null ? this.liveDelta(t, c.loc.s) : null;
      const de = $('delta');
      de.textContent = d == null ? '' : fmtDelta(d);
      de.className = `delta ${d == null ? '' : d < 0 ? 'minus' : 'plus'}`;
      this.drawMinimap();
      const tan = this.T.tan[c.loc.i];
      const wrong = (Math.sin(c.yaw) * tan.x + Math.cos(c.yaw) * tan.z) < -0.4 && c.v > 5;
      if (wrong && this.msgT <= 0) this.showMsg('НЕ В ТУ СТОРОНУ', 'развернись или нажми R', 'red', 0.5);
    }
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.showMsg(''); }
    audio.engine(c.rpm, held ? inp.throttle : inp.throttle * (c.shiftCut > 0 ? 0.2 : 1), Math.abs(c.v), true, c.limiter);
    audio.kerb(c.surface === 'kerb' && Math.abs(c.v) > 5);

    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  resetToTrack() {
    const c = this.car;
    if (!this.T) { c.v = 0; return; }
    const T = this.T;
    const i = c.loc.i;
    const p = T.pts[i], t = T.tan[i];
    c.place(p.x, p.y, p.z, Math.atan2(t.x, t.z));
    c.auto = this.sel.box === 'auto';
    if (this.lap.start != null) { this.lap.valid = false; }
    this.showMsg('Возврат на трассу', 'круг не будет засчитан', 'red', 1.2);
    this.camPos = null;
  }
}

window.gp = new Game();
