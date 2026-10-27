// Merges keyboard, gamepad and on-screen touch buttons into one input state.

const KEYS = {
  gas: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  drift: ['Space', 'ShiftLeft', 'ShiftRight'],
  item: ['KeyE', 'KeyF'],
};

export class Input {
  constructor() {
    this.down = new Set();
    this.touch = new Set();
    this.pressedOnce = new Set();
    this.steerSmooth = 0;
    this.stickX = null; // touch joystick: -1 (full left) to 1 (full right), null when not touched

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return; // typing a name or room code
      if (Object.values(KEYS).flat().includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedOnce.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    this.#bindTouch();
  }

  #bindTouch() {
    const isTouch = matchMedia('(pointer: coarse)').matches;
    const pad = document.getElementById('touch');
    if (!isTouch || !pad) return;
    this.touchUI = pad;
    this.#bindStick(document.getElementById('stick'));
    for (const btn of pad.querySelectorAll('button')) {
      const key = btn.dataset.key;
      const on = (e) => {
        e.preventDefault();
        if (key === 'item') this.pressedOnce.add('KeyE');
        this.touch.add(key);
        btn.classList.add('on');
      };
      const off = (e) => {
        e.preventDefault();
        this.touch.delete(key);
        btn.classList.remove('on');
      };
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('pointerleave', off);
    }
  }

  // Steering joystick: drag the knob left or right. Only sideways movement counts.
  #bindStick(stick) {
    if (!stick) return;
    const knob = stick.querySelector('.stick-knob');
    let id = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      const reach = r.width / 2;
      let dx = e.clientX - (r.left + reach);
      let dy = e.clientY - (r.top + reach);
      const len = Math.hypot(dx, dy);
      if (len > reach) {
        dx *= reach / len;
        dy *= reach / len;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const x = dx / reach;
      // Small dead zone in the middle, then full range out to the edge
      this.stickX = Math.abs(x) < 0.12 ? 0 : Math.sign(x) * Math.min(1, (Math.abs(x) - 0.12) / 0.75);
    };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.stickX = null;
      knob.style.transform = '';
      stick.classList.remove('on');
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      stick.setPointerCapture(id);
      stick.classList.add('on');
      move(e);
    });
    stick.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
  }

  showTouch(show) {
    if (!show && this.stickX !== null) this.stickX = null;
    if (this.touchUI) this.touchUI.classList.toggle('hidden', !show);
  }

  #held(action) {
    return KEYS[action].some((k) => this.down.has(k)) || this.touch.has(action);
  }

  // True once per key press (for things like respawn and mute).
  consume(code) {
    const had = this.pressedOnce.has(code);
    this.pressedOnce.delete(code);
    return had;
  }

  read(dt) {
    let throttle = this.#held('gas') ? 1 : 0;
    let brake = this.#held('brake') ? 1 : 0;
    let steerTarget = (this.#held('right') ? 1 : 0) - (this.#held('left') ? 1 : 0);
    // A tap shorter than one frame still counts (needed for quick ramp tricks)
    const tapped = KEYS.drift.filter((k) => this.consume(k)).length > 0;
    let drift = this.#held('drift') || tapped;
    let analog = false;

    if (this.stickX !== null) {
      steerTarget = this.stickX;
      analog = true;
    }

    const gp = navigator.getGamepads?.().find((g) => g && g.connected);
    if (gp) {
      const x = gp.axes[0] || 0;
      if (Math.abs(x) > 0.15) {
        steerTarget = x;
        analog = true;
      }
      const b = (i) => gp.buttons[i]?.pressed;
      const v = (i) => gp.buttons[i]?.value || 0;
      throttle = Math.max(throttle, b(0) ? 1 : 0, v(7));
      brake = Math.max(brake, b(1) ? 1 : 0, v(6) > 0.3 ? 1 : 0);
      drift = drift || b(4) || b(5);
      if (b(3) && !this.gpRespawnHeld) this.pressedOnce.add('KeyR');
      this.gpRespawnHeld = b(3);
      if (b(2) && !this.gpItemHeld) this.pressedOnce.add('KeyE');
      this.gpItemHeld = b(2);
    }

    // Ease keyboard steering in and out so the kart doesn't twitch
    if (analog) this.steerSmooth = steerTarget;
    else {
      const rate = steerTarget === 0 ? 10 : 6;
      this.steerSmooth += (steerTarget - this.steerSmooth) * Math.min(1, rate * dt);
    }
    return { throttle, brake, steer: this.steerSmooth, drift };
  }
}
