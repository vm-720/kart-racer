import * as THREE from 'three';
import { Track } from '../track.js';
import { flagTexture, grassTexture, stoneTexture, checkerTexture } from '../textures.js';

// Castle Cloverleaf: a technical circuit around a storybook castle. Long straights,
// two hairpins, a run of esses through the middle, and a hill that climbs through
// the castle's gatehouse.

// Hand-placed control points as [x, z, height]. The loop runs from the start line
// east along the bottom straight, then counter-clockwise around the map.
const CONTROL = [
  [-150, -220], [60, -220], [150, -220], // home straight
  [215, -200], [235, -145], [200, -105], // east hairpin
  [130, -110], [70, -95], [45, -55], [75, -15], [85, 30], // esses
  [100, 100], [170, 140], [240, 185], [240, 245], [180, 268], // north-east sweeper
  [40, 255, 4], [-80, 252, 10], [-170, 242, 4], // hill through the gatehouse
  [-222, 205], [-200, 150], [-140, 145], // north-west hairpin
  [-100, 108], [-125, 62], [-200, 40], // chicane
  [-238, -10], [-228, -90], [-208, -180], [-178, -215], // west straight and final corner
];
export const CASTLE_POS = new THREE.Vector3(-90, 0, -80);
const GATEHOUSE_AT = new THREE.Vector3(-80, 0, 252);

// Smooth the spline so no corner is tighter than the karts can take.
function buildCenterLine() {
  const curve = new THREE.CatmullRomCurve3(
    CONTROL.map(([x, z, y = 0]) => new THREE.Vector3(x, y, z)),
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
const centerLine = buildCenterLine();

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
    width: 22,
    runoff: 7,
    wallHeight: 1.4,
    laps: 3,
    boostPads: [
      { near: new THREE.Vector3(40, 0, -220), offset: 0 },
      { near: new THREE.Vector3(150, 0, -110), offset: -4 },
      { near: new THREE.Vector3(92, 0, 65), offset: 3 },
      { near: new THREE.Vector3(-236, 0, -40), offset: 4 },
    ],
  });

  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap, ...extra });
  const scene = new THREE.Group();
  scene.add(track.group);

  // Ground
  const grass = grassTexture();
  grass.repeat.set(90, 90);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(1200, 64),
    new THREE.MeshLambertMaterial({ map: grass, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const castle = buildCastle(toon);
  castle.scale.setScalar(1.8);
  castle.position.copy(CASTLE_POS);
  castle.rotation.y = Math.PI / 2; // gate faces the home straight
  scene.add(castle);
  scene.add(buildStartGantry(track, toon));
  scene.add(buildGatehouse(track, toon, GATEHOUSE_AT));
  scene.add(buildPennants(track, toon));
  scene.add(buildGrandstand(track, toon));
  scene.add(buildTrees(track, toon));
  scene.add(buildHills(toon));
  scene.add(buildClouds());
  return { track, scene, name: 'Castle Cloverleaf', focus: CASTLE_POS, fog: { color: '#cfe9ff', near: 320, far: 1400 } };
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
  while (spots.length < 420) {
    const a = rand() * Math.PI * 2;
    const r = 30 + rand() * 520;
    const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    if (p.distanceTo(CASTLE_POS) < 115) continue;
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
    const r = 760 + rand() * 200;
    const size = 90 + rand() * 120;
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
    const r = 350 + rand() * 600;
    cloud.position.set(Math.cos(a) * r, 90 + rand() * 70, Math.sin(a) * r);
    cloud.rotation.y = rand() * Math.PI;
    cloud.userData.drift = 1 + rand() * 2;
    g.add(cloud);
  }
  g.name = 'clouds';
  return g;
}

// A stone gatehouse the road climbs through at the top of the hill.
function buildGatehouse(track, toon, near) {
  const g = new THREE.Group();
  const q = track.query(near);
  const c = track.point(q.index);
  const t = track.tangents[q.index];
  const span = track.wallOffset + 3;
  const top = c.y + 13;
  const stone = stoneTexture();
  stone.repeat.set(2, 4);
  const stoneMat = toon('#ffffff', { map: stone });
  for (const side of [-1, 1]) {
    const tw = tower(toon, 4.5, top, '#3f7bff', side < 0 ? '#e8433f' : '#3f7bff');
    tw.position.set(0, 0, side * (span + 3));
    g.add(tw);
  }
  // The arch: a thick span with a rounded underside and battlements on top
  const beam = new THREE.Mesh(new THREE.BoxGeometry(6, 4, span * 2 + 2), stoneMat);
  beam.position.y = top - 2;
  beam.castShadow = true;
  g.add(beam);
  const g2 = crenellations(toon, 6, span * 2 + 2, top, 9);
  g.add(g2);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 3.4),
    toon('#ffffff', { map: flagTexture('#e8433f'), side: THREE.DoubleSide }),
  );
  banner.position.set(3.05, top - 2, 0);
  banner.rotation.y = Math.PI / 2;
  g.add(banner);
  const back = banner.clone();
  back.position.x = -3.05;
  g.add(back);
  g.position.set(c.x, 0, c.z);
  g.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
  return g;
}

