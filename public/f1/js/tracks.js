import * as THREE from 'three';

// Circuits are closed centripetal Catmull-Rom splines through [x, z, y] control points (metres).
export const TRACKS = [
  {
    id: 'lago', name: 'Autodromo del Lago', tag: 'Скоростная', theme: 'park', width: 14, runoff: 14, wall: 'armco',
    about: 'Длинные прямые, быстрые шиканы и парк вокруг озера. Здесь решает максималка.',
    pts: [[0, 0], [400, 0], [700, 0], [780, 40], [800, 120], [760, 200], [650, 240], [560, 300], [540, 400], [600, 480], [720, 520],
      [760, 600], [700, 680], [500, 700], [300, 700], [150, 660], [100, 560], [180, 460], [200, 380], [120, 300], [0, 260],
      [-120, 220], [-180, 140], [-160, 60], [-80, 10]],
  },
  {
    id: 'monte', name: 'Circuito del Monte', tag: 'Перепады высот', theme: 'mountain', width: 13, runoff: 10, wall: 'tyres',
    about: 'Трасса в горах: подъёмы до 50 м, слепые вершины и длинные дуги вниз.',
    pts: [[0, 0, 0], [300, 0, 5], [520, -40, 15], [640, -160, 30], [620, -320, 40], [480, -400, 35], [320, -360, 25], [220, -440, 20],
      [260, -580, 28], [420, -640, 40], [600, -620, 50], [760, -520, 45], [860, -360, 35], [880, -160, 20], [820, 40, 10],
      [660, 160, 8], [440, 200, 4], [220, 160, 2], [60, 110, 0], [-40, 95, 0], [-95, 45, 0], [-70, 0, 0]],
  },
  {
    id: 'harbour', name: 'Harbour Street', tag: 'Городская', theme: 'street', width: 12, runoff: 1.5, wall: 'concrete',
    about: 'Улицы порта: прямые углы, бетонные стены вплотную. Ошибок не прощает.',
    pts: [[0, 0], [300, 0], [330, 10], [340, 40], [340, 200], [350, 230], [380, 240], [520, 240], [550, 250], [560, 280],
      [560, 400], [550, 430], [520, 440], [200, 440], [170, 430], [160, 400], [160, 320], [150, 290], [120, 280], [-40, 280],
      [-70, 270], [-80, 240], [-80, 40], [-70, 10], [-40, 0]],
  },
  {
    id: 'desert', name: 'Desert Ring', tag: 'Техничная', theme: 'desert', width: 15, runoff: 18, wall: 'armco',
    about: 'Трасса в пустыне со шпилькой, связками поворотов и широкими зонами безопасности.',
    pts: [[0, 0], [500, 0], [620, 30], [660, 120], [600, 200], [480, 220], [420, 280], [460, 360], [600, 380], [700, 440],
      [700, 540], [600, 600], [300, 605], [195, 590], [155, 540], [195, 488], [250, 450], [240, 400], [120, 380], [20, 440], [-80, 520], [-200, 500],
      [-240, 400], [-180, 300], [-200, 200], [-160, 80], [-80, 10]],
  },
  {
    id: 'polygon', name: 'Полигон', tag: 'Пустая карта', theme: 'polygon', empty: true,
    about: 'Огромная пустая площадка без трассы: катайся куда хочешь, меряй разгон 0–100 и 0–200 и максималку.',
  },
];

export const THEMES = {
  park: { sky: [0x6fa8dc, 0xdcebf5], ground: 0x6c9a4a, runoff: 0x5f8f3e, fog: 0xcfe2ee, trees: 'round', scenery: 0x3f7a35 },
  mountain: { sky: [0x5d8fc9, 0xe6eef4], ground: 0x5d7f45, runoff: 0x8a8070, fog: 0xd8e3ea, trees: 'pine', scenery: 0x2f5a35 },
  street: { sky: [0x7aa0c8, 0xf0e2c8], ground: 0x8d8a84, runoff: 0x6b6b6b, fog: 0xe8dcc8, trees: 'none', scenery: 0x9aa0a8 },
  desert: { sky: [0x4f8cd0, 0xf5e3c0], ground: 0xd9b77a, runoff: 0xc9a466, fog: 0xf0dcb8, trees: 'cactus', scenery: 0x5f8a4a },
  polygon: { sky: [0x6a9ad0, 0xe4edf4], ground: 0x55585e, runoff: 0x55585e, fog: 0xdde6ee, trees: 'none', scenery: 0x888888 },
};

