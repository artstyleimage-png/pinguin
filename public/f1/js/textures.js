import * as THREE from 'three';

// All textures are generated on canvases: the game ships no image files.

export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

/** Tileable value noise, octaves summed, values 0..1. */
function noiseField(w, h, seed, octaves = 5, base = 8) {
  const r = rng(seed);
  const out = new Float32Array(w * h);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = base << o;
    const grid = new Float32Array(cells * cells).map(() => r());
    const sx = cells / w, sy = cells / h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fx = x * sx, fy = y * sy;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
        const g = (i, j) => grid[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
        const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * ux;
        const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * ux;
        out[y * w + x] += (a + (b - a) * uy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Normal map from a height field. */
function normalFromHeight(hgt, w, h, strength) {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = hgt[y * w + ((x - 1 + w) % w)], rr = hgt[y * w + ((x + 1) % w)];
      const u = hgt[((y - 1 + h) % h) * w + x], d = hgt[((y + 1) % h) * w + x];
      let nx = (l - rr) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

const cache = {};

/** Asphalt across the track (u = 0..1 edge to edge): aggregate, rubbered racing line, white edge lines. */
export function asphalt() {
  if (cache.asphalt) return cache.asphalt;
  const W = 512, H = 512;
  const fine = noiseField(W, H, 7, 3, 64);
  const coarse = noiseField(W, H, 9, 4, 4);
  const r = rng(21);
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W;
      let v = 0.27 + fine[i] * 0.12 + (coarse[i] - 0.5) * 0.06;
      if (r() < 0.04) v += 0.06 * r(); // light stones
      if (r() < 0.03) v -= 0.08 * r();
      // rubber laid down on the racing line
      const line = Math.exp(-(((u - 0.5) / 0.16) ** 2));
      v *= 1 - line * 0.22;
      height[i] = fine[i] + (r() < 0.05 ? 0.4 : 0);
      let R = v, G = v, B = v * 1.04;
      if (u < 0.012 || u > 0.988) { R = G = B = 0.08; } // edge beyond the line
      else if (u < 0.032 || u > 0.968) { R = G = B = 0.86 + fine[i] * 0.08; } // painted edge lines
      img.data[i * 4] = R * 255; img.data[i * 4 + 1] = G * 255; img.data[i * 4 + 2] = B * 255; img.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // roughness: rubber line is smoother, paint a bit smoother
  const [rc, rg] = canvas(W, H);
  const rimg = rg.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const u = x / W;
    const line = Math.exp(-(((u - 0.5) / 0.16) ** 2));
    const v = (0.92 - line * 0.18 - fine[i] * 0.1) * 255;
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = v;
    rimg.data[i * 4 + 3] = 255;
  }
  rg.putImageData(rimg, 0, 0);
  cache.asphalt = { map: tex(c), roughnessMap: tex(rc, { srgb: false }), normalMap: normalFromHeight(height, W, H, 1.6) };
  return cache.asphalt;
}

/** Plain asphalt without lines (run-off areas, polygon). */
export function plainAsphalt() {
  if (cache.plain) return cache.plain;
  const W = 256, H = 256;
  const n = noiseField(W, H, 3, 3, 32);
  const r = rng(4);
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const v = (0.3 + n[i] * 0.1 + (r() < 0.05 ? 0.08 * r() : 0)) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v * 1.03; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  cache.plain = { map: tex(c), normalMap: normalFromHeight(n, W, H, 2) };
  return cache.plain;
}

/** Mown grass with stripes along v. */
export function grass(base = [0.33, 0.52, 0.2]) {
  const key = `grass${base}`;
  if (cache[key]) return cache[key];
  const W = 256, H = 256;
  const n = noiseField(W, H, 11, 5, 4);
  const f = noiseField(W, H, 13, 2, 64);
  const r = rng(17);
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const stripe = Math.floor(y / 64) % 2 ? 1.07 : 0.93;
    const k = (0.75 + n[i] * 0.4 + f[i] * 0.15 + (r() - 0.5) * 0.12) * stripe;
    img.data[i * 4] = base[0] * k * 255; img.data[i * 4 + 1] = base[1] * k * 255; img.data[i * 4 + 2] = base[2] * k * 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  cache[key] = { map: tex(c), normalMap: normalFromHeight(f, W, H, 1.5) };
  return cache[key];
}

/** Gravel trap. */
export function gravel(base = [0.78, 0.7, 0.55]) {
  const key = `gravel${base}`;
  if (cache[key]) return cache[key];
  const W = 256, H = 256;
  const r = rng(31);
  const [c, g] = canvas(W, H);
  const height = new Float32Array(W * H);
  g.fillStyle = `rgb(${base.map((v) => v * 200).join(',')})`;
  g.fillRect(0, 0, W, H);
  for (let k = 0; k < 9000; k++) {
    const x = r() * W, y = r() * H, s = 1 + r() * 2.2;
    const v = 0.75 + r() * 0.45;
    g.fillStyle = `rgb(${base.map((b) => Math.min(255, b * v * 255)).join(',')})`;
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = (Math.floor(x) + dx + W) % W, yy = (Math.floor(y) + dy + H) % H;
      height[yy * W + xx] = Math.max(height[yy * W + xx], (1 - Math.hypot(dx, dy) / 3) * s / 3);
    }
  }
  cache[key] = { map: tex(c), normalMap: normalFromHeight(height, W, H, 4) };
  return cache[key];
}

/** Carbon-fibre twill weave. */
export function carbon() {
  if (cache.carbon) return cache.carbon;
  const W = 128, H = 128;
  const [c, g] = canvas(W, H);
  const [nc, ng] = canvas(W, H);
  const cell = 8;
  for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) {
    const twill = (Math.floor(x / cell) + Math.floor(y / cell)) % 4 < 2;
    const grd = twill ? g.createLinearGradient(x, y, x + cell, y) : g.createLinearGradient(x, y, x, y + cell);
    grd.addColorStop(0, '#0d0e10'); grd.addColorStop(0.5, '#2a2c31'); grd.addColorStop(1, '#0d0e10');
    g.fillStyle = grd;
    g.fillRect(x, y, cell, cell);
    ng.fillStyle = twill ? 'rgb(170,128,255)' : 'rgb(128,170,255)';
    ng.fillRect(x, y, cell, cell);
  }
  const t = tex(c);
  t.repeat.set(6, 6);
  const n = tex(nc, { srgb: false });
  n.repeat.set(6, 6);
  cache.carbon = { map: t, normalMap: n };
  return cache.carbon;
}

/** Wire mesh for catch fences (alpha). */
export function fence() {
  if (cache.fence) return cache.fence;
  const [c, g] = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(200,205,210,0.9)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(64, 64); g.moveTo(64, 0); g.lineTo(0, 64);
  g.moveTo(-32, 0); g.lineTo(32, 64); g.moveTo(32, 0); g.lineTo(96, 64);
  g.moveTo(96, 0); g.lineTo(32, 64); g.moveTo(32, 0); g.lineTo(-32, 64);
  g.stroke();
  cache.fence = tex(c);
  return cache.fence;
}

/** Cloud layer: soft fbm with alpha, controlled by coverage. */
export function clouds(coverage, seed = 5) {
  const W = 512, H = 512;
  const n = noiseField(W, H, seed, 6, 3);
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  const lo = 0.62 - coverage * 0.38;
  for (let i = 0; i < W * H; i++) {
    const v = Math.min(1, Math.max(0, (n[i] - lo) / 0.22));
    const shade = 255 - v * 40 * coverage;
    img.data[i * 4] = shade; img.data[i * 4 + 1] = shade; img.data[i * 4 + 2] = shade + 6; img.data[i * 4 + 3] = v * 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}

/** Foliage card: a dense clump of individually shaded leaves with alpha. */
export function leaves(hue = [0.22, 0.38, 0.14], seed = 3) {
  const key = `leaves${hue}${seed}`;
  if (cache[key]) return cache[key];
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(seed);
  g.clearRect(0, 0, S, S);
  const leaf = (x, y, len, ang, l) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    const col = hue.map((v) => Math.min(255, v * l * 255));
    const grd = g.createLinearGradient(0, -len * 0.3, 0, len * 0.3);
    grd.addColorStop(0, `rgb(${col.map((v) => Math.min(255, v * 1.25)).join(',')})`);
    grd.addColorStop(1, `rgb(${col.map((v) => v * 0.7).join(',')})`);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.quadraticCurveTo(0, -len * 0.32, len / 2, 0);
    g.quadraticCurveTo(0, len * 0.32, -len / 2, 0);
    g.fill();
    g.strokeStyle = `rgba(${col.map((v) => Math.min(255, v * 1.5)).join(',')},0.5)`;
    g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke();
    g.restore();
  };
  // twigs
  g.strokeStyle = 'rgba(70,52,34,0.9)';
  for (let k = 0; k < 14; k++) {
    g.lineWidth = 1 + r() * 2;
    g.beginPath();
    g.moveTo(S / 2, S * 0.95);
    g.quadraticCurveTo(S / 2 + (r() - 0.5) * S * 0.5, S * 0.6, S * 0.1 + r() * S * 0.8, S * 0.1 + r() * S * 0.6);
    g.stroke();
  }
  for (let k = 0; k < 2600; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * S * 0.46;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * 0.92;
    // inner leaves are in shadow, the top catches light
    const l = 0.45 + r() * 0.5 - (1 - d / (S * 0.46)) * 0.25 + (y < S / 2 ? 0.18 : -0.05);
    leaf(x, y, 9 + r() * 9, r() * Math.PI, l);
  }
  cache[key] = tex(c, { repeat: false });
  return cache[key];
}

/** Bark: vertical fissures. */
export function bark() {
  if (cache.bark) return cache.bark;
  const W = 128, H = 256;
  const n = noiseField(W, H, 23, 4, 4);
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const fiss = Math.abs(Math.sin(x * 0.35 + n[i] * 8)) ** 0.4;
    const v = 0.18 + fiss * 0.22 + n[i] * 0.1;
    img.data[i * 4] = v * 255 * 1.1; img.data[i * 4 + 1] = v * 255 * 0.9; img.data[i * 4 + 2] = v * 255 * 0.7; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = tex(c);
  t.repeat.set(2, 3);
  cache.bark = t;
  return t;
}

/** Crowd for grandstands. */
export function crowd() {
  if (cache.crowd) return cache.crowd;
  const [c, g] = canvas(512, 128);
  const r = rng(11);
  g.fillStyle = '#23262c';
  g.fillRect(0, 0, 512, 128);
  const cols = ['#d40000', '#f2f2f2', '#ffd400', '#1e5bc6', '#ff8000', '#00a19c', '#111', '#e8c9a8', '#7a4b2a'];
  for (let row = 0; row < 16; row++) for (let x = 0; x < 512; x += 4) {
    if (r() < 0.12) continue;
    const y = row * 8;
    g.fillStyle = cols[Math.floor(r() * 3) + 7];
    g.fillRect(x + 1, y + 1, 2, 2);
    g.fillStyle = cols[Math.floor(r() * 7)];
    g.fillRect(x, y + 3, 4, 4);
  }
  cache.crowd = tex(c);
  return cache.crowd;
}

/** Text board / sign. */
export function board(text, bg, fg, w = 512, h = 128, font = 'italic 900 78px "Titillium Web", Arial, sans-serif') {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = tex(c, { repeat: false });
  return t;
}

/** Livery decal: number + team name on a transparent canvas. */
export function numberDecal(num, color = '#fff') {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = color;
  g.font = 'italic 900 92px "Titillium Web", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 64, 70);
  return tex(c, { repeat: false });
}

/** Radial light pool for night lighting under lamps. */
export function lightPool() {
  if (cache.pool) return cache.pool;
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,240,210,0.55)');
  grd.addColorStop(0.5, 'rgba(255,235,200,0.2)');
  grd.addColorStop(1, 'rgba(255,230,190,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  cache.pool = tex(c, { repeat: false });
  return cache.pool;
}

/** Photographed grass (three.js example texture). Cloned per use so each can have its own repeat. */
let grassPhoto = null;
export function photoGrass(repeatX = 1, repeatY = 1) {
  if (!grassPhoto) {
    grassPhoto = new THREE.TextureLoader().load('assets/grass.jpg');
    grassPhoto.colorSpace = THREE.SRGBColorSpace;
    grassPhoto.wrapS = grassPhoto.wrapT = THREE.RepeatWrapping;
    grassPhoto.anisotropy = 8;
  }
  const t = grassPhoto.clone();
  t.repeat.set(repeatX, repeatY);
  return t;
}

/** Office-block facade: window grid (map) and lit windows for the night (emissive). */
export function facade() {
  if (cache.facade) return cache.facade;
  const W = 256, H = 256;
  const [c, g] = canvas(W, H);
  const [e, eg] = canvas(W, H);
  const r = rng(5);
  g.fillStyle = '#8a9099';
  g.fillRect(0, 0, W, H);
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, W, H);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const px = x * 32 + 4, py = y * 32 + 6;
    const grd = g.createLinearGradient(px, py, px, py + 22);
    grd.addColorStop(0, '#5d7487'); grd.addColorStop(1, '#2a3846');
    g.fillStyle = grd;
    g.fillRect(px, py, 24, 22);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(px, py, 24, 3);
    if (r() < 0.35) { eg.fillStyle = r() < 0.5 ? '#ffd9a0' : '#fff2d6'; eg.fillRect(px, py, 24, 22); }
  }
  const map = tex(c), em = tex(e);
  cache.facade = { map, emissiveMap: em };
  return cache.facade;
}

