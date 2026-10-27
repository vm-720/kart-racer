import * as THREE from 'three';
import { Track } from '../track.js';
import { caveRoadTexture, gravelTexture, rockTexture, lavaTexture, checkerTexture } from '../textures.js';

// Crystal Caverns: glowing crystals light the way through rock tunnels. The road climbs
// through a crystal tunnel, launches off a crest into a huge open cavern, crosses an
// underground lake and heads home through a second tunnel. Near the end, a narrow bridge
// with no rails cuts straight across a lava pool: shorter, but fall off and the drone
// carries you back to where the bridge starts.

// Control points as [x, z, height]. The loop runs east from the start line.
const CONTROL = [
  [-144, -144, 0], [0, -153, 0], [108, -144, 0], // start cavern
  [171, -108, 2], [189, -45, 5], [162, 9, 8], [99, 27, 12], [54, 0, 15], [0, -27, 18], // climbing crystal tunnel
  [-54, -9, 18], [-99, 36, 6], [-108, 99, 0], // crest and the big drop
  [-54, 153, 0], [36, 171, 0], [126, 180, 0], // across the lake
  [198, 216, 0], [207, 279, 0], [144, 306, 0], // far hairpin
  [36, 297, 0], [-72, 288, 0], // second tunnel
  [-180, 270, 0], [-261, 225, 0], [-270, 153, 0], [-234, 90, 0], // the long way round the lava
  [-225, 0, 0], [-216, -72, 0], [-194, -135, 0], // home straight
];
export const CAVERN_POS = new THREE.Vector3(-20, 0, 90);
const LAKE = { x: 40, z: 172, r: 105 };

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

const TUNNELS = [
  [0.13, 0.29], // crystal tunnel up the climb
  [0.6, 0.73], // dark tunnel after the hairpin
];
const CRYSTAL_COLORS = ['#5ff3ff', '#d36bff', '#7f8bff'];

export function buildCaveTrack(gradientMap) {
  const track = new Track({
    name: 'Crystal Caverns',
    centerLine: buildCenterLine(),
    width: 20,
    runoff: 4,
    wallHeight: 1.6,
    laps: 3,
    theme: { road: caveRoadTexture, runoff: gravelTexture, wall: rockTexture, curbs: ['#8b6cff', '#ece6ff'] },
    branches: [
      // Lava bridge: a narrow shortcut with no rails across the lava pool
      { from: 1785, to: 2105, width: 9, runoff: 0.6, surface: 'road', bend: 0.35, walls: false },
    ],
    boostPads: [
      { at: 0.06, offset: 0 },
      { at: 0.4, offset: 4 },
      { at: 0.9, offset: -3 },
    ],
    ramps: [{ at: 0.303 }], // over the crest and down into the cavern
  });

  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap, ...extra });
  const scene = new THREE.Group();
  scene.add(track.group);
  scene.add(buildFloor());
  scene.add(buildLake());
  const lava = buildLava(track);
  scene.add(lava);
  scene.add(buildBridgeSupports(track, toon));
  for (const [a, b] of TUNNELS) scene.add(buildTunnel(track, a, b));
  scene.add(buildStartGantry(track, toon));
  scene.add(buildCrystals(track));
  scene.add(buildRocks(track, toon));
  scene.add(buildCrystalLights(track));

  const coinLines = [
    { at: 0.1, count: 5 },
    { at: 0.22, offset: -5, count: 5 }, // inside line of the climbing tunnel
    { at: 0.46, offset: 5 }, // across the lake
    { at: 0.66, offset: -4 },
    { branch: 0, t: 0.3, count: 7 }, // tempting coins on the lava bridge
    { at: 0.95, offset: 4 },
  ];

  return {
    track,
    scene,
    name: 'Crystal Caverns',
    itemRows: [0.05, 0.27, 0.45, 0.68],
    coinLines,
    focus: CAVERN_POS.clone().setY(10),
    fog: { color: '#120b1f', near: 60, far: 430 },
    sky: 'cave',
    hemi: ['#9a8ae0', '#2a1d38', 1.5],
    sun: ['#c9b8ff', 1.0],
    update(time) {
      lava.userData.flow.offset.set(Math.sin(time * 0.3) * 0.1, -time * 0.05);
    },
  };
}

