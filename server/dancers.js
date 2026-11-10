// "Gọi vũ công": a crew of two backup dancers who dance on the stage, either side of the singers, for a few minutes.
// They are bot members placed on the stage (members carry `stage: {x, z}` so clients pin them up there);
// they dance while a song plays, cheer the singer, and wave when the music stops. Calling again adds time.
import crypto from 'node:crypto';
import { cleanLook } from './profiles.js';

export const DANCE_MS = 5 * 60 * 1000;
export const DANCER_SPOTS = [{ x: -3.2, z: -4.5 }, { x: 3.2, z: -4.5 }];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const CREW = [
  () => ({ name: pick(['Mia', 'Luna', 'Kiki', 'Nana']), look: cleanLook({ gender: 1, build: 0, skin: pick(['#f8d9bd', '#f2c9a1', '#e0ac7e']), eyes: 2, mouth: 0, blush: 1, hair: pick([3, 6]), hairColor: pick(['#1f130c', '#ef6f8f', '#8b5cf6']), top: 4, topColor: '#f8fafc', bottom: 4, bottomColor: '#111827', shoes: '#f8fafc', acc: 3, accColor: '#fbbf24' }), equipped: ['outfit-idol'] }),
  () => ({ name: pick(['Jay', 'Kai', 'Bin', 'Tony']), look: cleanLook({ gender: 0, build: 1, skin: pick(['#f2c9a1', '#c68c5a', '#e0ac7e']), eyes: 4, mouth: 0, blush: 0, brows: 1, hair: pick([5, 0, 8]), hairColor: pick(['#111827', '#d9a441', '#3b2416']), top: 2, topColor: '#111827', bottom: 0, bottomColor: '#111827', shoes: '#111827', acc: 2, accColor: '#111827' }), equipped: ['outfit-idol'] }),
];

export class StageDancers {
  constructor(room, { clock = Date.now } = {}) { this.room = room; this.clock = clock; this.ids = []; this.until = 0; this.nextAt = 0; this.anim = 'idle'; }

  get active() { return this.ids.length > 0; }

  // returns { ok, extended? }
  call(callerId) {
    if (!this.room.members.has(callerId)) return { ok: false, error: 'unknown' };
    if (this.active) { this.until += DANCE_MS; return { ok: true, extended: true }; }
    this.until = this.clock() + DANCE_MS; this.nextAt = this.clock() + 1500; this.anim = '';
    DANCER_SPOTS.forEach((spot, i) => {
      const c = CREW[i](); const id = `dancer-${crypto.randomBytes(4).toString('hex')}`;
      this.room.add({ id, name: `🩰 ${c.name}`, bot: true, look: c.look, equipped: c.equipped }, { x: spot.x, z: spot.z, ry: 0, anim: 'dance', stage: spot });
      this.ids.push(id);
    });
    return { ok: true };
  }

  #setAnim(anim) {
    if (anim === this.anim) return; this.anim = anim;
    for (const id of this.ids) { const m = this.room.members.get(id); if (!m) continue; m.anim = anim; this.room.broadcast({ type: 'peer.move', id, x: m.x, z: m.z, ry: 0, anim, seat: null }); }
  }

  leave() { for (const id of this.ids) this.room.remove(id); this.ids = []; this.until = 0; }

  step(now = this.clock()) {
    if (!this.active) return;
    this.ids = this.ids.filter((id) => this.room.members.has(id));
    if (now >= this.until || !this.room.humans().length) { if (this.ids[0]) this.room.chat(this.ids[0], 'Cảm ơn cả nhà, hẹn gặp lại! 👋💃'); return this.leave(); }
    const pb = this.room.playback; const playing = !!pb.song && !pb.pausedAt;
    this.#setAnim(playing ? 'dance' : 'idle');
    if (now < this.nextAt) return;
    this.nextAt = now + 4000 + Math.random() * 4000;
    const id = pick(this.ids);
    if (playing) this.room.react(id, pick(['fire', 'heart', 'clap', 'star']));
    else this.room.emote(id, 'wave');
  }

  info() { return { ids: [...this.ids], until: this.until }; }
}
