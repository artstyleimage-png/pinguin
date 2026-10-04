import * as THREE from 'three';
import { SKINS, SKIN_BY_ID, RARITIES } from '../shared/skins.js';
import { net } from './net.js';
import { Lobby } from './lobby.js';
import { Game } from './game.js';
import { skinThumb } from './thumbs.js';
import { sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* storage may be blocked */ }
  return null;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastTimer;
function toast(msg, info = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('info', info);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ------------------------------------------------------------ state

const state = {
  profile: null,
  party: null,
  queue: { state: 'idle' },
  view: 'lobby',   // lobby | game
  locker: false,
  selectedSkin: null,
};

let profileId = store('pb-profile');
if (!profileId) {
  profileId = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  store('pb-profile', profileId);
}
const urlParty = new URLSearchParams(location.search).get('party');

// ------------------------------------------------------------ renderer

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const lobby = new Lobby();
let game = null;

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  lobby.resize(innerWidth / innerHeight);
  if (game) game.resize(innerWidth / innerHeight);
}
addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(0.05, timer.getDelta());
  if (state.view === 'game' && game) {
    game.update(dt);
    renderer.render(game.scene, game.camera);
  } else {
    lobby.update(dt);
    renderer.render(lobby.scene, lobby.camera);
  }
});

// ------------------------------------------------------------ pointer

function ndc(e) {
  return { x: (e.clientX / innerWidth) * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 };
}
canvas.addEventListener('pointermove', (e) => {
  const p = ndc(e);
  if (state.view === 'game' && game) game.setPointer(p.x, p.y);
  else {
    lobby.setPointer(p.x, p.y);
    canvas.style.cursor = lobby.hitMe(p.x, p.y) ? 'pointer' : '';
  }
});
canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  const p = ndc(e);
  if (state.view === 'game' && game) { game.setPointer(p.x, p.y); return; }
  if (lobby.hitMe(p.x, p.y)) openLocker(true);
});
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

// ------------------------------------------------------------ views

function showView(view) {
  state.view = view;
  $('lobby').classList.toggle('hidden', view !== 'lobby');
  $('hud').classList.toggle('hidden', view !== 'game');
  canvas.style.cursor = view === 'game' ? 'crosshair' : '';
}

function renderProfile() {
  const p = state.profile;
  if (!p) return;
  $('myName').textContent = p.name;
  $('statWins').textContent = p.wins;
  $('statSkins').textContent = `${p.owned.length}/${SKINS.length}`;
  $('parkourLink').href = `parkour.html?skin=${encodeURIComponent(p.equipped)}`;
  if (state.locker) renderLocker();
}

function renderParty() {
  const party = state.party;
  if (!party) return;
  const me = party.members.find((m) => m.id === party.you);
  const amLeader = me && me.leader;
  $('partyCount').textContent = `${party.members.length}/${party.max}`;
  $('partyCode').textContent = party.code;
  $('leaveParty').classList.toggle('hidden', party.members.length < 2);

  const list = $('partyList');
  list.innerHTML = '';
  for (const m of party.members) {
    const li = document.createElement('li');
    if (m.id === party.you) li.className = 'me';
    const status = m.inMatch ? 'В МАТЧЕ' : m.leader ? '👑 ЛИДЕР' : m.ready ? '✔ ГОТОВ' : 'НЕ ГОТОВ';
    li.innerHTML = `<img src="${skinThumb(m.skin)}" alt=""><div class="who"><b>${esc(m.name)}</b><small class="${m.ready || m.leader ? 'ok' : ''}">${status} · ${m.wins} 🏆</small></div>`;
    if (amLeader && m.id !== party.you) {
      const kick = document.createElement('button');
      kick.className = 'mini ghost kick';
      kick.textContent = '✕';
      kick.title = 'Выгнать из пати';
      kick.onclick = () => net.send('party:kick', { id: m.id });
      li.appendChild(kick);
    }
    list.appendChild(li);
  }
  for (let i = party.members.length; i < party.max; i++) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '+ ПРИГЛАСИ ДРУГА';
    li.onclick = copyInvite;
    list.appendChild(li);
  }

  // when previewing a skin in the locker, keep showing the preview
  lobby.setMembers(party.members, party.you);
  if (state.locker && state.selectedSkin) lobby.previewSkin(state.selectedSkin);
  renderPlayButton();
}

