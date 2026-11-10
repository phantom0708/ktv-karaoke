import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Profiles } from '../server/profiles.js';
import { Social, ASK_MS } from '../server/social.js';

function setup() {
  let now = Date.UTC(2026, 10, 6, 12);
  const profiles = new Profiles(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'social')), 'db.json'), { clock: () => now });
  const social = new Social(profiles, { clock: () => now });
  const user = (u) => profiles.register({ username: u, password: 'secret12' }).profile;
  return { profiles, social, user, advance: (ms) => { now += ms; } };
}

test('friends: request, then accept makes both friends; asking back accepts at once', () => {
  const { social, user } = setup(); const a = user('anna'); const b = user('binh'); const c = user('chi');
  assert.deepEqual(social.addFriend(a, b), { ok: true, requested: true });
  assert.ok(b.friendReq.includes(a.id));
  assert.equal(social.relation(a, b.id).requested, true); assert.equal(social.relation(b, a.id).theyAsked, true);
  assert.equal(social.accept(b, a.id).ok, true);
  assert.ok(a.friends.includes(b.id) && b.friends.includes(a.id)); assert.equal(b.friendReq.length, 0);
  assert.equal(social.addFriend(a, b).error, 'alreadyFriends');
  social.addFriend(c, a); assert.equal(social.addFriend(a, c).friends, true); // a asks back → friends
  social.unfriend(a, b.id); assert.ok(!a.friends.includes(b.id) && !b.friends.includes(a.id));
});

test('friends: guests cannot, and you cannot friend yourself', () => {
  const { social, user, profiles } = setup(); const a = user('anna'); const g = profiles.guest?.({ name: 'G' })?.profile ?? { id: 'g1', guest: true };
  assert.equal(social.addFriend(a, g).error, 'needAccount'); assert.equal(social.addFriend(a, a).error, 'unknown');
});

test('block: removes friendship and requests, blocks interaction both ways; unblock restores', () => {
  const { social, user } = setup(); const a = user('anna'); const b = user('binh');
  social.addFriend(a, b); social.accept(b, a.id);
  assert.equal(social.setBlock(a, b.id, true).ok, true);
  assert.ok(!a.friends.includes(b.id) && !b.friends.includes(a.id));
  assert.equal(social.apart(a, b), true); assert.equal(social.apart(b, a), true);
  assert.equal(social.addFriend(b, a).error, 'blocked'); assert.equal(social.ask(b, a, 'hug').error, 'blocked');
  social.setBlock(a, b.id, false); assert.equal(social.apart(a, b), false);
});

test('ask/answer: only the asked player answers, once, before it expires; rate limited', () => {
  const { social, user, advance } = setup(); const a = user('anna'); const b = user('binh'); const c = user('chi');
  assert.equal(social.ask(a, b, 'kiss').ok, false);
  const r = social.ask(a, b, 'highfive'); assert.ok(r.ok);
  assert.equal(social.ask(a, b, 'hug').error, 'tooFast');
  assert.equal(social.answer(c, r.id, true), null);
  assert.equal(social.answer(b, r.id, true).accepted, true);
  assert.equal(social.answer(b, r.id, true), null); // used up
  advance(4000); const r2 = social.ask(a, b, 'hug'); advance(ASK_MS + 1);
  assert.equal(social.answer(b, r2.id, true).accepted, false); // too late
});
