import * as THREE from 'three';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { KartView } from './kart.js';
import { createKartState, stepKart, respawn, driftLevel, raceProgress, TUNING } from './physics.js';
import { Room, MAX_PLAYERS, KART_COLORS, packState, unpackState } from './net.js';
import { buildCastleTrack } from './tracks/castle.js';
import { buildSpaceTrack } from './tracks/space.js';
import { skyTexture, starSkyTexture, toonGradient } from './textures.js';
import { Coins, ITEMS, ITEM_IDS, ItemBoxes, ItemDirector, ItemWorld, rollItem } from './items.js';

const PHYSICS_DT = 1 / 120;
const SEND_INTERVAL = 1 / 20; // seconds between network updates
const REMOTE_DELAY = 0.12; // render other karts slightly in the past so motion stays smooth
const ROLL_TIME = 1.5; // seconds the item roulette spins
const DRAFT_CHARGE = 0.75; // seconds behind someone before the slipstream kicks in
const DRAFT_BURST = 1.5; // seconds of extra speed it gives
const $ = (id) => document.getElementById(id);

// --- Renderer and scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = skyTexture();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 2500);

const hemi = new THREE.HemisphereLight('#cfe8ff', '#6a9a4a', 1.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SHADOW_SIZE = 70;
Object.assign(sun.shadow.camera, { left: -SHADOW_SIZE, right: SHADOW_SIZE, top: SHADOW_SIZE, bottom: -SHADOW_SIZE, near: 1, far: 400 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(80, 140, 50);
const LIGHT_DIR = SUN_OFFSET.clone().normalize();
const LIGHT_RIGHT = new THREE.Vector3(0, 1, 0).cross(LIGHT_DIR).normalize();
const LIGHT_UP = LIGHT_DIR.clone().cross(LIGHT_RIGHT);

const gradientMap = toonGradient();
const input = new Input();
const audio = new Audio();

// --- Tracks -----------------------------------------------------------------------
const TRACKS = {
  castle: { name: 'Castle Cloverleaf', build: buildCastleTrack },
  space: { name: 'Star Station', build: buildSpaceTrack },
};
const skies = { day: skyTexture(), stars: starSkyTexture() };
let levelId = null;
let level, track, boxes, world, coins, startLights, wavers, spinners, blinkers, clouds;
let director = new ItemDirector();

// Swaps in a track and everything that lives on it. Cheap enough to do between races.
function loadLevel(id) {
  if (!TRACKS[id]) id = 'castle';
  if (id === levelId) return;
  if (level) {
    scene.remove(level.scene, boxes.group, world.group, coins.group);
    world.clear();
    level.scene.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [o.material].flat()) {
        m?.map?.dispose();
        m?.dispose();
      }
    });
  }
  levelId = id;
  level = TRACKS[id].build(gradientMap);
  track = level.track;
  scene.add(level.scene);
  scene.background = skies[level.sky || 'day'];
  scene.fog = new THREE.Fog(level.fog.color, level.fog.near, level.fog.far);
  const [sky, ground, strength] = level.hemi || ['#cfe8ff', '#6a9a4a', 1.4];
  hemi.color.set(sky);
  hemi.groundColor.set(ground);
  hemi.intensity = strength;
  const [sunColor, sunStrength] = level.sun || ['#fff3dc', 2.4];
  sun.color.set(sunColor);
  sun.intensity = sunStrength;

  startLights = [0, 1, 2].map((i) => level.scene.getObjectByName(`start-light-${i}`));
  wavers = [];
  spinners = [];
  blinkers = [];
  level.scene.traverse((o) => {
    if (o.userData.wave) wavers.push(o);
    if (o.userData.spin) spinners.push(o);
    if (o.userData.blink != null) blinkers.push(o);
  });
  clouds = level.scene.getObjectByName('clouds');

  boxes = new ItemBoxes(track, level.itemRows);
  world = new ItemWorld(track);
  coins = new Coins(track, level.coinLines || []);
  scene.add(boxes.group, world.group, coins.group);
  drawMapBase();
  renderTrackPickers();
}

// Rear-view mirror: a second small camera looking backwards
const mirrorCam = new THREE.PerspectiveCamera(55, 3, 0.5, 700);

// --- Player profile -------------------------------------------------------------
function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem('profile') || '{}');
    return { name: saved.name || '', color: KART_COLORS.includes(saved.color) ? saved.color : KART_COLORS[0] };
  } catch {
    return { name: '', color: KART_COLORS[0] };
  }
}
const profile = loadProfile();
function saveProfile() {
  try {
    localStorage.setItem('profile', JSON.stringify(profile));
  } catch {
    /* storage unavailable */
  }
}
function displayName() {
  return profile.name.trim() || 'Racer';
}

$('name-input').value = profile.name;
$('name-input').addEventListener('input', (e) => {
  profile.name = e.target.value;
  saveProfile();
  room?.updateProfile({ name: displayName(), color: profile.color });
});
for (const color of KART_COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = color;
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', `Kart color ${color}`);
  b.addEventListener('click', () => {
    profile.color = color;
    saveProfile();
    refreshSwatches();
    room?.updateProfile({ name: displayName(), color });
  });
  $('swatches').appendChild(b);
}
function refreshSwatches() {
  [...$('swatches').children].forEach((b, i) => b.setAttribute('aria-checked', String(KART_COLORS[i] === profile.color)));
}
refreshSwatches();

