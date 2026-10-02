import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';
import { MAX_PLAYERS, MAX_PARTY } from '../shared/constants.js';
import { SKINS } from '../shared/skins.js';
import { getProfile, setName, equip, recordMatch, publicProfile } from './profiles.js';
import { Match } from '../shared/match.js';

const PORT = Number(process.env.PORT || 3000);
const QUEUE_WAIT_MS = Number(process.env.QUEUE_WAIT_MS ?? 12000);
// Matches are topped up with bots to this many penguins (0 disables bots).
const MIN_PENGUINS = Number(process.env.MIN_PENGUINS ?? 6);

const root = path.resolve(import.meta.dirname, '..');
const app = express();
app.use(express.static(path.join(root, 'public')));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, Client>} connection id -> client */
const clients = new Map();
/** @type {Map<string, Party>} party code -> party */
const parties = new Map();
/** Lobbies that are filling up before a match starts. */
const forming = [];

/**
 * @typedef {{ id:string, ws:any, profile:any, party:Party|null, ready:boolean,
 *   match:Match|null, send:(data:string)=>void }} Client
 * @typedef {{ code:string, leader:string, members:string[], queue:object|null }} Party
 */

function send(client, msg) {
  if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
}

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join('');
  } while (parties.has(code));
  return code;
}

// ---------------------------------------------------------------- parties

function createParty(client) {
  const party = { code: newCode(), leader: client.id, members: [client.id], queue: null };
  parties.set(party.code, party);
  client.party = party;
  client.ready = false;
  sendParty(party);
}

function leaveParty(client) {
  const party = client.party;
  if (!party) return;
  if (party.queue) cancelQueue(party);
  party.members = party.members.filter((id) => id !== client.id);
  client.party = null;
  if (!party.members.length) {
    parties.delete(party.code);
  } else {
    if (party.leader === client.id) party.leader = party.members[0];
    sendParty(party);
  }
}

function joinParty(client, code) {
  const party = parties.get(String(code || '').toUpperCase().trim());
  if (!party) return send(client, { type: 'error', msg: 'Party not found' });
  if (party === client.party) return;
  if (party.members.length >= MAX_PARTY) return send(client, { type: 'error', msg: `Party is full (max ${MAX_PARTY})` });
  if (party.queue || client.match) return send(client, { type: 'error', msg: 'That party is in matchmaking right now' });
  leaveParty(client);
  party.members.push(client.id);
  client.party = party;
  client.ready = false;
  sendParty(party);
}

function sendParty(party) {
  const members = party.members.map((id) => clients.get(id)).filter(Boolean).map((c) => ({
    id: c.id,
    name: c.profile.name,
    skin: c.profile.equipped,
    wins: c.profile.wins,
    leader: c.id === party.leader,
    ready: c.ready,
    inMatch: !!c.match,
  }));
  for (const m of party.members) {
    const c = clients.get(m);
    if (c) send(c, { type: 'party', code: party.code, you: c.id, members, max: MAX_PARTY, queued: !!party.queue });
  }
}

// ------------------------------------------------------------ matchmaking

function lobbySize(lobby) {
  return lobby.parties.reduce((n, p) => n + p.members.length, 0);
}

function enqueue(party) {
  if (party.queue) return;
  const members = party.members.map((id) => clients.get(id));
  if (members.some((c) => !c || c.match)) {
    const leader = clients.get(party.leader);
    if (leader) send(leader, { type: 'error', msg: 'Wait until everyone in your party is back in the lobby' });
    return;
  }
  let lobby = forming.find((l) => lobbySize(l) + party.members.length <= MAX_PLAYERS);
  if (!lobby) {
    lobby = { parties: [], startAt: Date.now() + QUEUE_WAIT_MS, timer: null };
    lobby.timer = setTimeout(() => startMatch(lobby), QUEUE_WAIT_MS);
    forming.push(lobby);
  }
  lobby.parties.push(party);
  party.queue = lobby;
  if (lobbySize(lobby) >= MAX_PLAYERS) startMatch(lobby);
  else sendQueueStatus(lobby);
}

function cancelQueue(party) {
  const lobby = party.queue;
  if (!lobby) return;
  party.queue = null;
  lobby.parties = lobby.parties.filter((p) => p !== party);
  if (!lobby.parties.length) {
    clearTimeout(lobby.timer);
    forming.splice(forming.indexOf(lobby), 1);
  } else {
    sendQueueStatus(lobby);
  }
  for (const id of party.members) {
    const c = clients.get(id);
    if (c) send(c, { type: 'queue', state: 'idle' });
  }
  sendParty(party);
}

