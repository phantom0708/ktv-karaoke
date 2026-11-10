// Luxury lounge decor: procedural marble / carpet / damask textures, gold & velvet materials,
// crystal chandeliers, velvet drapes, columns, tufted sofas, champagne tables, flower vases.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { glow, emissive } from './toon.js';

const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); return t;
}
const hex = (c) => `#${new THREE.Color(c).getHexString()}`;

// ---------------------------------------------------------------- materials
export const GOLD = new THREE.MeshStandardMaterial({ color: 0xd8a84e, metalness: 1, roughness: 0.25, envMapIntensity: 1.3 });
export const GOLD_SOFT = new THREE.MeshStandardMaterial({ color: 0xc89a48, metalness: 0.9, roughness: 0.45, envMapIntensity: 1 });
export const LACQUER = new THREE.MeshStandardMaterial({ color: 0x0c0a0f, metalness: 0.2, roughness: 0.18, envMapIntensity: 0.8 });
export const WALNUT = new THREE.MeshStandardMaterial({ color: 0x3a2216, roughness: 0.45, metalness: 0.05, envMapIntensity: 0.6 });
export const CRYSTAL = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.02, envMapIntensity: 2.5, emissive: 0x332a1a, transparent: true, opacity: 0.92 });
export const velvet = (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.85, sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45), envMapIntensity: 0.4 });

export function marbleMaterial(dark = true) {
  const map = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = dark ? '#16121a' : '#ece7df'; g.fillRect(0, 0, w, h);
    for (let pass = 0; pass < 3; pass++) {
      g.globalAlpha = pass === 0 ? 0.08 : 0.18; g.lineWidth = pass === 0 ? 9 : 1.4;
      g.strokeStyle = dark ? (pass === 2 ? '#b08d57' : '#6b6470') : (pass === 2 ? '#c9b48a' : '#9c958c');
      for (let i = 0; i < 14; i++) {
        g.beginPath(); let x = rand() * w, y = rand() * h; g.moveTo(x, y);
        for (let k = 0; k < 6; k++) { const nx = x + (rand() - 0.3) * 260, ny = y + (rand() - 0.5) * 260; g.quadraticCurveTo((x + nx) / 2 + (rand() - 0.5) * 120, (y + ny) / 2 + (rand() - 0.5) * 120, nx, ny); x = nx; y = ny; }
        g.stroke();
      }
    }
    g.globalAlpha = 0.5; g.strokeStyle = dark ? '#000' : '#cfc7bb'; g.lineWidth = 3; // tile joints
    for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * w / 2, 0); g.lineTo(i * w / 2, h); g.moveTo(0, i * h / 2); g.lineTo(w, i * h / 2); g.stroke(); }
  }, dark ? [5, 4] : [1, 1]);
  return new THREE.MeshStandardMaterial({ map, roughness: dark ? 0.12 : 0.2, metalness: 0.05, envMapIntensity: dark ? 0.55 : 0.8 });
}

export function carpetMaterial(theme) {
  const base = new THREE.Color(theme).multiplyScalar(0.32); const mid = new THREE.Color(theme).multiplyScalar(0.55);
  const map = canvasTex(1024, 768, (g, w, h) => {
    g.fillStyle = hex(base); g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d8a84e'; g.lineWidth = 10; g.strokeRect(24, 24, w - 48, h - 48); g.lineWidth = 3; g.strokeRect(52, 52, w - 104, h - 104);
    g.fillStyle = hex(mid); g.globalAlpha = 0.5;
    for (let x = 90; x < w - 80; x += 46) for (let y = 90; y < h - 80; y += 46) { g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x + 10, y); g.lineTo(x, y + 10); g.lineTo(x - 10, y); g.fill(); }
    g.globalAlpha = 1; g.translate(w / 2, h / 2);
    for (let r = 230; r > 30; r -= 50) { g.strokeStyle = r % 100 ? '#d8a84e' : hex(mid.clone().multiplyScalar(1.6)); g.lineWidth = 6; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#d8a84e'; g.globalAlpha = 0.85;
    for (let i = 0; i < 12; i++) { g.rotate(Math.PI / 6); g.beginPath(); g.ellipse(0, -140, 22, 70, 0, 0, Math.PI * 2); g.fill(); }
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0, envMapIntensity: 0.2 });
}

