// Records your own singing (the processed voice: EQ, echo, reverb — exactly what others hear) for each song you sing,
// so you can listen again or download it afterwards. The YouTube music is not in the file: browsers do not let a page
// capture another site's video audio. Recordings live in memory (last 5) — download to keep them.
const KEEP = 5;
const MIN_SEC = 5;

function pickType() {
  const R = window.MediaRecorder; if (!R) return null;
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']) if (R.isTypeSupported?.(t)) return t;
  return '';
}
export const canRecord = () => pickType() !== null;
// tab-audio capture (to record the YouTube music too): Chromium browsers on desktop only
export function canTabRecord() {
  const ua = navigator.userAgent; const d = navigator.userAgentData;
  const mobile = d ? d.mobile : /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const chromium = d ? d.brands.some((b) => /Chromium|Google Chrome|Microsoft Edge|Opera/i.test(b.brand)) : /Chrome\/|Edg\//.test(ua) && !/Firefox|FxiOS|OPR\/Mini/.test(ua);
  return !!navigator.mediaDevices?.getDisplayMedia && chromium && !mobile && canRecord() && typeof AudioContext !== 'undefined';
}

export class SongRecorder {
  constructor(voice) { this.voice = voice; this.rec = null; this.list = []; this.onSaved = () => {}; }

  // call whenever the song, the singers or the mic change
  sync(song, amSinger, micActive) {
    if (this.rec && (!song || song.id !== this.rec.songId || !amSinger)) this.stop();
    if (!this.rec && song && amSinger && micActive && canRecord()) this.start(song);
  }

  start(song) {
    const stream = this.voice.recordStream(); if (!stream) return; const music = this.voice.tabActive;
    const type = pickType();
    let mr; try { mr = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 128000 }); } catch { return; }
    const chunks = []; const rec = { songId: song.id, title: song.title || 'KTV', music: !!music, mr, chunks, startedAt: Date.now(), type: mr.mimeType || type || 'audio/webm' };
    mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    mr.onstop = () => this.#finish(rec);
    mr.start(1000); this.rec = rec;
  }

  musicOn() { if (this.rec) this.rec.music = true; } // tab audio joined mid-song

  stop() { const r = this.rec; this.rec = null; if (r && r.mr.state !== 'inactive') r.mr.stop(); }

  #finish(r) {
    const sec = (Date.now() - r.startedAt) / 1000;
    if (sec < MIN_SEC || !r.chunks.length) return;
    const blob = new Blob(r.chunks, { type: r.type.split(';')[0] });
    const ext = /mp4/.test(r.type) ? 'm4a' : /ogg/.test(r.type) ? 'ogg' : 'webm';
    const d = new Date(r.startedAt); const pad = (n) => String(n).padStart(2, '0');
    const safe = r.title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'KTV';
    const item = { id: `${r.songId}-${r.startedAt}`, title: r.title, music: r.music, sec: Math.round(sec), at: r.startedAt, url: URL.createObjectURL(blob), size: blob.size,
      file: `KTV - ${safe}${r.music ? ' (kèm nhạc)' : ''} - ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}` };
    this.list.unshift(item);
    for (const old of this.list.splice(KEEP)) URL.revokeObjectURL(old.url);
    this.onSaved(item);
  }
}

// a click-to-download that works on desktop and phones
export function download(item) {
  const a = document.createElement('a'); a.href = item.url; a.download = item.file; document.body.appendChild(a); a.click(); a.remove();
}
