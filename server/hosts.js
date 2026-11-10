// Hired room hosts ("gọi nhân viên"): a glam girl or a shirtless six-pack guy who comes to the caller,
// sits next to them, pours drinks, cheers and dances while songs play, then says goodbye when time is up.
// They are bot members: never take a player slot, never get a mic.
import crypto from 'node:crypto';
import { cleanLook } from './profiles.js';

export const HOST_MS = 10 * 60 * 1000;
export const MAX_HOSTS_PER_ROOM = 4;
const SOFAS = [[0, 1, 2], [3, 4, 5], [6, 7], [8, 9]]; // seat indices that share a sofa

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const KINDS = {
  girl: {
    icon: '💃', names: ['Lily', 'Ruby', 'Bella', 'Mina', 'Jenny', 'Rosie'], outfit: 'outfit-glam',
    look: () => cleanLook({ gender: 1, build: 0, skin: pick(['#fdeee3', '#fbe4d4', '#f9dcc8']), eyes: 4, mouth: 3, blush: 1, brows: 0,
      hair: pick([1, 2, 6]), hairColor: pick(['#1f130c', '#7c2d12', '#d9a441', '#a21caf']), top: 4, topColor: pick(['#dc2626', '#e11d48', '#111827', '#c026d3']),
      bottom: 2, bottomColor: '#dc2626', shoes: '#b91c1c', acc: 3, accColor: '#fbbf24' }),
    hello: ['Chào {name}, em là {me} 💋 Hôm nay em ngồi với anh/chị nha!', 'Em tới rồi đây {name} ơi 💃🔥'],
    cheer: ['{name} hát hay quá trời 😍', 'Giọng {name} làm em tan chảy 💘', 'Quẩy lên nào {name} ơi 🔥', 'Hát thêm bài nữa đi mà 🥺'],
    idle: ['Uống với em một ly nha {name} 🍻', 'Chọn bài song ca với em đi 💕', '{name} hát bài gì em nghe đi?'],
    pour: ['Em rót bia mời {name} nè 🍺', 'Một ly cho {name} nha, dô! 🥂'],
    bye: ['Em phải đi rồi, hẹn gặp lại {name} nha 😘', 'Hết giờ rồi, cảm ơn {name} nhiều 💋'],
  },
  boy: {
    icon: '🕺', names: ['Leo', 'Max', 'Ryan', 'Kenny', 'Alex', 'Duke'], outfit: 'outfit-abs',
    look: () => cleanLook({ gender: 0, build: 2, skin: pick(['#d79a6b', '#c68c5a', '#e0ac7e']), eyes: pick([0, 4]), mouth: 0, blush: 0, brows: 1,
      hair: pick([0, 4, 5, 7]), hairColor: pick(['#1f130c', '#3b2416', '#111827']), top: 4, topColor: '#111827',
      bottom: 0, bottomColor: '#111827', shoes: '#111827', acc: pick([0, 2]), accColor: '#111827' }),
    hello: ['Chào {name}, anh là {me} 💪 Tối nay anh phục vụ tận tình!', '{me} có mặt! {name} cần gì cứ gọi anh 😎'],
    cheer: ['{name} hát đỉnh quá 🔥', 'Bravo {name}! 👏💪', 'Giọng này phải lên sân khấu lớn 🎤', 'Cháy lên {name} ơi 🔥🔥'],
    idle: ['Cụng ly với anh nào {name} 🍻', '{name} muốn xem anh nhảy không? 🕺', 'Chọn bài sôi động đi {name}!'],
    pour: ['Anh rót bia cho {name} nè 🍺', 'Ly này anh mời {name}, dô! 🥂'],
    bye: ['Hết giờ rồi, anh về nha {name} 👋', 'Cảm ơn {name}, gọi anh lần sau nhé 💪'],
  },
};
export const HOST_KINDS = Object.keys(KINDS);

export class HostStaff {
  constructor(room, seats, { clock = Date.now } = {}) {
    this.room = room; this.seats = seats; this.clock = clock;
    this.hosts = new Map(); // id -> { kind, callerId, until, nextAt, name }
  }

  #mine(callerId, kind) { for (const h of this.hosts.values()) if (h.callerId === callerId && h.kind === kind) return h; return null; }