/**
 * Patches a standard material so its textures are sampled in world space
 * (box sides use x/z + y, tops use x/z). Works with InstancedMesh.
 */
export function worldUV(material, scale = 8) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uvScale = { value: 1 / scale };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        wp4 = modelMatrix * wp4;
        vWP = wp4.xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; uniform float uvScale;')
      .replace('#include <map_fragment>', `
        vec2 wuv = abs(vWN.y) > 0.5 ? vWP.xz : (abs(vWN.x) > abs(vWN.z) ? vec2(vWP.z, vWP.y) : vec2(vWP.x, vWP.y));
        wuv *= uvScale;
        #ifdef USE_MAP
          diffuseColor *= texture2D(map, wuv);
        #endif`)
      .replace('#include <emissivemap_fragment>', `
        #ifdef USE_EMISSIVEMAP
          totalEmissiveRadiance *= texture2D(emissiveMap, wuv).rgb * step(0.5, 1.0 - abs(vWN.y));
        #endif`);
  };
  return material;
}

/** Photographed-quality carbon weave from the three.js examples (falls back to the procedural one). */
let carbonPhoto = null;
export function carbonReal() {
  if (!carbonPhoto) {
    const l = new THREE.TextureLoader();
    const map = l.load('assets/carbon.png');
    const normalMap = l.load('assets/carbon_normal.png');
    map.colorSpace = THREE.SRGBColorSpace;
    for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); t.anisotropy = 8; }
    carbonPhoto = { map, normalMap };
  }
  return carbonPhoto;
}

