import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Profiles } from '../server/profiles.js';
import { Quests, DAILY, DAILY_BONUS, INVITE_REWARD, INVITE_CAP, NEWBIE_BONUS } from '../server/quests.js';

function setup(start = Date.UTC(2026, 10, 4, 10)) { // Wed 17:00 in Vietnam
  let now = start;
  const profiles = new Profiles(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'quests')), 'db.json'), { clock: () => now });
  const quests = new Quests(profiles, { clock: () => now });
  const user = (u) => profiles.register({ username: u, password: 'secret12' }).profile;
  return { profiles, quests, user, advance: (ms) => { now += ms; }, set: (ms) => { now = ms; } };
}
const row = (s, id) => [...s.daily, ...s.weekly].find((x) => x.id === id);

test('track → done once, claim pays once, unfinished cannot be claimed', () => {
  const { quests, user } = setup(); const p = user('anna');
  assert.equal(quests.claim(p, 'sing1').error, 'questNotDone');
  assert.deepEqual(quests.track(p, 'sing', 1), ['sing1']);
  assert.deepEqual(quests.track(p, 'sing', 2), ['sing3']);
  assert.deepEqual(quests.track(p, 'sing', 1), []);
  assert.equal(quests.ready(p), 2);
  assert.deepEqual(quests.claim(p, 'sing1'), { ok: true, coins: 50, done: [] });
  assert.equal(quests.claim(p, 'sing1').error, 'questClaimed');
  assert.equal(row(quests.state(p), 'wsing20').progress, 4);
});

test('guests get nothing', () => {
  const { quests, profiles } = setup(); const g = profiles.guest();
  assert.deepEqual(quests.track(g, 'sing', 5), []); assert.equal(quests.claim(g, 'sing1').error, 'needAccount'); assert.equal(quests.ready(g), 0);
});

test('daily quests reset at midnight Vietnam time, weekly ones on Monday', () => {
  const { quests, user, set } = setup(Date.UTC(2026, 10, 4, 16, 30)); const p = user('anna'); // 23:30 VN
  quests.track(p, 'sing', 1); quests.claim(p, 'sing1');
  set(Date.UTC(2026, 10, 4, 17, 1)); // 00:01 VN next day
  const s = quests.state(p); assert.equal(row(s, 'sing1').progress, 0); assert.equal(row(s, 'sing1').claimed, false);
  assert.equal(row(s, 'wsing20').progress, 1);
  assert.ok(s.resetIn > 23 * 3600_000 && s.resetIn <= 24 * 3600_000);
  set(Date.UTC(2026, 10, 8, 17, 1)); // Monday 00:01 VN
  assert.equal(row(quests.state(p), 'wsing20').progress, 0);
});

test('daily chest after claiming every daily quest, counts toward the weekly chest quest', () => {
  const { quests, user } = setup(); const p = user('anna');
  assert.equal(quests.claim(p, 'bonus').error, 'questNotDone');
  for (const q of DAILY) quests.track(p, q.ev, q.goal);
  for (const q of DAILY) assert.ok(quests.claim(p, q.id).ok);
  const r = quests.claim(p, 'bonus'); assert.equal(r.coins, DAILY_BONUS);
  assert.equal(quests.claim(p, 'bonus').error, 'questClaimed');
  assert.equal(row(quests.state(p), 'wdays5').progress, 1);
});

test('invites: newcomer bonus once; inviter paid at first song, capped per week; no self-invite', () => {
  const { quests, user } = setup(); const a = user('anna'); const coins0 = a.coins;
  assert.equal(quests.joined(a, a.id), 0);
  const b = user('binh'); const b0 = b.coins;
  assert.equal(quests.joined(b, a.id), NEWBIE_BONUS); assert.equal(b.coins, b0 + NEWBIE_BONUS);
  assert.equal(quests.joined(b, a.id), 0); // only once
  const r = quests.firstSong(b); assert.equal(r.inviter, a); assert.equal(a.coins, coins0 + INVITE_REWARD); assert.deepEqual(r.done, ['winvite1']);
  assert.equal(quests.firstSong(b), null); // only the first song
  for (let i = 1; i < INVITE_CAP + 3; i++) { const n = user(`new${i}`); quests.joined(n, a.id); quests.firstSong(n); }
  assert.equal(quests.state(a).invite.week, INVITE_CAP); assert.equal(a.coins, coins0 + INVITE_REWARD * INVITE_CAP);
});