  // error code if this call cannot happen (checked before taking coins), else null
  check(callerId, kind) {
    if (!Object.hasOwn(KINDS, kind) || !this.room.members.has(callerId)) return 'unknown';
    if (!this.#mine(callerId, kind) && this.hosts.size >= MAX_HOSTS_PER_ROOM) return 'hostsBusy';
    return null;
  }

  // returns { ok, extended? } — calling the same kind again extends the time
  call(callerId, kind) {
    const err = this.check(callerId, kind); if (err) return { ok: false, error: err };
    const k = KINDS[kind]; const mine = this.#mine(callerId, kind);
    if (mine) { mine.until += HOST_MS; return { ok: true, extended: true }; }
    const used = new Set([...this.hosts.values()].map((h) => h.name));
    const name = k.names.find((n) => !used.has(n)) ?? `${k.names[0]} ${this.hosts.size + 1}`;
    const id = `staff-${crypto.randomBytes(4).toString('hex')}`;
    this.room.add({ id, name: `${k.icon} ${name}`, bot: true, look: k.look(), equipped: [k.outfit] }, { x: 7.4, z: 7.0, ry: -2.4 }); // from the staff door
    this.hosts.set(id, { kind, callerId, until: this.clock() + HOST_MS, nextAt: this.clock() + 1500, name, greeted: false });
    return { ok: true };
  }

  #say(id, h, lines) {
    const caller = this.room.members.get(h.callerId);
    this.room.chat(id, pick(lines).replace('{name}', caller?.name ?? '').replace('{me}', h.name));
  }

  #leave(id) { this.hosts.delete(id); this.room.remove(id); }

  // where to be: a free cushion on the caller's sofa, otherwise standing beside them
  #spot(id, caller) {
    if (caller.seat != null) {
      const sofa = SOFAS.find((s) => s.includes(caller.seat)) ?? [];
      const free = sofa.filter((i) => !this.room.seats[i] || this.room.seats[i] === id).sort((a, b) => Math.abs(a - caller.seat) - Math.abs(b - caller.seat));
      if (free.length) return { seat: free[0] };
    }
    const side = [...this.hosts.keys()].indexOf(id) % 2 ? -1 : 1;
    const x = caller.x + side * 0.85; const z = caller.z - 0.25;
    return { x, z, ry: (caller.ry ?? 0) - side * 0.45 }; // same way as the caller, turned a little towards them
  }

  step(now = this.clock()) {
    for (const [id, h] of this.hosts) {
      const me = this.room.members.get(id); const caller = this.room.members.get(h.callerId);
      if (!me) { this.hosts.delete(id); continue; }
      if (!caller) { this.#leave(id); continue; }
      const k = KINDS[h.kind];
      if (now >= h.until) { this.#say(id, h, k.bye); this.#leave(id); continue; }

      // keep close to the caller (checked every tick so they follow promptly)
      const spot = this.#spot(id, caller);
      if (spot.seat != null) { if (me.seat !== spot.seat) { this.room.sit(id, spot.seat); continue; } }
      else if (Math.hypot(me.x - spot.x, me.z - spot.z) > 0.6) { this.room.move(id, { ...spot, anim: 'walk' }); continue; }

      if (now < h.nextAt) continue;
      h.nextAt = now + 3500 + Math.random() * 4000;
      if (!h.greeted) { h.greeted = true; this.#say(id, h, k.hello); this.room.emote(id, 'wave'); continue; }
      const pb = this.room.playback; const playing = pb.song && !pb.pausedAt;
      const r = Math.random();
      if (playing && pb.song.singers.includes(h.callerId) && r < 0.45) { this.room.react(id, pick(['heart', 'fire', 'clap', 'star'])); if (r < 0.15) this.#say(id, h, k.cheer); continue; }
      if (playing && r < 0.3 && spot.seat == null) { this.room.move(id, { ...spot, anim: 'dance' }); continue; }
      if (playing && r < 0.5) { this.room.react(id, pick(['clap', 'heart', 'fire'])); continue; }
      if (r < 0.65 && !caller.held && this.room.stock.beer > 0) { this.room.take(h.callerId, 'beer'); this.#say(id, h, k.pour); continue; }
      if (r < 0.8) {
        if (!me.held && this.room.stock.beer > 0) this.room.take(id, 'beer');
        else if (me.held) this.room.act(id, caller.held ? 'cheers' : 'drink');
        continue;
      }
      if (!playing && r < 0.92) { this.#say(id, h, k.idle); continue; }
      this.room.emote(id, h.kind === 'boy' && spot.seat == null ? 'dance' : 'wave');
    }
  }

  info() { return [...this.hosts].map(([id, h]) => ({ id, kind: h.kind, callerId: h.callerId, until: h.until })); }
}
