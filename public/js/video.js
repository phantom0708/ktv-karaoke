// YouTube IFrame player kept in sync with the room's server-side playback clock.
const apiReady = new Promise((resolve) => {
  if (window.YT?.Player) resolve();
  else window.onYouTubeIframeAPIReady = resolve;
});

export class VideoSync {
  constructor(elementId, net, { onDuration, onEnded, onNeedsGesture, onIdle }) {
    this.net = net;
    this.cb = { onDuration, onEnded, onNeedsGesture, onIdle };
    this.pb = null;
    this.loadedId = null;
    this.reportedFor = null;
    this.startTimer = null;
    this.ready = apiReady.then(() => new Promise((resolve) => {
      this.player = new YT.Player(elementId, {
        width: '100%', height: '100%',
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, origin: location.origin },
        events: { onReady: () => resolve(), onStateChange: (e) => this.#onState(e.data) },
      });
    }));
    setInterval(() => this.#correctDrift(), 3000);
  }

  // seconds into the song according to the server clock (negative = not started yet)
  expected() {
    const pb = this.pb; if (!pb?.song) return 0;
    const ref = pb.pausedAt ?? this.net.serverNow();
    return (ref - pb.startedAt) / 1000;
  }

  progress() {
    const d = this.pb?.song?.duration || this.player?.getDuration?.() || 0;
    return d ? Math.min(1, Math.max(0, this.expected() / d)) : 0;
  }

  async apply(pb) {
    this.pb = pb;
    await this.ready;
    clearTimeout(this.startTimer);
    if (!pb.song) { this.loadedId = null; this.player.stopVideo(); this.cb.onIdle?.(true); return; }
    this.cb.onIdle?.(false);
    const exp = this.expected();
    if (this.loadedId !== pb.song.id) {
      this.loadedId = pb.song.id;
      if (exp < 0) {
        this.player.cueVideoById({ videoId: pb.song.videoId, startSeconds: 0 });
        this.startTimer = setTimeout(() => this.apply(this.pb), -exp * 1000);
        return;
      }
      this.player.loadVideoById({ videoId: pb.song.videoId, startSeconds: exp });
    } else if (exp >= 0) {
      this.player.seekTo(exp, true);
    } else {
      this.startTimer = setTimeout(() => this.apply(this.pb), -exp * 1000);
      return;
    }
    if (pb.pausedAt) this.player.pauseVideo();
    else {
      this.player.playVideo();
      setTimeout(() => { // browsers may block autoplay with sound until the user interacts
        const st = this.player.getPlayerState();
        if (this.pb === pb && !pb.pausedAt && st !== YT.PlayerState.PLAYING && st !== YT.PlayerState.BUFFERING) this.cb.onNeedsGesture?.();
      }, 2500);
    }
  }

  userPlay() { this.player?.unMute(); this.apply(this.pb); }

  setVolume(v) { this.volume = v; this.ready.then(() => this.player.setVolume(Math.round(v * 100))); }

  #onState(state) {
    const song = this.pb?.song; if (!song) return;
    if (state === YT.PlayerState.PLAYING && this.reportedFor !== song.id) {
      const d = this.player.getDuration();
      if (d > 0) { this.reportedFor = song.id; this.cb.onDuration?.(song.id, d); }
    }
    if (state === YT.PlayerState.ENDED) this.cb.onEnded?.(song.id);
  }

  #correctDrift() {
    const pb = this.pb; if (!pb?.song || !this.player?.getCurrentTime || this.loadedId !== pb.song.id) return;
    const exp = this.expected(); if (exp < 0) return;
    const st = this.player.getPlayerState();
    if (pb.pausedAt) { if (st === YT.PlayerState.PLAYING) this.player.pauseVideo(); return; }
    if (st === YT.PlayerState.PLAYING && Math.abs(this.player.getCurrentTime() - exp) > 1.5) this.player.seekTo(exp, true);
  }
}
