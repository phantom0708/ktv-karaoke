// Karaoke room logic (pure, no I/O): queue, synced playback, control requests, duet,
// party table, services, stage effects, seats, rewards. Hooks are injected by the caller.
import crypto from 'node:crypto';
import { Space } from './space.js';
import { HostStaff } from './hosts.js';
import { StageDancers } from './dancers.js';

export const START_DELAY_MS = 3000;
export const MAX_QUEUED_PER_MEMBER = 3;
export const MAX_QUEUE = 30;
export const CONTROL_TIMEOUT_MS = 10_000; // an unanswered pause/resume/skip request applies itself

export const PRICES = {
  food: { beer: 15, soda: 10, fruit: 10, cake: 25, pizza: 30 },
  fx: { confetti: 15, sparks: 40, balloons: 25, bubbles: 20 },
  gift: { flowers: 30, star: 60, trophy: 120 },
  host: { girl: 300, boy: 300 }, // a room host for 10 minutes (server/hosts.js)
  dance: { crew: 500 }, // two backup dancers on the stage for 5 minutes (server/dancers.js)
};
export const EARN = {
  listen: 1, listenEvery: 10, singMinShare: 0.6, singMinSec: 30, singAudience: 40, singSolo: 20,
  react: 3, reactCap: 30, giftShare: 0.8,
};
export const FOODS = Object.keys(PRICES.food);
export const EFFECTS = ['lights', 'disco', 'strobe', 'laser', 'smoke'];
export const SEATS = [ // sofa cushions: [x, z, ry] — must match public/js/three/worlds.js
  [-8.05, 0.6, Math.PI / 2], [-8.05, 1.8, Math.PI / 2], [-8.05, 3.0, Math.PI / 2],
  [8.05, 0.6, -Math.PI / 2], [8.05, 1.8, -Math.PI / 2], [8.05, 3.0, -Math.PI / 2],
  [-3.5, 7.85, Math.PI], [-2.3, 7.85, Math.PI], [2.5, 7.85, Math.PI], [3.7, 7.85, Math.PI],
];
export const TABLE = { x: -5.2, z: 6.2 };
const BUZZ_PER_DRINK = 0.34;
const BUZZ_DECAY_PER_SEC = 0.004;
const CHEERS_RADIUS = 2.5;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const newId = () => crypto.randomBytes(6).toString('hex');

export const ROOM_DEFS = [
  { id: 'r1', name: 'Sunset Ballad', capacity: 12, color: '#f59e0b', blurb: 'Tình ca, ballad nhẹ nhàng', genre: 'ballad' },
  { id: 'r2', name: 'V-Pop Rooftop', capacity: 12, color: '#fb7185', blurb: 'Hit Việt sôi động', genre: 'vpop' },
  { id: 'r3', name: 'Bolero Garden', capacity: 12, color: '#eab308', blurb: 'Nhạc vàng, trữ tình', genre: 'bolero' },
  { id: 'r4', name: 'Rock Basement', capacity: 12, color: '#ef4444', blurb: 'Gào hết mình', genre: 'rock' },
  { id: 'r5', name: 'Global Hits', capacity: 12, color: '#38bdf8', blurb: 'US-UK, K-Pop, J-Pop', genre: 'global' },
  { id: 'r6', name: 'Acoustic Corner', capacity: 12, color: '#34d399', blurb: 'Mộc, chill, lo-fi', genre: 'acoustic' },
  { id: 'r7', name: 'Hoa Ngữ Lounge', capacity: 12, color: '#f97316', blurb: 'Nhạc Hoa kinh điển', genre: 'chinese' },
  { id: 'r8', name: 'Kids Party', capacity: 12, color: '#a3e635', blurb: 'Thiếu nhi vui nhộn', genre: 'kids' },
];

export class Room extends Space {
  constructor(def, { clock = Date.now, broadcast = () => {}, reward = () => {}, spend = () => true, stat = () => {} } = {}) {
    super({ id: def.id, capacity: def.capacity, bounds: { x: [-9.5, 9.5], z: [-3.6, 8] }, broadcast, clock });
    this.def = def;
    Object.assign(this, { reward, spend, stat });
    this.hostId = null;
    this.queue = [];
    this.playback = { song: null, startedAt: null, pausedAt: null };
    this.invites = new Map();
    this.requests = new Map(); // reqId -> { from, to, action, songId }
    this.stock = { beer: 12, soda: 10, fruit: 8, cake: 0, pizza: 0 };
    this.effects = { lights: true, disco: false, strobe: false, laser: false, smoke: false };
    this.seats = new Array(SEATS.length).fill(null);
    this.lastTick = clock();
    this.staff = new HostStaff(this, SEATS, { clock });
    this.dancers = new StageDancers(this, { clock });
  }

