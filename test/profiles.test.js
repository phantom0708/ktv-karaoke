import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Profiles, SHOP, CHECKIN_REWARDS } from '../server/profiles.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vibemic-')), 'db.json');
const DAY = 24 * 3600 * 1000;

test('guest sessions get a token and a cleaned name, and are flagged guest', () => {
  const p = new Profiles(tmp());
  const g = p.guest({ name: '  <i>Linh</i>  ' });
  assert.ok(g.token.length >= 20);
  assert.equal(g.name, 'iLinh/i');
  assert.equal(g.guest, true);
});

test('register then login with the right password; wrong password fails', () => {
  const p = new Profiles(tmp());
  const r = p.register({ username: 'Linh_01', password: 'secret12', name: 'Linh' });
  assert.equal(r.ok, true);
  assert.equal(r.profile.guest, false);
  assert.equal(p.register({ username: 'linh_01', password: 'another1' }).ok, false); // case-insensitive unique
  assert.equal(p.login({ username: 'LINH_01', password: 'wrong' }).ok, false);
  const l = p.login({ username: 'linh_01', password: 'secret12' });
  assert.equal(l.ok, true);
  assert.equal(l.profile.id, r.profile.id);
});

test('register validates username and password', () => {
  const p = new Profiles(tmp());
  assert.equal(p.register({ username: 'a', password: 'secret12' }).ok, false);
  assert.equal(p.register({ username: 'okname', password: '123' }).ok, false);
});

test('a guest can be upgraded to an account keeping their look', () => {
  const p = new Profiles(tmp());
  const g = p.guest({ name: 'G', look: { hair: 3 } });
  const r = p.register({ username: 'upgrade', password: 'secret12', fromToken: g.token });
  assert.equal(r.profile.id, g.id);
  assert.equal(r.profile.look.hair, 3);
  assert.equal(r.profile.guest, false);
});

test('look is sanitized into allowed ranges', () => {
  const p = new Profiles(tmp());
  const g = p.guest({ name: 'G', look: { build: 9, skin: 'red', hair: 2, eyes: -1, top: 1, topColor: '#123456' } });
  assert.equal(g.look.build, 1);
  assert.match(g.look.skin, /^#[0-9a-f]{6}$/i);
  assert.equal(g.look.hair, 2);
  assert.equal(g.look.eyes, 0);
  assert.equal(g.look.topColor, '#123456');
});

test('buy/equip: accounts only, coins, one item per slot', () => {
  const p = new Profiles(tmp());
  const guest = p.guest({ name: 'G' });
  assert.equal(p.buy(guest.id, SHOP[0].id).ok, false);
  const { profile: a } = p.register({ username: 'buyer', password: 'secret12' });
  a.coins = 10_000;
  const heads = SHOP.filter((i) => i.slot === 'head').slice(0, 2);
  assert.equal(p.equip(a.id, heads[0].id, true).ok, false);
  p.buy(a.id, heads[0].id); p.buy(a.id, heads[1].id);
  assert.equal(p.buy(a.id, heads[0].id).ok, false);
  p.equip(a.id, heads[0].id, true); p.equip(a.id, heads[1].id, true);
  assert.deepEqual(a.equipped, [heads[1].id]);
  assert.equal(a.coins, 10_000 - heads[0].price - heads[1].price);
});

test('check-in streak grows on consecutive days and resets after a gap', () => {
  let now = Date.UTC(2026, 10, 2, 9);
  const p = new Profiles(tmp(), { clock: () => now });
  const { profile: a } = p.register({ username: 'daily', password: 'secret12' });
  const c0 = a.coins;
  assert.equal(p.checkin(a.id).reward, CHECKIN_REWARDS[0]);
  assert.equal(p.checkin(a.id).ok, false);
  now += DAY; assert.equal(p.checkin(a.id).reward, CHECKIN_REWARDS[1]);
  now += 3 * DAY; assert.equal(p.checkin(a.id).reward, CHECKIN_REWARDS[0]);
  assert.equal(a.coins, c0 + CHECKIN_REWARDS[0] * 2 + CHECKIN_REWARDS[1]);
});

test('weekly leaderboard ranks accounts by stat', () => {
  const now = Date.UTC(2026, 10, 5);
  const p = new Profiles(tmp(), { clock: () => now });
  const a = p.register({ username: 'alpha', password: 'secret12' }).profile;
  const b = p.register({ username: 'bravo', password: 'secret12' }).profile;
  const g = p.guest({ name: 'Guest' });
  p.stat(a.id, 'songs', 1); p.stat(b.id, 'songs', 3); p.stat(g.id, 'songs', 9);
  const lb = p.leaderboard();
  assert.equal(lb.weekStart, '2026-11-02');
  assert.deepEqual(lb.songs.map((r) => r.name), ['bravo', 'alpha']);
});

test('state persists to disk', () => {
  const file = tmp();
  const p = new Profiles(file);
  const { profile: a, token } = p.register({ username: 'persist', password: 'secret12' });
  p.addCoins(a.id, 7); p.flush();
  const q = new Profiles(file);
  assert.equal(q.byToken(token).coins, a.coins);
  assert.equal(q.login({ username: 'persist', password: 'secret12' }).ok, true);
});

test('grant adds or removes coins by username (never below zero), accounts only', () => {
  const p = new Profiles(tmp());
  const { profile: a } = p.register({ username: 'Rich', password: 'secret12' });
  const start = a.coins;
  assert.equal(p.grant('rich', 1000).coins, start + 1000);
  assert.equal(p.grant('RICH', -999999).coins, 0);
  assert.equal(p.grant('nobody', 10).ok, false);
});

test('setAdmin marks an account as admin and shows in the private view', () => {
  const p = new Profiles(tmp());
  const { profile: a } = p.register({ username: 'boss', password: 'secret12' });
  assert.equal(p.privateView(a).isAdmin, false);
  assert.equal(p.setAdmin('Boss', true).ok, true);
  assert.equal(p.privateView(a).isAdmin, true);
  assert.equal(p.setAdmin('ghost', true).ok, false);
});
