// Characters built from primitives with cel shading, ink outlines and procedural animation:
// human proportions, male / female body shapes, a stylised face.
import * as THREE from 'three';
import { toon, outline, glow, emissive } from './toon.js';
import { bakeGroup } from './bake.js';

const S = (r, w = 20, h = 16) => new THREE.SphereGeometry(r, w, h);
const CAP = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 14);
const RoundedBox = (w, h, d) => { const g = new THREE.CapsuleGeometry(h / 2, d - h, 4, 10); g.rotateX(Math.PI / 2); g.scale(w / h, 1, 1); return g; }; // shoe
const mesh = (geo, mat, pos, opts = {}) => {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (opts.rot) m.rotation.set(...opts.rot);
  if (opts.scale) m.scale.set(...opts.scale);
  if (opts.noOutline) m.userData.noOutline = true;
  m.castShadow = !opts.noShadow;
  return m;
};
const HEAD_R = 0.42;
const BUILDS = [{ w: 0.88, h: 0.92 }, { w: 1, h: 1 }, { w: 1.18, h: 1.04 }];
const MIC_COLORS = { 'mic-rose': 0xfb7185, 'mic-gold': 0xfbbf24, 'mic-crystal': 0x7dd3fc };
const AURA = { 'aura-notes': [0xfde68a, 'note'], 'aura-petals': [0xfda4af, 'petal'], 'aura-sparks': [0xfdba74, 'spark'], 'aura-galaxy': [0xa5b4fc, 'star'] };

function face(look, head) {
  const ink = toon(0x1b1020); const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const z = HEAD_R * 0.93; const ey = 0.02; const ex = 0.15;
  for (const side of [-1, 1]) {
    const x = side * ex;
    switch (look.eyes) {
      case 1: head.add(mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 14, Math.PI), ink, [x, ey - 0.01, z], { noOutline: true })); break;
      case 2: {
        head.add(mesh(S(0.075), ink, [x, ey, z - 0.02], { scale: [1, 1.25, 0.45], noOutline: true }));
        head.add(mesh(S(0.026), white, [x + 0.025, ey + 0.04, z + 0.015], { noOutline: true }));
        head.add(mesh(S(0.014), white, [x - 0.02, ey - 0.03, z + 0.015], { noOutline: true }));
        break;
      }
      case 3: head.add(mesh(new THREE.TorusGeometry(0.05, 0.013, 6, 14, Math.PI), ink, [x, ey + 0.02, z], { rot: [0, 0, Math.PI], noOutline: true })); break;
      case 4: {
        head.add(mesh(S(0.065), ink, [x, ey, z - 0.02], { scale: [1.25, 0.85, 0.45], rot: [0, 0, side * 0.35], noOutline: true }));
        head.add(mesh(S(0.02), white, [x + 0.02, ey + 0.025, z + 0.012], { noOutline: true }));
        break;
      }
      default: {
        head.add(mesh(S(0.06), ink, [x, ey, z - 0.015], { scale: [1, 1.2, 0.45], noOutline: true }));
        head.add(mesh(S(0.02), white, [x + 0.02, ey + 0.03, z + 0.012], { noOutline: true }));
      }
    }
    const browY = ey + 0.12 + (look.brows === 2 ? 0.03 : 0);
    const brow = mesh(new THREE.BoxGeometry(0.1, look.brows === 1 ? 0.028 : 0.016, 0.02), toon(new THREE.Color(look.hairColor).multiplyScalar(0.7)), [x, browY, z - 0.01],
      { rot: [0, side * 0.25, side * (look.brows === 2 ? -0.25 : -0.08)], noOutline: true });
    head.add(brow);
    if (look.blush) head.add(mesh(new THREE.CircleGeometry(0.055, 16), new THREE.MeshBasicMaterial({ color: 0xff8fa3, transparent: true, opacity: 0.55 }), [side * 0.25, -0.07, HEAD_R * 0.86], { rot: [0, side * 0.5, 0], noOutline: true, noShadow: true }));
  }
  const my = -0.13; const mz = HEAD_R * 0.95;
  switch (look.mouth) {
    case 1: head.add(mesh(S(0.05), toon(0x7a1f2b), [0, my, mz - 0.02], { scale: [1, 0.8, 0.4], noOutline: true })); break;
    case 2: for (const s of [-1, 1]) head.add(mesh(new THREE.TorusGeometry(0.028, 0.011, 6, 10, Math.PI), ink, [s * 0.028, my + 0.01, mz], { rot: [0, 0, Math.PI], noOutline: true })); break;
    case 3: head.add(mesh(S(0.03), toon(0xf472b6), [0, my, mz - 0.005], { scale: [1, 0.8, 0.6], noOutline: true })); break;
    default: head.add(mesh(new THREE.TorusGeometry(0.05, 0.013, 6, 14, Math.PI), ink, [0, my + 0.02, mz], { rot: [0, 0, Math.PI], noOutline: true }));
  }
}

