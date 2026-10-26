import * as THREE from 'three';
import { asphaltTexture, boostTexture, checkerTexture, stoneTexture } from './textures.js';

// A track is a closed centre line sampled into evenly spaced points.
// Everything else (road mesh, walls, lap progress, collisions) is derived from those samples,
// so new tracks only need a new centre line and their own scenery.

const SAMPLES = 2400;

export class Track {
  constructor({ name, centerLine, width, runoff, wallHeight, laps, boostPads = [] }) {
    this.name = name;
    this.width = width;
    this.halfWidth = width / 2;
    this.runoff = runoff; // grass between the road edge and the wall
    this.wallOffset = this.halfWidth + runoff;
    this.wallHeight = wallHeight;
    this.laps = laps;
    this.group = new THREE.Group();

    this.#sample(centerLine);
    this.boostPads = boostPads.map((p) => this.#makeBoostPad(p));
    this.#buildRoad();
    this.#buildCurbs();
    this.#buildWalls();
    this.#buildStartLine();
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
      this.points.push(dense[j].clone().lerp(dense[j + 1], t));
    }
    this.spacing = this.length / SAMPLES;

    this.tangents = [];
    this.sides = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t = this.point(i + 1).clone().sub(this.point(i - 1)).setY(0).normalize();
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
    return { index: best, offset, center: c, side, tangent: this.tangents[best] };
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

  // Builds a flat strip between two lateral offsets along the whole loop.
  #ribbon(offA, offB, y, { vScale = 1, colorAt = null } = {}) {
    const pos = [];
    const uv = [];
    const col = [];
    const idx = [];
    let v = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      const c = this.point(i);
      const s = this.sides[i % SAMPLES];
      pos.push(c.x + s.x * offA, y, c.z + s.z * offA, c.x + s.x * offB, y, c.z + s.z * offB);
      uv.push(0, v, 1, v);
      if (colorAt) {
        const k = colorAt(i);
        col.push(k.r, k.g, k.b, k.r, k.g, k.b);
      }
      v += this.spacing * vScale;
      if (i < SAMPLES) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (colorAt) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // Strips on the left side wind the other way; make sure normals face up.
    const n = geo.attributes.normal;
    if (n.getY(0) < 0) {
      geo.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]]));
      geo.computeVertexNormals();
    }
    return geo;
  }

  #buildRoad() {
    const tex = asphaltTexture();
    const geo = this.#ribbon(-this.halfWidth, this.halfWidth, 0.02, { vScale: 1 / this.width });
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
      const b = sign * (this.halfWidth + 1.6);
      const curb = new THREE.Mesh(this.#ribbon(a, b, 0.06, { colorAt }), mat);
      curb.receiveShadow = true;
      this.group.add(curb);
    }
  }

  #buildWalls() {
    const tex = stoneTexture();
    const h = this.wallHeight;
    for (const sign of [-1, 1]) {
      const off = sign * this.wallOffset;
      const pos = [];
      const uv = [];
      const idx = [];
      let u = 0;
      for (let i = 0; i <= SAMPLES; i++) {
        const c = this.point(i);
        const s = this.sides[i % SAMPLES];
        const x = c.x + s.x * off;
        const z = c.z + s.z * off;
        const x2 = c.x + s.x * (off + sign * 1.2);
        const z2 = c.z + s.z * (off + sign * 1.2);
        // inner face bottom/top, outer top
        pos.push(x, 0, z, x, h, z, x2, h, z2, x2, 0, z2);
        uv.push(u, 0, u, h / 4, u, h / 4 + 0.3, u, 0);
        u += this.spacing / 4;
        if (i < SAMPLES) {
          const a = i * 4;
          const b = a + 4;
          // inner face, top, outer face
          idx.push(a, b, a + 1, a + 1, b, b + 1);
          idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
          idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const wall = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
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
    line.position.set(c.x, 0.05, c.z);
    line.receiveShadow = true;
    this.group.add(line);
  }

  #makeBoostPad({ at, offset = 0, length = 9, width = 6 }) {
    const i = Math.round(at * SAMPLES);
    const c = this.point(i).clone().addScaledVector(this.sides[i], offset);
    const t = this.tangents[i];
    const mat = new THREE.MeshBasicMaterial({ map: boostTexture() });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(width, length), mat);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = Math.atan2(t.x, t.z) + Math.PI;
    pad.position.set(c.x, 0.07, c.z);
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

  update(time) {
    for (const p of this.boostPads) p.mesh.material.map.offset.y = -time * 1.5;
  }
}