let kartView = new KartView({ color: profile.color, gradientMap });
scene.add(kartView.group, kartView.effects);

// --- Music volume -------------------------------------------------------------
const volumeSliders = [...document.querySelectorAll('.music-volume')];
function setVolume(level, announce = false) {
  audio.setMusicVolume(level);
  for (const el of volumeSliders) el.value = Math.round(audio.musicLevel * 100);
  for (const el of document.querySelectorAll('.volume-value')) el.textContent = `${Math.round(audio.musicLevel * 100)}%`;
  try {
    localStorage.setItem('music-volume', String(audio.musicLevel));
  } catch {
    /* storage unavailable; volume just won't persist */
  }
  if (announce) toast(`Music ${Math.round(audio.musicLevel * 100)}%`, 1);
}
for (const el of volumeSliders) el.addEventListener('input', () => setVolume(el.value / 100));
try {
  const saved = localStorage.getItem('music-volume');
  setVolume(saved === null ? audio.musicLevel : Number(saved));
} catch {
  setVolume(audio.musicLevel);
}

// --- Race state ---------------------------------------------------------------
let kart;
let phase = 'menu'; // menu | countdown | racing | finished
let countdown = 0;
let raceTime = 0;
let lapStart = 0;
let lapTimes = [];
let finishedAt = 0;
let lastCount = -1;
let bestLap = loadBest();
let mode = 'solo'; // solo | online
let room = null;
let mySlot = 0;
let myFinish = null;
let sendTimer = 0;
// Items held by the local player
let held = null; // item id, or null
let heldUses = 0;
let rolling = 0; // seconds of roulette left
let rollActive = false;
let rollStarted = 0;
let rollResult = null;
let rollTick = 0;
let itemSeq = 0;
const racers = new Map(); // other players: id -> { name, color, slot, view, snaps, state, finish }
const prev = { x: 0, z: 0, y: 0, ground: 0, heading: 0 }; // kart state before the last physics step

function loadBest() {
  try {
    return Number(localStorage.getItem(`best-lap:${track.name}`)) || null;
  } catch {
    return null;
  }
}
function saveBest(t) {
  try {
    localStorage.setItem(`best-lap:${track.name}`, String(t));
  } catch {
    /* storage unavailable; best lap just won't persist */
  }
}

function resetRace(slot = 0) {
  mySlot = slot;
  myFinish = null;
  if (kartView.color !== profile.color) {
    kartView.dispose(scene);
    kartView = new KartView({ color: profile.color, gradientMap });
    kartView.color = profile.color;
    scene.add(kartView.group, kartView.effects);
  }
  kart = createKartState(track.gridSlot(slot));
  Object.assign(prev, { x: kart.x, z: kart.z, y: kart.y, ground: kart.ground, heading: kart.heading });
  accumulator = 0;
  phase = 'countdown';
  countdown = 3.5;
  lastCount = -1;
  raceTime = 0;
  lapTimes = [];
  held = null;
  heldUses = 0;
  rolling = 0;
  rollActive = false;
  rollResult = null;
  itemSeq = 0;
  director = new ItemDirector();
  world.clear();
  boxes.reset();
  coins.reset();
  renderItemSlot();
  camHeading = kart.heading;
  placeCamera(1);
  $('lap-total').textContent = track.laps;
  $('results').classList.add('hidden');
  $('menu').classList.add('hidden');
  $('lobby').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('place').textContent = '';
  input.showTouch(true);
}

function startSolo() {
  audio.start();
  mode = 'solo';
  clearRacers();
  loadLevel(chosenTrack);
  resetRace(0);
  nowPlaying(audio.nextSong());
}

function showScreen(id) {
  for (const s of ['menu', 'lobby', 'results']) $(s).classList.toggle('hidden', s !== id);
  if (id) {
    $('hud').classList.add('hidden');
    input.showTouch(false);
  }
}

function backToMenu(error) {
  room?.leave();
  room = null;
  mode = 'solo';
  clearRacers();
  phase = 'menu';
  history.replaceState(null, '', location.pathname + (new URLSearchParams(location.search).get('peer') ? `?peer=${new URLSearchParams(location.search).get('peer')}` : ''));
  $('join-invite').classList.add('hidden');
  loadLevel(chosenTrack);
  renderTrackPickers();
  showMenuError(error);
  showScreen('menu');
}

function showMenuError(text) {
  $('menu-error').textContent = text || '';
  $('menu-error').classList.toggle('hidden', !text);
}

$('start-btn').addEventListener('click', startSolo);
$('again-btn').addEventListener('click', () => {
  if (mode === 'solo') return startSolo();
  if (room?.isHost) room.endRace();
  phase = 'menu';
  showLobby();
});
$('menu-btn').addEventListener('click', () => backToMenu());
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Enter' || document.activeElement?.tagName === 'INPUT') return;
  if (phase === 'menu' && !$('menu').classList.contains('hidden')) startSolo();
  if (phase === 'finished' && mode === 'solo' && !$('results').classList.contains('hidden')) startSolo();
});

