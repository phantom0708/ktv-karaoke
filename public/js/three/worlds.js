// The two places: a rooftop lobby at dusk and a karaoke lounge room.
import * as THREE from 'three';
import { World } from './engine.js';
import { toon, outline, glow, emissive, textTexture } from './toon.js';
import { buildAvatar, animateAvatar } from './avatar.js';
import { FX } from './fx.js';
import { bakeStatic, bakeGroup } from './bake.js';
import { GOLD, GOLD_SOFT, LACQUER, WALNUT, velvet, marbleMaterial, carpetMaterial, damaskMaterial, chandelier, drape, column, luxSofa, champagneTable, flowerVase, twinkle } from './decor.js';

const box = (w, h, d, mat, pos, rot) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); if (pos) m.position.set(...pos); if (rot) m.rotation.set(...rot); m.castShadow = true; m.receiveShadow = true; return m; };
const cyl = (rt, rb, h, mat, pos, seg = 20) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); if (pos) m.position.set(...pos); m.castShadow = true; m.receiveShadow = true; return m; };

function sky(top = 0x1b2a55, mid = 0xff8a65, bottom = 0xffd59e) {
  const geo = new THREE.SphereGeometry(120, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.6, h)) : mix(bottom, mid, smoothstep(-0.1, 0.08, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  return new THREE.Mesh(geo, mat);
}

function skyline(radius, count, seed = 1) {
  const g = new THREE.Group(); let s = seed; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const bodyMat = toon(0x1a2342); const winMat = emissive(0xffd59e, 0.9);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2; const w = 3 + rnd() * 5, h = 6 + rnd() * 22, d = 3 + rnd() * 4;
    const b = box(w, h, d, bodyMat, [Math.cos(a) * radius, h / 2 - 8, Math.sin(a) * radius], [0, -a, 0]); b.castShadow = false; g.add(b);
    const rows = Math.floor(h / 2.2);
    for (let r = 0; r < rows; r++) if (rnd() > 0.45) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, 0.35), winMat);
      win.position.set(Math.cos(a) * (radius - d / 2 - 0.01), -8 + 1.5 + r * 2.2, Math.sin(a) * (radius - d / 2 - 0.01)); win.lookAt(0, win.position.y, 0); g.add(win);
    }
  }
  return g;
}

function stringLights(from, to, n, color = 0xffd59e) {
  const g = new THREE.Group(); const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * 0.7; pts.push(p); }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x2b2b2b })));
  for (let i = 1; i < n; i++) { const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), emissive(color, 1.1)); bulb.position.copy(pts[i]); bulb.position.y -= 0.08; g.add(bulb); const gl = glow(color, 0.32, 0.4); gl.position.copy(bulb.position); g.add(gl); }
  return g;
}

function plant(pos, scale = 1) {
  const g = new THREE.Group(); g.add(cyl(0.35, 0.28, 0.6, toon(0xc2410c), [0, 0.3, 0]));
  for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), toon(i % 2 ? 0x16a34a : 0x22c55e)); l.position.set(Math.cos(i) * 0.2, 0.85 + (i % 3) * 0.18, Math.sin(i) * 0.2); l.scale.set(1, 1.3, 1); g.add(l); }
  g.position.set(...pos); g.scale.setScalar(scale); outline(g, 0.02); return g;
}

function npc(look, name, pos, ry = 0) {
  const a = buildAvatar(look, []); a.position.set(...pos); a.rotation.y = ry;
  a.userData.npc = { st: { anim: 'idle', moving: false, singing: false, buzz: 0 } };
  return a;
}

function sign(text, w, h, opts) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTexture(text, opts), transparent: true })); return m; }

