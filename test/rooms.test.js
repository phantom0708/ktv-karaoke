import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, PRICES, EARN } from '../server/rooms.js';

function setup({ capacity = 4, coins = 1000 } = {}) {
  let now = 1_000_000;
  const sent = []; const rewards = []; const stats = []; const wallet = new Map();
  const room = new Room({ id: 'r1', name: 'Test', capacity }, {
    clock: () => now,
    broadcast: (msg) => sent.push(msg),
    reward: (id, amount, reason) => { rewards.push({ id, amount, reason }); wallet.set(id, (wallet.get(id) ?? coins) + amount); },
    spend: (id, amount) => { const c = wallet.get(id) ?? coins; if (c < amount) return false; wallet.set(id, c - amount); return true; },
    stat: (id, key, amount) => stats.push({ id, key, amount }),
  });
  const join = (id, extra) => room.add({ id, name: id.toUpperCase(), look: {}, equipped: [] }, extra);
  return { room, sent, rewards, stats, wallet, join, advance: (ms) => { now += ms; }, now: () => now };
}
const V = (c) => c.repeat(11);
const play = (s, owner = 'a') => { s.room.enqueue(owner, { videoId: V(owner), title: owner }); return s.room.playback.song; };

test('first human is host; host passes to the next human on leave', () => {
  const s = setup(); s.join('a'); s.join('b');
  assert.equal(s.room.hostId, 'a');
  s.room.remove('a');
  assert.equal(s.room.hostId, 'b');
});

test('capacity is enforced', () => {
  const s = setup({ capacity: 2 }); s.join('a'); s.join('b');
  assert.equal(s.join('c'), null);
});

test('enqueue starts playback when idle and queues otherwise; per-member limit', () => {
  const s = setup(); s.join('a'); s.join('b');
  play(s, 'a');
  assert.deepEqual(s.room.playback.song.singers, ['a']);
  for (let i = 0; i < 5; i++) s.room.enqueue('b', { videoId: `b${i}`.padEnd(11, 'x'), title: `B${i}` });
  assert.equal(s.room.queue.length, 3);
  assert.equal(s.room.enqueue('a', { videoId: 'bad', title: 'x' }), false);
});

test('prioritize moves a queued song to the front (owner or host only)', () => {
  const s = setup(); s.join('a'); s.join('b'); s.join('c');
  play(s, 'a');
  s.room.enqueue('b', { videoId: V('b'), title: 'B' });
  s.room.enqueue('c', { videoId: V('c'), title: 'C' });
  const cSong = s.room.queue[1].id;
  assert.equal(s.room.prioritize('b', cSong), false);
  assert.equal(s.room.prioritize('a', cSong), true); // host
  assert.equal(s.room.queue[0].title, 'C');
});

test('pause/resume shifts startedAt; singer and host control directly', () => {
  const s = setup(); s.join('a'); s.join('b');
  play(s, 'b');
  const started = s.room.playback.startedAt;
  s.advance(10_000);
  assert.equal(s.room.control('b', 'pause').ok, true);
  s.advance(4_000);
  assert.equal(s.room.control('a', 'resume').ok, true); // host
  assert.equal(s.room.playback.startedAt, started + 4_000);
});

test('other members must ask; the singer approves or denies', () => {
  const s = setup(); s.join('a'); s.join('b'); s.join('c');
  play(s, 'b');
  const r = s.room.control('c', 'skip');
  assert.equal(r.ok, false); assert.equal(r.asked, true);
  const req = s.sent.find((m) => m.type === 'control.request');
  assert.equal(req.to, 'b'); assert.equal(req.action, 'skip');
  assert.equal(s.room.answerControl('c', req.reqId, true), false); // requester cannot approve
  assert.equal(s.room.answerControl('b', req.reqId, true), true);
  assert.equal(s.room.playback.song, null);
});

test('song end pays singers and counts a song stat when enough was sung', () => {
  const s = setup(); s.join('a'); s.join('b');
  const song = play(s, 'a');
  s.room.setDuration(song.id, 200);
  s.advance(3_000 + 190_000); // the video really ended (an early 'ended' is ignored)
  s.room.ended(song.id);
  const pay = s.rewards.find((r) => r.reason === 'sing');
  assert.equal(pay.id, 'a'); assert.equal(pay.amount, EARN.singAudience);
  assert.ok(s.stats.some((x) => x.id === 'a' && x.key === 'songs'));
});

test('singing alone pays less than singing to an audience', () => {
  const s = setup(); s.join('a');
  const song = play(s, 'a'); s.room.setDuration(song.id, 100);
  s.advance(3_000 + 90_000); s.room.ended(song.id);
  assert.equal(s.rewards.find((r) => r.reason === 'sing').amount, EARN.singSolo);
});