// The cavern floor everywhere off the road.
function buildFloor() {
  const tex = rockTexture();
  tex.repeat.set(70, 70);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(900, 48),
    new THREE.MeshLambertMaterial({ map: tex, color: '#8a7f99', polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.6;
  floor.receiveShadow = true;
  return floor;
}

function buildLake() {
  const g = new THREE.Group();
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(LAKE.r, 48),
    new THREE.MeshLambertMaterial({ color: '#1b5c8f', emissive: '#0d3a66', emissiveIntensity: 0.8, transparent: true, opacity: 0.92 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE.x, -0.35, LAKE.z);
  water.userData.ripple = true;
  g.add(water);
  // A glowing shoreline
  const shore = new THREE.Mesh(
    new THREE.RingGeometry(LAKE.r - 1.5, LAKE.r + 1, 64),
    new THREE.MeshBasicMaterial({ color: '#5ff3ff', transparent: true, opacity: 0.55 }),
  );
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(LAKE.x, -0.3, LAKE.z);
  g.add(shore);
  return g;
}

// A strip of lava under the bridge shortcut.
function buildLava(track) {
  const b = track.branches[0];
  const tex = lavaTexture();
  const pos = [];
  const uv = [];
  const idx = [];
  const from = Math.round(b.count * 0.1);
  const to = Math.round(b.count * 0.9);
  for (let i = from; i <= to; i++) {
    const c = b.points[i];
    const s = b.sides[i];
    const f = (i - from) / (to - from);
    const half = 6 + Math.sin(f * Math.PI) * 10; // wider in the middle
    pos.push(c.x - s.x * half, -0.3, c.z - s.z * half, c.x + s.x * half, -0.3, c.z + s.z * half);
    uv.push(0, i * 0.08, 2, i * 0.08);
    if (i < to) {
      const a = (i - from) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const lava = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  lava.userData.flow = tex;
  lava.name = 'lava';
  return lava;
}

// Stone pillars and a slab under the lava bridge so it reads as a bridge.
function buildBridgeSupports(track, toon) {
  const g = new THREE.Group();
  const b = track.branches[0];
  const slabMat = toon('#3a3346');
  const step = Math.max(1, Math.round(10 / b.spacing));
  for (let i = Math.round(b.count * 0.08); i < b.count * 0.92; i += step) {
    const c = b.points[i];
    const t = b.tangents[i];
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(b.wallOffset * 2 - 1, 1.2, 1.6), slabMat);
    pillar.position.set(c.x, c.y - 0.85, c.z);
    pillar.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
    g.add(pillar);
  }
  return g;
}

// A rock arch over the road between two lap fractions.
function buildTunnel(track, a, b) {
  const N = track.sampleCount;
  const start = Math.round(a * N);
  const end = Math.round(b * N);
  const K = 14;
  const R = track.wallOffset + 0.6;
  const H = 10;
  const pos = [];
  const uv = [];
  const idx = [];
  let row = 0;
  for (let i = start; i <= end; i += 2) {
    const c = track.point(i);
    const s = track.sides[i % N];
    for (let k = 0; k <= K; k++) {
      const th = (k / K) * Math.PI;
      const off = Math.cos(th) * R;
      const y = c.y + track.wallHeight + Math.sin(th) * H;
      pos.push(c.x + s.x * off, y, c.z + s.z * off);
      uv.push((k / K) * 4, (i - start) * track.spacing * 0.08);
    }
    if (i + 2 <= end) {
      for (let k = 0; k < K; k++) {
        const p = row * (K + 1) + k;
        idx.push(p, p + K + 1, p + 1, p + 1, p + K + 1, p + K + 2);
      }
    }
    row++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ map: rockTexture(), color: '#b3a8c8', side: THREE.DoubleSide });
  const g = new THREE.Group();
  const arch = new THREE.Mesh(geo, mat);
  arch.receiveShadow = true;
  g.add(arch);

  // Chunky rock around both mouths so the tunnel looks carved into the cliff
  const rand = rng(start);
  const rockMat = new THREE.MeshLambertMaterial({ map: rockTexture(), color: '#8a7f99', flatShading: true });
  for (const i of [start, end]) {
    const c = track.point(i);
    const s = track.sides[i % N];
    for (let k = 0; k < 9; k++) {
      const th = (k / 8) * Math.PI;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(3.5 + rand() * 2.5, 0), rockMat);
      const off = Math.cos(th) * (R + 2);
      rock.position.set(c.x + s.x * off, c.y + track.wallHeight + Math.sin(th) * (H + 2), c.z + s.z * off);
      rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      g.add(rock);
    }
  }
  // Crystals growing out of the lower tunnel walls light the way
  const glowGeo = new THREE.OctahedronGeometry(1, 0);
  glowGeo.scale(0.5, 1.8, 0.5);
  for (let i = start + 8, n = 0; i < end - 4; i += 16, n++) {
    const c = track.point(i);
    const s = track.sides[i % N];
    const sign = n % 2 ? 1 : -1;
    const color = CRYSTAL_COLORS[n % CRYSTAL_COLORS.length];
    const glow = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.9 });
    for (let k = 0; k < 3; k++) {
      const shard = new THREE.Mesh(glowGeo, glow);
      // Sat on top of the wall, leaning in towards the road
      const off = sign * (track.wallOffset + 0.5);
      const along = (k - 1) * 0.9;
      const t = track.tangents[i % N];
      shard.position.set(c.x + s.x * off + t.x * along, c.y + track.wallHeight + 0.9, c.z + s.z * off + t.z * along);
      shard.rotation.set((rand() - 0.5) * 0.8, rand() * 3, -sign * (0.4 + rand() * 0.4));
      shard.scale.setScalar(0.8 + rand() * 0.6);
      g.add(shard);
    }
  }
  // Stalactites hanging from the ceiling
  const drip = new THREE.MeshLambertMaterial({ color: '#6c6280', flatShading: true });
  for (let i = start + 20; i < end - 10; i += 28) {
    const c = track.point(i);
    const s = track.sides[i % N];
    const off = (rand() - 0.5) * R * 1.2;
    const len = 1.5 + rand() * 2.5;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.7, len, 5), drip);
    cone.rotation.x = Math.PI;
    const ceiling = c.y + track.wallHeight + Math.sqrt(Math.max(0, 1 - (off / R) ** 2)) * H;
    cone.position.set(c.x + s.x * off, ceiling - len / 2, c.z + s.z * off);
    g.add(cone);
  }
  g.name = 'tunnel';
  return g;
}

