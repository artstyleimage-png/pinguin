import {
  ARENA_HALF, ARENA_MIN_HALF, ARENA_SHRINK, SHRINK_FROM_ROUND,
  WATER_LEVEL, PENGUIN_RADIUS, MAX_AIM, MAX_SPEED,
} from './constants.js';

const TICK_HZ = 30;
const SUBSTEPS = 4;
// also runs in the browser (offline mode), where there is no `process`
const env = globalThis.process?.env ?? {};
const INTRO_MS = Number(env.INTRO_MS ?? 3500);
const AIM_MS = Number(env.AIM_MS ?? 10000);
const SLIDE_MAX_MS = 9000;
const SLIDE_MIN_MS = 700;
const MELT_MS = 1800;
const END_MS = 1500;
const MAX_ROUNDS = 15;     // after this, the penguin closest to the middle wins

const FRICTION = 3.5;      // constant deceleration on ice (m/s^2)
const DRAG = 0.35;         // extra speed-proportional drag (1/s)
const RESTITUTION = 0.92;  // bounciness of penguin collisions
const GRAVITY = 28;
const STOP_SPEED = 0.05;
const KILL_CREDIT_MS = 5000;

const BOT_NAMES = ['Slippy_Pete', 'Ice_Berg_Jr', 'Chilly_Chick', 'Waddles', 'Sir_Flaps', 'Pingu99',
  'Frosty_Toes', 'Belly_Slider', 'Captain_Cold', 'Noot_Noot', 'Puffball', 'Snowball'];

let nextMatchId = 1;

/**
 * One server-authoritative match. Penguins are discs on a 2D plane (x, z);
 * they slide with friction, bounce off each other elastically and fall into
 * the water once their center leaves the square arena.
 */
export class Match {
  /**
   * @param {Array<{id:string,name:string,skin:string,isBot:boolean,send?:Function}>} entrants
   * @param {(match: Match, result: object) => void} onEnd
   */
  constructor(entrants, onEnd) {
    this.id = nextMatchId++;
    this.onEnd = onEnd;
    this.half = ARENA_HALF;
    this.round = 0;
    this.phase = null;
    this.phaseStart = 0;
    this.time = 0;
    this.eliminationOrder = [];
    this.ended = false;

    const n = entrants.length;
    const spawnR = n <= 4 ? 4.5 : 6.5;
    const rot = Math.random() * Math.PI * 2;
    this.players = entrants.map((e, i) => {
      const a = rot + (i / n) * Math.PI * 2;
      const x = Math.cos(a) * spawnR;
      const z = Math.sin(a) * spawnR;
      return {
        ...e,
        x, z, y: 0, vx: 0, vz: 0, vy: 0,
        yaw: Math.atan2(-x, -z), // face the middle
        aimX: 0, aimZ: 0,
        state: 'ice',            // ice | falling | out
        lastHitBy: null, lastHitAt: -Infinity,
        botAimAt: 0,
      };
    });

    this.broadcast({
      type: 'match:start',
      matchId: this.id,
      half: this.half,
      players: this.players.map((p) => ({ id: p.id, name: p.name, skin: p.skin, isBot: p.isBot })),
    });
    this.created = performance.now();
    this.setPhase('intro');
    this.sendState();
    this.interval = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }

