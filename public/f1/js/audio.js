// Synthesized hybrid-V6 style engine plus a few one-shots.
let ctx = null, master = null, eng = null;
let muted = false;
try { muted = localStorage.getItem('f1-muted') === '1'; } catch { /* ignore */ }

function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.7;
  master.connect(ctx.destination);
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2); }
  shaper.curve = curve;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  lp.Q.value = 2;
  const g = ctx.createGain();
  g.gain.value = 0;
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
  const o2 = ctx.createOscillator(); o2.type = 'square';
  const o3 = ctx.createOscillator(); o3.type = 'sawtooth';
  const g2 = ctx.createGain(); g2.gain.value = 0.35;
  const g3 = ctx.createGain(); g3.gain.value = 0.25;
  o1.connect(shaper); o2.connect(g2).connect(shaper); o3.connect(g3).connect(shaper);
  shaper.connect(lp).connect(g).connect(master);
  // turbo whistle
  const tw = ctx.createOscillator(); tw.type = 'sine';
  const twg = ctx.createGain(); twg.gain.value = 0;
  tw.connect(twg).connect(master);
  // wind / tyre noise
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const ns = ctx.createBufferSource(); ns.buffer = buf; ns.loop = true;
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.7;
  const ng = ctx.createGain(); ng.gain.value = 0;
  ns.connect(nf).connect(ng).connect(master);
  for (const o of [o1, o2, o3, tw]) o.start();
  ns.start();
  eng = { o1, o2, o3, lp, g, tw, twg, ng, nf, buf };
}

function set(p, v, k = 0.03) { if (ctx && Number.isFinite(v)) p.setTargetAtTime(v, ctx.currentTime, k); }

function tone(freq, dur, type = 'square', vol = 0.15, delay = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function thump(vol) {
  if (!ctx || muted) return;
  const src = ctx.createBufferSource();
  src.buffer = eng.buf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random()); src.stop(t + 0.4);
}

export const audio = {
  init,
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem('f1-muted', muted ? '1' : '0'); } catch { /* ignore */ }
    if (master) master.gain.value = muted ? 0 : 0.7;
    return muted;
  },
  engine(rpm, throttle, speed, on = true, limiter = false) {
    if (!eng) return;
    const f = (rpm / 60) * 1.5; // firing frequency of a V6 is rpm/60*3, played an octave down
    set(eng.o1.frequency, f, 0.015);
    set(eng.o2.frequency, f * 0.5, 0.015);
    set(eng.o3.frequency, f * 2.01, 0.015);
    set(eng.lp.frequency, 600 + throttle * 2400 + rpm * 0.08, 0.04);
    const vol = on ? (0.06 + throttle * 0.12) * (limiter ? 0.6 + Math.random() * 0.4 : 1) : 0;
    set(eng.g.gain, vol, 0.03);
    set(eng.tw.frequency, 2500 + rpm * 0.35, 0.05);
    set(eng.twg.gain, on ? throttle * 0.012 : 0, 0.1);
    set(eng.ng.gain, on ? Math.min(0.12, speed * 0.0013) : 0, 0.2);
    set(eng.nf.frequency, 400 + speed * 12, 0.2);
  },
  shift() { if (eng && !muted) { eng.g.gain.cancelScheduledValues(ctx.currentTime); eng.g.gain.setValueAtTime(0.02, ctx.currentTime); } tone(140, 0.05, 'square', 0.06); },
  deny() { tone(220, 0.12, 'square', 0.08); tone(180, 0.15, 'square', 0.08, 0.1); },
  light() { tone(880, 0.18, 'sine', 0.2); },
  go() { tone(1320, 0.4, 'sine', 0.25); },
  lap(best) { (best ? [784, 988, 1175, 1568] : [659, 880]).forEach((f, i) => tone(f, 0.25, 'triangle', 0.16, i * 0.11)); },
  wall(power) { thump(Math.min(0.9, 0.15 + power * 0.03)); },
  kerb(on) { if (eng) set(eng.nf.Q, on ? 6 : 0.7, 0.02); },
};