  // ---------- membership ----------
  add(profile, extra) {
    const m = super.add(profile, extra);
    if (m && !m.bot && !this.hostId) { this.hostId = m.id; this.broadcast({ type: 'host', hostId: m.id }); }
    return m;
  }

  remove(id) {
    const m = super.remove(id); if (!m) return null;
    this.#freeSeat(id);
    const before = this.queue.length;
    this.queue = this.queue.filter((s) => s.ownerId !== id);
    if (this.queue.length !== before) this.#sendQueue();
    if (!this.humans().length) { // last person left: reset the room for the next group
      this.effects = { lights: true, disco: false, strobe: false, laser: false, smoke: false };
      this.stock = { beer: 12, soda: 10, fruit: 8, cake: 0, pizza: 0 };
    }
    if (this.hostId === id) {
      this.hostId = this.humans()[0]?.id ?? null;
      this.broadcast({ type: 'host', hostId: this.hostId });
    }
    const song = this.playback.song;
    if (song?.ownerId === id) this.#next();
    else if (song?.singers.includes(id)) { song.singers = song.singers.filter((x) => x !== id); this.#sendPlayback(); }
    return m;
  }

  // ---------- queue & playback ----------
  enqueue(memberId, { videoId, title, channel = '' }) {
    if (!this.members.has(memberId) || !VIDEO_ID.test(videoId || '')) return false;
    if (this.queue.filter((s) => s.ownerId === memberId).length >= MAX_QUEUED_PER_MEMBER || this.queue.length >= MAX_QUEUE) return false;
    const song = {
      id: newId(), videoId, title: String(title || videoId).slice(0, 140), channel: String(channel).slice(0, 80),
      ownerId: memberId, ownerName: this.members.get(memberId).name, singers: [memberId], duration: null, gifts: {},
    };
    if (!this.playback.song) { this.queue.unshift(song); this.#next(); } else { this.queue.push(song); this.#sendQueue(); }
    return true;
  }

  removeQueued(memberId, songId) {
    const i = this.queue.findIndex((s) => s.id === songId && (s.ownerId === memberId || this.hostId === memberId));
    if (i < 0) return false;
    this.queue.splice(i, 1); this.#sendQueue(); return true;
  }

  prioritize(memberId, songId) {
    if (this.hostId !== memberId) return false;
    const i = this.queue.findIndex((s) => s.id === songId); if (i <= 0) return i === 0;
    this.queue.unshift(...this.queue.splice(i, 1)); this.#sendQueue(); return true;
  }

  // returns { ok } when applied, { ok:false, asked:true } when a request was sent to the singer
  control(memberId, action) {
    const song = this.playback.song;
    if (!song || !['pause', 'resume', 'skip'].includes(action) || !this.members.has(memberId)) return { ok: false };
    if (song.singers.includes(memberId) || this.hostId === memberId) return { ok: this.#apply(action, memberId) };
    const reqId = newId(); const to = song.ownerId; const timeoutSec = CONTROL_TIMEOUT_MS / 1000;
    this.requests.set(reqId, { from: memberId, to, action, songId: song.id, at: this.clock() });
    this.broadcast({ type: 'control.request', reqId, to, from: memberId, fromName: this.members.get(memberId).name, action, timeoutSec });
    return { ok: false, asked: true, singerName: this.members.get(to)?.name ?? song.ownerName, timeoutSec };
  }

  answerControl(memberId, reqId, accept) {
    const r = this.requests.get(reqId);
    if (!r || r.to !== memberId) return false;
    this.requests.delete(reqId);
    this.broadcast({ type: 'control.answer', reqId, to: r.from, accept: !!accept, action: r.action });
    if (accept && this.playback.song?.id === r.songId) this.#apply(r.action, r.from);
    return true;
  }

  #apply(action, byId) {
    const pb = this.playback; const now = this.clock();
    if (action === 'pause' && !pb.pausedAt) pb.pausedAt = now;
    else if (action === 'resume' && pb.pausedAt) { pb.startedAt += now - pb.pausedAt; pb.pausedAt = null; }
    else if (action === 'skip') { this.broadcast({ type: 'notice', code: 'skipped', name: this.members.get(byId)?.name }); this.#next(); return true; }
    else return false;
    this.broadcast({ type: 'notice', code: action, name: this.members.get(byId)?.name });
    this.#sendPlayback();
    return true;
  }

  setDuration(songId, seconds) {
    const song = this.playback.song;
    if (!song || song.id !== songId || song.duration || !(seconds >= 30 && seconds < 4 * 3600)) return; // a 1 s 'duration' would end anyone's song
    song.duration = seconds; this.#sendPlayback();
  }

  ended(songId) {
    const song = this.playback.song;
    if (!song || song.id !== songId) return;
    const sung = this.#elapsedSec();
    // 'ended' comes from any client: only believe it near the real end (skipping early is what 'control' is for)
    if (song.duration ? sung < song.duration * 0.9 - 2 : sung < 15 * 60) return;
    if (sung >= Math.max(EARN.singMinSec, song.duration * EARN.singMinShare)) {
      const audience = this.humans().some((m) => !song.singers.includes(m.id));
      this.lastSingPay ??= new Map(); const now = this.clock();
      for (const id of song.singers.filter((x) => now - (this.lastSingPay.get(x) ?? -Infinity) >= 150_000)) { // at most one sing reward per 2.5 min each
        this.lastSingPay.set(id, now); this.reward(id, audience ? EARN.singAudience : EARN.singSolo, 'sing'); this.stat(id, 'songs', 1); }
    }
    this.#next();
  }

  tick() {
    const now = this.clock(); const dt = (now - this.lastTick) / 1000; this.lastTick = now;
    for (const m of this.members.values()) {
      if (m.buzz > 0) { const b = Math.max(0, m.buzz - BUZZ_DECAY_PER_SEC * dt); if (Math.abs(b - m.buzz) > 0.05 || b === 0) { m.buzz = b; this.broadcast({ type: 'buzz', id: m.id, buzz: b }); } else m.buzz = b; }
    }
    // requests the singer never answered apply themselves, so music never keeps playing because nobody replied
    for (const [reqId, r] of this.requests) {
      if (now - r.at < CONTROL_TIMEOUT_MS) continue;
      this.requests.delete(reqId);
      this.broadcast({ type: 'control.answer', reqId, to: r.from, accept: true, auto: true, action: r.action });
      this.broadcast({ type: 'control.expired', reqId, to: r.to });
      if (this.playback.song?.id === r.songId) this.#apply(r.action, r.from);
    }
    const song = this.playback.song;
    if (song?.duration && !this.playback.pausedAt && this.#elapsedSec() > song.duration + 5) this.ended(song.id);
  }

  payListeners() {
    const pb = this.playback;
    if (!pb.song || pb.pausedAt || this.clock() < pb.startedAt) return;
    for (const m of this.humans()) this.reward(m.id, EARN.listen, 'listen');
  }

  // ---------- duet ----------
  inviteDuet(fromId, toId) {
    const song = this.playback.song; const to = this.members.get(toId);
    if (!song || song.ownerId !== fromId || song.singers.length >= 2 || !to || to.bot || song.singers.includes(toId)) return false;
    if (!this.invites.has(song.id)) this.invites.set(song.id, new Set());
    this.invites.get(song.id).add(toId);
    this.broadcast({ type: 'duet.invited', to: toId, from: this.members.get(fromId).name, songId: song.id, title: song.title });
    return true;
  }

  acceptDuet(memberId, songId) {
    const song = this.playback.song;
    if (!song || song.id !== songId || song.singers.length >= 2 || !this.invites.get(songId)?.has(memberId)) return false;
    song.singers.push(memberId); this.invites.delete(songId); this.#sendPlayback(); return true;
  }

  // ---------- reactions, party, services ----------
  react(memberId, kind) {
    if (!this.members.has(memberId) || !['clap', 'heart', 'fire', 'laugh', 'star', 'cheers'].includes(kind)) return false;
    this.broadcast({ type: 'react', id: memberId, kind });
    const song = this.playback.song; const m = this.members.get(memberId);
    if (song && !song.singers.includes(memberId) && !m.bot && !this.playback.pausedAt) {
      song.reactPaid ??= {}; song.lastReact ??= {};
      if (this.clock() - (song.lastReact[memberId] ?? 0) >= 1500) {
        song.lastReact[memberId] = this.clock();
        for (const id of song.singers) {
          const paid = song.reactPaid[id] ?? 0;
          const amount = Math.min(EARN.react, EARN.reactCap - paid);
          if (amount > 0) { song.reactPaid[id] = paid + amount; this.reward(id, amount, 'react'); }
        }
      }
    }
    return true;
  }

  take(memberId, item) {
    const m = this.members.get(memberId);
    if (!m) return false;
    if (!item) { m.held = ''; this.broadcast({ type: 'held', id: memberId, item: '' }); return true; }
    if (!FOODS.includes(item) || !(this.stock[item] > 0)) return false;
    this.stock[item]--; m.held = item;
    this.broadcast({ type: 'stock', stock: this.stock });
    this.broadcast({ type: 'held', id: memberId, item });
    return true;
  }

  act(memberId, kind) {
    const m = this.members.get(memberId); if (!m) return false;
    if (kind === 'drink') {
      if (!m.held) return false;
      if (['beer'].includes(m.held)) m.buzz = Math.min(1, m.buzz + BUZZ_PER_DRINK);
      this.broadcast({ type: 'act', id: memberId, kind, item: m.held, buzz: m.buzz });
      return true;
    }
    if (kind === 'cheers') {
      if (!m.held) return false;
      const near = [...this.members.values()].filter((o) => o.id !== memberId && o.held && Math.hypot(o.x - m.x, o.z - m.z) <= CHEERS_RADIUS).map((o) => o.id);
      this.broadcast({ type: 'act', id: memberId, kind, with: near });
      return true;
    }
    return false;
  }

  order(memberId, { kind, item }) {
    const price = Object.hasOwn(PRICES, kind) && Object.hasOwn(PRICES[kind], item) ? PRICES[kind][item] : null; const m = this.members.get(memberId); // own keys only: 'constructor' etc. would be a function
    if (!Number.isFinite(price) || !m) return { ok: false, error: 'unknown' };
    if (kind === 'gift' && !this.playback.song) return { ok: false, error: 'noSinger' };
    if (m.guest || m.bot) return { ok: false, error: 'needAccount' };
    if (kind === 'host') { const err = this.staff.check(memberId, item); if (err) return { ok: false, error: err }; }
    if (!this.spend(memberId, price)) return { ok: false, error: 'coins' };
    this.stat(memberId, 'spent', price);
    if (kind === 'food') { this.stock[item] = (this.stock[item] ?? 0) + 6; this.broadcast({ type: 'stock', stock: this.stock }); }
    if (kind === 'gift') {
      const song = this.playback.song; song.gifts[item] = (song.gifts[item] ?? 0) + 1;
      const share = Math.floor((price * EARN.giftShare) / song.singers.length);
      for (const id of song.singers) { this.reward(id, share, 'gift'); this.stat(id, 'gifts', 1); }
      this.#sendPlayback();
    }
    if (kind === 'host') this.staff.call(memberId, item);
    if (kind === 'dance') this.dancers.call(memberId);
    this.broadcast({ type: 'show', kind, item, by: m.name, id: memberId });
    return { ok: true };
  }

  toggleEffect(memberId, name) {
    if (!this.members.has(memberId) || !EFFECTS.includes(name)) return false;
    this.effects[name] = !this.effects[name];
    this.broadcast({ type: 'effects', effects: this.effects });
    return true;
  }

  sit(memberId, seatIndex) {
    const m = this.members.get(memberId);
    if (!m || !(seatIndex >= 0 && seatIndex < SEATS.length) || (this.seats[seatIndex] && this.seats[seatIndex] !== memberId)) return false;
    this.#freeSeat(memberId);
    this.seats[seatIndex] = memberId;
    const [x, z, ry] = SEATS[seatIndex];
    Object.assign(m, { x, z, ry, anim: 'sit', seat: seatIndex });
    this.broadcast({ type: 'peer.move', id: memberId, x, z, ry, anim: 'sit', seat: seatIndex });
    return true;
  }

  move(id, data) { this.#freeSeat(id); super.move(id, data); }

  // ---------- views ----------
  snapshot() {
    return { room: this.publicInfo(), hostId: this.hostId, queue: this.queue, playback: this.playback, now: this.clock(),
      peers: this.snapshotMembers(), stock: this.stock, effects: this.effects, prices: PRICES, earn: EARN };
  }

  publicInfo() {
    const humans = this.humans().length; // bots are not counted anywhere players can see
    return { ...this.def, count: humans, humans, nowPlaying: this.playback.song?.title ?? null,
      singer: this.playback.song?.ownerName ?? null, queue: this.queue.length,
      status: humans >= this.def.capacity ? 'full' : this.playback.song ? 'singing' : 'open' };
  }

  #freeSeat(id) { const i = this.seats.indexOf(id); if (i >= 0) this.seats[i] = null; const m = this.members.get(id); if (m) m.seat = null; }

  #elapsedSec() { const pb = this.playback; return Math.max(0, ((pb.pausedAt ?? this.clock()) - pb.startedAt) / 1000); }

  #next() {
    this.invites.clear(); this.requests.clear();
    const song = this.queue.shift() ?? null;
    this.playback = { song, startedAt: song ? this.clock() + START_DELAY_MS : null, pausedAt: null };
    this.#sendPlayback(); this.#sendQueue();
  }

  #sendPlayback() { this.broadcast({ type: 'playback', now: this.clock(), ...this.playback }); }
  #sendQueue() { this.broadcast({ type: 'queue', queue: this.queue }); }
}
