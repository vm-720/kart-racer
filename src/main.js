import * as THREE from 'three';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { KartView } from './kart.js';
import { createKartState, stepKart, respawn, driftLevel, TUNING } from './physics.js';
import { buildCastleTrack } from './tracks/castle.js';
import { skyTexture, toonGradient } from './textures.js';

const PHYSICS_DT = 1 / 120;
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
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2500);

scene.add(new THREE.HemisphereLight('#cfe8ff', '#6a9a4a', 1.4));
const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(80, 140, 50);

const gradientMap = toonGradient();
const level = buildCastleTrack(gradientMap);
const track = level.track;
scene.add(level.scene);
scene.fog = new THREE.Fog(level.fog.color, level.fog.near, level.fog.far);

const startLights = [0, 1, 2].map((i) => scene.getObjectByName(`start-light-${i}`));
const wavers = [];
scene.traverse((o) => o.userData.wave && wavers.push(o));
const clouds = scene.getObjectByName('clouds');

const kartView = new KartView({ color: '#e8433f', gradientMap });
scene.add(kartView.group, kartView.effects);

const input = new Input();
const audio = new Audio();

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

function resetRace() {
  kart = createKartState(track.gridSlot(0));
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
  $('hud').classList.remove('hidden');
  input.showTouch(true);
}

function startRace() {
  audio.start();
  resetRace();
  nowPlaying(audio.nextSong());
}
$('start-btn').addEventListener('click', startRace);
$('again-btn').addEventListener('click', startRace);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && phase === 'menu') startRace();
  if (e.code === 'Enter' && phase === 'finished' && !$('results').classList.contains('hidden')) startRace();
});

// --- Camera ---------------------------------------------------------------------
let camHeading = 0;
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();

function placeCamera(blend) {
  const s = kart;
  const back = 7.5 + Math.min(2, Math.max(0, s.speed) / 15);
  const h = Math.sin(camHeading);
  const c = Math.cos(camHeading);
  const target = new THREE.Vector3(s.x - h * back, 3.3 + s.y * 0.5, s.z - c * back);
  camPos.lerp(target, blend);
  camera.position.copy(camPos);
  lookAt.set(s.x + h * 4, 1.4 + s.y * 0.6, s.z + c * 4);
  camera.lookAt(lookAt);
  const fov = 68 + (s.boost > 0 ? 10 : 0) + Math.max(0, s.speed) * 0.12;
  camera.fov += (fov - camera.fov) * Math.min(1, blend * 1.5);
  camera.updateProjectionMatrix();
}

function updateCamera(dt) {
  let diff = kart.heading - camHeading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  camHeading += diff * Math.min(1, dt * 5);
  placeCamera(1 - Math.exp(-dt * 10));
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
  const [x, y] = mapTransform(kart.x, kart.z);
  minimap.beginPath();
  minimap.arc(x, y, 6, 0, Math.PI * 2);
  minimap.fillStyle = '#e8433f';
  minimap.fill();
  minimap.lineWidth = 2.5;
  minimap.strokeStyle = '#fff';
  minimap.stroke();
}

function showResults() {
  const total = lapTimes.reduce((a, b) => a + b, 0);
  $('results-body').innerHTML =
    `<div class="total">${fmt(total)}</div>` +
    lapTimes
      .map((t, i) => `<div class="row ${t === bestLap ? 'best' : ''}"><span>Lap ${i + 1}</span><span>${fmt(t)}</span></div>`)
      .join('') +
    (bestLap ? `<div class="row best"><span>Best ever</span><span>${fmt(bestLap)}</span></div>` : '');
  $('results').classList.remove('hidden');
  input.showTouch(false);
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
      stepKart(kart, controls, PHYSICS_DT, track, { frozen: phase === 'countdown' });
      accumulator -= PHYSICS_DT;
    }
    handleEvents();

    kartView.update(kart, dt, controls.steer);
    updateCamera(dt);
    updateHud();
    audio.setEngine(kart.speed, kart.boost > 0);
  } else {
    // Slow orbit around the castle behind the menu
    const a = elapsed * 0.08;
    camera.position.set(Math.cos(a) * 200, 70, Math.sin(a) * 200);
    camera.lookAt(0, 10, 0);
  }

  if (toastTimer > 0 && (toastTimer -= dt) <= 0) $('toast').classList.remove('show');

  track.update(elapsed);
  for (const w of wavers) w.rotation.y = Math.sin(elapsed * 3 + w.id) * 0.25;
  if (clouds) clouds.rotation.y = elapsed * 0.004;

  const focus = phase === 'menu' ? new THREE.Vector3() : new THREE.Vector3(kart.x, 0, kart.z);
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
kartView.update(kart, 0, 0);
requestAnimationFrame(frame);

// Handy for debugging from the browser console.
window.__game = { get kart() { return kart; }, track };
