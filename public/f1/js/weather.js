import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

// Photographed skies (CC0 HDR panoramas from Poly Haven) light the whole scene and are seen as the background.
export const WEATHERS = {
  clear: { name: 'Ясно', rain: 0, fog: 0.00028 },
  cloudy: { name: 'Облачно', rain: 0, fog: 0.0006, overcast: true },
  drizzle: { name: 'Дождик', rain: 0.35, fog: 0.0011, overcast: true },
  rain: { name: 'Ливень', rain: 1, fog: 0.0022, overcast: true },
  fog: { name: 'Туман', rain: 0, fog: 0.0065, overcast: true },
  changeable: { name: 'Переменная', rain: 0, fog: 0.0006, overcast: true, dynamic: true },
};
export const TIMES = {
  morning: { name: 'Утро' },
  day: { name: 'День' },
  sunset: { name: 'Закат' },
  night: { name: 'Ночь' },
};

/** Which panorama to use for the chosen conditions. */
export function pickSky(weather, time, theme) {
  const w = WEATHERS[weather] || WEATHERS.clear;
  if (time === 'night') return theme === 'street' ? 'moonless_golf_1k' : 'dikhololo_night_1k';
  if (w.overcast) return 'blouberg_sunrise_2_1k';
  if (time === 'morning') return 'spruit_sunrise_1k';
  if (time === 'sunset') return theme === 'street' ? 'venice_sunset_1k' : 'kiara_1_dawn_1k';
  return 'quarry_01_1k';
}

const cache = new Map();
/**
 * Panoramas ship as lossless PNGs (left half RGB mantissas, right half exponent in R),
 * decoded here to linear float RGB and uploaded as a half-float equirect texture.
 */
function loadHDR(name) {
  if (!cache.has(name)) {
    cache.set(name, (async () => {
      const res = await fetch(`assets/${name}.sky.png`);
      if (!res.ok) throw new Error(`sky ${name}: ${res.status}`);
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const W = bmp.width, w = W / 2, h = bmp.height;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = h;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, W, h).data;
      const f = new Float32Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const m = (y * W + x) * 4, e = (y * W + x + w) * 4;
          const k = px[e] ? 2 ** (px[e] - 136) : 0;
          const o = (y * w + x) * 4;
          f[o] = px[m] * k; f[o + 1] = px[m + 1] * k; f[o + 2] = px[m + 2] * k; f[o + 3] = 1;
        }
      }
      const half = new Uint16Array(f.length);
      for (let i = 0; i < f.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(f[i], 65000));
      const t = new THREE.DataTexture(half, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
      t.flipY = true;
      t.colorSpace = THREE.LinearSRGBColorSpace;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.needsUpdate = true;
      t.userData.float = f; // kept for analysing the sun position
      return t;
    })());
  }
  return cache.get(name);
}

let flareTex = null;
function flareTextures() {
  if (!flareTex) {
    const l = new THREE.TextureLoader();
    flareTex = [l.load('assets/flare0.png'), l.load('assets/flare3.png')];
    for (const t of flareTex) t.colorSpace = THREE.SRGBColorSpace;
  }
  return flareTex;
}

/** Brightest direction, its colour, and the average horizon colour of an equirect HDR. */
function analyse(tex) {
  const data = tex.userData.float;
  const { width: w, height: h } = tex.image;
  let best = 0, bi = 0, sum = 0;
  for (let i = 0; i < w * h; i++) {
    const l = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2];
    sum += l;
    if (l > best) { best = l; bi = i; }
  }
  const x = bi % w, y = Math.floor(bi / w);
  const elev = (0.5 - (y + 0.5) / h) * Math.PI;
  const phi = ((x + 0.5) / w - 0.5) * Math.PI * 2;
  // three.js equirect: u = atan2(dir.z, dir.x) / 2pi + 0.5
  const dir = new THREE.Vector3(Math.cos(phi) * Math.cos(elev), Math.sin(elev), Math.sin(phi) * Math.cos(elev)).normalize();
  const avg = (y0, y1) => {
    const c = new THREE.Color(0, 0, 0);
    let n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = 0; xx < w; xx += 2) {
      const i = (yy * w + xx) * 4;
      c.r += data[i]; c.g += data[i + 1]; c.b += data[i + 2]; n++;
    }
    return c.multiplyScalar(1 / n);
  };
  const horizon = avg(Math.floor(h * 0.44), Math.floor(h * 0.5));
  // colour of the light near the sun (a few pixels around the peak, clamped)
  const sun = new THREE.Color(0, 0, 0);
  let n = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const xx = (x + dx + w) % w, yy = Math.min(h - 1, Math.max(0, y + dy));
    const i = (yy * w + xx) * 4;
    sun.r += data[i]; sun.g += data[i + 1]; sun.b += data[i + 2]; n++;
  }
  sun.multiplyScalar(1 / n);
  const m = Math.max(sun.r, sun.g, sun.b) || 1;
  sun.multiplyScalar(1 / m);
  return { dir, peak: best / 3, mean: sum / (w * h * 3), horizon, sunColor: sun };
}

