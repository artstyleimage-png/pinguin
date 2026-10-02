import fs from 'node:fs';
import path from 'node:path';
import { SKINS, SKIN_BY_ID, STARTER_SKINS, RARITIES } from '../shared/skins.js';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DATA_DIR, 'profiles.json');

const profiles = new Map();
let saveTimer = null;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const p of raw) profiles.set(p.id, p);
  } catch {
    // first run, or unreadable file: start empty
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFile(FILE, JSON.stringify([...profiles.values()]), (err) => {
      if (err) console.error('Failed to save profiles:', err.message);
    });
  }, 500);
}

export function cleanName(name) {
  const s = String(name || '').replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().slice(0, 16);
  return s || null;
}

function randomName() {
  const a = ['Slippy', 'Chilly', 'Frosty', 'Waddle', 'Icy', 'Flappy', 'Snowy', 'Belly'];
  const b = ['Pete', 'Chick', 'Jr', 'Boi', 'Flip', 'Toes', 'Beak', 'Puff'];
  return `${a[Math.floor(Math.random() * a.length)]}_${b[Math.floor(Math.random() * b.length)]}${Math.floor(Math.random() * 90 + 10)}`;
}

/** Returns the stored profile for `id`, creating one if it does not exist. */
export function getProfile(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(id)) return null;
  let p = profiles.get(id);
  if (!p) {
    p = { id, name: randomName(), owned: [...STARTER_SKINS], equipped: STARTER_SKINS[0], wins: 0, matches: 0 };
    profiles.set(id, p);
    scheduleSave();
  }
  return p;
}

export function setName(p, name) {
  const n = cleanName(name);
  if (n) { p.name = n; scheduleSave(); }
}

export function equip(p, skinId) {
  if (!SKIN_BY_ID[skinId] || !p.owned.includes(skinId)) return false;
  p.equipped = skinId;
  scheduleSave();
  return true;
}

export function recordMatch(p, won) {
  p.matches += 1;
  let reward = null;
  if (won) {
    p.wins += 1;
    const locked = SKINS.filter((s) => !p.owned.includes(s.id));
    if (locked.length) {
      // rarer skins are less likely to drop
      const total = locked.reduce((sum, s) => sum + RARITIES[s.rarity].weight, 0);
      let r = Math.random() * total;
      reward = locked[locked.length - 1];
      for (const s of locked) {
        r -= RARITIES[s.rarity].weight;
        if (r <= 0) { reward = s; break; }
      }
      p.owned.push(reward.id);
    }
  }
  scheduleSave();
  return reward ? reward.id : null;
}

export function publicProfile(p) {
  return { id: p.id, name: p.name, owned: p.owned, equipped: p.equipped, wins: p.wins, matches: p.matches };
}

load();
