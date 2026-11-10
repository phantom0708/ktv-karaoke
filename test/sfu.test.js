import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VoiceHub, readSfuKey } from '../server/sfu.js';

// fake Cloudflare: records calls, answers like the Realtime SFU HTTPS API
function fakeCf() {
  const calls = []; let n = 0;
  const f = async (url, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : null; calls.push({ method: opts.method, url, body, auth: opts.headers.authorization });
    const json = (j, status = 200) => ({ ok: status < 300, status, json: async () => j });
    if (url.endsWith('/sessions/new')) return json({ sessionId: `s${++n}` });
    if (url.endsWith('/tracks/new')) {
      if (body.sessionDescription) return json({ sessionDescription: { type: 'answer', sdp: 'ANSWER' }, tracks: body.tracks.map((t) => ({ mid: t.mid, trackName: t.trackName })) });
      return json({ requiresImmediateRenegotiation: true, sessionDescription: { type: 'offer', sdp: 'OFFER' },
        tracks: body.tracks.map((t, i) => (t.sessionId === 'gone' ? { errorCode: 'not_found' } : { mid: String(10 + i), trackName: t.trackName, sessionId: t.sessionId })) });
    }
    if (url.endsWith('/renegotiate')) return json({});
    if (url.endsWith('/tracks/close')) return json({ sessionDescription: { type: 'answer', sdp: 'CLOSED' } });
    return json({ errorCode: 'nope' }, 404);
  };
  return { calls, fetch: f };
}
const KEY = { appId: 'app1', appSecret: 'sec' };

test('readSfuKey: env, file, missing', () => {
  assert.deepEqual(readSfuKey('/nope', { CF_SFU_APP_ID: 'a', CF_SFU_APP_SECRET: 'b' }), { appId: 'a', appSecret: 'b' });
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sfu')), 'sfu.json');
  fs.writeFileSync(f, JSON.stringify({ appId: ' x ', appSecret: 'y\n' }));
  assert.deepEqual(readSfuKey(f, {}), { appId: 'x', appSecret: 'y' });
  assert.equal(readSfuKey('/nope', {}), null);
  assert.equal(new VoiceHub().enabled, false);
});

const J = { sdp: 'OJ', mid: '0' };
const pub = async (hub, id, room) => { await hub.join(id, room, J); await hub.publish(id, room, { sdp: 'O', mid: '0' }); hub.goLive(id, room); };

test('join makes an empty session; publish names a fresh track per mic-on; live list = same room', async () => {
  const cf = fakeCf(); const hub = new VoiceHub({ key: KEY, fetch: cf.fetch });
  assert.deepEqual(await hub.join('A', 'r1', J), { sdp: 'ANSWER', live: [] });
  assert.deepEqual(cf.calls[1].body.tracks, [{ location: 'local', mid: '0', trackName: 'hold' }]);
  await assert.rejects(() => hub.join('A', 'r1', {}), { code: 'badRequest' });
  assert.equal(cf.calls[0].url, 'https://rtc.live.cloudflare.com/v1/apps/app1/sessions/new');
  assert.equal(cf.calls[0].auth, 'Bearer sec');
  assert.equal(hub.goLive('A', 'r1'), false); // nothing published yet
  assert.equal((await hub.publish('A', 'r1', { sdp: 'OA', mid: '0' })).sdp, 'ANSWER');
  assert.deepEqual(cf.calls.at(-1).body, { sessionDescription: { type: 'offer', sdp: 'OA' }, tracks: [{ location: 'local', mid: '0', trackName: 'mic-1' }] });
  assert.equal(hub.goLive('A', 'r1'), true);
  await pub(hub, 'C', 'r2');
  assert.deepEqual((await hub.join('B', 'r1', J)).live, ['A']);
  await assert.rejects(() => hub.publish('B', 'r1', { sdp: '', mid: 0 }), { code: 'badRequest' });
  // mic off -> not live, closes the local mid; next mic-on is mic-2
  const off = await hub.unpublish('A', 'r1', { mid: '0', sdp: 'OFF' });
  assert.deepEqual(off, { sdp: 'CLOSED', was: true }); assert.deepEqual(hub.live('r1'), []);
  await hub.publish('A', 'r1', { sdp: 'O', mid: '2' });
  assert.equal(cf.calls.at(-1).body.tracks[0].trackName, 'mic-2');
});

