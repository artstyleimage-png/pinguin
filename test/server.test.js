import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const PORT = 3900 + Math.floor(Math.random() * 90);

function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-'));
  const proc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, QUEUE_WAIT_MS: '300', INTRO_MS: '200', AIM_MS: '400', MIN_PENGUINS: '4' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve) => proc.stdout.once('data', () => resolve(proc)));
}

function connect(profileId, extra = {}) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    inbox.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', profileId, ...extra })));
  return {
    ws, inbox,
    send: (type, data = {}) => ws.send(JSON.stringify({ type, ...data })),
    wait(pred, ms = 15000) {
      const found = inbox.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
  };
}

test('party of two queues together and a full match finishes', { timeout: 60000 }, async () => {
  const server = await startServer();
  try {
    const a = connect('aaaaaaaaaaaaaaaaaaaa');
    const party = await a.wait((m) => m.type === 'party');
    const b = connect('bbbbbbbbbbbbbbbbbbbb', { joinCode: party.code });
    const joined = await b.wait((m) => m.type === 'party' && m.members.length === 2);
    assert.equal(joined.code, party.code);

    a.send('queue:start');
    const start = await b.wait((m) => m.type === 'match:start');
    assert.equal(start.players.length, 4, 'two humans + two bots');
    assert.ok(start.players.some((p) => p.id === joined.you));

    // launch at full power every round so the match ends quickly
    a.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'match:phase' && m.phase === 'aim') a.send('aim', { x: 0, z: 7 });
    });
    const end = await a.wait((m) => m.type === 'match:end', 50000);
    assert.ok(end.placement >= 1 && end.placement <= 4);
    // someone fell in, unless the round cap ended it with everyone still standing
    const outs = a.inbox.filter((m) => m.type === 'match:out');
    const rounds = Math.max(...a.inbox.filter((m) => m.type === 'match:phase').map((m) => m.round));
    assert.ok(outs.length >= 1 || rounds >= 15);
    a.ws.close(); b.ws.close();
  } finally {
    server.kill();
  }
});

test('party is limited to four members', { timeout: 20000 }, async () => {
  const server = await startServer();
  try {
    const leader = connect('cccccccccccccccccccc');
    const { code } = await leader.wait((m) => m.type === 'party');
    const others = [];
    for (let i = 0; i < 4; i++) {
      const c = connect(`dddddddddddddddddd${i}${i}`, { joinCode: code });
      await c.wait((m) => m.type === 'party');
      others.push(c);
    }
    const last = others[3];
    const err = await last.wait((m) => m.type === 'error');
    assert.match(err.msg, /full/);
    const full = await leader.wait((m) => m.type === 'party' && m.members.length === 4);
    assert.equal(full.members.length, 4);
    for (const c of [leader, ...others]) c.ws.close();
  } finally {
    server.kill();
  }
});

test('serves the Penguin City open-world page and its modules', { timeout: 20000 }, async () => {
  const server = await startServer();
  try {
    const page = await fetch(`http://localhost:${PORT}/city/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Penguin City/);
    for (const f of ['/f1/', '/f1/js/main.js', '/f1/js/car.js', '/city/js/main.js', '/city/js/world.js', '/city/js/vehicles.js', '/js/penguin.js', '/shared/skins.js', '/vendor/three/build/three.module.js']) {
      const r = await fetch(`http://localhost:${PORT}${f}`);
      assert.equal(r.status, 200, f);
    }
  } finally {
    server.kill();
  }
});
