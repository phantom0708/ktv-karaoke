// Door policy: at most `max` players in the game at once (what this server can serve smoothly — see the load test
// in README). Everyone else who signs in waits in a FIFO queue and is let in automatically when a seat frees up.
// The queue itself is capped so open connections stay under the process file limit (ulimit -n 1024).
// Pure bookkeeping, keyed by connection objects; index.js does the sending.
export class Gate {
  constructor({ max = 300, maxWaiting = 500 } = {}) {
    this.max = max; this.maxWaiting = maxWaiting;
    this.inside = new Set(); // connections that are in the game
    this.waiting = []; // { conn, data, at }
  }

  get online() { return this.inside.size; }

  // conn wants to play. vip (admins, or the same account already inside on another tab) never waits.
  // returns 'in' | 'queued' | 'full'
  request(conn, data, { vip = false, now = Date.now() } = {}) {
    if (this.inside.has(conn)) return 'in';
    const q = this.waiting.findIndex((w) => w.conn === conn);
    if (q >= 0) { this.waiting[q].data = data; if (!vip) return 'queued'; this.waiting.splice(q, 1); }
    if (vip || (this.inside.size < this.max && !this.waiting.length)) { this.inside.add(conn); return 'in'; }
    if (this.waiting.length >= this.maxWaiting) return 'full';
    this.waiting.push({ conn, data, at: now });
    return 'queued';
  }

  // conn left the game or the queue (closed, logged out). Returns the waiting entries let in now.
  leave(conn) {
    this.inside.delete(conn);
    this.waiting = this.waiting.filter((w) => w.conn !== conn);
    return this.fill();
  }

  // admit from the head of the queue while there is room (also used after `max` is raised)
  fill() {
    const admitted = [];
    while (this.waiting.length && this.inside.size < this.max) { const w = this.waiting.shift(); this.inside.add(w.conn); admitted.push(w); }
    return admitted;
  }

  position(conn) { const i = this.waiting.findIndex((w) => w.conn === conn); return i < 0 ? 0 : i + 1; }
  status() { return { online: this.inside.size, max: this.max, waiting: this.waiting.length }; }
}
