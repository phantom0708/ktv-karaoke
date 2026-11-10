// Character creator: turntable preview + tabbed options.
import * as THREE from 'three';
import { buildAvatar, animateAvatar, isFemale } from './three/avatar.js';
import { t } from './i18n.js';

export const DEFAULT_LOOK = { gender: 0, build: 1, skin: '#f2c9a1', eyes: 0, mouth: 0, blush: 1, brows: 0, hair: 0, hairColor: '#3b2416', top: 0, topColor: '#f97316', bottom: 0, bottomColor: '#1e3a8a', shoes: '#f8fafc', acc: 0, accColor: '#111827' };
const PAL = {
  skin: ['#fbe3cf', '#f8d9bd', '#f2c9a1', '#e0ac7e', '#c68c5a', '#a86b42', '#8d5a3b', '#5e3a26'],
  hair: ['#1f130c', '#3b2416', '#7c4a1e', '#b7773a', '#d9a441', '#e5e7eb', '#ef6f8f', '#5b8def', '#8b5cf6', '#22c55e'],
  cloth: ['#f97316', '#ff7a59', '#e11d48', '#ec4899', '#a855f7', '#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#facc15', '#f8fafc', '#111827'],
  dark: ['#1e3a8a', '#111827', '#334155', '#57534e', '#7c2d12', '#0f766e', '#f8fafc', '#be185d'],
};
const TABS = {
  body: [['presets', 'presets'], ['gender', 'chips', 'genders'], ['build', 'chips', 'builds'], ['skin', 'swatch', PAL.skin]],
  face: [['eyes', 'chips', 'eyesList'], ['mouth', 'chips', 'mouthList'], ['brows', 'chips', 'browsList'], ['blush', 'chips', 'blushList']],
  hair: [['hair', 'chips', 'hairList'], ['hairColor', 'swatch', PAL.hair]],
  outfit: [['top', 'chips', 'topList'], ['topColor', 'swatch', PAL.cloth], ['bottom', 'chips', 'bottomList'], ['bottomColor', 'swatch', PAL.dark], ['shoes', 'swatch', PAL.dark.concat(PAL.cloth.slice(0, 4))]],
  acc: [['acc', 'chips', 'accList'], ['accColor', 'swatch', PAL.cloth]],
};
const TAB_LABEL = { body: 'tabBody', face: 'tabFace', hair: 'tabHair', outfit: 'tabOutfit', acc: 'tabAcc' };
const LIMITS = { build: 2, eyes: 4, mouth: 3, brows: 2, blush: 1, hair: 9, top: 6, bottom: 4, acc: 6 };
// ready-made characters: 4 men, 4 women (one tap, then tweak)
const L = (o) => ({ ...DEFAULT_LOOK, ...o });
export const PRESETS = [
  { icon: '🧑‍💼', look: L({ gender: 0, build: 1, skin: '#f2c9a1', eyes: 0, brows: 1, blush: 0, hair: 0, hairColor: '#1f130c', top: 5, topColor: '#f8fafc', bottom: 0, bottomColor: '#1e293b', shoes: '#111827', acc: 0 }) },
  { icon: '🎸', look: L({ gender: 0, build: 1, skin: '#e0ac7e', eyes: 4, brows: 1, blush: 0, hair: 5, hairColor: '#111827', top: 2, topColor: '#111827', bottom: 0, bottomColor: '#334155', shoes: '#111827', acc: 2, accColor: '#111827' }) },
  { icon: '🏀', look: L({ gender: 0, build: 2, skin: '#c68c5a', eyes: 0, brows: 1, blush: 0, hair: 7, hairColor: '#1f130c', top: 4, topColor: '#f97316', bottom: 1, bottomColor: '#111827', shoes: '#f8fafc', acc: 0 }) },
  { icon: '📚', look: L({ gender: 0, build: 0, skin: '#f8d9bd', eyes: 1, brows: 0, blush: 1, hair: 8, hairColor: '#7c4a1e', top: 6, topColor: '#0f766e', bottom: 0, bottomColor: '#57534e', shoes: '#7c2d12', acc: 6, accColor: '#111827' }) },
  { icon: '🌸', look: L({ gender: 1, build: 0, skin: '#fbe3cf', eyes: 2, mouth: 3, brows: 0, blush: 1, hair: 9, hairColor: '#1f130c', top: 3, topColor: '#ec4899', bottom: 2, bottomColor: '#ec4899', shoes: '#be185d', acc: 3, accColor: '#fbbf24' }) },
  { icon: '🎀', look: L({ gender: 1, build: 0, skin: '#f8d9bd', eyes: 4, mouth: 0, brows: 0, blush: 1, hair: 6, hairColor: '#b7773a', top: 1, topColor: '#a855f7', bottom: 2, bottomColor: '#1e293b', shoes: '#f8fafc', acc: 4, accColor: '#ec4899' }) },
  { icon: '💼', look: L({ gender: 1, build: 1, skin: '#f2c9a1', eyes: 0, mouth: 0, brows: 0, blush: 0, hair: 1, hairColor: '#3b2416', top: 2, topColor: '#1e3a8a', bottom: 3, bottomColor: '#111827', shoes: '#111827', acc: 1, accColor: '#111827' }) },
  { icon: '🎤', look: L({ gender: 1, build: 1, skin: '#e0ac7e', eyes: 2, mouth: 0, brows: 2, blush: 1, hair: 3, hairColor: '#ef6f8f', top: 4, topColor: '#f8fafc', bottom: 4, bottomColor: '#6366f1', shoes: '#f8fafc', acc: 3, accColor: '#fbbf24' }) },
];

