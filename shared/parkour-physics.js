// Parkour simulation: a box-shaped penguin running and jumping over axis-aligned
// platforms. Pure JS (no Three.js) so it can run in Node tests as well as in the browser.
import { WATER_LEVEL } from './constants.js';

export const PHYS = {
  gravity: 32,
  jump: 11.5,        // apex ~2.07 m
  airJump: 10,       // double jump (one per air time)
  bounce: 21,        // spring pad launch speed
  speed: 8,
  accel: 60,
  iceAccel: 7,       // ice: slow to start and slow to stop
  airAccel: 24,
  maxFall: 40,
  coyote: 0.1,       // can still jump this long after running off an edge
  buffer: 0.13,      // a jump pressed this early before landing still counts
  radius: 0.42,
  height: 1.3,
  crumbleDelay: 0.55,
  crumbleGone: 2.6,
  fallY: WATER_LEVEL - 1.5,
};

const FLOOR = -8;    // bottom of the ice pillars (well under the water)
const EPS = 1e-6;

function body(spec, i) {
  const type = spec.type || 'snow';
  const thin = spec.move || type === 'crumble' || type === 'bounce' || spec.pillar === false;
  const h = spec.h ?? (thin ? 0.7 : spec.y - FLOOR);
  const by = spec.y - h / 2;
  return {
    i, spec, type, hx: spec.w / 2, hy: h / 2, hz: spec.d / 2,
    bx: spec.x, by, bz: spec.z,
    x: spec.x, y: by, z: spec.z, dx: 0, dy: 0, dz: 0,
    solid: true, state: 'idle', timer: 0, drop: 0,
  };
}

export const top = (b) => b.y + b.hy;

function overlaps(p, b) {
  return p.x + PHYS.radius > b.x - b.hx + EPS && p.x - PHYS.radius < b.x + b.hx - EPS
    && p.z + PHYS.radius > b.z - b.hz + EPS && p.z - PHYS.radius < b.z + b.hz - EPS
    && p.y + PHYS.height > b.y - b.hy + EPS && p.y < b.y + b.hy - EPS;
}

/** Position of a moving platform's center at time t. */
export function movingOffset(spec, t) {
  if (!spec.move) return [0, 0, 0];
  const f = 0.5 - 0.5 * Math.cos((t / spec.period) * Math.PI * 2 + (spec.phase || 0));
  return spec.move.map((m) => m * f);
}

export class World {
  constructor(level) {
    this.level = level;
    this.bodies = level.platforms.map(body);
    this.hazards = (level.hazards || []).map((h) => ({ ...h, angle: h.phase || 0 }));
    this.t = 0;
  }

  update(dt, player) {
    this.t += dt;
    for (const b of this.bodies) {
      if (b.spec.move) {
        const [ox, oy, oz] = movingOffset(b.spec, this.t);
        const nx = b.bx + ox, ny = b.by + oy, nz = b.bz + oz;
        b.dx = nx - b.x; b.dy = ny - b.y; b.dz = nz - b.z;
        b.x = nx; b.y = ny; b.z = nz;
      }
      if (b.type === 'crumble') {
        if (b.state === 'shaking' && (b.timer -= dt) <= 0) {
          b.state = 'gone'; b.solid = false; b.timer = PHYS.crumbleGone;
        } else if (b.state === 'gone') {
          b.drop += dt * (4 + b.drop * 3);
          if ((b.timer -= dt) <= 0 && !(player && overlaps(player, b))) {
            b.state = 'idle'; b.solid = true; b.drop = 0;
          }
        }
      }
    }
    for (const h of this.hazards) h.angle = (h.phase || 0) + this.t * h.speed;
  }

  reset() {
    this.t = 0;
    for (const b of this.bodies) {
      b.x = b.bx; b.y = b.by; b.z = b.bz; b.dx = b.dy = b.dz = 0;
      b.solid = true; b.state = 'idle'; b.timer = 0; b.drop = 0;
    }
    this.update(0);
  }
}

export function newPlayer(x, y, z) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, ground: null, coyote: 0, buffer: 0, airJumps: 1, bounced: false, stun: 0, hitCooldown: 0 };
}

