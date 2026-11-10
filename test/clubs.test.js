import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Profiles } from '../server/profiles.js';
import { Clubs, CLUB_PRICE, CLUB_MAX, WEEK_PRIZES } from '../server/clubs.js';

function setup() {
  let now = Date.UTC(2026, 10, 4, 12); // a Wednesday
  const profiles = new Profiles(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clubs')), 'db.json'), { clock: () => now });
  const clubs = new Clubs(profiles, { clock: () => now });
  const user = (u, coins = 5000) => { const r = profiles.register({ username: u, password: 'secret12' }); r.profile.coins = coins; return r.profile; };
  return { profiles, clubs, user, advance: (ms) => { now += ms; } };
}

test('create: needs an account, coins, a valid unique name/tag; owner gets the tag', () => {
  const s = setup(); const a = s.user('alice'); const poor = s.user('poor', 10); const g = s.profiles.guest({});
  assert.equal(s.clubs.create(g, { name: 'Abc', tag: 'AB' }).error, 'needAccount');
  assert.equal(s.clubs.create(poor, { name: 'Abc', tag: 'AB' }).error, 'coins');
  assert.equal(s.clubs.create(a, { name: 'ab', tag: 'AB' }).error, 'clubName');
  assert.equal(s.clubs.create(a, { name: 'Abc', tag: '!' }).error, 'clubTag');
  const r = s.clubs.create(a, { name: 'Ca Sĩ Đêm', tag: 'csd', icon: '🌙', desc: '<b>hi</b>' });
  assert.equal(r.ok, true); assert.equal(r.club.tag, 'CSD'); assert.equal(r.club.desc, 'bhi/b');
  assert.equal(a.coins, 5000 - CLUB_PRICE); assert.equal(a.clubTag, 'CSD'); assert.equal(s.profiles.publicView(a).clubTag, 'CSD');
  assert.equal(s.clubs.create(a, { name: 'Other', tag: 'OT' }).error, 'inClub');
  const b = s.user('bob'); assert.equal(s.clubs.create(b, { name: 'ca sĩ đêm', tag: 'XY' }).error, 'clubTaken');
});

test('open clubs join directly; closed ones need the owner; kick, leave, ownership hand-over, last one closes', () => {
  const s = setup(); const a = s.user('alice'); const b = s.user('bob'); const c = s.user('carol');
  const club = s.clubs.create(a, { name: 'Club', tag: 'CL', open: false }).club;
  assert.equal(s.clubs.join(b, club.id).requested, true); assert.ok(!b.clubId);
  assert.equal(s.clubs.answer(b, b.id, true).error, 'notOwner');
  assert.equal(s.clubs.answer(a, b.id, true).joined, b); assert.equal(b.clubTag, 'CL');
  s.clubs.edit(a, { open: true }); assert.equal(s.clubs.join(c, club.id).ok, true); assert.equal(club.members.length, 3);
  assert.equal(s.clubs.kick(a, c.id).ok, true); assert.equal(c.clubId, null);
  assert.equal(s.clubs.leave(a).ok, true); assert.equal(club.ownerId, b.id); // hand-over
  assert.equal(s.clubs.leave(b).closed, true); assert.equal(s.clubs.get(club.id), null);
});

test('member cap', () => {
  const s = setup(); const club = s.clubs.create(s.user('owner'), { name: 'Big', tag: 'BG' }).club;
  for (let i = 1; i < CLUB_MAX; i++) assert.equal(s.clubs.join(s.user(`member${i}`), club.id).ok, true);
  assert.equal(s.clubs.join(s.user('late'), club.id).error, 'clubFull');
});

test('activity gives weekly points (through profiles.stat), ranking, and the weekly top-3 prize once', () => {
  const s = setup(); const a = s.user('alice'); const b = s.user('bob');
  const c1 = s.clubs.create(a, { name: 'One', tag: 'ONE' }).club; const c2 = s.clubs.create(b, { name: 'Two', tag: 'TWO' }).club;
  s.clubs.addPoints(a.id, 'songs', 3); s.clubs.addPoints(b.id, 'songs', 1); s.clubs.addPoints(b.id, 'spent', 500); s.clubs.addPoints(a.id, 'nonsense', 99);
  assert.deepEqual(s.clubs.ranking().map((r) => [r.tag, r.points]), [['ONE', 30], ['TWO', 15]]);
  assert.deepEqual(s.clubs.awardLastWeek(), []); // nothing last week
  const before = [a.coins, b.coins];
  s.advance(7 * 86400000); // next week: last week's top 3 are paid, once
  const paid = s.clubs.awardLastWeek();
  assert.deepEqual(paid.map((p) => [p.profile.username, p.coins, p.rank]), [['alice', WEEK_PRIZES[0], 1], ['bob', WEEK_PRIZES[1], 2]]);
  assert.deepEqual([a.coins - before[0], b.coins - before[1]], [WEEK_PRIZES[0], WEEK_PRIZES[1]]);
  assert.deepEqual(s.clubs.awardLastWeek(), []);
  assert.equal(s.clubs.points(c1), 0); assert.ok(c2);
});

test('chat keeps the last messages and is members-only; view hides requests from non-owners', () => {
  const s = setup(); const a = s.user('alice'); const b = s.user('bob'); const x = s.user('xavier');
  const club = s.clubs.create(a, { name: 'Chat', tag: 'CH' }).club; s.clubs.join(b, club.id);
  assert.equal(s.clubs.say(x, 'hi'), null); assert.equal(s.clubs.say(a, '   '), null);
  for (let i = 0; i < 70; i++) s.clubs.say(b, `m${i}`);
  assert.equal(club.chat.length, 60); assert.equal(club.chat.at(-1).text, 'm69');
  s.clubs.edit(a, { open: false }); s.clubs.join(x, club.id);
  assert.equal(s.clubs.view(club, a.id).requests.length, 1); assert.equal(s.clubs.view(club, b.id).requests.length, 0);
  assert.equal(s.clubs.view(club, b.id).chat.length, 40);
});
