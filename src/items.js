import * as THREE from 'three';

// Mystery boxes, the items they give, and everything items put on the track
// (rockets, oil slicks, explosions). Each player decides hits on their own kart,
// so what you see happen to you is always what happened.

export const ITEMS = {
  oil: { name: 'Oil Slick', icon: '🛢️', uses: 1 },
  oil3: { name: 'Triple Oil', icon: '🛢️', uses: 3 },
  rocket: { name: 'Rocket', icon: '🚀', uses: 1 },
  homing: { name: 'Homing Rocket', icon: '🎯', uses: 1 },
  rockets3: { name: 'Triple Rockets', icon: '🎯', uses: 3 },
  turbo: { name: 'Turbo Can', icon: '🥫', uses: 1 },
  shield: { name: 'Bubble Shield', icon: '🛡️', uses: 1 },
  thunder: { name: 'Thunder Cloud', icon: '⛈️', uses: 1 },
  seeker: { name: 'Leader Seeker', icon: '👑', uses: 1 },
  rush: { name: 'Rainbow Rush', icon: '🌈', uses: 1 },
};
export const ITEM_IDS = Object.keys(ITEMS);

// Chances by race position. Leaders get defence, the back of the pack gets catch-up tools.
const ODDS = {
  solo: { oil: 12, oil3: 6, rocket: 14, homing: 10, rockets3: 8, turbo: 16, shield: 12, rush: 6, thunder: 4, seeker: 4 },
  first: { oil: 32, rocket: 28, shield: 28, oil3: 12 },
  second: { rocket: 22, homing: 22, oil: 20, turbo: 22, rockets3: 8, shield: 6 },
  third: { homing: 28, rockets3: 24, turbo: 28, rush: 8, thunder: 6, rocket: 6 },
  last: { rockets3: 28, turbo: 28, homing: 24, rush: 8, seeker: 6, thunder: 6 },
};
const STRONG = ['seeker', 'thunder', 'rockets3', 'rush'];
const CAPPED = ['seeker', 'thunder']; // only one of each every 15 seconds
const CAP_SECONDS = 15;
const LAST_PLACE_BONUS = 0.1;

function bucket(place, count) {
  if (count <= 1) return 'solo';
  if (place <= 1) return 'first';
  if (place >= count) return 'last';
  return place === 2 ? 'second' : 'third';
}

function pick(weights, blocked, rand) {
  const entries = Object.entries(weights).filter(([id]) => !blocked.has(id));
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [id, w] of entries) if ((r -= w) <= 0) return id;
  return entries[entries.length - 1][0];
}

// place: 1 = leading. gap: how many laps behind the leader (0 to ~1).
export function rollItem({ place, count, gap = 0, blocked = new Set(), rand = Math.random }) {
  const b = bucket(place, count);
  if (b === 'last') {
    // A small extra chance of a big attack in last place, more the further behind you are
    const chance = LAST_PLACE_BONUS * (count >= 3 ? 1 : 0.5) * (1 + Math.min(1, gap * 2));
    if (rand() < chance) {
      const strong = STRONG.filter((id) => !blocked.has(id));
      return strong[Math.floor(rand() * strong.length)];
    }
  }
  return pick(ODDS[b], blocked, rand);
}

// Runs on the host (or in solo) so the once-every-15-seconds limits hold across all players.
export class ItemDirector {
  constructor() {
    this.lastGiven = {};
  }

  grant(request, now = performance.now() / 1000) {
    const blocked = new Set(CAPPED.filter((id) => now - (this.lastGiven[id] ?? -Infinity) < CAP_SECONDS));
    const item = rollItem({ ...request, blocked });
    if (CAPPED.includes(item)) this.lastGiven[item] = now;
    return item;
  }
}

// --- Mystery boxes -------------------------------------------------------------------
const BOX_RESPAWN = 2;
const BOX_SPACING = 4.2;

function boxTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, '#ff6ad5');
  g.addColorStop(0.35, '#ffd23f');
  g.addColorStop(0.7, '#3fe0ff');
  g.addColorStop(1, '#a66bff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 118, 118);
  ctx.font = '900 92px Nunito, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#1d1b3a';
  ctx.strokeText('?', 64, 70);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ItemBoxes {
  // rows: lap fractions where a line of boxes crosses the road
  constructor(track, rows) {
    this.track = track;
    this.group = new THREE.Group();
    this.boxes = [];
    const mat = new THREE.MeshBasicMaterial({ map: boxTexture(), transparent: true, opacity: 0.92 });
    const geo = new THREE.BoxGeometry(2, 2, 2);
    const N = track.sampleCount;
    for (const at of rows) {
      const i = Math.round(at * N) % N;
      const across = Math.floor((track.width - 4) / BOX_SPACING);
      for (let k = 0; k <= across; k++) {
        const off = (k - across / 2) * BOX_SPACING;
        const p = track.point(i).clone().addScaledVector(track.sides[i], off);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(p.x, p.y + 1.6, p.z);
        mesh.rotation.set(0.6, k, 0.6);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.boxes.push({ mesh, x: p.x, z: p.z, y: p.y, index: i, respawn: 0 });
      }
    }
  }

  reset() {
    for (const b of this.boxes) {
      b.respawn = 0;
      b.mesh.visible = true;
      b.mesh.scale.setScalar(1);
    }
  }

  // Returns the index of a box the kart just drove through, or -1.
  touching(s) {
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.respawn > 0) continue;
      if (Math.hypot(s.x - b.x, s.z - b.z) < 2.4 && Math.abs(s.ground + s.y - b.y) < 3) return i;
    }
    return -1;
  }

  take(i) {
    const b = this.boxes[i];
    if (!b) return;
    b.respawn = BOX_RESPAWN;
    b.mesh.visible = false;
  }

  update(time, dt) {
    for (const b of this.boxes) {
      if (b.respawn > 0) {
        b.respawn -= dt;
        if (b.respawn <= 0) b.mesh.visible = true;
        b.mesh.scale.setScalar(0.01);
        continue;
      }
      b.mesh.scale.setScalar(Math.min(1, b.mesh.scale.x + dt * 3));
      b.mesh.rotation.y += dt * 1.6;
      b.mesh.position.y = b.y + 1.6 + Math.sin(time * 2.5 + b.x) * 0.25;
    }
  }
}

// --- Things items put on the track ----------------------------------------------------
const SPEEDS = { rocket: 70, homing: 75, seeker: 85 };
const LIFETIME = { rocket: 6, homing: 8, seeker: 20, oil: 90 };
const ARM_TIME = 0.6; // your own rocket can't hit you right after launch
const MAX_HAZARDS = 30;

function rocketMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.4, 10), new THREE.MeshLambertMaterial({ color }));
  body.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 10), new THREE.MeshLambertMaterial({ color: '#fff8e7' }));
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 8), new THREE.MeshBasicMaterial({ color: '#ffb000' }));
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = -1.1;
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.45), new THREE.MeshLambertMaterial({ color: '#1d1b3a' }));
    fin.position.set(Math.sin(a) * 0.3, Math.cos(a) * 0.3, -0.5);
    fin.rotation.z = -a;
    g.add(fin);
  }
  g.add(body, nose, flame);
  g.userData.flame = flame;
  return g;
}

function seekerMesh() {
  const g = rocketMesh('#3f7bff');
  g.scale.setScalar(1.8);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.5), new THREE.MeshLambertMaterial({ color: '#c9e4ff' }));
  wing.position.z = 0.1;
  g.add(wing);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.4, 5), new THREE.MeshBasicMaterial({ color: '#ffc531' }));
  crown.position.set(0, 0.45, 0.3);
  g.add(crown);
  return g;
}

function oilMesh() {
  const g = new THREE.Group();
  const puddle = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 18),
    new THREE.MeshBasicMaterial({ color: '#141022', transparent: true, opacity: 0.92, depthWrite: false }),
  );
  puddle.rotation.x = -Math.PI / 2;
  puddle.scale.set(1, 0.8, 1);
  const sheen = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.9, 18, 1, 0, Math.PI * 1.2),
    new THREE.MeshBasicMaterial({ color: '#7a5cff', transparent: true, opacity: 0.55, depthWrite: false }),
  );
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.y = 0.01;
  g.add(puddle, sheen);
  return g;
}

