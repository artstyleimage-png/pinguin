import * as THREE from 'three';
import { locate } from './tracks.js';
import { DIM } from './carModel.js';

// ---- 2026-flavoured numbers (FIA 2026 regs: 768 kg min. weight, 3.4 m wheelbase,
//      1.6 V6 turbo ~400 kW + 350 kW electric, 15 000 rpm limit, active aero) ----
export const MASS = 800; // car at minimum weight + driver/fuel margin
const IZ = 1050;
const L = DIM.wheelbase;
const A = L * 0.55; // CG to front axle (45 % of weight on the front)
const B = L - A;
const H = 0.28;
const G = 9.81;
const RHO = 1.2;
export const LIMITER = 15000;
export const SHIFT_RPM = 12300;
const IDLE = 5000;
// speed (km/h) at 12 000 rpm in each of the 8 gears
const GEAR_KMH = [88, 125, 158, 190, 222, 256, 290, 326];
const AERO = { corner: { cl: 3.6, cd: 1.12, bal: 0.43 }, straight: { cl: 1.7, cd: 0.7, bal: 0.4 } };
const ES_MAX = 4e6; // usable battery energy, J

export const TYRES = {
  soft: { name: 'Soft', code: 'C5', mu: [1.8, 1.1, 0.8], win: [88, 108], wear: 1.7, warm: 1.35 },
  medium: { name: 'Medium', code: 'C3', mu: [1.72, 1.06, 0.78], win: [94, 114], wear: 1.0, warm: 1.0 },
  hard: { name: 'Hard', code: 'C1', mu: [1.65, 1.02, 0.76], win: [100, 122], wear: 0.6, warm: 0.78 },
  inter: { name: 'Inter', code: 'I', mu: [1.4, 1.37, 1.12], win: [50, 80], wear: 2.6, warm: 1.2 },
  wet: { name: 'Wet', code: 'W', mu: [1.26, 1.28, 1.25], win: [35, 65], wear: 3.2, warm: 1.25 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const pac = (alpha) => Math.sin(1.45 * Math.atan(15.6 * alpha)); // simplified Pacejka curve, peak near 7°
const PEAK = Math.tan(Math.PI / 2.9) / 15.6;

export class CarPhysics {
  constructor(spec, track, { compound = 'medium', assists = {}, auto = true } = {}) {
    this.spec = spec;
    this.T = track;
    this.compound = compound;
    this.assist = { stability: true, abs: true, tc: true, steer: true, aero: true, ...assists };
    this.auto = auto;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.vx = 0; this.vy = 0; this.r = 0;
    this.gear = 1;
    this.rpm = IDLE;
    this.steerIn = 0;
    this.delta = 0;
    this.shiftCut = 0;
    this.es = ES_MAX * 0.9;
    this.aero = 'corner';
    this.aeroBlend = 0;
    this.overtake = false;
    this.tyreT = [70, 70]; // front, rear °C (tyre blankets)
    this.wear = [0, 0];
    this.wetness = 0;
    this.ambient = 24;
    this.surface = 'asphalt';
    this.loc = null;
    this.slope = 0;
    this.ax = 0; this.ay = 0;
    this.flags = { lockF: false, lockR: false, spin: false, slideF: false, slideR: false };
    this.onTrack = true;
  }

  place(x, y, z, yaw) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.vx = this.vy = this.r = 0;
    this.gear = 1;
    this.rpm = IDLE;
    this.steerIn = 0;
    this.loc = this.T ? locate(this.T, x, z) : null;
  }

  get speed() { return Math.hypot(this.vx, this.vy); }

  gearSpeed(g) { return GEAR_KMH[g - 1] / 3.6; }
  rpmAt(v, g) { return g < 1 ? IDLE : (Math.abs(v) / this.gearSpeed(g)) * 12000; }

  shift(dir) {
    if (dir > 0) {
      if (this.gear === -1) { if (Math.abs(this.vx) < 1) this.gear = 1; return 'up'; }
      if (this.gear >= 8) return null;
      this.gear++;
      this.shiftCut = 0.04; // seamless-shift gearbox: tiny torque interruption
      return 'up';
    }
    if (this.gear === 1) { if (Math.abs(this.vx) < 1) { this.gear = -1; return 'rev'; } return null; }
    if (this.gear === -1) return null;
    if (this.rpmAt(this.vx, this.gear - 1) > LIMITER - 200) return 'overrev';
    this.gear--;
    this.shiftCut = 0.05;
    return 'down';
  }

  icePower(rpm) {
    const x = rpm / 11500;
    const k = x < 1 ? 0.35 + 0.65 * (1 - (1 - x) ** 2) : 1 - 1.8 * (x - 1) ** 2;
    return 400000 * clamp(k, 0.15, 1) * this.spec.power;
  }

  /** Grip coefficient of one axle (0 front, 1 rear). */
  mu(i) {
    const t = TYRES[this.compound];
    const w = this.wetness;
    const base = w < 0.5 ? lerp(t.mu[0], t.mu[1], w / 0.5) : lerp(t.mu[1], t.mu[2], (w - 0.5) / 0.5);
    const T = this.tyreT[i];
    const out = T < t.win[0] ? t.win[0] - T : T > t.win[1] ? T - t.win[1] : 0;
    const temp = clamp(1 - 0.00022 * out * out, 0.72, 1);
    const wear = 1 - 0.32 * this.wear[i] ** 1.6;
    let surf = 1;
    if (this.surface === 'kerb') surf = 0.9 - w * 0.15;
    else if (this.surface === 'grass') surf = w > 0.2 ? 0.32 : 0.52;
    else if (this.surface === 'gravel') surf = 0.5;
    return base * temp * wear * surf * this.spec.grip;
  }

  update(dt, inp, events) {
    const T = this.T;
    // where are we on the circuit?
    let groundY = 0;
    let inZone = !T; // active aero is allowed anywhere on the proving ground
    if (T) {
      this.loc = locate(T, this.pos.x, this.pos.z, this.loc ? this.loc.i : -1);
      const Lc = this.loc;
      groundY = Lc.y;
      const ad = Math.abs(Lc.d);
      const gravelSide = Lc.d > 0 ? T.gravelL[Lc.i] : T.gravelR[Lc.i];
      this.surface = ad < T.half + 0.25 ? 'asphalt' : ad < T.half + 1.45 ? 'kerb' : gravelSide ? 'gravel' : 'grass';
      this.onTrack = ad < T.half + 2.0;
      const t = T.tan[Lc.i];
      this.slope = Lc.slope * (Math.sin(this.yaw) * t.x + Math.cos(this.yaw) * t.z);
      inZone = T.aeroZone[Lc.i];
    }

    // ---- active aero: straight-line mode only in zones, dropped on braking/steering
    const v = this.speed;
    if (this.aero === 'straight' && (!inZone || inp.brake > 0.05 || Math.abs(this.steerIn) > 0.35 || v < 20)) { this.aero = 'corner'; events.push('aero-off'); }
    if (this.aero === 'corner' && inZone && v > 40 && inp.brake < 0.05) {
      const want = this.assist.aero ? inp.throttle > 0.95 && Math.abs(this.steerIn) < 0.12 : inp.aeroToggle;
      if (want) { this.aero = 'straight'; events.push('aero-on'); }
    } else if (inp.aeroToggle && this.aero === 'straight') { this.aero = 'corner'; events.push('aero-off'); }
    this.aeroBlend += clamp((this.aero === 'straight' ? 1 : 0) - this.aeroBlend, -dt * 4, dt * 4);
    this.zone = inZone;
    this.overtake = !!inp.overtake && this.es > 0.2e6;

    // ---- steering input (keyboard ramps; analog passes through)
    const target = clamp(inp.steer, -1, 1);
    if (inp.analog) this.steerIn = target;
    else {
      const back = Math.sign(target) !== Math.sign(this.steerIn) || Math.abs(target) < Math.abs(this.steerIn);
      const rate = back ? 4.5 : clamp(2.6 - v * 0.018, 1.1, 2.6);
      this.steerIn += clamp(target - this.steerIn, -rate * dt, rate * dt);
    }

    // ---- gearbox
    if (this.auto && this.gear > 0) {
      const rpm = this.rpmAt(this.vx, this.gear);
      if (rpm > SHIFT_RPM && this.gear < 8 && inp.throttle > 0.3) { this.gear++; this.shiftCut = 0.04; events.push('up'); }
      else if (this.gear > 1 && this.rpmAt(this.vx, this.gear - 1) < (inp.brake > 0.2 ? 12600 : 10500) && rpm < (inp.brake > 0.2 ? 11000 : 8200)) { this.gear--; events.push('down'); }
    }
    if (Math.abs(this.vx) < 0.5) {
      if (inp.brake > 0.5 && inp.throttle < 0.1 && this.gear > 0) {
        this.holdT = (this.holdT || 0) + dt;
        if (this.holdT > 0.5) { this.gear = -1; this.holdT = 0; events.push('rev'); }
      } else this.holdT = 0;
      if (this.gear === -1 && inp.throttle > 0.1) { this.gear = 1; events.push('up'); }
    }
    this.shiftCut -= dt;

    // ---- integrate the dynamics in sub-steps
    const n = 4;
    const h = dt / n;
    let heat = [0, 0];
    this.flags = { lockF: false, lockR: false, spin: false, slideF: false, slideR: false };
    for (let k = 0; k < n; k++) heat = this.step(h, inp, heat);

    // ---- tyre temperature and wear
    const tyre = TYRES[this.compound];
    for (let i = 0; i < 2; i++) {
      const wetCool = 1 + this.wetness * (this.compound === 'inter' || this.compound === 'wet' ? 2.2 : 4);
      const dT = (heat[i] / dt) * 5e-5 * tyre.warm + v * 0.012 - 0.008 * (this.tyreT[i] - this.ambient) * (1 + v / 45) * wetCool;
      this.tyreT[i] = clamp(this.tyreT[i] + dT * dt, this.ambient - 5, 160);
      const dryOnWets = (this.compound === 'inter' || this.compound === 'wet') ? (1 - this.wetness) * 3 : 0;
      this.wear[i] = clamp(this.wear[i] + dt * tyre.wear * (heat[i] / dt * 3.2e-10 + v * 1.1e-6) * (1 + dryOnWets), 0, 1);
    }

    // ---- walls
    if (T) {
      const Lc = locate(T, this.pos.x, this.pos.z, this.loc.i);
      const limL = T.wallL[Lc.i] - 0.95, limR = -(T.wallR[Lc.i] - 0.95);
      if (Lc.d > limL || Lc.d < limR) {
        const nr = T.nrm[Lc.i];
        const over = Lc.d > limL ? Lc.d - limL : Lc.d - limR;
        this.pos.x -= nr.x * over;
        this.pos.z -= nr.z * over;
        // world velocity, wall normal pointing back into the track
        const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
        let wx = s * this.vx + c * this.vy, wz = c * this.vx - s * this.vy;
        const inX = -Math.sign(Lc.d) * nr.x, inZ = -Math.sign(Lc.d) * nr.z;
        const vn = wx * inX + wz * inZ;
        if (vn < 0) {
          wx -= 1.3 * vn * inX; wz -= 1.3 * vn * inZ;
          wx *= 0.82; wz *= 0.82;
          this.vx = s * wx + c * wz;
          this.vy = c * wx - s * wz;
          this.r *= 0.4;
          if (-vn > 2) events.push({ wall: -vn });
        }
      }
      this.loc = Lc;
      groundY = Lc.y;
    } else {
      const lim = 1900;
      if (Math.abs(this.pos.x) > lim || Math.abs(this.pos.z) > lim) {
        this.pos.x = clamp(this.pos.x, -lim, lim);
        this.pos.z = clamp(this.pos.z, -lim, lim);
        this.vx *= 0.4; this.vy *= 0.4;
        events.push({ wall: 6 });
      }
    }
    this.pos.y += (groundY - this.pos.y) * Math.min(1, dt * 25);
  }

  step(h, inp, heat) {
    const m = MASS;
    const v = Math.hypot(this.vx, this.vy);
    const ab = this.aeroBlend;
    const cl = lerp(AERO.corner.cl, AERO.straight.cl, ab);
    const cd = lerp(AERO.corner.cd, AERO.straight.cd, ab) * this.spec.drag;
    const bal = lerp(AERO.corner.bal, AERO.straight.bal, ab);
    const q = 0.5 * RHO * this.vx * this.vx;
    const down = q * cl;
    const drag = q * cd * Math.sign(this.vx);

    // vertical loads with longitudinal weight transfer
    let fzF = (m * G * B) / L + down * bal - (m * this.ax * H) / L;
    let fzR = (m * G * A) / L + down * (1 - bal) + (m * this.ax * H) / L;
    fzF = Math.max(300, fzF); fzR = Math.max(300, fzR);
    const muF = this.mu(0), muR = this.mu(1);

    // steering angle, with optional limit near the peak slip angle (keyboard friendly)
    const vxa = Math.max(Math.abs(this.vx), 0.1);
    let dMax = 0.3;
    if (this.assist.steer) {
      const aLat = ((fzF + fzR) * Math.min(muF, muR)) / m;
      dMax = clamp((L * aLat) / (vxa * vxa) + PEAK * 0.8, 0.045, 0.3);
    }
    this.delta = this.steerIn * dMax;
    const d = this.delta;

    // slip angles and lateral forces
    let alphaF = 0, alphaR = 0;
    if (vxa > 1.5) {
      alphaF = Math.atan2(this.vy + A * this.r, vxa) - d * Math.sign(this.vx || 1);
      alphaR = Math.atan2(this.vy - B * this.r, vxa);
    }
    let fyF = -muF * fzF * pac(alphaF);
    let fyR = -muR * fzR * pac(alphaR);

    // ---- power: ICE + electric deployment, limited by rear traction
    const rev = this.gear === -1;
    const drive = rev ? inp.brake : inp.throttle;
    const brakeIn = rev ? inp.throttle : inp.brake;
    let rpm = this.rpmAt(this.vx, this.gear);
    let fxR = 0, fxF = 0;
    this.limiter = false;
    let deploy = 0;
    if (rev) {
      rpm = IDLE + drive * 3000;
      if (this.vx > -5) fxR = -drive * 4000;
    } else {
      if (rpm < IDLE + 3500 * drive) rpm = IDLE + 3500 * drive; // launch control / clutch slip
      if (rpm >= LIMITER) { this.limiter = true; rpm = LIMITER; }
      if (this.shiftCut <= 0 && !this.limiter && drive > 0.01) {
        const kmh = v * 3.6;
        const taperStart = this.overtake ? 337 : 290;
        const taper = clamp((355 - kmh) / (355 - taperStart), 0, 1);
        // energy management: deployment fades out as the store runs low
        deploy = 350000 * taper * drive * clamp(this.es / (ES_MAX * 0.18), 0, 1);
        const p = (this.icePower(rpm) * drive + deploy) * 0.93;
        fxR = p / Math.max(this.vx, 4);
      }
      if (drive < 0.05 && this.gear > 0 && this.vx > 1) fxR -= 900 + (rpm / LIMITER) * 1600; // engine braking + lift-off harvest
    }
    // energy store
    if (deploy > 0) this.es = Math.max(0, this.es - deploy * h);
    let regen = 0;
    if (brakeIn > 0.05 && this.vx > 5) regen = Math.min(350000, brakeIn * 40000 * this.vx);
    else if (drive < 0.3 && this.vx > 10) regen = 160000 * (1 - drive / 0.3);
    this.es = Math.min(ES_MAX, this.es + regen * 0.9 * h);

    // traction
    const availR = Math.sqrt(Math.max(0, (muR * fzR) ** 2 - fyR * fyR));
    if (fxR > availR) {
      if (this.assist.tc) fxR = availR * 0.97;
      else { fxR = availR * 0.85; fyR *= 0.45; this.flags.spin = true; heat[1] += fxR * 8 * h; }
    }

    // brakes: ~56 % front, plus regen on the rear
    if (brakeIn > 0.01 && Math.abs(this.vx) > 0.3) {
      const total = brakeIn * (16000 + 0.9 * down);
      const sgn = -Math.sign(this.vx);
      const availF = Math.sqrt(Math.max(0, (muF * fzF) ** 2 - fyF * fyF));
      const availR2 = Math.sqrt(Math.max(0, (muR * fzR) ** 2 - fyR * fyR));
      let bF = total * 0.56, bR = total * 0.44;
      if (bF > availF) {
        if (this.assist.abs) bF = availF * 0.97;
        else { bF = muF * fzF * 0.85; fyF *= 0.25; this.flags.lockF = true; heat[0] += bF * 10 * h; }
      }
      if (bR > availR2) {
        if (this.assist.abs) bR = availR2 * 0.97;
        else { bR = muR * fzR * 0.85; fyR *= 0.25; this.flags.lockR = true; heat[1] += bR * 10 * h; }
      }
      // never brake past standstill
      const maxStop = (Math.abs(this.vx) * m) / h;
      const sum = Math.min(bF + bR, maxStop);
      const k = (bF + bR) > 0 ? sum / (bF + bR) : 0;
      fxF += sgn * bF * k;
      fxR += sgn * bR * k;
    }

    // slip heat (tyre work)
    heat[0] += Math.abs(fyF * alphaF * vxa) * h;
    heat[1] += Math.abs(fyR * alphaR * vxa) * h;
    if (Math.abs(alphaF) > PEAK * 1.6) this.flags.slideF = true;
    if (Math.abs(alphaR) > PEAK * 1.6) this.flags.slideR = true;

    // surface drag off the tarmac
    let surfDrag = 140 * Math.sign(this.vx);
    if (this.surface === 'grass') surfDrag += Math.sign(this.vx) * (1500 + Math.abs(this.vx) * 40);
    if (this.surface === 'gravel') surfDrag += Math.sign(this.vx) * (5500 + Math.abs(this.vx) * 90);
    const slopeF = m * G * Math.sin(Math.atan(this.slope));

    const cosd = Math.cos(d), sind = Math.sin(d);
    const Fx = fxR + fxF * cosd - fyF * sind - drag - surfDrag - slopeF;
    const Fy = fyR + fyF * cosd + fxF * sind;
    let Mz = A * (fyF * cosd + fxF * sind) - B * fyR;

    // stability assist: pull the yaw rate back toward what the steering asks for
    const rRef = (this.vx * Math.tan(d)) / L;
    const rMax = (Math.min(muF, muR) * (fzF + fzR)) / m / Math.max(v, 1);
    const rWant = clamp(rRef, -rMax, rMax);
    if (this.assist.stability && v > 6) {
      const err = this.r - rWant;
      Mz -= clamp(err * IZ * 6, -9000, 9000);
      if (Math.abs(err) > 0.35) fxR = Math.min(fxR, 0);
    }

    let ax = Fx / m + this.vy * this.r;
    let ay = Fy / m - this.vx * this.r;
    const ar = Mz / IZ;

    // low speed: blend to a kinematic model (the tyre model is singular at 0)
    const lowK = clamp((vxa - 1.5) / 3, 0, 1);
    this.vx += ax * h;
    if (Math.abs(this.vx) < 0.05 && drive < 0.01 && !rev) this.vx = 0;
    if (lowK < 1) {
      const rKin = (this.vx * Math.tan(d)) / L;
      this.r = lerp(rKin, this.r + ar * h, lowK);
      this.vy = lerp(this.vy * Math.max(0, 1 - h * 12), this.vy + ay * h, lowK);
    } else {
      this.vy += ay * h;
      this.r += ar * h;
    }
    this.ax = lerp(this.ax, Fx / m, 0.2);
    this.ay = lerp(this.ay, (fyR + fyF * cosd) / m, 0.2);
    this.yaw += this.r * h;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.pos.x += (s * this.vx + c * this.vy) * h;
    this.pos.z += (c * this.vx - s * this.vy) * h;

    this.rpm += (rpm - this.rpm) * Math.min(1, h * 25);
    this.fz = [fzF, fzR];
    this.down = down;
    this.deploying = deploy > 0;
    this.harvesting = regen > 0;
    this.alpha = [alphaF, alphaR];
    return heat;
  }

  get battery() { return this.es / ES_MAX; }
}

export { wrap, clamp };
