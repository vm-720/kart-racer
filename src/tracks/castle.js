import * as THREE from 'three';
import { Track } from '../track.js';
import { flagTexture, grassTexture, stoneTexture, checkerTexture } from '../textures.js';

// Castle Cloverleaf: a four-leaf loop wrapped around a storybook castle.

const R = 130; // average radius of the loop
const LOBES = 4;
const LOBE_DEPTH = 0.22;

function centerLine(u) {
  const a = u * Math.PI * 2;
  const r = R * (1 + LOBE_DEPTH * Math.cos(LOBES * a));
  return new THREE.Vector3(r * Math.cos(a), 0, r * Math.sin(a));
}

// Small seeded random so the scenery is identical for every player.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function buildCastleTrack(gradientMap) {
  const track = new Track({
    name: 'Castle Cloverleaf',
    centerLine,
    width: 20,
    runoff: 7,
    wallHeight: 1.4,
    laps: 3,
    boostPads: [
      { at: 0.0625 + 0.25, offset: 4 },
      { at: 0.0625 + 0.75, offset: -4 },
      { at: 0.0625 + 0.5, offset: 0 },
    ],
  });

  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap, ...extra });
  const scene = new THREE.Group();
  scene.add(track.group);

  // Ground
  const grass = grassTexture();
  grass.repeat.set(90, 90);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1200, 64), new THREE.MeshLambertMaterial({ map: grass }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  scene.add(buildCastle(toon));
  scene.add(buildStartGantry(track, toon));
  scene.add(buildTrees(track, toon));
  scene.add(buildHills(toon));
  scene.add(buildClouds());
  return { track, scene, name: 'Castle Cloverleaf', fog: { color: '#cfe9ff', near: 250, far: 900 } };
}

function crenellations(toon, width, depth, y, count, size = 1.6) {
  const g = new THREE.Group();
  const mat = toon('#cfc8dc');
  const geo = new THREE.BoxGeometry(size, size, size);
  const edges = [
    [width, 0, -depth / 2, 0],
    [width, 0, depth / 2, 0],
    [depth, -width / 2, 0, Math.PI / 2],
    [depth, width / 2, 0, Math.PI / 2],
  ];
  for (const [len, x, z, rot] of edges) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      const t = (i / (count - 1) - 0.5) * (len - size);
      m.position.set(x + Math.cos(rot) * t, y + size / 2, z + Math.sin(rot) * t);
      m.castShadow = true;
      g.add(m);
    }
  }
  return g;
}

function tower(toon, radius, height, roofColor, flagColor) {
  const g = new THREE.Group();
  const stone = stoneTexture();
  stone.repeat.set(3, height / 6);
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.08, height, 20),
    toon('#ffffff', { map: stone }),
  );
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const ring = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.2, radius * 1.2, 1.6, 20), toon('#cfc8dc'));
  ring.position.y = height;
  ring.castShadow = true;
  g.add(ring);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(radius * 1.35, radius * 2.6, 20), toon(roofColor));
  roof.position.y = height + 0.8 + radius * 1.3;
  roof.castShadow = true;
  g.add(roof);

  // Windows
  const winMat = toon('#2b2550');
  for (let i = 0; i < 3; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2, 0.4), winMat);
    const a = (i / 3) * Math.PI * 2 + 0.4;
    w.position.set(Math.cos(a) * radius, height * 0.7, Math.sin(a) * radius);
    w.lookAt(0, height * 0.7, 0);
    g.add(w);
  }

  if (flagColor) {
    const top = height + 0.8 + radius * 2.6;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 6), toon('#ffffff'));
    pole.position.y = top + 2.2;
    g.add(pole);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 2),
      toon('#ffffff', { map: flagTexture(flagColor), side: THREE.DoubleSide }),
    );
    flag.position.set(1.6, top + 3.6, 0);
    flag.userData.wave = true;
    g.add(flag);
  }
  return g;
}