// --- Online rooms ---------------------------------------------------------------
async function withBusy(button, fn) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Connecting…';
  try {
    await fn();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function wireRoom(r) {
  room = r;
  mode = 'online';
  r.on('players', () => {
    syncRacers();
    renderLobby();
  })
    .on('start', (players, trackId) => beginOnlineRace(players, trackId))
    .on('state', (id, s) => receiveState(id, s))
    .on('finish', (id, time) => {
      const r2 = racers.get(id);
      if (r2) r2.finish = time;
      if (phase === 'finished') showResults();
    })
    .on('event', (ev) => onItemEvent(ev))
    .on('left', (id) => removeRacer(id))
    .on('closed', (reason) => backToMenu(reason));
}

$('create-btn').addEventListener('click', () =>
  withBusy($('create-btn'), async () => {
    audio.start();
    showMenuError('');
    try {
      wireRoom(await Room.host({ name: displayName(), color: profile.color }));
      room.setTrack(chosenTrack);
      showLobby();
    } catch (err) {
      showMenuError(friendlyError(err));
    }
  }),
);

async function joinRoom(code, button) {
  code = code.trim().toUpperCase();
  if (code.length !== 5) return showMenuError('Room codes are 5 letters and numbers.');
  await withBusy(button, async () => {
    audio.start();
    showMenuError('');
    try {
      wireRoom(await Room.join(code, { name: displayName(), color: profile.color }));
      showLobby();
    } catch (err) {
      showMenuError(friendlyError(err));
    }
  });
}
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  joinRoom($('code-input').value, $('join-form').querySelector('button'));
});
$('invite-btn').addEventListener('click', () => joinRoom($('invite-code').textContent, $('invite-btn')));

function friendlyError(err) {
  if (err?.type === 'network' || err?.type === 'server-error' || err?.type === 'socket-error')
    return "Couldn't reach the matchmaking server. Check your internet connection and try again.";
  if (err?.type === 'browser-incompatible') return 'This browser does not support online play. Try Chrome, Edge, Firefox or Safari.';
  return err?.message || 'Something went wrong connecting. Please try again.';
}

function showLobby() {
  phase = 'menu';
  renderLobby();
  showScreen('lobby');
}

function renderLobby() {
  if (!room) return;
  $('room-code').textContent = room.code;
  $('room-link').value = room.link;
  const list = $('player-list');
  list.innerHTML = '';
  const players = [...room.players].sort((a, b) => a.slot - b.slot);
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = players[i];
    const li = document.createElement('li');
    if (p) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const name = document.createElement('span');
      name.textContent = p.name;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = [p.slot === 0 ? 'host' : '', p.id === room.myId ? 'you' : ''].filter(Boolean).join(' · ');
      li.append(dot, name, tag);
    } else {
      li.className = 'empty';
      li.textContent = 'Waiting for a friend…';
    }
    list.appendChild(li);
  }
  $('race-btn').classList.toggle('hidden', !room.isHost);
  if (room.track !== levelId) loadLevel(room.track);
  renderTrackPickers();
  $('lobby-status').textContent = room.isHost
    ? players.length > 1 ? 'Everyone in? Start the race!' : 'You can start now or wait for friends.'
    : room.racing ? 'A race is running. You will join the next one.' : 'Waiting for the host to start the race…';
}

$('copy-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('room-link').value);
    $('copy-btn').textContent = 'Copied!';
  } catch {
    $('room-link').select();
    $('copy-btn').textContent = 'Press Ctrl+C';
  }
  setTimeout(() => ($('copy-btn').textContent = 'Copy'), 1500);
});
$('race-btn').addEventListener('click', () => room?.startRace());
window.addEventListener('pagehide', () => room?.leave());
$('leave-btn').addEventListener('click', () => backToMenu());

function beginOnlineRace(players, trackId) {
  loadLevel(trackId);
  syncRacers(players);
  const me = players.find((p) => p.id === room.myId);
  if (me && me.color !== profile.color) {
    profile.color = me.color;
    refreshSwatches();
  }
  for (const r of racers.values()) {
    r.finish = null;
    r.snaps = [];
    const g = track.gridSlot(r.slot);
    r.state = { ...createKartState(g), speed: 0 };
  }
  resetRace(me ? me.slot : 0);
  nowPlaying(audio.nextSong());
}

// Keep one kart on screen for every other player in the room.
function syncRacers(players = room?.players || []) {
  const ids = new Set();
  for (const p of players) {
    if (p.id === room?.myId) continue;
    ids.add(p.id);
    let r = racers.get(p.id);
    if (r && r.color !== p.color) {
      r.view.dispose(scene);
      r = null;
    }
    if (!r) {
      const view = new KartView({ color: p.color, gradientMap });
      view.setNameTag(p.name, p.color);
      scene.add(view.group, view.effects);
      const g = track.gridSlot(p.slot);
      r = { view, snaps: [], state: { ...createKartState(g), speed: 0 }, finish: null };
      racers.set(p.id, r);
    } else if (r.name !== p.name) {
      r.view.dispose(scene);
      r.view = new KartView({ color: p.color, gradientMap });
      r.view.setNameTag(p.name, p.color);
      scene.add(r.view.group, r.view.effects);
    }
    Object.assign(r, { name: p.name, color: p.color, slot: p.slot });
  }
  for (const id of [...racers.keys()]) if (!ids.has(id)) removeRacer(id);
}

function removeRacer(id) {
  const r = racers.get(id);
  if (!r) return;
  r.view.dispose(scene);
  racers.delete(id);
  if (phase === 'finished') showResults();
}