function hair(look, head) {
  const m = toon(look.hairColor);
  const cap = (r = HEAD_R + 0.03, theta = 0.52) => mesh(new THREE.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, Math.PI * theta), m, [0, 0.03, -0.01]);
  const fringe = () => mesh(S(0.3, 16, 10), m, [0, 0.27, 0.2], { scale: [1.2, 0.45, 0.7] });
  switch (look.hair) {
    case 0: head.add(cap(), fringe()); break;
    case 1: head.add(cap(), fringe(), mesh(S(HEAD_R + 0.05), m, [0, -0.04, -0.09], { scale: [1.04, 0.92, 0.92] })); break;
    case 2: head.add(cap(), fringe(), mesh(S(HEAD_R + 0.05), m, [0, -0.02, -0.09], { scale: [1.04, 0.95, 0.92] }), mesh(CAP(0.3, 0.45), m, [0, -0.45, -0.18], { scale: [1.1, 1, 0.6] })); break;
    case 3: head.add(cap(), fringe(), mesh(CAP(0.09, 0.4), m, [0, 0.05, -0.55], { rot: [-0.9, 0, 0] }), mesh(S(0.07), toon(0xf472b6), [0, 0.2, -0.43], { noOutline: true })); break;
    case 4: head.add(cap(), fringe(), mesh(S(0.17), m, [0, 0.47, -0.08])); break;
    case 5: {
      head.add(cap(HEAD_R + 0.02, 0.48));
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; head.add(mesh(new THREE.ConeGeometry(0.1, 0.32, 8), m, [Math.cos(a) * 0.22, 0.4, Math.sin(a) * 0.22 - 0.02], { rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] })); }
      break;
    }
    case 6: head.add(cap(), fringe(), ...[-1, 1].map((s) => mesh(CAP(0.1, 0.42), m, [s * 0.5, -0.12, -0.05], { rot: [0, 0, s * 0.35] }))); break;
    case 8: { // curly
      head.add(cap(HEAD_R + 0.02, 0.55));
      for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2 * 3.1; const y = 0.42 - (i / 22) * 0.62; const r = Math.sqrt(Math.max(0.02, (HEAD_R + 0.06) ** 2 - y * y)); if (Math.cos(a) * r > 0.2 && y < 0.25) continue; head.add(mesh(S(0.1, 10, 8), m, [Math.sin(a) * r, y, Math.cos(a) * r - 0.04])); }
      break;
    }
    case 9: head.add(cap(), fringe(), mesh(new THREE.BoxGeometry(0.78, 1.15, 0.14), m, [0, -0.42, -0.3], { scale: [1, 1, 1] }), ...[-1, 1].map((s) => mesh(new THREE.BoxGeometry(0.1, 0.8, 0.16), m, [s * 0.42, -0.28, -0.05]))); break; // long straight
    case 7: head.add(cap(HEAD_R + 0.008, 0.5)); break;
    default: head.add(cap(HEAD_R + 0.008, 0.5));
  }
}

function accessory(look, head) {
  const c = toon(look.accColor);
  if (look.acc === 1) { for (const s of [-1, 1]) head.add(mesh(new THREE.TorusGeometry(0.085, 0.014, 6, 18), c, [s * 0.15, 0.02, HEAD_R + 0.02], { noOutline: true })); head.add(mesh(new THREE.BoxGeometry(0.08, 0.014, 0.014), c, [0, 0.03, HEAD_R + 0.03], { noOutline: true })); }
  if (look.acc === 2) { for (const s of [-1, 1]) head.add(mesh(new THREE.BoxGeometry(0.17, 0.1, 0.03), toon(0x111827), [s * 0.15, 0.02, HEAD_R + 0.02], { noOutline: true })); head.add(mesh(new THREE.BoxGeometry(0.42, 0.02, 0.02), toon(0x111827), [0, 0.06, HEAD_R + 0.02], { noOutline: true })); }
  if (look.acc === 3) for (const s of [-1, 1]) head.add(mesh(S(0.035), toon(look.accColor === '#111827' ? '#fbbf24' : look.accColor, { emissive: 0x332200 }), [s * (HEAD_R - 0.02), -0.12, 0.02], { noOutline: true }));
  if (look.acc === 5) { const h = toon(new THREE.Color(look.hairColor).multiplyScalar(0.85)); head.add(mesh(S(0.27, 18, 12), h, [0, -0.25, 0.12], { scale: [1.15, 0.7, 0.9] }), mesh(new THREE.BoxGeometry(0.2, 0.035, 0.03), h, [0, -0.1, HEAD_R * 0.95], { noOutline: true })); } // beard + moustache
  if (look.acc === 6) { const g = toon(0xd4a017, { emissive: 0x2a1d00 }); for (const s of [-1, 1]) head.add(mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 20), g, [s * 0.15, 0.02, HEAD_R + 0.02], { noOutline: true })); head.add(mesh(new THREE.BoxGeometry(0.07, 0.012, 0.012), g, [0, 0.04, HEAD_R + 0.03], { noOutline: true })); } // round glasses
  if (look.acc === 4) head.add(mesh(new THREE.TorusGeometry(HEAD_R + 0.02, 0.03, 8, 30, Math.PI), c, [0, 0.12, 0], { rot: [0, Math.PI / 2, Math.PI / 2 - 0.25] }));
}

