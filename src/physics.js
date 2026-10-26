// Arcade kart physics. Kept free of rendering code so the same rules can run
// on every player's machine (and on a server) once online races arrive.

export const TUNING = {
  maxSpeed: 33, // m/s on road (~119 km/h)
  offroadMaxSpeed: 15,
  accel: 26,
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
  boostAccel: 70,
  driftLevels: [0.9, 2.0, 3.2], // seconds of charge for blue, orange, purple sparks
  driftBoosts: [0.7, 1.2, 1.8], // boost seconds awarded per level
  padBoost: 1.3,
  kartRadius: 1.1,
};

export function createKartState({ position, heading, index }) {
  return {
    x: position.x,
    z: position.z,
    y: 0,
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

  const steer = Math.max(-1, Math.min(1, input.steer || 0));

  // Hop and drift
  const driftPressed = input.drift && !s.driftHeld;
  s.driftHeld = !!input.drift;
  if (driftPressed && s.grounded) {
    s.vy = T.hopSpeed;
    s.grounded = false;
    s.events.push('hop');
  }
  s.vy -= T.gravity * dt;
  s.y += s.vy * dt;
  if (s.y <= 0) {
    if (!s.grounded) {
      s.grounded = true;
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
  const q = track.query({ x: s.x, z: s.z }, s.trackIndex);
  s.offroad = Math.abs(q.offset) > track.halfWidth + 1.6;
  if (s.grounded && track.onBoostPad(q.index, q.offset)) {
    if (s.boost < 0.2) s.events.push('boost');
    s.boost = Math.max(s.boost, T.padBoost);
  }

  let maxSpeed = T.maxSpeed;
  if (s.offroad) maxSpeed = s.boost > 0 ? T.maxSpeed * 0.85 : T.offroadMaxSpeed;
  if (s.boost > 0) {
    maxSpeed *= s.offroad ? 1 : T.boostSpeed;
    s.boost = Math.max(0, s.boost - dt);
  }

  // Engine, brakes and drag along the kart's facing direction
  const throttle = input.throttle || 0;
  const brake = input.brake || 0;
  if (s.boost > 0) {
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
  if (vF > maxSpeed) vF = Math.max(maxSpeed, vF - (s.offroad ? 40 : 12) * dt);

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
  const q2 = track.query({ x: s.x, z: s.z }, q.index);
  const limit = track.wallOffset - T.kartRadius;
  if (Math.abs(q2.offset) > limit) {
    const sign = Math.sign(q2.offset);
    const push = Math.abs(q2.offset) - limit;
    s.x -= q2.side.x * push * sign;
    s.z -= q2.side.z * push * sign;
    const into = (s.vx * q2.side.x + s.vz * q2.side.z) * sign;
    if (into > 0) {
      s.vx -= q2.side.x * into * sign * 1.4;
      s.vz -= q2.side.z * into * sign * 1.4;
      s.vx *= 0.93;
      s.vz *= 0.93;
      if (into > 6) s.events.push('bump');
    }
  }
  s.trackIndex = q2.index;
  s.offset = q2.offset;
  s.speed = s.vx * Math.sin(s.heading) + s.vz * Math.cos(s.heading);

  updateLap(s, track);
  return s;
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
  const i = s.trackIndex;
  const c = track.point(i);
  const t = track.tangents[i];
  s.x = c.x;
  s.z = c.z;
  s.y = 2;
  s.vx = s.vz = s.vy = 0;
  s.heading = Math.atan2(t.x, t.z);
  s.grounded = false;
  s.drifting = false;
  s.driftCharge = 0;
  s.boost = 0;
}

// A single number for ranking racers: laps completed plus how far around the current lap.
export function raceProgress(s, track) {
  return s.lap + s.trackIndex / track.sampleCount;
}
