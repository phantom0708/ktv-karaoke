// Stage effects (disco, strobe, laser, smoke) and one-shot shows (confetti, sparks, balloons,
// bubbles, gifts, entrance effects).
import * as THREE from 'three';
import { toon, glow, emissive } from './toon.js';

const PALETTE = [0xff7a59, 0xffd59e, 0x34d399, 0x38bdf8, 0xf472b6, 0xfacc15, 0xa78bfa];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class FX {
  constructor(world) {
    this.w = world; this.s = world.scene; this.live = []; this.playing = false; this.effects = {};
    this.clipPlanes = world.clip ?? [];
    // disco ball + coloured sweeping spots
    this.disco = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.15, flatShading: true }));
    this.disco.add(ball, new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.2), toon(0x111111)).translateY(0.8));
    this.disco.position.set(0, 7.1, 6.0); this.s.add(this.disco); // high and behind the audience: never blocks the screen
    this.spots = PALETTE.slice(0, 2).map((c, i) => { const l = new THREE.SpotLight(c, 0, 18, 0.32, 0.5, 1.3); l.position.set(0, 6.9, 6.0); l.target.position.set(Math.cos(i) * 4, 0, 2 + Math.sin(i) * 3); this.s.add(l, l.target); return l; });
    this.stageSpots = [-2.5, 2.5].map((x, i) => { const l = new THREE.SpotLight(0xfff1e0, 0, 14, 0.3, 0.6, 1.2); l.position.set(x, 7, -1); l.target.position.set(x, 0.4, -4.5); this.s.add(l, l.target); return l; });
    // front key light on the singers, from the audience side
    this.front = new THREE.SpotLight(0xfff4e6, 90, 18, 0.45, 0.5, 1.1); this.front.position.set(0, 5.5, 3.5); this.front.target.position.set(0, 1.4, -4); this.s.add(this.front, this.front.target);
    // strobe: the whole room flashes (uniform ambient burst) + four ceiling strobe heads
    this.strobeAmb = new THREE.AmbientLight(0xffffff, 0); this.s.add(this.strobeAmb);
    this.strobeHeads = [];
    for (const [x, z] of [[-8.5, -5.5], [8.5, -5.5], [-8.5, 8.5], [8.5, 8.5]]) {
      const head = new THREE.Group(); head.position.set(x, 7.75, z);
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.35), emissive(0x222222)); const flare = glow(0xffffff, 3.2, 0);
      head.add(lens, flare); this.s.add(head); this.strobeHeads.push({ lens, flare }); // the flash itself is one ambient light
    }
    // lasers: five emitters (stage corners, back corners, ceiling centre) sweeping the whole room;
    // beams are long enough to reach the far walls and are clipped exactly at walls/floor/ceiling
    this.lasers = new THREE.Group(); this.lasers.visible = false; this.s.add(this.lasers);
    const EMITTERS = [
      { pos: [-6.4, 0.75, -4.0], look: [-2, 1.6, 6], col: 0x34d399 },
      { pos: [6.4, 0.75, -4.0], look: [2, 1.6, 6], col: 0xf472b6 },
      { pos: [-9.4, 6.9, 9.2], look: [2, 1, -3], col: 0x38bdf8 },
      { pos: [9.4, 6.9, 9.2], look: [-2, 1, -3], col: 0xa3e635 },
      { pos: [0, 7.7, 1.5], look: [0, 0, 1.6], col: 0xff4d6d },
    ];
    EMITTERS.forEach((em, k) => {
      const emitter = new THREE.Group(); emitter.position.set(...em.pos); emitter.lookAt(new THREE.Vector3(...em.look));
      emitter.add(new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.35), toon(0x18181b)));
      for (let i = 0; i < 7; i++) {
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 30, 5), new THREE.MeshBasicMaterial({ color: em.col, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
        beam.geometry.rotateX(Math.PI / 2); beam.geometry.translate(0, 0, 15);
        beam.userData.i = i; beam.userData.k = k; beam.userData.ceiling = em.pos[1] > 7.5; emitter.add(beam);
      }
      emitter.add(glow(em.col, 0.6, 0.9));
      this.lasers.add(emitter);
    });
    // smoke puffs
    this.smoke = new THREE.Group();
    for (let i = 0; i < 26; i++) { const p = glow(0xc7c2d6, 2.6 + Math.random() * 2, 0.0); p.material.blending = THREE.NormalBlending; p.position.set((Math.random() - 0.5) * 15, 0.3 + Math.random() * 0.6, -3.5 + Math.random() * 11); p.userData.v = (Math.random() - 0.5) * 0.3; this.smoke.add(p); }
    this.s.add(this.smoke);
    this.#clip(this.lasers); this.#clip(this.smoke); this.#clip(this.disco);
    for (const h of this.strobeHeads) this.#clip(h.flare.parent);
  }

  #clip(obj) {
    if (!this.clipPlanes.length) return obj;
    // clone first: toon materials are cached and shared with other scenes (the lobby must not be clipped)
    obj.traverse((o) => { if (o.material && !o.material.userData.clipped) { const m = o.material.clone(); m.clippingPlanes = this.clipPlanes; m.userData.clipped = true; o.material = m; } });
    return obj;
  }

  // disco spot lights only exist while disco is on (each real light costs on every pixel)
  setEffects(e) { this.effects = e; this.lasers.visible = !!e.laser; for (const l of this.spots) l.visible = !!e.disco; }
  setQuality(level) { this.lowQ = level === 'low'; for (const l of this.stageSpots) l.visible = !this.lowQ; }

  #add(obj, life, step) { this.#clip(obj); this.s.add(obj); this.live.push({ obj, life, age: 0, step }); }

  burst(kind, at, count = 80) {
    const geo = kind === 'sparks' ? null : new THREE.PlaneGeometry(0.09, 0.05);
    for (let i = 0; i < count; i++) {
      const o = kind === 'sparks' ? glow(pick([0xfff1c1, 0xffd59e, 0xffffff]), 0.18, 1) : new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: pick(PALETTE), side: THREE.DoubleSide }));
      o.position.set(at.x + (Math.random() - 0.5) * 0.5, at.y, at.z + (Math.random() - 0.5) * 0.5);
      const v = new THREE.Vector3((Math.random() - 0.5) * 4, 4 + Math.random() * 4, (Math.random() - 0.5) * 4);
      this.#add(o, 2.5 + Math.random(), (o, dt, k) => {
        v.y -= (kind === 'sparks' ? 9 : 5) * dt; v.multiplyScalar(kind === 'sparks' ? 0.99 : 0.97);
        o.position.addScaledVector(v, dt); if (o.position.y < 0.02) { o.position.y = 0.02; v.set(0, 0, 0); }
        if (!o.isSprite) { o.rotation.x += dt * 8; o.rotation.y += dt * 5; } else o.material.opacity = 1 - k;
      });
    }
  }

  balloons(at) {
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), toon(pick(PALETTE))); b.scale.y = 1.2; g.add(b);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.9), toon(0xffffff)).translateY(-0.75));
      const side = Math.random() < 0.5 ? -1 : 1; g.position.set(side * (6 + Math.random() * 3), 1.0 + Math.random(), -2.5 + Math.random() * 10); // along the side walls, never in front of the screen
      const sp = 0.8 + Math.random() * 0.8; const ph = Math.random() * 6;
      this.#add(g, 8, (o, dt, k, t) => { o.position.y = Math.min(7.2, o.position.y + sp * dt); o.position.x += Math.sin(t * 1.5 + ph) * dt * 0.3; if (k > 0.8) o.scale.setScalar((1 - k) * 5); });
    }
  }

  bubbles(at) {
    for (let i = 0; i < 40; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.08 + Math.random() * 0.12, 12, 8), new THREE.MeshPhongMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.35, shininess: 120, specular: 0xffffff }));
      b.position.set(at.x + (Math.random() - 0.5) * 2, 1 + Math.random(), at.z + (Math.random() - 0.5) * 2);
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8);
      this.#add(b, 5 + Math.random() * 2, (o, dt) => o.position.addScaledVector(v, dt));
    }
  }

  gift(item, at) {
    const g = new THREE.Group();
    if (item === 'flowers') { for (let i = 0; i < 6; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), toon(pick([0xfda4af, 0xf472b6, 0xfde68a]))); f.position.set(Math.cos(i) * 0.15, 0.25 + (i % 2) * 0.08, Math.sin(i) * 0.15); g.add(f); } g.add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 10), toon(0x16a34a)).rotateX(Math.PI)); }
    if (item === 'star') g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.35), emissive(0xfde047, 1.3)), glow(0xfde047, 2, 0.8));
    if (item === 'trophy') g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.08, 0.35, 16), toon(0xfbbf24)).translateY(0.3), new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.15, 16), toon(0x92400e)), glow(0xfbbf24, 1.6, 0.6));
    g.position.set(at.x, 3.2, at.z);
    this.#add(g, 4.5, (o, dt, k, t) => { o.rotation.y += dt * 2; o.position.y = 2.6 + Math.sin(t * 3) * 0.1 + k * 0.6; o.scale.setScalar(Math.min(1, (4.5 - k * 4.5) * 2) * 1.4); });
    this.burst('sparks', { x: at.x, y: 2.8, z: at.z }, 30);
  }

  entrance(item, at) {
    if (item === 'entrance-confetti') this.burst('confetti', { x: at.x, y: 0.5, z: at.z }, 60);
    if (item === 'entrance-smoke') for (let i = 0; i < 12; i++) { const p = glow(0xd4d4d8, 1.5, 0.8); p.material.blending = THREE.NormalBlending; p.position.set(at.x + (Math.random() - 0.5), 0.3, at.z + (Math.random() - 0.5)); this.#add(p, 2.5, (o, dt, k) => { o.position.y += dt * 0.6; o.scale.setScalar(1.5 + k * 2); o.material.opacity = 0.8 * (1 - k); }); }
    if (item === 'entrance-spotlight') { const l = new THREE.SpotLight(0xfff1c1, 120, 14, 0.25, 0.4, 1); l.position.set(at.x, 8, at.z); l.target.position.set(at.x, 0, at.z); this.s.add(l.target); this.#add(l, 3, (o, dt, k) => { o.intensity = 120 * (1 - k); }); }
    if (item === 'entrance-rainbow') { const arc = new THREE.Group(); PALETTE.forEach((c, i) => arc.add(new THREE.Mesh(new THREE.TorusGeometry(1.6 + i * 0.12, 0.06, 6, 40, Math.PI), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 })))); arc.position.set(at.x, 0, at.z); this.#add(arc, 3.5, (o, dt, k) => { o.children.forEach((m) => { m.material.opacity = 0.85 * (1 - k); }); }); }
    if (item === 'entrance-meteor') for (let i = 0; i < 8; i++) { const m = glow(0xfde68a, 0.5, 1); const from = new THREE.Vector3(at.x - 5 + Math.random() * 2, 9 + Math.random() * 2, at.z - 3); const to = new THREE.Vector3(at.x + (Math.random() - 0.5), 0.3, at.z + (Math.random() - 0.5)); const d = i * 0.15; this.#add(m, 1.6 + d, (o, dt, k, t, age) => { const p = Math.max(0, Math.min(1, (age - d) / 1.2)); o.position.lerpVectors(from, to, p); o.material.opacity = p >= 1 ? 0 : 1; }); }
  }

  show(kind, item, at) {
    if (kind === 'fx') {
      if (item === 'confetti') this.burst('confetti', { x: 0, y: 5.5, z: -2 }, 140);
      if (item === 'sparks') { for (const x of [-4, 4]) this.burst('sparks', { x, y: 0.5, z: -4 }, 70); }
      if (item === 'balloons') this.balloons({ x: 0, z: -3 });
      if (item === 'bubbles') this.bubbles({ x: 0, z: 0 });
    }
    if (kind === 'gift' && at) this.gift(item, at);
    if (kind === 'entrance' && at) this.entrance(item, at);
    if (kind === 'dance') for (const x of [-3.2, 3.2]) this.burst('sparks', { x, y: 0.5, z: -4.5 }, 60); // dancers arrive
  }

  update(t, dt) {
    const e = this.effects; const on = this.playing;
    this.disco.visible = !!e.disco; this.disco.rotation.y += dt * 0.8;
    this.spots.forEach((l, i) => { l.intensity += ((e.disco ? 70 : 0) - l.intensity) * Math.min(1, dt * 4); const a = t * 0.9 + i * 1.6; l.target.position.set(Math.cos(a) * 6, 0, 2 + Math.sin(a * 1.3) * 4); });
    this.stageSpots.forEach((l, i) => {
      l.intensity += ((on ? 45 : 8) - l.intensity) * Math.min(1, dt * 3); l.target.position.x = Math.sin(t * 0.7 + i * 2) * 2.5;
      l.color.set(e.disco ? PALETTE[(i * 2 + Math.floor(t * 1.5)) % PALETTE.length] : 0xfff1e0);
    });
    // strobe: ~8 flashes per second, whole room + the four heads
    const flash = e.strobe && ((t * 8) % 1) < 0.22;
    this.strobeAmb.intensity = flash ? 2.6 : 0;
    for (const h of this.strobeHeads) { h.flare.visible = flash; h.lens.material.color.set(flash ? 0xffffff : 0x222222); }
    // lasers: each emitter fans 7 beams and sweeps them across the room
    if (e.laser) for (const em of this.lasers.children) for (const b of em.children) {
      if (b.userData.i == null) continue; const { i, k, ceiling } = b.userData; const spread = (i - 3) / 3;
      if (ceiling) { // ceiling: a rotating cone that paints the whole floor
        const a = t * 0.8 + (i / 7) * Math.PI * 2; const r = 0.55 + Math.sin(t * 0.9 + i) * 0.3;
        b.rotation.set(Math.sin(a) * r, Math.cos(a) * r, 0);
      } else {
        b.rotation.y = spread * 0.85 + Math.sin(t * 0.7 + i * 0.9 + k) * 0.45; // wide horizontal fan
        b.rotation.x = Math.sin(t * 1.1 + i * 0.6 + k * 1.3) * 0.32;           // up and down across floor and walls
      }
    }
    // smoke puffs fade in/out; fully transparent sprites are hidden because they would still cost a draw call
    this.smoke.children.forEach((p) => { const target = e.smoke ? 0.18 : 0; p.material.opacity += (target - p.material.opacity) * Math.min(1, dt * 1.5); p.visible = !this.lowQ && p.material.opacity > 0.005; p.position.x += p.userData.v * dt; if (Math.abs(p.position.x) > 8) p.userData.v = -Math.sign(p.position.x) * Math.abs(p.userData.v); });
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i]; l.age += dt; const k = l.age / l.life;
      if (k >= 1) { this.s.remove(l.obj); if (l.obj.target) this.s.remove(l.obj.target); this.live.splice(i, 1); continue; }
      l.step(l.obj, dt, k, t, l.age);
    }
  }
}
