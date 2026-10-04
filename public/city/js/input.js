// Keyboard + mouse (pointer lock) + touch controls, sampled once per frame.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, wheel: 0 };
    this.locked = false;
    this.touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.stick = { x: 0, y: 0, id: null };
    this.touchBtns = new Set();
    this.touchPressed = new Set();
    this.lookId = null;
    this.enabled = false;

    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ControlLeft'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked && !this.touch) { canvas.requestPointerLock?.(); }
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });

    if (this.touch) this.setupTouch();
  }

  setupTouch() {
    const pad = document.getElementById('touch');
    pad.classList.remove('hidden');
    const stickEl = document.getElementById('stick');
    const knob = document.getElementById('knob');
    const look = document.getElementById('lookArea');
    const R = 55;
    stickEl.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.stick.id = t.identifier;
      const r = stickEl.getBoundingClientRect();
      this.stick.cx = r.left + r.width / 2;
      this.stick.cy = r.top + r.height / 2;
      move(t);
      e.preventDefault();
    }, { passive: false });
    const move = (t) => {
      let dx = t.clientX - this.stick.cx, dy = t.clientY - this.stick.cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      this.stick.x = dx / R;
      this.stick.y = -dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) move(t);
        if (t.identifier === this.lookId) {
          this.mouse.dx += (t.clientX - this.lookX) * 2.2;
          this.mouse.dy += (t.clientY - this.lookY) * 2.2;
          this.lookX = t.clientX; this.lookY = t.clientY;
        }
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          this.stick.id = null; this.stick.x = this.stick.y = 0;
          knob.style.transform = '';
        }
        if (t.identifier === this.lookId) this.lookId = null;
      }
    };
    addEventListener('touchend', end);
    addEventListener('touchcancel', end);
    look.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.lookId = t.identifier;
      this.lookX = t.clientX; this.lookY = t.clientY;
      e.preventDefault();
    }, { passive: false });
    for (const b of document.querySelectorAll('#touch [data-btn]')) {
      const name = b.dataset.btn;
      b.addEventListener('touchstart', (e) => {
        this.touchBtns.add(name);
        this.touchPressed.add(name);
        b.classList.add('down');
        e.preventDefault();
        e.stopPropagation();
      }, { passive: false });
      const up = (e) => { this.touchBtns.delete(name); b.classList.remove('down'); e.preventDefault(); };
      b.addEventListener('touchend', up);
      b.addEventListener('touchcancel', up);
    }
  }

  key(c) { return this.keys.has(c); }
  hit(c) { return this.pressed.has(c); }
  tb(n) { return this.touchBtns.has(n); }
  tp(n) { return this.touchPressed.has(n); }

  /** Snapshot of everything the game needs this frame; clears one-shot presses. */
  sample() {
    const k = (c) => this.key(c);
    const h = (c) => this.hit(c);
    let mx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let my = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    if (this.stick.id !== null) { mx = this.stick.x; my = this.stick.y; }
    let slot = null;
    for (let i = 1; i <= 5; i++) if (h(`Digit${i}`)) slot = i - 1;
    const stickFull = Math.hypot(this.stick.x, this.stick.y) > 0.92;
    const s = {
      move: { x: mx, y: my },
      sprint: k('ShiftLeft') || k('ShiftRight') || (this.stick.id !== null && stickFull) || this.tb('sprint'),
      jumpPressed: h('Space') || this.tp('jump'),
      jump: k('Space') || this.tb('jump'),
      crouch: k('KeyC') || k('ControlLeft') || this.tb('crouch'),
      crouchPressed: h('KeyC') || h('ControlLeft') || this.tp('crouch'),
      attack: this.mouse.left || this.tb('attack'),
      attackPressed: this.mouse.leftPressed || this.tp('attack'),
      aim: this.mouse.right || this.tb('aim'),
      reloadPressed: h('KeyR'),
      enterPressed: h('KeyF') || h('Enter') || this.tp('enter'),
      interact: k('KeyE') || this.tb('interact'),
      weaponNext: this.mouse.wheel ? Math.sign(this.mouse.wheel) : h('KeyQ') ? -1 : h('Tab') || this.tp('weapon') ? 1 : 0,
      weaponSlot: slot,
      down: k('ShiftLeft') || k('ShiftRight') || this.tb('crouch') ? 1 : 0,
      strafe: (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0),
      horn: h('KeyH'),
      map: h('KeyM') || this.tp('map'),
      camera: h('KeyV'),
      mute: h('KeyN'),
      pause: h('KeyP') || h('Escape'),
      lookX: this.mouse.dx,
      lookY: this.mouse.dy,
    };
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.mouse.leftPressed = false;
    this.pressed.clear();
    this.touchPressed.clear();
    return s;
  }
}