function buildStartGantry(track, toon) {
  const g = new THREE.Group();
  const c = track.point(0);
  const t = track.tangents[0];
  const span = track.wallOffset * 2 + 2;
  const wood = toon('#7a5236');
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.4, 11, 1.4), wood);
    post.position.set(0, 5.5, (s * span) / 2);
    post.castShadow = true;
    g.add(post);
    const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), new THREE.MeshBasicMaterial({ color: CRYSTAL_COLORS[0] }));
    lamp.position.set(0, 11.8, (s * span) / 2);
    g.add(lamp);
  }
  const tex = checkerTexture();
  tex.repeat.set(span / 2, 1);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(1, 2.5, span), toon('#ffffff', { map: tex }));
  banner.position.y = 10;
  banner.castShadow = true;
  g.add(banner);
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

// Clusters of glowing crystals along the road and scattered across the cavern.
function buildCrystals(track) {
  const rand = rng(23);
  const N = track.sampleCount;
  const spots = [];
  // Along the road, just outside the walls
  for (let i = 0; i < N; i += 22) {
    const side = rand() < 0.5 ? -1 : 1;
    const c = track.point(i).clone().addScaledVector(track.sides[i], side * (track.wallOffset + 2.5 + rand() * 4));
    if (track.onAnyBranch(c, 3) || inLake(c)) continue;
    spots.push({ p: c.setY(track.point(i).y > 1 ? 0 : c.y), size: 0.8 + rand() * 0.8 });
  }
  // Out in the caverns
  while (spots.length < 260) {
    const a = rand() * Math.PI * 2;
    const r = 40 + rand() * 420;
    const p = new THREE.Vector3(CAVERN_POS.x + Math.cos(a) * r, 0, CAVERN_POS.z + Math.sin(a) * r);
    const q = track.query(p);
    if (Math.abs(q.offset) < track.wallOffset + 6 || track.onAnyBranch(p, 6) || inLake(p)) continue;
    spots.push({ p, size: 1 + rand() * 2.2 });
  }
  const geo = new THREE.OctahedronGeometry(1, 0);
  geo.scale(0.55, 2.2, 0.55);
  geo.translate(0, 1.6, 0);
  const g = new THREE.Group();
  const meshes = CRYSTAL_COLORS.map((color) => {
    const m = new THREE.InstancedMesh(
      geo,
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.75, transparent: true, opacity: 0.9 }),
      spots.length * 4,
    );
    m.count = 0;
    g.add(m);
    return m;
  });
  const mat = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach(({ p, size }, n) => {
    const m = meshes[n % meshes.length];
    const shards = 3 + Math.floor(rand() * 2);
    for (let k = 0; k < shards; k++) {
      q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.9, rand() * 6, (rand() - 0.5) * 0.9));
      const s = size * (0.5 + rand() * 0.7);
      mat.compose(new THREE.Vector3(p.x + (rand() - 0.5) * size * 2, p.y - 0.4, p.z + (rand() - 0.5) * size * 2), q, new THREE.Vector3(s, s, s));
      m.setMatrixAt(m.count++, mat);
    }
  });
  g.name = 'crystals';
  return g;
}

