import { createOfflineServer } from './offline.js';

// Thin transport wrapper: `net.on(type, fn)` and `net.send(type, data)`.
// Talks to the game server over WebSocket; if none answers, it switches to
// the in-browser offline server (solo games against bots).
const handlers = new Map();
let ws = null;
let offline = null;

export const net = {
  get offline() { return !!offline; },
  connect(hello) {
    let opened = false;
    const goOffline = () => {
      if (offline || opened) return;
      offline = createOfflineServer((msg) => emit(msg.type, msg));
      offline.handle({ type: 'hello', ...hello });
    };
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch {
      goOffline();
      return;
    }
    const timer = setTimeout(() => { if (!opened) { ws.onclose = null; ws.close(); goOffline(); } }, 2500);
    ws.onopen = () => {
      opened = true;
      clearTimeout(timer);
      ws.send(JSON.stringify({ type: 'hello', ...hello }));
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      emit(msg.type, msg);
    };
    ws.onclose = () => {
      clearTimeout(timer);
      if (opened) emit('close', {});
      else goOffline();
    };
  },
  send(type, data = {}) {
    if (offline) offline.handle({ type, ...data });
    else if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, ...data }));
  },
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(fn);
  },
};

function emit(type, msg) {
  for (const fn of handlers.get(type) || []) fn(msg);
}