test('pull only same-room live tracks, maps mids back to people, renegotiates', async () => {
  const cf = fakeCf(); const hub = new VoiceHub({ key: KEY, fetch: cf.fetch });
  await pub(hub, 'A', 'r1'); await hub.join('B', 'r1', J); await hub.join('X', 'r1', J); await pub(hub, 'C', 'r2'); // X never turned the mic on
  const r = await hub.pull('B', 'r1', ['A', 'C', 'X', 'B', 'nobody']);
  assert.deepEqual(r, { tracks: [{ id: 'A', mid: '10' }], retry: [], sdp: 'OFFER' });
  const last = cf.calls.at(-1);
  assert.match(last.url, /sessions\/s2\/tracks\/new$/);
  assert.deepEqual(last.body.tracks, [{ location: 'remote', sessionId: 's1', trackName: 'mic-1' }]);
  assert.deepEqual(await hub.pull('B', 'r1', ['C']), { tracks: [], sdp: null, retry: [] });
  await hub.answer('B', 'r1', 'ANS');
  assert.deepEqual(cf.calls.at(-1).body, { sessionDescription: { type: 'answer', sdp: 'ANS' } });
  const c = await hub.close('B', 'r1', ['10'], 'O2');
  assert.equal(c.sdp, 'CLOSED');
  assert.deepEqual(cf.calls.at(-1).body, { tracks: [{ mid: '10' }], force: false, sessionDescription: { type: 'offer', sdp: 'O2' } });
});

test('no session / wrong room / leave', async () => {
  const cf = fakeCf(); const hub = new VoiceHub({ key: KEY, fetch: cf.fetch });
  await assert.rejects(() => hub.pull('B', 'r1', ['A']), { code: 'noSession' });
  await pub(hub, 'A', 'r1');
  assert.throws(() => hub.goLive('A', 'r2'), { code: 'noSession' });
  hub.leave('A'); assert.deepEqual(hub.live('r1'), []);
});

test('Cloudflare errors become SfuError("sfu")', async () => {
  const hub = new VoiceHub({ key: KEY, fetch: async () => ({ ok: false, status: 401, json: async () => ({ errorCode: 'unauthorized' }) }) });
  await assert.rejects(() => hub.join('A', 'r1', J), (e) => e.code === 'sfu' && /401/.test(e.message));
});

test('track not sending yet -> retry list', async () => {
  let n = 0;
  const hub = new VoiceHub({ key: KEY, log: {}, fetch: async (url, o) => ({ ok: true, status: 200, json: async () => (url.endsWith('/sessions/new') ? { sessionId: `s${++n}` }
    : JSON.parse(o.body).sessionDescription ? { sessionDescription: { sdp: 'A' }, tracks: [] }
    : { requiresImmediateRenegotiation: false, tracks: [{ errorCode: 'not_found_track_error', sessionId: 's1' }] }) }) });
  await pub(hub, 'A', 'r1'); await hub.join('B', 'r1', J);
  assert.deepEqual(await hub.pull('B', 'r1', ['A']), { tracks: [], retry: ['A'], sdp: null });
});

test('hifi: raises Opus bitrate, disables DTX, leaves other codecs alone', async () => {
  const { hifi } = await import('../public/js/voice.js');
  const sdp = 'v=0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:63 red/48000/2\r\na=fmtp:63 111/111\r\n';
  const out = hifi(sdp);
  assert.match(out, /a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=128000;usedtx=0\r\n/);
  assert.match(out, /a=fmtp:63 111\/111\r\n/);
  assert.equal(hifi(out), out); // idempotent
});