function headItem(id, head) {
  const at = (geo, color, pos, opts) => head.add(mesh(geo, toon(color, opts?.mat), pos, opts));
  switch (id) {
    case 'head-beanie': at(new THREE.SphereGeometry(HEAD_R + 0.06, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), 0x2563eb, [0, 0.07, 0]); at(S(0.08), 0xf8fafc, [0, 0.5, 0]); break;
    case 'head-cap': at(new THREE.SphereGeometry(HEAD_R + 0.05, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), 0xef4444, [0, 0.08, 0]); at(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 20, 1, false, -Math.PI / 2, Math.PI), 0xb91c1c, [0, 0.22, 0.25]); break;
    case 'head-flower': for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; at(S(0.05), 0xfda4af, [0.28 + Math.cos(a) * 0.06, 0.28 + Math.sin(a) * 0.06, 0.25], { noOutline: true }); } at(S(0.04), 0xfde047, [0.28, 0.28, 0.28], { noOutline: true }); break;
    case 'head-headset': at(new THREE.TorusGeometry(HEAD_R + 0.04, 0.035, 8, 24, Math.PI), 0x111827, [0, 0.02, 0]); for (const s of [-1, 1]) at(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 18), 0xf97316, [s * (HEAD_R + 0.02), 0, 0], { rot: [0, 0, Math.PI / 2], mat: { emissive: 0x401a00 } }); break;
    case 'head-fox': for (const s of [-1, 1]) at(new THREE.ConeGeometry(0.13, 0.3, 4), 0xf97316, [s * 0.24, 0.43, -0.02], { rot: [0, 0, s * -0.35] }); break;
    case 'head-witch': at(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 24), 0x312e81, [0, 0.28, 0]); at(new THREE.ConeGeometry(0.3, 0.6, 18), 0x312e81, [0, 0.58, -0.05], { rot: [-0.2, 0, 0] }); break;
    case 'head-tiara': at(new THREE.CylinderGeometry(0.26, 0.29, 0.14, 10, 1, true), 0xfbbf24, [0, 0.38, 0], { mat: { emissive: 0x3a2a00, side: THREE.DoubleSide } }); at(S(0.04), 0xf472b6, [0, 0.42, 0.27], { noOutline: true }); break;
    case 'head-bow': for (const s of [-1, 1]) at(S(0.12), 0xf43f5e, [s * 0.13 + 0.18, 0.42, 0.05], { scale: [1, 0.7, 0.4], rot: [0, 0, s * 0.4] }); at(S(0.06), 0xbe123c, [0.18, 0.42, 0.06]); break;
    case 'head-bunny': for (const s of [-1, 1]) { at(CAP(0.08, 0.4), 0xf8fafc, [s * 0.16, 0.66, -0.05], { rot: [0, 0, s * -0.15] }); at(CAP(0.04, 0.3), 0xfbcfe8, [s * 0.16, 0.66, -0.0], { rot: [0, 0, s * -0.15], noOutline: true }); } break;
    case 'head-cowboy': at(new THREE.CylinderGeometry(0.62, 0.62, 0.04, 28), 0x92400e, [0, 0.3, 0], { scale: [1, 1, 0.85] }); at(new THREE.CylinderGeometry(0.3, 0.36, 0.34, 20), 0x92400e, [0, 0.48, 0]); at(new THREE.CylinderGeometry(0.365, 0.365, 0.06, 20, 1, true), 0x1f2937, [0, 0.36, 0]); break;
    case 'head-crown': {
      at(new THREE.CylinderGeometry(0.34, 0.31, 0.2, 16, 1, true), 0xfbbf24, [0, 0.42, 0], { mat: { emissive: 0x4a3300, side: THREE.DoubleSide } });
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; at(new THREE.ConeGeometry(0.06, 0.16, 4), 0xfbbf24, [Math.sin(a) * 0.33, 0.6, Math.cos(a) * 0.33], { mat: { emissive: 0x4a3300 } }); at(S(0.035), [0xef4444, 0x3b82f6, 0x22c55e][i % 3], [Math.sin(a) * 0.335, 0.42, Math.cos(a) * 0.335], { noOutline: true }); }
      break;
    }
    case 'head-halo': { const h = mesh(new THREE.TorusGeometry(0.3, 0.035, 10, 32), emissive(0xfde68a, 1.2), [0, 0.75, 0], { rot: [Math.PI / 2, 0, 0], noOutline: true, noShadow: true }); h.userData.noBake = true; h.userData.spin = true; const gl = glow(0xfde68a, 1.0, 0.45); gl.position.set(0, 0.75, 0); head.add(h, gl); break; }
    case 'face-heart': for (const s of [-1, 1]) for (const d of [-1, 1]) at(S(0.07), 0xef4444, [s * 0.16 + d * 0.035, 0.04, HEAD_R + 0.02], { scale: [1, 1, 0.3], mat: { emissive: 0x3a0000 }, noOutline: true }); for (const s of [-1, 1]) at(new THREE.ConeGeometry(0.1, 0.1, 4), 0xef4444, [s * 0.16, -0.04, HEAD_R + 0.02], { rot: [0, 0, Math.PI], scale: [1, 1, 0.3], mat: { emissive: 0x3a0000 }, noOutline: true }); break;
    case 'face-starglass': for (const s of [-1, 1]) { const sh = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.05 : 0.12; const a = Math.PI / 2 + (i * Math.PI) / 5; if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); } at(new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false }), 0xfacc15, [s * 0.16, 0.02, HEAD_R], { mat: { emissive: 0x3a2a00 }, noOutline: true }); } break;
    case 'face-mask': at(new THREE.SphereGeometry(HEAD_R + 0.025, 24, 8, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.4, Math.PI * 0.16), 0x6d28d9, [0, 0, 0], { mat: { side: THREE.DoubleSide, emissive: 0x1a0033 } }); for (const s of [-1, 1]) at(S(0.03), 0xfbbf24, [s * 0.3, 0.1, HEAD_R * 0.82], { noOutline: true }); break;
    case 'head-star': { // a real five-pointed star floating above the head, spinning, with a soft halo
      const shape = new THREE.Shape();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.075 : 0.18; const a = Math.PI / 2 + (i * Math.PI) / 5; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) shape.lineTo(x, y); else shape.moveTo(x, y); }
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2 }); geo.center();
      const s = mesh(geo, emissive(0xfde047, 1.15), [0, HEAD_R + 0.42, 0], { noOutline: true, noShadow: true }); s.userData.spin = true; s.userData.noBake = true;
      const halo = glow(0xfde047, 0.75, 0.55); halo.position.set(0, HEAD_R + 0.42, 0); // Object3D.position is read-only: set(), never assign
      head.add(s, halo); break;
    }
  }
}

