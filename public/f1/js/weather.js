import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import * as TX from './textures.js';

export const WEATHERS = {
  clear: { name: 'Ясно', clouds: 0.12, rain: 0, fog: 0.00035 },
  cloudy: { name: 'Облачно', clouds: 0.8, rain: 0, fog: 0.0006 },
  drizzle: { name: 'Дождик', clouds: 0.92, rain: 0.35, fog: 0.0011 },
  rain: { name: 'Ливень', clouds: 1, rain: 1, fog: 0.0022 },
  fog: { name: 'Туман', clouds: 0.55, rain: 0, fog: 0.0065 },
  changeable: { name: 'Переменная', clouds: 0.5, rain: 0, fog: 0.0006, dynamic: true },
};
export const TIMES = {
  morning: { name: 'Утро', elev: 12, azim: 100 },
  day: { name: 'День', elev: 52, azim: 160 },
  sunset: { name: 'Закат', elev: 3.5, azim: 255 },
  night: { name: 'Ночь', elev: -18, azim: 200 },
};

const lerp = (a, b, t) => a + (b - a) * t;

/** Sky, sun, clouds, fog, rain and track wetness for one session. */
export class Weather {
  constructor(scene, renderer, { weather = 'clear', time = 'day', quality = 1 }) {
    this.scene = scene;
    this.renderer = renderer;
    this.preset = WEATHERS[weather] || WEATHERS.clear;
    this.time = TIMES[time] || TIMES.day;
    this.night = this.time.elev < 0;
    this.quality = quality;
    // current (smoothed) conditions
    this.clouds = this.preset.clouds;
    this.rain = this.preset.rain;
    this.fogD = this.preset.fog;
    this.wetness = this.preset.rain > 0 ? 0.25 + this.preset.rain * 0.7 : 0;
    this.dynT = 60 + Math.random() * 60;
    this.target = { ...this.preset };

    // physical sky
    const sky = new Sky();
    sky.scale.setScalar(4000);
    this.sky = sky;
    scene.add(sky);
    // overcast dome dims the sky as clouds thicken
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(3800, 32, 16), new THREE.MeshBasicMaterial({ color: 0x8a9096, side: THREE.BackSide, transparent: true, depthWrite: false, fog: false }));
    scene.add(this.dome);
    // cloud layer
    this.cloudTex = TX.clouds(Math.min(1, this.clouds + 0.1));
    this.cloudTex.repeat.set(3, 3);
    this.cloudMat = new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
    this.cloudMesh = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), this.cloudMat);
    this.cloudMesh.rotation.x = Math.PI / 2;
    this.cloudMesh.position.y = 700;
    scene.add(this.cloudMesh);
    // stars at night
    if (this.night) {
      const pos = [];
      for (let i = 0; i < 1500; i++) {
        const u = Math.random(), t = Math.random() * Math.PI * 2;
        const y = 0.1 + u * 0.9;
        const r = Math.sqrt(1 - y * y);
        pos.push(Math.cos(t) * r * 3500, y * 3500, Math.sin(t) * r * 3500);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
      scene.add(this.stars);
    }

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sm = quality >= 2 ? 4096 : quality >= 1 ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -45; sc.right = sc.top = 45; sc.near = 1; sc.far = 500;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xdfeaf5, 0x4a4636, 0.6);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xc8d4de, this.fogD);
    scene.fog = this.fog;

    // rain streaks around the camera
    const N = quality >= 2 ? 6000 : quality >= 1 ? 3500 : 1800;
    this.drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.drops[i * 3] = (Math.random() - 0.5) * 60; this.drops[i * 3 + 1] = Math.random() * 30; this.drops[i * 3 + 2] = (Math.random() - 0.5) * 60; }
    this.rainPos = new Float32Array(N * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    rg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.rainGeo = rg;
    this.rainMesh = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xc8d2dc, transparent: true, opacity: 0.32, depthWrite: false }));
    this.rainMesh.frustumCulled = false;
    scene.add(this.rainMesh);

    this.applySky(true);
  }

  sunDir() {
    const phi = THREE.MathUtils.degToRad(90 - this.time.elev);
    const theta = THREE.MathUtils.degToRad(this.time.azim);
    return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  }

  /** Updates sky colours, lights and the environment map for the current cloud cover. */
  applySky(rebuildEnv) {
    const u = this.sky.material.uniforms;
    const c = this.clouds;
    const elev = this.time.elev;
    u.turbidity.value = lerp(2.5, 14, c);
    u.rayleigh.value = elev < 10 ? 2.6 : lerp(1.2, 3, c);
    u.mieCoefficient.value = lerp(0.004, 0.02, c);
    u.mieDirectionalG.value = 0.82;
    const dir = this.sunDir();
    u.sunPosition.value.copy(dir);
    const night = this.night;
    const warm = elev < 15 && !night ? 1 - elev / 15 : 0;
    // overcast dome colour/opacity
    const grey = night ? 0x0b0e14 : new THREE.Color(0x9aa1a8).lerp(new THREE.Color(0x6a7078), this.rain).getHex();
    this.dome.material.color.set(grey);
    this.dome.material.opacity = night ? 0.85 : c * 0.82;
    this.cloudMat.opacity = night ? 0.25 : 0.25 + c * 0.75;
    this.cloudMat.color.set(night ? 0x222833 : new THREE.Color(0xffffff).lerp(new THREE.Color(0x7d8389), this.rain));
    if (warm) this.cloudMat.color.lerp(new THREE.Color(0xffb27a), warm * 0.6);

    // sun (or floodlights at night)
    const sunCol = new THREE.Color(0xfff4e6).lerp(new THREE.Color(0xff9a52), warm * 0.85);
    this.sun.color.copy(night ? new THREE.Color(0xdfe8ff) : sunCol);
    this.sun.intensity = night ? 0.9 : lerp(3.4, 0.55, c) * (elev < 6 ? 0.55 : 1);
    this.hemi.intensity = night ? 0.55 : lerp(0.55, 1.3, c);
    this.hemi.color.set(night ? 0x8090b0 : warm ? 0xffd2b0 : 0xdfeaf5);
    this.hemi.groundColor.set(night ? 0x1a1a20 : 0x4a4636);
    // fog colour follows the horizon
    const fogCol = night ? new THREE.Color(0x0d1018) : new THREE.Color(0xc5d3df).lerp(new THREE.Color(0x8d959c), Math.max(c - 0.4, 0) * 1.4);
    if (warm) fogCol.lerp(new THREE.Color(0xe8a878), warm * 0.5);
    this.fog.color.copy(fogCol);
    this.fog.density = this.fogD;
    this.renderer.toneMappingExposure = night ? 0.9 : lerp(0.75, 1.15, c) * (warm ? 0.9 : 1);

    if (rebuildEnv) {
      // reflections: render the sky into a PMREM environment
      const pm = new THREE.PMREMGenerator(this.renderer);
      const envScene = new THREE.Scene();
      const s2 = new Sky();
      s2.scale.setScalar(1000);
      for (const k of Object.keys(u)) s2.material.uniforms[k].value = u[k].value.clone ? u[k].value.clone() : u[k].value;
      envScene.add(s2);
      const d2 = this.dome.clone();
      d2.scale.setScalar(0.2);
      envScene.add(d2);
      if (night) envScene.background = new THREE.Color(0x0a0c12);
      const rt = pm.fromScene(envScene, 0.02);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = night ? 0.35 : lerp(1, 0.7, c);
      pm.dispose();
    }
  }

  /** Called every frame. camVel is the camera velocity (rain streak direction). */
  update(dt, camPos, camVel, focus) {
    // changeable weather: wander between dry and wet spells
    if (this.preset.dynamic) {
      this.dynT -= dt;
      if (this.dynT <= 0) {
        this.dynT = 70 + Math.random() * 90;
        const roll = Math.random();
        this.target = roll < 0.35 ? { clouds: 0.2, rain: 0, fog: 0.0005 } : roll < 0.6 ? { clouds: 0.8, rain: 0, fog: 0.0007 } : roll < 0.85 ? { clouds: 0.95, rain: 0.4, fog: 0.0012 } : { clouds: 1, rain: 1, fog: 0.002 };
      }
      const k = Math.min(1, dt * 0.05);
      const before = this.clouds;
      this.clouds = lerp(this.clouds, this.target.clouds, k);
      this.rain = lerp(this.rain, this.target.rain, k);
      this.fogD = lerp(this.fogD, this.target.fog, k);
      this.envT = (this.envT || 0) + Math.abs(this.clouds - before);
      this.applySky(this.envT > 0.08);
      if (this.envT > 0.08) this.envT = 0;
    }
    // track gets wet in rain and slowly dries
    const wetTarget = this.rain > 0.05 ? Math.min(1, 0.3 + this.rain * 0.7) : 0;
    const rate = wetTarget > this.wetness ? 0.02 * (0.3 + this.rain) : 0.0035 * (this.night ? 0.5 : 1.3 - this.clouds);
    this.wetness += Math.sign(wetTarget - this.wetness) * Math.min(Math.abs(wetTarget - this.wetness), rate * dt);

    // keep the sky things around the camera
    this.sky.position.copy(camPos);
    this.dome.position.copy(camPos);
    if (this.stars) this.stars.position.copy(camPos);
    this.cloudMesh.position.x = camPos.x;
    this.cloudMesh.position.z = camPos.z;
    this.cloudTex.offset.x += dt * 0.0012;
    this.cloudTex.offset.y = (camPos.z / 9000) * 3;
    this.cloudTex.offset.x = (this.cloudTex.offset.x % 1) + 0;
    // shadows follow the car; light comes from the sun (or straight down from floodlights)
    const dir = this.night ? new THREE.Vector3(0.25, 1, 0.15).normalize() : this.sunDir();
    if (!this.night && this.time.elev < 8) dir.y = Math.max(dir.y, 0.14);
    this.sun.position.copy(focus).addScaledVector(dir, 200);
    this.sun.target.position.copy(focus);

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
