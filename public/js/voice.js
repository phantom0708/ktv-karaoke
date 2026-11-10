// Microphone with Web Audio effects, shared to every room member over WebRTC. Two transports:
//  - 'sfu' (server has Cloudflare Realtime keys): one RTCPeerConnection to Cloudflare; the mic is published once
//    and everyone else's mic is pulled from there, so a singer uploads one stream however big the room is.
//    SDP goes through the KTV server ('sfu' messages), which holds the app secret.
//  - 'mesh' (fallback): each pair of members holds one RTCPeerConnection with one sendrecv audio transceiver.
// Either way turning the mic on/off is just sender.replaceTrack() — no renegotiation.
let ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
export const setIceServers = (list) => { if (Array.isArray(list) && list.length) ICE = list; };
let MODE = 'mesh';
// Opus defaults to ~32 kbps speech quality; singing over music needs more. Raising maxaveragebitrate in the
// remote description makes our encoder use up to 128 kbps; DTX off so held notes are never cut.
export const hifi = (sdp) => sdp.replace(/a=fmtp:(\d+) ([^\r\n]*)/g, (line, pt, params) =>
  (new RegExp(`a=rtpmap:${pt} opus/`, 'i').test(sdp) && !/maxaveragebitrate/.test(params) ? `a=fmtp:${pt} ${params};maxaveragebitrate=128000;usedtx=0` : line));
const remote = (type, sdp) => ({ type, sdp: hifi(sdp) });
const FX_KEY = 'ktv.fx';
export const setVoiceMode = (m) => { MODE = m === 'sfu' ? 'sfu' : 'mesh'; };

// a mic failure with a code the UI can explain: insecure | denied | nodevice | busy | unknown
export class MicError extends Error { constructor(code, detail) { super(detail || code); this.code = code; } }

export const PRESETS = {
  off: { echo: 0, repeat: 0, reverb: 0, bass: 0, mid: 0, treble: 0 },
  karaoke: { echo: 0.45, repeat: 0.5, delay: 220, reverb: 0.3, bass: 0, mid: 0, treble: 2 },
  hall: { echo: 0.25, repeat: 0.35, delay: 320, reverb: 0.7, bass: 2, mid: -1, treble: 1 },
  studio: { echo: 0.08, repeat: 0.2, delay: 120, reverb: 0.15, bass: 1, mid: 1, treble: 3 },
};

export class Voice {
  constructor(net) {
    this.net = net;
    this.myId = null;
    this.peers = new Map(); // id -> mesh: { pc, sender, audio, pending: [] } | sfu: { mid, audio }
    this.sfu = null; // { pc, sender, byMid, ready, live }
    this.chain = Promise.resolve(); this.rid = 0; this.waiting = new Map();
    this.track = null;
    this.fx = { gain: 1, bass: 0, mid: 0, treble: 2, echo: 0.45, repeat: 0.5, delay: 220, reverb: 0.3, monitor: false, noise: false, voiceVolume: 1, monitorVolume: 1, micId: '' };
    try { Object.assign(this.fx, JSON.parse(localStorage.getItem(FX_KEY) || '{}')); } catch {} // settings survive a reload
    this.nodes = null;
  }

  // ---- mesh membership ----
  setRoom(myId, peerIds) {
    this.myId = myId;
    if (MODE === 'sfu') return this.#sfuStart();
    for (const id of [...this.peers.keys()]) if (!peerIds.includes(id)) this.removePeer(id);
    for (const id of peerIds) this.addPeer(id);
  }

  addPeer(id) {
    if (MODE === 'sfu' || id === this.myId || this.peers.has(id)) return; // sfu: pulled when their mic goes live
    if (this.myId < id) this.#create(id, true); // lower id makes the offer; the other side waits
  }

  removePeer(id) {
    const p = this.peers.get(id); if (!p) return;
    p.pc?.close(); p.audio?.remove(); this.peers.delete(id);
    if (p.mid != null && this.sfu) this.#sfuClose(this.sfu, p.mid);
  }

