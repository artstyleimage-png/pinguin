import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TRACKS, trackData } from './tracks.js';
import { buildTrackScene, buildPolygon, setWetness } from './scene.js';
import { buildCar, DIM } from './carModel.js';
import { CarPhysics, TYRES, SHIFT_RPM, LIMITER } from './physics.js';
import { Weather, Visor, WEATHERS, TIMES } from './weather.js';
import { FX } from './fx.js';
import { CARS } from './teams.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const REC_KEY = 'f1-records-v2';
const PREF_KEY = 'f1-prefs-v2';
const WHEEL_KEY = 'f1-wheel-v1';
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function load(key, def) { try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ } }

export function fmt(t) {
  if (t == null || !isFinite(t)) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
const fmtDelta = (d) => `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(3)}`;

// --------------------------------------------------------------------------
// Input: keyboard, gamepad / steering wheel, on-screen buttons
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
let wheelCfg = load(WHEEL_KEY, null);

function pads() { return navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; }

function sampleInput() {
  const k = (c) => keys.has(c);
  const h = (...c) => c.some((x) => pressed.has(x));
  const inp = {
    throttle: k('KeyW') || k('ArrowUp') || touch.has('gas') ? 1 : 0,
    brake: k('KeyS') || k('ArrowDown') || touch.has('brake') ? 1 : 0,
    steer: (k('KeyA') || k('ArrowLeft') || touch.has('left') ? 1 : 0) - (k('KeyD') || k('ArrowRight') || touch.has('right') ? 1 : 0),
    up: h('KeyE', 'ShiftLeft', 'ShiftRight', 'PageUp', 'T:up'),
    down: h('KeyQ', 'ControlLeft', 'ControlRight', 'PageDown', 'T:down'),
    aeroToggle: h('Space', 'T:aero'),
    overtake: k('KeyX') || touch.has('boost'),
    cam: h('KeyC', 'T:cam'),
    hud: h('KeyH'),
    reset: h('KeyR'),
    pause: h('Escape', 'KeyP', 'T:pause'),
    mute: h('KeyN'),
    analog: false,
  };
  const gp = pads()[0];
  if (gp) {
    const btn = (i) => gp.buttons[i] && (gp.buttons[i].value > 0.5 || gp.buttons[i].pressed);
    const edge = (i) => btn(i) && !padPrev[i];
    const ax = gp.axes[0] || 0;
    const wheel = wheelCfg && wheelCfg.id === gp.id;
    const dead = wheel ? 0.005 : 0.08;
    if (Math.abs(ax) > dead) {
      const v = (Math.abs(ax) - dead) / (1 - dead);
      inp.steer = -Math.sign(ax) * clamp(wheel ? v * wheelCfg.sens : v ** 1.4, 0, 1);
      inp.analog = true;
    }
    if (wheel) {
      const pedal = (c) => (c ? clamp((gp.axes[c.axis] - c.rest) / (c.full - c.rest), 0, 1) : 0);
      inp.throttle = Math.max(inp.throttle, pedal(wheelCfg.thr));
      inp.brake = Math.max(inp.brake, pedal(wheelCfg.brk));
    } else {
      inp.throttle = Math.max(inp.throttle, gp.buttons[7]?.value || 0);
      inp.brake = Math.max(inp.brake, gp.buttons[6]?.value || 0);
    }
    if (edge(5) || edge(1)) inp.up = true;
    if (edge(4) || edge(2)) inp.down = true;
    if (edge(3)) inp.cam = true;
    if (edge(0)) inp.aeroToggle = true;
    if (btn(10)) inp.overtake = true;
    if (edge(9)) inp.pause = true;
    padPrev = gp.buttons.map((b) => b.value > 0.5 || b.pressed);
  }
  pressed.clear();
  return inp;
}

const CAMS = ['Кокпит', 'T-камера', 'Сзади', 'Сзади далеко'];
const COMPOUND_CSS = { soft: '#e8202a', medium: '#ffd400', hard: '#f2f2f2', inter: '#2fb34a', wet: '#1f6fe0' };

// --------------------------------------------------------------------------
// Game
// --------------------------------------------------------------------------
class Game {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 9000);
    this.records = load(REC_KEY, {});
    const p = load(PREF_KEY, {});
    this.sel = {
      mode: p.mode || 'trial', track: p.track || 'lago', car: p.car || 'rosso', laps: p.laps || 3, box: p.box || 'auto', ghost: p.ghost ?? true,
      weather: p.weather || 'clear', time: p.time || 'day', tyre: p.tyre || 'medium', quality: p.quality ?? (isTouch ? 0 : 1),
      assists: { stability: true, abs: true, tc: true, steer: true, aero: true, ...(p.assists || {}) }, tab: p.tab || 'car',
    };
    this.state = 'menu';
    this.camMode = 0;
    this.hudMin = false;
    this.last = performance.now();
    this.visor = new Visor($('visor'));
    addEventListener('resize', () => this.resize());
    this.applyQuality();
    this.buildLeds();
    this.buildMenu();
    this.bindMenu();
    this.showroom();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  applyQuality() {
    const q = this.sel.quality;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q >= 2 ? 2 : q >= 1 ? 1.5 : 1));
    this.renderer.shadowMap.type = q >= 1 ? THREE.PCFShadowMap : THREE.PCFShadowMap;
    this.resize();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(innerWidth, innerHeight);
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
    const cars = $('cars');
    cars.innerHTML = '';
    const bar = (label, v) => `<div class="stat">${label}<span><i style="width:${Math.round(((v - 0.92) / 0.14) * 100)}%"></i></span></div>`;
    const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
    for (const c of CARS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'car';
      b.dataset.id = c.id;
      b.innerHTML = `<div class="livery" style="background:linear-gradient(90deg, ${hex(c.main)} 0 65%, ${hex(c.second)} 65% 85%, ${hex(c.accent)} 85%)"></div>
        <b>${c.name} <em>#${c.num}</em></b><small>${c.note}</small>${bar('Мотор', c.power)}${bar('Сцепление', c.grip)}${bar('Аэро', 2 - c.drag)}`;
      b.addEventListener('click', () => { this.sel.car = c.id; this.refreshMenu(); this.savePrefs(); this.showroom(); });
      cars.appendChild(b);
    }
    const seg = (id, items, key) => {
      const el = $(id);
      el.innerHTML = '';
      for (const [val, label, sub] of items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.v = val;
        b.innerHTML = `${label}${sub ? `<small>${sub}</small>` : ''}`;
        b.addEventListener('click', () => { this.sel[key] = typeof this.sel[key] === 'number' ? +val : val; this.refreshMenu(); this.savePrefs(); if (key === 'quality') this.applyQuality(); });
        el.appendChild(b);
      }
    };
    seg('weather', Object.entries(WEATHERS).map(([k, w]) => [k, w.name]), 'weather');
    seg('timeOfDay', Object.entries(TIMES).map(([k, t]) => [k, t.name]), 'time');
    seg('tyres', Object.entries(TYRES).map(([k, t]) => [k, `<i class="dot" style="background:${COMPOUND_CSS[k]}"></i>${t.name}`, t.code]), 'tyre');
    seg('quality', [['0', 'Низкая', 'для телефона'], ['1', 'Средняя', ''], ['2', 'Высокая', 'тени 4K, свечение']], 'quality');
    const as = $('assists');
    as.innerHTML = '';
    for (const [key, label, sub] of [['stability', 'Стабилизация', 'не даёт развернуть'], ['tc', 'Трекшн-контроль', 'без пробуксовки'], ['abs', 'ABS', 'колёса не блокируются'], ['steer', 'Помощь рулю', 'для клавиатуры'], ['aero', 'Авто-аэро', 'крылья сами на прямых']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.k = key;
      b.innerHTML = `${label}<small>${sub}</small>`;
      b.addEventListener('click', () => { this.sel.assists[key] = !this.sel.assists[key]; this.refreshMenu(); this.savePrefs(); });
      as.appendChild(b);
    }
    this.refreshMenu();
  }

  bindMenu() {
    for (const b of document.querySelectorAll('#modes button')) b.addEventListener('click', () => { this.sel.mode = b.dataset.mode; this.refreshMenu(); this.savePrefs(); });
    for (const b of document.querySelectorAll('#laps button')) b.addEventListener('click', () => { this.sel.laps = +b.dataset.laps; this.refreshMenu(); this.savePrefs(); });
    for (const b of document.querySelectorAll('#box button')) b.addEventListener('click', () => { this.sel.box = b.dataset.box; this.refreshMenu(); this.savePrefs(); });
    for (const b of document.querySelectorAll('#ghostOpt button')) b.addEventListener('click', () => { this.sel.ghost = b.dataset.ghost === '1'; this.refreshMenu(); this.savePrefs(); });
    for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => { this.sel.tab = b.dataset.tab; this.refreshMenu(); this.savePrefs(); });
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
    $('wheelSetup').addEventListener('click', () => this.wheelWizard());
    $('wheelSens').addEventListener('input', (e) => { if (wheelCfg) { wheelCfg.sens = +e.target.value; store(WHEEL_KEY, wheelCfg); } this.refreshMenu(); });
    $('wheelClear').addEventListener('click', () => { wheelCfg = null; try { localStorage.removeItem(WHEEL_KEY); } catch { /* ignore */ } this.refreshMenu(); });
    addEventListener('gamepadconnected', () => this.refreshMenu());
  }

  refreshMenu() {
    const s = this.sel;
    const def = TRACKS.find((t) => t.id === s.track) || TRACKS[0];
    if (def.empty) s.mode = 'free';
    for (const b of document.querySelectorAll('.track')) b.classList.toggle('on', b.dataset.id === s.track);
    for (const b of document.querySelectorAll('.car')) b.classList.toggle('on', b.dataset.id === s.car);
    for (const b of document.querySelectorAll('#modes button')) { b.classList.toggle('on', b.dataset.mode === s.mode); b.disabled = def.empty && b.dataset.mode === 'trial'; }
    for (const b of document.querySelectorAll('#laps button')) { b.classList.toggle('on', +b.dataset.laps === s.laps); b.disabled = s.mode !== 'trial'; }
    for (const b of document.querySelectorAll('#box button')) b.classList.toggle('on', b.dataset.box === s.box);
    for (const b of document.querySelectorAll('#ghostOpt button')) b.classList.toggle('on', (b.dataset.ghost === '1') === s.ghost);
    for (const [id, key] of [['weather', 'weather'], ['timeOfDay', 'time'], ['tyres', 'tyre'], ['quality', 'quality']]) {
      for (const b of $(id).children) b.classList.toggle('on', String(s[key]) === b.dataset.v);
    }
    for (const b of $('assists').children) b.classList.toggle('on', !!s.assists[b.dataset.k]);
    for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === s.tab);
    for (const p of document.querySelectorAll('.tab-page')) p.classList.toggle('hidden', p.dataset.tab !== s.tab);
    $('about').textContent = def.about;
    $('toggleBox').textContent = `Коробка: ${s.box === 'auto' ? 'автомат' : 'ручная'}`;
    // tyre advice for the chosen weather
    const w = WEATHERS[s.weather];
    const wet = w.rain >= 0.8 ? 'wet' : w.rain > 0 ? 'inter' : null;
    const dryOnWet = wet && !['inter', 'wet'].includes(s.tyre);
    const wetOnDry = !wet && !w.dynamic && ['inter', 'wet'].includes(s.tyre);
    $('tyreTip').textContent = dryOnWet ? `На мокрой трассе слики почти не держат: лучше ${wet === 'wet' ? 'дождевые (Wet)' : 'промежуточные (Inter)'}.`
      : wetOnDry ? 'На сухой трассе дождевая резина быстро перегревается и стирается.'
        : w.dynamic ? 'Погода будет меняться: следи за индикатором трассы.' : 'Soft быстрее, но изнашивается сильнее. Hard держится дольше.';
    const gp = pads()[0];
    $('wheelStatus').textContent = wheelCfg ? `Настроено: ${wheelCfg.id.slice(0, 40)}` : gp ? `Найдено: ${gp.id.slice(0, 40)}` : 'Руль или геймпад не подключён';
    $('wheelSens').value = wheelCfg?.sens ?? 1.6;
    $('wheelSens').disabled = !wheelCfg;
    $('wheelClear').classList.toggle('hidden', !wheelCfg);
  }

  /** Two-step pedal calibration: which axes are throttle and brake, and their travel. */
  wheelWizard() {
    const gp = pads()[0];
    const box = $('wizard');
    if (!gp) { $('wheelStatus').textContent = 'Подключи руль и нажми любую педаль, потом попробуй снова'; return; }
    box.classList.remove('hidden');
    const steps = ['Отпусти все педали и нажми «Дальше»', 'Выжми ГАЗ до упора и нажми «Дальше»', 'Отпусти газ, выжми ТОРМОЗ до упора и нажми «Дальше»'];
    let step = 0;
    let rest = null;
    const cfg = { id: gp.id, sens: wheelCfg?.sens ?? 1.6 };
    const show = () => { $('wizardText').textContent = steps[step]; };
    show();
    const pick = (now) => {
      let best = -1, bd = 0;
      now.forEach((v, i) => { if (i === 0) return; const d = Math.abs(v - rest[i]); if (d > bd) { bd = d; best = i; } });
      return bd > 0.3 ? { axis: best, rest: rest[best], full: now[best] } : null;
    };
    const next = () => {
      const now = [...(pads()[0]?.axes || [])];
      if (step === 0) rest = now;
      else if (step === 1) cfg.thr = pick(now);
      else if (step === 2) cfg.brk = pick(now);
      step++;
      if (step < steps.length) { show(); return; }
      box.classList.add('hidden');
      $('wizardNext').onclick = null;
      if (cfg.thr || cfg.brk) { wheelCfg = cfg; store(WHEEL_KEY, cfg); }
      this.sel.assists.steer = false;
      this.savePrefs();
      this.refreshMenu();
    };
    $('wizardNext').onclick = next;
    $('wizardCancel').onclick = () => { box.classList.add('hidden'); };
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
    // active aero zones
    g.strokeStyle = '#2bd46b';
    g.lineWidth = 3;
    g.beginPath();
    let drawing = false;
    T.pts.forEach((p, i) => {
      const [x, y] = map(p.x, p.z);
      if (T.aeroZone[i]) { if (drawing) g.lineTo(x, y); else { g.moveTo(x, y); drawing = true; } } else drawing = false;
    });
    g.stroke();
    const [sx, sy] = map(T.pts[0].x, T.pts[0].z);
    g.fillStyle = '#e10600';
    g.fillRect(sx - 4, sy - 4, 8, 8);
  }

  mapTransform(T, w, h, pad) {
    const b = T.box;
    const s = Math.min((w - pad * 2) / (b.max.x - b.min.x), (h - pad * 2) / (b.max.z - b.min.z));
    const ox = (w - (b.max.x - b.min.x) * s) / 2, oz = (h - (b.max.z - b.min.z) * s) / 2;
    return (x, z) => [w - (ox + (x - b.min.x) * s), oz + (b.max.z - z) * s];
  }

  strokeTrack(g, T, map) {
    g.beginPath();
    T.pts.forEach((p, i) => { const [x, y] = map(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath();
    g.stroke();
  }

  /** The selected car on a turntable behind the menu, lit by a studio environment. */
  showroom() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d10);
    if (!this.studioEnv) {
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.studioEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    scene.environment = this.studioEnv;
    scene.environmentIntensity = 0.8;
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -5; sc.right = sc.top = 5;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff3a2a, 1.4);
    rim.position.set(-6, 2, -6);
    scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.22, metalness: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const spec = CARS.find((c) => c.id === this.sel.car) || CARS[0];
    const { group } = buildCar(spec, { compound: this.sel.tyre, number: spec.num });
    scene.add(group);
    this.show = { scene, car: group, a: this.show?.a || 0.6 };
  }

  // ---------------- session ----------------
  start() {
    audio.init();
    const s = this.sel;
    const def = TRACKS.find((t) => t.id === s.track) || TRACKS[0];
    const spec = CARS.find((c) => c.id === s.car) || CARS[0];
    this.def = def;
    this.mode = def.empty ? 'free' : s.mode;
    const scene = new THREE.Scene();
    this.scene = scene;
    this.weather = new Weather(scene, this.renderer, { weather: s.weather, time: s.time, quality: s.quality });
    const night = this.weather.night;
    if (def.empty) {
      this.T = null;
      this.world = buildPolygon(scene, { night, quality: s.quality });
    } else {
      this.T = trackData(def);
      this.world = buildTrackScene(scene, this.T, { night, quality: s.quality });
    }
    this.fx = new FX(scene);
    // the car
    const model = buildCar(spec, { compound: s.tyre, number: spec.num });
    this.model = model;
    scene.add(model.group);
    this.car = new CarPhysics(spec, this.T, { compound: s.tyre, assists: { ...s.assists }, auto: s.box === 'auto' });
    this.car.wetness = this.weather.wetness;
    this.car.ambient = night ? 18 : s.weather === 'rain' ? 16 : 24;
    if (this.T) {
      const T = this.T;
      const k = (T.n - Math.round(10 / T.step)) % T.n;
      const p = T.pts[k], t = T.tan[k], nr = T.nrm[k];
      this.car.place(p.x + nr.x * 3, p.y, p.z + nr.z * 3, Math.atan2(t.x, t.z));
    } else this.car.place(0, 0, -20, 0);
    // night: a few real lights follow the nearest floodlights
    this.lampLights = [];
    if (night) {
      for (let i = 0; i < 4; i++) {
        const l = new THREE.PointLight(0xfff0d8, 900, 70, 2);
        scene.add(l);
        this.lampLights.push(l);
      }
    }
    // ghost of the track record
    this.ghost = null;
    const rec = this.records[def.id];
    if (this.T && s.ghost && rec?.ghost?.length) {
      const gspec = CARS.find((c) => c.id === rec.car) || spec;
      const gm = buildCar(gspec, { ghost: true, compound: rec.tyre || 'medium', number: gspec.num }).group;
      gm.visible = false;
      scene.add(gm);
      this.ghost = { mesh: gm, data: rec.ghost };
    }
    // post-processing on high quality
    this.composer = null;
    if (s.quality >= 2) {
      const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
      const comp = new EffectComposer(this.renderer, rt);
      comp.addPass(new RenderPass(scene, this.camera));
      comp.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), night ? 0.5 : 0.12, 0.4, night ? 0.85 : 1.4));
      comp.addPass(new OutputPass());
      comp.setPixelRatio(this.renderer.getPixelRatio());
      comp.setSize(innerWidth, innerHeight);
      this.composer = comp;
    }

    this.lap = { n: 0, start: null, valid: true, sectors: [null, null, null], samples: [] };
    this.laps = [];
    this.bestSession = null;
    this.bestSectors = null;
    this.simT = 0;
    this.prevS = this.car.loc ? this.car.loc.s : 0;
    this.poly = { t0: null, best: def.empty && rec ? rec : {}, run: {} };
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
    $('tower').classList.toggle('hidden', !!def.empty);
    $('minimap').classList.toggle('hidden', !!def.empty);
    $('trackName').textContent = def.name;
    $('recordLap').textContent = rec?.time ? fmt(rec.time) : '—';
    $('bestLap').textContent = '—';
    $('lastLap').textContent = '—';
    $('gearMode').textContent = this.car.auto ? 'АВТО' : 'РУЧН';
    $('compound').textContent = `${TYRES[s.tyre].name} ${TYRES[s.tyre].code}`;
    $('compound').style.color = COMPOUND_CSS[s.tyre];
    $('camName').textContent = CAMS[this.camMode];
    this.updateSectors();
    if (this.mode === 'trial') {
      this.state = 'lights';
      this.lightsT = 0;
      this.lightsOutAt = 5 + 0.3 + Math.random() * 1.6;
      this.litCount = 0;
      $('start').classList.remove('hidden');
      for (const l of $('start').children) l.classList.remove('on');
      this.setGantry(0);
    } else {
      this.state = 'drive';
      $('start').classList.add('hidden');
      this.setGantry(0);
      if (this.T) this.showMsg('Свободная езда', `${this.weather.name()} · ${TIMES[s.time].name}`, '', 2.5);
    }
    if (this.T) this.mapBase = this.renderMapBase();
    setWetness(this.world.wet, this.weather.wetness);
  }

  toMenu() {
    this.state = 'menu';
    this.composer = null;
    audio.engine(0, 0, 0, false);
    audio.tyres(0, 0); audio.ers(0, 0); audio.rain(0);
    this.visor.update(0, 0, 0, false);
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
    audio.tyres(0, 0); audio.ers(0, 0);
    $('panelTitle').textContent = 'Пауза';
    $('resume').textContent = 'Продолжить';
    $('panelBody').innerHTML = this.lapTable();
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
    const rows = this.laps.map((l, i) => `<tr class="${!l.valid ? 'bad' : l.time === best ? 'best' : ''}"><td>Круг ${i + 1}</td><td>${l.sectors.map((x) => (x ? x.toFixed(3) : '—')).join(' · ')}</td><td>${fmt(l.time)}</td></tr>`).join('');
    return `<table class="laps"><tbody>${rows}</tbody></table>`;
  }

  setGantry(n) {
    if (!this.world?.lights.length) return;
    this.world.lights.forEach((m, i) => { m.emissiveIntensity = i < n ? 6 : 0; });
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
    const s = this.car.loc.s, prev = this.prevS;
    const len = T.length;
    const lap = this.lap;
    const now = this.simT;
    const fwd = prev > len * 0.75 && s < len * 0.25;
    const back = prev < len * 0.25 && s > len * 0.75;
    if (back && lap.start != null) { lap.valid = false; lap.backwards = true; }
    if (fwd) {
      if (lap.start == null) {
        lap.start = now - s / Math.max(1, this.car.vx);
        lap.n = 1;
      } else if (lap.sectors[0] != null && lap.sectors[1] != null && !lap.backwards) {
        const time = now - lap.start;
        lap.sectors[2] = time - lap.sectors[0] - lap.sectors[1];
        this.finishLap(time);
      } else {
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
    let sub = '', cls = '';
    if (lap.valid) {
      this.bestSectors = this.bestSectors ? this.bestSectors.map((b, i) => Math.min(b, entry.sectors[i])) : entry.sectors.slice();
      if (this.bestSession == null || time < this.bestSession) this.bestSession = time;
      if (!rec?.time || time < rec.time) {
        const gap = rec?.time ? ` (${fmtDelta(time - rec.time)})` : '';
        this.records[def.id] = { time, car: this.car.spec.id, tyre: this.car.compound, weather: this.sel.weather, sectors: entry.sectors, ghost: lap.samples, date: Date.now() };
        store(REC_KEY, this.records);
        $('recordLap').textContent = fmt(time);
        sub = `НОВЫЙ РЕКОРД ТРАССЫ${gap}`;
        cls = 'purple';
        audio.lap(true);
        if (this.sel.ghost) {
          if (!this.ghost) {
            const gm = buildCar(this.car.spec, { ghost: true, compound: this.car.compound, number: this.car.spec.num }).group;
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
    this.showMsg(fmt(time), sub, cls, 3);
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
    this.mode = 'free';
    const total = this.laps.reduce((a, l) => a + l.time, 0);
    setTimeout(() => {
      if (this.state === 'menu') return;
      this.prevState = 'drive';
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

  polygonTimers(dt) {
    const P = this.poly;
    const kmh = Math.abs(this.car.vx) * 3.6;
    if (kmh < 1) { P.t0 = null; P.armed = true; P.run = {}; }
    else if (P.armed && P.t0 == null && this.car.vx > 0) { P.t0 = this.simT; P.armed = false; }
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

  ledLevel() {
    const c = this.car;
    return clamp(Math.round(((c.rpm - 10200) / (SHIFT_RPM + 400 - 10200)) * 15), 0, 15);
  }

  updateDash(dt) {
    const c = this.car;
    const kmh = Math.round(c.speed * 3.6);
    $('speed').textContent = kmh;
    $('gear').textContent = c.gear === -1 ? 'R' : c.gear;
    $('rpm').textContent = Math.round(c.rpm / 100) * 100;
    const lit = this.ledLevel();
    const flash = c.limiter || c.rpm > SHIFT_RPM + 500;
    const leds = $('leds').children;
    for (let i = 0; i < 15; i++) leds[i].className = i < lit ? (i < 5 ? 'g' : i < 10 ? 'r' : 'b') : '';
    $('leds').classList.toggle('flash', flash);
    // battery, aero, tyres, track state
    $('ersFill').style.width = `${Math.round(c.battery * 100)}%`;
    $('ers').classList.toggle('deploy', c.deploying);
    $('ers').classList.toggle('harvest', c.harvesting && !c.deploying);
    $('ers').classList.toggle('boost', c.overtake);
    $('aero').textContent = c.aero === 'straight' ? 'АЭРО: ПРЯМАЯ' : c.zone ? 'АЭРО: ЗОНА' : 'АЭРО: ПОВОРОТ';
    $('aero').className = `aero ${c.aero === 'straight' ? 'on' : c.zone ? 'zone' : ''}`;
    const tc = (T) => {
      const t = TYRES[c.compound];
      return T < t.win[0] - 12 ? '#3c7bff' : T < t.win[0] ? '#7cc4ff' : T <= t.win[1] ? '#2bd46b' : T < t.win[1] + 15 ? '#ffb400' : '#e10600';
    };
    const tyres = $('tyreBox').children;
    for (let i = 0; i < 4; i++) {
      const axle = i < 2 ? 0 : 1;
      tyres[i].style.background = tc(c.tyreT[axle]);
      tyres[i].textContent = Math.round(c.tyreT[axle]);
    }
    $('tyreWear').textContent = `износ ${Math.round(Math.max(...c.wear) * 100)}%`;
    const w = this.weather.wetness;
    $('trackState').textContent = w < 0.08 ? 'Трасса сухая' : w < 0.4 ? 'Трасса влажная' : w < 0.75 ? 'Трасса мокрая' : 'Вода на трассе';
    $('trackState').className = `track-state ${w < 0.08 ? '' : w < 0.4 ? 'damp' : 'wet'}`;
    // steering-wheel display and LEDs (seen in the cockpit view)
    this.dispT = (this.dispT || 0) - dt;
    if (this.dispT <= 0) {
      this.dispT = 0.08;
      const d = this.model.display;
      const g = d.ctx;
      g.fillStyle = '#05070a';
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = c.limiter ? '#e10600' : '#ffffff';
      g.font = '900 78px "JetBrains Mono", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(c.gear === -1 ? 'R' : String(c.gear), 128, 58);
      g.font = '700 26px "JetBrains Mono", monospace';
      g.fillStyle = '#ffffff';
      g.textAlign = 'left';
      g.fillText(String(kmh), 8, 30);
      g.textAlign = 'right';
      const lapT = this.lap?.start != null ? this.simT - this.lap.start : null;
      const dl = lapT != null && this.T ? this.liveDelta(lapT, c.loc.s) : null;
      g.fillStyle = dl == null ? '#8b95a3' : dl < 0 ? '#2bd46b' : '#e10600';
      g.fillText(dl == null ? '--.--' : fmtDelta(dl).slice(0, 6), 248, 30);
      g.fillStyle = '#1a2a1a';
      g.fillRect(8, 104, 240, 14);
      g.fillStyle = c.deploying ? '#ffd400' : '#2bd46b';
      g.fillRect(8, 104, 240 * c.battery, 14);
      g.fillStyle = c.aero === 'straight' ? '#2bd46b' : '#3a414c';
      g.fillRect(8, 82, 60, 16);
      g.fillStyle = '#e8eef5';
      g.font = '700 14px "JetBrains Mono", monospace';
      g.textAlign = 'right';
      g.fillText(`${Math.round(c.tyreT[0])}°/${Math.round(c.tyreT[1])}°`, 248, 92);
      d.tex.needsUpdate = true;
    }
    const lc = [0x2bd46b, 0x2bd46b, 0x2bd46b, 0x2bd46b, 0x2bd46b, 0xe10600, 0xe10600, 0xe10600, 0xe10600, 0xe10600, 0x3c7bff, 0x3c7bff, 0x3c7bff, 0x3c7bff, 0x3c7bff];
    const blink = flash && Math.floor(this.simT * 14) % 2;
    this.model.leds.forEach((m, i) => m.color.setHex(i < lit && !blink ? lc[i] : 0x101010));
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

  // ---------------- car visuals ----------------
  syncModel(dt) {
    const c = this.car, m = this.model;
    const grp = m.group;
    // suspension: squat/dive, roll and aero compression
    this.pitchV = lerp(this.pitchV || 0, -Math.atan(c.slope) + clamp(-c.ax * 0.0028, -0.025, 0.02), Math.min(1, dt * 8));
    this.rollV = lerp(this.rollV || 0, clamp(c.ay * 0.0016, -0.02, 0.02), Math.min(1, dt * 8));
    const heave = -Math.min(0.025, (c.down || 0) * 1.4e-6);
    const bump = c.surface === 'kerb' ? (Math.random() - 0.5) * 0.02 : c.surface === 'gravel' || c.surface === 'grass' ? (Math.random() - 0.5) * 0.03 : 0;
    grp.position.set(c.pos.x, c.pos.y + heave + bump, c.pos.z);
    grp.rotation.set(this.pitchV, c.yaw, this.rollV, 'YXZ');
    for (const w of m.wheels) {
      w.spin.rotation.x += (c.vx * dt) / DIM.tyreR * (w.front || !c.flags.spin ? 1 : 1.6);
      if (w.front) w.pivot.rotation.y = c.delta;
      const glow = clamp((this.brakeHeat || 0) - 0.3, 0, 1);
      w.brakeGlow.emissiveIntensity = glow * 3;
    }
    // brake discs glow after heavy stops
    this.brakeHeat = clamp((this.brakeHeat || 0) + (this.lastBrake || 0) * c.speed * 0.0006 - dt * 0.25, 0, 1.3);
    m.steering.rotation.z = c.steerIn * 1.5;
    for (const f of m.frontFlaps) f.pivot.rotation.x = lerp(f.corner, f.straight, c.aeroBlend);
    m.rearFlap.pivot.rotation.x = lerp(m.rearFlap.corner, m.rearFlap.straight, c.aeroBlend);
    const rainOn = this.weather.wetness > 0.2 || this.weather.rain > 0.1;
    const blink = c.harvesting && Math.floor(this.simT * 6) % 2;
    m.rainLight.material.emissiveIntensity = rainOn ? 4 : blink ? 3 : 0.2;
    m.helmet.visible = this.camMode !== 0;
  }

  effects(dt) {
    const c = this.car;
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    const world = (lx, lz) => new THREE.Vector3(c.pos.x + co * lx + s * lz, c.pos.y, c.pos.z - s * lx + co * lz);
    const vel = new THREE.Vector3(s * c.vx + co * c.vy, 0, co * c.vx - s * c.vy);
    const f = c.flags;
    const sp = c.speed;
    let squeal = 0;
    if ((f.lockF || f.slideF) && sp > 5) { for (const sx of [-1, 1]) this.fx.tyreSmoke(world(sx * DIM.frontX, DIM.frontZ), 0.8); squeal = 1; }
    if ((f.lockR || f.spin || f.slideR) && sp > 3) { for (const sx of [-1, 1]) this.fx.tyreSmoke(world(sx * DIM.rearX, DIM.rearZ), 1); squeal = 1; }
    const alphaF = Math.abs(c.alpha?.[0] || 0), alphaR = Math.abs(c.alpha?.[1] || 0);
    squeal = Math.max(squeal, clamp((Math.max(alphaF, alphaR) - 0.07) * 12, 0, 0.6) * (sp > 8 ? 1 : 0));
    audio.tyres(this.weather.wetness > 0.3 ? squeal * 0.3 : squeal, sp);
    // spray from the rear tyres in the wet
    const w = this.weather.wetness;
    if (w > 0.15 && sp > 12) {
      const n = Math.min(4, Math.floor(w * sp / 12));
      for (let i = 0; i < n; i++) for (const sx of [-1, 1]) this.fx.spray(world(sx * DIM.rearX, DIM.rearZ - 0.6), vel, w);
    }
    // sparks off the plank at speed (bumps, kerbs)
    if (sp > 60 && w < 0.4 && (Math.random() < (c.surface === 'kerb' ? 0.6 : 0.06) * (sp / 90))) this.fx.sparks(world(0, -1.6 + Math.random() * 1.5), vel.clone().multiplyScalar(0.3));
    if ((c.surface === 'gravel' || c.surface === 'grass') && sp > 6) this.fx.dust(world((Math.random() - 0.5) * 1.6, -1.6), c.surface === 'gravel' ? 0xc8b48a : 0x7a6a4a);
  }

  // ---------------- camera ----------------
  updateCamera(dt) {
    const c = this.car;
    const grp = this.model.group;
    const sp = c.speed;
    let fov;
    this.headX = lerp(this.headX || 0, clamp(-c.ay * 0.0045, -0.06, 0.06), Math.min(1, dt * 6));
    this.headZ = lerp(this.headZ || 0, clamp(-c.ax * 0.0025, -0.05, 0.05), Math.min(1, dt * 6));
    const shake = (c.surface === 'kerb' ? 0.012 : c.surface !== 'asphalt' ? 0.02 : 0.0015 + sp * 0.00003);
    if (this.camMode <= 1) {
      grp.updateMatrixWorld();
      const eye = this.camMode === 0
        ? new THREE.Vector3(this.headX, 0.9 + (Math.random() - 0.5) * shake, 0.3 + this.headZ)
        : new THREE.Vector3(0, 1.22 + (Math.random() - 0.5) * shake * 0.5, 0.1);
      const look = this.camMode === 0 ? new THREE.Vector3(this.headX * 2, 0.72, 8) : new THREE.Vector3(0, 0.75, 8);
      eye.applyMatrix4(grp.matrixWorld);
      look.applyMatrix4(grp.matrixWorld);
      this.camera.position.copy(eye);
      this.camera.up.set(0, 1, 0).applyAxisAngle(new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw)), -this.headX * 0.8);
      this.camera.lookAt(look);
      fov = this.camMode === 0 ? 78 + Math.min(8, sp * 0.08) : 64 + Math.min(10, sp * 0.1);
      this.camPos = null;
    } else {
      const f = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
      const dist = this.camMode === 2 ? 6.2 : 10;
      const h = this.camMode === 2 ? 1.9 : 3.4;
      const want = c.pos.clone().addScaledVector(f, -dist).add(new THREE.Vector3(0, h, 0));
      if (!this.camPos || this.camPos.distanceTo(want) > 40) this.camPos = want.clone();
      this.camPos.lerp(want, Math.min(1, dt * 8));
      this.camera.up.set(0, 1, 0);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(c.pos.clone().addScaledVector(f, 4).add(new THREE.Vector3(0, 0.9, 0)));
      fov = 60 + Math.min(14, sp * 0.14);
    }
    this.camera.near = this.camMode === 0 ? 0.03 : 0.1;
    if (Math.abs(this.camera.fov - fov) > 0.05 || this.camera.near !== this.lastNear) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
      this.lastNear = this.camera.near;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---------------- loop ----------------
  frame() {
    const now = performance.now();
    const dt = this.fixedDt || Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'menu') {
      const s = this.show;
      s.a += dt * 0.3;
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(Math.sin(s.a) * 7.2, 2.2, Math.cos(s.a) * 7.2);
      this.camera.lookAt(0, 0.45, 0);
      if (this.camera.fov !== 38) { this.camera.fov = 38; this.camera.near = 0.1; this.camera.updateProjectionMatrix(); }
      this.renderer.toneMappingExposure = 1;
      this.renderer.render(s.scene, this.camera);
      return;
    }
    const inp = this.sampleInputOverride ? this.sampleInputOverride() : sampleInput();
    if (inp.pause) { if (this.state === 'paused') this.resume(); else this.pause(); }
    if (inp.mute) audio.toggle();
    if (this.state === 'paused') { this.draw(); return; }
    const c = this.car;
    if (inp.cam) { this.camMode = (this.camMode + 1) % 4; $('camName').textContent = CAMS[this.camMode]; }
    if (inp.hud) this.hudMin = !this.hudMin;
    $('hud').classList.toggle('min', this.hudMin);

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
      if (r === 'overrev') { audio.deny(); $('gearBox').classList.add('deny'); setTimeout(() => $('gearBox').classList.remove('deny'), 300); } else if (r) audio.shift();
    }
    if (inp.reset) this.resetToTrack();

    // weather → grip
    this.weather.update(dt, this.camera.position, this.camVel || new THREE.Vector3(), c.pos);
    c.wetness = this.weather.wetness;
    this.wetT = (this.wetT || 0) + dt;
    if (this.wetT > 0.5) { this.wetT = 0; setWetness(this.world.wet, this.weather.wetness); }

    const events = [];
    const drive = held ? { ...inp, throttle: 0, brake: 0, steer: 0, aeroToggle: false } : inp;
    c.update(dt, drive, events);
    if (held) { c.vx = c.vy = c.r = 0; c.gear = 1; } // parked on the grid until the lights go out
    this.lastBrake = drive.brake;
    if (held) c.rpm = 5000 + inp.throttle * 6500;
    for (const e of events) {
      if (e === 'up' || e === 'down') audio.shift();
      else if (e === 'aero-on' || e === 'aero-off') audio.aero?.(e === 'aero-on');
      else if (e.wall) { audio.wall(e.wall); if (e.wall > 8) this.showMsg('УДАР!', '', 'red', 0.8); }
    }
    this.simT += dt;
    if (this.T && this.state === 'drive') this.timing(dt);
    if (!this.T) this.polygonTimers(dt);

    // ghost playback
    if (this.ghost) {
      const lap = this.lap, gd = this.ghost.data;
      if (lap.start != null && gd.length > 1) {
        const t = this.simT - lap.start;
        let i = this.ghostI || 0;
        if (i >= gd.length - 1 || gd[i][0] > t) i = 0;
        while (i < gd.length - 2 && gd[i + 1][0] < t) i++;
        this.ghostI = i;
        const a = gd[i], b = gd[i + 1];
        const u = clamp((t - a[0]) / Math.max(1e-3, b[0] - a[0]), 0, 1);
        const vis = t <= gd[gd.length - 1][0];
        this.ghost.mesh.visible = vis;
        if (vis) {
          this.ghost.mesh.position.set(lerp(a[1], b[1], u), lerp(a[2], b[2], u), lerp(a[3], b[3], u));
          this.ghost.mesh.rotation.y = a[4] + Math.atan2(Math.sin(b[4] - a[4]), Math.cos(b[4] - a[4])) * u;
        }
      } else this.ghost.mesh.visible = false;
    }

    this.syncModel(dt);
    this.effects(dt);
    this.updateDash(dt);
    if (this.T) {
      const lap = this.lap;
      const t = lap.start != null ? this.simT - lap.start : 0;
      $('curTime').textContent = fmt(t);
      $('lapNo').textContent = this.mode === 'trial' ? `КРУГ ${clamp(lap.n, 1, this.sel.laps)}/${this.sel.laps}` : `КРУГ ${Math.max(1, lap.n)}`;
      $('invalid').classList.toggle('hidden', lap.valid || lap.start == null);
      const d = lap.start != null ? this.liveDelta(t, c.loc.s) : null;
      const de = $('delta');
      de.textContent = d == null ? '' : fmtDelta(d);
      de.className = `delta ${d == null ? '' : d < 0 ? 'minus' : 'plus'}`;
      this.drawMinimap();
      const tan = this.T.tan[c.loc.i];
      const wrong = (Math.sin(c.yaw) * tan.x + Math.cos(c.yaw) * tan.z) < -0.4 && c.vx > 5;
      if (wrong && this.msgT <= 0) this.showMsg('НЕ В ТУ СТОРОНУ', 'развернись или нажми R', 'red', 0.5);
    }
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.showMsg(''); }
    audio.engine(c.rpm, held ? inp.throttle : inp.throttle * (c.shiftCut > 0 ? 0.2 : 1), c.speed, true, c.limiter);
    audio.ers(c.deploying ? 1 : c.harvesting ? 0.6 : 0, c.speed);
    audio.rain(this.weather.rain);
    audio.kerb(c.surface === 'kerb' && c.speed > 5);

    // night: move the real lights to the nearest floodlights
    if (this.lampLights.length) {
      this.lampT = (this.lampT || 0) - dt;
      if (this.lampT <= 0) {
        this.lampT = 0.25;
        const near = this.world.lamps.map((p) => [p.distanceToSquared(c.pos), p]).sort((a, b) => a[0] - b[0]).slice(0, this.lampLights.length);
        near.forEach(([, p], i) => this.lampLights[i].position.copy(p));
      }
    }

    const prevCam = this.camera.position.clone();
    this.updateCamera(dt);
    this.camVel = this.camera.position.clone().sub(prevCam).divideScalar(Math.max(dt, 1e-3));
    this.visor.update(dt, this.weather.rain, c.speed, this.camMode === 0);
    this.fx.update(dt, this.camera, this.renderer.getPixelRatio());
    this.draw();
  }

  draw() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resetToTrack() {
    const c = this.car;
    if (!this.T) { c.vx = c.vy = c.r = 0; return; }
    const T = this.T;
    const i = c.loc.i;
    const p = T.pts[i], t = T.tan[i];
    const keep = { es: c.es, tyreT: c.tyreT.slice(), wear: c.wear.slice() };
    c.place(p.x, p.y, p.z, Math.atan2(t.x, t.z));
    Object.assign(c, keep);
    if (this.lap.start != null) this.lap.valid = false;
    this.showMsg('Возврат на трассу', 'круг не будет засчитан', 'red', 1.2);
    this.camPos = null;
  }
}

window.gp = new Game();