function renderPlayButton() {
  const party = state.party;
  const btn = $('playBtn');
  const me = party && party.members.find((m) => m.id === party.you);
  const searching = state.queue.state === 'searching';
  btn.classList.remove('cancel', 'ready');
  btn.disabled = false;
  if (searching) {
    btn.textContent = me && me.leader ? 'ОТМЕНА' : 'ПОИСК…';
    btn.classList.add('cancel');
    btn.disabled = !(me && me.leader);
  } else if (!me || me.leader) {
    btn.textContent = 'ИГРАТЬ';
  } else {
    btn.textContent = me.ready ? 'ГОТОВ ✔' : 'ГОТОВ?';
    if (me.ready) btn.classList.add('ready');
  }
  $('queueStatus').classList.toggle('hidden', !searching);
}

function openLocker(on) {
  state.locker = on;
  lobby.setLocker(on);
  $('locker').classList.toggle('hidden', !on);
  $('clickHint').classList.toggle('hidden', on);
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === (on ? 'locker' : 'play')));
  if (on) {
    state.selectedSkin = state.profile.equipped;
    renderLocker();
  } else {
    lobby.stopPreview(state.profile.equipped);
  }
}

function renderLocker() {
  const p = state.profile;
  const grid = $('skinGrid');
  grid.innerHTML = '';
  for (const s of SKINS) {
    const owned = p.owned.includes(s.id);
    const card = document.createElement('button');
    card.className = 'skin-card' + (owned ? '' : ' locked') + (s.id === p.equipped ? ' equipped' : '') + (s.id === state.selectedSkin ? ' selected' : '');
    card.style.setProperty('--rarity', RARITIES[s.rarity].color);
    card.innerHTML = `<img src="${skinThumb(s.id)}" alt=""><span class="nm">${esc(s.name)}</span>`;
    card.onclick = () => { sfx.click(); state.selectedSkin = s.id; renderLocker(); };
    grid.appendChild(card);
  }
  const sel = SKIN_BY_ID[state.selectedSkin];
  const owned = p.owned.includes(sel.id);
  const r = RARITIES[sel.rarity];
  $('skinInfo').innerHTML = `<b>${esc(sel.name)}</b><span style="color:${r.color}">${r.label}</span>` +
    `<p>${owned ? (sel.id === p.equipped ? 'Надет сейчас' : 'Есть в коллекции') : 'Закрыт — побеждай в матчах, чтобы получить новые скины!'}</p>`;
  const btn = $('equipBtn');
  btn.disabled = !owned || sel.id === p.equipped;
  btn.textContent = sel.id === p.equipped ? 'НАДЕТ' : owned ? 'НАДЕТЬ' : '🔒 ЗАКРЫТ';
  lobby.previewSkin(sel.id);
}

function copyInvite() {
  if (!state.party) return;
  const url = `${location.origin}${location.pathname}?party=${state.party.code}`;
  const done = () => toast('Ссылка-приглашение скопирована!', true);
  const fallback = () => toast(`Отправь другу ссылку: ${url}`, true);
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, fallback);
  else fallback();
}

// ------------------------------------------------------------ UI events

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => { sfx.click(); openLocker(tab.dataset.tab === 'locker'); };
});
$('closeLocker').onclick = () => openLocker(false);
$('equipBtn').onclick = () => { sfx.click(); net.send('equip', { skin: state.selectedSkin }); };
$('copyInvite').onclick = copyInvite;
$('joinForm').onsubmit = (e) => {
  e.preventDefault();
  const code = $('joinInput').value.trim().toUpperCase();
  if (code.length === 5) net.send('party:join', { code });
  $('joinInput').value = '';
};
$('leaveParty').onclick = () => net.send('party:leave');
// inline nickname editing (browser prompt() dialogs are not available everywhere)
$('nameBtn').onclick = () => {
  if ($('nameBtn').querySelector('input')) return;
  const input = document.createElement('input');
  input.id = 'nameInput';
  input.maxLength = 16;
  input.value = state.profile?.name || '';
  input.setAttribute('aria-label', 'Никнейм');
  $('nameBtn').replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    $('nameBtn').innerHTML = '<span id="myName"></span> ✎';
    renderProfile();
    if (save && name && name !== state.profile.name) net.send('setName', { name });
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
};
$('playBtn').onclick = () => {
  sfx.click();
  const party = state.party;
  const me = party && party.members.find((m) => m.id === party.you);
  if (!me) return;
  if (state.queue.state === 'searching') { if (me.leader) net.send('queue:cancel'); return; }
  if (me.leader) {
    const notReady = party.members.filter((m) => !m.leader && !m.ready);
    if (notReady.length) toast(`Не все готовы: ${notReady.map((m) => m.name).join(', ')} — стартуем всё равно`, true);
    net.send('queue:start');
  } else {
    net.send('party:ready', { ready: !me.ready });
  }
};
$('leaveMatch').onclick = () => { net.send('match:leave'); backToLobby(); };
$('backToLobby').onclick = () => backToLobby();
$('muteBtn').textContent = sfx.muted ? '🔇' : '🔊';
$('muteBtn').onclick = () => { $('muteBtn').textContent = sfx.toggle() ? '🔇' : '🔊'; };