  leaveRoom() { this.#sfuStop(); for (const id of [...this.peers.keys()]) this.removePeer(id); this.micOff(); }

  // ---- Cloudflare SFU ----
  onSfuReply(m) { const w = this.waiting.get(m.rid); if (w) { this.waiting.delete(m.rid); clearTimeout(w.timer); w.done(m); } }
  onSfuTrack(id) { const s = this.sfu; if (s && id !== this.myId) this.#queue(s, () => this.#sfuPull(s, [id])); }
  onSfuUntrack(id) { if (this.sfu && this.peers.get(id)?.mid != null) this.removePeer(id); } // their mic went off

  #req(op, data = {}) {
    const rid = ++this.rid;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(rid); reject(new Error(`sfu ${op} timeout`)); }, 25000);
      this.waiting.set(rid, { timer, done: (m) => (m.ok ? resolve(m) : reject(new Error(`sfu ${op}: ${m.error}`))) });
      this.net.send({ type: 'sfu', op, rid, ...data });
    });
  }

  // Cloudflare accepts one SDP exchange at a time per session: every step goes through this queue
  // a step that never settles (seen on iPhones) must not block every later step: give up after 45 s and reconnect
  #queue(s, fn) {
    const step = () => {
      if (s !== this.sfu) return null;
      let timer; const limit = new Promise((_, no) => { timer = setTimeout(() => no(new Error('step timeout')), 45000); });
      return Promise.race([fn(), limit]).finally(() => clearTimeout(timer));
    };
    this.chain = this.chain.then(step).catch((e) => {
      console.warn('voice', e); this.report('error', { msg: String(e?.message ?? e).slice(0, 160), pc: s.pc.connectionState, ice: s.pc.iceConnectionState, sig: s.pc.signalingState });
      if (s === this.sfu && (/timeout/.test(e?.message) || !s.ready)) { // stuck step, or the join itself failed: fresh session after a pause
        this.retries = (this.retries ?? 0) + 1; const wait = Math.min(30000, 2000 * this.retries);
        setTimeout(() => { if (s === this.sfu) this.#sfuStart(); }, wait);
      }
    });
    return this.chain;
  }

  #sfuStop() {
    const s = this.sfu; if (!s) return; this.sfu = null; s.pc.close();
    for (const [id, p] of [...this.peers]) if (p.mid != null) { p.audio?.remove(); this.peers.delete(id); }
  }

  #sfuStart() {
    this.#sfuStop();
    const pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: 'max-bundle' });
    const s = { pc, sender: null, pubMid: null, byMid: new Map(), ready: false };
    this.sfu = s;
    pc.ontrack = (e) => { const id = s.byMid.get(e.transceiver.mid); if (id) this.#play(id, e.track); };
    this.#queue(s, async () => {
      // silent placeholder: keeps the connection (and so the Cloudflare session) up while nobody speaks
      const hold = pc.addTransceiver('audio', { direction: 'sendonly' });
      await pc.setLocalDescription(await pc.createOffer());
      const r = await this.#req('join', { sdp: pc.localDescription.sdp, mid: hold.mid });
      if (s !== this.sfu) return;
      await pc.setRemoteDescription(remote('answer', r.sdp));
      s.ready = true; this.retries = 0; this.report('joined', { live: r.live?.length ?? 0, sig: pc.signalingState });
      if (this.track) await this.#sfuPublish(s);
      if (r.live?.length) await this.#sfuPull(s, r.live);
    });
  }

  // mic on: publish a new track (Cloudflare drops tracks that stay silent, so it only exists while the mic is on),
  // then tell the room once packets are flowing — Cloudflare refuses to hand out a track before that
  async #sfuPublish(s) {
    if (!s.ready || !this.track) return;
    if (s.sender) return s.sender.replaceTrack(this.track); // mic re-opened before the old track was closed
    this.report('publishStart', { pc: s.pc.connectionState, sig: s.pc.signalingState });
    const tr = s.pc.addTransceiver(this.track, { direction: 'sendonly' });
    await s.pc.setLocalDescription(await s.pc.createOffer());
    const r = await this.#req('publish', { sdp: s.pc.localDescription.sdp, mid: tr.mid });
    if (s !== this.sfu) return;
    await s.pc.setRemoteDescription(remote('answer', r.sdp));
    s.sender = tr.sender; s.pubMid = tr.mid;
    if (!this.track) return this.#sfuUnpublish(s); // turned off meanwhile
    if (tr.sender.track !== this.track) await tr.sender.replaceTrack(this.track);
    let sent = 0;
    for (let i = 0; i < 60 && s === this.sfu && this.track; i++) { // up to 15 s
      sent = 0; (await tr.sender.getStats()).forEach((x) => { if (x.type === 'outbound-rtp') sent += x.packetsSent; });
      if (sent > 0) break;
      await new Promise((ok) => setTimeout(ok, 250));
    }
    this.report('publish', { packets: sent, pc: s.pc.connectionState, ice: s.pc.iceConnectionState });
    if (s === this.sfu && this.track) await this.#req('live');
  }

  async #sfuUnpublish(s) {
    if (!s.sender || this.track) return; // nothing published, or the mic is already back on
    const mid = s.pubMid; const tr = s.pc.getTransceivers().find((x) => x.mid === mid);
    s.sender = null; s.pubMid = null;
    tr?.stop();
    await s.pc.setLocalDescription(await s.pc.createOffer());
    const r = await this.#req('unpublish', { mid, sdp: s.pc.localDescription.sdp });
    if (s === this.sfu && r.sdp) await s.pc.setRemoteDescription(remote('answer', r.sdp));
  }

  async #sfuPull(s, ids, attempt = 0) {
    const want = ids.filter((id) => id !== this.myId && !this.peers.has(id));
    if (!want.length || !s.ready) return;
    const r = await this.#req('pull', { ids: want });
    if (s !== this.sfu) return;
    if (r.retry?.length && attempt < 10) setTimeout(() => this.#queue(s, () => this.#sfuPull(s, r.retry, attempt + 1)), 2000);
    if (r.retry?.length && attempt === 10) this.report('pullGaveUp', { ids: r.retry.length });
    for (const t of r.tracks ?? []) { s.byMid.set(t.mid, t.id); this.peers.set(t.id, { mid: t.mid, audio: null }); }
    this.report('pulled', { tracks: r.tracks?.length ?? 0, retry: r.retry?.length ?? 0 });
    if (r.sdp) {
      await s.pc.setRemoteDescription(remote('offer', r.sdp));
      await s.pc.setLocalDescription(await s.pc.createAnswer());
      await this.#req('answer', { sdp: s.pc.localDescription.sdp });
    }
  }

  #sfuClose(s, mid) {
    this.#queue(s, async () => {
      s.byMid.delete(mid);
      const tr = s.pc.getTransceivers().find((x) => x.mid === mid); if (!tr) return;
      tr.stop();
      await s.pc.setLocalDescription(await s.pc.createOffer());
      const r = await this.#req('close', { mids: [mid], sdp: s.pc.localDescription.sdp });
      if (s === this.sfu && r.sdp) await s.pc.setRemoteDescription(remote('answer', r.sdp));
    });
  }

  #play(id, track) {
    const entry = this.peers.get(id); if (!entry) return;
    if (!entry.audio) { entry.audio = document.createElement('audio'); entry.audio.autoplay = true; document.body.appendChild(entry.audio); }
    entry.audio.srcObject = new MediaStream([track]); entry.audio.volume = this.fx.voiceVolume;
    entry.audio.play().then(() => this.report('playing')).catch((e) => { this.report('autoplayBlocked', { msg: e?.name }); this.onAutoplayBlocked?.(); });
  }

  #create(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const entry = { pc, sender: null, audio: null, pending: [] };
    this.peers.set(id, entry);
    pc.onicecandidate = (e) => { if (e.candidate) this.net.send({ type: 'rtc', to: id, data: { candidate: e.candidate } }); };
    pc.ontrack = (e) => {
      if (!entry.audio) { entry.audio = document.createElement('audio'); entry.audio.autoplay = true; document.body.appendChild(entry.audio); }
      entry.audio.srcObject = e.streams[0] || new MediaStream([e.track]); entry.audio.volume = this.fx.voiceVolume;
      entry.audio.play().catch(() => this.onAutoplayBlocked?.());
    };
    if (initiator) {
      const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
      entry.sender = tr.sender;
      if (this.track) entry.sender.replaceTrack(this.track);
      pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => this.net.send({ type: 'rtc', to: id, data: { sdp: pc.localDescription } }));
    }
    return entry;
  }

  async onSignal(from, data) {
    let entry = this.peers.get(from);
    if (data.sdp?.type === 'offer') {
      if (entry) this.removePeer(from);
      entry = this.#create(from, false);
      await entry.pc.setRemoteDescription(remote('offer', data.sdp.sdp));
      const tr = entry.pc.getTransceivers()[0];
      tr.direction = 'sendrecv'; entry.sender = tr.sender;
      if (this.track) await entry.sender.replaceTrack(this.track);
      await entry.pc.setLocalDescription(await entry.pc.createAnswer());
      this.net.send({ type: 'rtc', to: from, data: { sdp: entry.pc.localDescription } });
      for (const c of entry.pending.splice(0)) await entry.pc.addIceCandidate(c).catch(() => {});
    } else if (data.sdp?.type === 'answer' && entry) {
      await entry.pc.setRemoteDescription(remote('answer', data.sdp.sdp));
      for (const c of entry.pending.splice(0)) await entry.pc.addIceCandidate(c).catch(() => {});
    } else if (data.candidate && entry) {
      if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(data.candidate).catch(() => {});
      else entry.pending.push(data.candidate);
    }
  }

  // ---- microphone + effects ----
  // browsers block playing other people's voices until the user interacts; call this from a click
  // the AudioContext is created HERE, inside the tap: phones (iOS Safari especially) keep a context made later,
  // after awaiting the mic permission, suspended — the mic then "works" but sends silence
  resumeAudio() {
    try { this.ctx ??= new AudioContext(); this.ctx.resume().catch(() => {}); } catch {}
    for (const p of this.peers.values()) p.audio?.play().catch(() => {});
  }

  // short diagnostics sent to the server log (what a real phone did), never more than one every 2 s
  report(event, extra = {}) {
    this.lastReport ??= {}; const now = Date.now(); if (now - (this.lastReport[event] ?? 0) < 2000) return; this.lastReport[event] = now;
    this.net.send({ type: 'voice.log', event, mode: MODE, ctx: this.ctx?.state, ua: navigator.userAgent.slice(0, 120), ...extra });
  }

  async micOn() {
    // the microphone API only exists on https:// pages or http://localhost
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new MicError('insecure');
    let raw;
    // with headphones there is no speaker echo to cancel: turning AEC off keeps the singing voice natural
    // (AEC also chops a voice that sings over music coming out of the speakers)
    const audio = { echoCancellation: !this.fx.monitor, noiseSuppression: this.fx.noise, autoGainControl: false, channelCount: 1 };
    try {
      try { raw = await navigator.mediaDevices.getUserMedia({ audio: this.fx.micId ? { ...audio, deviceId: { exact: this.fx.micId } } : audio }); }
      catch (e) { if (!this.fx.micId || !['OverconstrainedError', 'NotFoundError'].includes(e.name)) throw e; raw = await navigator.mediaDevices.getUserMedia({ audio }); } // chosen mic unplugged
    } catch (e) {
      const code = { NotAllowedError: 'denied', SecurityError: 'denied', NotFoundError: 'nodevice', OverconstrainedError: 'nodevice', NotReadableError: 'busy', AbortError: 'busy' }[e.name] ?? 'unknown';
      throw new MicError(code, e.message);
    }
    this.raw = raw;
    const ctx = this.ctx ?? (this.ctx = new AudioContext());
    // resume() can stay pending forever without a tap on some phones: never let it block the mic
    await Promise.race([ctx.resume().catch(() => {}), new Promise((ok) => setTimeout(ok, 1500))]);
    const src = ctx.createMediaStreamSource(raw);
    const hp = Object.assign(ctx.createBiquadFilter(), { type: 'highpass' }); hp.frequency.value = 80;
    const bass = Object.assign(ctx.createBiquadFilter(), { type: 'lowshelf' }); bass.frequency.value = 200;
    const mid = Object.assign(ctx.createBiquadFilter(), { type: 'peaking' }); mid.frequency.value = 1000; mid.Q.value = 0.9;
    const treble = Object.assign(ctx.createBiquadFilter(), { type: 'highshelf' }); treble.frequency.value = 4000;
    const gain = ctx.createGain();
    // vocal compressor: a raw mic sits ~15 dB under a YouTube track, so the voice drowned in the music.
    // DynamicsCompressorNode adds its own make-up gain (≈ +13 dB with these settings), so no extra gain is needed.
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -30; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    const makeup = ctx.createGain(); makeup.gain.value = 1;
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1; // keeps echo build-up from clipping
    const delay = ctx.createDelay(1.0); const feedback = ctx.createGain(); const echoWet = ctx.createGain();
    const convolver = ctx.createConvolver(); convolver.buffer = impulse(ctx, 2.4); const reverbWet = ctx.createGain();
    const out = ctx.createMediaStreamDestination(); const monitor = ctx.createGain();
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    src.connect(hp).connect(bass).connect(mid).connect(treble).connect(gain).connect(comp).connect(makeup);
    // an analyser is only processed when it is pulled by the destination: feed it into a silent sink
    const sink = ctx.createGain(); sink.gain.value = 0; makeup.connect(analyser).connect(sink).connect(ctx.destination);
    const sum = ctx.createGain(); // dry + echo + reverb, limited: what others hear and what the headphones play
    makeup.connect(sum);
    makeup.connect(delay); delay.connect(feedback).connect(delay); delay.connect(echoWet).connect(sum);
    makeup.connect(convolver).connect(reverbWet).connect(sum);
    sum.connect(lim); lim.connect(out); lim.connect(monitor).connect(ctx.destination);
    if (this.busVoice) lim.connect(this.busVoice); // recorder bus (recorder.js) keeps one stream across mic on/off
    this.nodes = { src, hp, bass, mid, treble, gain, comp, makeup, lim, delay, feedback, echoWet, reverbWet, monitor, convolver, sum, analyser, sink, buf: new Float32Array(analyser.fftSize) };
    this.#applyFx();
    this.track = out.stream.getAudioTracks()[0];
    this.track.contentHint = 'music'; // encoder keeps the full band instead of speech tuning
    for (const p of this.peers.values()) p.sender?.replaceTrack(this.track);
    const s = this.sfu;
    if (s) this.#queue(s, () => this.#sfuPublish(s));
  }

  micOff() {
    for (const p of this.peers.values()) p.sender?.replaceTrack(null);
    const s = this.sfu; if (s) { s.sender?.replaceTrack(null); this.#queue(s, () => this.#sfuUnpublish(s)); }
    this.raw?.getTracks().forEach((t) => t.stop());
    if (this.nodes) for (const k of ['src', 'hp', 'bass', 'mid', 'treble', 'gain', 'comp', 'makeup', 'lim', 'delay', 'feedback', 'echoWet', 'reverbWet', 'convolver', 'sum', 'monitor', 'analyser', 'sink']) this.nodes[k].disconnect();
    this.raw = null; this.track = null; this.nodes = null;
  }

  get micActive() { return !!this.track; }

  // ---- recordings: one persistent "bus" the recorder listens to ----
  // voice (after effects) → busVoice → bus;  tab audio (YouTube + everyone's voices, captured with permission) → bus.
  // Our headphone monitor is part of the tab audio, so while tab audio is mixed in and the monitor is on, the direct
  // voice is muted (it would be doubled / echo); the "hear myself" volume then balances voice vs music.
  #bus() {
    try { this.ctx ??= new AudioContext(); } catch { return null; }
    if (!this.busDest) {
      this.busDest = this.ctx.createMediaStreamDestination(); this.busVoice = this.ctx.createGain(); this.busVoice.connect(this.busDest);
      this.nodes?.lim.connect(this.busVoice);
    }
    return this.busDest;
  }
  // the stream to record: survives turning the mic off and on (silence while off)
  recordStream() { return this.#bus()?.stream ?? null; }

  get tabActive() { return !!this.tab?.getAudioTracks().some((t) => t.readyState === 'live'); }
  // Chrome/Edge/Opera on desktop only: share this tab's audio
  async startTabCapture() {
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'exclude',
    });
    if (!s.getAudioTracks().length) { s.getTracks().forEach((t) => t.stop()); throw new MicError('noTabAudio'); } // "share tab audio" was not ticked
    s.getVideoTracks().forEach((t) => { t.enabled = false; }); // only the sound is used
    this.stopTabCapture(); this.tab = s;
    const bus = this.#bus(); await this.ctx.resume().catch(() => {});
    this.tabSrc = this.ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())); this.tabSrc.connect(bus);
    this.#applyMix(); this.onTabChange?.(true);
    s.getAudioTracks()[0].addEventListener('ended', () => this.stopTabCapture()); // "Stop sharing" in Chrome's bar
    return s;
  }
  stopTabCapture() {
    const was = !!this.tab;
    this.tab?.getTracks().forEach((t) => t.stop()); this.tab = null;
    try { this.tabSrc?.disconnect(); } catch {} this.tabSrc = null;
    this.#applyMix(); if (was) this.onTabChange?.(false);
  }
  #applyMix() { if (this.busVoice && this.ctx) this.busVoice.gain.setTargetAtTime(this.tab && this.fx.monitor ? 0 : 1, this.ctx.currentTime, 0.02); }


  // current input level 0..1 (RMS after the mic volume), for the on-screen meter
  level() {
    const n = this.nodes; if (!n) return 0;
    n.analyser.getFloatTimeDomainData(n.buf); let sum = 0;
    for (const v of n.buf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / n.buf.length) * 2.5);
  }

  setFx(key, value) {
    this.fx[key] = value;
    if (key === 'voiceVolume') for (const p of this.peers.values()) if (p.audio) p.audio.volume = value;
    this.#save(); this.#applyFx(); this.#applyMix();
  }
  applyPreset(name) { Object.assign(this.fx, PRESETS[name]); this.#save(); this.#applyFx(); return this.fx; }
  #save() { try { localStorage.setItem(FX_KEY, JSON.stringify(this.fx)); } catch {} }

  // microphones to choose from (names show once mic permission was given)
  async mics() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'); } catch { return []; }
  }

  #applyFx() {
    const n = this.nodes; if (!n || !this.ctx) return;
    const f = this.fx; const t = this.ctx.currentTime;
    n.gain.gain.setTargetAtTime(f.gain, t, 0.02);
    n.bass.gain.setTargetAtTime(f.bass, t, 0.02);
    n.mid.gain.setTargetAtTime(f.mid, t, 0.02);
    n.treble.gain.setTargetAtTime(f.treble, t, 0.02);
    n.delay.delayTime.setTargetAtTime(f.delay / 1000, t, 0.02);
    n.feedback.gain.setTargetAtTime(Math.min(0.85, f.repeat), t, 0.02);
    n.echoWet.gain.setTargetAtTime(f.echo, t, 0.02);
    n.reverbWet.gain.setTargetAtTime(f.reverb, t, 0.02);
    n.monitor.gain.setTargetAtTime(f.monitor ? f.monitorVolume ?? 1 : 0, t, 0.02);
  }
}

function impulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds); const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}