function inLake(p) {
  return Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r + 4;
}

// Stalagmites and boulders on the cavern floor, plus cliffs ringing the map.
function buildRocks(track, toon) {
  const rand = rng(5);
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#5a5068', flatShading: true });
  const spots = [];
  while (spots.length < 140) {
    const a = rand() * Math.PI * 2;
    const r = 30 + rand() * 450;
    const p = new THREE.Vector3(CAVERN_POS.x + Math.cos(a) * r, 0, CAVERN_POS.z + Math.sin(a) * r);
    const q = track.query(p);
    if (Math.abs(q.offset) < track.wallOffset + 8 || track.onAnyBranch(p, 10) || inLake(p)) continue;
    spots.push(p);
  }
  const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), mat, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach((p, i) => {
    const h = 4 + rand() * 16;
    const w = 1.5 + rand() * 3;
    m.compose(p.clone().setY(h / 2 - 0.6), new THREE.Quaternion(), new THREE.Vector3(w, h, w));
    cone.setMatrixAt(i, m);
  });
  g.add(cone);
  // A ring of cliffs far out, so the cavern has walls
  const cliffMat = new THREE.MeshLambertMaterial({ map: rockTexture(), color: '#4a4258', flatShading: true });
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    const r = 470 + rand() * 40;
    const cliff = new THREE.Mesh(new THREE.DodecahedronGeometry(50 + rand() * 30, 0), cliffMat);
    cliff.position.set(CAVERN_POS.x + Math.cos(a) * r, 20 + rand() * 30, CAVERN_POS.z + Math.sin(a) * r);
    cliff.scale.y = 1.6;
    cliff.rotation.set(rand(), rand() * 3, rand());
    g.add(cliff);
  }
  return g;
}

// A handful of coloured lights at big crystal clusters along the lap.
function buildCrystalLights(track) {
  const g = new THREE.Group();
  const N = track.sampleCount;
  const spots = [0.02, 0.16, 0.24, 0.36, 0.47, 0.57, 0.65, 0.72, 0.84, 0.95];
  spots.forEach((at, k) => {
    const i = Math.round(at * N) % N;
    const side = k % 2 ? 1 : -1;
    const c = track.point(i).clone().addScaledVector(track.sides[i], side * (track.wallOffset + 3));
    const color = CRYSTAL_COLORS[k % CRYSTAL_COLORS.length];
    const light = new THREE.PointLight(color, 900, 75, 1.6);
    light.position.set(c.x, c.y + 6, c.z);
    g.add(light);
  });
  return g;
}