/** Fine metallic-flake normal map for car paint. */
export function flakes() {
  if (cache.flakes) return cache.flakes;
  const S = 256;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const r = rng(77);
  for (let i = 0; i < S * S; i++) {
    const nx = (r() - 0.5) * 0.5, ny = (r() - 0.5) * 0.5;
    img.data[i * 4] = (nx * 0.5 + 0.5) * 255; img.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = tex(c, { srgb: false });
  t.repeat.set(30, 30);
  cache.flakes = t;
  return t;
}

/** Tyre sidewall: lettering and compound band on black rubber (u around the tyre, v across the profile). */
export function sidewall(compoundColor, label) {
  const key = `side${compoundColor}${label}`;
  if (cache[key]) return cache[key];
  const W = 2048, H = 128;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#121212';
  g.fillRect(0, 0, W, H);
  // subtle moulding texture
  const r = rng(3);
  for (let k = 0; k < 4000; k++) { g.fillStyle = `rgba(255,255,255,${r() * 0.03})`; g.fillRect(r() * W, r() * H, 2, 1); }
  for (const vy of [0.18, 0.82]) {
    const y = vy * H;
    g.fillStyle = compoundColor;
    g.fillRect(0, y - 3, W, 6);
    g.font = '900 22px "Titillium Web", Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = '#e8e8e8';
    for (let k = 0; k < 4; k++) {
      g.save();
      g.translate(k * (W / 4) + 60, y + (vy < 0.5 ? 14 : -14));
      if (vy > 0.5) g.scale(1, -1);
      g.fillText(`APEX RACING  ·  ${label}`, 0, 0);
      g.restore();
    }
  }
  const t = tex(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  cache[key] = t;
  return t;
}

/** Helmet livery: team colours with stripes and a number (sphere UV). */
export function helmetLivery(main, second, num) {
  const key = `helmet${main}${second}${num}`;
  if (cache[key]) return cache[key];
  const W = 512, H = 256;
  const [c, g] = canvas(W, H);
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex(second);
  g.fillRect(0, 0, W, H);
  g.fillStyle = hex(main);
  g.beginPath();
  g.moveTo(0, H * 0.55); g.bezierCurveTo(W * 0.3, H * 0.35, W * 0.7, H * 0.75, W, H * 0.5); g.lineTo(W, H); g.lineTo(0, H); g.fill();
  g.fillStyle = '#ffffff';
  g.fillRect(0, H * 0.18, W, 6);
  g.font = 'italic 900 60px "Titillium Web", Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText(String(num), W * 0.5, H * 0.35);
  g.fillText(String(num), 0, H * 0.35);
  g.fillText(String(num), W, H * 0.35);
  cache[key] = tex(c, { repeat: false });
  return cache[key];
}

/** Soft dark blob for contact shadows under the car. */
export function blobShadow() {
  if (cache.blob) return cache.blob;
  const [c, g] = canvas(128, 256);
  const grd = g.createRadialGradient(64, 128, 10, 64, 128, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.4)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.save();
  g.scale(1, 2);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.restore();
  cache.blob = tex(c, { repeat: false });
  return cache.blob;
}
