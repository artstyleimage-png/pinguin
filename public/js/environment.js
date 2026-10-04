import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WATER_LEVEL } from '../shared/constants.js';

const SKY_TOP = new THREE.Color(0x4f8fd6);
const SKY_HORIZON = new THREE.Color(0xdfeefa);

function rand(seed) {
  // small deterministic PRNG so the scenery is the same every time
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Lights, sky, ocean, icebergs and mountains shared by the lobby and the arena. */
export function createEnvironment(scene, { shadowSize = 16, bergMin = 45 } = {}) {
  scene.background = SKY_HORIZON.clone();
  scene.fog = new THREE.Fog(0xd6e7f5, 60, 260);

  const hemi = new THREE.HemisphereLight(0xdcefff, 0x2d5a80, 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  sun.position.set(18, 30, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -shadowSize; sun.shadow.camera.right = shadowSize;
  sun.shadow.camera.top = shadowSize; sun.shadow.camera.bottom = -shadowSize;
  sun.shadow.camera.near = 5; sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // sky dome
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          float y = max(vP.y, 0.0);
          vec3 c = mix(horizon, top, pow(y, 0.6));
          vec2 uv = vP.xz / (vP.y + 0.25) * 2.5;
          float cl = n(uv) * 0.5 + n(uv*2.1) * 0.3 + n(uv*4.3) * 0.2;
          cl = smoothstep(0.5, 0.85, cl) * smoothstep(0.02, 0.25, vP.y);
          c = mix(c, vec3(1.0), cl * 0.85);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  const water = createWater();
  scene.add(water.mesh);

  const r = rand(7);
  // distant snowy mountains
  const mountainMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  for (let i = 0; i < 16; i++) {
    const a = -0.4 + (i / 16) * Math.PI * 1.9 + r() * 0.2;
    const d = 200 + r() * 70;
    const h = 35 + r() * 55;
    const geo = new THREE.ConeGeometry(h * (0.9 + r() * 0.6), h, 7, 4);
    jitter(geo, h * 0.08, r);
    paintSnow(geo, h, 0.35);
    const m = new THREE.Mesh(geo, mountainMat);
    m.position.set(Math.sin(a) * d, WATER_LEVEL + h / 2 - 4, -Math.cos(a) * d);
    m.rotation.y = r() * 6;
    scene.add(m);
  }

  // icebergs around the arena
  const bergMat = new THREE.MeshStandardMaterial({ color: 0xe8f6ff, flatShading: true, roughness: 0.35, emissive: 0x3c7fb0, emissiveIntensity: 0.12 });
  for (let i = 0; i < 22; i++) {
    const a = r() * Math.PI * 2;
    const d = bergMin + r() * 110;
    const s = 4 + r() * 12;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    jitter(geo, 0.25, r);
    const m = new THREE.Mesh(geo, bergMat);
    m.scale.set(s * (1 + r()), s * (0.7 + r() * 1.3), s * (1 + r()));
    m.position.set(Math.sin(a) * d, WATER_LEVEL - s * 0.2, Math.cos(a) * d);
    m.rotation.y = r() * 6;
    scene.add(m);
  }

  // small bobbing ice chunks near the middle
  const chunks = [];
  const chunkMat = new THREE.MeshStandardMaterial({ color: 0xf2fbff, roughness: 0.4 });
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = 15 + r() * 28;
    const geo = new RoundedBoxGeometry(1, 1, 1, 2, 0.25);
    const m = new THREE.Mesh(geo, chunkMat);
    m.scale.set(1 + r() * 3.5, 0.6 + r() * 0.6, 1 + r() * 3);
    m.position.set(Math.sin(a) * d, WATER_LEVEL, Math.cos(a) * d);
    m.rotation.y = r() * 6;
    m.receiveShadow = true;
    m.userData.phase = r() * 6;
    scene.add(m);
    chunks.push(m);
  }

  return {
    sun, water,
    update(t) {
      water.update(t);
      for (const c of chunks) {
        c.position.y = WATER_LEVEL + Math.sin(t * 0.8 + c.userData.phase) * 0.12;
        c.rotation.z = Math.sin(t * 0.6 + c.userData.phase) * 0.03;
      }
    },
  };
}

function jitter(geo, amount, r) {
  const pos = geo.attributes.position;
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, [(r() - 0.5) * amount, (r() - 0.5) * amount, (r() - 0.5) * amount]);
    const [dx, dy, dz] = seen.get(key);
    pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + dy, pos.getZ(i) + dz);
  }
  geo.computeVertexNormals();
}

