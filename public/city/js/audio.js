// Synthesized sounds: one-shots plus a few looping voices (engine, rotor, siren, tyre squeal).
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('pc-muted') === '1'; } catch { /* ignore */ }

const loops = {};

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
    buildLoops();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

let noiseBuf = null;
function noiseBuffer() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function buildLoops() {
  // engine: two detuned saws through a lowpass
  const eg = ctx.createGain(); eg.gain.value = 0;
  const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 600;
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 50;
  const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 25;
  const o2g = ctx.createGain(); o2g.gain.value = 0.5;
  o1.connect(ef); o2.connect(o2g).connect(ef); ef.connect(eg).connect(master);
  o1.start(); o2.start();
  loops.engine = { g: eg, f: ef, o1, o2 };

  // rotor: noise chopped by an LFO
  const rn = ctx.createBufferSource(); rn.buffer = noiseBuffer(); rn.loop = true;
  const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 400;
  const rg = ctx.createGain(); rg.gain.value = 0;
  const am = ctx.createGain(); am.gain.value = 0.5;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 12;
  const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
  lfo.connect(lfoG).connect(am.gain);
  rn.connect(rf).connect(am).connect(rg).connect(master);
  rn.start(); lfo.start();
  loops.rotor = { g: rg, lfo };

  // siren
  const so = ctx.createOscillator(); so.type = 'square'; so.frequency.value = 700;
  const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1800;
  const sg = ctx.createGain(); sg.gain.value = 0;
  so.connect(sf).connect(sg).connect(master);
  so.start();
  loops.siren = { g: sg, o: so };

  // tyre squeal
  const tn = ctx.createBufferSource(); tn.buffer = noiseBuffer(); tn.loop = true;
  const tf = ctx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 1500; tf.Q.value = 6;
  const tg = ctx.createGain(); tg.gain.value = 0;
  tn.connect(tf).connect(tg).connect(master);
  tn.start();
  loops.skid = { g: tg, f: tf };
}

function tone({ freq = 440, to = freq, dur = 0.15, type = 'sine', vol = 0.2, delay = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.3, vol = 0.3, filter = 2000, to = 200, delay = 0, type = 'lowpass' }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(filter, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

function set(param, v, k = 0.08) {
  if (ctx) param.setTargetAtTime(v, ctx.currentTime, k);
}

export const audio = {
  get muted() { return muted; },
  unlock() { ac(); },
  toggle() {
    muted = !muted;
    try { localStorage.setItem('pc-muted', muted ? '1' : '0'); } catch { /* ignore */ }
    if (master) master.gain.value = muted ? 0 : 0.8;
    return muted;
  },
  shot(kind = 'pistol', vol = 1) {
    const v = vol * (kind === 'shotgun' ? 0.5 : kind === 'smg' ? 0.25 : kind === 'tank' ? 0.6 : 0.35);
    noise({ dur: kind === 'shotgun' || kind === 'tank' ? 0.4 : 0.15, vol: v, filter: kind === 'tank' ? 900 : 5000, to: 300 });
    tone({ freq: kind === 'tank' ? 90 : 180, to: 50, dur: 0.12, type: 'square', vol: v * 0.4 });
  },
  rocket() { noise({ dur: 0.6, vol: 0.3, filter: 1500, to: 400, type: 'bandpass' }); },
  explosion(vol = 1) {
    noise({ dur: 1.4, vol: 0.7 * vol, filter: 1200, to: 40 });
    tone({ freq: 70, to: 25, dur: 0.8, type: 'sine', vol: 0.6 * vol });
  },
  punch() { tone({ freq: 160, to: 60, dur: 0.1, type: 'sine', vol: 0.35 }); noise({ dur: 0.08, vol: 0.2, filter: 1500 }); },
  whoosh() { noise({ dur: 0.12, vol: 0.06, filter: 3000, to: 800, type: 'bandpass' }); },
  hurt() { tone({ freq: 300, to: 150, dur: 0.15, type: 'triangle', vol: 0.15 }); },
  squawk() { tone({ freq: 900, to: 500, dur: 0.12, type: 'sawtooth', vol: 0.07 }); tone({ freq: 700, to: 400, dur: 0.1, type: 'sawtooth', vol: 0.05, delay: 0.1 }); },
  cash() { [1320, 1760].forEach((f, i) => tone({ freq: f, dur: 0.12, type: 'square', vol: 0.06, delay: i * 0.07 })); },
  pickup() { [660, 880, 1100].forEach((f, i) => tone({ freq: f, dur: 0.1, type: 'triangle', vol: 0.12, delay: i * 0.06 })); },
  jump() { tone({ freq: 300, to: 520, dur: 0.12, type: 'triangle', vol: 0.06 }); },
  land() { noise({ dur: 0.1, vol: 0.12, filter: 600 }); },
  crash(power = 1) { noise({ dur: 0.35, vol: Math.min(0.6, 0.15 * power), filter: 2500, to: 150 }); tone({ freq: 90, to: 40, dur: 0.2, vol: Math.min(0.4, 0.1 * power) }); },
  click() { tone({ freq: 1200, dur: 0.03, type: 'square', vol: 0.05 }); },
  reload() { tone({ freq: 500, dur: 0.05, type: 'square', vol: 0.06 }); tone({ freq: 800, dur: 0.05, type: 'square', vol: 0.06, delay: 0.25 }); },
  alarm() { for (let i = 0; i < 6; i++) tone({ freq: i % 2 ? 900 : 1200, dur: 0.25, type: 'square', vol: 0.08, delay: i * 0.25 }); },
  horn() { tone({ freq: 400, dur: 0.35, type: 'square', vol: 0.12 }); tone({ freq: 500, dur: 0.35, type: 'square', vol: 0.1 }); },
  wasted() { [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, dur: 0.5, type: 'triangle', vol: 0.15, delay: i * 0.25 })); },
  mission() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'triangle', vol: 0.14, delay: i * 0.1 })); },

  /** Called every frame to drive the loops. */
  loops({ engine = 0, rpm = 0, rotor = 0, rotorRate = 12, siren = 0, skid = 0, t = 0 }) {
    if (!ctx) return;
    const L = loops;
    set(L.engine.g.gain, engine * 0.12);
    set(L.engine.o1.frequency, 40 + rpm * 120, 0.05);
    set(L.engine.o2.frequency, 20 + rpm * 60, 0.05);
    set(L.engine.f.frequency, 300 + rpm * 1400, 0.05);
    set(L.rotor.g.gain, rotor * 0.35);
    set(L.rotor.lfo.frequency, rotorRate, 0.2);
    set(L.siren.g.gain, siren * 0.05);
    set(L.siren.o.frequency, Math.sin(t * 5) > 0 ? 960 : 720, 0.02);
    set(L.skid.g.gain, skid * 0.12, 0.05);
  },
};
