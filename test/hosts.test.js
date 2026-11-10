import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, PRICES, SEATS } from '../server/rooms.js';
import { HOST_MS, MAX_HOSTS_PER_ROOM } from '../server/hosts.js';

function setup({ coins = 5000, capacity = 2 } = {}) {
  let now = 1_000_000; const sent = []; const wallet = new Map();
  const room = new Room({ id: 'r1', name: 'T', capacity }, {
    clock: () => now, broadcast: (m) => sent.push(m),
    spend: (id, a) => { const c = wallet.get(id) ?? coins; if (c < a) return false; wallet.set(id, c - a); return true; },
  });
  const join = (id, extra) => room.add({ id, name: id.toUpperCase(), look: {}, equipped: [] }, extra);
  return { room, sent, wallet, join, advance: (ms) => { now += ms; }, now: () => now };
}
const staffIds = (room) => [...room.members.values()].filter((m) => m.id.startsWith('staff-'));

test('calling a host costs coins, adds an outfitted bot that never takes a player slot', () => {
  const s = setup(); s.join('a'); s.join('b');
  assert.equal(s.room.order('a', { kind: 'host', item: 'girl' }).ok, true);
  assert.equal(s.room.order('a', { kind: 'host', item: 'boy' }).ok, true);
  assert.equal(s.wallet.get('a'), 5000 - PRICES.host.girl - PRICES.host.boy);
  const [g, b] = staffIds(s.room);
  assert.equal(g.bot, true); assert.deepEqual(g.equipped, ['outfit-glam']); assert.deepEqual(b.equipped, ['outfit-abs']);
  assert.equal(s.room.humans().length, 2); // room capacity 2 still full of people, hosts are extras
  assert.ok(s.sent.some((m) => m.type === 'show' && m.kind === 'host' && m.item === 'girl'));
});

test('guests, unknown kinds, poor callers and a full staff are refused without charging', () => {
  const s = setup({ coins: 100 }); s.join('a'); s.room.add({ id: 'g', name: 'G', guest: true, look: {} });
  assert.equal(s.room.order('g', { kind: 'host', item: 'girl' }).error, 'needAccount');
  assert.equal(s.room.order('a', { kind: 'host', item: 'robot' }).ok, false);
  assert.equal(s.room.order('a', { kind: 'host', item: 'girl' }).error, 'coins');
  const r = setup({ capacity: 4 }); for (const id of ['a', 'b']) r.join(id);
  r.room.order('a', { kind: 'host', item: 'girl' }); r.room.order('a', { kind: 'host', item: 'boy' });
  r.room.order('b', { kind: 'host', item: 'girl' }); r.room.order('b', { kind: 'host', item: 'boy' });
  assert.equal(staffIds(r.room).length, MAX_HOSTS_PER_ROOM);
  r.room.add({ id: 'c', name: 'C', look: {} });
  const before = r.wallet.get('c') ?? 5000;
  assert.equal(r.room.order('c', { kind: 'host', item: 'girl' }).error, 'hostsBusy');
  assert.equal(r.wallet.get('c') ?? 5000, before);
});

test('host sits next to a seated caller, follows, and leaves when time is up', () => {
  const s = setup(); s.join('a'); s.room.sit('a', 1);
  s.room.order('a', { kind: 'host', item: 'girl' });
  s.room.staff.step(); const host = staffIds(s.room)[0];
  assert.ok([0, 2].includes(host.seat), `seat ${host.seat}`);
  s.room.move('a', { x: 0, z: 4 }); s.room.staff.step();
  assert.ok(Math.hypot(host.x - 0, host.z - 4) < 1.5);
  s.advance(HOST_MS + 1); s.room.staff.step();
  assert.equal(staffIds(s.room).length, 0);
  assert.ok(s.sent.some((m) => m.type === 'chat' && m.id === host.id));
});

test('calling the same kind again extends the time instead of adding a second host', () => {
  const s = setup(); s.join('a');
  s.room.order('a', { kind: 'host', item: 'boy' }); s.room.order('a', { kind: 'host', item: 'boy' });
  assert.equal(staffIds(s.room).length, 1);
  s.advance(HOST_MS + 1); s.room.staff.step();
  assert.equal(staffIds(s.room).length, 1);
});

test('hosts leave with their caller', () => {
  const s = setup(); s.join('a'); s.join('b');
  s.room.order('a', { kind: 'host', item: 'girl' });
  s.room.remove('a'); s.room.staff.step();
  assert.equal(staffIds(s.room).length, 0);
  assert.equal(SEATS.length, 10);
});

test('prototype keys are never prices: no NaN coins, no free orders', () => {
  const s = setup(); s.join('a');
  for (const [kind, item] of [['gift', 'constructor'], ['host', 'constructor'], ['food', '__proto__'], ['constructor', 'name'], ['dance', 'toString']]) {
    assert.equal(s.room.order('a', { kind, item }).error, 'unknown', `${kind}/${item}`);
  }
  assert.equal(s.wallet.get('a'), undefined); // never charged
});