function paintSnow(geo, h, snowFrom) {
  const pos = geo.attributes.position;
  const colors = [];
  const rock = new THREE.Color(0x6f7f94), snow = new THREE.Color(0xf4f9ff);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / h + 0.5;
    const c = y > snowFrom ? snow : rock.clone().lerp(snow, y / snowFrom * 0.5);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function createWater() {
  const geo = new THREE.PlaneGeometry(700, 700, 200, 200);
  geo.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        time: { value: 0 },
        deep: { value: new THREE.Color(0x12558a) },
        shallow: { value: new THREE.Color(0x3a9fd0) },
        skyCol: { value: new THREE.Color(0xcfe5f7) },
        sunDir: { value: new THREE.Vector3(18, 30, 14).normalize() },
      },
    ]),
    vertexShader: `
      #include <fog_pars_vertex>
      uniform float time;
      varying vec3 vWorld; varying vec3 vNormal2;
      vec3 wave(vec2 p, vec2 dir, float amp, float freq, float speed, inout vec3 n) {
        float ph = dot(dir, p) * freq + time * speed;
        float d = cos(ph) * amp * freq;
        n.x -= dir.x * d; n.z -= dir.y * d;
        return vec3(0.0, sin(ph) * amp, 0.0);
      }
      void main() {
        vec3 p = position;
        vec3 n = vec3(0.0, 1.0, 0.0);
        float fade = 1.0 - smoothstep(80.0, 260.0, length(p.xz));
        vec3 d = vec3(0.0);
        d += wave(p.xz, normalize(vec2(1.0, 0.3)), 0.16, 0.35, 1.3, n);
        d += wave(p.xz, normalize(vec2(-0.4, 1.0)), 0.10, 0.6, 1.9, n);
        d += wave(p.xz, normalize(vec2(0.7, -0.8)), 0.05, 1.3, 2.7, n);
        d += wave(p.xz, normalize(vec2(-1.0, -0.2)), 0.025, 2.4, 3.5, n);
        p += d * fade;
        vNormal2 = normalize(mix(vec3(0.0,1.0,0.0), n, fade));
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform vec3 deep; uniform vec3 shallow; uniform vec3 skyCol; uniform vec3 sunDir; uniform float time;
      varying vec3 vWorld; varying vec3 vNormal2;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main() {
        vec3 n = normalize(vNormal2);
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 col = mix(deep, shallow, clamp(n.y * 0.5 + 0.2 + (vWorld.y + 1.0) * 0.6, 0.0, 1.0));
        col = mix(col, skyCol, fres * 0.75);
        vec3 hv = normalize(sunDir + v);
        float spec = pow(max(dot(n, hv), 0.0), 180.0);
        col += vec3(1.0, 0.97, 0.9) * spec * 1.5;
        // sparkles
        vec2 cell = floor(vWorld.xz * 3.0);
        float sp = step(0.997, h(cell + floor(time * 4.0)));
        col += sp * 0.5 * (1.0 - fres);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = WATER_LEVEL;
  return { mesh, update(t) { material.uniforms.time.value = t; } };
}

/** Canvas texture with scratches and cracks for the ice surface. */
function iceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(512, 512, 50, 512, 512, 720);
  grad.addColorStop(0, '#e9f7ff');
  grad.addColorStop(1, '#b4dcf2');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 1024);
  const r = rand(3);
  // frosty blotches
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.12})`;
    g.beginPath();
    g.arc(r() * 1024, r() * 1024, 10 + r() * 70, 0, Math.PI * 2);
    g.fill();
  }
  // skate scratches
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.4})`;
    g.lineWidth = 1 + r() * 2;
    g.beginPath();
    const x = r() * 1024, y = r() * 1024, a = r() * Math.PI * 2, l = 80 + r() * 300;
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // cracks
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = `rgba(90,150,190,${0.35 + r() * 0.3})`;
    g.lineWidth = 1.5;
    let x = r() * 1024, y = r() * 1024, a = r() * Math.PI * 2;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      a += (r() - 0.5) * 1.2;
      x += Math.cos(a) * (20 + r() * 40);
      y += Math.sin(a) * (20 + r() * 40);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** The square ice floe the penguins fight on. Its top is at y = 0. */
export function createArena(half) {
  const group = new THREE.Group();
  const depth = 4;
  const top = new THREE.MeshPhysicalMaterial({
    map: iceTexture(), roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08,
    color: 0xffffff, emissive: 0x1d5f8a, emissiveIntensity: 0.08,
  });
  const block = new THREE.Mesh(new RoundedBoxGeometry(half * 2, depth, half * 2, 4, 0.5), top);
  block.position.y = -depth / 2;
  block.receiveShadow = true;
  group.add(block);

  // translucent blue sides, slightly wider at the water line
  const sideMat = new THREE.MeshPhysicalMaterial({ color: 0x7cc6ec, roughness: 0.2, transparent: true, opacity: 0.85, clearcoat: 1 });
  const skirt = new THREE.Mesh(new RoundedBoxGeometry(half * 2 + 0.6, depth, half * 2 + 0.6, 4, 0.8), sideMat);
  skirt.position.y = -depth / 2 - 0.35;
  group.add(skirt);

  // snow lumps on the corners (just outside the play area)
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const lumps = new THREE.Group();
  const r = rand(11);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    for (let i = 0; i < 4; i++) {
      const s = 0.25 + r() * 0.35;
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), snowMat);
      m.scale.set(s * 1.3, s * 0.7, s * 1.3);
      m.position.set(sx * (half + 0.05 - r() * 0.4), -0.15, sz * (half + 0.05 - r() * 0.4));
      m.castShadow = true;
      lumps.add(m);
    }
  }
  group.add(lumps);

  const startHalf = half;
  let current = half, target = half;
  return {
    group,
    setHalf(h, instant = false) { target = h; if (instant) current = h; },
    update(dt) {
      current += (target - current) * Math.min(1, dt * 3);
      const k = current / startHalf;
      group.scale.set(k, 1, k);
    },
  };
}