function clearRacers() {
  for (const id of [...racers.keys()]) removeRacer(id);
}

function receiveState(id, packed) {
  const r = racers.get(id);
  if (!r) return;
  r.snaps.push({ t: performance.now() / 1000, s: unpackState(packed) });
  if (r.snaps.length > 30) r.snaps.shift();
}

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

// Blend between the two snapshots around (now - delay) so remote karts glide smoothly.
function updateRemote(r, dt) {
  const t = performance.now() / 1000 - REMOTE_DELAY;
  const snaps = r.snaps;
  if (snaps.length) {
    let a = snaps[0];
    let b = snaps[0];
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].t <= t) {
        a = snaps[i];
        b = snaps[i + 1] || snaps[i];
        break;
      }
    }
    const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
    const s = { ...b.s };
    for (const key of ['x', 'z', 'y', 'ground', 'speed']) s[key] = a.s[key] + (b.s[key] - a.s[key]) * k;
    s.heading = lerpAngle(a.s.heading, b.s.heading, k);
    s.slope = track.slopes[s.trackIndex] || 0;
    r.state = s;
  }
  r.view.update(r.state, dt, 0);
}

// Simple bumping between karts. Each player only moves their own kart.
function bumpKarts() {
  for (const r of racers.values()) {
    const o = r.state;
    const dx = kart.x - o.x;
    const dz = kart.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = 2.3;
    if (d > 0.001 && d < min && Math.abs(kart.ground + kart.y - o.ground - o.y) < 1.5) {
      const nx = dx / d;
      const nz = dz / d;
      kart.x += nx * (min - d);
      kart.z += nz * (min - d);
      const into = kart.vx * nx + kart.vz * nz;
      if (into < 0) {
        kart.vx -= nx * into * 1.3;
        kart.vz -= nz * into * 1.3;
        if (into < -4) audio.play('bump');
      }
    }
  }
}

// 1st, 2nd... finished racers rank by time, everyone else by distance covered.
function standings() {
  const list = [{ id: 'me', name: displayName(), color: profile.color, finish: myFinish, progress: raceProgress(kart, track), me: true }];
  for (const [id, r] of racers) list.push({ id, name: r.name, color: r.color, finish: r.finish, progress: raceProgress(r.state, track) });
  return list.sort((a, b) => {
    if (a.finish != null && b.finish != null) return a.finish - b.finish;
    if (a.finish != null) return -1;
    if (b.finish != null) return 1;
    return b.progress - a.progress;
  });
}

function ordinal(n) {
  return n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th');
}

// --- Items ----------------------------------------------------------------------
function myId() {
  return room ? room.myId : 'me';
}

function stateOf(id) {
  if (id === myId()) return kart;
  return racers.get(id)?.state || null;
}

function idOf(entry) {
  return entry.me ? myId() : entry.id;
}

function myPlace() {
  const list = standings();
  const i = list.findIndex((x) => x.me);
  return { place: i + 1, count: list.length, gap: Math.max(0, list[0].progress - list[i].progress) };
}

function startRoll() {
  rolling = ROLL_TIME;
  rollActive = true;
  rollStarted = raceTime;
  rollResult = null;
  const request = myPlace();
  if (!room || room.isHost) rollResult = director.grant(request);
  else room.sendEvent({ k: 'roll', ...request }, 'host');
}

function updateRoll(dt) {
  if (!rollActive) return;
  rolling -= dt;
  // If the host is slow to answer, fall back to rolling here so the roulette never hangs
  if (rollResult === null && raceTime - rollStarted > 4) rollResult = rollItem(myPlace());
  if (rolling > 0 || rollResult === null) {
    if ((rollTick -= dt) <= 0) {
      rollTick = 0.08;
      renderItemSlot(ITEM_IDS[Math.floor(Math.random() * ITEM_IDS.length)]);
      audio.play('roll');
    }
    return;
  }
  held = rollResult;
  heldUses = ITEMS[held].uses;
  rollResult = null;
  rollActive = false;
  audio.play('got');
  renderItemSlot();
  $('item-slot').classList.remove('ready');
  void $('item-slot').offsetWidth;
  $('item-slot').classList.add('ready');
}

function renderItemSlot(spinning = null) {
  const id = spinning || held;
  $('item-slot').classList.toggle('rolling', !!spinning);
  $('item-icon').textContent = id ? ITEMS[id].icon : '';
  $('item-count').textContent = !spinning && held && heldUses > 1 ? `×${heldUses}` : '';
  $('item-name').textContent = !spinning && held ? ITEMS[held].name : '';
}

function spawnItem(kind, extra = {}) {
  const sinH = Math.sin(kart.heading);
  const cosH = Math.cos(kart.heading);
  const tan = track.tangents[kart.trackIndex];
  const side = track.sides[kart.trackIndex];
  const dir = sinH * tan.x + cosH * tan.z >= 0 ? 1 : -1;
  const spec = { id: `${mySlot}-${++itemSeq}`, kind, owner: myId(), dir, ...extra };
  if (kind === 'oil') {
    spec.x = kart.x - sinH * 3;
    spec.z = kart.z - cosH * 3;
    spec.y = kart.ground;
  } else {
    const speed = { rocket: 70, homing: 75, seeker: 85 }[kind];
    spec.idx = kart.trackIndex + (dir * 3) / track.spacing;
    spec.off = kart.offset;
    spec.vOff = kind === 'rocket' ? Math.max(-15, Math.min(15, (sinH * side.x + cosH * side.z) * speed)) : 0;
  }
  world.spawn(spec);
  room?.sendEvent({ k: 'spawn', spec });
}

