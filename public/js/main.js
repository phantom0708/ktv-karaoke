import { Net } from './net.js';
import { Engine } from './three/engine.js';
import { LobbyWorld, RoomWorld } from './three/worlds.js';
import { Creator } from './creator.js';
import { VideoSync } from './video.js';
import { Voice, PRESETS, setIceServers, setVoiceMode } from './voice.js';
import { attachJoystick } from './joystick.js';
import { SongRecorder, download, canRecord, canTabRecord } from './recorder.js';
import { t, setLang, getLang, itemName } from './i18n.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = { get: (k) => { try { return localStorage.getItem(`vibemic.${k}`); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(`vibemic.${k}`) : localStorage.setItem(`vibemic.${k}`, v); } catch {} } };
const ICON = {
  'tag-peach': '🍑', 'tag-mint': '🌿', 'tag-sky': '☁️', 'tag-neon': '💡', 'tag-gold': '🥇', 'tag-prism': '🌈',
  'outfit-sport': '🏃', 'outfit-suit': '🤵', 'outfit-aodai': '👘', 'outfit-idol': '🌟', 'outfit-gown': '👗', 'head-bow': '🎀', 'head-bunny': '🐰', 'head-cowboy': '🤠', 'head-crown': '👑', 'head-halo': '😇',
  'face-heart': '😍', 'face-starglass': '🤩', 'face-mask': '🎭', 'back-balloons': '🎈', 'back-cape': '🦸', 'back-devil': '😈',
  'head-beanie': '🧶', 'head-cap': '🧢', 'head-flower': '🌸', 'head-headset': '🎧', 'head-fox': '🦊', 'head-witch': '🧙', 'head-tiara': '👑', 'head-star': '⭐',
  'back-guitar': '🎸', 'back-bag': '🎒', 'back-wings': '🪽', 'back-jetpack': '🚀', 'aura-notes': '🎶', 'aura-petals': '🌺', 'aura-sparks': '✨', 'aura-galaxy': '🌌',
  'pet-duck': '🐥', 'pet-cat': '🐱', 'pet-robot': '🤖', 'pet-dragon': '🐲', 'mic-rose': '🎤', 'mic-gold': '🎙️', 'mic-crystal': '💎',
  'entrance-confetti': '🎊', 'entrance-smoke': '💨', 'entrance-spotlight': '🔦', 'entrance-rainbow': '🌈', 'entrance-meteor': '☄️',
};
const GENRE_Q = { hot: 'karaoke hot nhất', vpop: 'karaoke nhạc việt', bolero: 'karaoke bolero', young: 'karaoke nhạc trẻ', ballad: 'karaoke ballad', chinese: 'karaoke nhạc hoa lời việt', kpop: 'karaoke kpop', usuk: 'karaoke english songs', kids: 'karaoke thiếu nhi' };

const net = new Net();
const voice = new Voice(net);
const S = { me: null, shop: [], slots: [], prices: {}, earn: {}, searchEnabled: false, mode: null, rooms: [], room: null, selfId: null,
  peers: new Map(), hostId: null, queue: [], playback: null, stock: {}, effects: {}, seats: [], creatorMode: 'guest', recTab: 'rooms', shopSlot: 'all',
  kiosk: { genre: null, tone: '', q: '', next: null, items: [] }, pendingConfirm: null };

let engine = null; let video = null; let creator = null;

// ======================================================= helpers
function show(id) { document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id)); }
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-action=lang]').forEach((el) => { el.textContent = t('language'); });
  $('#chat-input').placeholder = t('chatPlaceholder'); $('#kiosk-input').placeholder = t('kioskPlaceholder');
  $('#video-idle').textContent = t('nothingPlaying');
}
function toast(text, kind = '') { const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = text; $('#toasts').appendChild(el); setTimeout(() => el.remove(), kind.includes('sticky-long') ? 10000 : 4000); }
function chatLine(html, sys) { const li = document.createElement('li'); if (sys) li.className = 'sys'; li.innerHTML = html; const log = $('#chat-log'); log.appendChild(li); while (log.children.length > 80) log.firstChild.remove(); log.scrollTop = log.scrollHeight; }
function renderAdmin() {
  $('#btn-admin').classList.toggle('hidden', !S.me?.isAdmin);
  const v = S.proomAdmin ?? { pending: [], rooms: [] };
  $('#btn-admin').dataset.count = String(v.pending.length);
  $('#admin-rooms').innerHTML = `<h4 class="sec-title">${t('adminRooms')}</h4>${v.pending.length ? v.pending.map((q) => `<div class="admin-req"><span>${t('adminReq', { owner: esc(q.ownerName), user: esc(q.username ?? ''), name: esc(q.name), cap: q.capacity })}</span>${q.blurb ? `<span class="muted">${esc(q.blurb)}</span>` : ''}
    <div class="row"><button class="btn sm primary" data-rv="${q.id}" data-ok="1">${t('adminApprove')}</button><button class="btn sm" data-rv="${q.id}" data-ok="0">${t('adminReject')}</button></div></div>`).join('') : `<p class="hint">${t('adminNoPending')}</p>`}
    <h4 class="sec-title">${t('adminRoomsList')}</h4>${v.rooms.length ? v.rooms.map((r) => `<div class="admin-req"><div class="row"><b>🔒 ${esc(r.name)}</b><span class="muted">${t('proomOwner', { name: esc(r.ownerName) })} · ${r.capacity} 👥</span><span class="proom-code">${esc(r.code)}</span><span style="flex:1"></span><button class="btn sm" data-pdel="${r.id}" data-pname="${esc(r.name)}">${t('proomDelete')}</button></div></div>`).join('') : `<p class="hint">${t('proomNone')}</p>`}`;
}
function setCoins() { $('#coins').textContent = S.me?.guest ? '🪙 —' : `🪙 ${S.me?.coins ?? 0}`; }
function err(code) { toast(t(`errors.${code}`) || code, 'err'); }
const peerName = (id) => S.peers.get(id)?.name ?? '…';
const isSinger = () => !!S.playback?.song?.singers.includes(S.selfId);
// ---- my recordings: each song I sing is recorded (voice + effects) so I can replay / download it ----
const recorder = new SongRecorder(voice);
const syncRecorder = () => recorder.sync(S.mode === 'room' ? S.playback?.song : null, isSinger(), voice.micActive);
const fmtSec = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
recorder.onSaved = (item) => {
  const el = document.createElement('div'); el.className = 'toast sticky rec-toast';
  el.innerHTML = `<span>🎙️ ${esc(t('recSaved', { title: item.title, len: fmtSec(item.sec) }))}</span><div class="row small-gap"><button class="btn sm" data-rplay="${item.id}">▶️ ${t('recPlay')}</button><button class="btn sm primary" data-rget="${item.id}">⬇️ ${t('recDownload')}</button><button class="btn sm" data-rclose="1">✕</button></div>`;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 20000);
};
// record the music too: share this tab's audio (Chrome / Edge / Opera on desktop only — the button exists only there)
const TAB_REC = canTabRecord();
function renderTabRec() {
  const on = voice.tabActive;
  $('#btn-tabrec').classList.toggle('hidden', !TAB_REC); $('#btn-tabrec').classList.toggle('on', on);
  $('#btn-tabrec').textContent = on ? `🔴 ${t('tabRecOn')}` : `🎵 ${t('tabRecOff')}`;
  $('#tabrec-box').classList.toggle('hidden', !TAB_REC);
  $('#tabrec-box').innerHTML = `<p class="hint">${t('tabRecHelp')}</p><button class="btn sm ${on ? 'on' : 'primary'}" data-action="tabrec">${on ? `🔴 ${t('tabRecStop')}` : `🎵 ${t('tabRecStart')}`}</button>`;
}
voice.onTabChange = (on) => { if (on) recorder.musicOn(); renderTabRec(); toast(t(on ? 'tabRecStarted' : 'tabRecStopped')); };
async function toggleTabRec() {
  if (voice.tabActive) return voice.stopTabCapture();
  try { await voice.startTabCapture(); }
  catch (e) { toast(t(e.code === 'noTabAudio' ? 'tabRecNoAudio' : e.name === 'NotAllowedError' ? 'tabRecCancelled' : 'tabRecFailed'), 'err'); }
}
renderTabRec();

function openRecordings() {
  renderTabRec();
  const list = recorder.list;
  $('#rec-list').innerHTML = !canRecord() ? `<p class="hint err">${t('recUnsupported')}</p>` : list.length ? list.map((r) => `<li class="rec-item"><div><b>${esc(r.title)}</b>${r.music ? ` <span class="pill">🎵 ${t('recWithMusic')}</span>` : ''}<span class="muted"> · ${fmtSec(r.sec)} · ${new Date(r.at).toLocaleTimeString()}</span></div><audio controls preload="metadata" src="${r.url}"></audio><button class="btn sm primary" data-rget="${r.id}">⬇️ ${t('recDownload')}</button>${canShareFile(r) ? `<button class="btn sm" data-rshare="${r.id}">📤 ${t('share')}</button>` : ''}</li>`).join('') : `<p class="muted">${t('recEmpty')}</p>`;
  // Chrome's MediaRecorder webm has no duration: make the player work it out (seek far, then back)
  for (const a of $('#rec-list').querySelectorAll('audio')) a.addEventListener('loadedmetadata', () => { if (a.duration === Infinity) { a.currentTime = 1e101; a.addEventListener('timeupdate', () => { a.currentTime = 0; }, { once: true }); } }, { once: true });
  if (!$('#dlg-recs').open) $('#dlg-recs').showModal();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rget],[data-rplay],[data-rclose]'); if (!b) return;
  const item = recorder.list.find((r) => r.id === (b.dataset.rget ?? b.dataset.rplay));
  if (b.dataset.rclose) return b.closest('.toast')?.remove();
  if (b.dataset.rget && item) download(item);
  if (b.dataset.rplay) { b.closest('.toast')?.remove(); openRecordings(); }
});
function confirmBox(text, yes, no, timeoutSec = 0) {
  return new Promise((resolve) => {
    const d = $('#dlg-confirm'); if (d.open) d.close();
    $('#confirm-text').textContent = text; $('#confirm-no').textContent = no;
    let left = timeoutSec; const label = () => { $('#confirm-yes').textContent = timeoutSec ? `${yes} (${left})` : yes; };
    label(); d.showModal();
    const timer = timeoutSec ? setInterval(() => { left -= 1; label(); if (left <= 0) done(null); }, 1000) : null;
    const done = (v) => { clearInterval(timer); if (d.open) d.close(); S.closeConfirm = null; resolve(v); };
    S.closeConfirm = () => done(null);
    $('#confirm-yes').onclick = () => done(true); $('#confirm-no').onclick = () => done(false);
  });
}

// ======================================================= auth
function showAuth(panel = 'choose') {
  S.mode = 'auth'; show('s-auth');
  for (const p of ['choose', 'login', 'register']) $(`#auth-${p}`).classList.toggle('hidden', p !== panel);
}
document.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => showAuth(b.dataset.goto); });
$('#btn-show-login').onclick = () => showAuth('login');
$('#btn-show-register').onclick = () => showAuth('register');
$('#btn-guest').onclick = () => openCreator('guest');
$('#auth-login').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); S.afterAuth = 'lobby'; net.send({ type: 'auth.login', username: f.get('username'), password: f.get('password') }); };
$('#auth-register').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); S.afterAuth = 'creator'; net.send({ type: 'auth.register', username: f.get('username'), password: f.get('password'), name: f.get('name'), ref: store.get('ref') ?? undefined }); };

