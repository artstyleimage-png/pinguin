import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../shared/parkour-levels.js';
import { PHYS, Run, World, movingOffset, top } from '../shared/parkour-physics.js';

const DT = 1 / 120;

function sim(run, seconds, input = {}) {
  const events = [];
  for (let t = 0; t < seconds; t += DT) run.step({ x: 0, z: 0, jumpHeld: true, ...input }, DT, events);
  return events;
}

test('jump reaches about two meters', () => {
  const run = new Run(LEVELS[0]);
  sim(run, 0.5);
  assert.ok(run.player.onGround);
  let maxY = 0;
  run.step({ jumpPressed: true, jumpHeld: true }, DT);
  for (let i = 0; i < 120; i++) { run.step({ jumpHeld: true }, DT); maxY = Math.max(maxY, run.player.y); }
  assert.ok(maxY > 1.9 && maxY < 2.2, `apex ${maxY}`);
  assert.ok(run.player.onGround, 'lands again');
});

for (const level of LEVELS) {
  test(`${level.id}: spawn and checkpoints are on solid ground`, () => {
    const run = new Run(level);
    sim(run, 1);
    assert.ok(run.player.onGround);
    assert.ok(Math.abs(run.player.y - level.spawn.y) < 0.01);
    assert.equal(run.deaths, 0);
    for (let i = 0; i < level.checkpoints.length; i++) {
      run.checkpoint = i;
      run.respawn();
      sim(run, 0.5);
      assert.ok(run.player.onGround, `checkpoint ${i}`);
    }
  });

  test(`${level.id}: every next platform is within jumping range`, () => {
    const world = new World(level);
    const bodies = world.bodies;
    for (let i = 1; i < bodies.length; i++) {
      const a = bodies[i - 1], b = bodies[i];
      let best = Infinity, rise = Infinity;
      // closest the two platforms ever get (moving platforms sampled over a period)
      for (let s = 0; s <= 40; s++) {
        const oa = movingOffset(a.spec, (s / 40) * (a.spec.period || 1));
        for (let k = 0; k <= 40; k++) {
          const ob = movingOffset(b.spec, (k / 40) * (b.spec.period || 1));
          const gx = Math.max(0, Math.abs(b.x + ob[0] - a.x - oa[0]) - a.hx - b.hx);
          const gz = Math.max(0, Math.abs(b.z + ob[2] - a.z - oa[2]) - a.hz - b.hz);
          const g = Math.hypot(gx, gz);
          const r = top(b) + ob[1] - top(a) - oa[1];
          if (g < best - 1e-9 || (Math.abs(g - best) < 1e-9 && r < rise)) { best = g; rise = r; }
        }
      }
      const spring = a.type === 'bounce';
      assert.ok(best <= (spring ? 6 : 4.6), `${level.id} #${i}: gap ${best.toFixed(2)}`);
      assert.ok(rise <= (spring ? 6 : 3.1), `${level.id} #${i}: rise ${rise.toFixed(2)}`);
    }
  });

  test(`${level.id}: an autopilot penguin can finish the course`, () => {
    const run = new Run(level);
    const bodies = run.world.bodies;
    const last = bodies.length - 1;
    let target = 1;
    const events = [];
    for (let t = 0; t < 400 && !run.finished; t += DT) {
      const p = run.player;
      if (p.onGround && p.ground.i + 1 > target) target = Math.min(last, p.ground.i + 1);
      if (events.includes('fall')) {
        // back to the checkpoint: aim for the platform after the one we respawned on
        const s = run.spawn;
        const under = bodies.findIndex((b) => b.solid && Math.abs(s.x - b.x) <= b.hx && Math.abs(s.z - b.z) <= b.hz && Math.abs(top(b) - s.y) < 0.05);
        target = Math.max(1, under + 1);
      }
      if (events.includes('bounce')) {
        const pad = bodies.findIndex((k) => k.type === 'bounce' && Math.abs(p.x - k.x) <= k.hx + PHYS.radius && Math.abs(p.z - k.z) <= k.hz + PHYS.radius);
        target = Math.max(target, pad + 1);
      }
      events.length = 0;
      const b = bodies[target];
      const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz) || 1;
      const input = { x: dx / d, z: dz / d, jumpHeld: true, jumpPressed: false };
      const g = p.ground;
      if (p.onGround && g) {
        const gapX = Math.max(0, Math.abs(b.x - g.x) - b.hx - g.hx);
        const gapZ = Math.max(0, Math.abs(b.z - g.z) - b.hz - g.hz);
        const tooFar = Math.hypot(gapX, gapZ) > 4.2 || top(b) - top(g) > 2.9 || !b.solid;
        if (tooFar && g.type !== 'crumble') { input.x = (g.x - p.x) * 2; input.z = (g.z - p.z) * 2; }
        // jump right before running off the edge
        const nx = p.x + p.vx * 0.05, nz = p.z + p.vz * 0.05;
        const leaving = Math.abs(nx - g.x) > g.hx - 0.15 || Math.abs(nz - g.z) > g.hz - 0.15;
        const onTarget = Math.abs(p.x - b.x) < b.hx && Math.abs(p.z - b.z) < b.hz;
        if (leaving && !onTarget && !tooFar) input.jumpPressed = true;
        if (g.type === 'crumble' && !tooFar && Math.hypot(p.vx, p.vz) > 6) input.jumpPressed = true;
      } else if (!p.onGround && p.vy < 0.5 && p.airJumps > 0 && p.y < top(b) + 0.5) {
        const over = Math.abs(p.x - b.x) < b.hx + 0.3 && Math.abs(p.z - b.z) < b.hz + 0.3;
        if (!over) input.jumpPressed = true;
      }
      run.step(input, DT, events);
    }
    assert.ok(run.finished, `${level.id}: stuck before platform #${target} after ${run.deaths} falls`);
    assert.ok(run.deaths <= 6, `${level.id}: ${run.deaths} falls`);
  });
}

test('crumbling ice breaks under the penguin and comes back', () => {
  const level = LEVELS.find((l) => l.id === 'melting');
  const run = new Run(level);
  const b = run.world.bodies[1];
  run.player.x = b.x; run.player.z = b.z; run.player.y = top(b) + 0.01;
  sim(run, 0.3);
  assert.equal(b.state, 'shaking');
  sim(run, 0.5);
  assert.equal(b.solid, false);
  sim(run, 1.5);
  assert.equal(run.deaths, 1, 'fell into the water');
  sim(run, PHYS.crumbleGone);
  assert.equal(b.solid, true);
});

test('fish and finish are counted', () => {
  const run = new Run(LEVELS[0]);
  const [fx, fy, fz] = LEVELS[0].fish[0];
  run.player.x = fx; run.player.z = fz; run.player.y = fy - PHYS.height / 2;
  run.step({}, DT);
  assert.equal(run.fishCount, 1);
  const [x, y, z] = LEVELS[0].finish;
  Object.assign(run.player, { x, y, z, vy: 0 });
  const events = run.step({}, DT);
  assert.ok(events.includes('finish'));
  assert.ok(run.finished);
});
