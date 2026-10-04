import * as THREE from 'three';

// Pooled particles drawn as soft round point sprites.
class ParticleSystem {
  constructor(scene, max, blending) {
    this.max = max;
    this.p = [];
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute vec4 aColor; attribute float aSize; uniform float scale; varying vec4 vC;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d)*4.0;
          if (r > 1.0) discard; gl_FragColor = vec4(vC.rgb, vC.a * (1.0 - r)); }`,
    });
    this.mat = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, { vx = 0, vy = 0, vz = 0, life = 1, size = 1, grow = 0, color = 0xffffff, alpha = 1, gravity = 0, drag = 0 } = {}) {
    if (this.p.length >= this.max) this.p.shift();
    const c = new THREE.Color(color);
    this.p.push({ x, y, z, vx, vy, vz, life, max: life, size, grow, r: c.r, g: c.g, b: c.b, alpha, gravity, drag });
  }

  update(dt) {
    const p = this.p;
    let n = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[i];
      q.life -= dt;
      if (q.life <= 0) continue;
      q.vy -= q.gravity * dt;
      const k = Math.max(0, 1 - q.drag * dt);
      q.vx *= k; q.vy *= k; q.vz *= k;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0.05 && q.gravity > 0) { q.y = 0.05; q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
      q.size += q.grow * dt;
      p[n++] = q;
      const t = q.life / q.max;
      const j = n - 1;
      this.pos[j * 3] = q.x; this.pos[j * 3 + 1] = q.y; this.pos[j * 3 + 2] = q.z;
      this.col[j * 4] = q.r; this.col[j * 4 + 1] = q.g; this.col[j * 4 + 2] = q.b; this.col[j * 4 + 3] = q.alpha * Math.min(1, t * 2);
      this.size[j] = q.size;
    }
    p.length = n;
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aColor', 'aSize']) this.geo.attributes[k].needsUpdate = true;
  }
}

class Tracers {
  constructor(scene, max = 64) {
    this.max = max;
    this.list = [];
    this.pos = new Float32Array(max * 6);
    this.col = new Float32Array(max * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = geo;
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    lines.frustumCulled = false;
    scene.add(lines);
  }

  add(a, b, color = 0xffe9a0) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ a: a.clone(), b: b.clone(), life: 0.07, c: new THREE.Color(color) });
  }

  update(dt) {
    let n = 0;
    for (const t of this.list) {
      t.life -= dt;
      if (t.life <= 0) continue;
      this.list[n++] = t;
      const j = n - 1;
      const k = t.life / 0.07;
      this.pos.set([t.a.x, t.a.y, t.a.z, t.b.x, t.b.y, t.b.z], j * 6);
      this.col.set([t.c.r * k * 0.3, t.c.g * k * 0.3, t.c.b * k * 0.3, t.c.r * k, t.c.g * k, t.c.b * k], j * 6);
    }
    this.list.length = n;
    this.geo.setDrawRange(0, n * 2);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// Tyre marks: a ring buffer of flat quads.
class Skids {
  constructor(scene, max = 3000) {
    this.max = max;
    this.i = 0;
    this.pos = new Float32Array(max * 18);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = geo;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.frustumCulled = false;
    m.renderOrder = 1;
    scene.add(m);
  }

  add(a, b, w = 0.28, y = 0.09) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01 || len > 4) return;
    const nx = (-dz / len) * w * 0.5, nz = (dx / len) * w * 0.5;
    const ya = a.y + y, yb = b.y + y;
    const v = [
      a.x + nx, ya, a.z + nz, a.x - nx, ya, a.z - nz, b.x + nx, yb, b.z + nz,
      a.x - nx, ya, a.z - nz, b.x - nx, yb, b.z - nz, b.x + nx, yb, b.z + nz,
    ];
    this.pos.set(v, this.i * 18);
    this.i = (this.i + 1) % this.max;
    this.geo.attributes.position.needsUpdate = true;
  }
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new ParticleSystem(scene, 1600, THREE.NormalBlending);
    this.glow = new ParticleSystem(scene, 1200, THREE.AdditiveBlending);
    this.tracers = new Tracers(scene);
    this.skids = new Skids(scene);
    this.shake = 0;
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 40, 1.6);
      scene.add(l);
      this.lights.push({ l, t: 0 });
    }
    this.coinGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16);
    this.coinMat = new THREE.MeshStandardMaterial({ color: 0x5fd35f, emissive: 0x2a8a2a, emissiveIntensity: 0.5, metalness: 0.3 });
  }

  flash(pos, intensity = 30, dur = 0.25) {
    const s = this.lights.sort((a, b) => a.t - b.t)[0];
    s.l.position.copy(pos);
    s.l.position.y += 1.5;
    s.l.intensity = intensity;
    s.t = dur;
    s.max = dur;
    s.peak = intensity;
  }

  muzzle(p, dir) {
    for (let i = 0; i < 4; i++) {
      this.glow.emit(p.x + dir.x * i * 0.12, p.y + dir.y * i * 0.12, p.z + dir.z * i * 0.12, { life: 0.05, size: 0.5 - i * 0.08, color: 0xffd070 });
    }
  }

  impact(p, n, color = 0xffd27a) {
    for (let i = 0; i < 6; i++) {
      this.glow.emit(p.x, p.y, p.z, {
        vx: n.x * 3 + (Math.random() - 0.5) * 6, vy: n.y * 3 + Math.random() * 4, vz: n.z * 3 + (Math.random() - 0.5) * 6,
        life: 0.25, size: 0.12, color, gravity: 15,
      });
    }
    this.smoke.emit(p.x, p.y, p.z, { vy: 0.6, life: 0.6, size: 0.5, grow: 1.5, color: 0xbbbbbb, alpha: 0.5 });
  }

  feathers(p, n = 10) {
    for (let i = 0; i < n; i++) {
      this.smoke.emit(p.x, p.y + 1, p.z, {
        vx: (Math.random() - 0.5) * 5, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 5,
        life: 1.2, size: 0.18, color: i % 3 ? 0xffffff : 0x1d2442, gravity: 3, drag: 2,
      });
    }
  }

  explosion(p, size = 1) {
    this.flash(p, 80 * size, 0.5);
    for (let i = 0; i < 40 * size; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      const s = 6 + Math.random() * 10;
      this.glow.emit(p.x, p.y + 0.5, p.z, {
        vx: Math.cos(a) * s * (1 - u * 0.5), vy: u * s, vz: Math.sin(a) * s * (1 - u * 0.5),
        life: 0.4 + Math.random() * 0.4, size: 1.2 + Math.random() * 1.8 * size, grow: -1, color: [0xffd04a, 0xff8a20, 0xff5a10][i % 3], drag: 3,
      });
    }
    for (let i = 0; i < 25 * size; i++) {
      this.smoke.emit(p.x + (Math.random() - 0.5) * 2, p.y + 1, p.z + (Math.random() - 0.5) * 2, {
        vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 5, vz: (Math.random() - 0.5) * 5,
        life: 2 + Math.random() * 1.5, size: 2 + Math.random() * 2, grow: 2.5, color: 0x333333, alpha: 0.7, drag: 1.2,
      });
    }
    for (let i = 0; i < 20; i++) {
      this.glow.emit(p.x, p.y + 0.5, p.z, {
        vx: (Math.random() - 0.5) * 24, vy: Math.random() * 16, vz: (Math.random() - 0.5) * 24,
        life: 0.9, size: 0.15, color: 0xffc060, gravity: 20,
      });
    }
    this.shake = Math.max(this.shake, 0.9 * size);
  }

  tyreSmoke(p, amount = 1) {
    this.smoke.emit(p.x + (Math.random() - 0.5) * 0.4, p.y + 0.2, p.z + (Math.random() - 0.5) * 0.4, {
      vx: (Math.random() - 0.5) * 1.5, vy: 0.6 + Math.random(), vz: (Math.random() - 0.5) * 1.5,
      life: 1.1, size: 0.7 * amount, grow: 2.2, color: 0xe8e8e8, alpha: 0.45, drag: 1.5,
    });
  }

  fire(p) {
    this.glow.emit(p.x + (Math.random() - 0.5), p.y, p.z + (Math.random() - 0.5), {
      vy: 2 + Math.random() * 2, life: 0.5, size: 0.9 + Math.random() * 0.6, grow: -1, color: Math.random() < 0.5 ? 0xff7a20 : 0xffc040,
    });
    if (Math.random() < 0.4) this.smoke.emit(p.x, p.y + 1, p.z, { vy: 3, life: 1.8, size: 1, grow: 2, color: 0x2a2a2a, alpha: 0.6 });
  }

  dust(p) {
    this.smoke.emit(p.x, p.y + 0.1, p.z, { vx: (Math.random() - 0.5) * 2, vy: 0.5, vz: (Math.random() - 0.5) * 2, life: 0.6, size: 0.6, grow: 1.5, color: 0xd8d0c0, alpha: 0.5 });
  }

  update(dt, camera) {
    this.smoke.update(dt);
    this.glow.update(dt);
    this.tracers.update(dt);
    for (const s of this.lights) {
      if (s.t > 0) { s.t -= dt; s.l.intensity = Math.max(0, s.peak * (s.t / s.max)); } else s.l.intensity = 0;
    }
    const h = window.innerHeight;
    const scale = (h * (this.pixelRatio || 1)) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.smoke.mat.uniforms.scale.value = scale;
    this.glow.mat.uniforms.scale.value = scale;
    this.shake = Math.max(0, this.shake - dt * 1.8);
  }
}
