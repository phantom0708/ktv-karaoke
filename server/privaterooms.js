// Private rooms: an account asks for a room (name, up to 40 people), an admin approves or rejects it,
// then the owner shares an entry code. Stored inside the profiles db (db.privateRooms), pure logic, no I/O.
import crypto from 'node:crypto';

export const MAX_PRIVATE_CAPACITY = 40;
export const MIN_PRIVATE_CAPACITY = 2;
export const MAX_ROOMS_PER_OWNER = 2;
const COLORS = ['#a78bfa', '#f472b6', '#22d3ee', '#fbbf24', '#34d399', '#fb7185', '#60a5fa'];
const clean = (s, n) => String(s ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);
const code = () => Array.from(crypto.randomBytes(6), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(''); // no 0/O/1/I

export class PrivateRooms {
  constructor(profiles, { clock = Date.now } = {}) {
    this.profiles = profiles; this.clock = clock;
    this.data = (profiles.db.privateRooms ??= { requests: [], rooms: [] });
  }

  #save() { this.profiles.dirty = true; }
  #roomOf(id) { return this.data.rooms.find((r) => r.id === id) || null; }

  // the room definition a Room is built from — never contains the entry code
  def(r) { return { id: r.id, name: r.name, capacity: r.capacity, color: r.color, blurb: r.blurb, genre: 'private', private: true, ownerId: r.ownerId, ownerName: r.ownerName }; }
  defs() { return this.data.rooms.map((r) => this.def(r)); }

  request(profile, { name, capacity, blurb }) {
    if (!profile || profile.guest) return { ok: false, error: 'needAccount' };
    const n = clean(name, 30); const cap = Math.trunc(Number(capacity));
    if (n.length < 3) return { ok: false, error: 'roomName' };
    if (!(cap >= MIN_PRIVATE_CAPACITY && cap <= MAX_PRIVATE_CAPACITY)) return { ok: false, error: 'roomCapacity' };
    if (this.data.requests.some((q) => q.ownerId === profile.id && q.status === 'pending')) return { ok: false, error: 'requestPending' };
    if (this.data.rooms.filter((r) => r.ownerId === profile.id).length >= MAX_ROOMS_PER_OWNER) return { ok: false, error: 'tooManyRooms' };
    const q = { id: crypto.randomBytes(5).toString('hex'), ownerId: profile.id, ownerName: profile.name, username: profile.username,
      name: n, capacity: cap, blurb: clean(blurb, 60), at: this.clock(), status: 'pending' };
    this.data.requests.push(q); this.data.requests = this.data.requests.slice(-200); this.#save();
    return { ok: true, request: q };
  }

  pending() { return this.data.requests.filter((q) => q.status === 'pending'); }

  review(requestId, approve, admin, note = '') {
    const q = this.data.requests.find((x) => x.id === requestId);
    if (!q || q.status !== 'pending') return { ok: false, error: 'noRequest' };
    Object.assign(q, { status: approve ? 'approved' : 'rejected', by: admin?.name ?? 'admin', note: clean(note, 120), reviewedAt: this.clock() });
    let room = null;
    if (approve) {
      room = { id: `p-${crypto.randomBytes(4).toString('hex')}`, ownerId: q.ownerId, ownerName: q.ownerName, name: q.name, capacity: q.capacity,
        blurb: q.blurb || 'Phòng riêng', color: COLORS[this.data.rooms.length % COLORS.length], code: code(), at: this.clock() };
      this.data.rooms.push(room); q.roomId = room.id;
    }
    this.#save();
    return { ok: true, request: q, room };
  }

  canManage(roomId, profile) { const r = this.#roomOf(roomId); return !!r && !!profile && (r.ownerId === profile.id || !!profile.admin); }

  canEnter(roomId, profile, entryCode) {
    const r = this.#roomOf(roomId); if (!r) return true; // not a private room
    if (this.canManage(roomId, profile)) return true;
    return !!entryCode && String(entryCode).trim().toUpperCase() === r.code;
  }

  newCode(roomId, profile) {
    if (!this.canManage(roomId, profile)) return { ok: false, error: 'notOwner' };
    const r = this.#roomOf(roomId); r.code = code(); this.#save(); return { ok: true, code: r.code };
  }

  remove(roomId, profile) {
    if (!this.canManage(roomId, profile)) return { ok: false, error: 'notOwner' };
    this.data.rooms = this.data.rooms.filter((r) => r.id !== roomId); this.#save(); return { ok: true };
  }

  // what a player sees about their own requests / rooms (owner gets the codes)
  mine(profileId) {
    const last = [...this.data.requests].reverse().find((q) => q.ownerId === profileId) ?? null;
    return { request: last && { id: last.id, name: last.name, capacity: last.capacity, status: last.status, note: last.note ?? '' },
      rooms: this.data.rooms.filter((r) => r.ownerId === profileId).map((r) => ({ id: r.id, name: r.name, capacity: r.capacity, code: r.code })) };
  }

  // admin overview
  adminView() {
    return { pending: this.pending(), rooms: this.data.rooms.map((r) => ({ id: r.id, name: r.name, capacity: r.capacity, ownerName: r.ownerName, code: r.code })) };
  }
}