export function damaskMaterial(theme) {
  const base = new THREE.Color(theme).multiplyScalar(0.22);
  const map = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = hex(base); g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(216,168,78,0.28)'; g.fillStyle = 'rgba(216,168,78,0.16)'; g.lineWidth = 2;
    const motif = (cx, cy, s) => { g.beginPath(); g.moveTo(cx, cy - 40 * s); g.bezierCurveTo(cx + 30 * s, cy - 20 * s, cx + 30 * s, cy + 20 * s, cx, cy + 40 * s); g.bezierCurveTo(cx - 30 * s, cy + 20 * s, cx - 30 * s, cy - 20 * s, cx, cy - 40 * s); g.fill(); g.stroke(); g.beginPath(); g.arc(cx, cy, 8 * s, 0, Math.PI * 2); g.stroke(); };
    motif(w / 2, h / 2, 1); motif(0, 0, 0.7); motif(w, 0, 0.7); motif(0, h, 0.7); motif(w, h, 0.7);
    g.fillStyle = 'rgba(216,168,78,0.22)'; g.fillRect(0, 0, 2, h);
  }, [10, 3]);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.8, metalness: 0, envMapIntensity: 0.3 });
}

// ---------------------------------------------------------------- props
const mesh = (geo, mat, pos, rot) => { const m = new THREE.Mesh(geo, mat); if (pos) m.position.set(...pos); if (rot) m.rotation.set(...rot); m.castShadow = true; m.receiveShadow = true; return m; };

export function chandelier(scale = 1) {
  const g = new THREE.Group(); g.userData.crystals = [];
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6), GOLD, [0, 0.55, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.12, 0.25, 16), GOLD, [0, 0, 0]));
  for (const [r, y, n] of [[1.0, -0.25, 16], [0.62, -0.55, 12], [0.3, -0.85, 8]]) {
    g.add(mesh(new THREE.TorusGeometry(r, 0.03, 8, 40), GOLD, [0, y, 0], [Math.PI / 2, 0, 0]));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const drop = mesh(new THREE.OctahedronGeometry(0.06), CRYSTAL.clone(), [Math.cos(a) * r, y - 0.16, Math.sin(a) * r]); drop.scale.y = 2.2; drop.userData.noBake = true; g.add(drop); g.userData.crystals.push(drop);
      if (r === 1.0 && i % 2 === 0) { const candle = mesh(new THREE.SphereGeometry(0.05, 8, 6), emissive(0xffe2a8, 1.3), [Math.cos(a) * r, y + 0.1, Math.sin(a) * r]); g.add(candle); const gl = glow(0xffd28a, 0.55, 0.7); gl.position.copy(candle.position); g.add(gl); }
    }
  }
  const tip = mesh(new THREE.OctahedronGeometry(0.12), CRYSTAL, [0, -1.15, 0]); tip.scale.y = 2; g.add(tip);
  const light = new THREE.PointLight(0xffd8a0, 30, 13, 1.4); light.position.y = -0.4; g.add(light); g.userData.light = light;
  g.add(Object.assign(glow(0xffe0a6, 3.2, 0.35), {}));
  g.scale.setScalar(scale); return g;
}

export function drape(width, height, color, folds = 7) {
  const geo = new THREE.PlaneGeometry(width, height, folds * 6, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin((x / width) * Math.PI * 2 * folds) * 0.09); }
  geo.computeVertexNormals();
  const m = mesh(geo, velvet(color)); m.material.side = THREE.DoubleSide; return m;
}

export function column(height) {
  const g = new THREE.Group(); const shaft = marbleMaterial(false);
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.3, 0.9), GOLD_SOFT, [0, 0.15, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.34, height - 0.75, 24), shaft, [0, height / 2, 0]));
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.add(mesh(new THREE.BoxGeometry(0.03, height - 0.9, 0.03), GOLD_SOFT, [Math.cos(a) * 0.31, height / 2, Math.sin(a) * 0.31])); }
  g.add(mesh(new THREE.CylinderGeometry(0.48, 0.32, 0.3, 24), GOLD, [0, height - 0.3, 0]));
  g.add(mesh(new THREE.BoxGeometry(1.0, 0.16, 1.0), GOLD, [0, height - 0.08, 0]));
  return g;
}