function moveAxis(p, world, axis, amount) {
  p[axis] += amount;
  let hit = null;
  for (const b of world.bodies) {
    if (!b.solid || !overlaps(p, b)) continue;
    if (axis === 'y') {
      if (amount <= 0) { p.y = top(b); hit = b; } else p.y = b.y - b.hy - PHYS.height;
      p.vy = 0;
    } else {
      const h = axis === 'x' ? b.hx : b.hz;
      const v = axis === 'x' ? 'vx' : 'vz';
      p[axis] = amount > 0 ? b[axis] - h - PHYS.radius : b[axis] + h + PHYS.radius;
      p[v] = 0;
    }
  }
  return hit;
}

/** Push the player out of platforms that moved into them (moving platforms, respawned crumbles). */
function depenetrate(p, world) {
  for (const b of world.bodies) {
    if (!b.solid || !overlaps(p, b)) continue;
    const up = top(b) - p.y;
    if (up < 0.35) { p.y = top(b); if (p.vy < 0) p.vy = 0; continue; }
    const pens = [
      ['x', b.x - b.hx - PHYS.radius - p.x], ['x', b.x + b.hx + PHYS.radius - p.x],
      ['z', b.z - b.hz - PHYS.radius - p.z], ['z', b.z + b.hz + PHYS.radius - p.z],
      ['y', b.y - b.hy - PHYS.height - p.y],
    ];
    pens.sort((a, c) => Math.abs(a[1]) - Math.abs(c[1]));
    p[pens[0][0]] += pens[0][1];
  }
}

function hazardHit(p, h) {
  const cy = p.y + PHYS.height / 2;
  if (Math.abs(cy - h.y) > PHYS.height / 2 + h.r) return null;
  const dx = Math.cos(h.angle), dz = Math.sin(h.angle);
  const rx = p.x - h.x, rz = p.z - h.z;
  const along = Math.max(-h.len, Math.min(h.len, rx * dx + rz * dz));
  const ex = rx - along * dx, ez = rz - along * dz;
  if (Math.hypot(ex, ez) > h.r + PHYS.radius) return null;
  // the arm sweeps sideways: knock the penguin along its direction of motion
  const s = Math.sign(h.speed) * (along >= 0 ? 1 : -1);
  return [-dz * s, dx * s];
}

/**
 * Advance the player by dt. input = { x, z (world-space move dir, |v|<=1), jumpPressed, jumpHeld }.
 * Pushes event names ('jump', 'doublejump', 'land', 'bounce', 'hit') into `events`.
 */