function backItem(id, torso) {
  switch (id) {
    case 'back-guitar': { const g = new THREE.Group(); g.add(mesh(S(0.2), toon(0xb45309), [0, -0.1, 0], { scale: [1, 1.25, 0.35] }), mesh(new THREE.BoxGeometry(0.06, 0.55, 0.04), toon(0x78350f), [0, 0.35, 0])); g.position.set(0, 0, -0.3); g.rotation.z = 0.5; torso.add(g); break; }
    case 'back-bag': torso.add(mesh(new THREE.BoxGeometry(0.4, 0.45, 0.2), toon(0x0d9488), [0, 0, -0.3])); break;
    case 'back-wings': for (const s of [-1, 1]) { const w = mesh(S(0.3), toon(0xf8fafc, { emissive: 0x334155 }), [s * 0.35, 0.15, -0.3], { scale: [1.4, 0.6, 0.12], rot: [0, s * 0.4, s * 0.4] }); w.userData.flap = s; w.userData.noBake = true; torso.add(w); } break;
    case 'back-cape': { const c = mesh(new THREE.BoxGeometry(0.75, 1.15, 0.03), toon(0xb91c1c, { side: THREE.DoubleSide }), [0, -0.55, -0.3], { rot: [0.12, 0, 0] }); torso.add(c, mesh(new THREE.BoxGeometry(0.6, 0.06, 0.06), toon(0xfbbf24, { emissive: 0x3a2a00 }), [0, 0.06, -0.25])); break; }
    case 'back-devil': for (const s of [-1, 1]) { const w = mesh(new THREE.ConeGeometry(0.3, 0.7, 3), toon(0x7f1d1d, { emissive: 0x200000 }), [s * 0.4, 0.15, -0.3], { rot: [0, 0, s * 1.1], scale: [1, 1, 0.15] }); w.userData.flap = s; w.userData.noBake = true; torso.add(w); } break;
    case 'back-balloons': { const cols = [0xf43f5e, 0x3b82f6, 0xfacc15]; cols.forEach((c, i) => { const x = (i - 1) * 0.28; torso.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.4, 4), toon(0xe5e7eb), [x * 0.5 + 0.35, 0.6, -0.3], { rot: [0, 0, -x * 0.3], noOutline: true }), mesh(S(0.22), toon(c, { emissive: new THREE.Color(c).multiplyScalar(0.15) }), [x + 0.35, 1.35 + (i % 2) * 0.15, -0.3], { scale: [1, 1.2, 1] })); }); break; }
    case 'back-jetpack': for (const s of [-1, 1]) { torso.add(mesh(CAP(0.1, 0.3), toon(0x94a3b8), [s * 0.13, 0, -0.32])); const f = glow(0xf97316, 0.35, 0.9); f.position.set(s * 0.13, -0.32, -0.32); f.userData.flame = true; torso.add(f); } break;
  }
}

function heldMesh(item) {
  const g = new THREE.Group();
  if (item === 'beer') { g.add(mesh(new THREE.CylinderGeometry(0.07, 0.065, 0.18, 14), toon(0xfbbf24, { transparent: true, opacity: 0.9 })), mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 14), toon(0xfffbeb), [0, 0.1, 0])); }
  if (item === 'soda') { g.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.18, 14), toon(0xef4444)), mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6), toon(0xf8fafc), [0.02, 0.12, 0], { noOutline: true })); }
  if (item === 'fruit') g.add(mesh(new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI), toon(0x22c55e), [0, 0, 0], { rot: [Math.PI / 2, 0, 0] }), mesh(new THREE.CircleGeometry(0.095, 14, 0, Math.PI), toon(0xf43f5e), [0, 0, 0.001], { noOutline: true }));
  if (item === 'cake') g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 14, 1, false, 0, Math.PI / 3), toon(0xfde68a)), mesh(S(0.025), toon(0xef4444), [0.04, 0.07, 0.03], { noOutline: true }));
  if (item === 'pizza') g.add(mesh(new THREE.ConeGeometry(0.14, 0.02, 3), toon(0xfacc15), [0, 0, 0], { rot: [Math.PI / 2, 0, 0] }));
  return g;
}

function auraParticles(id) {
  const [color, kind] = AURA[id]; const g = new THREE.Group(); g.userData.aura = true;
  for (let i = 0; i < 10; i++) {
    const p = kind === 'note' ? mesh(new THREE.SphereGeometry(0.05, 8, 6), emissive(color), null, { noOutline: true })
      : kind === 'petal' ? mesh(new THREE.CircleGeometry(0.05, 6), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }), null, { noOutline: true })
        : glow(color, kind === 'star' ? 0.22 : 0.16, 0.95);
    p.userData.orbit = { a: (i / 10) * Math.PI * 2, r: 0.6 + (i % 3) * 0.12, y: 0.3 + (i % 5) * 0.32, s: 0.6 + (i % 4) * 0.25 };
    g.add(p);
  }
  return g;
}

export function buildPet(id) {
  const g = new THREE.Group();
  if (id === 'pet-duck') g.add(mesh(S(0.2), toon(0xfde047), [0, 0.2, 0]), mesh(S(0.13), toon(0xfde047), [0, 0.42, 0.08]), mesh(new THREE.ConeGeometry(0.05, 0.12, 8), toon(0xf97316), [0, 0.4, 0.22], { rot: [Math.PI / 2, 0, 0] }));
  if (id === 'pet-cat') g.add(mesh(CAP(0.14, 0.2), toon(0xf59e0b), [0, 0.18, 0], { rot: [Math.PI / 2, 0, 0] }), mesh(S(0.15), toon(0xf59e0b), [0, 0.38, 0.17]), ...[-1, 1].map((s) => mesh(new THREE.ConeGeometry(0.05, 0.1, 4), toon(0xf59e0b), [s * 0.08, 0.52, 0.17])), mesh(CAP(0.03, 0.25), toon(0xf59e0b), [0, 0.3, -0.25], { rot: [-0.7, 0, 0] }));
  if (id === 'pet-robot') { g.add(mesh(new THREE.BoxGeometry(0.28, 0.24, 0.24), toon(0x94a3b8), [0, 0.45, 0]), mesh(new THREE.BoxGeometry(0.2, 0.06, 0.02), emissive(0x22d3ee), [0, 0.47, 0.13], { noOutline: true })); g.userData.hover = true; }
  if (id === 'pet-dragon') { g.add(mesh(S(0.2), toon(0x22c55e), [0, 0.5, 0]), mesh(S(0.14), toon(0x22c55e), [0, 0.66, 0.14]), ...[-1, 1].map((s) => { const w = mesh(S(0.15), toon(0x86efac), [s * 0.22, 0.58, -0.05], { scale: [1.3, 0.3, 0.7] }); w.userData.flap = s; return w; })); g.userData.hover = true; }
  outline(g, 0.02);
  return g;
}

