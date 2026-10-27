import * as THREE from 'three';
import { asphaltTexture, boostTexture, checkerTexture, dirtTexture, grassTexture, rampTexture, stoneTexture } from './textures.js';

// A track is a closed centre line sampled into evenly spaced points.
// Everything else (road mesh, walls, lap progress, collisions) is derived from those samples,
// so new tracks only need a new centre line and their own scenery.

const SAMPLES = 2400;
const CURB = 1.6; // curb width beside the road
const KART_RADIUS = 1.1;

// Mesh builders shared by the main loop and its branches. A path has `points`, `sides`,
// `count`, `closed` and `spacing`; `skip(i)` leaves out the piece between samples i and i + 1.
function ribbon(path, offA, offB, y, { vScale = 1, colorAt = null, skip = null } = {}) {
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  let v = 0;
  const n = path.closed ? path.count : path.count - 1;
  for (let i = 0; i <= n; i++) {
    const c = path.points[i % path.count];
    const s = path.sides[i % path.count];
    pos.push(c.x + s.x * offA, c.y + y, c.z + s.z * offA, c.x + s.x * offB, c.y + y, c.z + s.z * offB);
    uv.push(0, v, 1, v);
    if (colorAt) {
      const k = colorAt(i);
      col.push(k.r, k.g, k.b, k.r, k.g, k.b);
    }
    v += path.spacing * vScale;
    if (i < n && !skip?.(i)) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colorAt) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // Strips on the left side wind the other way; flip them so they face up.
  const a = new THREE.Vector3(pos[0], pos[1], pos[2]);
  const b = new THREE.Vector3(pos[3], pos[4], pos[5]);
  const c = new THREE.Vector3(pos[6], pos[7], pos[8]);
  const up = c.sub(a).cross(b.sub(a)).y;
  geo.setIndex(up < 0 ? idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]]) : idx);
  geo.computeVertexNormals();
  return geo;
}

