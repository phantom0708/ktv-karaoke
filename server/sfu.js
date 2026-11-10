// Room voice through Cloudflare Realtime SFU (free tier shares the 1,000 GB/month with TURN).
// Every browser holds ONE RTCPeerConnection to Cloudflare: it publishes its mic once and pulls the mics of the
// others, so a singer uploads a single stream no matter how many people listen (the mesh sends one per listener).
// The app secret stays here: browsers send SDP over the KTV WebSocket and this module talks to Cloudflare.
//   keys: env CF_SFU_APP_ID + CF_SFU_APP_SECRET, or data/sfu.json { "appId": "...", "appSecret": "..." }
// Without keys the client keeps the peer-to-peer mesh.
import fs from 'node:fs';

const BASE = process.env.CF_SFU_BASE || 'https://rtc.live.cloudflare.com/v1/apps'; // override only for local tests
export const TRACK = 'mic';
const MAX_PULL = 60;

export function readSfuKey(file, env = process.env) {
  if (env.CF_SFU_APP_ID && env.CF_SFU_APP_SECRET) return { appId: env.CF_SFU_APP_ID, appSecret: env.CF_SFU_APP_SECRET };
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j.appId && j.appSecret) return { appId: String(j.appId).trim(), appSecret: String(j.appSecret).trim() }; } catch {}
  return null;
}

export class SfuError extends Error { constructor(code, detail) { super(detail || code); this.code = code; } }

export class VoiceHub {
  constructor({ key = null, fetch: f = globalThis.fetch, log = console } = {}) {
    this.key = key; this.fetch = f; this.log = log;
    this.sessions = new Map(); // profileId -> { sessionId, roomId, live }
  }

  get enabled() { return !!this.key; }