// =================================================================== LOBBY
export class LobbyWorld extends World {
  constructor(rooms) {
    super();
    this.clear = 0x1b2a55; this.startYaw = 0; this.camDist = 10.5; this.camPitch = 0.3; this.camLookY = 2.4; this.camLookZ = -2.5;
    this.bounds = { x: [-13, 13], z: [-6, 10] };
    this.camBox = { min: new THREE.Vector3(-22, 0.8, -6.6), max: new THREE.Vector3(22, 16, 24) }; // open-air rooftop: only the building blocks the camera
    const s = this.scene;
    s.add(sky()); s.add(skyline(70, 36, 3)); s.fog = new THREE.Fog(0x8a6a8f, 40, 110);
    s.add(new THREE.HemisphereLight(0xa5b4fc, 0x7c2d12, 1.1));
    const sun = new THREE.DirectionalLight(0xffb37a, 2.2); sun.position.set(-20, 18, 12); sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18 }); sun.shadow.mapSize.set(1024, 1024); s.add(sun);

    // wooden deck with planks
    const deck = box(30, 0.3, 20, toon(0x9a6b45), [0, -0.15, 2]); deck.userData.floor = true; s.add(deck); this.clickables.push(deck);
    for (let i = -14; i <= 14; i += 1.2) { const line = box(0.03, 0.01, 20, toon(0x7a4f30), [i, 0.005, 2]); line.castShadow = false; s.add(line); }
    // railings around
    const rail = toon(0x334155);
    for (const [x, z, w, d] of [[0, 12, 30, 0.1], [-15, 2, 0.1, 20], [15, 2, 0.1, 20]]) { s.add(box(w, 0.08, d, rail, [x, 1.1, z])); for (let i = 0; i < 12; i++) { const px = w > 1 ? -14 + i * 2.5 : x, pz = d > 1 ? -8 + i * 1.8 : z; s.add(box(0.08, 1.1, 0.08, rail, [px, 0.55, pz])); } }
    // back building wall with doors
    s.add(box(30, 6, 0.6, toon(0xe9d5b7), [0, 3, -7.3]));
    s.add(box(30, 0.5, 0.8, toon(0x7c2d12), [0, 6.1, -7.2]));
    const title = sign('KTV Lounge', 10, 1.6, { font: '800 92px "Baloo 2", sans-serif', color: '#fff7ed', glowColor: '#ff7a59', w: 1024, h: 160 }); title.position.set(0, 5.3, -6.95); s.add(title);
    for (const [a, b] of [[[-14.8, 5.2, -6.9], [-14.8, 4.6, 11.8]], [[14.8, 5.2, -6.9], [14.8, 4.6, 11.8]], [[-14.8, 5.4, -6.9], [0, 5.6, -6.9]], [[0, 5.6, -6.9], [14.8, 5.4, -6.9]]]) s.add(stringLights(a, b, 18));
    for (const [x, z] of [[-14.8, 11.8], [14.8, 11.8]]) s.add(cyl(0.07, 0.07, 4.6, toon(0x1f2937), [x, 2.3, z]));
    for (const p of [[-13.5, 0, 10.5], [13.5, 0, 10.5], [-13.5, 0, -5.5], [13.5, 0, -5.5], [-8, 0, 10.8], [8, 0, 10.8]]) { const pl = plant(p, 1.2); s.add(pl); this.occluders.push(pl); }

    // reception desk
    const desk = new THREE.Group();
    desk.add(cyl(1.45, 1.45, 1.0, toon(0xfff7ed), [0, 0.5, 0], 32), cyl(1.55, 1.55, 0.1, toon(0xff7a59), [0, 1.03, 0], 32));
    const deskSign = sign('🛎️ Lễ tân · Reception', 3.2, 0.5, { font: '700 54px "Baloo 2", sans-serif', color: '#7c2d12', w: 640, h: 100 }); deskSign.position.set(0, 0.55, 1.47); desk.add(deskSign);
    desk.position.set(0, 0, -2.6); outline(desk, 0.02); s.add(desk); this.occluders.push(desk);
    desk.userData.interact = 'reception'; this.clickables.push(desk);
    const host = npc({ build: 0, skin: '#f2c9a1', eyes: 2, mouth: 0, blush: 1, brows: 0, hair: 3, hairColor: '#2b1a10', top: 2, topColor: '#ff7a59', bottom: 2, bottomColor: '#1e293b', shoes: '#111827', acc: 3, accColor: '#fbbf24' }, 'Vy', [0, 0, -4.55], 0);
    s.add(host); this.npcs = [host];
    this.obstacles.push({ x: 0, z: -2.6, r: 1.8 }, { x: 0, z: -4.55, r: 0.6 });
    this.interactables.push({ id: 'reception', kind: 'reception', x: 0, z: -0.4, radius: 1.8 });

    // doors
    this.doors = new Map();
    const xs = [-12, -9, -6, -3, 3, 6, 9, 12];
    rooms.forEach((r, i) => {
      const x = xs[i] ?? 0; const g = new THREE.Group(); g.position.set(x, 0, -6.95);
      g.add(box(1.9, 3.1, 0.2, toon(0x3f2a1d), [0, 1.55, 0]), box(1.5, 2.8, 0.12, toon(r.color), [0, 1.4, 0.1]), cyl(0.06, 0.06, 0.1, toon(0xfbbf24), [0.5, 1.35, 0.2]));
      const lbl = sign(r.name, 2.4, 0.55, { font: '700 46px "Baloo 2", sans-serif', color: '#fff', bg: 'rgba(17,24,39,0.85)', w: 512, h: 110 }); lbl.position.set(0, 3.5, 0.32); g.add(lbl);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), emissive(0x22c55e, 1.4)); lamp.userData.noBake = true; lamp.position.set(0, 3.0, 0.3); g.add(lamp);
      const halo = glow(0x22c55e, 1.1, 0.8); halo.position.copy(lamp.position); g.add(halo);
      outline(g, 0.015); s.add(g); g.userData.interact = `door-${r.id}`; this.clickables.push(g);
      this.doors.set(r.id, { lamp, halo });
      this.interactables.push({ id: `door-${r.id}`, kind: 'door', room: r, x, z: -5.9, radius: 1.3 });
    });
    this.setRooms(rooms);
    this.bakeInfo = bakeStatic(s, new Set([...this.occluders, ...this.clickables, ...this.npcs]));
    for (const o of new Set([...this.occluders, ...this.clickables])) if (!this.npcs.includes(o)) bakeGroup(o);
  }

  setRooms(rooms) {
    for (const r of rooms) {
      const d = this.doors.get(r.id); if (!d) continue;
      const c = r.status === 'full' ? 0xef4444 : r.status === 'singing' ? 0xf59e0b : 0x22c55e;
      d.lamp.material = emissive(c, 1.4); d.halo.material.color.set(c);
      const it = this.interactables.find((i) => i.id === `door-${r.id}`); if (it) it.room = r;
    }
  }

  setQuality(level) { this.scene.traverse((o) => { if (o.isSprite) o.visible = level !== 'low'; }); }

  update(t, dt) { for (const n of this.npcs) animateAvatar(n, n.userData.npc.st, t, dt); }
}

