import * as THREE from 'three';

// Soft round sprites with per-particle size/colour/alpha.
class Particles {
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
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute vec4 aColor; attribute float aSize; uniform float scale; varying vec4 vC;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d)*4.0;
          if (r > 1.0) discard; gl_FragColor = vec4(vC.rgb, vC.a * (1.0 - r) * (1.0 - r)); }`,
    });
    const pts = new THREE.Points(geo, this.mat);
    pts.frustumCulled = false;
    scene.add(pts);
  }

  emit(x, y, z, o) {
    if (this.p.length >= this.max) this.p.shift();
    const c = new THREE.Color(o.color ?? 0xffffff);
    this.p.push({ x, y, z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: o.life || 1, max: o.life || 1, size: o.size || 1, grow: o.grow || 0, r: c.r, g: c.g, b: c.b, a: o.alpha ?? 1, grav: o.gravity || 0, drag: o.drag || 0 });
  }

  update(dt, scale) {
    let n = 0;
    for (const q of this.p) {
      q.life -= dt;
      if (q.life <= 0) continue;
      q.vy -= q.grav * dt;
      const k = Math.max(0, 1 - q.drag * dt);
      q.vx *= k; q.vy *= k; q.vz *= k;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.size += q.grow * dt;
      this.p[n++] = q;
      const j = n - 1;
      this.pos[j * 3] = q.x; this.pos[j * 3 + 1] = q.y; this.pos[j * 3 + 2] = q.z;
      this.col[j * 4] = q.r; this.col[j * 4 + 1] = q.g; this.col[j * 4 + 2] = q.b; this.col[j * 4 + 3] = q.a * Math.min(1, (q.life / q.max) * 2);
      this.size[j] = q.size;
    }
    this.p.length = n;
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aColor', 'aSize']) this.geo.attributes[k].needsUpdate = true;
    this.mat.uniforms.scale.value = scale;
  }
}

export class FX {
  constructor(scene) {
    this.smoke = new Particles(scene, 1500, THREE.NormalBlending);
    this.glow = new Particles(scene, 600, THREE.AdditiveBlending);
  }

  tyreSmoke(p, k = 1) {
    this.smoke.emit(p.x, p.y + 0.25, p.z, { vx: (Math.random() - 0.5) * 2, vy: 0.6 + Math.random(), vz: (Math.random() - 0.5) * 2, life: 1.6, size: 0.9 * k, grow: 2.4, color: 0xe6e6e6, alpha: 0.4, drag: 1.2 });
  }

  spray(p, vel, amount) {
    this.smoke.emit(p.x + (Math.random() - 0.5) * 0.8, p.y + 0.3, p.z + (Math.random() - 0.5) * 0.8, {
      vx: vel.x * 0.6 + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: vel.z * 0.6 + (Math.random() - 0.5) * 3,
      life: 0.7 + Math.random() * 0.5, size: 1.0 + Math.random() * 1.2, grow: 3, color: 0xc9d0d6, alpha: 0.13 * amount, drag: 2.4,
    });
  }

  sparks(p, vel) {
    for (let i = 0; i < 3; i++) {
      this.glow.emit(p.x + (Math.random() - 0.5) * 0.6, p.y + 0.05, p.z + (Math.random() - 0.5) * 0.6, {
        vx: vel.x * 0.75 + (Math.random() - 0.5) * 4, vy: Math.random() * 2.5, vz: vel.z * 0.75 + (Math.random() - 0.5) * 4,
        life: 0.25 + Math.random() * 0.25, size: 0.07, color: Math.random() < 0.5 ? 0xffd27a : 0xffffff, gravity: 12, drag: 0.5,
      });
    }
  }

  dust(p, color = 0xc8b48a) {
    this.smoke.emit(p.x + (Math.random() - 0.5), p.y + 0.2, p.z + (Math.random() - 0.5), { vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3, life: 1.4, size: 1.2, grow: 2.5, color, alpha: 0.45, drag: 1.5 });
  }

  update(dt, camera, pixelRatio) {
    const scale = (innerHeight * pixelRatio) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.smoke.update(dt, scale);
    this.glow.update(dt, scale);
  }
}
