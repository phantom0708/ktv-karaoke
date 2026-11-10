import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, PRICES } from '../server/rooms.js';
import { DANCE_MS, DANCER_SPOTS } from '../server/dancers.js';

function setup({ coins = 5000 } = {}) {
  let now = 1_000_000; const sent = []; const wallet = new Map();
  const room = new Room({ id: 'r1', name: 'T', capacity: 4 }, {
    clock: () => now, broadcast: (m) => sent.push(m),
    spend: (id, a) => { const c = wallet.get(id) ?? coins; if (c < a) return false; wallet.set(id, c - a); return true; },
  });
  room.add({ id: 'a', name: 'A', look: {}, equipped: [] });
  return { room, sent, wallet, advance: (ms) => { now += ms; } };
}
const dancers = (room) => [...room.members.values()].filter((m) => m.id.startsWith('dancer-'));

test('calling the crew costs coins and puts two dancers on the stage (not taking player slots)', () => {
  const s = setup();
  assert.equal(s.room.order('a', { kind: 'dance', item: 'crew' }).ok, true);
  assert.equal(s.wallet.get('a'), 5000 - PRICES.dance.crew);
  const d = dancers(s.room);
  assert.equal(d.length, 2); assert.equal(s.room.humans().length, 1);
  assert.deepEqual(d.map((m) => m.stage), DANCER_SPOTS);
  assert.deepEqual(d.map((m) => [m.x, m.z]), DANCER_SPOTS.map((p) => [p.x, p.z])); // outside the walkable bounds: never clamped
  assert.ok(d.every((m) => m.bot && m.equipped.includes('outfit-idol')));
  assert.ok(s.sent.some((m) => m.type === 'show' && m.kind === 'dance'));
});

test('dance while a song plays, idle otherwise; calling again extends; they leave when time is up', () => {
  const s = setup();
  s.room.order('a', { kind: 'dance', item: 'crew' });
  s.room.dancers.step(); assert.ok(dancers(s.room).every((m) => m.anim === 'idle'));
  s.room.playback.song = { id: 1, singers: ['a'], gifts: {} }; s.room.playback.pausedAt = null;
  s.room.dancers.step(); assert.ok(dancers(s.room).every((m) => m.anim === 'dance'));
  assert.equal(s.room.order('a', { kind: 'dance', item: 'crew' }).ok, true); assert.equal(dancers(s.room).length, 2); // extended, not doubled
  s.advance(DANCE_MS + 1000); s.room.dancers.step(); assert.equal(dancers(s.room).length, 2);
  s.advance(DANCE_MS); s.room.dancers.step(); assert.equal(dancers(s.room).length, 0);
});

test('the crew leaves when the room empties; poor callers are refused', () => {
  const s = setup({ coins: 100 });
  assert.equal(s.room.order('a', { kind: 'dance', item: 'crew' }).error, 'coins');
  s.wallet.set('a', 5000); s.room.order('a', { kind: 'dance', item: 'crew' });
  s.room.remove('a'); s.room.dancers.step(); assert.equal(dancers(s.room).length, 0);
});
