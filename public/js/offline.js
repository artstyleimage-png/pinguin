// In-browser stand-in for the game server, used when no server is reachable
// (for example when the game is opened as a static page). It speaks the same
// message protocol, runs the same Match simulation and fills matches with bots.
import { Match } from '../shared/match.js';
import { SKINS, SKIN_BY_ID, STARTER_SKINS, pickReward } from '../shared/skins.js';

const KEY = 'pb-offline-profile';
const ME = 'me';
const PENGUINS = 6;

function load() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    if (p && Array.isArray(p.owned)) return p;
  } catch { /* storage unavailable */ }
  return { name: `Pingu_${Math.floor(Math.random() * 900 + 100)}`, owned: [...STARTER_SKINS], equipped: STARTER_SKINS[0], wins: 0, matches: 0 };
}

export function createOfflineServer(deliver) {
  const profile = load();
  let match = null;
  let queueTimer = null;

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* ignore */ } };
  const emit = (msg) => setTimeout(() => deliver(msg), 0);
  const sendProfile = () => emit({ type: 'profile', profile: { ...profile } });
  const sendParty = () => emit({
    type: 'party', code: 'SOLO', you: ME, max: 4, queued: !!queueTimer, offline: true,
    members: [{ id: ME, name: profile.name, skin: profile.equipped, wins: profile.wins, leader: true, ready: true, inMatch: !!match }],
  });

  function startMatch() {
    queueTimer = null;
    const me = { id: ME, name: profile.name, skin: profile.equipped, isBot: false, send: (d) => deliver(JSON.parse(d)) };
    const bots = Match.botEntrants(PENGUINS - 1, SKINS.map((s) => s.id));
    match = new Match([me, ...bots], (m, result) => {
      if (match !== m) return;
      match = null;
      profile.matches += 1;
      let reward = null;
      if (result.winnerId === ME && !result.abandoned) {
        profile.wins += 1;
        reward = pickReward(profile.owned);
        if (reward) profile.owned.push(reward.id);
      }
      save();
      emit({ type: 'match:end', winnerId: result.winnerId, placement: result.placements.indexOf(ME) + 1, total: m.players.length, reward: reward && reward.id });
      sendProfile();
      sendParty();
    });
    sendParty();
  }

  return {
    handle(msg) {
      switch (msg.type) {
        case 'hello':
          emit({ type: 'welcome', profile: { ...profile }, maxPlayers: 10, offline: true });
          sendParty();
          break;
        case 'setName': {
          const n = String(msg.name || '').replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().slice(0, 16);
          if (n) { profile.name = n; save(); }
          sendProfile(); sendParty();
          break;
        }
        case 'equip':
          if (SKIN_BY_ID[msg.skin] && profile.owned.includes(msg.skin)) { profile.equipped = msg.skin; save(); sendProfile(); sendParty(); }
          break;
        case 'party:join':
          emit({ type: 'error', msg: 'Пати с друзьями работает только при запуске через сервер' });
          break;
        case 'queue:start':
          if (match || queueTimer) break;
          queueTimer = setTimeout(startMatch, 2000);
          emit({ type: 'queue', state: 'searching', found: 1, max: PENGUINS, startsIn: 2000 });
          sendParty();
          break;
        case 'queue:cancel':
          clearTimeout(queueTimer); queueTimer = null;
          emit({ type: 'queue', state: 'idle' });
          sendParty();
          break;
        case 'aim':
          if (match) match.setAim(ME, Number(msg.x), Number(msg.z));
          break;
        case 'match:leave':
          if (match) { const m = match; match = null; m.removePlayer(ME); sendParty(); }
          break;
      }
    },
  };
}
