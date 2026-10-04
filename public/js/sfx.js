// Tiny synthesized sound effects (no audio files needed).
let ctx = null;
let muted = localGet('pb-muted') === '1';

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq = 440, to = freq, dur = 0.15, type = 'sine', vol = 0.2, delay = 0 }) {
  if (muted) return;
  const a = ac();
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.4, vol = 0.3, filter = 1200, delay = 0 }) {
  if (muted) return;
  const a = ac();
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(filter, t);
  f.frequency.exponentialRampToValueAtTime(200, t + dur);
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  get muted() { return muted; },
  toggle() { muted = !muted; localSet('pb-muted', muted ? '1' : '0'); return muted; },
  unlock() { if (!muted) ac(); },
  click() { tone({ freq: 900, to: 1200, dur: 0.06, type: 'square', vol: 0.06 }); },
  tick() { tone({ freq: 1000, dur: 0.08, type: 'square', vol: 0.07 }); },
  go() { tone({ freq: 500, to: 1000, dur: 0.25, type: 'sawtooth', vol: 0.12 }); noise({ dur: 0.5, vol: 0.12, filter: 3000 }); },
  bump(power = 5) { const v = Math.min(0.35, 0.08 + power * 0.03); tone({ freq: 220, to: 90, dur: 0.18, type: 'sine', vol: v }); tone({ freq: 600, to: 300, dur: 0.08, type: 'triangle', vol: v * 0.4 }); },
  splash() { noise({ dur: 0.8, vol: 0.35, filter: 2500 }); tone({ freq: 300, to: 80, dur: 0.3, vol: 0.1 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.35, type: 'triangle', vol: 0.15, delay: i * 0.12 })); },
  lose() { [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.35, type: 'triangle', vol: 0.12, delay: i * 0.16 })); },
  crack() { noise({ dur: 0.35, vol: 0.25, filter: 5000 }); },
  // parkour
  jump() { tone({ freq: 320, to: 620, dur: 0.12, type: 'triangle', vol: 0.1 }); },
  doubleJump() { tone({ freq: 480, to: 980, dur: 0.14, type: 'triangle', vol: 0.1 }); noise({ dur: 0.15, vol: 0.05, filter: 4000 }); },
  land() { noise({ dur: 0.12, vol: 0.12, filter: 900 }); },
  boing() { tone({ freq: 180, to: 720, dur: 0.35, type: 'sine', vol: 0.18 }); tone({ freq: 360, to: 1100, dur: 0.25, type: 'triangle', vol: 0.06, delay: 0.03 }); },
  fish() { [880, 1320].forEach((f, i) => tone({ freq: f, dur: 0.12, type: 'square', vol: 0.05, delay: i * 0.07 })); },
  checkpoint() { [659, 784, 988].forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'triangle', vol: 0.12, delay: i * 0.09 })); },
};
