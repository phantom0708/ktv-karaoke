// ICE servers for WebRTC voice. Cloudflare Realtime TURN (free tier 1,000 GB/month) when a TURN key is
// configured, otherwise free Cloudflare STUN only. Credentials are short-lived, fetched from Cloudflare's API,
// cached and shared until half their lifetime has passed.
//   keys: env CF_TURN_KEY_ID + CF_TURN_API_TOKEN, or data/turn.json { "keyId": "...", "apiToken": "..." }
//   manual TURN (any provider): env TURN_URL / TURN_USER / TURN_PASS
import fs from 'node:fs';

export const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const TTL = 24 * 3600; // seconds

export function readTurnKey(file, env = process.env) {
  if (env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) return { keyId: env.CF_TURN_KEY_ID, apiToken: env.CF_TURN_API_TOKEN };
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j.keyId && j.apiToken) return { keyId: j.keyId, apiToken: j.apiToken }; } catch {}
  return null;
}

// browsers time out on port 53, so Cloudflare recommends dropping those URLs
const dropPort53 = (servers) => servers.map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
  .filter((s) => s.urls.length);

export class IceProvider {
  constructor({ key = null, env = process.env, fetch: f = globalThis.fetch, clock = Date.now, log = console } = {}) {
    this.key = key; this.fetch = f; this.clock = clock; this.log = log;
    this.manual = env.TURN_URL ? [{ urls: env.TURN_URL, username: env.TURN_USER, credential: env.TURN_PASS }] : [];
    this.cached = null; this.expires = 0; this.pending = null; this.failedAt = -Infinity;
  }

  get mode() { return this.key ? 'cloudflare' : this.manual.length ? 'manual' : 'stun'; }

  async #fetchCloudflare() {
    const r = await this.fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(this.key.keyId)}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { authorization: `Bearer ${this.key.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TTL }), signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`Cloudflare TURN ${r.status}`);
    const j = await r.json();
    const list = [].concat(j.iceServers ?? []);
    if (!list.length) throw new Error('Cloudflare TURN: no iceServers');
    return dropPort53(list);
  }

  // always resolves: falls back to STUN (+ manual TURN) if Cloudflare is unreachable
  async get() {
    if (!this.key) return [...STUN, ...this.manual];
    const now = this.clock();
    if (this.cached && now < this.expires) return this.cached;
    if (!this.pending && now - this.failedAt > 60_000) {
      this.pending = this.#fetchCloudflare().then((list) => {
        this.cached = [...list, ...this.manual]; this.expires = this.clock() + (TTL * 1000) / 2;
      }).catch((e) => { this.failedAt = this.clock(); this.log.warn?.(`[turn] ${e.message}`); })
        .finally(() => { this.pending = null; });
    }
    if (this.pending) await this.pending;
    // a stale cache is refreshed at half-life, so it is still valid if the refresh failed
    return this.cached ?? [...STUN, ...this.manual];
  }
}
