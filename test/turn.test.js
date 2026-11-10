import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IceProvider, STUN } from '../server/turn.js';

const cfReply = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53', 'turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }] };
const fakeFetch = (reply, ok = true) => { const calls = []; const f = async (url, opts) => { calls.push({ url, opts }); return { ok, status: ok ? 201 : 401, json: async () => reply }; }; f.calls = calls; return f; };

test('without a key it hands out free STUN (plus manual TURN from env)', async () => {
  assert.deepEqual(await new IceProvider({ env: {} }).get(), STUN);
  const m = await new IceProvider({ env: { TURN_URL: 'turn:x:3478', TURN_USER: 'a', TURN_PASS: 'b' } }).get();
  assert.equal(m.at(-1).urls, 'turn:x:3478');
});

test('fetches Cloudflare credentials once, drops port 53 and caches until half-life', async () => {
  let now = 0; const f = fakeFetch(cfReply);
  const ice = new IceProvider({ key: { keyId: 'K', apiToken: 'T' }, env: {}, fetch: f, clock: () => now });
  const list = await ice.get();
  assert.match(f.calls[0].url, /turn\/keys\/K\/credentials\/generate-ice-servers$/);
  assert.equal(f.calls[0].opts.headers.authorization, 'Bearer T');
  assert.equal(list[0].username, 'u');
  assert.ok(list[0].urls.every((u) => !/:53(\?|$)/.test(u)));
  assert.equal(list[0].urls.length, 3);
  await ice.get(); assert.equal(f.calls.length, 1);
  now = 13 * 3600 * 1000; await ice.get(); assert.equal(f.calls.length, 2);
});

test('falls back to STUN when Cloudflare refuses', async () => {
  const ice = new IceProvider({ key: { keyId: 'K', apiToken: 'bad' }, env: {}, fetch: fakeFetch({}, false), log: {} });
  assert.deepEqual(await ice.get(), STUN);
});