test('tick advances when the song overruns its duration', () => {
  const s = setup(); s.join('a');
  const song = play(s, 'a'); s.room.setDuration(song.id, 60);
  s.advance(3_000 + 70_000); s.room.tick();
  assert.equal(s.room.playback.song, null);
});

test('reactions from the audience pay the singer, capped per song', () => {
  const s = setup(); s.join('a'); s.join('b');
  play(s, 'a'); s.advance(3_500);
  for (let i = 0; i < 30; i++) { s.advance(2_000); s.room.react('b', 'heart'); }
  const total = s.rewards.filter((r) => r.reason === 'react' && r.id === 'a').reduce((n, r) => n + r.amount, 0);
  assert.equal(total, EARN.reactCap);
  s.room.react('a', 'heart'); // singer reacting to self earns nothing extra
  assert.equal(s.rewards.filter((r) => r.reason === 'react').reduce((n, r) => n + r.amount, 0), EARN.reactCap);
});

test('gifts cost the giver and pay singers a share', () => {
  const s = setup(); s.join('a'); s.join('b');
  play(s, 'a');
  assert.equal(s.room.order('b', { kind: 'gift', item: 'flowers' }).ok, true);
  assert.equal(s.wallet.get('b'), 1000 - PRICES.gift.flowers);
  assert.equal(s.rewards.find((r) => r.reason === 'gift').amount, Math.floor(PRICES.gift.flowers * EARN.giftShare));
  assert.ok(s.stats.some((x) => x.id === 'a' && x.key === 'gifts'));
  assert.ok(s.stats.some((x) => x.id === 'b' && x.key === 'spent'));
});

test('cannot gift when nobody is singing or when too poor', () => {
  const s = setup({ coins: 5 }); s.join('a'); s.join('b');
  assert.equal(s.room.order('b', { kind: 'gift', item: 'flowers' }).ok, false);
  play(s, 'a');
  assert.equal(s.room.order('b', { kind: 'gift', item: 'crown' }).ok, false);
});

test('party table: take an item from stock, drink raises buzz, staff restocks', () => {
  const s = setup(); s.join('a');
  const before = s.room.stock.beer;
  assert.equal(s.room.take('a', 'beer'), true);
  assert.equal(s.room.stock.beer, before - 1);
  assert.equal(s.room.members.get('a').held, 'beer');
  s.room.act('a', 'drink');
  assert.ok(s.room.members.get('a').buzz > 0);
  for (let i = 0; i < before; i++) s.room.take('a', 'beer');
  assert.equal(s.room.take('a', 'beer'), false); // sold out
  assert.equal(s.room.order('a', { kind: 'food', item: 'beer' }).ok, true);
  assert.ok(s.room.stock.beer > 0);
});

test('cheers includes nearby members holding a drink', () => {
  const s = setup(); s.join('a', { x: 0, z: 0 }); s.join('b', { x: 1, z: 0 }); s.join('c', { x: 8, z: 8 });
  s.room.take('a', 'beer'); s.room.take('b', 'soda'); s.room.take('c', 'beer');
  s.room.act('a', 'cheers');
  const msg = s.sent.filter((m) => m.type === 'act' && m.kind === 'cheers').at(-1);
  assert.deepEqual(msg.with, ['b']);
});

test('buzz decays over time', () => {
  const s = setup(); s.join('a');
  s.room.take('a', 'beer'); s.room.act('a', 'drink'); s.room.act('a', 'drink');
  const b = s.room.members.get('a').buzz;
  s.advance(60_000); s.room.tick();
  assert.ok(s.room.members.get('a').buzz < b);
});

test('stage effects toggle and fx orders broadcast a show', () => {
  const s = setup(); s.join('a');
  s.room.toggleEffect('a', 'laser');
  assert.equal(s.room.effects.laser, true);
  assert.equal(s.room.order('a', { kind: 'fx', item: 'confetti' }).ok, true);
  assert.ok(s.sent.some((m) => m.type === 'show' && m.item === 'confetti'));
});

test('seats: one member per seat', () => {
  const s = setup(); s.join('a'); s.join('b');
  assert.equal(s.room.sit('a', 0), true);
  assert.equal(s.room.sit('b', 0), false);
  assert.equal(s.room.sit('b', 99), false);
});

test('duet invite/accept, max two singers', () => {
  const s = setup(); s.join('a'); s.join('b'); s.join('c');
  const song = play(s, 'a');
  assert.equal(s.room.inviteDuet('c', 'b'), false);
  assert.equal(s.room.inviteDuet('a', 'b'), true);
  assert.equal(s.room.acceptDuet('c', song.id), false);
  assert.equal(s.room.acceptDuet('b', song.id), true);
  assert.deepEqual(s.room.playback.song.singers, ['a', 'b']);
  assert.equal(s.room.inviteDuet('a', 'c'), false);
});