export class Creator {
  constructor(canvas, { tabsEl, optionsEl }) {
    this.canvas = canvas; this.tabsEl = tabsEl; this.optionsEl = optionsEl;
    this.look = { ...DEFAULT_LOOK }; this.equipped = []; this.tab = 'body';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50); this.camera.position.set(0, 1.25, 5.2); this.camera.lookAt(0, 0.95, 0);
    this.scene.add(new THREE.HemisphereLight(0xfff1e0, 0x6b3f7a, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 4, 4); this.scene.add(key);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.12, 40), new THREE.MeshToonMaterial({ color: 0xfff8f0 })); disc.position.y = -0.06; this.scene.add(disc);
    this.rotY = 0.4; this.clock = new THREE.Clock();
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (drag != null) { this.rotY += (e.clientX - drag) * 0.01; drag = e.clientX; } });
    canvas.addEventListener('pointerup', () => { drag = null; });
    const loop = () => { this.#frame(); requestAnimationFrame(loop); }; loop();
  }

  open(look, equipped = []) {
    this.look = { ...DEFAULT_LOOK, ...look }; this.equipped = equipped;
    if (this.look.gender !== 0 && this.look.gender !== 1) this.look.gender = isFemale(this.look) ? 1 : 0; // older characters: make the guess explicit
    this.render(); this.#rebuild();
  }

  random() {
    const r = (n) => Math.floor(Math.random() * (n + 1)); const p = (a) => a[r(a.length - 1)];
    for (const [k, n] of Object.entries(LIMITS)) this.look[k] = r(n);
    this.look.gender = r(1); // keep a random character believable: skirts/dresses and long hair mostly for women
    if (!this.look.gender) { if ([3].includes(this.look.top)) this.look.top = 0; if ([2, 3].includes(this.look.bottom)) this.look.bottom = 0; if (this.look.hair === 9 || this.look.hair === 6) this.look.hair = 0; }
    else if (this.look.acc === 5) this.look.acc = 0;
    Object.assign(this.look, { skin: p(PAL.skin), hairColor: p(PAL.hair), topColor: p(PAL.cloth), bottomColor: p(PAL.dark), shoes: p(PAL.dark), accColor: p(PAL.cloth) });
    this.render(); this.#rebuild();
  }

  reset() { this.look = { ...DEFAULT_LOOK }; this.render(); this.#rebuild(); }

  render() {
    this.tabsEl.innerHTML = Object.keys(TABS).map((k) => `<button type="button" data-tab="${k}" class="${k === this.tab ? 'active' : ''}">${t(TAB_LABEL[k])}</button>`).join('');
    this.tabsEl.onclick = (e) => { const k = e.target.dataset.tab; if (k) { this.tab = k; this.render(); } };
    this.optionsEl.innerHTML = TABS[this.tab].map(([key, kind, src]) => {
      if (kind === 'presets') {
        return `<div class="cr-field"><h4>${t('presets')}</h4><div class="chips presets">${PRESETS.map((p, i) => `<button type="button" data-preset="${i}" title="${t(p.look.gender ? 'female' : 'male')}">${p.icon}<small>${t(p.look.gender ? 'female' : 'male')}</small></button>`).join('')}</div></div>`;
      }
      if (kind === 'chips') {
        return `<div class="cr-field"><h4>${t(key)}</h4><div class="chips">${t(src).map((label, i) => `<button type="button" data-k="${key}" data-v="${i}" class="${this.look[key] === i ? 'active' : ''}">${label}</button>`).join('')}</div></div>`;
      }
      return `<div class="cr-field"><h4>${t(key)}</h4><div class="swatches">${src.map((c) => `<button type="button" data-k="${key}" data-c="${c}" style="background:${c}" class="${this.look[key] === c ? 'active' : ''}"></button>`).join('')}<input type="color" data-k="${key}" value="${this.look[key]}"></div></div>`;
    }).join('');
    this.optionsEl.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.preset != null) this.look = { ...PRESETS[Number(b.dataset.preset)].look };
      if (b.dataset.v != null) this.look[b.dataset.k] = Number(b.dataset.v);
      if (b.dataset.c) this.look[b.dataset.k] = b.dataset.c;
      this.render(); this.#rebuild();
    };
    this.optionsEl.oninput = (e) => { if (e.target.type === 'color') { this.look[e.target.dataset.k] = e.target.value; this.#rebuild(); } };
  }

  #rebuild() { if (this.avatar) this.scene.remove(this.avatar); this.avatar = buildAvatar(this.look, this.equipped); this.scene.add(this.avatar); }

  #frame() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) { this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.avatar) { this.avatar.rotation.y = this.rotY; animateAvatar(this.avatar, { anim: 'idle', moving: false, singing: false, buzz: 0 }, this.clock.elapsedTime, dt); }
    this.renderer.render(this.scene, this.camera);
  }
}
