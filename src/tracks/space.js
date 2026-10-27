import * as THREE from 'three';
import { Track } from '../track.js';
import { deckTexture, metalTexture, checkerTexture } from '../textures.js';

// Star Station: a floating circuit high above a ringed planet. Parts of it have no
// rails, so a sloppy line drops you off the edge until the rescue drone fetches you.
// A jump pad launches you across a gap in the road in low gravity.

// Control points as [x, z, height]. The loop runs east from the start line, climbs
// over the station's crown, swings round the far hairpin and comes home down the west side.
const CONTROL = [
  [-170, -170, 40], [0, -178, 40], [128, -170, 42], // launch straight
  [204, -127, 46], [213, -51, 50], [170, 0, 54], // climbing right-hander
  [85, 17, 60], [17, -17, 64], [-51, 9, 62], [-68, 77, 58], [-17, 128, 54], // over the crown
  [85, 145, 52], [187, 145, 52], // back straight
  [247, 187, 50], [238, 255, 46], [170, 272, 42], // far hairpin
  [43, 272, 40], [-102, 255, 38], // jump straight
  [-195, 230, 38], [-221, 153, 40], [-212, 51, 42], // open-edge run
  [-229, -51, 40], [-221, -136, 40], [-195, -174, 40], // final corner
];
export const STATION_POS = new THREE.Vector3(10, 0, 60);

function buildCenterLine() {
  const curve = new THREE.CatmullRomCurve3(
    CONTROL.map(([x, z, y]) => new THREE.Vector3(x, y, z)),
    true,
    'centripetal',
  );
  const N = 4000;
  let pts = [];
  for (let i = 0; i < N; i++) pts.push(curve.getPointAt(i / N));
  for (let k = 0; k < 30; k++) {
    pts = pts.map((p, i) =>
      p.clone().multiplyScalar(0.5).addScaledVector(pts[(i + N - 8) % N], 0.25).addScaledVector(pts[(i + 8) % N], 0.25),
    );
  }
  return (u) => {
    const f = (u % 1) * N;
    const i = Math.floor(f);
    return pts[i % N].clone().lerp(pts[(i + 1) % N], f - i);
  };
}

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function buildSpaceTrack(gradientMap) {
  const track = new Track({
    name: 'Star Station',
    centerLine: buildCenterLine(),
    width: 20,
    runoff: 3,
    wallHeight: 1.2,
    laps: 3,
    theme: { road: deckTexture, runoff: metalTexture, curbs: ['#3fd8ff', '#f4f7ff'], rails: true, floating: true },
    openEdges: [
      { from: 0.3, to: 0.37, side: 1 }, // outside of the bend over the crown
      { from: 0.545, to: 0.6, side: -1 }, // outside of the far hairpin
      { from: 0.85, to: 0.9, side: 0 }, // no rails at all down the west side
    ],
    jumpPads: [{ at: 0.655 }],
    gaps: [{ from: 0.668, to: 0.684 }],
    boostPads: [
      { at: 0.05, offset: 0 },
      { at: 0.47, offset: -4 },
      { at: 0.83, offset: 3 },
    ],
    ramps: [{ at: 0.93, offset: -4, width: 9 }],
  });

  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap, ...extra });
  const scene = new THREE.Group();
  scene.add(track.group);
  scene.add(buildStartGantry(track, toon));
  scene.add(buildStation(toon));
  scene.add(buildPlanets(toon));
  scene.add(buildAsteroids(track, toon));
  scene.add(buildBeacons(track));

  const coinLines = [
    { at: 0.1, count: 5 },
    { at: 0.32, offset: 5, count: 5 }, // tempting line near the open edge
    { at: 0.5, offset: 4 },
    { at: 0.672, count: 5, height: 8 }, // over the gap
    { at: 0.87, offset: -5, count: 5 },
    { at: 0.925, offset: -4, count: 4 }, // up the kicker
  ];

  return {
    track,
    scene,
    name: 'Star Station',
    itemRows: [0.08, 0.42, 0.62, 0.79],
    coinLines,
    focus: STATION_POS.clone().setY(45),
    fog: { color: '#0b0a26', near: 380, far: 1700 },
    sky: 'stars',
    hemi: ['#b8c8ff', '#2a1d4a', 1.5],
    sun: ['#fff1e0', 2.2],
  };
}

function buildStartGantry(track, toon) {
  const g = new THREE.Group();
  const c = track.point(0);
  const t = track.tangents[0];
  const span = track.wallOffset * 2 + 2;
  const postMat = toon('#c9d2ff');
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, 11, 1.2), postMat);
    post.position.set(0, 5.5 - 1.6, (s * span) / 2);
    post.castShadow = true;
    g.add(post);
  }
  const tex = checkerTexture();
  tex.repeat.set(span / 2, 1);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(1, 2.5, span), toon('#ffffff', { map: tex }));
  banner.position.y = 10;
  banner.castShadow = true;
  g.add(banner);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, span), new THREE.MeshBasicMaterial({ color: '#3fd8ff' }));
  glow.position.y = 8.6;
  g.add(glow);
  for (let i = 0; i < 3; i++) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: '#552222' }));
    light.position.set(0.7, 10, (i - 1) * 2.2);
    light.name = `start-light-${i}`;
    g.add(light);
  }
  g.position.set(c.x, c.y, c.z);
  g.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
  return g;
}