function buildCastle(toon) {
  const g = new THREE.Group();

  // Moat with a stone rim
  const water = new THREE.Mesh(
    new THREE.RingGeometry(34, 44, 64),
    new THREE.MeshLambertMaterial({ color: '#3fb6ff', transparent: true, opacity: 0.9 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.08;
  g.add(water);
  const rim = new THREE.Mesh(new THREE.RingGeometry(44, 45.5, 64), toon('#cfc8dc'));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.1;
  g.add(rim);

  // Bridge to the gate (castle faces +x, toward the start line)
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(14, 0.8, 7), toon('#b07a4a'));
  bridge.position.set(39, 0.4, 0);
  bridge.receiveShadow = true;
  g.add(bridge);

  // Courtyard
  const yard = new THREE.Mesh(new THREE.CircleGeometry(34, 48), toon('#e8dcc0'));
  yard.rotation.x = -Math.PI / 2;
  yard.position.y = 0.09;
  g.add(yard);

  // Curtain walls
  const stone = stoneTexture();
  stone.repeat.set(8, 2);
  const W = 40;
  const wallH = 9;
  const wallMat = toon('#ffffff', { map: stone });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(W, wallH, 2.4), wallMat);
    wall.position.set(Math.cos(a) * (W / 2), wallH / 2, Math.sin(a) * (W / 2));
    wall.rotation.y = -a + Math.PI / 2;
    wall.castShadow = true;
    wall.receiveShadow = true;
    g.add(wall);
  }
  g.add(crenellations(toon, W + 2.4, W + 2.4, wallH, 11));

  // Gate
  const gate = new THREE.Mesh(new THREE.BoxGeometry(1, 6, 7), toon('#5a3a22'));
  gate.position.set(W / 2 + 0.8, 3, 0);
  g.add(gate);
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 1, 20, 1, false, 0, Math.PI), toon('#5a3a22'));
  arch.rotation.z = Math.PI / 2;
  arch.rotation.y = Math.PI / 2;
  arch.position.set(W / 2 + 0.8, 6, 0);
  g.add(arch);

  // Corner towers and the central keep
  const flags = ['#e8433f', '#3f7bff', '#e8433f', '#3f7bff'];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const t = tower(toon, 4.2, 16, '#e8433f', flags[i]);
    t.position.set(Math.cos(a) * (W / 2) * Math.SQRT2, 0, Math.sin(a) * (W / 2) * Math.SQRT2);
    g.add(t);
  }
  const keepStone = stoneTexture();
  keepStone.repeat.set(4, 3);
  const keep = new THREE.Mesh(new THREE.BoxGeometry(20, 18, 20), toon('#ffffff', { map: keepStone }));
  keep.position.y = 9;
  keep.castShadow = true;
  keep.receiveShadow = true;
  g.add(keep);
  g.add(crenellations(toon, 20, 20, 18, 7));
  const main = tower(toon, 5.5, 32, '#e8433f', '#ffc531');
  g.add(main);
  for (const [x, z] of [[-7, -7], [7, 7]]) {
    const t = tower(toon, 2.6, 24, '#3f7bff', null);
    t.position.set(x, 0, z);
    g.add(t);
  }

  // Stained-glass window facing the track
  const glass = new THREE.Mesh(new THREE.CircleGeometry(3, 24), new THREE.MeshBasicMaterial({ color: '#ffc531' }));
  glass.position.set(10.05, 12, 0);
  glass.rotation.y = Math.PI / 2;
  g.add(glass);
  return g;
}

function buildStartGantry(track, toon) {
  const g = new THREE.Group();
  const c = track.point(0);
  const t = track.tangents[0];
  const span = track.wallOffset * 2 + 2;
  const postMat = toon('#e8433f');
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 11, 12), postMat);
    post.position.set(0, 5.5, (s * span) / 2);
    post.castShadow = true;
    g.add(post);
  }
  const tex = checkerTexture();
  tex.repeat.set(span / 2, 1);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(1, 2.5, span), toon('#ffffff', { map: tex }));
  banner.position.y = 10;
  banner.castShadow = true;
  g.add(banner);
  // Countdown lights
  for (let i = 0; i < 3; i++) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: '#552222' }));
    light.position.set(0.7, 10, (i - 1) * 2.2);
    light.name = `start-light-${i}`;
    g.add(light);
  }
  g.position.set(c.x, 0, c.z);
  g.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
  return g;
}

function buildTrees(track, toon) {
  const rand = rng(7);
  const spots = [];
  while (spots.length < 260) {
    const a = rand() * Math.PI * 2;
    const r = 55 + rand() * 330;
    const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const q = track.query(p);
    if (Math.abs(q.offset) < track.wallOffset + 5) continue;
    spots.push(p);
  }

  const n = spots.length;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.7, 3, 6), toon('#8a5a34'), n);
  const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.8, 0), toon('#2f9e4f'), n);
  const tops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 0), toon('#46b85e'), n);
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  spots.forEach((p, i) => {
    const s = 0.8 + rand() * 0.8;
    scale.setScalar(s);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    m.compose(new THREE.Vector3(p.x, 1.5 * s, p.z), quat, scale);
    trunks.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x, 4.6 * s, p.z), quat, scale);
    leaves.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x, 6.6 * s, p.z), quat, scale);
    tops.setMatrixAt(i, m);
  });
  const g = new THREE.Group();
  for (const im of [trunks, leaves, tops]) {
    im.castShadow = true;
    g.add(im);
  }
  return g;
}

function buildHills(toon) {
  const g = new THREE.Group();
  const rand = rng(21);
  const colors = ['#5cbf55', '#4aa84a', '#6fcf5c'];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.2;
    const r = 520 + rand() * 160;
    const size = 70 + rand() * 90;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 10), toon(colors[i % 3]));
    hill.scale.y = 0.45 + rand() * 0.3;
    hill.position.set(Math.cos(a) * r, -size * 0.15, Math.sin(a) * r);
    g.add(hill);
  }
  return g;
}

function buildClouds() {
  const g = new THREE.Group();
  const rand = rng(99);
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#d8ecff', emissiveIntensity: 0.4 });
  const geo = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 22; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let j = 0; j < puffs; j++) {
      const p = new THREE.Mesh(geo, mat);
      p.scale.setScalar(10 + rand() * 9);
      p.position.set(j * 14 - puffs * 7, rand() * 5, rand() * 8);
      cloud.add(p);
    }
    const a = rand() * Math.PI * 2;
    const r = 250 + rand() * 450;
    cloud.position.set(Math.cos(a) * r, 90 + rand() * 70, Math.sin(a) * r);
    cloud.rotation.y = rand() * Math.PI;
    cloud.userData.drift = 1 + rand() * 2;
    g.add(cloud);
  }
  g.name = 'clouds';
  return g;
}
