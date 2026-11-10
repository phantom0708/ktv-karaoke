// Cel-shaded materials, ink outlines (inverted hull) and soft glow sprites.
import * as THREE from 'three';

const gradient = (() => {
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  return tex;
})();

const cache = new Map();
export function toon(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!cache.has(key)) cache.set(key, new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...opts }));
  return cache.get(key);
}

const inkMat = new THREE.MeshBasicMaterial({ color: 0x1b1020, side: THREE.BackSide });
// adds a slightly inflated back-face copy to each mesh for a hand-drawn outline
export function outline(root, thickness = 0.025) {
  const meshes = []; root.traverse((o) => { if (o.isMesh && !o.userData.noOutline) meshes.push(o); });
  for (const m of meshes) {
    const ink = new THREE.Mesh(m.geometry, inkMat);
    ink.userData.noOutline = true; ink.userData.isInk = true;
    const s = m.geometry.boundingSphere ?? (m.geometry.computeBoundingSphere(), m.geometry.boundingSphere);
    const k = 1 + thickness / Math.max(0.05, s.radius);
    ink.scale.setScalar(k);
    m.add(ink);
  }
  return root;
}

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c); return glowTex;
}
export function glow(color, size = 1, opacity = 0.9) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size); return s;
}

export function emissive(color, intensity = 1) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
}

// canvas text → sprite/plane texture (signs on doors etc.)
export function textTexture(text, { font = '700 64px "Baloo 2", sans-serif', color = '#fff', bg = null, w = 512, h = 128, glowColor = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 28); g.fill(); }
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (glowColor) { g.shadowColor = glowColor; g.shadowBlur = 24; }
  g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}