// ======================================================= creator
function openCreator(mode) {
  S.creatorMode = mode; S.mode = 'creator'; show('s-creator');
  creator ??= new Creator($('#creator-canvas'), { tabsEl: $('#cr-tabs'), optionsEl: $('#cr-options') });
  $('#cr-name').value = S.me?.name && S.me.name !== 'Khách' ? S.me.name : '';
  $('#cr-save').textContent = mode === 'edit' ? t('saveOnly') : t('save');
  creator.open(S.me?.look ?? {}, S.me?.equipped ?? []);
}
$('#cr-random').onclick = () => creator.random();
$('#cr-reset').onclick = () => creator.reset();
$('#cr-cancel').onclick = () => { if (S.creatorMode === 'edit') returnToGame(); else showAuth(); };
$('#cr-save').onclick = () => {
  const name = $('#cr-name').value.trim() || undefined; const look = creator.look;
  if (S.creatorMode === 'guest') { S.afterAuth = 'lobby'; net.send({ type: 'auth.guest', name, look }); }
  else { net.send({ type: 'profile', name, look }); if (S.creatorMode === 'register') { const room = S.deepRoom; S.deepRoom = null; net.send(room ? { type: 'room.join', room } : { type: 'lobby.enter' }); } else returnToGame(); }
};
function returnToGame() { show('s-game'); S.mode = S.room ? 'room' : 'lobby'; }

// ======================================================= game setup
function ensureEngine() {
  if (engine) return;
  engine = new Engine($('#game-canvas'), $('#labels'), $('#video-wrap'));
  window.__vibemic = { engine }; // read-only handle for performance diagnostics
  let lastQ = engine.quality;
  engine.onQualityChange = () => {
    renderGfx();
    if (engine.gfxMode === 'auto' && engine.quality !== lastQ && LEVEL_RANK[engine.quality] < LEVEL_RANK[lastQ]) toast(t('gfxLowered', { level: t(`gfx.${engine.quality}`) }));
    lastQ = engine.quality;
  };
  renderGfx();
  const fit = () => { const p = $('#room-panel'); engine.rightInset = S.mode === 'room' && innerWidth > 900 && !p.classList.contains('hidden') && !p.classList.contains('collapsed') ? 352 : 0; };
  addEventListener('resize', fit); S.fitInset = fit;
  let last = { t: 0, anim: '', moving: false };
  engine.onLocalMove = ({ x, z, ry, anim, moving }) => {
    const now = performance.now();
    if ((moving && now - last.t > 100) || anim !== last.anim || (!moving && last.moving)) { net.send({ type: 'move', x, z, ry, anim }); last = { t: now, anim, moving }; }
  };
  engine.onPrompt = (it) => {
    const p = $('#prompt'); if (!it) return p.classList.add('hidden');
    const what = { reception: t('receptionHint'), door: t('doorHint', { room: it.room?.name }), kiosk: t('kioskHint'), table: t('tableHint'), staff: t('staffHint'), panel: t('panelHint'), seat: t('seatHint'), exit: t('exitHint') }[it.kind];
    p.innerHTML = `<b>E</b>${esc(what)}`; p.classList.remove('hidden'); p.onclick = () => use(it);
  };
  engine.onUse = use;
  engine.onPeerClick = openPlayerCard;
  renderViewUi();
  video = new VideoSync('yt-player', net, {
    onDuration: (songId, seconds) => net.send({ type: 'player.duration', songId, seconds }),
    onEnded: (songId) => net.send({ type: 'player.ended', songId }),
    onNeedsGesture: () => $('#btn-unmute').classList.remove('hidden'),
    onIdle: (idle) => $('#video-idle').classList.toggle('hidden', !idle),
  });
  $('#btn-unmute').onclick = () => { $('#btn-unmute').classList.add('hidden'); video.userPlay(); voice.resumeAudio(); };
  voice.onAutoplayBlocked = () => $('#btn-unmute').classList.remove('hidden');
}

function use(it) {
  switch (it.kind ?? it.id) {
    case 'reception': return openReception('rooms');
    case 'club': return openReception('club');
    case 'friends': return openReception('friends');
    case 'door': return net.send({ type: 'room.join', room: it.room.id });
    case 'kiosk': return openKiosk();
    case 'table': return openTable();
    case 'staff': return openStaff();
    case 'panel': return openPanel();
    case 'seat': return net.send({ type: 'sit', seat: it.seat });
    case 'exit': return leaveRoom();
    case 'drink': { const held = engine.world?.avatars.get(S.selfId)?.peer.held; if (held) net.send({ type: 'act', kind: 'drink' }); return; }
    case 'cheers': { const held = engine.world?.avatars.get(S.selfId)?.peer.held; if (held) net.send({ type: 'act', kind: 'cheers' }); return; }
  }
}

function enterWorld(world, peers, selfId) {
  ensureEngine(); show('s-game');
  S.selfId = selfId; S.peers = new Map(peers.map((p) => [p.id, p]));
  engine.setWorld(world); engine.setSingers([]);
  for (const p of peers) engine.addPeer(p, p.id === selfId);
  $('#chat-log').innerHTML = '';
  const room = S.mode === 'room';
  document.querySelectorAll('.room-only').forEach((el) => el.classList.toggle('hidden', !room));
  $('#lobby-buttons').classList.toggle('hidden', room); $('#room-buttons').classList.toggle('hidden', !room);
  $('#room-panel').classList.toggle('hidden', !room); $('#held-bar').classList.add('hidden');
  if (room) setPanelCollapsed(store.get('panelCollapsed') !== '0'); // collapsed unless the user opened it
  S.fitInset(); renderHud(); renderViewUi();
}

function renderViewUi() {
  if (!engine) return;
  const hint = $('#controls-hint'); hint.textContent = t('hintControls');
  hint.classList.remove('dim'); clearTimeout(S.hintTimer); S.hintTimer = setTimeout(() => hint.classList.add('dim'), 8000);
}

function micError(er) {
  const url = `https://${location.hostname}:8443`;
  toast(t(`micErrors.${er.code ?? 'unknown'}`, { url, err: er.message }), 'err sticky-long');
}
setInterval(() => { const m = $('#mic-meter'); if (m) m.style.width = voice.micActive ? `${Math.round(voice.level() * 100)}%` : '0'; }, 90);

const LEVEL_RANK = { low: 0, medium: 1, high: 2 };
function renderGfx() {
  if (!engine) return;
  $('#btn-gfx').textContent = engine.gfxMode === 'auto' ? t('gfxAutoNow', { level: t(`gfx.${engine.quality}`) }) : t('gfxLabel', { mode: t(`gfx.${engine.gfxMode}`) });
}

function renderHud() {
  setCoins();
  if (S.mode === 'lobby') { $('#place-name').textContent = 'KTV Lounge'; $('#place-sub').textContent = ''; $('#host-badge').classList.add('hidden'); }
  else if (S.room) {
    $('#place-name').textContent = `${S.room.private ? '🔒 ' : ''}${S.room.name}`; $('#place-sub').textContent = t('inRoom', { n: [...S.peers.values()].filter((p) => !p.bot).length }); // people only, bots not counted
    $('#host-badge').classList.toggle('hidden', S.hostId !== S.selfId);
  }
  $('#mic-label').textContent = voice.micActive ? t('micOff') : t('micOn'); $('#btn-mic').classList.toggle('on', voice.micActive);
  $('#btn-hp').classList.toggle('on', !!voice.fx.monitor); $('#btn-hp').title = voice.fx.monitor ? t('headphonesOn') : t('headphonesOff');
  $('#mic-banner').textContent = t('micBanner');
  $('#mic-banner').classList.toggle('hidden', !(S.mode === 'room' && isSinger() && !voice.micActive));
}

function leaveRoom() {
  recorder.stop(); voice.stopTabCapture(); voice.leaveRoom(); video?.apply({ song: null }); engine?.setCinema(false);
  S.room = null; S.playback = null; S.queue = [];
  net.send({ type: 'lobby.enter' });
}

// ======================================================= room panel
function setPanelCollapsed(on) {
  const p = $('#room-panel'); p.classList.toggle('collapsed', on);
  $('#btn-collapse').textContent = on ? '▸' : '▾'; $('#btn-collapse').setAttribute('aria-expanded', String(!on));
  store.set('panelCollapsed', on ? '1' : '0'); S.fitInset?.(); renderMini();
}
function renderMini() {
  const song = S.playback?.song;
  $('#panel-mini').textContent = `${song ? `🎵 ${song.title}` : t('nothingPlaying')} · ${t('queue', { n: S.queue.length })}`;
}

function renderNowPlaying() {
  const pb = S.playback; const song = pb?.song;
  engine?.setSingers(song?.singers ?? []); engine?.world?.setPlaying?.(!!song && !pb.pausedAt); renderMini();
  const np = $('#np');
  if (!song) { np.className = 'np empty'; np.textContent = t('nothingPlaying'); $('#np-controls').classList.add('hidden'); renderHud(); return; }
  np.className = 'np';
  np.innerHTML = `<img src="https://i.ytimg.com/vi/${esc(song.videoId)}/mqdefault.jpg" alt=""><div><div class="title">${esc(song.title)}</div><div class="who">🎤 ${song.singers.map((id) => esc(peerName(id))).join(' & ')}${pb.pausedAt ? ' · ⏸' : ''}</div></div>`;
  $('#np-controls').classList.remove('hidden');
  $('#btn-pause').textContent = pb.pausedAt ? t('resume') : t('pause');
  const owner = song.ownerId === S.selfId;
  $('#btn-duet').classList.toggle('hidden', !(owner && song.singers.length < 2) && !(isSinger() && !owner));
  $('#btn-duet').textContent = owner ? t('duetInvite') : t('duetLeave');
  renderHud();
}
function renderQueue() {
  $('#queue-title').textContent = t('queue', { n: S.queue.length }); renderMini();
  const host = S.hostId === S.selfId;
  $('#queue').innerHTML = S.queue.map((s) => `<li><div>${esc(s.title)}</div><span class="who">— ${esc(s.ownerName)}</span><span class="acts">${host ? `<button class="btn sm" data-prio="${s.id}">${t('prioritize')}</button>` : ''}${s.ownerId === S.selfId || host ? `<button class="btn sm" data-rm="${s.id}">${t('remove')}</button>` : ''}</span></li>`).join('') || `<span class="muted">${t('queueEmpty')}</span>`;
}
$('#queue').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.rm) net.send({ type: 'queue.remove', id: b.dataset.rm }); if (b.dataset.prio) net.send({ type: 'queue.prioritize', id: b.dataset.prio }); };
$('#btn-pause').onclick = () => net.send({ type: 'control', action: S.playback?.pausedAt ? 'resume' : 'pause' });
$('#btn-skip').onclick = () => net.send({ type: 'control', action: 'skip' });
$('#btn-duet').onclick = () => {
  const song = S.playback?.song; if (!song) return;
  if (song.ownerId !== S.selfId) return net.send({ type: 'duet.leave' });
  const others = [...S.peers.values()].filter((p) => !p.bot && !song.singers.includes(p.id));
  $('#duet-list').innerHTML = others.map((p) => `<li>${esc(p.name)}<button class="btn sm primary" data-to="${p.id}">${t('invite')}</button></li>`).join('') || `<li class="muted">${t('duetNobody')}</li>`;
  $('#dlg-duet').showModal();
};
$('#duet-list').onclick = (e) => { const to = e.target.dataset.to; if (to) { net.send({ type: 'duet.invite', to }); $('#dlg-duet').close(); } };
setInterval(() => {
  const pb = S.playback; if (!pb?.song || !video) { $('#np-bar').style.width = '0'; return; }
  $('#np-bar').style.width = `${video.progress() * 100}%`;
}, 500);