// Fast rockets can move further than a kart's width in one frame, so test the whole path
// travelled since the last frame, not just where the rocket ended up.
function segmentDistance(s, t) {
  const ax = t.px ?? t.x;
  const az = t.pz ?? t.z;
  const dx = t.x - ax;
  const dz = t.z - az;
  const len2 = dx * dx + dz * dz;
  const k = len2 > 0 ? Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.z - az) * dz) / len2)) : 0;
  return Math.hypot(s.x - (ax + dx * k), s.z - (az + dz * k));
}

export class ItemWorld {
  constructor(track) {
    this.track = track;
    this.group = new THREE.Group();
    this.things = new Map(); // id -> projectile or hazard
    this.booms = [];
  }

  clear() {
    for (const id of [...this.things.keys()]) this.remove(id, false);
    for (const b of this.booms) this.group.remove(b.mesh);
    this.booms = [];
  }

  // spec: { id, kind, owner, idx, off, vOff, dir, target, x, z, y }
  spawn(spec) {
    if (this.things.has(spec.id)) return;
    const t = { ...spec, age: 0, bounces: 0, height: spec.kind === 'seeker' ? 5 : 0.9 };
    if (t.kind === 'oil') {
      t.mesh = oilMesh();
      t.mesh.position.set(t.x, t.y + 0.14, t.z);
      const hazards = [...this.things.values()].filter((x) => x.kind === 'oil');
      if (hazards.length >= MAX_HAZARDS) this.remove(hazards[0].id, false);
    } else {
      t.mesh = t.kind === 'seeker' ? seekerMesh() : rocketMesh(t.kind === 'homing' ? '#e8433f' : '#46b85e');
      this.#place(t);
    }
    this.group.add(t.mesh);
    this.things.set(t.id, t);
  }

  remove(id, explode = true) {
    const t = this.things.get(id);
    if (!t) return null;
    this.group.remove(t.mesh);
    t.mesh.traverse((o) => o.geometry?.dispose());
    this.things.delete(id);
    if (explode) this.explode(t.mesh.position, t.kind === 'seeker' ? 2.2 : 1);
    return t;
  }