// A stone wall along one edge. Walls reach down to the ground so raised sections look like embankments.
function wallGeometry(path, off, sign, height, skip) {
  const pos = [];
  const uv = [];
  const idx = [];
  let u = 0;
  const n = path.closed ? path.count : path.count - 1;
  for (let i = 0; i <= n; i++) {
    const c = path.points[i % path.count];
    const s = path.sides[i % path.count];
    const x = c.x + s.x * off;
    const z = c.z + s.z * off;
    const x2 = c.x + s.x * (off + sign * 1.2);
    const z2 = c.z + s.z * (off + sign * 1.2);
    const top = c.y + height;
    pos.push(x, 0, z, x, top, z, x2, top, z2, x2, 0, z2);
    uv.push(u, 0, u, top / 4, u, top / 4 + 0.3, u, 0);
    u += path.spacing / 4;
    if (i < n && !skip?.(i)) {
      const a = i * 4;
      const b = a + 4;
      // inner face, top, outer face
      idx.push(a, b, a + 1, a + 1, b, b + 1);
      idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
      idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
    }
  }
  // Close off the ends where a wall stops at a gap
  const drawn = (i) => {
    if (path.closed) i = (i + n) % n;
    else if (i < 0 || i >= n) return false;
    return !skip?.(i);
  };
  for (let i = 0; i < n; i++) {
    if (!drawn(i)) continue;
    for (const [next, v] of [[i - 1, i], [i + 1, i + 1]]) {
      if (drawn(next)) continue;
      const a = v * 4;
      idx.push(a, a + 1, a + 2, a, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// The point `off` metres to the side of sample i, for checking what's there.
function edgePoint(path, i, off) {
  const c = path.points[i % path.count];
  const s = path.sides[i % path.count];
  return { x: c.x + s.x * off, z: c.z + s.z * off };
}

export class Track {
  constructor({ name, centerLine, width, runoff, wallHeight, laps, boostPads = [], branches = [], ramps = [] }) {
    this.name = name;
    this.width = width;
    this.halfWidth = width / 2;
    this.runoff = runoff; // grass between the road edge and the wall
    this.wallOffset = this.halfWidth + runoff;
    this.wallHeight = wallHeight;
    this.laps = laps;
    this.group = new THREE.Group();

    this.#sample(centerLine);
    this.closed = true;
    this.count = SAMPLES;
    // Side roads: shortcuts and split paths that leave the loop and rejoin it further on
    this.branches = branches.map((b) => new Branch(this, b));
    this.obstacles = this.branches.flatMap((b) => b.obstacles);
    this.boostPads = boostPads.map((p) => this.#makeBoostPad(p));
    this.ramps = ramps.map((r) => this.#makeRamp(r));
    this.#buildRoad();
    this.#buildCurbs();
    this.#buildRunoff();
    this.#buildWalls();
    this.#buildStartLine();
    for (const b of this.branches) b.build(this.group);
    this.#buildObstacles();
  }

  #sample(centerLine) {
    // Sample densely, then resample by arc length so points are evenly spaced.
    const dense = [];
    const D = SAMPLES * 4;
    for (let i = 0; i <= D; i++) dense.push(centerLine(i / D));
    const cum = [0];
    for (let i = 1; i <= D; i++) cum.push(cum[i - 1] + dense[i].distanceTo(dense[i - 1]));
    this.length = cum[D];

    this.points = [];
    let j = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const target = (i / SAMPLES) * this.length;
      while (cum[j + 1] < target) j++;
      const t = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
      const p = dense[j].clone().lerp(dense[j + 1], t);
      // Never let the road dip below the ground, or grass shows through it
      p.y = Math.max(0, p.y);
      this.points.push(p);
    }
    this.spacing = this.length / SAMPLES;

    this.tangents = [];
    this.sides = [];
    this.slopes = []; // rise over run along the direction of travel
    for (let i = 0; i < SAMPLES; i++) {
      const d = this.point(i + 1).clone().sub(this.point(i - 1));
      this.slopes.push(d.y / Math.hypot(d.x, d.z));
      const t = d.setY(0).normalize();
      this.tangents.push(t);
      this.sides.push(new THREE.Vector3(-t.z, 0, t.x)); // points to the driver's right
    }
  }

  point(i) {
    return this.points[((i % SAMPLES) + SAMPLES) % SAMPLES];
  }

  get sampleCount() {
    return SAMPLES;
  }

  // Finds the nearest centre line sample. Pass the previous index as a hint for a fast local search.
  query(pos, hint = -1) {
    let best = -1;
    let bestD = Infinity;
    const check = (i) => {
      const p = this.point(i);
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = ((i % SAMPLES) + SAMPLES) % SAMPLES;
      }
    };
    if (hint >= 0) for (let k = -90; k <= 90; k++) check(hint + k);
    if (hint < 0 || bestD > 40 * 40) for (let i = 0; i < SAMPLES; i += 2) check(i);

    const c = this.points[best];
    const side = this.sides[best];
    const offset = (pos.x - c.x) * side.x + (pos.z - c.z) * side.z;
    const tangent = this.tangents[best];
    const slope = this.slopes[best];
    // Blend height between samples so karts glide over hills instead of stepping
    const along = (pos.x - c.x) * tangent.x + (pos.z - c.z) * tangent.z;
    const height = Math.max(0, c.y + along * slope);
    return { index: best, offset, center: c, side, tangent, height, slope };
  }

  // Start grid: two columns, staggered, behind the line.
  gridSlot(slot) {
    const row = Math.floor(slot / 2);
    const col = slot % 2 === 0 ? -1 : 1;
    const back = Math.round((8 + row * 9 + (slot % 2) * 4) / this.spacing);
    const i = SAMPLES - back;
    const pos = this.point(i).clone().addScaledVector(this.sides[i], col * this.halfWidth * 0.45);
    const t = this.tangents[i];
    return { position: pos, heading: Math.atan2(t.x, t.z), index: i };
  }

  #onBranchRoad(i, off) {
    const p = edgePoint(this, i, off);
    return this.branches.some((b) => b.surface === 'road' && b.contains(p, b.halfWidth + CURB));
  }

  #inBranch(i, off) {
    const p = edgePoint(this, i, off);
    return this.branches.some((b) => b.contains(p, b.wallOffset));
  }

  // True if a world position is on a branch (used to keep scenery off side roads).
  onAnyBranch(p, margin = 0) {
    return this.branches.some((b) => b.contains(p, b.wallOffset + margin));
  }

  #buildRoad() {
    const tex = asphaltTexture();
    const geo = ribbon(this, -this.halfWidth, this.halfWidth, 0.06, { vScale: 1 / this.width });
    const road = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    road.receiveShadow = true;
    this.group.add(road);
  }

  #buildCurbs() {
    const red = new THREE.Color('#e8433f');
    const white = new THREE.Color('#fff8e7');
    const stripe = Math.max(1, Math.round(2.5 / this.spacing));
    const colorAt = (i) => (Math.floor(i / stripe) % 2 ? red : white);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const sign of [-1, 1]) {
      const a = sign * this.halfWidth;
      const b = sign * (this.halfWidth + CURB);
      const skip = (i) => this.#onBranchRoad(i, (a + b) / 2) || this.#onBranchRoad(i + 1, (a + b) / 2);
      const curb = new THREE.Mesh(ribbon(this, a, b, 0.1, { colorAt, skip }), mat);
      curb.receiveShadow = true;
      this.group.add(curb);
    }
  }

  // Grass between the curbs and the walls (follows the road's height on hills)
  #buildRunoff() {
    const tex = grassTexture();
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    for (const sign of [-1, 1]) {
      const a = sign * (this.halfWidth + CURB);
      const b = sign * this.wallOffset;
      const skip = (i) => [a, b].some((o) => this.#onBranchRoad(i, o) || this.#onBranchRoad(i + 1, o));
      const strip = new THREE.Mesh(ribbon(this, a, b, 0.05, { vScale: 1 / 12, skip }), mat);
      strip.receiveShadow = true;
      this.group.add(strip);
    }
  }

  #buildWalls() {
    const mat = new THREE.MeshLambertMaterial({ map: stoneTexture(), side: THREE.DoubleSide });
    for (const sign of [-1, 1]) {
      const off = sign * this.wallOffset;
      // Leave gaps where a side road leaves or joins
      const skip = (i) => this.#inBranch(i, off) || this.#inBranch(i + 1, off);
      const wall = new THREE.Mesh(wallGeometry(this, off, sign, this.wallHeight, skip), mat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
    }
  }

  #buildObstacles() {
    if (!this.obstacles.length) return;
    const wood = new THREE.MeshLambertMaterial({ color: '#b07a4a' });
    const band = new THREE.MeshLambertMaterial({ color: '#4a3b5c' });
    for (const o of this.obstacles) {
      const g = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.9, o.r * 0.9, 2.4, 14), wood);
      barrel.position.y = 1.2;
      barrel.castShadow = true;
      g.add(barrel);
      for (const y of [0.45, 1.95]) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.93, o.r * 0.93, 0.18, 14), band);
        ring.position.y = y;
        g.add(ring);
      }
      g.position.set(o.x, o.y, o.z);
      this.group.add(g);
    }
  }

  #buildStartLine() {
    const tex = checkerTexture();
    tex.repeat.set(this.width / 2, 1);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width, 2.5),
      new THREE.MeshLambertMaterial({ map: tex }),
    );
    const c = this.point(0);
    const t = this.tangents[0];
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = Math.atan2(t.x, t.z);
    line.position.set(c.x, c.y + 0.1, c.z);
    line.receiveShadow = true;
    this.group.add(line);
  }

  // Place a pad by fraction of the lap (`at`) or by the nearest point to a position (`near`).
  #makeBoostPad({ at, near, offset = 0, length = 9, width = 6 }) {
    const i = near ? this.query(near).index : Math.round(at * SAMPLES);
    const c = this.point(i).clone().addScaledVector(this.sides[i], offset);
    const t = this.tangents[i];
    const mat = new THREE.MeshBasicMaterial({ map: boostTexture() });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(width, length), mat);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = Math.atan2(t.x, t.z) + Math.PI;
    pad.position.set(c.x, c.y + 0.12, c.z);
    this.group.add(pad);
    return { index: i, offset, halfLength: length / 2, halfWidth: width / 2, mesh: pad };
  }

  // Returns true if the given track position is on a boost pad.
  onBoostPad(index, offset) {
    for (const p of this.boostPads) {
      let di = index - p.index;
      if (di > SAMPLES / 2) di -= SAMPLES;
      if (di < -SAMPLES / 2) di += SAMPLES;
      if (Math.abs(di * this.spacing) < p.halfLength && Math.abs(offset - p.offset) < p.halfWidth) return true;
    }
    return false;
  }

  // A jump ramp: rises over `length` metres and ends in a lip at lap fraction `at`.
  #makeRamp({ at, offset = 0, width = this.width - 2, length = 10, height = 2.4 }) {
    const lip = Math.round(at * SAMPLES);
    const steps = Math.ceil(length / this.spacing);
    const pos = [];
    const uv = [];
    const idx = [];
    for (let k = 0; k <= steps; k++) {
      const i = lip - steps + k;
      const c = this.point(i);
      const s = this.sides[((i % SAMPLES) + SAMPLES) % SAMPLES];
      const h = (height * k) / steps + 0.13;
      for (const o of [offset - width / 2, offset + width / 2]) pos.push(c.x + s.x * o, c.y + h, c.z + s.z * o);
      for (const o of [offset - width / 2, offset + width / 2]) pos.push(c.x + s.x * o, c.y, c.z + s.z * o);
      uv.push(0, (k * this.spacing) / 4, width / 6, (k * this.spacing) / 4, 0, 0, 0, 0);
      if (k < steps) {
        const a = k * 4;
        const b = a + 4;
        idx.push(a, b, a + 1, a + 1, b, b + 1); // top
        idx.push(a, a + 2, b, b, a + 2, b + 2); // left side
        idx.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3); // right side
      } else idx.push(k * 4, k * 4 + 2, k * 4 + 1, k * 4 + 1, k * 4 + 2, k * 4 + 3); // the lip
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: rampTexture(), side: THREE.DoubleSide }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return { lip, offset, halfWidth: width / 2, length, height, slope: height / length };
  }

  // Height of any ramp under a main-loop position, and its steepness.
  rampAt(index, offset) {
    for (const r of this.ramps) {
      let di = r.lip - index;
      if (di > SAMPLES / 2) di -= SAMPLES;
      if (di < -SAMPLES / 2) di += SAMPLES;
      const along = di * this.spacing; // metres before the lip
      if (along >= 0 && along < r.length && Math.abs(offset - r.offset) < r.halfWidth) {
        return { h: r.height * (1 - along / r.length), slope: r.slope };
      }
    }
    return null;
  }

  // Works out which surface a position is on: the main loop (surface 0) or a branch (1, 2...).
  // `inside` is false when the kart is past every wall; `prev` is the surface it was on before.
  locate(pos, hint, prev = 0) {
    const main = this.query(pos, hint);
    let best = null;
    if (Math.abs(main.offset) <= this.wallOffset - KART_RADIUS) {
      best = { surface: 0, q: main, depth: Math.abs(main.offset) / this.wallOffset };
    }
    this.branches.forEach((b, k) => {
      const q = b.query(pos);
      if (!q.interior || Math.abs(q.offset) > b.wallOffset - KART_RADIUS) return;
      const depth = Math.abs(q.offset) / b.wallOffset;
      if (!best || depth < best.depth) best = { surface: k + 1, q, depth, branch: b };
    });
    if (best) return { ...best, main, inside: true };
    // Outside every surface: the walls of the one we came from push back
    const b = this.branches[prev - 1];
    const q = b?.query(pos);
    if (q?.interior) return { surface: prev, q, branch: b, main, inside: false };
    return { surface: 0, q: main, main, inside: false };
  }

  // Lap position of a spot on a surface, as a main-loop sample index.
  lapIndex(loc) {
    return loc.surface === 0 ? loc.q.index : loc.branch.mainIndex(loc.q.t);
  }

  update(time) {
    for (const p of this.boostPads) p.mesh.material.map.offset.y = -time * 1.5;
  }
}