// =================================================================== ROOM
export const STAGE_Z = -5;
export class RoomWorld extends World {
  constructor(room, seats) {
    super();
    this.clear = 0x120d1c; this.startYaw = 0; this.camDist = 9.5; this.camPitch = 0.26; this.camLookY = 3.0; this.camLookZ = -2.8; this.fpLook = 0.12; // look past my character toward the stage
    this.bounds = { x: [-9.5, 9.5], z: [-3.6, 8] };
    this.theme = new THREE.Color(room.color);
    this.useEnv = true;
    const s = this.scene;
    this.amb = new THREE.HemisphereLight(0xb8a3ff, 0x1a0f24, 0.4); s.add(this.amb); // dark club ambience
    const key = new THREE.DirectionalLight(0xffe7d1, 0.28); this.key = key; key.position.set(4, 10, 8); key.castShadow = true;
    Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 }); key.shadow.mapSize.set(1024, 1024); s.add(key);

    // shell: floor, rug, walls with dusk windows
    // polished black marble floor + a patterned carpet with a gold border
    const floor = box(20.4, 0.2, 16.8, marbleMaterial(true), [0, -0.1, 1.4]); floor.userData.floor = true; s.add(floor); this.clickables.push(floor);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(10, 7), carpetMaterial(this.theme)); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.012, 2.6); rug.receiveShadow = true; s.add(rug);
    // walls are single-sided planes facing inward: seen from outside they vanish instead of blocking the view
    const wall = damaskMaterial(this.theme); const plane = (w, h, pos, ry, mat = wall) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(...pos); m.rotation.y = ry; m.receiveShadow = true; s.add(m); return m; };
    plane(20.4, 8, [0, 4, -7.0], 0); plane(20.4, 8, [0, 4, 9.75], Math.PI); plane(16.8, 8, [-10.2, 4, 1.4], Math.PI / 2); plane(16.8, 8, [10.2, 4, 1.4], -Math.PI / 2);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(20.4, 16.8), toon(0x1c1424)); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 8, 1.4); s.add(ceil);
    ceil.material = LACQUER;
    // coffered ceiling: gold-trimmed grid with recessed downlights
    for (let x = -9; x <= 9; x += 3) { const b = box(0.12, 0.14, 16.8, GOLD_SOFT, [x, 7.93, 1.4]); b.castShadow = false; s.add(b); }
    for (let z = -6; z <= 9; z += 3) { const b = box(20.4, 0.14, 0.12, GOLD_SOFT, [0, 7.93, z]); b.castShadow = false; s.add(b); }
    for (let x = -7.5; x <= 7.5; x += 3) for (let z = -4.5; z <= 7.5; z += 3) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), emissive(0xffe6b8, 1)); d.rotation.x = Math.PI / 2; d.position.set(x, 7.98, z); s.add(d); }
    // walnut wainscot with gold chair rail + gold crown molding
    const wains = (len, pos, ry) => { const g = new THREE.Group(); g.position.set(...pos); g.rotation.y = ry;
      g.add(box(len, 1.3, 0.06, WALNUT, [0, 0.65, 0]), box(len, 0.06, 0.1, GOLD, [0, 1.32, 0.02]), box(len, 0.12, 0.12, GOLD, [0, 7.82, 0.02]));
      for (let x = -len / 2 + 1; x < len / 2 - 0.5; x += 2) { const f = box(1.6, 0.9, 0.02, GOLD_SOFT, [x + 0.3, 0.68, 0.035]); f.scale.set(1, 1, 1); const inner = box(1.5, 0.8, 0.025, WALNUT, [x + 0.3, 0.68, 0.04]); g.add(f, inner); }
      s.add(g); };
    wains(20.4, [0, 0, -6.96], 0); wains(20.4, [0, 0, 9.71], Math.PI); wains(16.8, [-10.16, 0, 1.4], Math.PI / 2); wains(16.8, [10.16, 0, 1.4], -Math.PI / 2);
    // marble columns with gold capitals in the four corners
    for (const [x, z] of [[-9.65, -6.5], [9.65, -6.5], [-9.65, 9.25], [9.65, 9.25]]) { const c = column(7.8); c.position.set(x, 0, z); s.add(c); }
    this.camBox = { min: new THREE.Vector3(-9.7, 0.7, -6.4), max: new THREE.Vector3(9.7, 7.4, 9.3) };
    this.clip = [[1, 0, 0, 10.1], [-1, 0, 0, 10.1], [0, -1, 0, 7.95], [0, 1, 0, 0.0], [0, 0, 1, 6.95], [0, 0, -1, 9.7]].map(([x, y, z, c]) => new THREE.Plane(new THREE.Vector3(x, y, z), c));
    for (const x of [-9.94, 9.94]) {
      const grad = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.2), new THREE.ShaderMaterial({ side: THREE.DoubleSide, vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }', fragmentShader: 'varying vec2 vU; void main(){ vec3 a = vec3(0.14,0.19,0.37); vec3 b = vec3(1.0,0.54,0.4); vec3 c = mix(b, a, smoothstep(0.15, 0.95, vU.y)); float bld = step(0.0, sin(vU.x*60.0)*0.5+0.5-0.3) * step(vU.y, 0.25 + 0.15*sin(vU.x*13.0)); c = mix(c, vec3(0.1,0.12,0.22), bld); gl_FragColor = vec4(c,1.0);}' }));
      grad.material.side = THREE.FrontSide; grad.position.set(x < 0 ? -10.15 : 10.15, 4.2, 1.5); grad.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2; s.add(grad);
      for (let k = -2; k <= 2; k++) s.add(box(0.1, 3.3, 0.1, GOLD_SOFT, [x < 0 ? -10.08 : 10.08, 4.2, 1.5 + k * 2.5]));
      for (const y of [2.55, 5.85]) s.add(box(0.12, 0.12, 10.2, GOLD, [x < 0 ? -10.08 : 10.08, y, 1.5]));
      for (const z of [-4.1, 7.1]) { const d = drape(1.2, 4.4, 0x5a0f1c, 4); d.position.set(x < 0 ? -9.95 : 9.95, 4.3, z); d.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2; s.add(d); }
    }
    // wall neon line + sign
    this.themeMat = emissive(this.theme, 1.2);
    this.accent = new THREE.Color(0xffc27a); this.accentMat = emissive(this.accent, 1.1); // warm gold cove light
    this.neonGlows = [];
    const neon = (len, pos, rotY, mat, color) => {
      const strip = box(len, 0.06, 0.06, mat, pos); strip.rotation.y = rotY; strip.castShadow = false; s.add(strip);
      const n = Math.max(2, Math.round(len / 4.4)); // half as many glow sprites (each one is a draw call), a bit bigger
      for (let i = 0; i < n; i++) { const g = glow(color, 2.4, 0.22); const k = (i + 0.5) / n - 0.5; g.position.set(pos[0] + Math.cos(rotY) * len * k, pos[1], pos[2] - Math.sin(rotY) * len * k); s.add(g); this.neonGlows.push(g); }
    };
    for (const x of [-10.05, 10.05]) { neon(16.4, [x, 0.06, 1.4], Math.PI / 2, this.themeMat, this.theme); neon(16.4, [x, 7.62, 1.4], Math.PI / 2, this.accentMat, this.accent); }
    neon(20, [0, 0.06, 9.62], 0, this.themeMat, this.theme); neon(20, [0, 7.62, 9.62], 0, this.accentMat, this.accent);
    const roomSign = sign(room.name, 6, 0.9, { font: '800 72px "Baloo 2", sans-serif', color: '#f6d48a', glowColor: '#b8860b', w: 1024, h: 150 }); roomSign.position.set(0, 7.0, 9.4); roomSign.rotation.y = Math.PI; s.add(roomSign);

    // stage
    s.add(box(12.4, 0.45, 3.4, LACQUER, [0, 0.225, STAGE_Z]));
    s.add(box(12.5, 0.06, 0.08, GOLD, [0, 0.45, STAGE_Z + 1.72]), box(12.5, 0.04, 0.06, GOLD, [0, 0.05, STAGE_Z + 1.73]));
    s.add(box(12.45, 0.04, 0.04, this.themeMat, [0, 0.25, STAGE_Z + 1.74]));
    const curtainColor = new THREE.Color(this.theme).multiplyScalar(0.45).lerp(new THREE.Color(0x5a0f1c), 0.5);
    for (const x of [-6.05, 6.05]) {
      const d = drape(1.5, 7.2, curtainColor, 6); d.position.set(x, 3.75, -6.82); s.add(d);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.04, 8, 24), GOLD); tie.position.set(x, 2.6, -6.72); tie.rotation.x = Math.PI / 2.6; s.add(tie);
      const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 10), GOLD); tassel.position.set(x + (x < 0 ? 0.35 : -0.35), 2.35, -6.68); s.add(tassel);
    }
    const valance = drape(13.6, 0.62, curtainColor, 22); valance.position.set(0, 7.6, -6.78); s.add(valance);
    s.add(box(13.6, 0.07, 0.12, GOLD, [0, 7.3, -6.74]));
    for (let x = -6.6; x <= 6.6; x += 0.5) { const fr = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 6), GOLD); fr.position.set(x, 7.2, -6.72); fr.rotation.x = Math.PI; s.add(fr); }
    this.stageSpots = [new THREE.Vector3(-1.1, 0.45, -4.0), new THREE.Vector3(1.1, 0.45, -4.0)];
    for (const p of this.stageSpots) { const st = new THREE.Group(); st.add(cyl(0.02, 0.02, 1.35, toon(0x9ca3af), [0, 0.67, 0]), cyl(0.18, 0.2, 0.04, toon(0x374151), [0, 0.02, 0])); st.position.set(p.x + 0.5, 0.45, p.z + 0.3); s.add(st); }
    for (const x of [-5.6, 5.6]) { const sp = new THREE.Group(); sp.add(box(1, 2, 0.9, LACQUER, [0, 1, 0])); for (const y of [0.6, 1.4]) { const cone = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), toon(0x3f3f46)); cone.position.set(0, y, 0.46); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.025, 8, 28), GOLD); ring.position.set(0, y, 0.47); sp.add(cone, ring); } sp.add(box(1.04, 0.05, 0.94, GOLD, [0, 2.0, 0])); sp.position.set(x, 0.45, STAGE_Z - 0.5); s.add(sp); this.occluders.push(sp); }
    // screen: transparent hole (video DOM shows through) + bezel + glow
    const hole = new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0, blending: THREE.NoBlending, fog: false });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(10, 5.625), hole); this.screen.position.set(0, 4.15, -6.9); s.add(this.screen);
    s.add(box(10.4, 6.0, 0.12, toon(0x0b0b10), [0, 4.15, -6.98]));
    for (const [w, h, x, y] of [[10.6, 0.12, 0, 7.16], [10.6, 0.12, 0, 1.14], [0.12, 6.1, -5.24, 4.15], [0.12, 6.1, 5.24, 4.15]]) s.add(box(w, h, 0.14, GOLD, [x, y, -6.9]));
    this.screenGlow = glow(this.theme, 15, 0.45); this.screenGlow.position.set(0, 4.15, -7.0); s.add(this.screenGlow);
    this.screenLight = new THREE.SpotLight(0x9d8cff, 45, 22, 1.0, 0.9, 1.2); this.screenLight.position.set(0, 4.15, -6.6); this.screenLight.target.position.set(0, 0, 4); s.add(this.screenLight, this.screenLight.target);
    this.followSpot = new THREE.SpotLight(0xfff1e0, 40, 12, 0.22, 0.65, 1.2); this.followSpot.position.set(0, 7.6, 2); s.add(this.followSpot, this.followSpot.target);

    // sofas matching server seat positions
    const velvetColor = new THREE.Color(this.theme).multiplyScalar(0.5).lerp(new THREE.Color(0x4a0d1a), 0.35);
    const sofa = (len) => luxSofa(len, velvetColor);
    const L = sofa(3.8); L.position.set(-8.3, 0, 1.8); L.rotation.y = Math.PI / 2; s.add(L);
    const R = sofa(3.8); R.position.set(8.3, 0, 1.8); R.rotation.y = -Math.PI / 2; s.add(R);
    const backs = [-3, 3].map((x) => { const B = sofa(2.6); B.position.set(x, 0, 8.1); B.rotation.y = Math.PI; s.add(B); return B; });
    this.occluders.push(L, R, ...backs);
    for (const sf of [L, R, ...backs]) { sf.userData.interact = 'sofa'; this.clickables.push(sf); } // click a sofa to sit
    this.obstacles.push({ x0: -9.8, x1: -7.7, z0: -0.2, z1: 3.8 }, { x0: 7.7, x1: 9.8, z0: -0.2, z1: 3.8 }, { x0: -4.5, x1: -1.5, z0: 7.5, z1: 8.8 }, { x0: 1.5, x1: 4.5, z0: 7.5, z1: 8.8 });
    for (const x of [-6.2, 6.2]) { const tb = champagneTable();
      tb.position.set(x, 0, 1.8); s.add(tb); this.occluders.push(tb); this.obstacles.push({ x, z: 1.8, r: 0.9 }); }
    seats.forEach(([x, z], i) => this.interactables.push({ id: `seat-${i}`, kind: 'seat', seat: i, x, z, radius: 0.75 }));

    // party table with snacks
    const cloth = new THREE.MeshStandardMaterial({ color: 0xf8f4ec, roughness: 0.9 }); const pt = new THREE.Group(); pt.add(box(2.3, 0.06, 1.2, cloth, [0, 0.96, 0]), box(2.3, 0.88, 1.2, cloth, [0, 0.48, 0]), box(2.34, 0.05, 1.24, GOLD, [0, 0.72, 0]), box(2.34, 0.04, 1.24, GOLD, [0, 0.02, 0]));
    this.snackSlots = [];
    for (let i = 0; i < 9; i++) { const g = new THREE.Group(); g.position.set(-0.85 + (i % 5) * 0.42, 1.05, -0.25 + Math.floor(i / 5) * 0.45); pt.add(g); this.snackSlots.push(g); }
    pt.position.set(-5.2, 0, 6.6); s.add(pt); this.occluders.push(pt); pt.userData.interact = 'table'; this.clickables.push(pt);
    this.obstacles.push({ x0: -6.5, x1: -3.9, z0: 5.9, z1: 7.3 });
    this.interactables.push({ id: 'table', kind: 'table', x: -5.2, z: 5.4, radius: 1.7 });

    // song kiosk (right of stage)
    const k = new THREE.Group(); k.add(box(1.1, 1.9, 0.8, toon(0x1e293b), [0, 0.95, 0]), box(0.9, 0.6, 0.05, emissive(this.theme, 1), [0, 1.45, 0.41]), box(0.9, 0.1, 0.4, toon(0x334155), [0, 1.05, 0.5], [-0.4, 0, 0]));
    const kl = sign('🎵 SONGS', 1.1, 0.3, { font: '800 60px "Baloo 2", sans-serif', color: '#fff', w: 360, h: 100 }); kl.position.set(0, 2.05, 0.41); k.add(kl);
    k.add(box(1.16, 0.06, 0.86, GOLD, [0, 1.9, 0]), box(1.16, 0.06, 0.86, GOLD, [0, 0.03, 0]), box(0.96, 0.66, 0.04, GOLD, [0, 1.45, 0.395]));
    k.position.set(6.4, 0, -3.2); k.rotation.y = -0.5; outline(k, 0.02); s.add(k); this.occluders.push(k); k.userData.interact = 'kiosk'; this.clickables.push(k);
    this.obstacles.push({ x: 6.4, z: -3.2, r: 0.8 }); this.interactables.push({ id: 'kiosk', kind: 'kiosk', x: 5.7, z: -2.3, radius: 1.5 });
    // switchboard (left of stage)
    const pb = new THREE.Group(); pb.add(box(1.6, 1.2, 0.25, toon(0x27272a), [0, 1.2, 0]));
    this.switches = {};
    ['lights', 'disco', 'strobe', 'laser', 'smoke'].forEach((n, i) => { const sw = box(0.18, 0.3, 0.12, toon(0xe5e7eb), [-0.6 + i * 0.3, 1.2, 0.16]); sw.userData.noBake = true; const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), emissive(0x22c55e)); led.userData.noBake = true; led.position.set(-0.6 + i * 0.3, 1.5, 0.15); pb.add(sw, led); this.switches[n] = { sw, led }; });
    pb.add(box(1.7, 1.3, 0.2, GOLD, [0, 1.2, -0.04]));
    pb.position.set(-6.4, 0, -3.3); pb.rotation.y = 0.5; outline(pb, 0.02); s.add(pb); this.occluders.push(pb); pb.userData.interact = 'panel'; this.clickables.push(pb);
    this.obstacles.push({ x: -6.4, z: -3.3, r: 0.7 }); this.interactables.push({ id: 'panel', kind: 'panel', x: -5.7, z: -2.4, radius: 1.5 });
    // waiter + exit door
    const waiter = npc({ build: 1, skin: '#e0ac7e', eyes: 1, mouth: 0, blush: 0, brows: 1, hair: 0, hairColor: '#1f130c', top: 2, topColor: '#111827', bottom: 0, bottomColor: '#111827', shoes: '#111827', acc: 0, accColor: '#111827' }, 'Tú', [7.4, 0, 7.4], -2.4);
    s.add(waiter); this.npcs = [waiter]; this.occluders.push(waiter); this.obstacles.push({ x: 7.4, z: 7.4, r: 0.5 });
    this.interactables.push({ id: 'staff', kind: 'staff', x: 6.6, z: 6.6, radius: 1.5 });
    const door = new THREE.Group(); door.add(box(2.1, 3.1, 0.2, GOLD, [0, 1.55, 0]), box(1.7, 2.8, 0.1, WALNUT, [0, 1.4, -0.1]), cyl(0.04, 0.04, 0.5, GOLD, [-0.25, 1.4, -0.2]), cyl(0.04, 0.04, 0.5, GOLD, [0.25, 1.4, -0.2]));
    const ex = sign('EXIT', 1.1, 0.35, { font: '900 80px "Baloo 2", sans-serif', color: '#86efac', glowColor: '#22c55e', w: 300, h: 110 }); ex.position.set(0, 3.25, -0.12); ex.rotation.y = Math.PI; door.add(ex);
    door.position.set(0, 0, 9.6); s.add(door); door.userData.interact = 'exit'; this.clickables.push(door);
    this.interactables.push({ id: 'exit', kind: 'exit', x: 0, z: 7.9, radius: 1.3 });
    for (const p of [[-8.6, 0, -6.3], [8.6, 0, -6.3], [8.6, 0, 9.05], [-8.6, 0, 9.05], [-1.6, 0, 9.1], [1.6, 0, 9.1]]) { const v = flowerVase(1.7); v.position.set(...p); s.add(v); this.occluders.push(v); }

    this.sconces = [];
    for (const [x, y, z, ry] of [[-3, 2.6, 9.6, Math.PI], [3, 2.6, 9.6, Math.PI], [-10.05, 2.6, 1.8, Math.PI / 2], [10.05, 2.6, 1.8, -Math.PI / 2]]) {
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry;
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.32, 14, 1, true), emissive(0xffc27a, 0.9)); shade.material.side = THREE.DoubleSide; g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.25, 12), GOLD).translateY(-0.28), new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.4), GOLD).translateZ(0.2).translateY(-0.4));
      const halo = glow(0xffb36b, 1.8, 0.55); // glow only: a real light per sconce is too expensive on weak machines
      g.add(shade, halo); s.add(g); this.sconces.push(g);
    }
    this.chandeliers = [-5, 5].map((x) => { const c = chandelier(1.05); c.position.set(x, 6.75, 3.2); s.add(c); return c; }); // off the centre line so the screen stays clear
    this.themeMat.userData.keepIdentity = true; this.accentMat.userData.keepIdentity = true; // animated colours
    this.bakeInfo = bakeStatic(s, new Set([...this.occluders, ...this.clickables, ...this.npcs, ...this.chandeliers, ...this.sconces, this.screen]));
    for (const o of new Set([...this.occluders, ...this.chandeliers])) if (!this.npcs.includes(o)) bakeGroup(o); // sofas, vases, tables… become a few meshes each
    this.fx = new FX(this);
    this.playing = false;
    this.setEffects({ lights: true });
  }

  setStock(stock) {
    const items = []; for (const k of ['beer', 'soda', 'fruit', 'cake', 'pizza']) for (let i = 0; i < Math.min(2, stock[k] ?? 0); i++) items.push(k);
    this.snackSlots.forEach((slot, i) => {
      slot.clear(); const it = items[i]; if (!it) return;
      const color = { beer: 0xfbbf24, soda: 0xef4444, fruit: 0x22c55e, cake: 0xfde68a, pizza: 0xfacc15 }[it];
      const m = it === 'fruit' || it === 'cake' ? new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), toon(color)) : new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.2, 10), toon(color));
      m.position.y = 0.1; slot.add(m);
    });
  }

  setEffects(effects) {
    this.effects = { ...this.effects, ...effects };
    this.amb.intensity = this.effects.lights ? 0.4 : 0.1; for (const c of this.sconces) c.visible = !!this.effects.lights; for (const c of this.chandeliers ?? []) c.userData.light.intensity = this.effects.lights ? 30 : 6; this.key.intensity = this.effects.lights ? 0.28 : 0.05;
    for (const [n, s] of Object.entries(this.switches)) { const on = !!this.effects[n]; s.sw.rotation.x = on ? -0.4 : 0.4; s.led.material = emissive(on ? 0x22c55e : 0x7f1d1d); }
    this.fx.setEffects(this.effects);
  }

  setPlaying(on) { this.playing = on; this.fx.playing = on; }

  // weaker machines: fewer real lights and no decorative glows (screen glow stays)
  setQuality(level) {
    const low = level === 'low';
    for (const c of this.chandeliers) c.userData.light.visible = !low;
    this.followSpot.visible = !low; this.fx.setQuality(level);
    for (const g of this.neonGlows) g.visible = !low;
  }

  update(t, dt) {
    for (const n of this.npcs) animateAvatar(n, n.userData.npc.st, t, dt);
    const beat = this.playing ? 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 1.9) : 0;
    this.themeMat.color.copy(this.theme).multiplyScalar(0.9 + beat * 0.9);
    this.accentMat.color.copy(this.accent).multiplyScalar(0.8 + (1 - beat) * 0.6);
    for (const g of this.neonGlows) g.material.opacity = 0.16 + beat * 0.14;
    twinkle(this.chandeliers, t);
    this.screenGlow.material.opacity = (this.playing ? 0.4 : 0.28) + beat * 0.2;
    this.screenLight.intensity = (this.playing ? 55 : 30) + beat * 25;
    this.screenLight.color.setHSL((0.72 + Math.sin(t * 0.3) * 0.08 + 1) % 1, 0.6, 0.7);
    const me = this.engine?.position?.();
    if (me) { this.followSpot.target.position.set(me.x, 0, me.z); this.followSpot.position.set(me.x, 7.6, me.z + 1.5); }
    this.fx.update(t, dt);
  }
}
