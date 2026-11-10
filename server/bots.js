// Ambient NPC guests: wander, sit, cheer, drink and chat a little so rooms never feel empty.
import crypto from 'node:crypto';
import { cleanLook } from './profiles.js';
import { SEATS, TABLE } from './rooms.js';

const NAMES = ['Bánh Bao', 'Su Kem', 'Tí Hon', 'Mít Ướt', 'Cà Pháo', 'Bông Gòn', 'Kẹo Dẻo', 'Sóc Nâu', 'Khoai Lang', 'Đậu Phộng', 'Hột Mít', 'Bé Na'];
const GREET = ['Chào {name}! 👋', 'Ơ {name} tới rồi!', 'Hello {name} 🎶', '{name} hát bài gì đi!'];
const CHEER = ['Hay quá!', 'Encore! 🎉', 'Giọng ngọt ghê', 'Quẩy lên nào 🔥', 'Nghe nổi da gà', 'Hát thêm bài nữa đi!'];
const IDLE_CHAT = ['Ai chọn bài đi nè', 'Tối nay vui ghê', 'Có ai song ca không?', 'Bàn tiệc còn bia đó 🍺'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const randomLook = () => cleanLook({
  build: Math.floor(rnd(0, 3)), eyes: Math.floor(rnd(0, 5)), mouth: Math.floor(rnd(0, 4)), brows: Math.floor(rnd(0, 3)), blush: Math.round(Math.random()),
  hair: Math.floor(rnd(0, 8)), top: Math.floor(rnd(0, 5)), bottom: Math.floor(rnd(0, 3)), acc: Math.floor(rnd(0, 5)),
  skin: pick(['#f8d9bd', '#f2c9a1', '#e0ac7e', '#c68c5a', '#8d5a3b']),
  hairColor: pick(['#1f130c', '#3b2416', '#7c4a1e', '#d9a441', '#e5e7eb', '#ef6f8f', '#5b8def']),
  topColor: pick(['#f97316', '#22c55e', '#0ea5e9', '#e11d48', '#a855f7', '#facc15', '#14b8a6']),
  bottomColor: pick(['#1e3a8a', '#111827', '#57534e', '#7c2d12', '#334155']), shoes: pick(['#f8fafc', '#111827', '#dc2626']),
  accColor: pick(['#111827', '#f59e0b', '#ec4899']),
});

export class BotCrowd {
  constructor(space, { isRoom }) {
    this.space = space; this.isRoom = isRoom; this.bots = new Map(); // id -> { nextAt }
    this.used = new Set();
  }

  ensure(count) {
    while (this.bots.size > count) { const [id, b] = this.bots.entries().next().value; this.space.remove(id); this.bots.delete(id); this.used.delete(b.name); }
    while (this.bots.size < count) { // bots are extras: they do not use the room's player slots
      const name = NAMES.find((n) => !this.used.has(n)) ?? `Bạn ${this.bots.size + 1}`; this.used.add(name);
      const id = `bot-${crypto.randomBytes(4).toString('hex')}`;
      const [x0, x1] = this.space.bounds.x; const [z0, z1] = this.space.bounds.z;
      this.space.add({ id, name: `🤖 ${name}`, bot: true, look: randomLook(), equipped: [] }, { x: rnd(x0 + 1, x1 - 1), z: rnd(Math.max(z0, 0), z1 - 1) });
      this.bots.set(id, { nextAt: Date.now() + rnd(1000, 4000), name });
    }
  }

  greet(name) {
    const ids = [...this.bots.keys()]; if (!ids.length) return;
    const id = pick(ids); setTimeout(() => this.space.chat(id, pick(GREET).replace('{name}', name)), rnd(1200, 3000));
  }

  step(now = Date.now()) {
    const room = this.isRoom ? this.space : null;
    for (const [id, b] of this.bots) {
      if (now < b.nextAt) continue;
      b.nextAt = now + rnd(2500, 7000);
      const m = this.space.members.get(id); if (!m) { this.bots.delete(id); this.used.delete(b.name); continue; }
      const playing = room?.playback.song && !room.playback.pausedAt;
      const r = Math.random();
      if (room && playing && r < 0.35) { room.react(id, pick(['clap', 'heart', 'fire', 'star'])); continue; }
      if (room && playing && r < 0.42) { this.space.chat(id, pick(CHEER)); continue; }
      if (room && r < 0.5) {
        if (!m.held && room.stock.beer > 2) { this.space.move(id, { x: TABLE.x + rnd(-1, 1), z: TABLE.z - 1, ry: 0, anim: 'walk' }); setTimeout(() => room.take(id, pick(['beer', 'soda', 'fruit'])), 1500); }
        else if (m.held) room.act(id, Math.random() < 0.6 ? 'drink' : 'cheers');
        continue;
      }
      if (room && r < 0.62) { const free = room.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0); if (free.length) { room.sit(id, pick(free)); continue; } }
      if (r < 0.66 && !playing) { this.space.chat(id, pick(IDLE_CHAT)); continue; }
      if (r < 0.72) { this.space.emote(id, pick(['wave', 'dance'])); continue; }
      const [x0, x1] = this.space.bounds.x; const [z0, z1] = this.space.bounds.z;
      const x = rnd(x0 + 1, x1 - 1); const z = rnd(Math.max(z0, -1), z1 - 1);
      this.space.move(id, { x, z, ry: Math.atan2(x - m.x, z - m.z), anim: playing && Math.random() < 0.3 ? 'dance' : 'walk' });
    }
  }
}

export { SEATS };
