import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Profiles } from '../server/profiles.js';
import { PrivateRooms, MAX_PRIVATE_CAPACITY, MAX_ROOMS_PER_OWNER } from '../server/privaterooms.js';
import { Room } from '../server/rooms.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ktv-')), 'db.json');
function setup(file = tmp()) {
  const profiles = new Profiles(file); const pr = new PrivateRooms(profiles);
  const owner = profiles.register({ username: 'owner1', password: 'secret12', name: 'Chủ' }).profile;
  const admin = profiles.register({ username: 'boss', password: 'secret12' }).profile; profiles.setAdmin('boss', true);
  const other = profiles.register({ username: 'other', password: 'secret12' }).profile;
  return { file, profiles, pr, owner, admin, other };
}

test('request validates account, name and the 2–40 capacity', () => {
  const { profiles, pr, owner } = setup();
  assert.equal(pr.request(profiles.guest({ name: 'G' }), { name: 'Phòng A', capacity: 10 }).error, 'needAccount');
  assert.equal(pr.request(owner, { name: 'ab', capacity: 10 }).error, 'roomName');
  assert.equal(pr.request(owner, { name: 'Phòng A', capacity: MAX_PRIVATE_CAPACITY + 1 }).error, 'roomCapacity');
  assert.equal(pr.request(owner, { name: 'Phòng A', capacity: 1 }).error, 'roomCapacity');
  assert.equal(pr.request(owner, { name: 'Phòng A', capacity: 40 }).ok, true);
  assert.equal(pr.request(owner, { name: 'Phòng B', capacity: 5 }).error, 'requestPending'); // one pending at a time
  assert.equal(pr.pending().length, 1);
});

test('approve creates a room with a code; the public def never leaks the code; reject creates nothing', () => {
  const { pr, owner, admin, other } = setup();
  const q = pr.request(owner, { name: 'Sinh nhật Linh', capacity: 40 }).request;
  const r = pr.review(q.id, true, admin);
  assert.equal(r.ok, true); assert.match(r.room.code, /^[A-Z2-9]{6}$/);
  const def = pr.def(r.room);
  assert.equal(def.private, true); assert.equal(def.capacity, 40); assert.equal('code' in def, false);
  assert.equal(JSON.stringify(new Room(def).publicInfo()).includes(r.room.code), false);
  assert.equal(pr.review(q.id, true, admin).ok, false); // already reviewed
  const q2 = pr.request(other, { name: 'Phòng khác', capacity: 8 }).request;
  assert.equal(pr.review(q2.id, false, admin, 'trùng tên').room, null);
  assert.equal(pr.defs().length, 1);
  assert.equal(pr.mine(other.id).request.status, 'rejected');
  assert.equal(pr.mine(owner.id).rooms[0].code, r.room.code);
});

test('entry: owner and admins walk in, others need the right code; owner can change the code', () => {
  const { pr, owner, admin, other } = setup();
  const room = pr.review(pr.request(owner, { name: 'Lớp 12A', capacity: 30 }).request.id, true, admin).room;
  assert.equal(pr.canEnter(room.id, owner), true);
  assert.equal(pr.canEnter(room.id, admin), true);
  assert.equal(pr.canEnter(room.id, other), false);
  assert.equal(pr.canEnter(room.id, other, 'WRONG1'), false);
  assert.equal(pr.canEnter(room.id, other, room.code.toLowerCase()), true);
  const old = room.code;
  assert.equal(pr.newCode(room.id, other).ok, false);
  const nc = pr.newCode(room.id, owner).code;
  assert.notEqual(nc, old); assert.equal(pr.canEnter(room.id, other, old), false);
  assert.equal(pr.canEnter('r1', other), true); // public rooms are open
});

test('owners are limited; owner or admin can delete; everything persists', () => {
  const { file, profiles, pr, owner, admin, other } = setup();
  for (let i = 0; i < MAX_ROOMS_PER_OWNER; i++) pr.review(pr.request(owner, { name: `Phòng ${i}`, capacity: 10 }).request.id, true, admin);
  assert.equal(pr.request(owner, { name: 'Thêm nữa', capacity: 10 }).error, 'tooManyRooms');
  const [a, b] = pr.defs();
  assert.equal(pr.remove(a.id, other).ok, false);
  assert.equal(pr.remove(a.id, owner).ok, true);
  profiles.flush();
  const again = new PrivateRooms(new Profiles(file));
  assert.deepEqual(again.defs().map((d) => d.id), [b.id]);
  assert.equal(again.remove(b.id, { ...admin }).ok, true);
});

test('a 40-slot private room holds 40 people (bots and hosts are extra)', () => {
  const { pr, owner, admin } = setup();
  const def = pr.def(pr.review(pr.request(owner, { name: 'Hội lớn', capacity: 40 }).request.id, true, admin).room);
  const room = new Room(def);
  for (let i = 0; i < 40; i++) assert.ok(room.add({ id: `u${i}`, name: `U${i}`, look: {} }));
  assert.equal(room.add({ id: 'u40', name: 'late', look: {} }), null);
  assert.equal(room.publicInfo().status, 'full');
});