function sendQueueStatus(lobby) {
  const found = lobbySize(lobby);
  for (const party of lobby.parties) {
    for (const id of party.members) {
      const c = clients.get(id);
      if (c) send(c, { type: 'queue', state: 'searching', found, max: MAX_PLAYERS, startsIn: Math.max(0, lobby.startAt - Date.now()) });
    }
    sendParty(party);
  }
}

function startMatch(lobby) {
  clearTimeout(lobby.timer);
  const idx = forming.indexOf(lobby);
  if (idx >= 0) forming.splice(idx, 1);

  const humans = [];
  for (const party of lobby.parties) {
    party.queue = null;
    for (const id of party.members) {
      const c = clients.get(id);
      if (c && !c.match) humans.push(c);
    }
  }
  if (!humans.length) return;

  const botCount = Math.max(MIN_PENGUINS > 0 ? Math.max(0, MIN_PENGUINS - humans.length) : 0, humans.length < 2 ? 1 : 0);
  const entrants = [
    ...humans.map((c) => ({ id: c.id, name: c.profile.name, skin: c.profile.equipped, isBot: false, send: (d) => c.ws.readyState === 1 && c.ws.send(d) })),
    ...Match.botEntrants(Math.min(botCount, MAX_PLAYERS - humans.length), SKINS.map((s) => s.id)),
  ];
  const match = new Match(entrants, onMatchEnd);
  for (const c of humans) {
    c.match = match;
    c.ready = false;
  }
  for (const party of lobby.parties) sendParty(party);
}

function onMatchEnd(match, result) {
  for (const p of match.players) {
    if (p.isBot) continue;
    const c = clients.get(p.id);
    if (!c || c.match !== match) continue;
    c.match = null;
    const won = result.winnerId === p.id;
    const reward = result.abandoned ? null : recordMatch(c.profile, won);
    send(c, {
      type: 'match:end',
      winnerId: result.winnerId,
      placement: result.placements.indexOf(p.id) + 1,
      total: match.players.length,
      reward,
    });
    send(c, { type: 'profile', profile: publicProfile(c.profile) });
    if (c.party) sendParty(c.party);
  }
}

function leaveMatch(client) {
  const match = client.match;
  if (!match) return;
  client.match = null;
  match.removePlayer(client.id);
  if (client.party) sendParty(client.party);
}

// ------------------------------------------------------------ connections

wss.on('connection', (ws) => {
  /** @type {Client} */
  const client = { id: crypto.randomUUID().slice(0, 8), ws, profile: null, party: null, ready: false, match: null };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (!client.profile) {
      if (msg.type !== 'hello') return;
      const profile = getProfile(msg.profileId);
      if (!profile) return ws.close();
      client.profile = profile;
      clients.set(client.id, client);
      send(client, { type: 'welcome', profile: publicProfile(profile), maxPlayers: MAX_PLAYERS });
      const target = msg.joinCode && parties.get(String(msg.joinCode).toUpperCase());
      createParty(client);
      if (target) joinParty(client, target.code);
      return;
    }

    switch (msg.type) {
      case 'setName':
        setName(client.profile, msg.name);
        send(client, { type: 'profile', profile: publicProfile(client.profile) });
        if (client.party) sendParty(client.party);
        break;
      case 'equip':
        if (equip(client.profile, msg.skin)) {
          send(client, { type: 'profile', profile: publicProfile(client.profile) });
          if (client.party) sendParty(client.party);
        }
        break;
      case 'party:join':
        joinParty(client, msg.code);
        break;
      case 'party:leave':
        if (client.party && client.party.members.length > 1) {
          leaveParty(client);
          createParty(client);
        }
        break;
      case 'party:kick': {
        const party = client.party;
        if (!party || party.leader !== client.id || msg.id === client.id) break;
        const target = clients.get(msg.id);
        if (target && target.party === party) {
          leaveParty(target);
          createParty(target);
          send(target, { type: 'error', msg: 'You were removed from the party' });
        }
        break;
      }
      case 'party:ready':
        if (client.party) { client.ready = !!msg.ready; sendParty(client.party); }
        break;
      case 'queue:start':
        if (client.party && client.party.leader === client.id && !client.match) enqueue(client.party);
        break;
      case 'queue:cancel':
        if (client.party && client.party.queue) cancelQueue(client.party);
        break;
      case 'aim':
        if (client.match) client.match.setAim(client.id, Number(msg.x), Number(msg.z));
        break;
      case 'match:leave':
        leaveMatch(client);
        break;
    }
  });

  ws.on('close', () => {
    leaveMatch(client);
    leaveParty(client);
    clients.delete(client.id);
  });
});

server.listen(PORT, () => {
  console.log(`Penguin Brawl running on http://localhost:${PORT}`);
});