// ======================================================= reception
// the player's own private-room box: request status, rooms with their entry codes, request button
function proomMineHtml() {
  if (!S.me || S.me.guest) return `<div class="proom-box"><span>${t('proomGuest')}</span></div>`;
  const pm = S.me.proom ?? { request: null, rooms: [] };
  const req = pm.request && pm.request.status !== 'approved' ? `<span>${t(`proomStatus.${pm.request.status}`)} — <b>${esc(pm.request.name)}</b> · ${pm.request.capacity} 👥${pm.request.note ? ` <span class="muted">(${esc(pm.request.note)})</span>` : ''}</span>` : '';
  const rooms = pm.rooms.map((r) => `<div class="row"><b>🔑 ${esc(r.name)}</b><span class="muted">${r.capacity} 👥</span><span>${t('proomCode')}:</span><span class="proom-code">${esc(r.code)}</span>
    <button class="btn sm" data-pcopy="${esc(r.code)}">${t('proomCopy')}</button><button class="btn sm" data-pcode="${r.id}">${t('proomNewCode')}</button><button class="btn sm" data-pdel="${r.id}" data-pname="${esc(r.name)}">${t('proomDelete')}</button><button class="btn sm primary" data-join="${r.id}">${t('enterRoom')}</button></div>`).join('');
  const canAsk = pm.request?.status !== 'pending' && pm.rooms.length < 2;
  return `<div class="proom-box"><b>${t('proomMine')}</b>${req}${rooms}${canAsk ? `<div class="row"><button class="btn sm primary" data-pask="1">${t('proomAsk')}</button></div>` : ''}</div>`;
}

