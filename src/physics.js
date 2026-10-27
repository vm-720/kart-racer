// Arcade kart physics. Kept free of rendering code so the same rules can run
// on every player's machine (and on a server) once online races arrive.

export const TUNING = {
  maxSpeed: 42, // m/s on road (~151 km/h)
  offroadMaxSpeed: 18,
  dirtMaxSpeed: 20, // shortcuts: slower than the road unless you boost through
  accel: 32,
  brake: 45,
  reverseMax: 10,
  reverseAccel: 18,
  coastDrag: 7,
  steerRate: 2.0, // rad/s at low speed
  grip: 9,
  driftGrip: 3,
  driftTurnRate: 2.15,
  hopSpeed: 5.5,
  gravity: 26,
  boostSpeed: 1.35, // multiplier on maxSpeed
  boostAccel: 80,
  slopeGravity: 0.6, // how much hills slow you down (and speed you up going down)
  driftLevels: [0.9, 2.0, 3.2], // seconds of charge for blue, orange, purple sparks
  driftBoosts: [0.7, 1.2, 1.8], // boost seconds awarded per level
  padBoost: 1.3,
  slipSpeed: 1.08, // drafting: extra top speed while the slipstream burst lasts
  rushSpeed: 1.15, // Rainbow Rush top speed multiplier
  shrinkSpeed: 0.7, // top speed while zapped by a Thunder Cloud
  coinSpeed: 0.006, // extra top speed per coin held (up to 10)
  maxCoins: 10,
  trickBoost: 0.9, // boost seconds for landing a ramp trick
  launch: 0.9, // how much of the ramp's angle carries into the jump
  padJump: 15, // upward speed from a low-gravity jump pad
  lowGravity: 0.45, // gravity multiplier while flying off a jump pad
  fallTime: 1.3, // seconds of falling before the drone picks you up
  droneTime: 1.2, // seconds the drone takes to set you back down
  kartRadius: 1.1,
};

export function createKartState({ position, heading, index }) {
  return {
    x: position.x,
    z: position.z,
    y: 0, // hop height above the road
    ground: position.y, // road height under the kart
    slope: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    heading,
    grounded: true,
    driftHeld: false,
    drifting: false,
    driftDir: 0,
    driftCharge: 0,
    boost: 0,
    trackIndex: index,
    offset: 0,
    offroad: false,
    lap: 0, // 0 until the kart first crosses the start line
    lastSector: 3,
    speed: 0, // forward speed, handy for the HUD and visuals
    // Item effects, each a countdown in seconds
    spin: 0, // spun out: no control until it ends
    shrink: 0, // zapped small and slow
    star: 0, // Rainbow Rush: fast and untouchable
    slip: 0, // slipstream burst from drafting
    shield: 0, // Bubble Shield
    draftCharge: 0,
    coins: 0,
    trick: 0, // seconds left of the trick animation
    surface: 0, // 0 = main loop, 1+ = a side road
    rampH: 0, // height of the ramp under the kart
    rampSlope: 0,
    rampAir: false, // flying off a ramp (a trick is possible)
    tricked: false,
    lowG: false, // floating after a jump pad
    supported: true, // false when there's no floor under the kart
    falling: false,
    fallTime: 0,
    drone: 0, // seconds left of being carried back after a fall
    safeIndex: index, // last spot on the road, where the drone brings you back
    events: [], // one-frame notifications for sounds and effects
  };
}

export function driftLevel(charge) {
  const L = TUNING.driftLevels;
  return charge >= L[2] ? 3 : charge >= L[1] ? 2 : charge >= L[0] ? 1 : 0;
}