test('listen reward only while a song plays, only for humans', () => {
  const s = setup(); s.join('a'); s.room.add({ id: 'bot1', name: 'Bot', bot: true, look: {} });
  play(s, 'a'); s.advance(4_000);
  s.room.payListeners();
  assert.deepEqual(s.rewards.filter((r) => r.reason === 'listen').map((r) => r.id), ['a']);
  s.room.control('a', 'pause'); s.rewards.length = 0; s.room.payListeners();
  assert.equal(s.rewards.length, 0);
});

test('singer leaving skips their song and drops their queued songs', () => {
  const s = setup(); s.join('a'); s.join('b');
  play(s, 'a');
  s.room.enqueue('a', { videoId: V('c'), title: 'C' });
  s.room.enqueue('b', { videoId: V('b'), title: 'B' });
  s.room.remove('a');
  assert.equal(s.room.playback.song.title, 'B');
  assert.equal(s.room.queue.length, 0);
});

test('effects and stock reset when the last person leaves', () => {
  const s = setup(); s.join('a');
  s.room.toggleEffect('a', 'laser'); s.room.take('a', 'beer');
  s.room.remove('a');
  assert.equal(s.room.effects.laser, false);
  assert.equal(s.room.stock.beer, 12);
});

test('an unanswered control request applies itself after the timeout', () => {
  const s = setup(); s.join('a'); s.join('b'); s.join('c');
  play(s, 'b');
  s.room.control('c', 'skip');
  s.advance(5_000); s.room.tick();
  assert.ok(s.room.playback.song, 'still playing before the timeout');
  s.advance(6_000); s.room.tick();
  assert.equal(s.room.playback.song, null);
  const ans = s.sent.find((m) => m.type === 'control.answer');
  assert.equal(ans.accept, true); assert.equal(ans.auto, true);
});

test('a denied request does not apply later', () => {
  const s = setup(); s.join('a'); s.join('b'); s.join('c');
  play(s, 'b');
  s.room.control('c', 'skip');
  const req = s.sent.find((m) => m.type === 'control.request');
  s.room.answerControl('b', req.reqId, false);
  s.advance(20_000); s.room.tick();
  assert.ok(s.room.playback.song);
});

test('control request tells the requester who was asked and the timeout', () => {
  const s = setup(); s.join('a'); s.join('b'); s.join('c');
  play(s, 'b');
  const r = s.room.control('c', 'skip');
  assert.equal(r.asked, true); assert.equal(r.singerName, 'B'); assert.equal(r.timeoutSec, 10);
});

test('bots never take a slot: humans can fill the full capacity', () => {
  const s = setup({ capacity: 2 });
  s.room.add({ id: 'bot1', name: 'Bot 1', bot: true, look: {} });
  s.room.add({ id: 'bot2', name: 'Bot 2', bot: true, look: {} });
  assert.ok(s.join('a')); assert.ok(s.join('b'));
  assert.equal(s.join('c'), null); // the third human is refused, bots are not counted
  const info = s.room.publicInfo();
  assert.equal(info.count, 2); assert.equal(info.status, 'full');
});

test('room info counts people only, not bots', () => {
  const s = setup({ capacity: 4 }); s.join('a');
  s.room.add({ id: 'bot1', name: 'Bot', bot: true, look: {} });
  assert.equal(s.room.publicInfo().count, 1);
  assert.equal(s.room.publicInfo().status, 'open');
});

test('a client cannot end a song early with a fake duration or an early "ended"', async () => {
  const { Room } = await import('../server/rooms.js');
  let now = 1_000_000; const room = new Room({ id: 'rx', name: 'X', capacity: 4 }, { clock: () => now, broadcast: () => {}, reward: () => {}, spend: () => true, stat: () => {} });
  room.add({ id: 'a', name: 'A', look: {}, equipped: [] }); room.add({ id: 'b', name: 'B', look: {}, equipped: [] });
  room.enqueue('a', { videoId: 'abcdefghijk', title: 'T', channel: '' });
  const song = room.playback.song; assert.ok(song);
  room.setDuration(song.id, 1); assert.ok(!song.duration); // too short: ignored
  room.setDuration(song.id, 200); assert.equal(song.duration, 200);
  now += 20_000; room.ended(song.id); assert.equal(room.playback.song?.id, song.id); // 20 s into a 200 s song: ignored
  now += 170_000; room.ended(song.id); assert.notEqual(room.playback.song?.id, song.id); // near the end: next song
});