// Little pennant flags on poles along both walls.
function buildPennants(track, toon) {
  const every = Math.round(40 / track.spacing);
  const spots = [];
  for (let i = 0; i < track.sampleCount; i += every) {
    for (const side of [-1, 1]) {
      const c = track.point(i);
      const s = track.sides[i];
      const off = side * (track.wallOffset + 0.6);
      spots.push({ x: c.x + s.x * off, y: c.y + track.wallHeight, z: c.z + s.z * off, t: track.tangents[i] });
    }
  }
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.1, 4, 5), toon('#ffffff'), spots.length);
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -1.4, 0, 0, -0.7, 2.2], 3));
  flagGeo.computeVertexNormals();
  const flags = new THREE.InstancedMesh(flagGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), spots.length);
  const colors = ['#e8433f', '#3f7bff', '#ffc531'].map((c) => new THREE.Color(c));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  spots.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(p.t.x, p.t.z) + Math.PI);
    m.compose(new THREE.Vector3(p.x, p.y + 2, p.z), q, one);
    poles.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x, p.y + 4, p.z), q, one);
    flags.setMatrixAt(i, m);
    flags.setColorAt(i, colors[i % 3]);
  });
  const g = new THREE.Group();
  poles.castShadow = true;
  g.add(poles, flags);
  return g;
}

// Bleachers full of cheering spectators beside the home straight.
function buildGrandstand(track, toon) {
  const g = new THREE.Group();
  const i = track.sampleCount - Math.round(60 / track.spacing);
  const c = track.point(i);
  const t = track.tangents[i];
  const s = track.sides[i];
  const length = 70;
  const steps = 5;
  const stepMat = toon('#cfc8dc');
  for (let k = 0; k < steps; k++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(length, 1.2 * (k + 1), 2.4), stepMat);
    step.position.set(0, 0.6 * (k + 1), 3 + k * 2.4);
    step.castShadow = true;
    step.receiveShadow = true;
    g.add(step);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(length + 4, 0.6, 14), toon('#e8433f'));
  roof.position.set(0, 11, 7);
  roof.rotation.x = -0.12;
  roof.castShadow = true;
  g.add(roof);
  for (const x of [-length / 2, 0, length / 2]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 11, 6), toon('#ffffff'));
    post.position.set(x, 5.5, 14);
    g.add(post);
  }
  // Spectators as simple heads-and-bodies in bright shirts
  const rand = rng(5);
  const crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.35, 0.5, 2, 6), toon('#ffffff'), steps * 30);
  const shirts = ['#e8433f', '#3f7bff', '#ffc531', '#46b85e', '#ff8a1f', '#c35cff'].map((x) => new THREE.Color(x));
  const m = new THREE.Matrix4();
  let n = 0;
  for (let k = 0; k < steps; k++) {
    for (let j = 0; j < 30; j++) {
      if (rand() < 0.15) continue;
      const x = -length / 2 + 2 + j * ((length - 4) / 29) + (rand() - 0.5);
      m.makeTranslation(x, 1.2 * (k + 1) + 0.7, 3 + k * 2.4);
      crowd.setMatrixAt(n, m);
      crowd.setColorAt(n, shirts[(rand() * shirts.length) | 0]);
      n++;
    }
  }
  crowd.count = n;
  crowd.name = 'crowd';
  g.add(crowd);
  // Face the track from outside the right-hand wall
  const off = track.wallOffset + 4;
  g.position.set(c.x + s.x * off, 0, c.z + s.z * off);
  g.rotation.y = Math.atan2(s.x, s.z);
  return g;
}