export function stepPlayer(p, world, input, dt, events) {
  const g = p.ground;
  if (g && g.solid) { p.x += g.dx; p.y += g.dy; p.z += g.dz; }
  depenetrate(p, world);

  p.coyote = p.onGround ? PHYS.coyote : Math.max(0, p.coyote - dt);
  p.buffer = input.jumpPressed ? PHYS.buffer : Math.max(0, p.buffer - dt);
  p.stun = Math.max(0, p.stun - dt);
  p.hitCooldown = Math.max(0, p.hitCooldown - dt);

  // horizontal: accelerate toward the wanted velocity
  let ix = input.x || 0, iz = input.z || 0;
  const il = Math.hypot(ix, iz);
  if (il > 1) { ix /= il; iz /= il; }
  const ice = p.onGround && g && g.type === 'ice';
  let accel = p.onGround ? (ice ? PHYS.iceAccel : PHYS.accel) : PHYS.airAccel;
  if (p.stun > 0) accel *= 0.15;
  let ddx = ix * PHYS.speed - p.vx, ddz = iz * PHYS.speed - p.vz;
  const dl = Math.hypot(ddx, ddz), maxd = accel * dt;
  if (dl > maxd) { ddx *= maxd / dl; ddz *= maxd / dl; }
  p.vx += ddx; p.vz += ddz;

  // jumping
  if (p.buffer > 0) {
    if (p.coyote > 0) {
      p.vy = PHYS.jump; events.push('jump');
    } else if (p.airJumps > 0) {
      p.vy = Math.max(p.vy, PHYS.airJump); p.airJumps -= 1; p.bounced = false; events.push('doublejump');
    }
    if (p.vy > 0) { p.buffer = 0; p.coyote = 0; p.onGround = false; p.ground = null; }
  }

  // gravity; releasing jump early cuts the jump short
  if (p.vy <= 0) p.bounced = false;
  const cut = p.vy > 0 && !input.jumpHeld && !p.bounced ? 2.2 : 1;
  p.vy = Math.max(-PHYS.maxFall, p.vy - PHYS.gravity * cut * dt);

  const fallSpeed = -p.vy;
  const wasGround = p.onGround;
  const landed = moveAxis(p, world, 'y', p.vy * dt);
  moveAxis(p, world, 'x', p.vx * dt);
  moveAxis(p, world, 'z', p.vz * dt);

  p.onGround = false;
  p.ground = null;
  if (landed) {
    if (landed.type === 'bounce') {
      p.vy = PHYS.bounce; p.bounced = true; p.airJumps = 1; events.push('bounce');
    } else {
      p.onGround = true; p.ground = landed; p.airJumps = 1;
      if (!wasGround && fallSpeed > 6) events.push('land');
      if (landed.type === 'crumble' && landed.state === 'idle') { landed.state = 'shaking'; landed.timer = PHYS.crumbleDelay; }
    }
  }

  for (const h of world.hazards) {
    if (p.hitCooldown > 0) break;
    const push = hazardHit(p, h);
    if (!push) continue;
    p.vx = push[0] * 13; p.vz = push[1] * 13; p.vy = 7;
    p.onGround = false; p.ground = null; p.stun = 0.45; p.hitCooldown = 0.5;
    events.push('hit');
  }
}

/** One attempt at a level: the world, the player, collectibles, checkpoints and the clock. */
export class Run {
  constructor(level) {
    this.level = level;
    this.world = new World(level);
    this.restart();
  }

  restart() {
    this.world.reset();
    this.fish = this.level.fish.map(() => false);
    this.checkpoint = -1;
    this.time = 0;
    this.deaths = 0;
    this.finished = false;
    this.started = false;
    this.respawn();
  }

  get spawn() {
    const c = this.level.checkpoints[this.checkpoint];
    return c ? { x: c[0], y: c[1], z: c[2], yaw: c[3] ?? this.level.spawn.yaw } : this.level.spawn;
  }

  respawn() {
    const s = this.spawn;
    this.player = newPlayer(s.x, s.y + 0.05, s.z);
  }

  get fishCount() { return this.fish.filter(Boolean).length; }

  step(input, dt, events = []) {
    if (this.finished) { this.world.update(dt, this.player); return events; }
    if (!this.started && (input.x || input.z || input.jumpPressed)) this.started = true;
    if (this.started) this.time += dt;
    this.world.update(dt, this.player);
    const p = this.player;
    stepPlayer(p, this.world, input, dt, events);

    const cy = p.y + PHYS.height / 2;
    this.level.fish.forEach((f, i) => {
      if (!this.fish[i] && Math.hypot(p.x - f[0], cy - f[1], p.z - f[2]) < 1.15) {
        this.fish[i] = true; events.push('fish');
      }
    });
    this.level.checkpoints.forEach((c, i) => {
      if (i > this.checkpoint && Math.abs(p.x - c[0]) < 1.8 && Math.abs(p.z - c[2]) < 1.8 && p.y > c[1] - 0.3 && p.y < c[1] + 3) {
        this.checkpoint = i; events.push('checkpoint');
      }
    });
    const f = this.level.finish;
    if (Math.abs(p.x - f[0]) < 2.5 && Math.abs(p.z - f[2]) < 2.5 && p.y > f[1] - 0.3 && p.y < f[1] + 3) {
      this.finished = true; events.push('finish');
    }
    if (p.y < PHYS.fallY) {
      this.deaths += 1;
      events.push('fall');
      this.respawn();
    }
    return events;
  }
}