const lerp = (a, b, t) => a + (b - a) * t;

export class Weather {
  constructor(scene, renderer, { weather = 'clear', time = 'day', quality = 1, theme = 'park' }) {
    this.scene = scene;
    this.renderer = renderer;
    this.preset = WEATHERS[weather] || WEATHERS.clear;
    this.timeKey = time;
    this.night = time === 'night';
    this.quality = quality;
    this.rain = this.preset.rain;
    this.fogD = this.preset.fog;
    this.wetness = this.preset.rain > 0 ? 0.25 + this.preset.rain * 0.7 : 0;
    this.dynT = 60 + Math.random() * 60;
    this.target = { rain: this.rain, fog: this.fogD };
    this.skyName = pickSky(weather, time, theme);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    const sm = quality >= 2 ? 4096 : quality >= 1 ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -40; sc.right = sc.top = 40; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xdfeaf5, 0x3a3a30, 0.15);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xc8d4de, this.fogD);
    scene.fog = this.fog;
    this.sunDir = new THREE.Vector3(0.3, 0.6, 0.2).normalize();

    // rain streaks around the camera
    const N = quality >= 2 ? 6000 : quality >= 1 ? 3500 : 1800;
    this.drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.drops[i * 3] = (Math.random() - 0.5) * 60; this.drops[i * 3 + 1] = Math.random() * 30; this.drops[i * 3 + 2] = (Math.random() - 0.5) * 60; }
    this.rainPos = new Float32Array(N * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    rg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.rainGeo = rg;
    this.rainMesh = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xb8c2cc, transparent: true, opacity: 0.28, depthWrite: false }));
    this.rainMesh.frustumCulled = false;
    scene.add(this.rainMesh);

    this.ready = loadHDR(this.skyName).then((tex) => this.applyHDR(tex)).catch((e) => { console.warn('sky load failed', e); this.fallback(); });
  }

  applyHDR(tex) {
    const a = analyse(tex);
    this.info = a;
    const scene = this.scene;
    scene.background = tex;
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pm.fromEquirectangular(tex);
    pm.dispose();
    scene.environment = this.envRT.texture;
    // normalise brightness between panoramas, then dim for rain
    const target = this.night ? 0.05 : 0.55;
    const k = THREE.MathUtils.clamp(target / Math.max(a.mean, 1e-4), 0.25, 4);
    this.baseK = k;
    this.hasSun = a.peak > 800 && !this.preset.overcast;
    // the sun: from the panorama, but never so low that the shadows are useless
    const d = a.dir.clone();
    if (this.night || !this.hasSun) d.set(0.3, 1, 0.2).normalize();
    else if (d.y < 0.3) { d.y = 0.3; d.normalize(); }
    this.sunDir = d;
    this.sun.color.copy(this.night ? new THREE.Color(0xdfe6ff) : this.hasSun ? a.sunColor : new THREE.Color(0xe8eef4));
    this.horizon = a.horizon.clone().multiplyScalar(k);
    if (this.hasSun && this.quality >= 1) {
      const [f0, f3] = flareTextures();
      const light = new THREE.PointLight(0xffffff, 0, 0);
      const lf = new Lensflare();
      lf.addElement(new LensflareElement(f0, 170, 0, this.sun.color));
      lf.addElement(new LensflareElement(f3, 60, 0.6));
      lf.addElement(new LensflareElement(f3, 70, 0.7));
      lf.addElement(new LensflareElement(f3, 120, 0.9));
      lf.addElement(new LensflareElement(f3, 70, 1.0));
      light.add(lf);
      this.flare = light;
      scene.add(light);
    }
    this.applyLevels();
  }

  /** Fallback when the panorama cannot be loaded: flat sky colour. */
  fallback() {
    this.scene.background = new THREE.Color(this.night ? 0x0b0e16 : 0x9cc0e0);
    this.horizon = new THREE.Color(this.night ? 0x0b0e16 : 0xc5d3df);
    this.baseK = 1;
    this.hemi.intensity = 0.9;
    this.applyLevels();
  }

  /** Light levels for the current rain intensity. */
  applyLevels() {
    const r = this.rain;
    const k = this.baseK || 1;
    const dim = 1 - 0.5 * r;
    this.scene.backgroundIntensity = k * dim;
    this.scene.environmentIntensity = k * (this.night ? 1.6 : 0.65) * (1 - 0.35 * r);
    this.sun.intensity = this.night ? 0.8 : this.hasSun ? (this.timeKey === 'day' ? 3.2 : 2.4) : 0.55 * dim;
    this.hemi.intensity = this.night ? 0.35 : 0.12;
    const fogCol = (this.horizon || new THREE.Color(0xc5d3df)).clone();
    // keep the fog in a believable range regardless of panorama brightness
    const m = Math.max(fogCol.r, fogCol.g, fogCol.b);
    if (m > 0.85) fogCol.multiplyScalar(0.85 / m);
    fogCol.lerp(new THREE.Color(0x59616a), r * 0.5);
    this.fog.color.copy(fogCol);
    this.fog.density = this.fogD;
    this.renderer.toneMappingExposure = this.night ? 1.05 : 1.0;
  }

  update(dt, camPos, camVel, focus) {
    if (this.preset.dynamic) {
      this.dynT -= dt;
      if (this.dynT <= 0) {
        this.dynT = 70 + Math.random() * 90;
        const roll = Math.random();
        this.target = roll < 0.4 ? { rain: 0, fog: 0.0005 } : roll < 0.75 ? { rain: 0.4, fog: 0.0012 } : { rain: 1, fog: 0.002 };
      }
      const k = Math.min(1, dt * 0.05);
      this.rain = lerp(this.rain, this.target.rain, k);
      this.fogD = lerp(this.fogD, this.target.fog, k);
      this.levelT = (this.levelT || 0) + dt;
      if (this.levelT > 0.5) { this.levelT = 0; this.applyLevels(); }
    }
    const wetTarget = this.rain > 0.05 ? Math.min(1, 0.3 + this.rain * 0.7) : 0;
    const rate = wetTarget > this.wetness ? 0.02 * (0.3 + this.rain) : 0.0035 * (this.night ? 0.5 : this.hasSun ? 1.4 : 0.8);
    this.wetness += Math.sign(wetTarget - this.wetness) * Math.min(Math.abs(wetTarget - this.wetness), rate * dt);

    this.sun.position.copy(focus).addScaledVector(this.sunDir, 250);
    this.sun.target.position.copy(focus);
    if (this.flare) {
      const d = this.info.dir;
      this.flare.position.copy(camPos).addScaledVector(d, 2500);
      this.flare.visible = this.rain < 0.2;
    }

    // rain streaks
    const N = this.drops.length / 3;
    const active = Math.floor(N * Math.min(1, this.rain * 1.1));
    const fall = 11;
    const sx = -camVel.x * 0.035, sy = fall * 0.035 + camVel.y * 0.035, sz = -camVel.z * 0.035;
    const P = this.rainPos, D = this.drops;
    for (let i = 0; i < N; i++) {
      let x = D[i * 3], y = D[i * 3 + 1], z = D[i * 3 + 2];
      y -= fall * dt;
      x -= camVel.x * dt * 0.3; z -= camVel.z * dt * 0.3;
      if (y < -2) y += 30;
      if (x < -30) x += 60; else if (x > 30) x -= 60;
      if (z < -30) z += 60; else if (z > 30) z -= 60;
      D[i * 3] = x; D[i * 3 + 1] = y; D[i * 3 + 2] = z;
      const wx = camPos.x + x, wy = camPos.y - 6 + y, wz = camPos.z + z;
      if (i < active) P.set([wx, wy, wz, wx + sx, wy + sy, wz + sz], i * 6);
      else P.set([0, -999, 0, 0, -999, 0], i * 6);
    }
    this.rainGeo.attributes.position.needsUpdate = true;
    this.rainMesh.visible = this.rain > 0.02;
  }

  name() { return this.preset.name; }
}