// A side road that leaves the loop at sample `from` and rejoins at `to`: a paved split path
// (surface 'road') or a dirt shortcut that is slow without a boost (surface 'dirt').
class Branch {
  constructor(main, { from, to, width, runoff = 2, surface = 'road', bend = 0.4, obstacles = [] }) {
    this.main = main;
    this.from = from;
    this.to = to;
    this.span = (to - from + SAMPLES) % SAMPLES;
    this.surface = surface;
    this.halfWidth = width / 2;
    this.wallOffset = this.halfWidth + runoff;
    this.closed = false;

    // A smooth curve that leaves and rejoins along the loop's own direction
    const p0 = main.point(from);
    const p3 = main.point(to);
    const t0 = main.tangents[from % SAMPLES];
    const t3 = main.tangents[to % SAMPLES];
    const k = Math.hypot(p3.x - p0.x, p3.z - p0.z) * bend;
    const curve = new THREE.CubicBezierCurve3(
      p0.clone(),
      p0.clone().addScaledVector(t0, k),
      p3.clone().addScaledVector(t3, -k),
      p3.clone(),
    );
    this.length = curve.getLength();
    this.count = Math.max(8, Math.round(this.length));
    this.spacing = this.length / (this.count - 1);
    this.points = curve.getSpacedPoints(this.count - 1);
    // Ease the height between the two ends
    this.points.forEach((p, i) => {
      const f = i / (this.count - 1);
      p.y = p0.y + (p3.y - p0.y) * (f * f * (3 - 2 * f));
    });
    this.tangents = [];
    this.sides = [];
    this.slopes = [];
    for (let i = 0; i < this.count; i++) {
      const a = this.points[Math.max(0, i - 1)];
      const b = this.points[Math.min(this.count - 1, i + 1)];
      const d = b.clone().sub(a);
      this.slopes.push(d.y / Math.hypot(d.x, d.z));
      const t = d.setY(0).normalize();
      this.tangents.push(t);
      this.sides.push(new THREE.Vector3(-t.z, 0, t.x));
    }
    this.obstacles = obstacles.map(({ t, offset = 0, r = 1.3 }) => {
      const i = Math.round(t * (this.count - 1));
      const c = this.points[i];
      const s = this.sides[i];
      return { x: c.x + s.x * offset, z: c.z + s.z * offset, y: c.y, r };
    });
  }