function openReception(tab) {
  S.recTab = tab; $('#rec-greeting').textContent = t('receptionGreeting', { name: S.me?.name });
  const tabs = ['rooms', 'quests', 'friends', 'club', 'checkin', 'board', 'shop', 'wardrobe', 'guide'];
  const labels = { quests: 'tabQuests', friends: 'tabFriends', club: 'tabClub', rooms: 'tabRooms', checkin: 'tabCheckin', board: 'tabBoard', shop: 'tabShop', wardrobe: 'tabWardrobe', guide: 'tabGuide' };
  $('#rec-tabs').innerHTML = tabs.map((k) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${t(labels[k])}${k === 'friends' && S.me?.friendReqs ? ` <span class="dot-count">${S.me.friendReqs}</span>` : ''}${k === 'quests' && S.me?.questsReady ? ` <span class="dot-count">${S.me.questsReady}</span>` : ''}</button>`).join('');
  $('#rec-tabs').onclick = (e) => { const k = e.target.dataset.tab; if (k) openReception(k); };
  if (tab === 'board') net.send({ type: 'leaderboard' });
  if (tab === 'friends' && !S.me?.guest) net.send({ type: 'friend.list' });
  if (tab === 'quests' && !S.me?.guest) net.send({ type: 'quests' });
  if (tab === 'club' && !S.me?.guest) {
    net.send({ type: 'club.list', q: S.clubQ ?? '' });
    const asked = S.clubList; setTimeout(() => { if (S.clubList === asked && !S.club && S.recTab === 'club' && $('#dlg-reception').open) $('#rec-body').innerHTML = `<p class="hint err">${t('clubNoReply')}</p>`; }, 4000);
  }
  renderReception();
  if (!$('#dlg-reception').open) $('#dlg-reception').showModal();
}
const needAccountHtml = () => `<p>${t('needAccount')}</p><button class="btn primary" data-act="login">${t('loginOrRegister')}</button>`;
function renderReception() {
  const body = $('#rec-body'); const me = S.me;
  if (S.recTab === 'rooms') {
    const pub = S.rooms.filter((r) => !r.private); const priv = S.rooms.filter((r) => r.private);
    const busiest = [...pub].filter((r) => r.status !== 'full').sort((a, b) => b.humans - a.humans || (b.nowPlaying ? 1 : 0) - (a.nowPlaying ? 1 : 0))[0];
    const empty = pub.find((r) => r.count === 0) ?? [...pub].sort((a, b) => a.count - b.count)[0];
    const card = (r) => `<div class="room-card ${r.private ? 'private' : ''}" style="--c:${esc(r.color)}"><h5>${r.private ? '🔒 ' : ''}${esc(r.name)}</h5>${r.private ? `<span class="owner">${t('proomOwner', { name: esc(r.ownerName) })}</span>` : ''}<span class="status ${r.status}">${t({ open: 'statusOpen', singing: 'statusSinging', full: 'statusFull' }[r.status])}</span><span class="muted">${esc(r.blurb)}</span><span>${r.nowPlaying ? `🎵 ${esc(r.nowPlaying)}` : `<span class="muted">${t('nobodySinging')}</span>`}</span><div class="row"><span class="muted">👥 ${t('people', { n: r.count, cap: r.capacity })}</span><span style="flex:1"></span><button class="btn sm primary" data-join="${r.id}" ${r.status === 'full' ? 'disabled' : ''}>${t('enterRoom')}</button></div></div>`;
    body.innerHTML = `<div class="quick"><button class="btn" data-join="${busiest?.id}">${t('quickBusiest')}<small>${esc(busiest?.name)}</small></button><button class="btn" data-join="${empty?.id}">${t('quickEmpty')}<small>${esc(empty?.name)}</small></button></div><h4 class="sec-title">${t('proomPublic')}</h4><div class="room-grid">${pub.map(card).join('')}</div>
      <h4 class="sec-title">${t('proomPrivate')}</h4>${proomMineHtml()}${priv.length ? `<div class="room-grid">${priv.map(card).join('')}</div>` : `<p class="hint">${t('proomNone')}</p>`}`;
  }
  if (S.recTab === 'checkin') {
    if (me.guest) { body.innerHTML = needAccountHtml(); return; }
    const c = me.checkin; const doneCount = c.claimedToday ? c.streak : c.streak;
    body.innerHTML = `<p>${t('checkinTitle')}</p><div class="days">${c.rewards.map((r, i) => `<div class="day ${i < doneCount % 7 || (c.claimedToday && doneCount % 7 === 0 && doneCount > 0) ? 'done' : ''} ${!c.claimedToday && i === c.streak % 7 ? 'next' : ''}">${t('checkinDay', { n: i + 1 })}<b>${r}</b></div>`).join('')}</div>
      <div class="row center"><button class="btn primary" data-act="checkin" ${c.claimedToday ? 'disabled' : ''}>${c.claimedToday ? t('checkinDone') : t('checkinClaim', { n: c.nextReward })}</button></div>`;
  }
  if (S.recTab === 'board') {
    const lb = S.board; if (!lb) { body.innerHTML = '…'; return; }
    const list = (rows) => rows.length ? `<ol>${rows.map((r, i) => `<li><span>${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} ${esc(r.name)}</span><b>${r.value}</b></li>`).join('')}</ol>` : `<p class="muted">${t('boardEmpty')}</p>`;
    body.innerHTML = `<p>${t('boardTitle', { date: lb.weekStart })}</p><div class="boards"><div class="board"><h4>${t('boardSongs')}</h4>${list(lb.songs)}</div><div class="board"><h4>${t('boardGifts')}</h4>${list(lb.gifts)}</div><div class="board"><h4>${t('boardSpent')}</h4>${list(lb.spent)}</div></div><p class="hint">${t('boardNote')}</p>`;
  }
  if (S.recTab === 'shop') {
    if (me.guest) { body.innerHTML = needAccountHtml(); return; }
    const slots = ['all', ...S.slots];
    const items = S.shop.filter((i) => S.shopSlot === 'all' || i.slot === S.shopSlot);
    body.innerHTML = `<div class="row"><span class="coins">🪙 ${me.coins}</span></div><div class="tabs">${slots.map((s) => `<button data-slot="${s}" class="${s === S.shopSlot ? 'active' : ''}">${s === 'all' ? t('all') : t(`slots.${s}`)}</button>`).join('')}</div>
      <div class="items">${items.map((i) => itemCard(i)).join('')}</div>`;
  }
  if (S.recTab === 'wardrobe') {
    if (me.guest) { body.innerHTML = needAccountHtml(); return; }
    const owned = S.shop.filter((i) => me.owned.includes(i.id));
    body.innerHTML = owned.length ? `<div class="items">${owned.map((i) => itemCard(i)).join('')}</div>` : `<p>${t('wardrobeEmpty')}</p><button class="btn primary" data-tab-go="shop">${t('toShop')}</button>`;
  }
  if (S.recTab === 'club') { body.innerHTML = me.guest ? needAccountHtml() : clubHtml(); const log = $('#club-log'); if (log) log.scrollTop = log.scrollHeight; }
  if (S.recTab === 'quests') body.innerHTML = me.guest ? needAccountHtml() : questsHtml();
  if (S.recTab === 'friends') body.innerHTML = me.guest ? needAccountHtml() : friendsHtml();
  if (S.recTab === 'guide') body.innerHTML = `<div class="guide">${t('guide').map(([ic, h, p]) => `<div><span>${ic}</span><div><b>${h}</b><p>${p}</p></div></div>`).join('')}</div>`;
}
// ---- clubs ----
const clubName = (c) => `${esc(c.icon)} <b>[${esc(c.tag)}]</b> ${esc(c.name)}`;
function clubHtml() {
  const L = S.clubList; const c = S.club;
  if (!L && !c) return '…';
  if (c) {
    const place = (m) => !m.online ? `<span class="muted">${t('clubOffline')}</span>` : m.place === 'room' ? `🎤 ${esc(m.roomName ?? '')}${m.private ? ' 🔒' : ''}` : m.place === 'lobby' ? t('clubInLobby') : `<span class="muted">${t('clubOnline')}</span>`;
    const go = (m) => m.id !== S.me.id && m.online && m.place ? `<button class="btn sm" data-cgo="${m.place === 'room' ? esc(m.room) : 'lobby'}">${t('clubGo')}</button>` : '';
    const members = c.members.map((m) => `<li><span><i class="dot ${m.online ? 'on' : ''}"></i>${esc(m.name)}${m.id === c.ownerId ? ' 👑' : ''} · ${place(m)}</span><span class="row small-gap">${go(m)}${c.owner && m.id !== S.me.id ? `<button class="btn sm" data-ckick="${m.id}" data-cname="${esc(m.name)}">✕</button>` : ''}</span></li>`).join('');
    const reqs = c.requests.length ? `<h4>${t('clubRequests')}</h4><ul class="plain-list">${c.requests.map((r) => `<li><span>${esc(r.name)}</span><span class="row small-gap"><button class="btn sm primary" data-cans="${r.id}" data-ok="1">${t('adminApprove')}</button><button class="btn sm" data-cans="${r.id}" data-ok="0">${t('adminReject')}</button></span></li>`).join('')}</ul>` : '';
    const chat = c.chat.map((m) => `<li><b>${esc(m.name)}:</b> ${esc(m.text)}</li>`).join('') || `<li class="muted">${t('clubChatEmpty')}</li>`;
    const top = (L?.clubs ?? []).slice(0, 5).map((x, i) => `<li><span>${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} ${clubName(x)}</span><b>${x.points}</b></li>`).join('');
    return `<div class="club-head"><span class="club-ic">${esc(c.icon)}</span><div><h3>[${esc(c.tag)}] ${esc(c.name)}</h3><p class="muted">${esc(c.desc || t('clubNoDesc'))}</p>
        <div class="row small-gap"><span class="pill">🏆 ${t('clubRank', { n: c.rank || '–' })}</span><span class="pill">⭐ ${t('clubPoints', { n: c.points })}</span><span class="pill">👥 ${c.members.length}/${c.max}</span><span class="pill">${c.open ? t('clubOpen') : t('clubClosed')}</span></div></div></div>
      <p class="hint">${t('clubHowPoints')}</p>
      <div class="club-grid">
        <section><h4>💬 ${t('clubChat')}</h4><ul class="club-log" id="club-log">${chat}</ul><form id="club-say" class="row small-gap"><input name="text" maxlength="200" autocomplete="off" placeholder="${t('chatPlaceholder')}"><button class="btn sm primary">${t('send')}</button></form></section>
        <section><h4>👥 ${t('clubMembers')}</h4><ul class="plain-list club-members">${members}</ul>${reqs}</section>
      </div>
      <h4>🏆 ${t('clubWeekTop')}</h4><ol class="plain-list club-top">${top}</ol><p class="hint">${t('clubPrizes')}</p>
      <div class="row small-gap">${c.owner ? `<button class="btn sm" data-copen="${c.open ? 0 : 1}">${c.open ? t('clubMakeClosed') : t('clubMakeOpen')}</button><button class="btn sm" data-cdesc="1">${t('clubEditDesc')}</button>` : ''}<span style="flex:1"></span><button class="btn sm danger" data-cleave="1">${t('clubLeave')}</button></div>`;
  }
  const pend = new Set(L.pending);
  const card = (x) => `<div class="room-card club-card"><h5>${clubName(x)}</h5><span class="muted">${esc(x.desc || '')}</span><div class="row"><span class="muted">👥 ${x.members}/30 · ⭐ ${x.points}</span><span style="flex:1"></span>${pend.has(x.id) ? `<button class="btn sm" data-ccancel="${x.id}">${t('clubPending')}</button>` : `<button class="btn sm primary" data-cjoin="${x.id}" ${x.members >= 30 ? 'disabled' : ''}>${x.open ? t('clubJoin') : t('clubAsk')}</button>`}</div></div>`;
  return `<p>${t('clubIntro')}</p>
    <details class="club-new" ${L.clubs.length ? '' : 'open'}><summary class="btn primary">${t('clubCreate', { n: L.price })}</summary>
      <form id="club-form" class="dlg-body">
        <label><span>${t('clubNameL')}</span><input name="name" required minlength="3" maxlength="24" autocomplete="off"></label>
        <label><span>${t('clubTagL')}</span><input name="tag" required minlength="2" maxlength="4" autocomplete="off" style="text-transform:uppercase"></label>
        <div><span>${t('clubIconL')}</span><div class="chips club-icons">${L.icons.map((ic, i) => `<label><input type="radio" name="icon" value="${ic}" ${i ? '' : 'checked'}><span>${ic}</span></label>`).join('')}</div></div>
        <label><span>${t('clubDescL')}</span><input name="desc" maxlength="120" autocomplete="off"></label>
        <label class="row"><input type="checkbox" name="open" checked> ${t('clubOpenL')}</label>
        <button class="btn primary" ${S.me.coins < L.price ? 'disabled' : ''}>${t('clubCreateGo', { n: L.price })}</button>
      </form></details>
    <form id="club-search" class="row small-gap"><input name="q" value="${esc(S.clubQ ?? '')}" placeholder="${t('clubSearch')}"><button class="btn sm">🔍</button></form>
    ${L.clubs.length ? `<div class="room-grid">${L.clubs.map(card).join('')}</div>` : `<p class="hint">${t('clubNone')}</p>`}`;
}
$('#rec-body').addEventListener('submit', (e) => {
  const f = e.target; if (!['club-form', 'club-say', 'club-search'].includes(f.id)) return; e.preventDefault();
  const d = Object.fromEntries(new FormData(f));
  if (f.id === 'club-form') net.send({ type: 'club.create', name: d.name, tag: d.tag, icon: d.icon, desc: d.desc, open: !!d.open });
  if (f.id === 'club-say' && d.text?.trim()) { net.send({ type: 'club.say', text: d.text }); f.reset(); }
  if (f.id === 'club-search') { S.clubQ = d.q; net.send({ type: 'club.list', q: d.q }); }
});
$('#rec-body').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
  if (d.cjoin) net.send({ type: 'club.join', id: d.cjoin });
  if (d.ccancel) { net.send({ type: 'club.cancel', id: d.ccancel }); net.send({ type: 'club.list', q: S.clubQ ?? '' }); }
  if (d.cans) net.send({ type: 'club.answer', id: d.cans, accept: d.ok === '1' });
  if (d.ckick && await confirmBox(t('clubKickAsk', { name: d.cname }), t('clubKick'), t('cancel'))) net.send({ type: 'club.kick', id: d.ckick });
  if (d.copen) net.send({ type: 'club.edit', open: d.copen === '1' });
  if (d.cdesc) { const v = prompt(t('clubDescL'), S.club?.desc ?? ''); if (v != null) net.send({ type: 'club.edit', desc: v }); }
  if (d.cleave && await confirmBox(t('clubLeaveAsk'), t('clubLeave'), t('cancel'))) net.send({ type: 'club.leave' });
  if (d.cgo) { $('#dlg-reception').close(); net.send(d.cgo === 'lobby' ? { type: 'lobby.enter' } : { type: 'room.join', room: d.cgo }); }
});
net.on('club.list', (m) => { S.clubList = m; S.club = m.club; if ($('#dlg-reception').open && S.recTab === 'club') renderReception(); });
net.on('club.state', (m) => {
  S.club = m.club;
  if ($('#dlg-reception').open && S.recTab === 'club') { renderReception(); net.send({ type: 'club.list', q: S.clubQ ?? '' }); } // refresh the ranking / list too
});
net.on('club.msg', (m) => {
  if (S.club) { S.club.chat = [...S.club.chat, m.msg].slice(-40); }
  const viewing = $('#dlg-reception').open && S.recTab === 'club';
  if (viewing) { const log = $('#club-log'); if (log) { log.querySelector('li.muted')?.remove(); log.insertAdjacentHTML('beforeend', `<li><b>${esc(m.msg.name)}:</b> ${esc(m.msg.text)}</li>`); log.scrollTop = log.scrollHeight; } }
  chatLine(`<span class="club-tag">[${esc(m.tag)}]</span> <b>${esc(m.msg.name)}:</b> ${esc(m.msg.text)}`);
  if (!viewing && m.msg.id !== S.selfId && m.msg.id !== S.me?.id) toast(`💬 [${m.tag}] ${m.msg.name}: ${m.msg.text}`.slice(0, 120));
});

// ======================================================= player ↔ player
const isBlocked = (id) => !!S.me?.blocked?.includes(id);
function openPlayerCard(id) {
  if (!id || id === S.selfId) return;
  S.card = { id, name: peerName(id), loading: true }; renderPlayerCard();
  net.send({ type: 'player.card', id });
}
function renderPlayerCard() {
  const c = S.card; if (!c) return; const d = $('#dlg-player');
  const song = S.playback?.song; const canDuet = S.mode === 'room' && !c.bot && song?.ownerId === S.selfId && !song.singers.includes(c.id);
  const acct = !S.me?.guest && !c.guest && !c.bot && !c.blocked;
  const friendBtn = !acct ? '' : c.friend ? `<button class="btn sm" data-pc="unfriend">💔 ${t('pcUnfriend')}</button>`
    : c.theyAsked ? `<button class="btn sm primary" data-pc="accept">🤝 ${t('pcAccept')}</button>`
    : c.requested ? `<button class="btn sm" disabled>⏳ ${t('pcRequested')}</button>` : `<button class="btn sm primary" data-pc="friend">➕ ${t('pcAddFriend')}</button>`;
  $('#pc-body').innerHTML = `<div class="pc-head"><b class="pc-name">${c.club ? `<span class="club-tag">[${esc(c.club.tag)}]</span> ` : ''}${esc(c.name ?? '…')}</b>
      <span class="muted">${c.bot ? t('pcStaff') : c.guest ? t('pcGuest') : t('pcSongs', { n: c.songs ?? 0 })}${c.club ? ` · ${esc(c.club.icon ?? '')} ${esc(c.club.name)}` : ''}${c.friend ? ` · 💛 ${t('pcFriend')}` : ''}</span></div>
    ${c.blocked ? `<p class="hint">${t('pcBlockedHint')}</p>` : `<div class="pc-acts">
      <button class="btn" data-pc="wave">👋 ${t('pcWave')}</button>
      <button class="btn" data-pc="highfive">✋ ${t('pcHighfive')}</button>
      <button class="btn" data-pc="hug">🫂 ${t('pcHug')}</button>
      <button class="btn" data-pc="flowers">💐 ${t('pcFlowers', { n: 50 })}</button>
      ${canDuet ? `<button class="btn" data-pc="duet">🎤 ${t('pcDuet')}</button>` : ''}
    </div><p class="hint">${t('pcNearHint')}</p>
    ${c.bot ? '' : `<form class="row small-gap pc-whisper" id="pc-whisper"><input name="text" maxlength="200" autocomplete="off" placeholder="${esc(t('pcWhisperPh', { name: c.name ?? '' }))}"><button class="btn sm primary" type="submit">💬</button></form>`}`}
    <div class="row small-gap pc-foot">${friendBtn}${c.bot ? '' : `<button class="btn sm ${c.blocked ? '' : 'danger'}" data-pc="${c.blocked ? 'unblock' : 'block'}">${c.blocked ? `✅ ${t('pcUnblock')}` : `🚫 ${t('pcBlock')}`}</button>`}</div>`;
  if (!d.open) d.showModal();
}
$('#pc-body').addEventListener('submit', (e) => {
  e.preventDefault(); const inp = e.target.text; const text = inp.value.trim(); if (!text || !S.card) return;
  net.send({ type: 'whisper', to: S.card.id, text }); inp.value = '';
});
$('#pc-body').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pc]'); const c = S.card; if (!b || !c) return; const k = b.dataset.pc;
  if (['wave', 'highfive', 'hug', 'flowers'].includes(k)) { net.send({ type: 'social.do', to: c.id, kind: k }); return $('#dlg-player').close(); }
  if (k === 'duet') { net.send({ type: 'duet.invite', to: c.id }); return $('#dlg-player').close(); }
  if (k === 'friend') net.send({ type: 'friend.add', id: c.id });
  if (k === 'accept') net.send({ type: 'friend.accept', id: c.id });
  if (k === 'unfriend' && await confirmBox(t('pcUnfriendAsk', { name: c.name }), t('pcUnfriend'), t('cancel'))) net.send({ type: 'friend.remove', id: c.id });
  if (k === 'block' && await confirmBox(t('pcBlockAsk', { name: c.name }), t('pcBlock'), t('cancel'))) net.send({ type: 'block', id: c.id, on: true });
  if (k === 'unblock') net.send({ type: 'block', id: c.id, on: false });
  setTimeout(() => { if (S.card?.id === c.id && $('#dlg-player').open) net.send({ type: 'player.card', id: c.id }); }, 300); // refresh the buttons
});
net.on('player.card', (m) => { if (S.card?.id !== m.id) return; S.card = m; renderPlayerCard(); });
net.on('social', (m) => {
  if (isBlocked(m.from) || isBlocked(m.toId)) return;
  engine?.social(m.kind, m.from, m.toId);
  if (m.kind !== 'wave' || m.from === S.selfId || m.toId === S.selfId) chatLine(esc(t(`social.${m.kind}`, { a: m.fromName, b: m.toName })), true);
  if (m.toId === S.selfId && m.kind !== 'wave') toast(t(`social.${m.kind}`, { a: m.fromName, b: t('you') }));
});
net.on('social.ask', async (m) => {
  if (isBlocked(m.from)) return net.send({ type: 'social.answer', id: m.id, accept: false });
  const ok = await confirmBox(t(`socialAsk.${m.kind}`, { name: m.fromName }), t('accept'), t('decline'), 20);
  net.send({ type: 'social.answer', id: m.id, accept: !!ok });
});
net.on('whisper', (m) => {
  const mine = m.from === S.selfId || m.from === S.me?.id;
  if (!mine && isBlocked(m.from)) return;
  chatLine(`<span class="whisper" data-wto="${esc(mine ? m.to : m.from)}">💬 ${mine ? t('whisperTo', { name: esc(m.toName) }) : t('whisperFrom', { name: esc(m.fromName) })}:</span> ${esc(m.text)}`);
  if (!mine) { S.lastWhisper = { id: m.from, name: m.fromName }; if (!$('#dlg-player').open) toast(`💬 ${m.fromName}: ${m.text}`.slice(0, 120)); }
});
// click a whisper line in the chat log = open that player's card to reply
$('#chat-log').addEventListener('click', (e) => { const w = e.target.closest('[data-wto]'); if (w) openPlayerCard(w.dataset.wto); });

// ---- friends tab ----
function friendsHtml() {
  const f = S.friends; if (!f) return `<p class="muted">…</p>`;
  const place = (x) => !x.online ? `<span class="muted">⚫ ${t('frOffline')}</span>` : x.place === 'lobby' ? `<span class="fr-on">🟢 ${t('frLobby')}</span>` : x.place === 'room' ? `<span class="fr-on">🟢 ${x.private ? '🔒 ' : ''}${esc(x.roomName ?? '')}</span>` : `<span class="fr-on">🟢 ${t('frOnline')}</span>`;
  const go = (x) => x.online && (x.place === 'lobby' || (x.place === 'room' && x.room !== S.room?.id)) && !(x.place === 'lobby' && S.mode === 'lobby') ? `<button class="btn sm primary" data-fgo="${x.place === 'lobby' ? 'lobby' : esc(x.room)}">${t('frGo')}</button>` : '';
  return `<p class="hint">${t('frIntro')}</p>
    ${f.requests.length ? `<h4 class="sec-title">${t('frRequests')}</h4><ul class="plain-list">${f.requests.map((x) => `<li><b>${esc(x.name)}</b><span class="row small-gap"><button class="btn sm primary" data-facc="${x.id}">${t('accept')}</button><button class="btn sm" data-fdec="${x.id}">${t('decline')}</button></span></li>`).join('')}</ul>` : ''}
    <h4 class="sec-title">${t('frList', { n: f.friends.length })}</h4>
    ${f.friends.length ? `<ul class="plain-list">${f.friends.map((x) => `<li><span><b>${x.clubTag ? `<span class="club-tag">[${esc(x.clubTag)}]</span> ` : ''}${esc(x.name)}</b> · ${place(x)}</span><span class="row small-gap">${go(x)}<button class="btn sm" data-fdel="${x.id}" data-fname="${esc(x.name)}">✕</button></span></li>`).join('')}</ul>` : `<p class="muted">${t('frNone')}</p>`}
    ${f.blocked.length ? `<h4 class="sec-title">${t('frBlocked')}</h4><ul class="plain-list">${f.blocked.map((x) => `<li><span>🚫 ${esc(x.name)}</span><button class="btn sm" data-funb="${x.id}">${t('pcUnblock')}</button></li>`).join('')}</ul>` : ''}`;
}
$('#rec-body').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-facc],[data-fdec],[data-fdel],[data-funb],[data-fgo]'); if (!b) return; const d = b.dataset;
  if (d.facc) net.send({ type: 'friend.accept', id: d.facc });
  if (d.fdec) net.send({ type: 'friend.decline', id: d.fdec });
  if (d.funb) net.send({ type: 'block', id: d.funb, on: false });
  if (d.fdel && await confirmBox(t('pcUnfriendAsk', { name: d.fname }), t('pcUnfriend'), t('cancel'))) net.send({ type: 'friend.remove', id: d.fdel });
  if (d.fgo) { $('#dlg-reception').close(); net.send(d.fgo === 'lobby' ? { type: 'lobby.enter' } : { type: 'room.join', room: d.fgo }); }
});
net.on('friend.list', (m) => { S.friends = m; if ($('#dlg-reception').open && S.recTab === 'friends') renderReception(); });

// ======================================================= quests
const fmtLeft = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
function questRow(q) {
  const div = q.unit === 'min' || q.unit === 'hours' ? 60 : 1; const prog = Math.floor(q.progress / div); const goal = q.goal / div;
  const unit = q.unit === 'hours' ? ` ${t('unitHours')}` : q.unit === 'min' || q.unit === 'mins' ? ` ${t('unitMins')}` : '';
  const done = q.progress >= q.goal;
  return `<li class="quest ${q.claimed ? 'claimed' : done ? 'done' : ''}"><div class="q-main"><b>${t(`quest.${q.id}`)}</b>
    <div class="q-bar"><i style="width:${Math.round((q.progress / q.goal) * 100)}%"></i></div><span class="muted">${prog}/${goal}${unit}</span></div>
    <span class="q-coins">+${q.coins} 🪙</span>${q.claimed ? `<span class="pill">✓ ${t('questGot')}</span>` : done ? `<button class="btn sm primary" data-qclaim="${q.id}">${t('questClaim')}</button>` : q.id === 'share1' || q.id === 'winvite1' ? `<button class="btn sm" data-action="share">📤</button>` : ''}</li>`;
}
function questsHtml() {
  const s = S.quests; if (!s) return `<p class="muted">…</p>`;
  const b = s.bonus;
  return `<p class="hint">${t('questIntro')}</p>
    <h4 class="sec-title">${t('questDaily')} <span class="muted">· ${t('questReset', { left: fmtLeft(s.resetIn) })}</span></h4>
    <ul class="plain-list quests">${s.daily.map(questRow).join('')}
      <li class="quest chest ${b.claimed ? 'claimed' : b.ready ? 'done' : ''}"><div class="q-main"><b>🎁 ${t('questChest')}</b><span class="muted">${t('questChestHint')}</span></div><span class="q-coins">+${b.coins} 🪙</span>${b.claimed ? `<span class="pill">✓ ${t('questGot')}</span>` : b.ready ? `<button class="btn sm primary" data-qclaim="bonus">${t('questClaim')}</button>` : ''}</li></ul>
    <h4 class="sec-title">${t('questWeekly')}</h4><ul class="plain-list quests">${s.weekly.map(questRow).join('')}</ul>
    <div class="invite-box"><b>💌 ${t('inviteTitle')}</b><span>${t('inviteHint', { reward: s.invite.reward, newbie: s.invite.newbie, cap: s.invite.cap })}</span>
      <span class="muted">${t('inviteCount', { week: s.invite.week, cap: s.invite.cap, total: s.invite.total })}</span><button class="btn primary" data-action="share">📤 ${t('shareInvite')}</button></div>`;
}
$('#rec-body').addEventListener('click', (e) => { const b = e.target.closest('[data-qclaim]'); if (b) { b.disabled = true; net.send({ type: 'quest.claim', id: b.dataset.qclaim }); } });
net.on('quests', (m) => { S.quests = m; if ($('#dlg-reception').open && S.recTab === 'quests') renderReception(); });
function renderQuestBadge() { const n = S.me?.guest ? 0 : (S.me?.questsReady ?? 0); document.querySelectorAll('[data-action=quests]').forEach((b) => { b.dataset.count = String(n); }); }

// ======================================================= share
const shareUrl = () => {
  const u = new URL(location.origin + '/');
  if (S.me && !S.me.guest) u.searchParams.set('ref', S.me.id);
  if (S.mode === 'room' && S.room && !S.room.private) u.searchParams.set('room', S.room.id);
  return u.toString();
};
const shareText = () => (S.mode === 'room' && S.room && !S.room.private ? t('shareTextRoom', { room: S.room.name }) : t('shareText'));
function openShare() {
  const url = shareUrl(); const text = shareText(); const enc = encodeURIComponent;
  const links = [
    ['facebook', 'Facebook', `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`],
    ['messenger', 'Messenger', /Android|iPhone|iPad/i.test(navigator.userAgent) ? `fb-messenger://share/?link=${enc(url)}` : null],
    ['telegram', 'Telegram', `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`],
    ['x', 'X', `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`],
  ].filter((l) => l[2]);
  $('#share-body').innerHTML = `<p>${esc(text)}</p>
    <div class="share-link"><input readonly value="${esc(url)}"><button class="btn sm primary" data-share="copy">📋 ${t('shareCopy')}</button></div>
    <div class="share-grid">${navigator.share ? `<button class="btn primary" data-share="native">📱 ${t('shareNative')}</button>` : ''}
      ${links.map(([k, label, href]) => `<a class="btn share-${k}" data-share="${k}" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`).join('')}</div>
    <p class="hint">${S.me?.guest ? t('shareGuest') : t('shareHint')}</p>`;
  if (!$('#dlg-share').open) $('#dlg-share').showModal();
}
$('#share-body').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-share]'); if (!b) return; const via = b.dataset.share; const url = shareUrl();
  if (via === 'copy') {
    e.preventDefault();
    try { await navigator.clipboard.writeText(url); } catch { const i = $('#share-body input'); i.select(); document.execCommand?.('copy'); }
    toast(t('shareCopied'));
  }
  if (via === 'native') { e.preventDefault(); try { await navigator.share({ title: 'KTV', text: shareText(), url }); } catch (er) { if (er?.name === 'AbortError') return; } }
  net.send({ type: 'share', via });
});
// share a recording file (phones: Zalo, Messenger, Drive… via the system share sheet)
const canShareFile = (item) => { try { return !!navigator.canShare?.({ files: [new File([], item.file, { type: 'audio/webm' })] }); } catch { return false; } };
async function takePhotoBooth() {
  if (!engine?.world) return;
  engine.renderer.render(engine.world.scene, engine.camera);
  const src = engine.canvas;
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d'); ctx.drawImage(src, 0, 0);
  // Draw branded KTV watermark bar at bottom-right
  const h = Math.max(38, Math.round(c.height * 0.055));
  const pad = Math.round(h * 0.45);
  const roomTxt = S.mode === 'room' && S.room ? ` · ${S.room.name}` : ' · Rooftop Lounge 3D';
  const nameTxt = S.me?.name ? `🎤 ${S.me.name}` : '🎤 KTV';
  const label = `${nameTxt}${roomTxt}  |  ${location.host}`;
  ctx.font = `700 ${Math.round(h * 0.48)}px "Be Vietnam Pro", sans-serif`;
  const tw = ctx.measureText(label).width;
  const bw = tw + pad * 2.2;
  const bx = c.width - bw - pad; const by = c.height - h - pad;
  ctx.fillStyle = 'rgba(13, 17, 23, 0.82)';
  ctx.beginPath(); ctx.roundRect(bx, by, bw, h, h / 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 122, 89, 0.85)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + pad * 1.1, by + h / 2);
  c.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], `ktv-3d-${Date.now()}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try { await navigator.share({ files: [file], title: 'KTV — Karaoke Lounge 3D', text: shareText(), url: shareUrl() }); net.send({ type: 'share', via: 'photo' }); return; } catch {}
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(t('photoSaved'));
    net.send({ type: 'share', via: 'photo' });
  }, 'image/png');
}
async function shareRecording(item) {
  try {
    const blob = await (await fetch(item.url)).blob();
    await navigator.share({ files: [new File([blob], item.file, { type: blob.type || 'audio/webm' })], title: item.title, text: t('shareRecText', { title: item.title }) });
    net.send({ type: 'share', via: 'recording' });
  } catch (er) { if (er?.name !== 'AbortError') toast(t('shareFailed'), 'err'); }
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-rshare]'); if (!b) return; const item = recorder.list.find((r) => r.id === b.dataset.rshare); if (item) shareRecording(item); });

function itemCard(i) {
  const me = S.me; const owned = me.owned.includes(i.id); const on = me.equipped.includes(i.id);
  const btn = !owned ? `<button class="btn sm primary" data-buy="${i.id}" ${me.coins < i.price ? 'disabled' : ''}>${t('buy', { n: i.price })}</button>`
    : `<button class="btn sm ${on ? 'on' : ''}" data-equip="${i.id}" data-on="${on ? 0 : 1}">${on ? t('equipped') : t('equip')}</button>`;
  return `<div class="item ${owned ? 'owned' : ''}"><span class="ic">${ICON[i.id] ?? '🎁'}</span><b>${esc(itemName(i.id))}</b><span class="muted">${t(`slots.${i.slot}`)}</span>${btn}</div>`;
}
$('#rec-body').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.join) { $('#dlg-reception').close(); net.send({ type: 'room.join', room: b.dataset.join }); }
  if (b.dataset.pask) { $('#proom-form').reset(); $('#dlg-proom').showModal(); }
  if (b.dataset.pcopy) { navigator.clipboard?.writeText(b.dataset.pcopy).catch(() => {}); toast(t('proomCopied', { code: b.dataset.pcopy })); }
  if (b.dataset.pcode) net.send({ type: 'proom.code', room: b.dataset.pcode });
  if (b.dataset.pdel) confirmBox(t('proomDeleteAsk', { name: b.dataset.pname }), t('proomDelete'), t('cancel')).then((ok) => ok && net.send({ type: 'proom.delete', room: b.dataset.pdel }));
  if (b.dataset.act === 'checkin') net.send({ type: 'checkin' });
  if (b.dataset.act === 'login') { $('#dlg-reception').close(); net.send({ type: 'auth.logout' }); showAuth('login'); }
  if (b.dataset.slot) { S.shopSlot = b.dataset.slot; renderReception(); }
  if (b.dataset.buy) net.send({ type: 'shop.buy', item: b.dataset.buy });
  if (b.dataset.equip) net.send({ type: 'shop.equip', item: b.dataset.equip, on: b.dataset.on === '1' });
  if (b.dataset.tabGo) openReception(b.dataset.tabGo);
};

// ======================================================= kiosk
function parseVideoId(s) {
  s = s.trim(); if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try { const u = new URL(s); if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1, 12); if (u.hostname.includes('youtube.com')) return u.searchParams.get('v') || u.pathname.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)?.[1] || null; } catch {}
  return null;
}
function openKiosk() {
  const k = S.kiosk;
  $('#kiosk-genres').innerHTML = Object.keys(GENRE_Q).map((g) => `<button class="btn sm ${k.genre === g ? 'on' : ''}" data-genre="${g}" ${S.searchEnabled ? '' : 'disabled'}>${t(`genres.${g}`)}</button>`).join('');
  $('#kiosk-tone').innerHTML = `<span class="muted">${t('tone')}:</span>${[['', 'toneAll'], [' tone nam', 'toneMale'], [' tone nữ', 'toneFemale']].map(([v, l]) => `<button class="btn sm ${k.tone === v ? 'on' : ''}" data-tone="${v}" ${S.searchEnabled ? '' : 'disabled'}>${t(l)}</button>`).join('')}`;
  updateKioskButton(); renderKioskResults();
  if (!$('#dlg-kiosk').open) { $('#dlg-kiosk').showModal(); if (S.searchEnabled && !k.items.length) kioskSearch(GENRE_Q.hot, 'hot'); }
}
function updateKioskButton() { const link = parseVideoId($('#kiosk-input').value); $('#kiosk-go').textContent = link ? t('add') : t('search'); $('#kiosk-link').classList.toggle('hidden', !link); }
$('#kiosk-input').oninput = updateKioskButton;
async function kioskSearch(q, genre, more) {
  const k = S.kiosk; k.q = q; k.genre = genre ?? null;
  if (!more) { k.items = []; k.next = null; $('#kiosk-results').innerHTML = `<p class="hint">${t('searching')}</p>`; }
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q + k.tone)}${more && k.next ? `&page=${k.next}` : ''}`); const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    k.items.push(...j.items.filter((i) => !k.items.some((x) => x.videoId === i.videoId))); k.next = j.next;
  } catch (e) { $('#kiosk-results').innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
  openKiosk();
}
function renderKioskResults() {
  const k = S.kiosk; if (!k.items.length) { $('#kiosk-results').innerHTML = S.searchEnabled && k.q ? `<p class="hint">${t('noResults')}</p>` : ''; $('#kiosk-more').classList.add('hidden'); return; }
  $('#kiosk-results').innerHTML = k.items.map((i) => `<div class="result"><img src="${esc(i.thumb)}" alt="" loading="lazy"><div><div>${esc(i.title)}</div><div class="ch">${esc(i.channel)}${i.duration ? ` · ${esc(i.duration)}` : ''}</div></div><button class="btn sm primary" data-pick="${esc(i.videoId)}">${t('pick')}</button></div>`).join('');
  $('#kiosk-more').classList.toggle('hidden', !k.next);
}
$('#kiosk-form').onsubmit = (e) => {
  e.preventDefault(); const v = $('#kiosk-input').value; const id = parseVideoId(v);
  if (id) { net.send({ type: 'queue.add', videoId: id }); $('#kiosk-input').value = ''; updateKioskButton(); $('#dlg-kiosk').close(); return; }
  if (v.trim()) kioskSearch(`karaoke ${v.trim()}`, null);
};
$('#kiosk-genres').onclick = (e) => { const g = e.target.dataset.genre; if (g) kioskSearch(GENRE_Q[g], g); };
$('#kiosk-tone').onclick = (e) => { const b = e.target.closest('[data-tone]'); if (!b) return; S.kiosk.tone = b.dataset.tone; if (S.kiosk.q) kioskSearch(S.kiosk.q, S.kiosk.genre); else openKiosk(); };
$('#kiosk-more').onclick = () => kioskSearch(S.kiosk.q, S.kiosk.genre, true);
$('#kiosk-results').onclick = (e) => {
  const b = e.target.closest('[data-pick]'); if (!b) return;
  const it = S.kiosk.items.find((i) => i.videoId === b.dataset.pick);
  net.send({ type: 'queue.add', videoId: it.videoId, title: it.title, channel: it.channel }); $('#dlg-kiosk').close();
};
setInterval(() => { $('#kiosk-clock').textContent = new Date().toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' }); }, 1000);

// ======================================================= table / staff / panel / audio
const FOOD = ['beer', 'soda', 'fruit', 'cake', 'pizza'];
function openTable() {
  const held = engine.world?.avatars.get(S.selfId)?.peer.held;
  $('#table-body').innerHTML = `<div class="shop-rows">${FOOD.map((f) => `<div class="shop-row"><span>${t(`items.${f}`)}</span><span class="muted">${(S.stock[f] ?? 0) > 0 ? t('left', { n: S.stock[f] }) : t('soldOut')}</span><button class="btn sm primary" data-take="${f}" ${(S.stock[f] ?? 0) > 0 ? '' : 'disabled'}>＋</button></div>`).join('')}</div>
    ${held ? `<div class="row"><b>${t('hold', { item: t(`items.${held}`) })}</b><button class="btn sm" data-a="drink">${['fruit', 'cake', 'pizza'].includes(held) ? t('eat') : t('drink')}</button><button class="btn sm" data-a="cheers">${t('cheers')}</button><button class="btn sm" data-a="drop">${t('drop')}</button></div>` : ''}<p class="hint">${t('tableNote')}</p>`;
  if (!$('#dlg-table').open) $('#dlg-table').showModal();
}
$('#table-body').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.take) net.send({ type: 'take', item: b.dataset.take });
  if (b.dataset.a === 'drop') net.send({ type: 'take', item: '' });
  else if (b.dataset.a) net.send({ type: 'act', kind: b.dataset.a });
  $('#dlg-table').close();
};
function openStaff() {
  $('#staff-greeting').textContent = t('staffGreeting', { name: S.me?.name });
  const P = S.prices; const guest = S.me?.guest; const noSong = !S.playback?.song;
  const row = (kind, item, price, disabled) => `<div class="shop-row"><span>${t(`items.${item}`)}</span><button class="btn sm primary" data-kind="${kind}" data-item="${item}" ${guest || disabled || (S.me?.coins ?? 0) < price ? 'disabled' : ''}>🪙 ${price}</button></div>`;
  $('#staff-body').innerHTML = `${guest ? `<p>${t('needAccount')}</p>` : `<span class="coins">🪙 ${S.me.coins}</span>`}
    <h4>${t('staffHosts')}</h4><p class="hint">${t('staffHostsHint')}</p><div class="shop-rows">${Object.entries(P.host ?? {}).map(([i, p]) => row('host', i, p)).join('')}</div>
    <h4>${t('staffDance')}</h4><p class="hint">${t('staffDanceHint')}</p><div class="shop-rows">${Object.entries(P.dance ?? {}).map(([i, p]) => row('dance', i, p)).join('')}</div>
    <h4>${t('staffFood')}</h4><div class="shop-rows">${Object.entries(P.food).map(([i, p]) => row('food', i, p)).join('')}</div>
    <h4>${t('staffFx')}</h4><div class="shop-rows">${Object.entries(P.fx).map(([i, p]) => row('fx', i, p)).join('')}</div>
    <h4>${t('staffGift')}</h4>${noSong ? `<p class="hint">${t('noSinger')}</p>` : ''}<div class="shop-rows">${Object.entries(P.gift).map(([i, p]) => row('gift', i, p, noSong)).join('')}</div>`;
  if (!$('#dlg-staff').open) $('#dlg-staff').showModal();
}
$('#staff-body').onclick = (e) => { const b = e.target.closest('[data-kind]'); if (b) { net.send({ type: 'order', kind: b.dataset.kind, item: b.dataset.item }); $('#dlg-staff').close(); } };
function openPanel() {
  $('#panel-body').innerHTML = Object.keys(t('effects')).map((n) => `<button class="btn ${S.effects[n] ? 'on' : ''}" data-fx="${n}">${t(`effects.${n}`)}<small>${S.effects[n] ? 'ON' : 'OFF'}</small></button>`).join('');
  if (!$('#dlg-panel').open) $('#dlg-panel').showModal();
}
$('#panel-body').onclick = (e) => { const b = e.target.closest('[data-fx]'); if (b) net.send({ type: 'effect', name: b.dataset.fx }); };

