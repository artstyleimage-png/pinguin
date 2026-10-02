// Thin WebSocket wrapper: `net.on(type, fn)` and `net.send(type, data)`.
const handlers = new Map();
let ws = null;

export const net = {
  connect(hello) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', ...hello })); emit('open', {}); };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      emit(msg.type, msg);
    };
    ws.onclose = () => emit('close', {});
  },
  send(type, data = {}) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, ...data }));
  },
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(fn);
  },
};

function emit(type, msg) {
  for (const fn of handlers.get(type) || []) fn(msg);
}