export function stepKart(s, input, dt, track, { frozen = false } = {}) {
  const T = TUNING;
  const sinH = Math.sin(s.heading);
  const cosH = Math.cos(s.heading);
  // forward = (sin h, cos h), right = (-cos h, sin h)
  let vF = s.vx * sinH + s.vz * cosH;
  let vR = -s.vx * cosH + s.vz * sinH;

  if (frozen) {
    s.vx = s.vz = 0;
    s.speed = 0;
    return s;
  }

  // Fell off the track: drop out of sight, then a drone carries the kart back
  if (s.falling) {
    s.fallTime += dt;
    s.vy -= T.gravity * dt;
    s.y += s.vy * dt;
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    s.vx *= Math.exp(-0.6 * dt);
    s.vz *= Math.exp(-0.6 * dt);
    if (s.fallTime > T.fallTime) {
      respawn(s, track);
      s.drone = T.droneTime;
      s.events.push('respawn');
    }
    return s;
  }
  if (s.drone > 0) {
    s.drone = Math.max(0, s.drone - dt);
    s.vx = s.vz = s.vy = 0;
    s.speed = 0;
    s.y = 0.3 + 3.2 * (s.drone / T.droneTime);
    s.grounded = false;
    return s;
  }

  for (const k of ['spin', 'shrink', 'star', 'slip', 'shield', 'trick']) if (s[k] > 0) s[k] = Math.max(0, s[k] - dt);
  if (s.spin > 0) {
    input = { throttle: 0, brake: 0, steer: 0, drift: false };
    s.drifting = false;
    s.driftDir = 0;
    s.driftCharge = 0;
    vF *= Math.exp(-2.5 * dt);
  }

  const steer = Math.max(-1, Math.min(1, input.steer || 0));

  // Hop and drift
  const driftPressed = input.drift && !s.driftHeld;
  s.driftHeld = !!input.drift;
  if (driftPressed && s.grounded) {
    s.vy = T.hopSpeed;
    s.grounded = false;
    s.events.push('hop');
  } else if (driftPressed && s.rampAir && !s.tricked) {
    // A trick in mid-air after a ramp, paid out as a boost on landing
    s.tricked = true;
    s.trick = 0.45;
    s.events.push('trick');
  }
  s.vy -= T.gravity * (s.lowG ? T.lowGravity : 1) * dt;
  s.y += s.vy * dt;
  if (s.y <= 0 && !s.grounded && !s.supported) {
    // Nothing to land on
    s.falling = true;
    s.fallTime = 0;
    s.drifting = false;
    s.driftDir = 0;
    s.events.push('fall');
  } else if (s.y <= 0) {
    if (!s.grounded) {
      s.lowG = false;
      s.grounded = true;
      if (s.rampAir && s.tricked) {
        s.boost = Math.max(s.boost, T.trickBoost);
        s.events.push('boost');
      }
      s.rampAir = false;
      s.tricked = false;
      if (s.driftHeld && Math.abs(steer) > 0.25 && vF > 10 && !s.drifting) {
        s.drifting = true;
        s.driftDir = Math.sign(steer);
        s.driftCharge = 0;
        s.events.push('drift-start');
      }
    }
    s.y = 0;
    s.vy = 0;
  }

  if (s.drifting) {
    const tight = steer * s.driftDir;
    s.driftCharge += dt * (tight > 0.3 ? 1.5 : 1);
    if (!s.driftHeld || vF < 8) {
      const level = vF >= 8 ? driftLevel(s.driftCharge) : 0;
      if (level > 0) {
        s.boost = Math.max(s.boost, T.driftBoosts[level - 1]);
        vF += 3;
        s.events.push('boost');
      }
      s.drifting = false;
      s.driftDir = 0;
      s.driftCharge = 0;
    }
  }

  // Surface
  const here = track.locate({ x: s.x, z: s.z }, s.trackIndex, s.surface);
  const q = here.main;
  const side = here.branch;
  s.dirt = !!side && side.surface === 'dirt' && Math.abs(here.q.offset) <= side.halfWidth + 0.5;
  s.offroad =
    here.surface === 0
      ? Math.abs(q.offset) > track.halfWidth + 1.6
      : !s.dirt && Math.abs(here.q.offset) > side.halfWidth + 1.6;
  if (s.grounded && here.surface === 0 && track.onJumpPad(q.index, q.offset)) {
    s.vy = T.padJump;
    s.grounded = false;
    s.lowG = true;
    s.rampAir = true; // tricks work off jump pads too
    s.tricked = false;
    s.events.push('launch');
  }
  if (s.grounded && here.surface === 0 && track.onBoostPad(q.index, q.offset)) {
    if (s.boost < 0.2) s.events.push('boost');
    s.boost = Math.max(s.boost, T.padBoost);
  }

  let maxSpeed = T.maxSpeed;
  if (s.offroad && s.star <= 0) maxSpeed = s.boost > 0 ? T.maxSpeed * 0.85 : T.offroadMaxSpeed;
  if (s.star > 0) maxSpeed *= T.rushSpeed;
  if (s.slip > 0) maxSpeed *= T.slipSpeed;
  if (s.shrink > 0) maxSpeed *= T.shrinkSpeed;
  maxSpeed *= 1 + Math.min(s.coins, T.maxCoins) * T.coinSpeed;
  if (s.dirt && s.star <= 0) maxSpeed = T.dirtMaxSpeed;
  if (s.boost > 0) {
    maxSpeed = s.dirt ? T.maxSpeed * T.boostSpeed : maxSpeed * (s.offroad ? 1 : T.boostSpeed);
    s.boost = Math.max(0, s.boost - dt);
  }

  // Engine, brakes and drag along the kart's facing direction
  const throttle = input.throttle || 0;
  const brake = input.brake || 0;
  if (s.boost > 0 || (s.star > 0 && s.spin <= 0)) {
    vF = Math.min(vF + T.boostAccel * dt, maxSpeed);
  } else if (throttle > 0 && vF < maxSpeed) {
    const taper = 1 - 0.55 * Math.max(0, vF / maxSpeed);
    vF = Math.min(vF + T.accel * taper * throttle * dt, maxSpeed);
  } else if (brake > 0) {
    if (vF > 0.5) vF = Math.max(0, vF - T.brake * brake * dt);
    else vF = Math.max(vF - T.reverseAccel * brake * dt, -T.reverseMax);
  } else {
    const drag = T.coastDrag * dt;
    vF = Math.abs(vF) < drag ? 0 : vF - Math.sign(vF) * drag;
  }
  if (vF > maxSpeed) vF = Math.max(maxSpeed, vF - (s.offroad ? 40 : s.dirt ? 30 : 12) * dt);
  if (s.grounded && s.rampH === 0) {
    // Gravity along the slope, measured in the direction the kart is facing
    const facing = sinH * here.q.tangent.x + cosH * here.q.tangent.z;
    vF -= T.gravity * T.slopeGravity * here.q.slope * facing * dt;
  }

  // Steering
  if (s.drifting) {
    const amount = 0.55 + 0.5 * steer * s.driftDir; // 0.05 (wide) to 1.05 (tight)
    s.heading -= s.driftDir * amount * T.driftTurnRate * dt;
  } else {
    const speedFactor = Math.min(1, Math.abs(vF) / 6);
    const highSpeedDamp = 1 - 0.35 * Math.min(1, Math.abs(vF) / T.maxSpeed);
    const airFactor = s.grounded ? 1 : 0.6;
    s.heading -= steer * T.steerRate * speedFactor * highSpeedDamp * airFactor * Math.sign(vF || 1) * dt;
  }

  vR *= Math.exp(-(s.drifting ? T.driftGrip : T.grip) * dt);

  const sin2 = Math.sin(s.heading);
  const cos2 = Math.cos(s.heading);
  s.vx = sin2 * vF - cos2 * vR;
  s.vz = cos2 * vF + sin2 * vR;
  s.x += s.vx * dt;
  s.z += s.vz * dt;

  // Walls: slide along them and lose a little speed
  let loc = track.locate({ x: s.x, z: s.z }, q.index, here.surface);
  if (!loc.inside && !loc.free) {
    const q2 = loc.q;
    const limit = (loc.branch ? loc.branch.wallOffset : track.wallOffset) - T.kartRadius;
    const sign = Math.sign(q2.offset);
    const push = Math.abs(q2.offset) - limit;
    if (push > 0) {
      s.x -= q2.side.x * push * sign;
      s.z -= q2.side.z * push * sign;
      bounce(s, q2.side.x * sign, q2.side.z * sign);
    }
    loc = track.locate({ x: s.x, z: s.z }, q.index, here.surface);
  }
  // Barrels and other things to steer around
  for (const o of track.obstacles) {
    const dx = s.x - o.x;
    const dz = s.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + T.kartRadius;
    if (d < min && d > 0.001 && s.ground + s.y < o.y + 2.6) {
      s.x += (dx / d) * (min - d);
      s.z += (dz / d) * (min - d);
      bounce(s, -dx / d, -dz / d);
    }
  }
  s.surface = loc.surface;
  s.supported = loc.supported;
  if (s.grounded && !s.supported) {
    // Drove off an edge: start dropping
    s.grounded = false;
    s.vy = 0;
  }
  s.trackIndex = track.lapIndex(loc);
  s.offset = loc.surface === 0 ? loc.q.offset : 0;

  // Ramps: the ground rises under the kart, then drops away at the lip and launches it
  const ramp = loc.surface === 0 ? track.rampAt(loc.q.index, loc.q.offset) : null;
  const rampH = ramp ? ramp.h : 0;
  if (rampH < s.rampH - 0.3 && s.grounded) {
    const fwd = s.vx * Math.sin(s.heading) + s.vz * Math.cos(s.heading);
    s.grounded = false;
    s.vy = fwd > 5 ? fwd * s.rampSlope * T.launch : 0;
    s.rampAir = fwd > 5;
    s.tricked = false;
    if (s.rampAir) s.events.push('launch');
  }
  // Keep the kart's height in the world steady when the ground under it jumps
  if (!s.grounded) s.y = Math.max(0, s.y + s.rampH - rampH);
  s.rampH = rampH;
  s.rampSlope = ramp ? ramp.slope : 0;
  if (s.supported) s.ground = loc.q.height + rampH;
  if (s.grounded && s.supported && loc.inside && loc.surface === 0) s.safeIndex = loc.q.index;
  s.slope = ramp ? ramp.slope : loc.q.slope;
  s.speed = s.vx * Math.sin(s.heading) + s.vz * Math.cos(s.heading);

  updateLap(s, track);
  return s;
}

