// Accounts (username + scrypt password), guest sessions, character look, coins,
// shop & wardrobe, daily check-in streak and weekly leaderboard. Persisted as one JSON file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const START_COINS = 100;
export const CHECKIN_REWARDS = [50, 70, 90, 110, 140, 170, 200];
export const SLOTS = ['outfit', 'head', 'face', 'back', 'tag', 'aura', 'pet', 'mic', 'entrance'];

export const SHOP = [
  { id: 'tag-peach', slot: 'tag', price: 60 }, { id: 'tag-mint', slot: 'tag', price: 60 },
  { id: 'tag-sky', slot: 'tag', price: 90 }, { id: 'tag-neon', slot: 'tag', price: 300 },
  { id: 'tag-gold', slot: 'tag', price: 3000 }, { id: 'tag-prism', slot: 'tag', price: 8000 },
  { id: 'head-beanie', slot: 'head', price: 120 }, { id: 'head-cap', slot: 'head', price: 180 },
  { id: 'head-flower', slot: 'head', price: 300 }, { id: 'head-headset', slot: 'head', price: 600 },
  { id: 'head-fox', slot: 'head', price: 900 }, { id: 'head-witch', slot: 'head', price: 1800 },
  { id: 'head-tiara', slot: 'head', price: 4000 }, { id: 'head-star', slot: 'head', price: 6000 },
  { id: 'back-guitar', slot: 'back', price: 500 }, { id: 'back-bag', slot: 'back', price: 400 },
  { id: 'back-wings', slot: 'back', price: 9000 }, { id: 'back-jetpack', slot: 'back', price: 14000 },
  { id: 'aura-notes', slot: 'aura', price: 800 }, { id: 'aura-petals', slot: 'aura', price: 1500 },
  { id: 'aura-sparks', slot: 'aura', price: 4000 }, { id: 'aura-galaxy', slot: 'aura', price: 20000 },
  { id: 'pet-duck', slot: 'pet', price: 1500 }, { id: 'pet-cat', slot: 'pet', price: 6000 },
  { id: 'pet-robot', slot: 'pet', price: 15000 }, { id: 'pet-dragon', slot: 'pet', price: 40000 },
  { id: 'mic-rose', slot: 'mic', price: 250 }, { id: 'mic-gold', slot: 'mic', price: 3500 },
  { id: 'mic-crystal', slot: 'mic', price: 15000 },
  { id: 'entrance-confetti', slot: 'entrance', price: 300 }, { id: 'entrance-smoke', slot: 'entrance', price: 900 },
  { id: 'entrance-spotlight', slot: 'entrance', price: 2500 }, { id: 'entrance-rainbow', slot: 'entrance', price: 12000 },
  { id: 'entrance-meteor', slot: 'entrance', price: 35000 },
  // full outfits (replace the top + bottom while equipped)
  { id: 'outfit-sport', slot: 'outfit', price: 1200 }, { id: 'outfit-suit', slot: 'outfit', price: 3000 },
  { id: 'outfit-aodai', slot: 'outfit', price: 5000 }, { id: 'outfit-idol', slot: 'outfit', price: 8000 },
  { id: 'outfit-gown', slot: 'outfit', price: 10000 },
  // more head / face / back items
  { id: 'head-bow', slot: 'head', price: 350 }, { id: 'head-bunny', slot: 'head', price: 700 },
  { id: 'head-cowboy', slot: 'head', price: 1200 }, { id: 'head-crown', slot: 'head', price: 12000 },
  { id: 'head-halo', slot: 'head', price: 15000 },
  { id: 'face-heart', slot: 'face', price: 600 }, { id: 'face-starglass', slot: 'face', price: 900 },
  { id: 'face-mask', slot: 'face', price: 1500 },
  { id: 'back-balloons', slot: 'back', price: 800 }, { id: 'back-cape', slot: 'back', price: 2500 },
  { id: 'back-devil', slot: 'back', price: 9000 },
];
const SHOP_BY_ID = new Map(SHOP.map((i) => [i.id, i]));

