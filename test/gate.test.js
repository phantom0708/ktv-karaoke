import test from 'node:test';
import assert from 'node:assert/strict';
import { Gate } from '../server/gate.js';

test('lets people in up to max, then queues in order and admits on leave', () => {
  const g = new Gate({ max: 2, maxWaiting: 2 });
  assert.equal(g.request('a', 1), 'in'); assert.equal(g.request('b', 2), 'in');
  assert.equal(g.request('c', 3), 'queued'); assert.equal(g.request('d', 4), 'queued');
  assert.equal(g.request('e', 5), 'full');
  assert.deepEqual([g.position('c'), g.position('d'), g.position('a')], [1, 2, 0]);
  assert.deepEqual(g.status(), { online: 2, max: 2, waiting: 2 });
  const adm = g.leave('a');
  assert.deepEqual(adm.map((w) => [w.conn, w.data]), [['c', 3]]);
  assert.equal(g.position('d'), 1); assert.equal(g.online, 2);
});

test('already inside stays in; re-request in queue keeps the place; leaving the queue frees it', () => {
  const g = new Gate({ max: 1, maxWaiting: 5 });
  g.request('a'); assert.equal(g.request('a'), 'in');
  g.request('b'); g.request('c');
  assert.equal(g.request('b', 'new'), 'queued'); assert.equal(g.position('b'), 1);
  assert.deepEqual(g.leave('b'), []); assert.equal(g.position('c'), 1);
});

test('vip (admin / same account) skips the queue, even over max', () => {
  const g = new Gate({ max: 1 });
  g.request('a'); g.request('b');
  assert.equal(g.request('boss', null, { vip: true }), 'in'); assert.equal(g.online, 2);
  assert.equal(g.request('b', null, { vip: true }), 'in'); assert.equal(g.waiting.length, 0);
  assert.deepEqual(g.leave('a'), []); // still at/over max: nobody waiting anyway
});

test('a free seat is not taken by a newcomer while others wait', () => {
  const g = new Gate({ max: 1 });
  g.request('a'); g.request('b');
  g.inside.delete('a'); // seat freed without fill() yet
  assert.equal(g.request('c'), 'queued');
  assert.deepEqual(g.fill().map((w) => w.conn), ['b']);
});
