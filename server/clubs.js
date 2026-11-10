// Clubs ("câu lạc bộ"): a lasting group of players with a short tag on their name tag, a club chat that reaches
// members wherever they are, weekly club points earned by members' activity, and a weekly top-3 reward.
// Stored inside the profiles db (db.clubs); pure logic, no I/O — index.js does the sending.
import crypto from 'node:crypto';

export const CLUB_PRICE = 1000;
export const CLUB_MAX = 30;
export const CLUB_ICONS = ['🎤', '🎸', '🎹', '🥁', '🎧', '🎶', '🌟', '🔥', '💎', '👑', '🌙', '🌸', '🦋', '🐉', '🦊', '🍻'];
export const POINTS = { songs: 10, gifts: 5, checkin: 5, spent: 0.01 }; // per song sung, gift received, daily check-in, coin spent
export const WEEK_PRIZES = [500, 300, 150]; // coins for every member of the top 3 clubs each week
const CHAT_KEEP = 60;
const clean = (s, n) => String(s ?? '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
export const weekKey = (ms) => { const d = new Date(ms); const dow = (d.getUTCDay() + 6) % 7; return new Date(ms - dow * 86400000).toISOString().slice(0, 10); };

export class Clubs {
  constructor(profiles, { clock = Date.now } = {}) {
    this.profiles = profiles; this.clock = clock;
    this.data = (profiles.db.clubs ??= { list: [], awarded: null });
  }

  #save() { this.profiles.dirty = true; }
  get(id) { return this.data.list.find((c) => c.id === id) || null; }
  of(profile) { return profile?.clubId ? this.get(profile.clubId) : null; }
  #setMember(p, club) { p.clubId = club?.id ?? null; p.clubTag = club?.tag ?? null; this.#save(); }
  #week() { return weekKey(this.clock()); }
  points(club, week = this.#week()) { return Math.floor(club.points?.[week] ?? 0); }

  create(profile, { name, tag, icon, desc, open = true }) {
    if (!profile || profile.guest) return { ok: false, error: 'needAccount' };
    if (this.of(profile)) return { ok: false, error: 'inClub' };
    const n = clean(name, 24); const t = clean(tag, 4).toUpperCase().replace(/[^A-Z0-9À-Ỹ]/gi, '');
    if (n.length < 3) return { ok: false, error: 'clubName' };
    if (t.length < 2) return { ok: false, error: 'clubTag' };
    if (this.data.list.some((c) => c.name.toLowerCase() === n.toLowerCase() || c.tag === t)) return { ok: false, error: 'clubTaken' };
    if (!this.profiles.spend(profile.id, CLUB_PRICE)) return { ok: false, error: 'coins' };
    const club = { id: crypto.randomBytes(5).toString('hex'), name: n, tag: t, icon: CLUB_ICONS.includes(icon) ? icon : CLUB_ICONS[0],
      desc: clean(desc, 120), open: !!open, ownerId: profile.id, members: [profile.id], requests: [], chat: [], points: {}, at: this.clock() };
    this.data.list.push(club); this.#setMember(profile, club);
    return { ok: true, club };
  }

  // open club: join straight away; otherwise leave a request for the owner
  join(profile, clubId) {
    if (!profile || profile.guest) return { ok: false, error: 'needAccount' };
    if (this.of(profile)) return { ok: false, error: 'inClub' };
    const club = this.get(clubId); if (!club) return { ok: false, error: 'noClub' };
    if (club.members.length >= CLUB_MAX) return { ok: false, error: 'clubFull' };
    if (!club.open) {
      if (!club.requests.includes(profile.id)) { club.requests.push(profile.id); club.requests = club.requests.slice(-30); this.#save(); }
      return { ok: true, requested: true, club };
    }
    club.members.push(profile.id); club.requests = club.requests.filter((x) => x !== profile.id); this.#setMember(profile, club);
    return { ok: true, club };
  }

  cancelRequest(profile, clubId) { const c = this.get(clubId); if (c) { c.requests = c.requests.filter((x) => x !== profile.id); this.#save(); } return { ok: true }; }

  // owner decides on a request
  answer(owner, userId, accept) {
    const club = this.of(owner); if (!club || club.ownerId !== owner.id) return { ok: false, error: 'notOwner' };
    if (!club.requests.includes(userId)) return { ok: false, error: 'noRequest' };
    club.requests = club.requests.filter((x) => x !== userId); this.#save();
    const p = this.profiles.get(userId); if (!accept || !p) return { ok: true, club };
    if (this.of(p)) return { ok: false, error: 'inClub' };
    if (club.members.length >= CLUB_MAX) return { ok: false, error: 'clubFull' };
    club.members.push(userId); this.#setMember(p, club);
    return { ok: true, club, joined: p };
  }

  // leave (the owner leaving hands the club to the longest-standing member; the last one out closes it)
  leave(profile) {
    const club = this.of(profile); if (!club) return { ok: false, error: 'noClub' };
    club.members = club.members.filter((x) => x !== profile.id); this.#setMember(profile, null);
    if (!club.members.length) { this.data.list = this.data.list.filter((c) => c !== club); return { ok: true, closed: true, club }; }
    if (club.ownerId === profile.id) club.ownerId = club.members[0];
    return { ok: true, club };
  }

  kick(owner, userId) {
    const club = this.of(owner); if (!club || club.ownerId !== owner.id) return { ok: false, error: 'notOwner' };
    if (userId === owner.id || !club.members.includes(userId)) return { ok: false, error: 'unknown' };
    club.members = club.members.filter((x) => x !== userId); const p = this.profiles.get(userId); if (p) this.#setMember(p, null);
    return { ok: true, club, kicked: p };
  }

  edit(owner, { desc, open, icon }) {
    const club = this.of(owner); if (!club || club.ownerId !== owner.id) return { ok: false, error: 'notOwner' };
    if (desc != null) club.desc = clean(desc, 120);
    if (open != null) club.open = !!open;
    if (CLUB_ICONS.includes(icon)) club.icon = icon;
    this.#save(); return { ok: true, club };
  }

  say(profile, text) {
    const club = this.of(profile); const tx = clean(text, 200);
    if (!club || !tx) return null;
    const msg = { id: profile.id, name: profile.name, text: tx, at: this.clock() };
    club.chat.push(msg); club.chat = club.chat.slice(-CHAT_KEEP); this.#save();
    return { club, msg };
  }

  // activity → club points for the current week
  addPoints(profileId, key, amount = 1) {
    const p = this.profiles.get(profileId); const club = this.of(p); if (!club || !POINTS[key] || !(amount > 0)) return;
    const w = this.#week(); club.points[w] = (club.points[w] ?? 0) + POINTS[key] * amount;
    for (const k of Object.keys(club.points)) if (k < weekKey(this.clock() - 35 * 86400000)) delete club.points[k]; // keep ~5 weeks
    this.#save();
  }

  ranking(week = this.#week()) {
    return this.data.list.map((c) => ({ id: c.id, name: c.name, tag: c.tag, icon: c.icon, members: c.members.length, open: c.open, desc: c.desc, points: this.points(c, week) }))
      .sort((a, b) => b.points - a.points || b.members - a.members);
  }

  // once per week: the top 3 clubs of the week that just ended get a prize for every member. Returns [{ profile, coins, club }]
  awardLastWeek() {
    const last = weekKey(this.clock() - 7 * 86400000);
    if (this.data.awarded === last) return [];
    this.data.awarded = last; this.#save();
    const out = [];
    this.ranking(last).filter((c) => c.points > 0).slice(0, WEEK_PRIZES.length).forEach((r, i) => {
      const club = this.get(r.id);
      for (const id of club.members) { const p = this.profiles.get(id); if (p && this.profiles.addCoins(id, WEEK_PRIZES[i]) != null) out.push({ profile: p, coins: WEEK_PRIZES[i], club, rank: i + 1 }); }
    });
    return out;
  }

  // what a member sees about their club (online/where filled in by index.js)
  view(club, viewerId) {
    const rank = this.ranking().findIndex((c) => c.id === club.id) + 1;
    const owner = club.ownerId === viewerId;
    return {
      id: club.id, name: club.name, tag: club.tag, icon: club.icon, desc: club.desc, open: club.open, ownerId: club.ownerId, owner,
      points: this.points(club), rank, max: CLUB_MAX,
      members: club.members.map((id) => { const p = this.profiles.get(id); return { id, name: p?.name ?? '?', look: p?.look }; }),
      requests: owner ? club.requests.map((id) => ({ id, name: this.profiles.get(id)?.name ?? '?' })) : [],
      chat: club.chat.slice(-40),
    };
  }
}
