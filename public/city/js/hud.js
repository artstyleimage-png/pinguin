import { HALF, BOUND, roadLine, N, ROAD } from './world.js';
import { WEAPONS } from './actors.js';

const $ = (id) => document.getElementById(id);
const MAP = 720;
const MC = MAP / 2;

export class HUD {
  constructor(world) {
    this.world = world;
    this.el = {
      money: $('money'), loot: $('loot'), stars: [...document.querySelectorAll('#wanted i')], wanted: $('wanted'),
      weapon: $('weapon'), wIcon: $('wIcon'), wName: $('wName'), wAmmo: $('wAmmo'),
      hp: $('hpFill'), nitro: $('nitroFill'), nitroBox: $('nitro'), speed: $('speedo'),
      objective: $('objective'), hint: $('hint'), popups: $('popups'), big: $('bigText'),
      progress: $('progress'), progressFill: $('progressFill'), progressLabel: $('progressLabel'),
      vignette: $('vignette'), crosshair: $('crosshair'), drift: $('drift'), fish: $('fishCount'),
      fullmap: $('fullmap'),
    };
    this.mini = $('minimap').getContext('2d');
    this.full = $('fullmapCanvas').getContext('2d');
    this.base = this.renderBase();
    this.lastMoney = -1;
    this.dmgT = 0;
  }

  renderBase() {
    const c = document.createElement('canvas');
    c.width = c.height = MAP;
    const g = c.getContext('2d');
    const U = (x) => MC - x, V = (z) => MC - z;
    g.fillStyle = '#2a7fc0';
    g.fillRect(0, 0, MAP, MAP);
    g.fillStyle = '#e6d3a0';
    g.fillRect(U(BOUND), V(BOUND), BOUND * 2, BOUND * 2);
    g.fillStyle = '#7fb069';
    g.fillRect(U(HALF + 15), V(HALF + 15), (HALF + 15) * 2, (HALF + 15) * 2);
    const typeColor = { park: '#5f9e48', plaza: '#55585e', parkour: '#8d8f93', military: '#7b8060', heliport: '#55595f', hospital: '#cfd8cf', police: '#b7bcc2', bank: '#d8cfa8', hideout: '#9a9488', spray: '#9aa0a6' };
    for (const b of this.world.blocks) {
      g.fillStyle = '#b9b6ae';
      g.fillRect(U(b.x1), V(b.z1), b.x1 - b.x0, b.z1 - b.z0);
      if (typeColor[b.type]) {
        g.fillStyle = typeColor[b.type];
        g.fillRect(U(b.x1) + 4, V(b.z1) + 4, b.x1 - b.x0 - 8, b.z1 - b.z0 - 8);
      }
    }
    g.fillStyle = '#4a4d55';
    for (let k = 0; k <= N; k++) {
      const l = roadLine(k);
      g.fillRect(U(l) - ROAD / 2, V(HALF + ROAD / 2), ROAD, HALF * 2 + ROAD);
      g.fillRect(U(HALF + ROAD / 2), V(l) - ROAD / 2, HALF * 2 + ROAD, ROAD);
    }
    for (const f of this.world.mapFeatures) {
      if (f.type === 'building') {
        g.fillStyle = f.bank ? '#c9a23a' : f.h > 30 ? '#6b7280' : '#8b919a';
        g.fillRect(U(f.x + f.w / 2), V(f.z + f.d / 2), f.w, f.d);
      } else if (f.type === 'ramp') {
        g.fillStyle = '#c9a24a';
        g.fillRect(U(f.x + f.w / 2), V(f.z + f.d / 2), f.w, f.d);
      }
    }
    return c;
  }

  setMoney(m, loot) {
    if (m !== this.lastMoney) {
      this.el.money.textContent = `$${String(Math.floor(m)).padStart(8, '0')}`;
      this.lastMoney = m;
    }
    this.el.loot.textContent = loot > 0 ? `В сумке: $${loot}` : '';
    this.el.loot.classList.toggle('hidden', !(loot > 0));
  }

  setWanted(n, flashing) {
    this.el.stars.forEach((s, i) => s.classList.toggle('on', i < n));
    this.el.wanted.classList.toggle('flash', flashing && n > 0);
  }

  setWeapon(p) {
    const w = WEAPONS[p.weapon];
    this.el.wIcon.textContent = w.icon;
    this.el.wName.textContent = w.name;
    this.el.wAmmo.textContent = w.melee ? '' : p.reloadT > 0 ? 'перезарядка…' : `${p.mag[p.weapon]} / ∞`;
  }

  setHealth(hp) {
    this.el.hp.style.width = `${Math.max(0, hp)}%`;
    this.el.hp.classList.toggle('low', hp < 30);
  }