/** Samples the spline every ~2 m and precomputes everything the physics and the scenery need. */
export function trackData(def) {
  const curve = new THREE.CatmullRomCurve3(def.pts.map(([x, z, y = 0]) => new THREE.Vector3(x, y, z)), true, 'centripetal');
  const length = curve.getLength();
  const n = Math.round(length / 2);
  const pts = curve.getSpacedPoints(n);
  pts.pop();
  const step = length / n;
  const tan = [], nrm = [], curv = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const t = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    tan.push(t);
    nrm.push(new THREE.Vector3(t.z, 0, -t.x)); // left-hand side of the direction of travel
  }
  for (let i = 0; i < n; i++) {
    const a = tan[(i - 3 + n) % n], b = tan[(i + 3) % n];
    const cross = a.z * b.x - a.x * b.z; // > 0 when turning left
    const ang = Math.atan2(cross, a.x * b.x + a.z * b.z);
    curv.push(ang / (6 * step));
  }
  // smooth curvature a little
  const k = curv.map((_, i) => {
    let s = 0;
    for (let j = -3; j <= 3; j++) s += curv[(i + j + n) % n];
    return s / 7;
  });
  const half = def.width / 2;
  const wallOff = half + def.runoff;
  const wallL = [], wallR = [];
  for (let i = 0; i < n; i++) {
    const r = Math.abs(k[i]) > 1e-5 ? 1 / Math.abs(k[i]) : 1e9;
    const inner = Math.min(wallOff, Math.max(half + 1, r * 0.85));
    wallL.push(k[i] > 0 ? inner : wallOff);
    wallR.push(k[i] < 0 ? inner : wallOff);
  }
  // gravel traps on the outside of proper corners, grass elsewhere
  const gravelL = [], gravelR = [];
  for (let i = 0; i < n; i++) {
    let kmax = 0, sgn = 0;
    for (let j = -12; j <= 6; j++) { const c = k[(i + j + n) % n]; if (Math.abs(c) > kmax) { kmax = Math.abs(c); sgn = Math.sign(c); } }
    const corner = kmax > 1 / 220 && def.runoff > 6;
    gravelL.push(corner && sgn < 0); // right-hander: outside is on the left
    gravelR.push(corner && sgn > 0);
  }
  // active-aero zones: at least ~250 m of nearly straight road ahead
  const aeroZone = new Array(n).fill(false);
  let run = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      run = Math.abs(k[i]) < 1 / 450 ? run + step : 0;
      if (pass) aeroZone[i] = run > 220;
    }
  }
  let minY = Infinity, maxY = -Infinity;
  const box = new THREE.Box3();
  for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); box.expandByPoint(p); }
  return { def, pts, tan, nrm, curv: k, n, step, length, half, wallL, wallR, gravelL, gravelR, aeroZone, minY, maxY, box };
}

/** Nearest centre-line sample around `hint` (or everywhere when hint < 0). */
export function locate(T, x, z, hint = -1) {
  const { pts, n } = T;
  let best = 0, bd = Infinity;
  const scan = (i) => {
    const p = pts[i];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  };
  if (hint < 0) for (let i = 0; i < n; i++) scan(i);
  else for (let j = -40; j <= 40; j++) scan((hint + j + n) % n);
  // project onto the segment best -> best+1 (or best-1 -> best)
  const a = pts[best], b = pts[(best + 1) % n];
  const ex = b.x - a.x, ez = b.z - a.z;
  let u = ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez);
  let i0 = best;
  if (u < 0) {
    i0 = (best - 1 + n) % n;
    const c = pts[i0];
    const fx = a.x - c.x, fz = a.z - c.z;
    u = ((x - c.x) * fx + (z - c.z) * fz) / (fx * fx + fz * fz);
  }
  u = Math.min(1, Math.max(0, u));
  const p0 = pts[i0], p1 = pts[(i0 + 1) % n];
  const cx = p0.x + (p1.x - p0.x) * u, cz = p0.z + (p1.z - p0.z) * u;
  const nr = T.nrm[i0];
  return {
    i: i0, u,
    d: (x - cx) * nr.x + (z - cz) * nr.z,
    y: p0.y + (p1.y - p0.y) * u,
    s: (i0 + u) * T.step,
    slope: (p1.y - p0.y) / T.step,
  };
}