function useItem() {
  const list = standings();
  const i = list.findIndex((x) => x.me);
  switch (held) {
    case 'oil':
    case 'oil3':
      spawnItem('oil');
      audio.play('drop');
      break;
    case 'rocket':
      spawnItem('rocket');
      audio.play('fire');
      break;
    case 'homing':
    case 'rockets3':
      spawnItem('homing', { target: i > 0 ? idOf(list[i - 1]) : null });
      audio.play('fire');
      break;
    case 'seeker': {
      const leader = list.find((x) => !x.me && x.finish == null);
      spawnItem('seeker', { target: leader ? idOf(leader) : null });
      audio.play('fire');
      break;
    }
    case 'turbo':
      kart.boost = Math.max(kart.boost, 1.6);
      audio.play('boost');
      break;
    case 'shield':
      kart.shield = 8;
      audio.play('shield');
      break;
    case 'thunder':
      flash();
      audio.play('thunder');
      room?.sendEvent({ k: 'thunder', progress: raceProgress(kart, track) });
      break;
    case 'rush':
      kart.star = 7;
      kart.spin = 0;
      audio.play('rush');
      break;
  }
  if (--heldUses <= 0) held = null;
  renderItemSlot();
}

// Something hit the local kart. Returns false if the hit was shrugged off.
function takeHit(kind) {
  if (kart.star > 0) return false;
  if (kart.shield > 0) {
    kart.shield = 0;
    audio.play('pop');
    return false;
  }
  const spin = { oil: 1.0, rocket: 1.2, homing: 1.2, seeker: 1.6, rush: 1.0, thunder: 0.6 }[kind] || 1;
  const pop = { rocket: 7, homing: 7, seeker: 10, rush: 5 }[kind] || 0;
  kart.spin = Math.max(kart.spin, spin);
  if (pop) {
    kart.vy = pop;
    kart.grounded = false;
  }
  if (kind === 'thunder') kart.shrink = 3;
  kart.coins = Math.max(0, kart.coins - 3);
  audio.play(kind === 'oil' || kind === 'thunder' ? 'spin' : 'boom');
  return true;
}

function checkItemHits() {
  for (const t of world.hitsOn(kart, myId())) {
    takeHit(t.kind);
    world.remove(t.id, t.kind !== 'oil');
    const boom = t.kind === 'seeker' ? { x: kart.x, z: kart.z, y: kart.ground } : null;
    room?.sendEvent({ k: 'hit', id: t.id, boom });
  }
  // Touching a racer in Rainbow Rush knocks you flying
  for (const r of racers.values()) {
    const o = r.state;
    if (o.star && Math.hypot(kart.x - o.x, kart.z - o.z) < 2.8 && kart.spin <= 0) takeHit('rush');
  }
}

function checkBoom(b) {
  if (Math.hypot(kart.x - b.x, kart.z - b.z) < 8 && Math.abs(kart.ground - b.y) < 4) takeHit('seeker');
}

function onItemEvent(ev) {
  switch (ev.k) {
    case 'box':
      boxes.take(ev.i);
      break;
    case 'coin':
      coins.take(ev.i);
      break;
    case 'roll':
      if (room?.isHost) room.sendEvent({ k: 'rolled', item: director.grant(ev) }, ev.from);
      break;
    case 'rolled':
      if (rollActive) rollResult = ev.item;
      break;
    case 'spawn':
      world.spawn(ev.spec);
      break;
    case 'hit': {
      const t = world.remove(ev.id, true);
      if (t && t.kind !== 'oil' && Math.hypot(t.x - kart.x, t.z - kart.z) < 60) audio.play('boom');
      if (ev.boom && phase !== 'menu') checkBoom(ev.boom);
      break;
    }
    case 'thunder':
      if (phase === 'menu') break;
      flash();
      audio.play('thunder');
      if (raceProgress(kart, track) > ev.progress && myFinish == null) takeHit('thunder');
      break;
  }
}

let flashTimer;
function flash() {
  $('flash').classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => $('flash').classList.remove('on'), 120);
}

// Slipstream: tuck in behind another kart to charge a short burst of speed.
function updateDraft(dt) {
  let tucked = false;
  if (kart.slip <= 0 && kart.speed > 15 && kart.spin <= 0) {
    for (const r of racers.values()) {
      const o = r.state;
      if (!(o.speed > 15) || Math.abs(o.ground - kart.ground) > 2) continue;
      const fx = Math.sin(o.heading);
      const fz = Math.cos(o.heading);
      const dx = kart.x - o.x;
      const dz = kart.z - o.z;
      const behind = -(dx * fx + dz * fz);
      const lateral = Math.abs(dx * fz - dz * fx);
      if (behind > 2 && behind < 20 && lateral < 3) tucked = true;
    }
  }
  if (tucked) {
    kart.draftCharge += dt;
    if (kart.draftCharge >= DRAFT_CHARGE) {
      kart.slip = DRAFT_BURST;
      kart.draftCharge = 0;
      audio.play('slip');
    }
  } else kart.draftCharge = Math.max(0, kart.draftCharge - dt);
}