// ---------- body: stylised but human proportions (≈1.75 tall, head ≈ 1/5 of the height) ----------
// The face/hair/hat code above is drawn on a big "chibi" head (HEAD_R); the head group is simply scaled down.
const HEAD_SCALE = 0.5;   // effective head radius ≈ 0.21
const HIP = 0.86;         // hip joint height (legs pivot here)
const THIGH = 0.42; const SHIN = 0.42;
export const SIT_DROP = -0.16; // body offset when seated on a sofa cushion (top ≈ 0.68)

// 0 = male, 1 = female, 2/undefined = guess from the hairstyle and clothes (older saved characters)
export const isFemale = (look) => (look.gender === 1 ? true : look.gender === 0 ? false : [1, 2, 3, 6].includes(look.hair) || look.bottom === 2 || look.top === 3);

// hired room hosts' outfits (server/hosts.js): a sparkly party dress, and shirtless with a six-pack
function glamDress(torso, look, dims) {
  const dress = toon(look.topColor, { emissive: new THREE.Color(look.topColor).multiplyScalar(0.18) });
  torso.add(mesh(CAP(dims.chestR * 1.03, 0.2), dress, [0, 0.2, 0], { scale: [dims.chestX, 1, 0.8] })); // fitted bodice
  torso.add(mesh(new THREE.CylinderGeometry(dims.chestR * 0.95, dims.hipR * 1.5, 0.36, 22, 1, true), dress, [0, -0.17, 0], { scale: [1, 1, 0.82] })); // flared skirt to mid-thigh
  for (const s of [-1, 1]) torso.add(mesh(new THREE.BoxGeometry(0.02, 0.12, 0.02), dress, [s * 0.07, 0.4, 0.07], { rot: [0.2, 0, s * -0.1], noOutline: true })); // straps
  torso.add(mesh(new THREE.TorusGeometry(0.065, 0.008, 6, 18), toon(0xfbbf24, { emissive: 0x3a2a00 }), [0, 0.42, 0.03], { rot: [Math.PI / 2.3, 0, 0], noOutline: true })); // necklace
  const spark = emissive(0xfff7ed, 1.4);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 1.6 - 0.8; const y = -0.3 + (i % 5) * 0.1; torso.add(mesh(S(0.008, 6, 4), spark, [Math.sin(a) * 0.17, y, Math.cos(a) * 0.15], { noOutline: true, noShadow: true })); }
}
function sixPack(torso, look, dims) {
  // grooves drawn right on the bare chest capsule: surf(x, y) = z of its front surface
  const R = dims.chestR; const sx = dims.chestX; const cy = 0.2; const half = 0.1;
  const surf = (x, y) => { const dy = Math.abs(y - cy); const ry = dy <= half ? R : Math.sqrt(Math.max(0, R * R - (dy - half) ** 2)); return 0.8 * Math.sqrt(Math.max(0, ry * ry - (x / sx) ** 2)) + 0.003; };
  const line = toon(new THREE.Color(look.skin).multiplyScalar(0.62)); const flat = { noOutline: true, noShadow: true };
  const dash = (w, h, x, y, rz = 0) => torso.add(mesh(new THREE.BoxGeometry(w, h, 0.006), line, [x, y, surf(x, y)], { ...flat, rot: [0, Math.asin(Math.min(0.9, x / (R * sx))), rz] }));
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) dash(0.035, 0.007, s * (0.025 + i * 0.03), 0.3 - Math.sin((i / 3) * Math.PI) * 0.015, s * (i < 2 ? 0.3 : -0.3)); // pecs
  for (let i = 0; i < 5; i++) dash(0.007, 0.03, 0, 0.24 - i * 0.035); // centre line
  for (const y of [0.2, 0.15, 0.1]) for (const s of [-1, 1]) dash(0.04, 0.007, s * 0.028, y); // six pack
  for (const s of [-1, 1]) dash(0.007, 0.08, s * 0.08, 0.04, s * 0.45); // V-line
  torso.add(mesh(new THREE.CylinderGeometry(dims.hipR * 1.12, dims.hipR * 1.12, 0.04, 20, 1, true), toon(0x111827), [0, -0.04, 0], { scale: [dims.hipX, 1, 0.8] })); // belt
  torso.add(mesh(new THREE.BoxGeometry(0.05, 0.035, 0.015), toon(0xfbbf24, { emissive: 0x3a2a00 }), [0, -0.04, dims.hipR * 0.92 + 0.012], flat));
}

// shop outfits: a set of top/bottom overrides + extra pieces
const OUTFITS = {
  'outfit-sport': { top: 1, topColor: '#dc2626', bottom: 0, bottomColor: '#dc2626', shoes: '#f8fafc', stripes: '#f8fafc' },
  'outfit-suit': { top: 2, topColor: '#1e293b', bottom: 0, bottomColor: '#1e293b', shoes: '#111827', tie: '#b91c1c' },
  'outfit-aodai': { top: 5, topColor: '#f8fafc', bottom: 4, bottomColor: '#f8fafc', aodai: true },
  'outfit-idol': { top: 2, topColor: '#cbd5e1', bottom: 0, bottomColor: '#111827', shoes: '#111827', sparkle: true },
  'outfit-gown': { top: 3, topColor: '#7c3aed', bottom: 3, bottomColor: '#7c3aed', gown: true, sparkle: true },
};