  explode(pos, size = 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ffb000', transparent: true, opacity: 0.9, depthWrite: false }),
    );
    mesh.position.copy(pos);
    this.group.add(mesh);
    this.booms.push({ mesh, age: 0, size });
  }

  #place(t) {
    const tr = this.track;
    const N = tr.sampleCount;
    const i0 = Math.floor(t.idx);
    const f = t.idx - i0;
    const a = tr.point(i0);
    const b = tr.point(i0 + 1);
    const side = tr.sides[((i0 % N) + N) % N];
    const tan = tr.tangents[((i0 % N) + N) % N];
    t.x = a.x + (b.x - a.x) * f + side.x * t.off;
    t.z = a.z + (b.z - a.z) * f + side.z * t.off;
    t.y = a.y + (b.y - a.y) * f;
    t.mesh.position.set(t.x, t.y + t.height, t.z);
    t.mesh.rotation.y = Math.atan2(tan.x * t.dir, tan.z * t.dir) - Math.atan2(t.vOff || 0, SPEEDS[t.kind]) * t.dir;
  }

  // Track distance (m) from a projectile forward to a kart, in the projectile's direction of travel.
  #ahead(t, s) {
    const N = this.track.sampleCount;
    let d = ((s.trackIndex - t.idx) * t.dir) % N;
    if (d < 0) d += N;
    return d * this.track.spacing;
  }

  // stateOf(id) returns the kart state of any player, or null if they left.
  update(dt, stateOf) {
    const tr = this.track;
    const limit = tr.wallOffset - 0.8;
    for (const t of [...this.things.values()]) {
      t.age += dt;
      if (t.age > LIFETIME[t.kind]) {
        this.remove(t.id, t.kind !== 'oil');
        continue;
      }
      if (t.kind === 'oil') continue;

      const target = t.target != null ? stateOf(t.target) : null;
      const ahead = target ? this.#ahead(t, target) : Infinity;
      if (t.kind === 'homing' && ahead < 90) {
        const want = target.offset - t.off;
        t.vOff = Math.max(-22, Math.min(22, want * 4));
      }
      if (t.kind === 'seeker') {
        if (target) t.off += (target.offset - t.off) * Math.min(1, dt * (ahead < 60 ? 6 : 1.5));
        t.vOff = 0;
        const low = ahead < 30;
        t.height += ((low ? 0.9 : 5) - t.height) * Math.min(1, dt * (low ? 5 : 2));
      }
      t.px = t.x;
      t.pz = t.z;
      t.idx += (t.dir * SPEEDS[t.kind] * dt) / tr.spacing;
      t.off += (t.vOff || 0) * dt;
      if (Math.abs(t.off) > limit) {
        t.off = Math.sign(t.off) * limit;
        if (t.kind === 'rocket') {
          t.vOff = -t.vOff;
          if (++t.bounces > 5) {
            this.remove(t.id);
            continue;
          }
        }
      }
      this.#place(t);
      t.mesh.userData.flame && (t.mesh.userData.flame.scale.y = 0.7 + Math.random() * 0.6);
    }

    for (const b of this.booms) {
      b.age += dt;
      b.mesh.scale.setScalar(b.size * (0.6 + b.age * 12));
      b.mesh.material.opacity = Math.max(0, 0.9 - b.age * 2.6);
    }
    this.booms = this.booms.filter((b) => {
      if (b.age < 0.35) return true;
      this.group.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      return false;
    });
  }

  // Everything that just touched this kart.
  hitsOn(s, myId) {
    const hits = [];
    const top = s.ground + s.y;
    for (const t of this.things.values()) {
      if (t.owner === myId && t.age < ARM_TIME + (t.kind === 'oil' ? 0.4 : 0)) continue;
      const d = t.kind === 'oil' ? Math.hypot(s.x - t.x, s.z - t.z) : segmentDistance(s, t);
      const dy = Math.abs(top - (t.y + (t.kind === 'oil' ? 0 : t.height - 0.6)));
      if (t.kind === 'oil' ? d < 1.8 && dy < 1.5 : d < 2.1 && dy < 2.2) hits.push(t);
    }
    return hits;
  }
}

// --- Coins --------------------------------------------------------------------------
const COIN_RESPAWN = 10;

export class Coins {
  // lines: { at, offset, count } along the loop, or { branch, t, offset, count } along a side road.
  // Coins in a line are 3 m apart.
  constructor(track, lines) {
    this.group = new THREE.Group();
    this.coins = [];
    const geo = new THREE.CylinderGeometry(0.75, 0.75, 0.18, 18);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffc531', emissive: '#7a5200' });
    for (const line of lines) {
      const path = line.branch != null ? track.branches[line.branch] : track;
      const n = path.count;
      const start = line.branch != null ? Math.round(line.t * (n - 1)) : Math.round(line.at * n);
      const step = Math.max(1, Math.round(3 / path.spacing));
      for (let k = 0; k < (line.count || 5); k++) {
        const i = line.branch != null ? Math.min(n - 1, start + k * step) : (start + k * step) % n;
        const c = path.points[i];
        const s = path.sides[i];
        const off = line.offset || 0;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(c.x + s.x * off, c.y + 1.1, c.z + s.z * off);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.coins.push({ mesh, x: mesh.position.x, z: mesh.position.z, y: c.y, respawn: 0 });
      }
    }
  }

  reset() {
    for (const c of this.coins) {
      c.respawn = 0;
      c.mesh.visible = true;
    }
  }

  touching(s) {
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
      if (c.respawn > 0) continue;
      if (Math.hypot(s.x - c.x, s.z - c.z) < 1.9 && Math.abs(s.ground + s.y - c.y) < 3) return i;
    }
    return -1;
  }

  take(i) {
    const c = this.coins[i];
    if (!c) return;
    c.respawn = COIN_RESPAWN;
    c.mesh.visible = false;
  }

  update(time, dt) {
    for (const c of this.coins) {
      if (c.respawn > 0 && (c.respawn -= dt) <= 0) c.mesh.visible = true;
      c.mesh.rotation.y = time * 3;
    }
  }
}