  static botEntrants(count, skins) {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    return Array.from({ length: count }, (_, i) => ({
      id: `bot${i}-${Math.random().toString(36).slice(2, 7)}`,
      name: names[i % names.length],
      skin: skins[Math.floor(Math.random() * skins.length)],
      isBot: true,
    }));
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of this.players) if (p.send) p.send(data);
  }

  alive() { return this.players.filter((p) => p.state !== 'out'); }

  setPhase(phase) {
    this.phase = phase;
    this.phaseStart = this.time;
    let duration = 0;
    if (phase === 'intro') duration = INTRO_MS;
    if (phase === 'aim') {
      this.round += 1;
      duration = AIM_MS;
      for (const p of this.players) {
        p.aimX = 0; p.aimZ = 0;
        p.botAimAt = 1500 + Math.random() * (AIM_MS - 3000);
      }
    }
    if (phase === 'melt') duration = MELT_MS;
    this.broadcast({ type: 'match:phase', phase, round: this.round, duration, half: this.half });
  }

  /** Called by the connection handler with the player's latest arrow. */
  setAim(playerId, x, z) {
    if (this.phase !== 'aim') return;
    const p = this.players.find((q) => q.id === playerId);
    if (!p || p.state !== 'ice' || !Number.isFinite(x) || !Number.isFinite(z)) return;
    const len = Math.hypot(x, z);
    const k = len > MAX_AIM ? MAX_AIM / len : 1;
    p.aimX = x * k;
    p.aimZ = z * k;
    if (len > 0.05) p.yaw = Math.atan2(x, z);
  }

  /** A human left or disconnected: they stop receiving updates and drop out. */
  removePlayer(playerId) {
    const p = this.players.find((q) => q.id === playerId);
    if (!p) return;
    p.send = null;
    p.left = true;
    if (p.state !== 'out') this.eliminate(p, 'left');
  }

  humansConnected() { return this.players.some((p) => !p.isBot && p.send); }

  tick() {
    const dt = 1 / TICK_HZ;
    this.time += dt * 1000;
    const elapsed = this.time - this.phaseStart;

    if (!this.humansConnected() && !this.ended) {
      this.finish(true);
      return;
    }

    switch (this.phase) {
      case 'intro':
        if (elapsed >= INTRO_MS) this.setPhase('aim');
        break;
      case 'aim':
        for (const p of this.players) if (p.isBot && p.state === 'ice' && elapsed >= p.botAimAt && p.botAimAt >= 0) {
          this.botAim(p);
          p.botAimAt = -1;
        }
        if (elapsed >= AIM_MS) this.launch();
        break;
      case 'slide': {
        for (let i = 0; i < SUBSTEPS; i++) this.step(dt / SUBSTEPS);
        const moving = this.players.some((p) => p.state === 'falling' ||
          (p.state === 'ice' && Math.hypot(p.vx, p.vz) > STOP_SPEED));
        this.sendState();
        if ((elapsed > SLIDE_MIN_MS && !moving) || elapsed > SLIDE_MAX_MS) this.afterSlide();
        break;
      }
      case 'melt': {
        for (let i = 0; i < SUBSTEPS; i++) this.step(dt / SUBSTEPS);
        this.sendState();
        const falling = this.players.some((p) => p.state === 'falling');
        if (elapsed >= MELT_MS && !falling) this.afterSlide(true);
        break;
      }
      case 'end':
        if (elapsed >= END_MS) this.finish(false);
        break;
    }
  }

  launch() {
    const aims = {};
    for (const p of this.players) {
      if (p.state !== 'ice') continue;
      p.vx = (p.aimX / MAX_AIM) * MAX_SPEED;
      p.vz = (p.aimZ / MAX_AIM) * MAX_SPEED;
      aims[p.id] = [round2(p.aimX), round2(p.aimZ)];
    }
    this.setPhase('slide');
    this.broadcast({ type: 'match:launch', aims });
  }

  afterSlide(melted = false) {
    for (const p of this.players) if (p.state === 'ice') { p.vx = 0; p.vz = 0; }
    this.sendState();
    const alive = this.alive();
    if (alive.length <= 1) {
      this.setPhase('end');
      return;
    }
    if (this.round >= MAX_ROUNDS) {
      this.forcedWinner = alive.reduce((best, p) => (Math.hypot(p.x, p.z) < Math.hypot(best.x, best.z) ? p : best));
      this.setPhase('end');
      return;
    }
    if (!melted && this.round >= SHRINK_FROM_ROUND && this.half > ARENA_MIN_HALF) {
      this.half = Math.max(ARENA_MIN_HALF, this.half - ARENA_SHRINK);
      this.setPhase('melt');
      return;
    }
    this.setPhase('aim');
  }

  step(dt) {
    const ps = this.players;
    for (const p of ps) {
      if (p.state === 'ice') {
        const speed = Math.hypot(p.vx, p.vz);
        if (speed > 0) {
          const newSpeed = Math.max(0, speed - (FRICTION + DRAG * speed) * dt);
          const k = newSpeed / speed;
          p.vx *= k; p.vz *= k;
          if (newSpeed > 0.3) p.yaw = Math.atan2(p.vx, p.vz);
        }
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        if (Math.abs(p.x) > this.half || Math.abs(p.z) > this.half) {
          p.state = 'falling';
          p.vy = 1.5;
        }
      } else if (p.state === 'falling') {
        p.vy -= GRAVITY * dt;
        p.x += p.vx * dt * 0.6;
        p.z += p.vz * dt * 0.6;
        p.y += p.vy * dt;
        if (p.y < WATER_LEVEL) {
          const killer = this.time - p.lastHitAt < KILL_CREDIT_MS ? p.lastHitBy : null;
          this.eliminate(p, killer);
        }
      }
    }

    // pairwise disc collisions (equal mass, slightly inelastic)
    const minDist = PENGUIN_RADIUS * 2;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (a.state !== 'ice') continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (b.state !== 'ice') continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        let dist = Math.hypot(dx, dz);
        if (dist >= minDist) continue;
        if (dist < 1e-6) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; dist = Math.hypot(dx, dz); }
        const nx = dx / dist, nz = dz / dist;
        const overlap = (minDist - dist) / 2;
        a.x -= nx * overlap; a.z -= nz * overlap;
        b.x += nx * overlap; b.z += nz * overlap;
        const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (vn >= 0) continue; // already separating
        const jImpulse = -(1 + RESTITUTION) * vn / 2;
        a.vx -= jImpulse * nx; a.vz -= jImpulse * nz;
        b.vx += jImpulse * nx; b.vz += jImpulse * nz;
        a.lastHitBy = b.id; a.lastHitAt = this.time;
        b.lastHitBy = a.id; b.lastHitAt = this.time;
        if (jImpulse > 0.8) {
          this.broadcast({ type: 'match:bump', a: a.id, b: b.id, x: round2((a.x + b.x) / 2), z: round2((a.z + b.z) / 2), power: round2(jImpulse) });
        }
      }
    }
  }

  eliminate(p, by) {
    p.state = 'out';
    p.vx = 0; p.vz = 0; p.vy = 0;
    this.eliminationOrder.push(p.id);
    this.broadcast({ type: 'match:out', id: p.id, by: by === 'left' ? null : by, left: by === 'left', x: round2(p.x), z: round2(p.z) });
    if (this.phase === 'aim' || this.phase === 'intro') {
      if (this.alive().length <= 1) this.setPhase('end');
    }
  }

  botAim(p) {
    const others = this.players.filter((q) => q !== p && q.state === 'ice');
    const distToEdge = this.half - Math.max(Math.abs(p.x), Math.abs(p.z));
    let tx, tz, power;
    if (!others.length || (distToEdge < 2 && Math.random() < 0.6)) {
      // retreat toward the middle
      tx = -p.x; tz = -p.z; power = 0.3 + Math.random() * 0.3;
    } else {
      others.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const target = others[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * others.length)];
      tx = target.x - p.x; tz = target.z - p.z;
      power = 0.65 + Math.random() * 0.35;
    }
    const ang = Math.atan2(tx, tz) + (Math.random() - 0.5) * 0.5;
    const len = power * MAX_AIM;
    this.setAim(p.id, Math.sin(ang) * len, Math.cos(ang) * len);
  }

  sendState() {
    this.broadcast({
      type: 'match:state',
      t: Math.round(performance.now() - this.created), // wall clock, for client interpolation
      p: this.players.filter((p) => p.state !== 'out').map((p) =>
        [p.id, round2(p.x), round2(p.y), round2(p.z), round2(p.yaw), p.state === 'falling' ? 1 : 0, round2(Math.hypot(p.vx, p.vz))]),
    });
  }

  finish(abandoned) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.interval);
    const alive = this.alive();
    const winner = this.forcedWinner && this.forcedWinner.state !== 'out' ? this.forcedWinner
      : alive.length === 1 ? alive[0] : null;
    const survivors = alive.filter((p) => p !== winner).map((p) => p.id);
    const placements = [...(winner ? [winner.id] : []), ...survivors, ...[...this.eliminationOrder].reverse()];
    this.onEnd(this, { winnerId: winner ? winner.id : null, placements, abandoned });
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