function updateItems(dt) {
  world.update(dt, stateOf);
  if (phase === 'menu' || phase === 'countdown') return;
  const box = boxes.touching(kart);
  if (box >= 0) {
    boxes.take(box);
    room?.sendEvent({ k: 'box', i: box });
    audio.play('box');
    if (!held && !rollActive && phase === 'racing') startRoll();
  }
  const coin = coins.touching(kart);
  if (coin >= 0) {
    coins.take(coin);
    room?.sendEvent({ k: 'coin', i: coin });
    kart.coins = Math.min(TUNING.maxCoins, kart.coins + 1);
    audio.play('coin');
  }
  updateRoll(dt);
  if ((input.consume('KeyE') | input.consume('KeyF')) && held && phase === 'racing' && kart.spin <= 0) useItem();
  checkItemHits();
  if (phase === 'racing') updateDraft(dt);
}

// --- Camera ---------------------------------------------------------------------
let camHeading = 0;
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();

function placeCamera(blend, s = kart) {
  const back = 7.5 + Math.min(2, Math.max(0, s.speed) / 15);
  const h = Math.sin(camHeading);
  const c = Math.cos(camHeading);
  // When the kart falls off the track the camera stays at road height and watches it drop
  const lift = Math.max(0, s.y) * 0.9;
  const target = new THREE.Vector3(s.x - h * back, s.ground + 3.3 + lift, s.z - c * back);
  camPos.lerp(target, blend);
  camera.position.copy(camPos);
  lookAt.set(s.x + h * 4, s.ground + 1.4 + Math.max(-12, s.y) * 0.9, s.z + c * 4);
  camera.lookAt(lookAt);
  const fov = 66 + (s.boost > 0 ? 10 : 0) + Math.max(0, s.speed) * 0.12;
  camera.fov += (fov - camera.fov) * Math.min(1, blend * 0.6);
  camera.updateProjectionMatrix();
}

function updateCamera(dt, s) {
  let diff = s.heading - camHeading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  camHeading += diff * Math.min(1, dt * 5);
  placeCamera(1 - Math.exp(-dt * 10), s);
}

