// Friends and blocks between players (stored on the profiles), plus consent requests for touchy interactions
// (high-five, hug): the other player has to accept. Pure logic; index.js does the sending and the proximity checks.
import crypto from 'node:crypto';

export const MAX_FRIENDS = 100;
export const ASK_MS = 20_000;
export const ASK_KINDS = ['highfive', 'hug'];       // need the other player's consent
export const FREE_KINDS = ['wave'];                 // just happen
export const FLOWER_PRICE = 50; export const FLOWER_SHARE = 25;
export const NEAR = 3.2;                            // how close you must stand for a high-five / hug

const list = (p, k) => (p[k] ??= []);

export class Social {
  constructor(profiles, { clock = Date.now } = {}) { this.profiles = profiles; this.clock = clock; this.asks = new Map(); this.lastAsk = new Map(); }
  #save() { this.profiles.dirty = true; }

  blocked(p, otherId) { return !!p?.blocked?.includes(otherId); }
  // either side blocked the other: no interaction at all
  apart(a, b) { return this.blocked(a, b?.id) || this.blocked(b, a?.id); }

  // ---- friends ----
  // ask to be friends; if they already asked me, we become friends right away
  addFriend(me, other) {
    if (!me || me.guest || !other || other.guest) return { ok: false, error: 'needAccount' };
    if (me.id === other.id) return { ok: false, error: 'unknown' };
    if (this.apart(me, other)) return { ok: false, error: 'blocked' };
    if (list(me, 'friends').includes(other.id)) return { ok: false, error: 'alreadyFriends' };
    if (list(me, 'friends').length >= MAX_FRIENDS || list(other, 'friends').length >= MAX_FRIENDS) return { ok: false, error: 'friendsFull' };
    if (list(me, 'friendReq').includes(other.id)) return this.accept(me, other.id);
    if (!list(other, 'friendReq').includes(me.id)) { other.friendReq.push(me.id); other.friendReq = other.friendReq.slice(-50); this.#save(); }
    return { ok: true, requested: true };
  }
  accept(me, otherId) {
    const other = this.profiles.get(otherId);
    if (!other || !list(me, 'friendReq').includes(otherId)) return { ok: false, error: 'noRequest' };
    me.friendReq = me.friendReq.filter((x) => x !== otherId);
    if (!list(me, 'friends').includes(otherId)) me.friends.push(otherId);
    if (!list(other, 'friends').includes(me.id)) other.friends.push(me.id);
    other.friendReq = list(other, 'friendReq').filter((x) => x !== me.id);
    this.#save(); return { ok: true, friends: true, other };
  }
  decline(me, otherId) { me.friendReq = list(me, 'friendReq').filter((x) => x !== otherId); this.#save(); return { ok: true }; }
  unfriend(me, otherId) {
    me.friends = list(me, 'friends').filter((x) => x !== otherId);
    const o = this.profiles.get(otherId); if (o) o.friends = list(o, 'friends').filter((x) => x !== me.id);
    this.#save(); return { ok: true, other: o };
  }
  setBlock(me, otherId, on) {
    if (!me || me.id === otherId || !this.profiles.get(otherId)) return { ok: false, error: 'unknown' };
    me.blocked = list(me, 'blocked').filter((x) => x !== otherId);
    if (on) { me.blocked.push(otherId); me.blocked = me.blocked.slice(-200); this.unfriend(me, otherId); this.decline(me, otherId); const o = this.profiles.get(otherId); if (o) o.friendReq = list(o, 'friendReq').filter((x) => x !== me.id); }
    this.#save(); return { ok: true };
  }
  relation(me, otherId) {
    return { friend: !!me?.friends?.includes(otherId), requested: !!this.profiles.get(otherId)?.friendReq?.includes(me?.id), theyAsked: !!me?.friendReq?.includes(otherId), blocked: this.blocked(me, otherId) };
  }

  // ---- consent requests (high-five, hug) ----
  ask(from, to, kind) {
    if (!ASK_KINDS.includes(kind)) return { ok: false, error: 'unknown' };
    if (this.apart(from, to)) return { ok: false, error: 'blocked' };
    const now = this.clock(); if (now - (this.lastAsk.get(from.id) ?? -Infinity) < 3000) return { ok: false, error: 'tooFast' };
    this.lastAsk.set(from.id, now);
    for (const [id, a] of this.asks) if (now - a.at > ASK_MS) this.asks.delete(id);
    const id = crypto.randomBytes(5).toString('hex');
    this.asks.set(id, { from: from.id, to: to.id, kind, at: now });
    return { ok: true, id };
  }
  // the asked player answers; returns the request if it is still valid and accepted
  answer(me, reqId, accept) {
    const a = this.asks.get(reqId); if (!a || a.to !== me.id) return null;
    this.asks.delete(reqId);
    if (!accept || this.clock() - a.at > ASK_MS) return { ...a, accepted: false };
    return { ...a, accepted: true };
  }
}
