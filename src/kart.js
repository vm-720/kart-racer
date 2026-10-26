import * as THREE from 'three';
import { driftLevel } from './physics.js';

// The visible kart: body, wheels, driver, drift sparks and boost flames.
// It only reads the physics state, it never changes it.

const SPARK_COLORS = [null, new THREE.Color('#3fb6ff'), new THREE.Color('#ff8a1f'), new THREE.Color('#d36bff')];
const MAX_SPARKS = 160;

export class KartView {
  constructor({ color = '#e8433f', gradientMap }) {
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ'; // yaw first, then pitch on hills
    this.pitch = 0;
    this.body = new THREE.Group(); // tilts and hops; wheels stay planted
    this.group.add(this.body);
    const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap });

    const paint = toon(color);
    const dark = toon('#2b2550');
    const chrome = toon('#d9dbe8');

    // Chassis
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.45, 3.2), paint);
    base.position.y = 0.55;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 1.0), paint);
    nose.position.set(0, 0.6, 1.9);
    nose.rotation.x = 0.25;
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.3, 0.35), dark);
    bumper.position.set(0, 0.42, 2.35);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.35), dark);
    seat.position.set(0, 1.15, -0.85);
    const engine = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 0.7), chrome);
    engine.position.set(0, 0.95, -1.35);
    const wheelBar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), dark);
    wheelBar.position.set(0, 1.2, 0.45);
    wheelBar.rotation.x = -0.9;
    const steering = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 6, 16), dark);
    steering.position.set(0, 1.42, 0.25);
    steering.rotation.x = -0.6;
    this.steeringWheel = steering;
    for (const m of [base, nose, bumper, seat, engine, wheelBar, steering]) {
      m.castShadow = true;
      this.body.add(m);
    }

    // Exhaust pipes, which also anchor the boost flames
    this.flames = [];
    for (const x of [-0.45, 0.45]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.6, 8), chrome);
      pipe.rotation.x = Math.PI / 2 - 0.3;
      pipe.position.set(x, 1.05, -1.8);
      this.body.add(pipe);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 1.2, 8),
        new THREE.MeshBasicMaterial({ color: '#ffb000', transparent: true, opacity: 0.9 }),
      );
      flame.rotation.x = -Math.PI / 2 - 0.3;
      flame.position.set(x, 1.0, -2.55);
      flame.visible = false;
      this.body.add(flame);
      this.flames.push(flame);
    }

    // Driver (a stand-in until the real cast arrives)
    const suit = toon('#3f7bff');
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.5, 4, 10), suit);
    torso.position.set(0, 1.6, -0.45);
    torso.rotation.x = 0.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), toon('#f2c49b'));
    head.position.set(0, 2.35, -0.38);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), paint);
    helmet.position.copy(head.position).add(new THREE.Vector3(0, 0.05, -0.04));
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.1), toon('#1d1b3a'));
    visor.position.set(0, 2.4, 0.02);
    for (const m of [torso, head, helmet, visor]) {
      m.castShadow = true;
      this.body.add(m);
    }

    // Wheels
    this.wheels = [];
    this.frontPivots = [];
    const tire = new THREE.CylinderGeometry(0.48, 0.48, 0.5, 14);
    tire.rotateZ(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(0.22, 0.22, 0.52, 10);
    hub.rotateZ(Math.PI / 2);
    for (const [x, z, front] of [[-1.15, 1.3, true], [1.15, 1.3, true], [-1.2, -1.2, false], [1.2, -1.2, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.48, z);
      const wheel = new THREE.Group();
      const t = new THREE.Mesh(tire, dark);
      t.castShadow = true;
      wheel.add(t, new THREE.Mesh(hub, chrome));
      if (!front) wheel.scale.set(1.25, 1.1, 1.1);
      pivot.add(wheel);
      this.group.add(pivot);
      this.wheels.push(wheel);
      if (front) this.frontPivots.push(pivot);
    }

    // Soft blob shadow so the kart reads clearly even mid-hop
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(1.8, 20),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.22, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.04;
    blob.scale.set(1, 1.5, 1);
    this.group.add(blob);
    this.blob = blob;

    this.#buildSparks();
    this.visualYaw = 0;
    this.lean = 0;
    this.wheelSpin = 0;
  }

  #buildSparks() {
    const geo = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkCol = new Float32Array(MAX_SPARKS * 3);
    this.sparkVel = new Float32Array(MAX_SPARKS * 3);
    this.sparkLife = new Float32Array(MAX_SPARKS);
    geo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparks = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, depthWrite: false }),
    );
    this.sparks.frustumCulled = false;
    this.nextSpark = 0;
  }

  // Sparks live in world space, so add them to the scene separately from the kart.
  get effects() {
    return this.sparks;
  }

  #emitSpark(pos, color, vel) {
    const i = this.nextSpark;
    this.nextSpark = (i + 1) % MAX_SPARKS;
    this.sparkPos.set([pos.x, pos.y, pos.z], i * 3);
    this.sparkVel.set([vel.x, vel.y, vel.z], i * 3);
    this.sparkCol.set([color.r, color.g, color.b], i * 3);
    this.sparkLife[i] = 0.35;
  }

  update(s, dt, steer) {
    this.group.position.set(s.x, s.ground || 0, s.z);

    // While drifting the kart swings sideways for that classic look
    const targetYaw = s.drifting ? s.driftDir * 0.42 : 0;
    this.visualYaw += (targetYaw - this.visualYaw) * Math.min(1, dt * 10);
    this.group.rotation.y = s.heading - this.visualYaw;
    const facingSlope = (s.slope || 0) * Math.cos(this.visualYaw);
    this.pitch += (-Math.atan(facingSlope) - this.pitch) * Math.min(1, dt * 10);
    this.group.rotation.x = this.pitch;
    this.group.updateMatrixWorld();

    const targetLean = (s.drifting ? s.driftDir * 0.12 : steer * 0.06) * Math.min(1, Math.abs(s.speed) / 15);
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 8);
    this.body.rotation.z = this.lean;
    this.body.position.y = s.y;
    this.body.rotation.x = s.boost > 0 ? -0.05 : 0;
    this.blob.scale.setScalar(1 - Math.min(0.4, s.y * 0.2));
    this.blob.scale.y *= 1.5;

    this.wheelSpin += (s.speed / 0.48) * dt;
    for (const w of this.wheels) {
      w.rotation.x = this.wheelSpin;
      w.position.y = s.y;
    }
    const steerAngle = (s.drifting ? s.driftDir * 0.3 : steer) * 0.4;
    for (const p of this.frontPivots) p.rotation.y = -steerAngle;
    this.steeringWheel.rotation.z = steerAngle * 1.5;

    // Boost flames
    for (const f of this.flames) {
      f.visible = s.boost > 0;
      if (f.visible) {
        f.scale.setScalar(0.8 + Math.random() * 0.6);
        f.material.color.set(Math.random() > 0.5 ? '#ffb000' : '#ff5a1f');
      }
    }

    // Drift sparks from the rear wheels
    const level = s.drifting ? driftLevel(s.driftCharge) : 0;
    if (level > 0 && s.grounded) {
      for (const x of [-1.2, 1.2]) {
        const wp = new THREE.Vector3(x, 0.15, -1.6).applyMatrix4(this.group.matrixWorld);
        for (let k = 0; k < 2; k++) {
          const vel = new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4);
          this.#emitSpark(wp, SPARK_COLORS[level], vel);
        }
      }
    }
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.sparkLife[i] <= 0) {
        this.sparkPos[i * 3 + 1] = -100;
        continue;
      }
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 20 * dt;
      for (let a = 0; a < 3; a++) this.sparkPos[i * 3 + a] += this.sparkVel[i * 3 + a] * dt;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;
  }
}