// Knock the kart back from a wall or obstacle whose surface faces (-nx, -nz).
function bounce(s, nx, nz) {
  const into = s.vx * nx + s.vz * nz;
  if (into <= 0) return;
  s.vx -= nx * into * 1.4;
  s.vz -= nz * into * 1.4;
  s.vx *= 0.93;
  s.vz *= 0.93;
  if (into > 6) s.events.push('bump');
}

// The loop is split into four sectors that must be passed in order,
// so a lap only counts when the kart really went all the way around.
function updateLap(s, track) {
  const sector = Math.floor((s.trackIndex * 4) / track.sampleCount);
  if (sector === (s.lastSector + 1) % 4) {
    s.lastSector = sector;
    if (sector === 0) {
      s.lap++;
      s.events.push('lap');
    }
  } else if (sector === (s.lastSector + 3) % 4) {
    if (s.lastSector === 0) s.lap--;
    s.lastSector = sector;
  }
}

export function respawn(s, track) {
  const i = track.pastGap(s.safeIndex ?? s.trackIndex);
  s.trackIndex = i;
  s.safeIndex = i;
  const c = track.point(i);
  const t = track.tangents[i];
  s.x = c.x;
  s.z = c.z;
  s.ground = c.y;
  s.y = 2;
  s.vx = s.vz = s.vy = 0;
  s.heading = Math.atan2(t.x, t.z);
  s.grounded = false;
  s.drifting = false;
  s.driftCharge = 0;
  s.boost = 0;
  s.spin = 0;
  s.surface = 0;
  s.rampH = 0;
  s.rampAir = false;
  s.lowG = false;
  s.falling = false;
  s.supported = true;
}

// A single number for ranking racers: laps completed plus how far around the current lap.
export function raceProgress(s, track) {
  return s.lap + s.trackIndex / track.sampleCount;
}