  setVehicle(v) {
    this.el.speed.classList.toggle('hidden', !v);
    this.el.nitroBox.classList.toggle('hidden', !v || v.kind === 'heli' || v.kind === 'tank');
    if (!v) return;
    const kmh = Math.round(v.speed * 3.6);
    this.el.speed.innerHTML = v.kind === 'heli'
      ? `<b>${kmh}</b> км/ч<br><small>высота ${Math.round(v.pos.y)} м</small>`
      : `<b>${kmh}</b> км/ч${v.hp < v.spec.hp * 0.35 ? '<br><small class="warn">МАШИНА ГОРИТ!</small>' : ''}`;
    this.el.nitro.style.width = `${v.nitro * 100}%`;
  }

  setDrift(d) {
    if (d && d.score > 1) {
      this.el.drift.classList.remove('hidden');
      this.el.drift.innerHTML = `ДРИФТ <b>${Math.floor(d.score)}</b> <span>x${d.mult.toFixed(1)}</span>`;
    } else this.el.drift.classList.add('hidden');
  }

  objective(text) { this.el.objective.innerHTML = text; }
  hint(text) {
    if (this._hint === text) return;
    this._hint = text;
    this.el.hint.innerHTML = text || '';
    this.el.hint.classList.toggle('hidden', !text);
  }

  progress(p, label) {
    this.el.progress.classList.toggle('hidden', p == null);
    if (p != null) {
      this.el.progressFill.style.width = `${p * 100}%`;
      this.el.progressLabel.textContent = label;
    }
  }

  popup(text, color = '#fff') {
    const d = document.createElement('div');
    d.className = 'popup';
    d.style.color = color;
    d.textContent = text;
    this.el.popups.appendChild(d);
    while (this.el.popups.children.length > 4) this.el.popups.firstChild.remove();
    setTimeout(() => d.remove(), 2200);
  }

  big(text, sub = '', cls = '') {
    this.el.big.className = `big ${cls}`;
    this.el.big.innerHTML = text ? `${text}${sub ? `<small>${sub}</small>` : ''}` : '';
    this.el.big.classList.toggle('hidden', !text);
  }

  damage() {
    this.dmgT = 0.5;
  }

  fish(n, total) { this.el.fish.textContent = `🐟 ${n}/${total}`; }

  crosshair(show, kind) {
    this.el.crosshair.classList.toggle('hidden', !show);
    this.el.crosshair.dataset.kind = kind || '';
  }

  update(dt) {
    this.dmgT = Math.max(0, this.dmgT - dt);
    this.el.vignette.style.opacity = this.dmgT * 1.6;
  }

  /** blips: [{x, z, color, icon, size, edge}] */
  drawMinimap(px, pz, yaw, blips, zoom = 1) {
    const g = this.mini;
    const S = g.canvas.width;
    const R = S / 2;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#2a7fc0';
    g.fillRect(0, 0, S, S);
    g.translate(R, R);
    g.rotate(yaw);
    g.scale(zoom, zoom);
    g.drawImage(this.base, -(MC - px), -(MC - pz));
    g.restore();
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (const b of blips) {
      let u = (px - b.x) * zoom, v = (pz - b.z) * zoom;
      let x = u * cos - v * sin, y = u * sin + v * cos;
      const d = Math.hypot(x, y);
      if (d > R - 10) {
        if (!b.edge) continue;
        x *= (R - 10) / d; y *= (R - 10) / d;
      }
      this.blip(g, R + x, R + y, b);
    }
    // player arrow
    g.save();
    g.translate(R, R);
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -9); g.lineTo(7, 7); g.lineTo(0, 3); g.lineTo(-7, 7); g.closePath();
    g.fill(); g.stroke();
    g.restore();
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.stroke();
  }

  blip(g, x, y, b) {
    if (b.icon) {
      g.font = `bold ${b.size || 16}px "Lilita One", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = b.bg || 'rgba(0,0,0,0.75)';
      g.beginPath(); g.arc(x, y, (b.size || 16) * 0.7, 0, Math.PI * 2); g.fill();
      g.fillStyle = b.color || '#fff';
      g.fillText(b.icon, x, y + 1);
    } else {
      g.fillStyle = b.color;
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, b.size || 4, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }

  drawFullmap(px, pz, yaw, blips) {
    const g = this.full;
    const c = g.canvas;
    const size = Math.min(window.innerWidth, window.innerHeight) * 0.86;
    if (c.width !== Math.round(size)) { c.width = c.height = Math.round(size); }
    const k = c.width / MAP;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(this.base, 0, 0, c.width, c.height);
    for (const b of blips) this.blip(g, (MC - b.x) * k, (MC - b.z) * k, { ...b, size: (b.size || 16) * (b.icon ? 1.2 : 1) });
    g.save();
    g.translate((MC - px) * k, (MC - pz) * k);
    g.rotate(Math.PI - yaw + Math.PI);
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 4); g.lineTo(-8, 8); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }

  showFullmap(on) { this.el.fullmap.classList.toggle('hidden', !on); }
}
