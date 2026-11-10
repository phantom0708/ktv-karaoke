// Shared renderer + camera + input. A World (lobby or room) supplies the scene content.
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAvatar, animateAvatar, setHeld, buildPet } from './avatar.js';

const SPEED = 3.4;
const LEVELS = ['low', 'medium', 'high'];
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const EMOJI = { clap: '👏', heart: '❤️', fire: '🔥', laugh: '😂', star: '⭐', cheers: '🍻' };

export class Engine {
  constructor(canvas, labelsEl, videoEl) {
    this.canvas = canvas; this.labelsEl = labelsEl; this.videoEl = videoEl;
    // graphics quality: 'auto' (measured) or a fixed level; the last auto result is remembered
    this.gfxMode = store.get('vibemic.gfx') || 'auto';
    this.quality = this.gfxMode === 'auto' ? (store.get('vibemic.gfxAuto') || 'high') : this.gfxMode;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality !== 'low', alpha: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true; // keeps room effects inside the room
    this.labels = new CSS2DRenderer({ element: labelsEl });
    this.onQualityChange = () => {};
    this.#applyQuality();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    this.cam = { yaw: 0, pitch: 0.42, dist: 8.5, target: new THREE.Vector3(), cinema: false, look: 0 };
    let saved = null; try { saved = localStorage.getItem('vibemic.view'); } catch {}
    this.view = 'third'; // classic third-person camera: drag to rotate, scroll to zoom, click the floor to walk
    this.sens = 0.0024; this.locked = false;
    this.onViewChange = () => {}; this.onLockChange = () => {};
    this.rightInset = 0;
    this.world = null; this.keys = new Set(); this.clock = new THREE.Clock();
    this.joy = { x: 0, y: 0 }; // on-screen joystick (phones): -1..1, y up = forward
    this.lookJoy = { x: 0, y: 0 }; // on-screen camera stick (phones): -1..1, turns the view while held
    this.onPrompt = () => {}; this.onLocalMove = () => {}; this.onUse = () => {}; this.onPeerClick = () => {};
    this.#input();
    // never let one bad frame freeze the game: log it and keep rendering
    const loop = () => { requestAnimationFrame(loop); try { this.#frame(); } catch (e) { if (!this.lastErr || performance.now() - this.lastErr > 5000) { console.error(e); this.lastErr = performance.now(); } } }; loop();
  }

  setWorld(world) {
    this.world?.dispose?.();
    this.labelsEl.innerHTML = '';
    this.world = world; world.engine = this; world.setQuality?.(this.quality); this.perf = { t: 0, frames: 0, skip: 1.5 };
    this.prompt = null; this.onPrompt(null); this.walkTo = null; this.singers = []; this.keys.clear();
    this.cam.yaw = world.startYaw ?? 0; this.cam.cinema = false; this.cam.dist = world.camDist ?? 9; this.cam.pitch = world.camPitch ?? 0.45; this.cam.look = world.fpLook ?? 0;
    this.renderer.setClearColor(world.clear ?? 0x0b1526, 1);
    if (world.useEnv) { // reflections for gold / marble / glass
      this.envTex ??= new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
      world.scene.environment = this.envTex;
    }
    this.videoEl.style.display = 'none';
  }

  // ---------------- graphics quality ----------------
  setGraphics(mode) { // 'auto' | 'high' | 'medium' | 'low'
    this.gfxMode = mode; store.set('vibemic.gfx', mode);
    if (mode !== 'auto') this.#setLevel(mode); else { this.perf = { t: 0, frames: 0, skip: 0.5 }; }
    this.onQualityChange();
  }
  #setLevel(level) {
    if (level === this.quality) return;
    this.quality = level; if (this.gfxMode === 'auto') store.set('vibemic.gfxAuto', level);
    this.#applyQuality(); this.world?.setQuality?.(level); this.onQualityChange();
  }
  #applyQuality() {
    const q = this.quality;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(devicePixelRatio, 1.5) : q === 'medium' ? 1 : 0.75);
    const shadows = q !== 'low';
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows; this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.world?.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    }
    this.size = null; // force a resize with the new pixel ratio
  }
  // auto mode: measure ~2.5 s of frames after entering a place; step down one level when it is too slow
  #autoTune(dt) {
    if (this.gfxMode !== 'auto' || !this.perf || document.hidden) return;
    const p = this.perf; if (p.skip > 0) { p.skip -= dt; return; }
    p.t += dt; p.frames++;
    if (p.t < 2.5) return;
    const fps = p.frames / p.t; this.lastFps = fps;
    const i = LEVELS.indexOf(this.quality);
    if (fps < 40 && i > 0) { this.#setLevel(LEVELS[i - 1]); this.perf = { t: 0, frames: 0, skip: 1 }; return; }
    this.perf = null; // good enough: stop measuring
  }

  // ---------------- peers ----------------
  addPeer(peer, isMe) {
    const w = this.world; this.removePeer(peer.id);
    const root = buildAvatar(peer.look, peer.equipped);
    const danceSpot = peer.stage ? new THREE.Vector3(peer.stage.x, 0.45, peer.stage.z) : null; // stage dancers stay up on the stage
    root.position.set(peer.x ?? 0, 0, peer.z ?? 0); root.rotation.y = peer.ry ?? 0;
    const el = document.createElement('div');
    const tag = (peer.equipped ?? []).find((e) => e.startsWith('tag-'));
    el.className = `nametag${isMe ? ' me' : ''}${tag ? ` ${tag}` : ''}${peer.bot ? ' bot' : ''}`;
    el.innerHTML = '<span class="mic"></span><span class="nm"></span>';
    el.querySelector('.nm').textContent = peer.clubTag ? `[${peer.clubTag}] ${peer.name}` : peer.name;
    root.userData.peerId = peer.id;
    if (!isMe) { el.classList.add('clickable'); el.addEventListener('click', (e) => { e.stopPropagation(); this.onPeerClick(peer.id); }); } // tap a name tag = open the player card
    const label = new CSS2DObject(el); label.position.set(0, 2.08, 0); root.add(label);
    w.scene.add(root);
    let pet = null; const petId = (peer.equipped ?? []).find((e) => e.startsWith('pet-'));
    if (petId) { pet = buildPet(petId); pet.position.set(root.position.x + 0.8, 0, root.position.z + 0.5); w.scene.add(pet); }
    const a = { root, el, label, pet, peer, isMe, target: new THREE.Vector3(peer.x ?? 0, 0, peer.z ?? 0), ry: peer.ry ?? 0,
      st: { anim: peer.anim ?? 'idle', moving: false, singing: false, buzz: peer.buzz ?? 0, act: null, actT: 0 }, seat: peer.seat ?? null, danceSpot, stageSpot: danceSpot };
    w.avatars.set(peer.id, a);
    if (peer.held) setHeld(root, peer.held);
    this.setMic(peer.id, peer.mic);
    if (isMe) { this.selfId = peer.id; this.cam.target.set(root.position.x, 1.2, root.position.z); }
    this.#applySingers();
    return a;
  }

  updatePeer(peer) {
    const a = this.world?.avatars.get(peer.id); if (!a) return;
    const keep = { x: a.root.position.x, z: a.root.position.z, ry: a.root.rotation.y, anim: a.st.anim, seat: a.seat, held: a.peer.held, buzz: a.st.buzz };
    this.addPeer({ ...a.peer, ...peer, ...keep, held: peer.held ?? keep.held }, a.isMe);
  }

  removePeer(id) {
    const w = this.world; const a = w?.avatars.get(id); if (!a) return;
    a.root.remove(a.label); a.el.remove(); w.scene.remove(a.root); if (a.pet) w.scene.remove(a.pet);
    w.avatars.delete(id);
    // free GPU memory: every avatar has its own (baked) geometries; toon materials are shared, so only dispose the rest
    for (const o of [a.root, a.pet]) o?.traverse((m) => { if (!m.isMesh) return; m.geometry?.dispose?.(); if (m.material && !m.material.isMeshToonMaterial && !m.material.map && !m.userData.isInk) m.material.dispose?.(); }); // sprites share one geometry, ink one material: kept
  }

  movePeer(id, { x, z, ry, anim, seat }) {
    const a = this.world?.avatars.get(id); if (!a || a.isMe) return;
    a.target.set(x, 0, z); a.ry = ry; a.st.anim = anim; a.seat = seat;
  }

  // teleport my own avatar (e.g. server seated me)
  placeSelf({ x, z, ry, anim, seat }) {
    const a = this.world?.avatars.get(this.selfId); if (!a) return;
    a.root.position.set(x, 0, z); a.target.set(x, 0, z); a.root.rotation.y = ry; a.ry = ry; a.st.anim = anim; a.seat = seat; this.walkTo = null;
  }

  setHeld(id, item) { const a = this.world?.avatars.get(id); if (!a) return; a.peer.held = item; setHeld(a.root, item); }
  setBuzz(id, buzz) { const a = this.world?.avatars.get(id); if (a) a.st.buzz = buzz; }
  setMic(id, on) { const a = this.world?.avatars.get(id); if (a) a.el.querySelector('.mic').textContent = on ? '🎙️' : ''; }
  act(id, kind) { const a = this.world?.avatars.get(id); if (a) { a.st.act = kind; a.st.actT = kind === 'bow' ? 1.2 : kind === 'hug' ? 2.4 : kind === 'highfive' ? 1.3 : 1.1; } }
  // two players interact: turn to face each other, play the move, show a little effect
  social(kind, fromId, toId) {
    const w = this.world; const A = w?.avatars.get(fromId); const B = w?.avatars.get(toId); if (!A || !B) return;
    const face = (x, y) => { const ry = Math.atan2(y.root.position.x - x.root.position.x, y.root.position.z - x.root.position.z); x.root.rotation.y = ry; x.ry = ry; };
    if (kind === 'wave') { face(A, B); this.emote(fromId, 'wave'); return this.react(fromId, '👋'); }
    if (kind === 'flowers') { face(A, B); for (let i = 0; i < 3; i++) setTimeout(() => this.react(toId, '💐'), i * 250); return; }
    face(A, B); face(B, A);
    this.act(fromId, kind); this.act(toId, kind);
    const fx = kind === 'hug' ? ['💖', '🫂', '💕'] : ['✋', '✨', '🙌'];
    fx.forEach((e, i) => setTimeout(() => { this.react(fromId, e); this.react(toId, e); }, 150 + i * 300));
  }
  emote(id, kind) {
    const a = this.world?.avatars.get(id); if (!a) return;
    if (kind === 'dance' || kind === 'wave') { a.st.anim = kind; if (a.isMe) this.myEmote = kind; setTimeout(() => { if (a.st.anim === kind) a.st.anim = 'idle'; }, kind === 'wave' ? 2200 : 8000); }
    else this.act(id, kind);
  }
  react(id, kind) {
    const a = this.world?.avatars.get(id); if (!a) return;
    const s = document.createElement('span'); s.className = 'float-emoji'; s.textContent = EMOJI[kind] ?? kind;
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * 40}px`);
    a.el.appendChild(s); setTimeout(() => s.remove(), 1800);
  }
  bubble(id, text) {
    const a = this.world?.avatars.get(id); if (!a) return;
    a.el.querySelector('.bubble')?.remove();
    const b = document.createElement('div'); b.className = 'bubble'; b.textContent = text;
    a.el.appendChild(b); setTimeout(() => b.remove(), 5500);
  }
  setSingers(ids) { this.singers = ids; this.#applySingers(); }
  #applySingers() {
    const w = this.world; if (!w) return;
    for (const [id, a] of w.avatars) {
      const i = (this.singers ?? []).indexOf(id);
      a.st.singing = i >= 0; a.stageSpot = i >= 0 && w.stageSpots ? w.stageSpots[i] : a.danceSpot ?? null;
    }
  }
  position(id = this.selfId) { const a = this.world?.avatars.get(id); return a ? { x: a.root.position.x, z: a.root.position.z, ry: a.root.rotation.y } : null; }
  setCinema(on) { this.cam.cinema = on; }

  // ---------------- input ----------------
  #input() {
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea, select, dialog[open]')) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { this.keys.add(k); this.walkTo = null; e.preventDefault(); }
      if (k === 'e' && this.prompt) this.onUse(this.prompt);
      if (k === 'f') this.onUse({ id: 'drink' });
      if (k === 'g') this.onUse({ id: 'cheers' });
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());

    // mouse look with pointer lock (desktop) — click the scene to capture the mouse, Esc to release
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas; this.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.#look(e.movementX, e.movementY);
    });
    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.locked) return; // locked clicks are handled on mousedown below
      drag = { x: e.clientX, y: e.clientY, moved: false, touch: e.pointerType === 'touch' }; this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag || this.locked) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) { this.#look(dx * 1.6, dy * 1.6); drag.x = e.clientX; drag.y = e.clientY; }
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const d = drag; drag = null; if (!d || d.moved) return;
      this.#pick(e.clientX, e.clientY, true); // click: walk to the floor point, or walk to an object and use it
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.locked || e.button !== 0) return;
      const r = this.canvas.getBoundingClientRect(); this.#pick(r.left + r.width / 2, r.top + r.height / 2, false); // crosshair
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist = Math.max(4, Math.min(16, this.cam.dist + e.deltaY * 0.01));
    }, { passive: false });
  }

  lock() { if (!this.locked && this.canvas.requestPointerLock && !document.querySelector('dialog[open]')) { try { const p = this.canvas.requestPointerLock(); p?.catch?.(() => {}); } catch {} } }
  unlock() { if (this.locked) document.exitPointerLock(); }

  setView(v) {
    if (v === this.view) return;
    this.view = v; try { localStorage.setItem('vibemic.view', v); } catch {}
    if (v === 'first') this.cam.look = this.world?.fpLook ?? 0;
    this.onViewChange(v);
  }
  toggleView() { this.setView(this.view === 'first' ? 'third' : 'first'); }

  // mouse/drag deltas → yaw + pitch (third person orbits; first person looks up/down)
  #look(dx, dy) {
    this.cam.yaw -= dx * this.sens;
    if (this.view === 'first') this.cam.look = Math.max(-1.3, Math.min(1.3, this.cam.look - dy * this.sens));
    else this.cam.pitch = Math.max(0.05, Math.min(1.3, this.cam.pitch + dy * this.sens));
  }

  // the interactable under the crosshair (screen centre), if any
  aimTarget() {
    const w = this.world; if (!w) return null;
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, 0), this.camera); ray.far = 14;
    for (const h of ray.intersectObjects(w.clickables, true)) {
      let o = h.object; while (o && !o.userData.interact && !o.userData.floor) o = o.parent;
      if (o?.userData.interact) return o.userData.interact;
      if (o) return null;
    }
    return null;
  }

  // pick what is under a screen point: interactables are used (walking there if needed);
  // the floor is a walk target only for touch taps
  #pick(cx, cy, allowFloor) {
    const w = this.world; if (!w) return;
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(v, this.camera);
    // another player under the pointer (and nearer than any object) → their player card
    const others = [...w.avatars.values()].filter((a) => !a.isMe && a.root.visible).map((a) => a.root);
    const hitP = ray.intersectObjects(others, true)[0]; const hitO = ray.intersectObjects(w.clickables, true)[0];
    if (hitP && (!hitO || hitP.distance < hitO.distance)) { let o = hitP.object; while (o && o.userData.peerId == null) o = o.parent; if (o) return this.onPeerClick(o.userData.peerId); }
    for (const h of ray.intersectObjects(w.clickables, true)) {
      let o = h.object; while (o && !o.userData.interact && !o.userData.floor) o = o.parent;
      if (!o) continue;
      if (o.userData.interact === 'sofa') { // nearest free-looking seat to where the sofa was clicked
        const seats = w.interactables.filter((i) => i.kind === 'seat');
        const it = seats.sort((a, b) => Math.hypot(a.x - h.point.x, a.z - h.point.z) - Math.hypot(b.x - h.point.x, b.z - h.point.z))[0];
        if (it) { this.walkTo = { x: it.x, z: it.z, use: it }; return; }
      }
      if (o.userData.interact) {
        const it = w.interactables.find((i) => i.id === o.userData.interact);
        if (it) { this.walkTo = { x: it.x, z: it.z, use: it }; return; }
      }
      if (o.userData.floor && allowFloor) { this.walkTo = { x: h.point.x, z: h.point.z }; return; }
      if (o.userData.floor) return;
    }
  }

  // ---------------- frame ----------------
  #frame() {
    const rawDt = this.clock.getDelta(); const dt = Math.min(rawDt, 0.05); const t = this.clock.elapsedTime;
    this.#autoTune(rawDt);
    const w = this.world; if (!w) return;
    if (this.locked && (document.querySelector('dialog[open]') || document.activeElement?.matches?.('input, textarea'))) this.unlock();
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (cw && ch && (this.size?.[0] !== cw || this.size?.[1] !== ch || this.size?.[2] !== this.rightInset)) {
      this.size = [cw, ch, this.rightInset];
      this.renderer.setSize(cw, ch, false); this.labels.setSize(cw, ch);
      this.camera.aspect = (cw + this.rightInset) / ch;
      if (this.rightInset) this.camera.setViewOffset(cw + this.rightInset, ch, this.rightInset, 0, cw, ch); else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
    }
    const lj = this.lookJoy; // camera stick: turn speed follows how far it is pushed (~2.4 rad/s at the edge)
    if (Math.hypot(lj.x, lj.y) > 0.12) this.#look(lj.x * Math.abs(lj.x) * 1000 * dt, -lj.y * Math.abs(lj.y) * 520 * dt);
    this.#moveSelf(dt, t);
    for (const a of w.avatars.values()) {
      if (!a.isMe) {
        const goal = a.stageSpot ?? a.target; const dx = goal.x - a.root.position.x, dz = goal.z - a.root.position.z; const d = Math.hypot(dx, dz);
        if (d > 0.04) { const step = Math.min(d, dt * SPEED * (d > 4 ? 2 : 1)); a.root.position.x += (dx / d) * step; a.root.position.z += (dz / d) * step; a.root.rotation.y = Math.atan2(dx, dz); a.st.moving = true; }
        else { a.st.moving = false; const ry = a.stageSpot ? 0 : a.ry; a.root.rotation.y += angleDiff(a.root.rotation.y, ry) * Math.min(1, dt * 6); }
        if (a.st.anim === 'walk' && !a.st.moving) a.st.anim = 'idle';
      }
      if (a.st.actT > 0) { a.st.actT -= dt; if (a.st.actT <= 0) a.st.act = null; }
      a.root.position.y = (a.stageSpot ? a.stageSpot.y : 0);
      animateAvatar(a.root, a.st, t + a.root.id, dt);
      const fp = this.view === 'first' && !this.cam.cinema && !w.avatars.get(this.selfId)?.stageSpot;
      a.root.visible = a.isMe ? !fp : a.root.position.distanceTo(this.camera.position) > (fp ? 0.6 : 3.2); // don't block the view
      a.el.style.visibility = a.root.visible ? '' : 'hidden';
      if (a.pet) a.pet.visible = !(a.isMe && fp);
      if (a.pet) {
        const ang = a.root.rotation.y + 2.3; const px = a.root.position.x + Math.sin(ang) * 0.9, pz = a.root.position.z + Math.cos(ang) * 0.9;
        a.pet.position.x += (px - a.pet.position.x) * Math.min(1, dt * 3); a.pet.position.z += (pz - a.pet.position.z) * Math.min(1, dt * 3);
        a.pet.position.y = a.root.position.y + (a.pet.userData.hover ? 0.3 + Math.sin(t * 3) * 0.08 : Math.abs(Math.sin(t * 6)) * 0.03);
        a.pet.rotation.y = a.root.rotation.y;
        for (const o of (a.pet.userData.flaps ??= (() => { const l = []; a.pet.traverse((o) => { if (o.userData.flap) l.push(o); }); return l; })())) o.rotation.z = o.userData.flap * Math.sin(t * 10) * 0.5;
      }
    }
    w.update?.(t, dt);
    this.#camera(dt);
    this.renderer.render(w.scene, this.camera);
    this.labels.render(w.scene, this.camera);
    this.#placeVideo(cw, ch);
  }

  #moveSelf(dt, t) {
    const w = this.world; const a = w.avatars.get(this.selfId); if (!a) return;
    let mx = 0, mz = 0;
    const f = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
    const s = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
    let pace = 1;
    const jm = Math.hypot(this.joy.x, this.joy.y);
    if (jm > 0.15) { // joystick: direction relative to the camera, speed follows how far it is pushed
      this.walkTo = null; pace = Math.min(1, jm);
      const y = this.cam.yaw; const jf = this.joy.y / jm, js = this.joy.x / jm;
      mx = -Math.sin(y) * jf + Math.cos(y) * js; mz = -Math.cos(y) * jf - Math.sin(y) * js;
    } else if (f || s) { const y = this.cam.yaw; mx = -Math.sin(y) * f + Math.cos(y) * s; mz = -Math.cos(y) * f - Math.sin(y) * s; }
    else if (this.walkTo) {
      const dx = this.walkTo.x - a.root.position.x, dz = this.walkTo.z - a.root.position.z; const d = Math.hypot(dx, dz);
      const stop = this.walkTo.use ? (this.walkTo.use.radius ?? 1.5) * 0.7 : 0.08;
      if (d <= stop) { const use = this.walkTo.use; this.walkTo = null; if (use) this.onUse(use); }
      else { mx = dx / d; mz = dz / d; }
    }
    const moving = !!(mx || mz) && !a.stageSpot;
    if (moving) {
      const len = Math.hypot(mx, mz); mx /= len; mz /= len;
      if (a.st.buzz > 0.2) { const wob = Math.sin(t * 2.5) * a.st.buzz * 0.6; const ox = mx; mx = mx * Math.cos(wob) - mz * Math.sin(wob); mz = ox * Math.sin(wob) + mz * Math.cos(wob); }
      let nx = a.root.position.x + mx * SPEED * pace * dt, nz = a.root.position.z + mz * SPEED * pace * dt;
      [nx, nz] = w.collide(nx, nz);
      a.root.position.x = nx; a.root.position.z = nz; a.root.rotation.y = this.view === 'first' ? this.cam.yaw + Math.PI : Math.atan2(mx, mz);
      a.seat = null; if (a.st.anim !== 'walk') a.st.anim = 'walk';
    } else if (a.st.anim === 'walk') a.st.anim = 'idle';
    a.st.moving = moving;
    if (a.stageSpot) { a.root.position.x += (a.stageSpot.x - a.root.position.x) * Math.min(1, dt * 4); a.root.position.z += (a.stageSpot.z - a.root.position.z) * Math.min(1, dt * 4); a.root.rotation.y += angleDiff(a.root.rotation.y, 0) * Math.min(1, dt * 6); }
    a.target.copy(a.root.position);
    this.onLocalMove({ x: a.root.position.x, z: a.root.position.z, ry: a.root.rotation.y, anim: a.st.anim, moving });
    // nearest interactable prompt
    let best = null, bd = Infinity;
    for (const it of w.interactables) { const d = Math.hypot(it.x - a.root.position.x, it.z - a.root.position.z); if (d < (it.radius ?? 1.5) && d < bd) { best = it; bd = d; } }
    if (best !== this.prompt) { this.prompt = best; this.onPrompt(best); }
  }

  #camera(dt) {
    const w = this.world; const me = w.avatars.get(this.selfId);
    if (this.cam.cinema && w.screen) {
      const sp = w.screen.getWorldPosition(new THREE.Vector3());
      const sh = w.screen.geometry.parameters.height; const fit = (sh / 2) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.12; // whole screen in view
      const goal = this.#clampCam(sp, new THREE.Vector3(sp.x, sp.y - 0.2, sp.z + fit));
      this.camera.position.lerp(goal, Math.min(1, dt * 4)); this.camera.lookAt(sp); this.#cutaway(null); return;
    }
    // wider field of view in first person, like FPS games
    const fov = this.view === 'first' && me && !me.stageSpot && !this.cam.cinema ? 68 : 48;
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 8); this.camera.updateProjectionMatrix(); }
    if (this.view === 'first' && me && !me.stageSpot) { // singing uses the stage framing below so lyrics stay readable
      // eyes of my character; free look with yaw + look pitch
      const eye = new THREE.Vector3(me.root.position.x, me.root.position.y + (me.st.anim === 'sit' ? 1.46 : 1.62), me.root.position.z);
      this.camera.position.lerp(eye, Math.min(1, dt * 20));
      const { yaw, look } = this.cam;
      const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(look), Math.sin(look), -Math.cos(yaw) * Math.cos(look));
      this.camera.lookAt(this.camera.position.clone().add(dir));
      this.cam.target.copy(eye);
      if (!me.st.moving && !me.stageSpot && me.st.anim !== 'sit') me.root.rotation.y = this.cam.yaw + Math.PI;
      this.#cutaway(null); return;
    }
    // on stage: frame the singer together with the screen behind them
    const onStage = !!me?.stageSpot;
    if (me) this.cam.target.lerp(onStage ? new THREE.Vector3(me.root.position.x * 0.4, 3.3, -3.6) : new THREE.Vector3(me.root.position.x, (w.camLookY ?? 1.2) + me.root.position.y, me.root.position.z + (w.camLookZ ?? 0)), Math.min(1, dt * 4));
    const { yaw, target } = this.cam; const pitch = onStage ? 0.2 : this.cam.pitch; const dist = onStage ? 10.5 : this.cam.dist;
    const want = new THREE.Vector3(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    const goal = this.#clampCam(target, want);
    this.camera.position.lerp(goal, Math.min(1, dt * 8));
    this.camera.lookAt(target);
    this.#cutaway(me);
  }

  // pull the camera in along the view ray so it never leaves the world's camera box (no wall in front of the lens)
  #clampCam(target, want) {
    const box = this.world.camBox; if (!box) return want;
    const d = want.clone().sub(target); let k = 1;
    for (const ax of ['x', 'y', 'z']) {
      if (want[ax] > box.max[ax] && d[ax] > 0) k = Math.min(k, (box.max[ax] - target[ax]) / d[ax]);
      if (want[ax] < box.min[ax] && d[ax] < 0) k = Math.min(k, (box.min[ax] - target[ax]) / d[ax]);
    }
    k = Math.max(0.15, k);
    const p = target.clone().addScaledVector(d, k);
    if (k < 0.85) p.y += (1 - k) * d.length() * 0.55; // squeezed by a wall: rise up to keep the view open
    return p.set(Math.min(box.max.x, Math.max(box.min.x, p.x)), Math.min(box.max.y, Math.max(box.min.y, p.y)), Math.min(box.max.z, Math.max(box.min.z, p.z)));
  }

  // hide furniture standing between the camera and my character
  #cutaway(me) {
    const w = this.world; if (!w.occluders?.length) return;
    this.cutT = (this.cutT ?? 0) + 1; if (this.cutT % 6) return;
    for (const o of w.occluders) o.visible = true;
    if (!me) return;
    const head = me.root.position.clone(); head.y += 1.2;
    const dir = head.clone().sub(this.camera.position); const len = dir.length(); dir.normalize();
    const ray = new THREE.Raycaster(this.camera.position, dir, 0, len - 0.4); ray.camera = this.camera; // sprites need a camera to be raycast
    for (const h of ray.intersectObjects(w.occluders, true)) {
      let o = h.object; while (o && !w.occluders.includes(o)) o = o.parent;
      if (o) o.visible = false;
    }
  }

  // map the 1280x720 video element exactly onto the wall screen's projected quad (CSS homography)
  #placeVideo(cw, ch) {
    const w = this.world; const el = this.videoEl;
    if (!w.screen) { el.style.display = 'none'; return; }
    w.screen.updateMatrixWorld();
    const n = new THREE.Vector3(0, 0, 1).transformDirection(w.screen.matrixWorld);
    const sp = w.screen.getWorldPosition(new THREE.Vector3());
    if (n.dot(this.camera.position.clone().sub(sp)) <= 0) { el.style.display = 'none'; return; }
    const g = w.screen.geometry.parameters; const hw = g.width / 2, hh = g.height / 2;
    const pts = [];
    for (const [x, y] of [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]]) { // TL, TR, BR, BL
      const v = new THREE.Vector3(x, y, 0).applyMatrix4(w.screen.matrixWorld).project(this.camera);
      if (v.z > 1 || v.z < -1) { el.style.display = 'none'; return; }
      pts.push([(v.x + 1) / 2 * cw, (1 - v.y) / 2 * ch]);
    }
    el.style.display = 'block';
    el.style.transform = homography(1280, 720, pts);
  }
}

function homography(W, H, [[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) {
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let a, b, c = x0, d, e, f = y0, g = 0, h = 0;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) { a = x1 - x0; b = x3 - x0; d = y1 - y0; e = y3 - y0; }
  else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2; const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3;
  }
  a /= W; d /= W; g /= W; b /= H; e /= H; h /= H;
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${h},0,0,1,0,${c},${f},0,1)`;
}

const angleDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

// Base world: scene + avatars + bounds/obstacles + interactables
export class World {
  constructor() {
    this.scene = new THREE.Scene(); this.avatars = new Map(); this.clickables = []; this.interactables = [];
    this.bounds = { x: [-9, 9], z: [-4, 8] }; this.obstacles = []; this.screen = null; this.stageSpots = null;
    this.camBox = null; this.occluders = []; this.clip = [];
  }
  collide(x, z) {
    x = Math.max(this.bounds.x[0], Math.min(this.bounds.x[1], x)); z = Math.max(this.bounds.z[0], Math.min(this.bounds.z[1], z));
    for (const o of this.obstacles) {
      if (o.r) { const dx = x - o.x, dz = z - o.z; const d = Math.hypot(dx, dz); if (d < o.r) { x = o.x + (dx / (d || 1)) * o.r; z = o.z + (dz / (d || 1)) * o.r; } }
      else if (x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1) {
        const opts = [[o.x0 - x, 0], [o.x1 - x, 0], [0, o.z0 - z], [0, o.z1 - z]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        x += opts[0][0]; z += opts[0][1];
      }
    }
    return [x, z];
  }
  dispose() { this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); }); }
}
