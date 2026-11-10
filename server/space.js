// A shared 3D space (lobby or room): members with positions, chat, emotes.
export class Space {
  constructor({ id, capacity = 40, bounds = { x: [-9, 9], z: [-4, 8] }, broadcast = () => {}, clock = Date.now }) {
    this.id = id;
    this.capacity = capacity;
    this.bounds = bounds;
    this.broadcast = broadcast;
    this.clock = clock;
    this.members = new Map(); // id -> member state
  }

  humans() { return [...this.members.values()].filter((m) => !m.bot); }

  add(profile, extra = {}) {
    // capacity is for people only: bots are extras and never take a slot
    if (!profile.bot && this.humans().length >= this.capacity) return null;
    const m = {
      id: profile.id, name: profile.name, look: profile.look, equipped: profile.equipped ?? [],
      bot: !!profile.bot, guest: !!profile.guest,
      x: extra.x ?? 0, z: extra.z ?? 4, ry: extra.ry ?? Math.PI, anim: extra.anim ?? 'idle', seat: null, held: '', buzz: 0, mic: false,
      ...(extra.stage ? { stage: extra.stage } : {}), // stage dancers: pinned on the stage by the clients
    };
    this.members.set(m.id, m);
    this.broadcast({ type: 'peer.join', peer: m });
    return m;
  }

  remove(id) {
    const m = this.members.get(id); if (!m) return null;
    this.members.delete(id);
    this.broadcast({ type: 'peer.leave', id });
    return m;
  }

  update(id, patch) {
    const m = this.members.get(id); if (!m) return;
    Object.assign(m, patch);
    this.broadcast({ type: 'peer.update', peer: m });
  }

  move(id, { x, z, ry, anim }) {
    const m = this.members.get(id); if (!m) return;
    const clamp = (v, [a, b]) => Math.max(a, Math.min(b, Number(v) || 0));
    m.x = clamp(x, this.bounds.x); m.z = clamp(z, this.bounds.z);
    m.ry = Number(ry) || 0; m.anim = ['idle', 'walk', 'dance', 'sit', 'wave'].includes(anim) ? anim : 'idle';
    if (m.anim !== 'sit') m.seat = null;
    this.broadcast({ type: 'peer.move', id, x: m.x, z: m.z, ry: m.ry, anim: m.anim, seat: m.seat }, id);
  }

  chat(id, text) {
    const m = this.members.get(id); text = String(text ?? '').trim().slice(0, 200);
    if (!m || !text) return false;
    this.broadcast({ type: 'chat', id, name: m.name, text, at: this.clock() });
    return true;
  }

  emote(id, kind) {
    if (!this.members.has(id) || !['wave', 'dance', 'clap', 'bow'].includes(kind)) return false;
    this.broadcast({ type: 'emote', id, kind });
    return true;
  }

  snapshotMembers() { return [...this.members.values()]; }
}