const SLIDERS = [['gain', 'micVolume', 0, 2, 0.05, (v) => `${Math.round(v * 100)}%`], ['bass', 'bass', -12, 12, 1, (v) => `${v} dB`], ['mid', 'mid', -12, 12, 1, (v) => `${v} dB`], ['treble', 'treble', -12, 12, 1, (v) => `${v} dB`],
  ['echo', 'echo', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`], ['repeat', 'repeat', 0, 0.85, 0.05, (v) => `${Math.round(v * 100)}%`], ['reverb', 'reverb', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`], ['delay', 'delay', 60, 500, 10, (v) => `${v} ms`],
  ['musicVolume', 'musicVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`], ['voiceVolume', 'voiceVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
  ['monitorVolume', 'monitorVolume', 0, 2, 0.05, (v) => `${Math.round(v * 100)}%`]];
async function openAudio() {
  const f = voice.fx; f.musicVolume ??= 1;
  const mics = await voice.mics();
  $('#audio-body').innerHTML = `<p class="hint">${t('headphonesTip')}</p><p class="hint">${t('bluetoothTip')}</p>
    <div class="slider"><span>${t('micDevice')}</span><select data-k="micId"><option value="">${t('micDefault')}</option>${mics.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === f.micId ? 'selected' : ''}>${esc(d.label || `Mic ${i + 1}`)}</option>`).join('')}</select></div>
    <label class="row"><input type="checkbox" data-k="monitor" ${f.monitor ? 'checked' : ''}> ${t('headphones')}</label>
    <label class="row"><input type="checkbox" data-k="noise" ${f.noise ? 'checked' : ''}> ${t('noise')}</label>
    <h4>${t('amp')}</h4><div class="row small-gap">${Object.keys(PRESETS).map((p) => `<button class="btn sm" data-preset="${p}">${t(`ampList.${p}`)}</button>`).join('')}</div>
    ${SLIDERS.map(([k, l, min, max, step, fmt]) => `<div class="slider"><span>${t(l)}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${f[k]}"><output>${fmt(f[k])}</output></div>`).join('')}`;
  if (!$('#dlg-audio').open) $('#dlg-audio').showModal();
}
$('#audio-body').oninput = (e) => {
  const k = e.target.dataset.k; if (!k) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.tagName === 'SELECT' ? e.target.value : Number(e.target.value);
  if (k === 'musicVolume') { voice.fx.musicVolume = v; video?.setVolume(v); } else voice.setFx(k, v);
  if ((k === 'noise' || k === 'monitor' || k === 'micId') && voice.micActive) { voice.micOff(); voice.micOn().catch(micError); }
  if (k === 'monitor') renderHud();
  const out = e.target.nextElementSibling; const sl = SLIDERS.find((s) => s[0] === k); if (out && sl) out.textContent = sl[5](v);
};
$('#audio-body').onclick = (e) => { const p = e.target.dataset.preset; if (p) { voice.applyPreset(p); openAudio(); } };

// ======================================================= global buttons
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action],[data-react],[data-emote],[data-close]'); if (!b) return;
  if (b.dataset.close != null) return b.closest('dialog').close();
  if (b.dataset.react) return net.send({ type: 'react', kind: b.dataset.react });
  if (b.dataset.emote) { engine?.emote(S.selfId, b.dataset.emote); return net.send({ type: 'emote', kind: b.dataset.emote }); }
  switch (b.dataset.action) {
    case 'admin': net.send({ type: 'proom.admin' }); renderAdmin(); return $('#dlg-admin').showModal();
    case 'gfx': { const order = ['auto', 'high', 'medium', 'low']; const next = order[(order.indexOf(engine.gfxMode) + 1) % order.length]; engine.setGraphics(next); return toast(t('gfxChanged', { mode: t(`gfx.${next}`) })); }
    case 'lang': setLang(getLang() === 'vi' ? 'en' : 'vi'); renderGfx(); applyI18n(); renderHud(); renderViewUi(); if (S.room) { renderNowPlaying(); renderQueue(); } if (S.mode === 'creator') creator.render(); return;
    case 'reception': return openReception('rooms');
    case 'friends': return openReception('friends');
    case 'club': return openReception('club');
    case 'recordings': return openRecordings();
    case 'quests': return openReception('quests');
    case 'photo': return takePhotoBooth();
    case 'share': return openShare();
    case 'tabrec': return toggleTabRec();
    case 'shop': return openReception('shop');
    case 'wardrobe': return openReception('wardrobe');
    case 'character': return openCreator('edit');
    case 'leave': return leaveRoom();
    case 'cinema': { const on = !engine.cam.cinema; engine.setCinema(on); $('#btn-cinema').classList.toggle('on', on); $('#btn-cinema').title = on ? t('exitCinema') : t('cinema'); return; }
    case 'songs-panel': case 'panel-collapse': return setPanelCollapsed(!$('#room-panel').classList.contains('collapsed'));
    case 'kiosk': return openKiosk();
    case 'table': return openTable();
    case 'staff': return openStaff();
    case 'panel': return openPanel();
    case 'audio': return openAudio();
    case 'menu': closeSheets('menu-open'); return document.body.classList.toggle('menu-open');
    case 'tray-toggle': closeSheets('tray-open'); return document.body.classList.toggle('tray-open');
    case 'chat-toggle': closeSheets('chat-open'); document.body.classList.add('chat-open'); return $('#chat-input').focus();
    case 'drink': return net.send({ type: 'act', kind: 'drink' });
    case 'cheers': return net.send({ type: 'act', kind: 'cheers' });
    case 'drop': return net.send({ type: 'take', item: '' });
    case 'logout': if (S.room) leaveRoom(); voice.leaveRoom(); net.send({ type: 'auth.logout' }); store.set('token', null); net.hello.token = null; S.me = null; return showAuth();
    case 'mic': {
      try {
        if (voice.micActive) { voice.micOff(); net.send({ type: 'mic', on: false }); syncRecorder(); }
        else {
          voice.resumeAudio(); await voice.micOn(); net.send({ type: 'mic', on: true }); syncRecorder(); voice.report('micOn', { ctxAfter: voice.ctx?.state });
          if (![...S.peers.values()].some((p) => !p.bot && p.id !== S.selfId) && !voice.fx.monitor) toast(t('micAlone'));
        }
      } catch (er) { micError(er); voice.report('error', { msg: `mic ${er.code ?? ''} ${er.message ?? ''}` }); }
      return renderHud();
    }
    case 'headphones': {
      voice.setFx('monitor', !voice.fx.monitor);
      if (voice.micActive) { voice.micOff(); try { await voice.micOn(); } catch (er) { micError(er); net.send({ type: 'mic', on: false }); } } // re-open: echo cancellation follows headphone mode
      toast(voice.fx.monitor ? t('headphonesOn') : t('headphonesOff'));
      return renderHud();
    }
  }
});
$('#chat-form').onsubmit = (e) => { e.preventDefault(); const v = $('#chat-input').value.trim(); if (v) net.send({ type: 'chat', text: v }); $('#chat-input').value = ''; $('#chat-input').blur(); document.body.classList.remove('chat-open'); };
$('#chat-input').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('#chat-input')) document.body.classList.remove('chat-open'); }, 150));

// ---- phone controls: joystick, ☰ menu, 😊 tray, 💬 chat ----
attachJoystick($('#joystick'), (x, y) => { if (engine) engine.joy = { x, y }; });
attachJoystick($('#lookstick'), (x, y) => { if (engine) engine.lookJoy = { x, y }; });
// iPhone Safari treats swipes as browser gestures (edge swipe = back, pull down = reload): inside the game, touches
// on the 3D view and the sticks never reach the browser. Dialogs and lists keep their normal scrolling.
const gameTouch = (e) => !!e.target.closest?.('#game-canvas, #labels, .joystick, .hud-bottom, .hud-top') && !e.target.closest('dialog, .tray, .menu-sheet, input, select, textarea');
document.addEventListener('touchstart', (e) => {
  const x = e.touches[0]?.clientX ?? 0;
  if (e.target.closest?.('#game-canvas, #labels') && (x < 30 || x > innerWidth - 30)) e.preventDefault(); // block the edge-swipe "back" gesture (3D view only: buttons keep their taps)
}, { passive: false });
document.addEventListener('touchmove', (e) => { if (gameTouch(e) || e.touches.length > 1) e.preventDefault(); }, { passive: false }); // no scroll / pull-to-refresh / pinch zoom
document.addEventListener('gesturestart', (e) => e.preventDefault()); // Safari pinch
const closeSheets = (except) => { for (const c of ['menu-open', 'tray-open', 'chat-open']) if (c !== except) document.body.classList.remove(c); };
document.addEventListener('pointerdown', (e) => { // tap outside closes the menu / tray
  if (!e.target.closest('.menu-sheet, [data-action=menu], .tray, [data-action=tray-toggle], .chat-form, [data-action=chat-toggle]')) closeSheets();
}, true);
$('#menu-sheet').addEventListener('click', (e) => { if (e.target.closest('[data-action]')) document.body.classList.remove('menu-open'); });
addEventListener('keydown', (e) => { if (e.key === 'Enter' && S.mode && ['lobby', 'room'].includes(S.mode) && document.activeElement !== $('#chat-input') && !document.querySelector('dialog[open]')) { e.preventDefault(); $('#chat-input').focus(); } });

// ======================================================= server events
net.on('welcome', (m) => {
  // a deploy restarted the server with new client files: reload (later if this player is singing on the mic)
  if (S.build && m.build && S.build !== m.build) {
    const reload = () => { if (voice.micActive) return setTimeout(reload, 5000); location.reload(); };
    toast(t('newVersion'), 'sticky'); setTimeout(reload, 2500);
  }
  S.build ??= m.build;
  Object.assign(S, { shop: m.shop, slots: m.slots, prices: m.prices, earn: m.earn, searchEnabled: m.searchEnabled }); setIceServers(m.iceServers); setVoiceMode(m.voice); });
net.on('me', (m) => {
  if (m.token) store.set('token', m.token);
  const first = !S.me; S.me = m.me;
  if (!m.me) { if (S.mode !== 'creator') showAuth(); return; }
  setCoins(); renderAdmin(); renderQuestBadge();
  if ($('#dlg-reception').open && S.recTab === 'rooms') renderReception();
  if (first || S.afterAuth) {
    const next = S.afterAuth; S.afterAuth = null;
    if (next === 'creator') return openCreator('register');
    if (S.room) return net.send({ type: 'room.join', room: S.room.id }); // reconnect
    if (S.deepRoom) { const room = S.deepRoom; S.deepRoom = null; return net.send({ type: 'room.join', room }); } // opened from a shared room link
    return net.send({ type: 'lobby.enter' });
  }
  if ($('#dlg-reception').open) renderReception();
  if ($('#dlg-staff').open) openStaff();
  if (engine?.world?.avatars.has(m.me.id)) engine.updatePeer({ id: m.me.id, name: m.me.name, look: m.me.look, equipped: m.me.equipped });
});
net.on('lobby.state', (m) => {
  if (S.mode === 'room') { recorder.stop(); voice.stopTabCapture(); voice.leaveRoom(); } // room closed / moved to the lobby by the server: no voice left open
  S.mode = 'lobby'; S.room = null; S.rooms = m.rooms; S.hostId = null;
  enterWorld(new LobbyWorld(m.rooms.filter((r) => !r.private)), m.peers, m.selfId); // private rooms have no lobby door
  chatLine(esc(t('receptionGreeting', { name: S.me.name })), true);
});
net.on('room.state', (m) => {
  S.mode = 'room'; S.room = m.room; S.hostId = m.hostId; S.queue = m.queue; S.playback = m.playback; S.stock = m.stock; S.effects = m.effects; S.seats = m.seats; S.prices = m.prices;
  const world = new RoomWorld(m.room, m.seats); world.setStock(m.stock); world.setEffects(m.effects);
  enterWorld(world, m.peers, m.selfId);
  voice.setRoom(S.selfId, m.peers.filter((p) => !p.bot).map((p) => p.id));
  renderNowPlaying(); renderQueue(); video.apply(m.playback); video.setVolume(voice.fx.musicVolume ?? 1);
  chatLine(esc(t('welcomeRoom', { room: m.room.name })), true);
  $('#room-hint').textContent = t('headphonesTip');
});
net.on('rooms', (m) => { S.rooms = m.rooms; engine?.world?.setRooms?.(m.rooms); if ($('#dlg-reception').open && S.recTab === 'rooms') renderReception(); });
net.on('peer.join', (m) => {
  if (m.peer.id === S.selfId || !engine?.world) return;
  S.peers.set(m.peer.id, m.peer); engine.addPeer(m.peer, false); renderHud();
  if (S.mode === 'room' && !m.peer.bot) voice.addPeer(m.peer.id);
  if (!m.peer.bot) chatLine(`${esc(m.peer.name)} 👋`, true);
});
net.on('peer.leave', (m) => { S.peers.delete(m.id); engine?.removePeer(m.id); voice.removePeer(m.id); renderHud(); });
net.on('peer.update', (m) => { S.peers.set(m.peer.id, m.peer); engine?.updatePeer(m.peer); engine?.setMic(m.peer.id, m.peer.mic); });
net.on('peer.move', (m) => { if (m.id === S.selfId) engine.placeSelf(m); else engine?.movePeer(m.id, m); });
net.on('chat', (m) => { if (isBlocked(m.id)) return; chatLine(`<b>${esc(m.name)}:</b> ${esc(m.text)}`); engine?.bubble(m.id, m.text); });
net.on('emote', (m) => { if (m.id !== S.selfId) engine?.emote(m.id, m.kind); });
net.on('react', (m) => engine?.react(m.id, m.kind));
net.on('held', (m) => {
  engine?.setHeld(m.id, m.item);
  if (m.id === S.selfId) {
    $('#held-bar').classList.toggle('hidden', !m.item);
    if (m.item) { $('#held-text').textContent = t('hold', { item: t(`items.${m.item}`) }); $('#btn-drink').textContent = ['fruit', 'cake', 'pizza'].includes(m.item) ? t('eat') : t('drink'); }
  }
});
net.on('stock', (m) => { S.stock = m.stock; engine?.world?.setStock?.(m.stock); });
net.on('act', (m) => {
  engine?.act(m.id, m.kind === 'drink' && ['fruit', 'cake', 'pizza'].includes(m.item) ? 'eat' : m.kind);
  if (m.buzz != null) engine?.setBuzz(m.id, m.buzz);
  if (m.kind === 'cheers') { for (const id of m.with ?? []) engine?.act(id, 'cheers'); chatLine(`🍻 ${esc(peerName(m.id))}${m.with?.length ? ` + ${m.with.map(peerName).map(esc).join(', ')}` : ''}: ${t('cheers').replace(/ *\(G\)/, '')}`, true); }
});
net.on('buzz', (m) => engine?.setBuzz(m.id, m.buzz));
net.on('effects', (m) => { S.effects = m.effects; engine?.world?.setEffects?.(m.effects); if ($('#dlg-panel').open) openPanel(); });
net.on('host', (m) => { S.hostId = m.hostId; renderHud(); renderQueue(); });
net.on('queue', (m) => { S.queue = m.queue; renderQueue(); });
net.on('playback', (m) => { S.playback = m; renderNowPlaying(); video?.apply(m); syncRecorder(); });
net.on('notice', (m) => { const text = t(`notice.${m.code}`, m.quest ? { ...m, q: t(`quest.${m.quest}`) } : m); chatLine(esc(text), true); if (m.code !== 'queued') toast(text, ['asked', 'newbieBonus', 'inviteJoined'].includes(m.code) ? 'sticky-long' : ''); });
net.on('show', (m) => {
  const w = engine?.world; if (!w?.fx) return;
  let at = null;
  if (m.kind === 'gift') { const singer = S.playback?.song?.singers[0]; at = singer ? engine.position(singer) : { x: 0, z: -4 }; }
  if (m.kind === 'entrance') at = engine.position(m.id);
  w.fx.show(m.kind, m.item, at);
  const text = m.kind === 'food' ? t('show.food', { by: m.by, item: t(`items.${m.item}`) }) : m.kind === 'entrance' ? `✨ ${m.by}` : t(`show.${m.item}`, { by: m.by });
  chatLine(esc(text), true);
});
net.on('control.request', async (m) => {
  S.pendingReq = m.reqId;
  const ok = await confirmBox(t('controlAsk', { name: m.fromName, action: t(`actions.${m.action}`) }), t('allow'), t('deny'), m.timeoutSec ?? 10);
  if (ok !== null && S.pendingReq === m.reqId) net.send({ type: 'control.answer', reqId: m.reqId, accept: ok }); // null = timed out, server applies it
  S.pendingReq = null;
});
net.on('control.expired', (m) => { if (S.pendingReq === m.reqId) { S.closeConfirm?.(); toast(t('notice.expired')); } });
net.on('control.answer', (m) => toast(t(m.auto ? 'notice.autoAllowed' : m.accept ? 'notice.allowed' : 'notice.denied')));
net.on('duet.invited', async (m) => { if (await confirmBox(t('duetInvited', { name: m.from, title: m.title }), t('accept'), t('decline'))) net.send({ type: 'duet.accept', songId: m.songId }); });
net.on('coins', (m) => {
  if (S.me) S.me.coins = m.coins; setCoins();
  if (m.reason !== 'listen' && m.reason !== 'spend') toast(`+${m.delta} 🪙 ${t(`coins.${m.reason}`)}`, 'coin');
});
$('#admin-rooms').onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.rv) { const ok = b.dataset.ok === '1'; const note = ok ? '' : (prompt(t('adminRejectNote')) ?? ''); net.send({ type: 'proom.review', id: b.dataset.rv, approve: ok, note }); }
  if (b.dataset.pdel && await confirmBox(t('proomDeleteAsk', { name: b.dataset.pname }), t('proomDelete'), t('cancel'))) net.send({ type: 'proom.delete', room: b.dataset.pdel });
};
net.on('proom.admin', (m) => { S.proomAdmin = m; renderAdmin(); });
$('#proom-form').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); net.send({ type: 'proom.request', name: f.get('name'), capacity: Number(f.get('capacity')), blurb: f.get('blurb') }); $('#dlg-proom').close(); };
// private room: ask for the entry code (and again if it was wrong)
net.on('room.locked', (m) => {
  S.lockedRoom = m.room; $('#code-hint').textContent = t('proomEnterHint', { name: m.name });
  $('#code-wrong').classList.toggle('hidden', !m.wrong); const f = $('#code-form'); f.code.value = '';
  if (!$('#dlg-code').open) $('#dlg-code').showModal(); f.code.focus();
});
$('#code-form').onsubmit = (e) => { e.preventDefault(); const code = new FormData(e.target).get('code'); $('#dlg-code').close(); net.send({ type: 'room.join', room: S.lockedRoom, code }); };
$('#admin-form').onclick = (e) => { const a = e.target.dataset.amt; if (a) e.target.closest('form').amount.value = a; };
$('#admin-form').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); net.send({ type: 'admin.grant', username: f.get('username'), amount: Number(f.get('amount')) }); };
net.on('admin.ok', (m) => toast(t('adminOk', { ...m, delta: m.delta >= 0 ? `+${m.delta}` : m.delta }), 'coin'));
net.on('leaderboard', (m) => { S.board = m; if ($('#dlg-reception').open && S.recTab === 'board') renderReception(); });
net.on('error', (m) => {
  if (['badUsername', 'badPassword', 'taken', 'badLogin'].includes(m.code)) { const form = S.afterAuth === 'creator' ? '#auth-register' : '#auth-login'; $(`${form} .form-error`).textContent = t(`errors.${m.code}`); S.afterAuth = null; return; }
  err(m.code);
});
net.on('rtc', (m) => voice.onSignal(m.from, m.data).catch((e) => console.warn('rtc', e)));
net.on('sfu', (m) => voice.onSfuReply(m));
net.on('sfu.track', (m) => voice.onSfuTrack(m.id));
net.on('sfu.untrack', (m) => voice.onSfuUntrack(m.id));
net.on('kicked', (m) => err(m.code));

// ---- waiting room: the server is at its player limit ----
let waitTipTimer = null; let waitTip = 0; let retryTimer = null; const TITLE = document.title;
net.on('wait', (m) => {
  if (m.token) store.set('token', m.token);
  if (!$('#s-wait').classList.contains('active')) {
    show('s-wait'); S.mode = 'wait';
    clearInterval(waitTipTimer); const tips = t('waitTips'); $('#wait-tip').textContent = tips[0];
    waitTipTimer = setInterval(() => { waitTip = (waitTip + 1) % tips.length; $('#wait-tip').textContent = tips[waitTip]; }, 6000);
  }
  $('#wait-title').textContent = t(m.full ? 'waitFullTitle' : 'waitTitle');
  $('#wait-queue').classList.toggle('hidden', !!m.full); $('#wait-full').classList.toggle('hidden', !m.full);
  $('#wait-pos').textContent = m.position ?? '–';
  $('#wait-of').textContent = t('waitOf', { n: m.waiting ?? 0 });
  $('#wait-online').textContent = t('waitOnline', { online: m.online, max: m.max });
  $('#wait-bar').style.width = `${Math.min(100, Math.round((m.online / Math.max(1, m.max)) * 100))}%`;
  document.title = t('waitDoc', { n: m.position ?? '–' });
  if (m.full) { // the server closes us: reconnect (and queue again) in 30 s, not every 1.5 s
    net.retryDelay = 30000; let n = 30; clearInterval(retryTimer); $('#wait-retry').textContent = n;
    retryTimer = setInterval(() => { n = Math.max(0, n - 1); $('#wait-retry').textContent = n; if (!n) clearInterval(retryTimer); }, 1000);
  }
});
net.on('me', (m) => { // let in from the queue
  if (!m.me || !$('#s-wait').classList.contains('active')) return;
  clearInterval(waitTipTimer); clearInterval(retryTimer); document.title = TITLE;
  toast(t('waitIn')); try { navigator.vibrate?.(200); } catch {}
});
$('#btn-wait-leave').onclick = () => { clearInterval(waitTipTimer); clearInterval(retryTimer); document.title = TITLE; net.send({ type: 'queue.leave' }); S.me = null; showAuth(); };
net.on('close', () => toast(t('reconnecting'), 'err'));
net.on('open', () => { if (S.me) S.afterAuth = 'rejoin'; });

// ======================================================= boot
{ // links shared by other players: ?ref=<inviter> (kept until sign-up), ?room=<public room to open>
  const q = new URLSearchParams(location.search);
  if (/^[0-9a-f]{12}$/.test(q.get('ref') ?? '')) store.set('ref', q.get('ref'));
  if (/^[\w-]{1,24}$/.test(q.get('room') ?? '')) S.deepRoom = q.get('room');
  if (q.has('ref') || q.has('room')) history.replaceState(null, '', location.pathname);
}
setLang(getLang()); applyI18n();
net.connect({ token: store.get('token') });
showAuth();