export function buildAvatar(look, equipped = []) {
  const outfit = OUTFITS[equipped.find((e) => OUTFITS[e])];
  if (outfit) look = { ...look, ...Object.fromEntries(Object.entries(outfit).filter(([k]) => k in look)), ...(outfit.aodai ? { topColor: look.topColor === '#f97316' ? '#be123c' : look.topColor } : {}) };
  const b = BUILDS[look.build] ?? BUILDS[1]; const female = isFemale(look);
  const skin = toon(look.skin); const top = toon(look.topColor); const bottom = toon(look.bottomColor); const shoes = toon(look.shoes);
  const glam = equipped.includes('outfit-glam'); const abs = equipped.includes('outfit-abs');
  const dims = { // widths per gender and build
    chestR: 0.15 * b.w, chestX: female ? 0.98 : 1.16, hipR: (female ? 0.15 : 0.135) * b.w, hipX: female ? 1.2 : 1.05,
    shoulder: (female ? 0.165 : 0.2) * b.w, limb: female ? 0.9 : 1,
  };
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  body.scale.setScalar(b.h); // petite / sturdy: a bit smaller / taller overall
  const torso = new THREE.Group(); torso.position.y = HIP + 0.06; body.add(torso); // pivots at the waist (bow)

  // torso: chest + hips (+ a narrower waist for women)
  const dress = !glam && look.top === 3 && !outfit?.gown; const skirt = !glam && !dress && look.bottom === 2;
  const chestMat = abs ? skin : top;
  torso.add(mesh(CAP(dims.chestR, 0.2), chestMat, [0, 0.2, 0], { scale: [dims.chestX, 1, 0.8] }));
  if (female) torso.add(mesh(CAP(dims.chestR * 0.82, 0.1), chestMat, [0, 0.05, 0], { scale: [1, 1, 0.78] }));
  torso.add(mesh(S(dims.hipR, 18, 12), dress ? top : bottom, [0, -0.04, 0], { scale: [dims.hipX, 0.85, 0.82] }));
  // shoulders line
  torso.add(mesh(CAP(0.06 * b.w * dims.limb, dims.shoulder * 2 - 0.1), chestMat, [0, 0.36, 0], { rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.9] }));
  if (!abs && !glam) {
    if (look.top === 1) { // hoodie: hood + front pocket
      torso.add(mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 18), top, [0, 0.42, -0.05], { rot: [1.25, 0, 0] }));
      torso.add(mesh(new THREE.BoxGeometry(0.17, 0.07, 0.015), toon(new THREE.Color(look.topColor).multiplyScalar(0.8)), [0, 0.1, dims.chestR * 0.8], { noOutline: true }));
    }
    if (look.top === 2) { // open jacket over a white shirt
      torso.add(mesh(new THREE.BoxGeometry(0.07, 0.34, 0.012), toon(0xf8fafc), [0, 0.18, dims.chestR * 0.8 + 0.004], { noOutline: true }));
      for (const s of [-1, 1]) torso.add(mesh(new THREE.BoxGeometry(0.035, 0.14, 0.012), toon(new THREE.Color(look.topColor).multiplyScalar(0.75)), [s * 0.05, 0.3, dims.chestR * 0.8 + 0.008], { rot: [0, 0, s * 0.35], noOutline: true }));
    }
    if (look.top === 5 && !outfit?.aodai) { // shirt: collar + buttons
      for (const s of [-1, 1]) torso.add(mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), toon(new THREE.Color(look.topColor).multiplyScalar(0.85)), [s * 0.04, 0.42, 0.07], { rot: [0.3, 0, s * 0.5], noOutline: true }));
      for (let i = 0; i < 4; i++) torso.add(mesh(S(0.009, 6, 4), toon(0xf8fafc), [0, 0.34 - i * 0.08, dims.chestR * 0.8 + 0.004], { noOutline: true }));
    }
    if (look.top === 6) torso.add(mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.12, 14), top, [0, 0.47, 0])); // turtleneck
    if (look.top === 4) for (const s of [-1, 1]) torso.add(mesh(S(0.06 * b.w * dims.limb), skin, [s * dims.shoulder, 0.36, 0])); // tank top: bare shoulders
    if (dress) torso.add(mesh(new THREE.CylinderGeometry(dims.hipR * 1.05, dims.hipR * 1.7, 0.42, 22, 1, true), top, [0, -0.24, 0], { scale: [1, 1, 0.82] })); // dress: skirt to the knee
    if (outfit?.gown || (!dress && look.bottom === 3)) torso.add(mesh(new THREE.CylinderGeometry(dims.hipR * 1.08, dims.hipR * 2.1, 0.82, 24, 1, true), outfit?.gown ? top : bottom, [0, -0.44, 0], { scale: [1, 1, 0.85] })); // long skirt / gown to the floor
    if (outfit?.aodai) for (const z of [1, -1]) torso.add(mesh(new THREE.BoxGeometry(dims.hipR * 2.1, 0.72, 0.012), top, [0, -0.32, z * dims.hipR * 0.86], { rot: [z * 0.06, 0, 0] })); // áo dài front/back panels
    if (outfit?.tie) { torso.add(mesh(new THREE.BoxGeometry(0.07, 0.34, 0.012), toon(0xf8fafc), [0, 0.18, dims.chestR * 0.8 + 0.004], { noOutline: true })); torso.add(mesh(new THREE.BoxGeometry(0.035, 0.22, 0.01), toon(outfit.tie), [0, 0.22, dims.chestR * 0.8 + 0.012], { noOutline: true })); }
    if (outfit?.stripes) for (const s of [-1, 1]) torso.add(mesh(new THREE.BoxGeometry(0.015, 0.3, 0.015), toon(outfit.stripes), [s * dims.chestR * dims.chestX * 0.98, 0.2, 0], { noOutline: true }));
    if (outfit?.sparkle) { const sp = emissive(0xfff7ed, 1.4); for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 1.7 - 0.85; torso.add(mesh(S(0.008, 6, 4), sp, [Math.sin(a) * dims.chestR * dims.chestX, 0.06 + (i % 6) * 0.06, Math.cos(a) * dims.chestR * 0.82], { noOutline: true, noShadow: true })); } }
    if (skirt) torso.add(mesh(new THREE.CylinderGeometry(dims.hipR * 1.08, dims.hipR * 1.6, 0.36, 22, 1, true), bottom, [0, -0.2, 0], { scale: [1, 1, 0.82] }));
    if (!dress && !skirt) torso.add(mesh(new THREE.CylinderGeometry(dims.hipR * 1.13, dims.hipR * 1.13, 0.03, 20, 1, true), toon(new THREE.Color(look.bottomColor).multiplyScalar(0.6)), [0, 0.03, 0], { scale: [dims.hipX, 1, 0.82], noOutline: true })); // waistband
  }
  if (glam) glamDress(torso, look, dims);
  if (abs) sixPack(torso, look, dims);
  // neck
  torso.add(mesh(new THREE.CylinderGeometry(0.045 * dims.limb, 0.052 * dims.limb, 0.14, 12), skin, [0, 0.46, 0]));

  // head: the big-head drawing scaled down, a touch taller than wide, plus a nose
  const head = new THREE.Group(); head.position.y = HIP + 0.06 + 0.66; head.scale.set(HEAD_SCALE * 0.94, HEAD_SCALE * 1.04, HEAD_SCALE * 0.98); body.add(head);
  head.add(mesh(S(HEAD_R, 28, 22), skin));
  head.add(mesh(S(HEAD_R * 0.62, 18, 12), skin, [0, -0.2, 0.1], { scale: [0.95, 0.7, 0.9] })); // jaw / chin
  for (const s of [-1, 1]) head.add(mesh(S(0.07), skin, [s * HEAD_R * 0.98, -0.02, 0], { scale: [0.5, 1, 0.8] }));
  head.add(mesh(S(0.045, 10, 8), toon(new THREE.Color(look.skin).multiplyScalar(0.92)), [0, -0.05, HEAD_R * 0.99], { scale: [0.8, 1, 0.7], noOutline: true })); // nose
  face(look, head); hair(look, head); accessory(look, head);
  if (female || glam) for (const s of [-1, 1]) head.add(mesh(new THREE.BoxGeometry(0.06, 0.016, 0.016), toon(0x1b1020), [s * 0.2, 0.07, HEAD_R * 0.87], { rot: [0, s * 0.4, s * 0.45], noOutline: true })); // lashes
  if (glam) head.add(mesh(S(0.04), toon(0xdc2626, { emissive: 0x3a0000 }), [0, -0.13, HEAD_R * 0.93], { scale: [1.3, 0.6, 0.45], noOutline: true })); // red lips

  // arms (pivot at the shoulder) — sleeves follow the top
  const sleeveUp = abs || glam || look.top === 4 || dress ? skin : top;
  const sleeveLow = !abs && !glam && [1, 2, 5, 6].includes(look.top) ? top : skin;
  const arm = (s) => {
    const p = new THREE.Group(); p.position.set(s * dims.shoulder, 0.36, 0);
    p.add(mesh(CAP(0.05 * b.w * dims.limb, 0.2), sleeveUp, [0, -0.15, 0]));
    p.add(mesh(CAP(0.042 * b.w * dims.limb, 0.2), sleeveLow, [0, -0.4, 0.01]));
    p.add(mesh(S(0.047 * dims.limb), skin, [0, -0.58, 0.015], { scale: [0.85, 1.1, 0.7] })); // hand
    torso.add(p); return p;
  };
  // legs: hip pivot → knee pivot (so sitting bends at the knee)
  const legBare = glam || dress || skirt; const shortsLeg = !legBare && look.bottom === 1; const wide = look.bottom === 4;
  const leg = (s) => {
    const p = new THREE.Group(); p.position.set(s * dims.hipR * 0.62, HIP, 0);
    p.add(mesh(CAP(0.07 * b.w * dims.limb, THIGH - 0.12), legBare ? skin : bottom, [0, -THIGH / 2, 0]));
    const knee = new THREE.Group(); knee.position.y = -THIGH; p.add(knee);
    knee.add(mesh(wide ? new THREE.CylinderGeometry(0.06 * b.w, 0.1 * b.w, SHIN, 14) : CAP(0.055 * b.w * dims.limb, SHIN - 0.1), legBare || shortsLeg ? skin : bottom, [0, -SHIN / 2, 0]));
    if (outfit?.stripes) knee.add(mesh(new THREE.BoxGeometry(0.012, SHIN, 0.012), toon(outfit.stripes), [s * 0.058, -SHIN / 2, 0], { noOutline: true }));
    if (glam) knee.add(mesh(new THREE.ConeGeometry(0.025, 0.08, 8), shoes, [0, -SHIN + 0.02, -0.06], { rot: [0.3, 0, 0], noOutline: true })); // heel
    knee.add(mesh(RoundedBox(0.1 * dims.limb, 0.07, 0.22 * dims.limb), shoes, [0, -SHIN - 0.02, 0.04]));
    body.add(p); p.userData.knee = knee; return p;
  };
  const armL = arm(-1); const armR = arm(1); const legL = leg(-1); const legR = leg(1);
  if (abs) for (const a of [armL, armR]) a.add(mesh(S(0.06), skin, [0, -0.1, 0.012], { scale: [1.1, 1.2, 1] })); // biceps
  if (glam) for (const a of [armL, armR]) a.add(mesh(new THREE.TorusGeometry(0.045, 0.01, 6, 14), toon(0xfbbf24, { emissive: 0x3a2a00 }), [0, -0.5, 0.01], { rot: [Math.PI / 2, 0, 0], noOutline: true })); // bangles

  // mic in the right hand (shown while singing)
  const micColor = MIC_COLORS[equipped.find((e) => e.startsWith('mic-'))] ?? 0x6b7280;
  const mic = new THREE.Group(); mic.add(mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.17, 10), toon(0x1f2937)), mesh(S(0.04), toon(micColor, { emissive: new THREE.Color(micColor).multiplyScalar(0.25) }), [0, 0.1, 0]));
  mic.position.set(0, -0.6, 0.05); mic.rotation.x = -0.4; mic.visible = false; armR.add(mic);
  const hand = new THREE.Group(); hand.position.set(0, -0.6, 0.06); hand.scale.setScalar(0.8); armL.add(hand);

  // hats on the head; back items scaled down to the slimmer torso
  const back = new THREE.Group(); back.position.set(0, 0.22, 0.02); back.scale.setScalar(0.62); torso.add(back);
  for (const id of equipped) {
    if (id.startsWith('head-') || id.startsWith('face-')) headItem(id, head);
    if (id.startsWith('back-')) backItem(id, back);
  }
  const auraId = equipped.find((e) => e.startsWith('aura-'));
  if (auraId) root.add(auraParticles(auraId));

  outline(root, 0.018);
  // only the big body parts cast shadows; tiny face/hair details and ink outlines do not (cheaper shadow pass)
  root.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingSphere(); o.castShadow = !o.userData.isInk && !o.userData.noOutline && o.geometry.boundingSphere.radius * o.scale.x > 0.1; } });
  // merge the static pieces inside each moving part: far fewer draw calls
  for (const part of [head, torso, back, armL, armR, legL.userData.knee, legR.userData.knee, legL, legR, body]) bakeGroup(part, { shallow: true });
  root.userData.animated = []; root.traverse((o) => { if (o.userData.spin || o.userData.flap || o.userData.flame || o.userData.orbit) root.userData.animated.push(o); });
  const parts = { body, torso, head, armL, armR, legL, legR, kneeL: legL.userData.knee, kneeR: legR.userData.knee, mic, hand, held: null, build: b, female };
  root.userData.parts = parts;
  return root;
}