// character look: integers pick a style, strings are hex colours
const LOOK_SPEC = {
  gender: [0, 2, 2], // 0 male, 1 female, 2 = guess from hair/clothes (characters saved before genders existed)
  build: [0, 2, 1], skin: '#f2c9a1', eyes: [0, 4, 0], mouth: [0, 3, 0], blush: [0, 1, 1], brows: [0, 2, 0],
  hair: [0, 9, 0], hairColor: '#3b2416', top: [0, 6, 0], topColor: '#f97316', bottom: [0, 4, 0], bottomColor: '#1e3a8a',
  shoes: '#f8fafc', acc: [0, 6, 0], accColor: '#111827',
};
export function cleanLook(look = {}) {
  const out = {};
  for (const [k, spec] of Object.entries(LOOK_SPEC)) {
    const v = look[k];
    if (typeof spec === 'string') out[k] = /^#[0-9a-f]{6}$/i.test(v ?? '') ? v.toLowerCase() : spec;
    else out[k] = Number.isInteger(v) && v >= spec[0] && v <= spec[1] ? v : spec[2];
  }
  return out;
}
export const DEFAULT_LOOK = cleanLook();

const cleanName = (s) => String(s ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 24);
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekKey = (ms) => { const d = new Date(ms); const dow = (d.getUTCDay() + 6) % 7; return dayKey(ms - dow * 86400000); };
const token = () => crypto.randomBytes(18).toString('base64url');
const hashPw = (pw, salt = crypto.randomBytes(12).toString('hex')) => `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
const checkPw = (pw, stored) => { const [salt, h] = stored.split(':'); const a = Buffer.from(h, 'hex'); const b = crypto.scryptSync(pw, salt, 32); return a.length === b.length && crypto.timingSafeEqual(a, b); };

export class Profiles {
  constructor(file, { clock = Date.now } = {}) {
    this.file = file; this.clock = clock; this.dirty = false;
    this.db = { profiles: [], stats: {} };
    if (fs.existsSync(file)) { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(d.profiles)) this.db = d; } catch {} }
    this.#index();
  }

  #index() {
    this.ids = new Map(this.db.profiles.map((p) => [p.id, p]));
    this.tokens = new Map(); for (const p of this.db.profiles) for (const t of p.tokens) this.tokens.set(t, p);
    this.users = new Map(this.db.profiles.filter((p) => p.username).map((p) => [p.username.toLowerCase(), p]));
  }

  #create(fields) {
    const p = { id: crypto.randomBytes(6).toString('hex'), tokens: [], username: null, pw: null, guest: true,
      name: 'Khách', look: { ...DEFAULT_LOOK }, coins: 0, owned: [], equipped: [], checkin: { last: null, streak: 0 }, ...fields };
    this.db.profiles.push(p); this.ids.set(p.id, p); this.dirty = true;
    return p;
  }

  #session(p) { const t = token(); p.tokens = [...p.tokens.slice(-4), t]; this.tokens.set(t, p); this.dirty = true; return t; }

  byToken(t) { return (t && this.tokens.get(t)) || null; }
  get(id) { return this.ids.get(id) || null; }

  guest({ name, look } = {}) {
    const p = this.#create({ name: cleanName(name) || 'Khách', look: cleanLook(look) });
    p.token = this.#session(p);
    return p;
  }

  update(id, { name, look }) {
    const p = this.ids.get(id); if (!p) return null;
    if (cleanName(name)) p.name = cleanName(name);
    if (look) p.look = cleanLook(look);
    this.dirty = true; return p;
  }

  register({ username, password, name, look, fromToken }) {
    const u = String(username ?? '').trim();
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(u)) return { ok: false, error: 'badUsername' };
    if (String(password ?? '').length < 6) return { ok: false, error: 'badPassword' };
    if (this.users.has(u.toLowerCase())) return { ok: false, error: 'taken' };
    let p = this.byToken(fromToken);
    if (!p || !p.guest) p = this.#create({});
    Object.assign(p, { username: u, pw: hashPw(String(password)), guest: false, coins: p.coins || START_COINS });
    if (cleanName(name)) p.name = cleanName(name); else if (p.name === 'Khách') p.name = u;
    if (look) p.look = cleanLook(look);
    this.users.set(u.toLowerCase(), p); this.dirty = true;
    return { ok: true, profile: p, token: this.#session(p) };
  }

  login({ username, password }) {
    const p = this.users.get(String(username ?? '').trim().toLowerCase());
    if (!p || !checkPw(String(password ?? ''), p.pw)) return { ok: false, error: 'badLogin' };
    return { ok: true, profile: p, token: this.#session(p) };
  }

  logout(t) { const p = this.byToken(t); if (p) { p.tokens = p.tokens.filter((x) => x !== t); this.tokens.delete(t); this.dirty = true; } }

  addCoins(id, amount) {
    const p = this.ids.get(id); if (!p || p.guest || !Number.isFinite(amount)) return null;
    p.coins = Math.max(0, p.coins + amount); this.dirty = true; return p.coins;
  }

  // admin tools: give/take coins and grant admin rights by username
  byUsername(username) { return this.users.get(String(username ?? '').trim().toLowerCase()) || null; }
  grant(username, amount) {
    const p = this.byUsername(username); const n = Math.trunc(Number(amount));
    if (!p || !Number.isFinite(n)) return { ok: false, error: 'unknownUser' };
    p.coins = Math.max(0, p.coins + n); this.dirty = true;
    return { ok: true, coins: p.coins, profile: p };
  }
  setAdmin(username, on) {
    const p = this.byUsername(username); if (!p) return { ok: false, error: 'unknownUser' };
    p.admin = !!on; this.dirty = true; return { ok: true, profile: p };
  }

  spend(id, amount) {
    const p = this.ids.get(id); if (!p || p.guest || !Number.isFinite(amount) || amount < 0 || !(p.coins >= amount)) return false;
    p.coins -= amount; this.dirty = true; return true;
  }

  buy(id, itemId) {
    const p = this.ids.get(id); const item = SHOP_BY_ID.get(itemId);
    if (!p || p.guest) return { ok: false, error: 'needAccount' };
    if (!item) return { ok: false, error: 'unknown' };
    if (p.owned.includes(itemId)) return { ok: false, error: 'owned' };
    if (!this.spend(id, item.price)) return { ok: false, error: 'coins' };
    p.owned.push(itemId); this.stat(id, 'spent', item.price);
    this.equip(id, itemId, true);
    return { ok: true };
  }

  equip(id, itemId, on) {
    const p = this.ids.get(id); const item = SHOP_BY_ID.get(itemId);
    if (!p || !item || !p.owned.includes(itemId)) return { ok: false, error: 'notOwned' };
    p.equipped = p.equipped.filter((e) => e !== itemId && (!on || SHOP_BY_ID.get(e)?.slot !== item.slot));
    if (on) p.equipped.push(itemId);
    this.dirty = true; return { ok: true };
  }

  checkinState(p) {
    const today = dayKey(this.clock()); const yesterday = dayKey(this.clock() - 86400000);
    const claimedToday = p.checkin.last === today;
    const streak = claimedToday || p.checkin.last === yesterday ? p.checkin.streak : 0;
    return { claimedToday, streak, nextReward: CHECKIN_REWARDS[streak % 7], rewards: CHECKIN_REWARDS };
  }

  checkin(id) {
    const p = this.ids.get(id); if (!p || p.guest) return { ok: false, error: 'needAccount' };
    const st = this.checkinState(p);
    if (st.claimedToday) return { ok: false, error: 'claimed' };
    const reward = st.nextReward;
    p.checkin = { last: dayKey(this.clock()), streak: st.streak + 1 };
    p.coins += reward; this.dirty = true;
    return { ok: true, reward, ...this.checkinState(p) };
  }

  stat(id, key, amount) {
    const p = this.ids.get(id); if (!p || p.guest) return;
    const w = weekKey(this.clock()); const week = (this.db.stats[w] ??= {}); const row = (week[id] ??= { songs: 0, gifts: 0, spent: 0 });
    row[key] = (row[key] ?? 0) + amount; this.dirty = true;
  }

  leaderboard() {
    const w = weekKey(this.clock()); const week = this.db.stats[w] ?? {};
    const top = (key) => Object.entries(week).filter(([, r]) => r[key] > 0)
      .map(([id, r]) => ({ id, name: this.ids.get(id)?.name ?? '?', look: this.ids.get(id)?.look, value: r[key] }))
      .sort((a, b) => b.value - a.value).slice(0, 10);
    return { weekStart: w, songs: top('songs'), gifts: top('gifts'), spent: top('spent') };
  }

  // this week's numbers for one player (player card)
  leaderboardRow(id) { return this.db.stats[weekKey(this.clock())]?.[id] ?? null; }

  publicView(p) { return { id: p.id, name: p.name, look: p.look, equipped: p.equipped, guest: p.guest, clubTag: p.clubTag ?? null }; }
  privateView(p) { return { ...this.publicView(p), username: p.username, coins: p.guest ? 0 : p.coins, owned: p.owned, checkin: this.checkinState(p), isAdmin: !!p.admin }; }

  flush() {
    if (!this.dirty) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.db)); fs.renameSync(tmp, this.file);
    this.dirty = false;
  }
}