  query(pos) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      const p = this.points[i];
      const d = (pos.x - p.x) ** 2 + (pos.z - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const c = this.points[best];
    const side = this.sides[best];
    const tangent = this.tangents[best];
    const offset = (pos.x - c.x) * side.x + (pos.z - c.z) * side.z;
    const along = (pos.x - c.x) * tangent.x + (pos.z - c.z) * tangent.z;
    const slope = this.slopes[best];
    return {
      index: best,
      offset,
      t: best / (this.count - 1),
      interior: best > 0 && best < this.count - 1,
      side,
      tangent,
      slope,
      height: Math.max(0, c.y + along * slope),
    };
  }

  contains(p, margin) {
    const q = this.query(p);
    return q.interior && Math.abs(q.offset) < margin;
  }

  mainIndex(t) {
    return Math.round(this.from + t * this.span) % SAMPLES;
  }

  // Meshes. Skip anything that would sit on top of the main loop's road.
  build(group) {
    const main = this.main;
    const onMain = (i, off, margin) => {
      const p = edgePoint(this, i, off);
      return Math.abs(main.query(p).offset) < margin;
    };
    const both = (off, margin) => (i) => onMain(i, off, margin) || onMain(i + 1, off, margin);

    const roadMat =
      this.surface === 'road'
        ? new THREE.MeshLambertMaterial({ map: asphaltTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
        : new THREE.MeshLambertMaterial({ map: dirtTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const road = new THREE.Mesh(
      ribbon(this, -this.halfWidth, this.halfWidth, 0.06, {
        vScale: 1 / (this.halfWidth * 2),
        skip: this.surface === 'road' ? null : both(0, main.halfWidth + CURB),
      }),
      roadMat,
    );
    road.receiveShadow = true;
    group.add(road);

    if (this.surface === 'road') {
      const red = new THREE.Color('#e8433f');
      const white = new THREE.Color('#fff8e7');
      const colorAt = (i) => (Math.floor(i / 3) % 2 ? red : white);
      const curbMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const grassMat = new THREE.MeshLambertMaterial({ map: grassTexture() });
      for (const sign of [-1, 1]) {
        const a = sign * this.halfWidth;
        const b = sign * (this.halfWidth + CURB);
        const skip = both((a + b) / 2, main.halfWidth + CURB);
        group.add(new THREE.Mesh(ribbon(this, a, b, 0.1, { colorAt, skip }), curbMat));
        if (this.wallOffset > this.halfWidth + CURB) {
          const grass = ribbon(this, b, sign * this.wallOffset, 0.05, { vScale: 1 / 12, skip: both(b, main.halfWidth + CURB) });
          group.add(new THREE.Mesh(grass, grassMat));
        }
      }
    }

    const wallMat = new THREE.MeshLambertMaterial({ map: stoneTexture(), side: THREE.DoubleSide });
    for (const sign of [-1, 1]) {
      const off = sign * this.wallOffset;
      const wall = new THREE.Mesh(wallGeometry(this, off, sign, main.wallHeight, both(off, main.wallOffset)), wallMat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
    }
  }
}