/** Water droplets on the helmet visor (first-person view in the rain). */
export class Visor {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.drops = [];
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.c.width = Math.round(innerWidth / 2);
    this.c.height = Math.round(innerHeight / 2);
  }

  update(dt, rain, speed, on) {
    const g = this.g;
    const W = this.c.width, H = this.c.height;
    g.clearRect(0, 0, W, H);
    this.c.style.display = on && (rain > 0.02 || this.drops.length) ? 'block' : 'none';
    if (!on) { this.drops.length = 0; return; }
    const spawn = rain * 40 * dt * (1 + speed / 40);
    for (let i = 0; i < spawn; i++) if (this.drops.length < 260) this.drops.push({ x: Math.random() * W, y: Math.random() * H, r: 1.5 + Math.random() * 4, life: 1 + Math.random() * 2 });
    // airflow pushes drops outward from the centre and upward at speed
    const push = Math.max(0, speed - 15) * 0.9;
    for (const d of this.drops) {
      d.life -= dt;
      const dx = d.x - W / 2, dy = d.y - H * 0.55;
      const len = Math.hypot(dx, dy) || 1;
      d.x += (dx / len) * push * dt * 10;
      d.y += ((dy / len) * push * 0.5 - push * 0.7) * dt * 10;
      const a = Math.max(0, Math.min(1, d.life)) * 0.55;
      g.fillStyle = `rgba(210,225,240,${a * 0.35})`;
      g.beginPath(); g.arc(d.x, d.y, d.r, 0, Math.PI * 2); g.fill();
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath(); g.arc(d.x - d.r * 0.3, d.y - d.r * 0.35, d.r * 0.3, 0, Math.PI * 2); g.fill();
    }
    this.drops = this.drops.filter((d) => d.life > 0 && d.x > -10 && d.x < W + 10 && d.y > -10 && d.y < H + 10);
  }
}