// The space station the circuit loops around: a hub, a spinning ring and solar panels.
function buildStation(toon) {
  const g = new THREE.Group();
  const hull = toon('#d9def5');
  const dark = toon('#4a4f78');
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 40, 24), hull);
  g.add(hub);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon('#9fe9ff'));
  dome.position.y = 20;
  g.add(dome);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(46, 4, 10, 48), hull);
  ring.rotation.x = Math.PI / 2;
  ring.userData.spin = 0.08;
  g.add(ring);
  for (let k = 0; k < 4; k++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(92, 2, 2), dark);
    spoke.rotation.z = (k * Math.PI) / 4; // the ring is tipped flat, so this spins the spoke in its plane
    ring.add(spoke);
  }
  const windows = new THREE.MeshBasicMaterial({ color: '#ffe38a' });
  for (let k = 0; k < 16; k++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.3), windows);
    const a = (k / 16) * Math.PI * 2;
    w.position.set(Math.cos(a) * 14.1, 8 + (k % 2) * 6, Math.sin(a) * 14.1);
    w.rotation.y = -a + Math.PI / 2;
    g.add(w);
  }
  const panelMat = toon('#2c4fd6');
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 50, 8), dark);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(s * 25, -12, 0);
    g.add(arm);
    for (let k = 0; k < 2; k++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(22, 0.6, 14), panelMat);
      panel.position.set(s * (32 + k * 24), -12, 0);
      g.add(panel);
    }
  }
  g.position.copy(STATION_POS).setY(30);
  g.name = 'station';
  return g;
}

function buildPlanets(toon) {
  const g = new THREE.Group();
  // A big ringed planet far below the track
  const planet = new THREE.Mesh(new THREE.SphereGeometry(260, 48, 32), toon('#ff8a5c', { fog: false }));
  planet.position.set(250, -420, 650);
  g.add(planet);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(330, 470, 96),
    new THREE.MeshBasicMaterial({ color: '#ffd9a8', transparent: true, opacity: 0.55, side: THREE.DoubleSide, fog: false }),
  );
  ring.position.copy(planet.position);
  ring.rotation.set(-Math.PI / 2 + 0.35, 0, 0.25);
  g.add(ring);
  // A small moon and a distant blue world
  const moon = new THREE.Mesh(new THREE.SphereGeometry(55, 32, 20), toon('#c8c3e0', { fog: false }));
  moon.position.set(-700, 180, -500);
  g.add(moon);
  const blue = new THREE.Mesh(new THREE.SphereGeometry(110, 32, 20), toon('#4aa8ff', { fog: false }));
  blue.position.set(-500, -150, 900);
  g.add(blue);
  return g;
}

function buildAsteroids(track, toon) {
  const rand = rng(11);
  const spots = [];
  while (spots.length < 140) {
    const a = rand() * Math.PI * 2;
    const r = 60 + rand() * 600;
    const p = new THREE.Vector3(Math.cos(a) * r, -80 + rand() * 200, Math.sin(a) * r);
    const q = track.query(p);
    const near = Math.abs(q.offset) < track.wallOffset + 25;
    if (near && Math.abs(p.y - track.point(q.index).y) < 30) continue;
    if (p.distanceTo(STATION_POS.clone().setY(30)) < 70) continue;
    spots.push(p);
  }
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), toon('#8a7f9e'), spots.length);
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  spots.forEach((p, i) => {
    const s = 2 + rand() ** 2 * 14;
    quat.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
    m.compose(p, quat, new THREE.Vector3(s, s * (0.6 + rand() * 0.5), s * (0.7 + rand() * 0.5)));
    mesh.setMatrixAt(i, m);
  });
  mesh.name = 'asteroids';
  return mesh;
}

// Blinking beacons on poles along the open edges, so the danger is easy to spot.
function buildBeacons(track) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#ff9f1c' });
  const geo = new THREE.SphereGeometry(0.5, 10, 8);
  const N = track.sampleCount;
  for (let i = 0; i < N; i += 30) {
    for (const side of [-1, 1]) {
      if (track.hasWall(i, side) || track.gap[i]) continue;
      const c = track.point(i).clone().addScaledVector(track.sides[i], side * (track.wallOffset + 0.6));
      const b = new THREE.Mesh(geo, mat);
      b.position.set(c.x, c.y - 1, c.z);
      b.userData.blink = i * 0.37;
      g.add(b);
    }
  }
  g.name = 'beacons';
  return g;
}