  async #api(method, path, body) {
    const r = await this.fetch(`${BASE}/${encodeURIComponent(this.key.appId)}${path}`, {
      method, headers: { authorization: `Bearer ${this.key.appSecret}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000),
    });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok || j.errorCode) throw new SfuError('sfu', `Cloudflare SFU ${r.status} ${j.errorCode ?? ''} ${j.errorDescription ?? ''}`.trim());
    return j;
  }

  #mine(pid, roomId) {
    const s = this.sessions.get(pid);
    if (!s || (roomId && s.roomId !== roomId)) throw new SfuError('noSession');
    return s;
  }

  // ids of people in the room whose mic track can be pulled
  live(roomId, exceptId) { return [...this.sessions].filter(([id, s]) => s.roomId === roomId && s.live && id !== exceptId).map(([id]) => id); }

  // new session for this player in this room. Cloudflare closes a session that has no connected PeerConnection,
  // so the browser connects straight away through a silent placeholder track that nobody ever pulls.
  async join(pid, roomId, { sdp, mid } = {}) {
    if (typeof sdp !== 'string' || !sdp || mid == null) throw new SfuError('badRequest');
    this.leave(pid);
    const { sessionId } = await this.#api('POST', '/sessions/new');
    if (!sessionId) throw new SfuError('sfu', 'no sessionId');
    const r = await this.#api('POST', `/sessions/${sessionId}/tracks/new`, {
      sessionDescription: { type: 'offer', sdp }, tracks: [{ location: 'local', mid: String(mid), trackName: 'hold' }],
    });
    const bad = (r.tracks ?? []).find((t) => t.errorCode);
    if (bad) throw new SfuError('sfu', `${bad.errorCode} ${bad.errorDescription ?? ''}`);
    this.sessions.set(pid, { sessionId, roomId, live: false, track: null, n: 0 });
    return { sdp: r.sessionDescription?.sdp, live: this.live(roomId, pid) };
  }

  // mic on: publish a fresh track. Cloudflare drops a published track that stays silent too long,
  // so the track only exists while the mic is on (each mic-on gets a new track name).
  async publish(pid, roomId, { sdp, mid }) {
    const s = this.#mine(pid, roomId);
    if (typeof sdp !== 'string' || !sdp || mid == null) throw new SfuError('badRequest');
    const name = `${TRACK}-${++s.n}`;
    const r = await this.#api('POST', `/sessions/${s.sessionId}/tracks/new`, {
      sessionDescription: { type: 'offer', sdp }, tracks: [{ location: 'local', mid: String(mid), trackName: name }],
    });
    const bad = (r.tracks ?? []).find((t) => t.errorCode);
    if (bad) throw new SfuError('sfu', `${bad.errorCode} ${bad.errorDescription ?? ''}`);
    s.track = name; s.live = false;
    return { sdp: r.sessionDescription?.sdp };
  }

  // the published track is sending packets (Cloudflare only lets others pull it then): others may pull it
  goLive(pid, roomId) { const s = this.#mine(pid, roomId); if (!s.track) return false; s.live = true; return true; }

  // mic off: close the published track (the browser stopped its transceiver and sends a fresh offer)
  async unpublish(pid, roomId, { mid, sdp }) {
    const s = this.#mine(pid, roomId); const was = s.live;
    s.live = false; s.track = null;
    const r = mid != null ? await this.close(pid, roomId, [mid], sdp) : { sdp: null };
    return { ...r, was };
  }

  // subscribe to other people's mics; Cloudflare answers with an offer the browser must answer (renegotiate)
  async pull(pid, roomId, ids) {
    const me = this.#mine(pid, roomId);
    const want = [...new Set([].concat(ids ?? []).map(String))].slice(0, MAX_PULL)
      .map((id) => [id, this.sessions.get(id)]).filter(([id, s]) => id !== pid && s?.roomId === roomId && s.live);
    if (!want.length) return { tracks: [], sdp: null, retry: [] };
    const r = await this.#api('POST', `/sessions/${me.sessionId}/tracks/new`, {
      tracks: want.map(([, s]) => ({ location: 'remote', sessionId: s.sessionId, trackName: s.track })),
    });
    for (const t of r.tracks ?? []) if (t.errorCode) this.log.warn?.(`SFU pull: ${t.errorCode} ${t.errorDescription ?? ''}`);
    const tracks = (r.tracks ?? []).map((t, i) => {
      const hit = want.find(([, s]) => s.sessionId === t.sessionId) ?? want[i];
      return !t.errorCode && t.mid != null && hit ? { id: hit[0], mid: String(t.mid) } : null;
    }).filter(Boolean);
    // a track whose packets have not reached Cloudflare yet: the browser asks again a moment later
    const retry = (r.tracks ?? []).map((t, i) => (t.errorCode === 'not_found_track_error' ? (want.find(([, s]) => s.sessionId === t.sessionId) ?? want[i])?.[0] : null)).filter(Boolean);
    return { tracks, retry, sdp: r.requiresImmediateRenegotiation ? r.sessionDescription?.sdp ?? null : null };
  }

  async answer(pid, roomId, sdp) {
    const me = this.#mine(pid, roomId);
    if (typeof sdp !== 'string' || !sdp) throw new SfuError('badRequest');
    await this.#api('PUT', `/sessions/${me.sessionId}/renegotiate`, { sessionDescription: { type: 'answer', sdp } });
    return {};
  }

  // stop pulling tracks (someone left): the browser stopped the transceivers and sends a fresh offer
  async close(pid, roomId, mids, sdp) {
    const me = this.#mine(pid, roomId);
    const list = [].concat(mids ?? []).map(String).slice(0, MAX_PULL);
    if (!list.length) return { sdp: null };
    const r = await this.#api('PUT', `/sessions/${me.sessionId}/tracks/close`, {
      tracks: list.map((mid) => ({ mid })), force: !sdp, ...(sdp ? { sessionDescription: { type: 'offer', sdp } } : {}),
    });
    return { sdp: r.sessionDescription?.sdp ?? null };
  }

  // left the room: Cloudflare drops the session by itself once the browser closes its connection
  leave(pid) { this.sessions.delete(pid); }
}