export function setHeld(root, item) {
  const p = root.userData.parts;
  if (p.held) { p.hand.remove(p.held); p.held = null; }
  if (item) { p.held = heldMesh(item); outline(p.held, 0.015); p.hand.add(p.held); }
}

// state: { anim, moving, singing, buzz, act, actT }
export function animateAvatar(root, st, t, dt) {
  const p = root.userData.parts; if (!p) return;
  const lerp = (o, k, v, s = 10) => { o[k] += (v - o[k]) * Math.min(1, dt * s); };
  let legSwing = 0, armL = 0, armR = 0, armLz = 0.06, armRz = -0.06, bodyY = 0, bounce = 0, tilt = 0, headTilt = Math.sin(t * 1.3) * 0.04, legBend = 0, knee = 0;
  const anim = st.moving ? 'walk' : st.anim;
  if (anim === 'walk') { legSwing = Math.sin(t * 9) * 0.55; armL = -legSwing * 0.7; armR = legSwing * 0.7; bounce = Math.abs(Math.sin(t * 9)) * 0.03; knee = Math.max(0, Math.sin(t * 9 + 1.2)) * 0.5; }
  else if (anim === 'dance') { knee = Math.abs(Math.sin(t * 6)) * 0.35; bounce = Math.abs(Math.sin(t * 6)) * 0.05 - knee * 0.08; armL = -2.4 + Math.sin(t * 6) * 0.5; armR = -2.4 - Math.sin(t * 6) * 0.5; tilt = Math.sin(t * 3) * 0.15; legSwing = Math.sin(t * 6) * 0.25; }
  else if (anim === 'sit') { legBend = -1.5; knee = 1.5; bodyY = SIT_DROP; armL = -0.5; armR = -0.5; }
  else if (anim === 'wave') { armR = -2.6; armRz = -0.3 + Math.sin(t * 10) * 0.35; }
  else bounce = Math.sin(t * 2) * 0.008;
  if (st.singing) { armR = -1.9; armRz = -0.45; headTilt = Math.sin(t * 2.4) * 0.08; if (anim !== 'walk') bounce = Math.abs(Math.sin(t * 4)) * 0.04; }
  // one-shot actions
  if (st.act && st.actT > 0) {
    if (st.act === 'drink' || st.act === 'eat') { armL = -2.2; armLz = 0.6; headTilt = -0.15; }
    if (st.act === 'cheers') { armL = -2.0; armLz = 0.2; }
    if (st.act === 'clap') { armL = -1.3; armR = -1.3; armLz = 0.5 + Math.sin(t * 20) * 0.25; armRz = -armLz; }
    if (st.act === 'bow') { tilt = 0; p.torso.rotation.x = 0.5; }
    if (st.act === 'hug') { armL = -1.35; armR = -1.35; armLz = 0.75; armRz = -0.75; p.torso.rotation.x = 0.12; }
    if (st.act === 'highfive') { armR = -2.75; armRz = -0.15; }
  } else p.torso.rotation.x += (0 - p.torso.rotation.x) * Math.min(1, dt * 8);
  const wobble = (st.buzz ?? 0) * Math.sin(t * 2.2) * 0.18;
  lerp(p.legL.rotation, 'x', legBend || legSwing); lerp(p.legR.rotation, 'x', legBend || -legSwing);
  if (p.kneeL) { lerp(p.kneeL.rotation, 'x', anim === 'walk' ? (legSwing > 0 ? 0.1 : knee) : knee); lerp(p.kneeR.rotation, 'x', anim === 'walk' ? (legSwing < 0 ? 0.1 : knee) : knee); }
  lerp(p.armL.rotation, 'x', armL); lerp(p.armR.rotation, 'x', armR);
  lerp(p.armL.rotation, 'z', armLz); lerp(p.armR.rotation, 'z', armRz);
  lerp(p.body.position, 'y', bodyY + bounce, 14);
  lerp(p.body.rotation, 'z', tilt + wobble, 6);
  lerp(p.head.rotation, 'z', headTilt, 6);
  p.mic.visible = !!st.singing;
  for (const o of root.userData.animated ?? []) {
    if (o.userData.spin) o.rotation.y += dt * 2;
    if (o.userData.flap) o.rotation.z = o.userData.flap * (0.4 + Math.sin(t * 6) * 0.25);
    if (o.userData.flame) o.scale.setScalar(0.3 + Math.random() * 0.12);
    if (o.userData.orbit) { const ob = o.userData.orbit; const a = ob.a + t * ob.s; o.position.set(Math.cos(a) * ob.r, ob.y + Math.sin(t * 2 + ob.a) * 0.08, Math.sin(a) * ob.r); }
  }
}
