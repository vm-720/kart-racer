import * as THREE from 'three';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { KartView } from './kart.js';
import { createKartState, stepKart, respawn, driftLevel, raceProgress, TUNING } from './physics.js';
import { Room, MAX_PLAYERS, KART_COLORS, packState, unpackState } from './net.js';
import { buildCastleTrack } from './tracks/castle.js';
import { skyTexture, toonGradient } from './textures.js';

const PHYSICS_DT = 1 / 120;
const SEND_INTERVAL = 1 / 20; // seconds between network updates
const REMOTE_DELAY = 0.12; // render other karts slightly in the past so motion stays smooth
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

scene.add(new THREE.HemisphereLight('#cfe8ff', '#6a9a4a', 1.4));
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
const level = buildCastleTrack(gradientMap);
const track = level.track;
scene.add(level.scene);
scene.fog = new THREE.Fog(level.fog.color, level.fog.near, level.fog.far);

const startLights = [0, 1, 2].map((i) => scene.getObjectByName(`start-light-${i}`));
const wavers = [];
scene.traverse((o) => o.userData.wave && wavers.push(o));
const clouds = scene.getObjectByName('clouds');

const input = new Input();
const audio = new Audio();

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
    .on('start', (players) => beginOnlineRace(players))
    .on('state', (id, s) => receiveState(id, s))
    .on('finish', (id, time) => {
      const r2 = racers.get(id);
      if (r2) r2.finish = time;
      if (phase === 'finished') showResults();
    })
    .on('left', (id) => removeRacer(id))
    .on('closed', (reason) => backToMenu(reason));
}

$('create-btn').addEventListener('click', () =>
  withBusy($('create-btn'), async () => {
    audio.start();
    showMenuError('');
    try {
      wireRoom(await Room.host({ name: displayName(), color: profile.color }));
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

function beginOnlineRace(players) {
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

// --- Camera ---------------------------------------------------------------------
let camHeading = 0;
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();

function placeCamera(blend, s = kart) {
  const back = 7.5 + Math.min(2, Math.max(0, s.speed) / 15);
  const h = Math.sin(camHeading);
  const c = Math.cos(camHeading);
  const target = new THREE.Vector3(s.x - h * back, s.ground + 3.3 + s.y * 0.5, s.z - c * back);
  camPos.lerp(target, blend);
  camera.position.copy(camPos);
  lookAt.set(s.x + h * 4, s.ground + 1.4 + s.y * 0.6, s.z + c * 4);
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
(function drawMapBase() {
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
  for (const [w, color] of [[track.width * scale + 6, 'rgba(29,27,58,0.8)'], [track.width * scale, '#fff8e7']]) {
    ctx.beginPath();
    track.points.forEach((p, i) => {
      const [x, y] = mapTransform(p.x, p.z);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  const [sx, sy] = mapTransform(track.points[0].x, track.points[0].z);
  ctx.fillStyle = '#1d1b3a';
  ctx.fillRect(sx - 6, sy - 2, 12, 4);
})();

function updateHud() {
  const lap = Math.min(Math.max(kart.lap, 1), track.laps);
  $('lap').textContent = lap;
  $('time').textContent = fmt(raceTime);
  $('speed').textContent = Math.round(Math.abs(kart.speed) * 3.6);
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
    if (phase === 'finished') controls = { throttle: 0, brake: 0.3, steer: 0, drift: false };
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
  for (const w of wavers) w.rotation.y = Math.sin(elapsed * 3 + w.id) * 0.25;
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

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

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
window.__game = { get kart() { return kart; }, track, racers, get room() { return room; } };