function backToLobby() {
  if (game) { game.dispose(); game = null; }
  showView('lobby');
  renderParty();
}

// ------------------------------------------------------------ network

net.on('welcome', (msg) => {
  state.profile = msg.profile;
  if (msg.offline) {
    document.body.classList.add('offline');
    $('modeText').textContent = 'Ты против 5 ботов · Последний на льдине побеждает';
  }
  renderProfile();
  $('loading').classList.add('gone');
  showView('lobby');
  if (urlParty) history.replaceState(null, '', location.pathname);
});
net.on('profile', (msg) => {
  state.profile = msg.profile;
  renderProfile();
});
net.on('party', (msg) => {
  const prevCode = state.party && state.party.code;
  const prevCount = state.party ? state.party.members.length : 0;
  state.party = msg;
  if (!msg.queued && state.queue.state === 'searching') state.queue = { state: 'idle' };
  if (prevCode && prevCode !== msg.code && msg.members.length > 1) toast('Ты в пати друга!', true);
  else if (prevCode === msg.code && msg.members.length > prevCount) toast('Друг присоединился к пати!', true);
  if (state.view === 'lobby') renderParty();
});
net.on('queue', (msg) => {
  state.queue = msg;
  if (msg.state === 'searching') {
    $('queueText').textContent = `Поиск игроков… ${msg.found}/${msg.max}`;
    state.queueEndsAt = performance.now() + msg.startsIn;
  }
  renderPlayButton();
});
setInterval(() => {
  if (state.queue.state !== 'searching') return;
  const s = Math.max(0, Math.ceil((state.queueEndsAt - performance.now()) / 1000));
  $('queueSub').textContent = `Старт через ${s} c (недостающих добавят ботами)`;
}, 250);
net.on('error', (msg) => toast(msg.msg));

net.on('match:start', (msg) => {
  state.queue = { state: 'idle' };
  if (state.locker) openLocker(false);
  if (game) game.dispose();
  game = new Game(msg, state.party.you);
  showView('game');
});
net.on('match:phase', (msg) => game && game.onPhase(msg));
net.on('match:state', (msg) => game && game.onState(msg));
net.on('match:launch', (msg) => game && game.onLaunch(msg));
net.on('match:bump', (msg) => game && game.onBump(msg));
net.on('match:out', (msg) => game && game.onOut(msg));
net.on('match:end', (msg) => {
  if (!game) return;
  const won = msg.winnerId === state.party.you;
  const winner = msg.winnerId && game.players.get(msg.winnerId);
  const title = $('resultsTitle');
  title.textContent = won ? '#1 ПОБЕДА!' : `#${msg.placement} МЕСТО`;
  title.classList.toggle('lose', !won);
  $('resultsSub').textContent = won
    ? 'Ты последний пингвин на льдине!'
    : winner ? `Победил ${winner.name}` : 'Все оказались в воде — ничья!';
  const box = $('rewardBox');
  box.classList.toggle('hidden', !msg.reward);
  if (msg.reward) {
    const s = SKIN_BY_ID[msg.reward];
    box.style.setProperty('--rarity', RARITIES[s.rarity].color);
    $('rewardImg').src = skinThumb(s.id);
    $('rewardName').textContent = s.name;
    $('rewardRarity').textContent = RARITIES[s.rarity].label;
  } else if (won) {
    $('resultsSub').textContent += ' У тебя уже все скины!';
  }
  if (won) sfx.win(); else sfx.lose();
  $('results').classList.remove('hidden');
});

net.on('close', () => {
  $('loading').classList.remove('gone');
  $('loadingText').textContent = 'Соединение потеряно. Переподключение…';
  setTimeout(() => location.reload(), 2500);
});

net.connect({ profileId, joinCode: urlParty });