export function luxSofa(len, color) {
  const g = new THREE.Group(); const v = velvet(color); const dark = velvet(new THREE.Color(color).multiplyScalar(0.7));
  g.add(mesh(new RoundedBoxGeometry(len, 0.42, 1.0, 4, 0.08), v, [0, 0.33, 0]));
  g.add(mesh(new RoundedBoxGeometry(len, 0.85, 0.28, 4, 0.1), v, [0, 0.82, -0.44]));
  for (const x of [-len / 2, len / 2]) g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.0, 18), dark, [x, 0.62, 0], [Math.PI / 2, 0, 0]));
  const cushions = Math.round(len / 1.2);
  for (let i = 0; i < cushions; i++) g.add(mesh(new RoundedBoxGeometry(len / cushions - 0.08, 0.16, 0.82, 3, 0.07), v, [-len / 2 + (i + 0.5) * (len / cushions), 0.6, 0.05]));
  for (let x = -len / 2 + 0.35; x <= len / 2 - 0.3; x += 0.35) for (const y of [0.7, 0.98]) g.add(mesh(new THREE.SphereGeometry(0.025, 6, 4), GOLD, [x, y, -0.29]));
  g.add(mesh(new THREE.BoxGeometry(len + 0.3, 0.05, 1.04), GOLD, [0, 0.12, 0]));
  for (const x of [-len / 2 + 0.1, len / 2 - 0.1]) for (const z of [-0.4, 0.4]) g.add(mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.12, 8), GOLD, [x, 0.06, z]));
  return g;
}

export function champagneTable() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.06, 32), marbleMaterial(false), [0, 0.55, 0]));
  g.add(mesh(new THREE.TorusGeometry(0.65, 0.02, 6, 40), GOLD, [0, 0.55, 0], [Math.PI / 2, 0, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 12), GOLD, [0, 0.27, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.04, 24), GOLD, [0, 0.02, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.22, 18, 1, true), GOLD, [0.18, 0.69, 0]));
  const bottle = new THREE.MeshStandardMaterial({ color: 0x0f3b22, roughness: 0.15, metalness: 0.3, envMapIntensity: 1.2 });
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.28, 12), bottle, [0.18, 0.8, 0], [0, 0, 0.25]), mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.12, 8), GOLD, [0.13, 0.98, 0], [0, 0, 0.25]));
  const glass = new THREE.MeshStandardMaterial({ color: 0xfff6d8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.45, envMapIntensity: 2 });
  for (const [x, z] of [[-0.2, 0.15], [-0.05, -0.22]]) { g.add(mesh(new THREE.ConeGeometry(0.045, 0.16, 12, 1, true), glass, [x, 0.74, z], [Math.PI, 0, 0]), mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 6), glass, [x, 0.62, z])); }
  const candle = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 14), new THREE.MeshStandardMaterial({ color: 0xfff7e6, emissive: 0xffb36b, emissiveIntensity: 0.9 }), [-0.25, 0.64, -0.05]);
  const gl = glow(0xffb36b, 1.4, 0.6); gl.position.set(-0.25, 0.85, -0.05); // glow instead of a real light (performance)
  g.add(candle, gl);
  return g;
}

export function flowerVase(height = 1.6) {
  const g = new THREE.Group();
  const pts = [[0.0, 0], [0.22, 0.02], [0.3, 0.25], [0.22, 0.7], [0.14, 0.95], [0.2, 1.1]].map(([r, y]) => new THREE.Vector2(r, y * height * 0.6));
  g.add(mesh(new THREE.LatheGeometry(pts, 28), GOLD, [0, 0, 0]));
  const top = height * 0.66; const colors = [0xf8fafc, 0xfda4af, 0xfde68a, 0xf472b6, 0xffffff];
  for (let i = 0; i < 14; i++) { const a = rand() * Math.PI * 2, r = rand() * 0.32; const f = mesh(new THREE.SphereGeometry(0.1 + rand() * 0.05, 10, 8), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.7 }), [Math.cos(a) * r, top + 0.2 + rand() * 0.4, Math.sin(a) * r]); g.add(f); }
  for (let i = 0; i < 10; i++) { const a = rand() * Math.PI * 2; const l = mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.8 }), [Math.cos(a) * 0.35, top + 0.05 + rand() * 0.2, Math.sin(a) * 0.35]); l.scale.set(1, 0.4, 1.6); l.rotation.y = a; g.add(l); }
  return g;
}

export function twinkle(chandeliers, t) {
  for (const c of chandeliers) c.userData.crystals.forEach((d, i) => { d.material.emissiveIntensity = 0.4 + Math.max(0, Math.sin(t * 3 + i * 1.7)) ** 8 * 3; });
}
