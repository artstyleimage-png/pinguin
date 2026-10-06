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
      if (r() < 0.04) v += 0.12 * r(); // light stones
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
  cache.asphalt = { map: tex(c), roughnessMap: tex(rc, { srgb: false }), normalMap: normalFromHeight(height, W, H, 3) };
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

/** Foliage card: clusters of leaves with alpha. */
export function leaves(hue = [0.22, 0.38, 0.14], seed = 3) {
  const key = `leaves${hue}${seed}`;
  if (cache[key]) return cache[key];
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.clearRect(0, 0, 256, 256);
  for (let k = 0; k < 1400; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 118;
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d * 0.95;
    const l = 0.55 + r() * 0.65 - (d / 118) * 0.15 + (y < 128 ? 0.15 : -0.05);
    g.fillStyle = `rgb(${hue.map((v) => Math.min(255, v * l * 255)).join(',')})`;
    g.beginPath();
    g.ellipse(x, y, 3 + r() * 4, 1.5 + r() * 2.5, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  cache[key] = tex(c, { repeat: false });
  return cache[key];
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
