import * as THREE from 'three';
import { createEnvironment } from './environment.js';
import { Penguin } from './penguin.js';

// Where party members stand: you in the middle, friends beside and behind.
const SLOTS = [[0, 0], [-2.3, -1.1], [2.3, -1.1], [-4.4, -2.4]];

function nameSprite(text, isMe) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.font = '56px "Lilita One", "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 256, 50);
  g.fillStyle = isMe ? '#ffe03a' : '#ffffff';
  g.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(2.4, 0.45, 1);
  s.renderOrder = 10;
  return s;
}

export class Lobby {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 900);
    this.env = createEnvironment(this.scene, { shadowSize: 10 });
    this.env.sun.position.set(-8, 20, 18);
    this.time = 0;
    this.locker = false;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.mouse = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.slots = [];

    // stage: a round ice floe with a glowing ring under the player
    const floe = new THREE.Mesh(
      new THREE.CylinderGeometry(7.5, 8.2, 3, 48),
      new THREE.MeshPhysicalMaterial({ color: 0xd9f1ff, roughness: 0.25, clearcoat: 1 }),
    );
    floe.position.set(-1, -1.5, -1.5);
    floe.receiveShadow = true;
    this.scene.add(floe);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.15, 48),
      new THREE.MeshBasicMaterial({ color: 0xffe03a, transparent: true, opacity: 0.8 }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.scene.add(this.ring);
    this.resize(innerWidth / innerHeight);
  }

  /** members: [{id, name, skin}] with `youId` the local player. */
  setMembers(members, youId) {
    const ordered = [...members].sort((a, b) => (a.id === youId ? -1 : b.id === youId ? 1 : 0));
    // drop slots whose member left
    this.slots = this.slots.filter((s) => {
      const keep = ordered.some((m) => m.id === s.id);
      if (!keep) { s.penguin.dispose(); s.tag.removeFromParent(); }
      return keep;
    });
    ordered.forEach((m, i) => {
      let slot = this.slots.find((s) => s.id === m.id);
      if (!slot) {
        slot = { id: m.id, penguin: new Penguin(m.skin), tag: null, name: null };
        slot.penguin.root.traverse((o) => { o.userData.slotId = m.id; });
        this.scene.add(slot.penguin.root);
        this.slots.push(slot);
      }
      if (slot.penguin.skinId !== m.skin && !(m.id === youId && this.previewing)) {
        slot.penguin.setSkin(m.skin);
        slot.penguin.root.traverse((o) => { o.userData.slotId = m.id; });
      }
      if (slot.name !== m.name) {
        if (slot.tag) slot.tag.removeFromParent();
        slot.tag = nameSprite(m.name, m.id === youId);
        slot.name = m.name;
        this.scene.add(slot.tag);
      }
      const [x, z] = SLOTS[i] || SLOTS[0];
      slot.penguin.root.position.set(x, 0, z);
      slot.penguin.root.rotation.y = -x * 0.08;
      slot.tag.position.set(x, 2.55, z);
      slot.isMe = m.id === youId;
    });
    this.youId = youId;
  }

  me() { return this.slots.find((s) => s.isMe); }

  previewSkin(skinId) {
    const me = this.me();
    if (!me) return;
    this.previewing = true;
    if (me.penguin.skinId !== skinId) {
      me.penguin.setSkin(skinId);
      me.penguin.root.traverse((o) => { o.userData.slotId = me.id; });
    }
  }

  stopPreview(skinId) {
    this.previewing = false;
    this.previewSkin(skinId);
    this.previewing = false;
  }

  setLocker(on) { this.locker = on; }

  setPointer(ndcX, ndcY) { this.mouse.set(ndcX, ndcY); }

  /** True when the pointer is over the local player's penguin. */
  hitMe(ndcX, ndcY) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const me = this.me();
    if (!me) return false;
    return this.raycaster.intersectObject(me.penguin.root, true).length > 0;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.narrow = aspect < 1;
  }

  update(dt) {
    this.time += dt;
    this.env.update(this.time);
    const t = this.time;

    // camera: wide party shot, or a close-up on your penguin in the locker
    // on portrait screens the UI sits above and below, so frame the penguins lower
    const targetPos = this.locker
      ? new THREE.Vector3(this.narrow ? 0 : 1.6, this.narrow ? 2.6 : 1.9, this.narrow ? 7 : 5.2)
      : new THREE.Vector3(this.narrow ? -0.6 : 0.6, 2.4, this.narrow ? 14 : 8.5);
    const targetLook = this.locker
      ? new THREE.Vector3(this.narrow ? 0 : 1.6, this.narrow ? 3.4 : 1.05, 0)
      : new THREE.Vector3(this.narrow ? -0.6 : 0.6, this.narrow ? 2.6 : 1.2, -0.8);
    if (!this.camInit) { this.camPos.copy(targetPos); this.camLook.copy(targetLook); this.camInit = true; }
    this.camPos.lerp(targetPos, Math.min(1, dt * 4));
    this.camLook.lerp(targetLook, Math.min(1, dt * 4));
    this.camera.position.copy(this.camPos);
    this.camera.position.x += Math.sin(t * 0.25) * 0.15;
    this.camera.lookAt(this.camLook);

    for (const s of this.slots) {
      s.penguin.update(dt, {});
      if (s.isMe) {
        // turn a little toward the pointer, spin slowly in the locker
        const want = this.locker ? Math.sin(t * 0.6) * 0.6 : this.mouse.x * 0.5;
        s.penguin.root.rotation.y += (want - s.penguin.root.rotation.y) * Math.min(1, dt * 3);
        s.penguin.tilt.position.y += Math.abs(Math.sin(t * 3)) * 0.04;
      }
      s.tag.visible = !this.locker;
    }
    this.ring.material.opacity = 0.55 + Math.sin(t * 3) * 0.25;
  }
}