// --- HUD ------------------------------------------------------------------------
function fmt(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

let toastTimer = 0;
function toast(text, seconds = 1.6) {
  $('toast').textContent = text;
  $('toast').classList.add('show');
  toastTimer = seconds;
}

let songTimer;
function nowPlaying(song) {
  $('now-playing').textContent = `♪ Now playing: ${song}`;
  $('now-playing').classList.add('show');
  clearTimeout(songTimer);
  songTimer = setTimeout(() => $('now-playing').classList.remove('show'), 4000);
}

function showCount(text) {
  const el = $('countdown');
  el.textContent = text;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

const minimap = $('minimap').getContext('2d');
const mapBase = document.createElement('canvas');
let mapTransform;
function drawMapBase() {
  const size = 180;
  mapBase.width = mapBase.height = size;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of track.points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const scale = (size - 30) / Math.max(maxX - minX, maxZ - minZ);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // Flip x so the map matches what the driver sees looking down from above.
  mapTransform = (x, z) => [size / 2 - (x - cx) * scale, size / 2 - (z - cz) * scale];
  const ctx = mapBase.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const paths = [track, ...track.branches];
  for (const [pad, color] of [[6, 'rgba(29,27,58,0.8)'], [0, null]]) {
    for (const path of paths) {
      ctx.beginPath();
      path.points.forEach((p, i) => {
        const [x, y] = mapTransform(p.x, p.z);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      if (path.closed) ctx.closePath();
      ctx.lineWidth = (path.halfWidth * 2) * scale + pad;
      ctx.strokeStyle = color || (path.surface === 'dirt' ? '#d9b78a' : '#fff8e7');
      ctx.stroke();
    }
  }
  const [sx, sy] = mapTransform(track.points[0].x, track.points[0].z);
  ctx.fillStyle = '#1d1b3a';
  ctx.fillRect(sx - 6, sy - 2, 12, 4);
}

function updateHud() {
  const lap = Math.min(Math.max(kart.lap, 1), track.laps);
  $('lap').textContent = lap;
  $('time').textContent = fmt(raceTime);
  $('speed').textContent = Math.round(Math.abs(kart.speed) * 3.6);
  $('coins').textContent = kart.coins;
  $('lap-times').innerHTML = lapTimes
    .map((t, i) => `<div class="${t === bestLap ? 'best' : ''}">Lap ${i + 1} · ${fmt(t)}</div>`)
    .join('');

  const lvl = kart.drifting ? driftLevel(kart.driftCharge) : 0;
  const max = TUNING.driftLevels[2];
  const fill = kart.drifting ? Math.min(1, kart.driftCharge / max) : 0;
  $('drift-fill').style.width = `${fill * 100}%`;
  $('drift-fill').style.background = ['#9a97b8', '#3fb6ff', '#ff8a1f', '#d36bff'][lvl];

  minimap.clearRect(0, 0, 180, 180);
  minimap.drawImage(mapBase, 0, 0);
  const dots = [...[...racers.values()].map((r) => [r.state, r.color, 5]), [kart, profile.color, 7]];
  for (const [s, color, radius] of dots) {
    const [x, y] = mapTransform(s.x, s.z);
    minimap.beginPath();
    minimap.arc(x, y, radius, 0, Math.PI * 2);
    minimap.fillStyle = color;
    minimap.fill();
    minimap.lineWidth = 2.5;
    minimap.strokeStyle = '#fff';
    minimap.stroke();
  }

  if (mode === 'online' && phase !== 'countdown') {
    const place = standings().findIndex((x) => x.me) + 1;
    const text = ordinal(place);
    $('place').innerHTML = `${place}<small>${text.slice(String(place).length)}</small>`;
  }
}

function showResults() {
  const total = lapTimes.reduce((a, b) => a + b, 0);
  $('again-btn').textContent = mode === 'solo' ? 'Race again' : 'Back to lobby';
  const esc = (t) => String(t).replace(/[<>&"]/g, '');
  const table =
    mode === 'online'
      ? '<div class="standings">' +
        standings()
          .map(
            (p, i) =>
              `<div class="row ${p.me ? 'me' : ''}"><span class="who">${ordinal(i + 1)} <span class="dot" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${p.color}"></span> ${esc(p.name)}</span><span>${p.finish != null ? fmt(p.finish) : 'racing…'}</span></div>`,
          )
          .join('') +
        '</div><hr />'
      : '';
  $('results-body').innerHTML =
    table +
    `<div class="total">${fmt(total)}</div>` +
    lapTimes
      .map((t, i) => `<div class="row ${t === bestLap ? 'best' : ''}"><span>Lap ${i + 1}</span><span>${fmt(t)}</span></div>`)
      .join('') +
    (bestLap ? `<div class="row best"><span>Best ever</span><span>${fmt(bestLap)}</span></div>` : '');
  showScreen('results');
}

// --- Main loop ------------------------------------------------------------------
function handleEvents() {
  for (const e of kart.events) {
    if (e === 'lap') {
      if (kart.lap === 1) {
        lapStart = raceTime;
        continue;
      }
      const t = raceTime - lapStart;
      lapStart = raceTime;
      lapTimes.push(t);
      if (!bestLap || t < bestLap) {
        bestLap = t;
        saveBest(t);
      }
      if (kart.lap > track.laps) {
        myFinish = raceTime;
        room?.sendFinish(raceTime);
        room?.sendState(packState(kart));
        phase = 'finished';
        finishedAt = performance.now();
        audio.play('finish');
        toast('FINISH!', 2.5);
      } else {
        audio.play('lap');
        toast(kart.lap === track.laps ? 'FINAL LAP!' : `LAP ${kart.lap}`);
      }
    } else audio.play(e);
  }
  kart.events.length = 0;
}

let accumulator = 0;
let last = performance.now();
let elapsed = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  elapsed += dt;

  if (input.consume('KeyM')) toast(audio.toggleMute() ? 'Sound off' : 'Sound on', 1);
  if (input.consume('KeyN') && phase !== 'menu') nowPlaying(audio.nextSong());
  if (input.consume('Minus') || input.consume('NumpadSubtract')) setVolume(audio.musicLevel - 0.1, true);
  if (input.consume('Equal') || input.consume('NumpadAdd')) setVolume(audio.musicLevel + 0.1, true);
  audio.setEngineActive(phase !== 'menu' && $('results').classList.contains('hidden'));

  if (phase !== 'menu') {
    const raw = input.read(dt);
    let controls = raw;

    if (phase === 'countdown') {
      countdown -= dt;
      const n = Math.ceil(countdown);
      if (n !== lastCount && n <= 3) {
        lastCount = n;
        if (n > 0) {
          showCount(String(n));
          audio.play('count');
        } else {
          showCount('GO!');
          audio.play('go');
          phase = 'racing';
          setTimeout(() => ($('countdown').textContent = ''), 700);
        }
        startLights.forEach((l, i) => l?.material.color.set(n <= 0 ? '#3cff6a' : i < 3 - n + 1 ? '#ff3b30' : '#552222'));
      }
    }
    // Coast to a stop after the finish. Braking at a standstill would reverse the kart.
    if (phase === 'finished') controls = { throttle: 0, brake: kart.speed > 0.5 ? 0.3 : 0, steer: 0, drift: false };
    if (phase === 'racing') {
      raceTime += dt;
      if (input.consume('KeyR')) respawn(kart, track);
    }
    if (phase === 'finished' && performance.now() - finishedAt > 2500 && $('results').classList.contains('hidden')) {
      showResults();
    }

    accumulator += dt;
    while (accumulator >= PHYSICS_DT) {
      Object.assign(prev, { x: kart.x, z: kart.z, y: kart.y, ground: kart.ground, heading: kart.heading });
      stepKart(kart, controls, PHYSICS_DT, track, { frozen: phase === 'countdown' });
      if (racers.size) bumpKarts();
      accumulator -= PHYSICS_DT;
    }
    handleEvents();

    for (const r of racers.values()) updateRemote(r, dt);
    updateItems(dt);
    if (room) {
      sendTimer += dt;
      if (sendTimer >= SEND_INTERVAL) {
        sendTimer = 0;
        room.sendState(packState(kart));
      }
    }

    // Draw the kart between its last two physics steps so motion is smooth at any frame rate
    const a = accumulator / PHYSICS_DT;
    const view = {
      ...kart,
      x: prev.x + (kart.x - prev.x) * a,
      z: prev.z + (kart.z - prev.z) * a,
      y: prev.y + (kart.y - prev.y) * a,
      ground: prev.ground + (kart.ground - prev.ground) * a,
      heading: lerpAngle(prev.heading, kart.heading, a),
    };
    kartView.update(view, dt, controls.steer);
    updateCamera(dt, view);
    updateHud();
    audio.setEngine(kart.speed, kart.boost > 0);
  } else {
    // Slow orbit around the castle behind the menu
    const a = elapsed * 0.08;
    const f = level.focus;
    camera.position.set(f.x + Math.cos(a) * 260, 110, f.z + Math.sin(a) * 260);
    camera.lookAt(f.x, 20, f.z);
  }

  if (toastTimer > 0 && (toastTimer -= dt) <= 0) $('toast').classList.remove('show');

  track.update(elapsed);
  boxes.update(elapsed, dt);
  coins.update(elapsed, dt);
  for (const w of wavers) w.rotation.y = Math.sin(elapsed * 3 + w.id) * 0.25;
  for (const o of spinners) o.rotation.z = elapsed * o.userData.spin;
  for (const o of blinkers) o.visible = Math.sin(elapsed * 6 + o.userData.blink) > -0.3;
  if (clouds) clouds.rotation.y = elapsed * 0.004;

  // Move the shadow area with the kart in whole shadow-map texels (measured from the sun's
  // point of view) so shadow edges don't crawl and shimmer at speed
  const focus = phase === 'menu' ? level.focus.clone() : new THREE.Vector3(kart.x, kart.ground, kart.z);
  const texel = (SHADOW_SIZE * 2) / sun.shadow.mapSize.x;
  const u = Math.round(focus.dot(LIGHT_RIGHT) / texel) * texel;
  const v = Math.round(focus.dot(LIGHT_UP) / texel) * texel;
  const w = focus.dot(LIGHT_DIR);
  focus.copy(LIGHT_RIGHT).multiplyScalar(u).addScaledVector(LIGHT_UP, v).addScaledVector(LIGHT_DIR, w);
  sun.position.copy(focus).add(SUN_OFFSET);
  sun.target.position.copy(focus);

  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.render(scene, camera);
  if (phase !== 'menu' && !$('hud').classList.contains('hidden')) renderMirror();
  requestAnimationFrame(frame);
}

function renderMirror() {
  const el = $('mirror');
  const rect = el.getBoundingClientRect();
  const b = el.clientLeft;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (w < 10) return;
  const x = rect.left + b;
  const y = window.innerHeight - (rect.top + b) - h;
  const fx = Math.sin(kart.heading);
  const fz = Math.cos(kart.heading);
  const top = kart.ground + kart.y;
  mirrorCam.position.set(kart.x - fx * 0.6, top + 3.3, kart.z - fz * 0.6);
  mirrorCam.lookAt(kart.x - fx * 30, top + 1.2, kart.z - fz * 30);
  mirrorCam.aspect = w / h;
  mirrorCam.updateProjectionMatrix();
  renderer.setScissorTest(true);
  renderer.setScissor(x, y, w, h);
  renderer.setViewport(x, y, w, h);
  renderer.shadowMap.autoUpdate = false; // reuse the shadows from the main view
  renderer.render(scene, mirrorCam);
  renderer.shadowMap.autoUpdate = true;
  renderer.setScissorTest(false);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Track picker ---------------------------------------------------------------------
// Solo players pick freely; online, only the host picks and everyone else sees the choice.
let chosenTrack = 'castle';
try {
  chosenTrack = localStorage.getItem('track') || 'castle';
} catch {
  /* storage unavailable */
}
function pickTrack(id) {
  chosenTrack = id;
  try {
    localStorage.setItem('track', id);
  } catch {
    /* storage unavailable */
  }
  if (room?.isHost) room.setTrack(id);
  loadLevel(id);
}
function renderTrackPickers() {
  const current = room ? room.track : chosenTrack;
  for (const el of document.querySelectorAll('.track-pick')) {
    if (!el.children.length) {
      for (const [id, t] of Object.entries(TRACKS)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.track = id;
        b.setAttribute('role', 'radio');
        b.textContent = t.name;
        b.addEventListener('click', () => pickTrack(id));
        el.appendChild(b);
      }
    }
    for (const b of el.children) {
      b.setAttribute('aria-checked', String(b.dataset.track === current));
      b.disabled = !!room && !room.isHost;
    }
  }
}
loadLevel(chosenTrack);

kart = createKartState(track.gridSlot(0));
kartView.color = profile.color;
kartView.update(kart, 0, 0);

// Opened from an invite link?
const invite = new URLSearchParams(location.search).get('room');
if (invite && /^[A-Za-z0-9]{5}$/.test(invite)) {
  $('invite-code').textContent = invite.toUpperCase();
  $('join-invite').classList.remove('hidden');
  $('code-input').value = invite.toUpperCase();
}
requestAnimationFrame(frame);

// Handy for debugging from the browser console.
window.__game = { get kart() { return kart; }, get time() { return raceTime; }, camera, get track() { return track; }, racers, audio,
  get world() { return world; }, get boxes() { return boxes; }, get coins() { return coins; }, loadLevel,
  coinsHidden: () => coins.coins.filter((c) => c.respawn > 0).length,
  give(id) { held = id; heldUses = ITEMS[id].uses; renderItemSlot(); }, get room() { return room; } };
