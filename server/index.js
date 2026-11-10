// KTV server: static files, one WebSocket per client, a walkable lobby, karaoke rooms,
// accounts, bots and WebRTC signaling relay.
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, ROOM_DEFS, SEATS, PRICES, EARN, EFFECTS } from './rooms.js';
import { Space } from './space.js';
import { Profiles, SHOP, SLOTS } from './profiles.js';
import { BotCrowd } from './bots.js';
import { searchYouTube } from './ytsearch.js';
import { IceProvider, readTurnKey } from './turn.js';
import { PrivateRooms } from './privaterooms.js';
import { VoiceHub, readSfuKey } from './sfu.js';
import { Gate } from './gate.js';
import { Clubs, CLUB_PRICE, CLUB_ICONS } from './clubs.js';
import { Quests } from './quests.js';
import { Social, ASK_KINDS, FREE_KINDS, FLOWER_PRICE, FLOWER_SHARE, NEAR } from './social.js';

const PORT = Number(process.env.PORT || 8080);
const YT_API_KEY = process.env.YT_API_KEY || '';
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const HERE = path.dirname(fileURLToPath(import.meta.url));
// WebRTC ICE servers: Cloudflare TURN when data/turn.json or CF_TURN_* env is set, else free STUN (see server/turn.js)
const ice = new IceProvider({ key: readTurnKey(path.resolve(HERE, '../data/turn.json')) });
// room voice: Cloudflare Realtime SFU when data/sfu.json or CF_SFU_* env is set, else peer-to-peer mesh (see server/sfu.js)
const hub = new VoiceHub({ key: readSfuKey(path.resolve(HERE, '../data/sfu.json')) });
const PUBLIC = path.resolve(HERE, '../public');
// build id of the client files: sent in 'welcome' so open tabs reload themselves after a deploy
const BUILD = (() => { const h = crypto.createHash('sha1'); const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else { const st = fs.statSync(p); h.update(`${p}:${st.size}:${st.mtimeMs}`); } } }; walk(PUBLIC); return h.digest('hex').slice(0, 10); })();
const profiles = new Profiles(path.resolve(HERE, '../data/db.json'));
// secret for the local admin CLI (`npm run coins`, `npm run admin`): created once, kept in data/admin.key
const ADMIN_KEY_FILE = path.resolve(HERE, '../data/admin.key');
if (!fs.existsSync(ADMIN_KEY_FILE)) { fs.mkdirSync(path.dirname(ADMIN_KEY_FILE), { recursive: true }); fs.writeFileSync(ADMIN_KEY_FILE, crypto.randomBytes(24).toString('hex'), { mode: 0o600 }); }
const ADMIN_KEY = fs.readFileSync(ADMIN_KEY_FILE, 'utf8').trim();
// how many players may be in the game at once (load test on this i5-8350U: ~300 smooth, lag from ~450);
// later arrivals wait in a queue. MAX_WAITING keeps open sockets under ulimit -n 1024.
const gate = new Gate({ max: Number(process.env.MAX_ONLINE || 300), maxWaiting: Number(process.env.MAX_WAITING || 500) });
const ONLINE_REWARD = { every: 5, coins: 20 }; // minutes online (lobby or room) → coins, accounts only
const BOTS_PER_ROOM = Number(process.env.BOTS_PER_ROOM ?? 2);
const BOTS_IN_LOBBY = Number(process.env.BOTS_IN_LOBBY ?? 3);

// ---------- clients ----------
const clients = new Map(); // ws -> { profile, token, space: null | 'lobby' | roomId }
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const wsOf = (profileId) => { for (const [ws, c] of clients) if (c.profile?.id === profileId) return ws; return null; };
function scoped(spaceId) {
  return (msg, exceptId) => {
    if (msg.to) { const ws = wsOf(msg.to); if (ws && clients.get(ws)?.space === spaceId) send(ws, msg); return; }
    for (const [ws, c] of clients) if (c.space === spaceId && c.profile.id !== exceptId) send(ws, msg);
  };
}

// ---------- spaces ----------
const lobby = new Space({ id: 'lobby', capacity: 60, bounds: { x: [-13, 13], z: [-6, 10] }, broadcast: scoped('lobby') });
const lobbyBots = new BotCrowd(lobby, { isRoom: false });
const rooms = new Map(); const roomBots = new Map();
const privateRooms = new PrivateRooms(profiles);
const clubs = new Clubs(profiles);
const social = new Social(profiles);
const quests = new Quests(profiles);
// a quest-relevant event for a player: tell them when a quest gets done (they claim it in 🎯 Quests)
function questEv(id, ev, n = 1) {
  const p = profiles.get(id); if (!p || p.guest) return;
  const done = quests.track(p, ev, n); if (!done.length) return;
  const ws = wsOf(id); if (!ws) return;
  for (const q of done) send(ws, { type: 'notice', code: 'questDone', quest: q });
  send(ws, { type: 'quests', ...quests.state(p) }); refreshMe(ws);
}
function payInviter(p) { // the invited player finished a first song
  const r = quests.firstSong(p); if (!r) return;
  const ws = wsOf(r.inviter.id); if (!ws) return;
  send(ws, { type: 'coins', coins: r.inviter.coins, delta: r.coins, reason: 'invite' }); send(ws, { type: 'notice', code: 'inviteJoined', name: p.name });
  for (const q of r.done) send(ws, { type: 'notice', code: 'questDone', quest: q });
  refreshMe(ws);
}
{ const stat = profiles.stat.bind(profiles); profiles.stat = (id, key, amount) => { stat(id, key, amount); clubs.addPoints(id, key, amount);
  if (key === 'songs') { questEv(id, 'sing', amount); payInviter(profiles.get(id)); } if (key === 'spent' && amount > 0) questEv(id, 'spend', 1); }; } // activity → club points + quests
function createRoom(def) {
  const room = new Room(def, {
    broadcast: scoped(def.id),
    reward: (id, amount, reason) => { if (reason === 'listen') questEv(id, 'listen', EARN.listenEvery); const coins = profiles.addCoins(id, amount); const ws = wsOf(id); if (ws && coins != null) send(ws, { type: 'coins', coins, delta: amount, reason }); },
    spend: (id, amount) => { const ok = profiles.spend(id, amount); const ws = wsOf(id); if (ok && ws) send(ws, { type: 'coins', coins: profiles.get(id).coins, delta: -amount, reason: 'spend' }); return ok; },
    stat: (id, key, amount) => profiles.stat(id, key, amount),
  });
  rooms.set(def.id, room); roomBots.set(def.id, new BotCrowd(room, { isRoom: true }));
  return room;
}
for (const def of ROOM_DEFS) createRoom(def);
for (const def of privateRooms.defs()) createRoom(def); // approved private rooms (persisted)

// close a private room: everyone inside goes back to the lobby
function closeRoom(roomId) {
  const room = rooms.get(roomId); if (!room) return;
  for (const [ws, c] of clients) if (c.space === roomId) { send(ws, { type: 'notice', code: 'roomClosed', name: room.def.name }); enterLobby(ws); }
  rooms.delete(roomId); roomBots.delete(roomId); markRooms();
}
const admins = () => [...clients].filter(([, c]) => c.profile?.admin).map(([ws]) => ws);
const pushAdminRooms = () => { const view = privateRooms.adminView(); for (const ws of admins()) send(ws, { type: 'proom.admin', ...view }); };
const roomList = () => [...rooms.values()].map((r) => r.publicInfo());
const pushRooms = () => { const list = roomList(); for (const [ws, c] of clients) if (c.space === 'lobby') send(ws, { type: 'rooms', rooms: list }); };
let roomsDirty = false; const markRooms = () => { roomsDirty = true; };

setInterval(() => {
  for (const [id, r] of rooms) {
    r.tick();
    const crowd = roomBots.get(id);
    crowd.ensure(r.humans().length && !r.def.private ? BOTS_PER_ROOM : 0); // private rooms: people only
    crowd.step(); r.staff.step(); r.dancers.step();
  }
  lobbyBots.ensure(lobby.humans().length ? BOTS_IN_LOBBY : 0); lobbyBots.step();
  if (roomsDirty) { roomsDirty = false; pushRooms(); }
}, 1000);
setInterval(() => { for (const r of rooms.values()) r.payListeners(); }, EARN.listenEvery * 1000);
setInterval(() => profiles.flush(), 5000);
setInterval(() => { // online reward
  for (const [ws, c] of clients) {
    if (!c.profile || c.profile.guest || !c.space) continue;
    c.mins = (c.mins ?? 0) + 1; questEv(c.profile.id, 'online', 1);
    if (c.mins % ONLINE_REWARD.every === 0) { const coins = profiles.addCoins(c.profile.id, ONLINE_REWARD.coins); send(ws, { type: 'coins', coins, delta: ONLINE_REWARD.coins, reason: 'online' }); refreshMe(ws); }
  }
}, 60_000);

// tell an online player that their coins changed (admin grant)
function pushCoins(profile, delta, reason) {
  const ws = wsOf(profile.id); if (!ws) return;
  send(ws, { type: 'coins', coins: profile.coins, delta, reason }); refreshMe(ws);
}

function leaveSpace(ws) {
  const c = clients.get(ws); if (!c?.space) return;
  if (c.space === 'lobby') lobby.remove(c.profile.id);
  else { rooms.get(c.space)?.remove(c.profile.id); hub.leave(c.profile.id); markRooms(); }
  c.space = null;
}

function enterLobby(ws) {
  const c = clients.get(ws); leaveSpace(ws);
  c.space = 'lobby';
  const m = lobby.add(profiles.publicView(c.profile), { x: (Math.random() - 0.5) * 6, z: 7 + Math.random() * 2 });
  send(ws, { type: 'lobby.state', peers: lobby.snapshotMembers(), rooms: roomList(), selfId: m?.id });
  lobbyBots.greet(c.profile.name);
}

function enterRoom(ws, roomId, entryCode) {
  const c = clients.get(ws); const room = rooms.get(roomId);
  if (!room) return send(ws, { type: 'error', code: 'noRoom' });
  if (room.def.private) { // wrong codes: at most 5 per minute per connection (no brute-forcing the 6-letter code)
    const now = Date.now(); c.codeTries = (c.codeTries ?? []).filter((t) => now - t < 60_000);
    if (entryCode && c.codeTries.length >= 5) return send(ws, { type: 'error', code: 'tooFast' });
    if (!privateRooms.canEnter(roomId, c.profile, entryCode)) { if (entryCode) c.codeTries.push(now); return send(ws, { type: 'room.locked', room: roomId, name: room.def.name, wrong: !!entryCode }); }
  }
  if (room.humans().length >= room.capacity) return send(ws, { type: 'error', code: 'roomFull' }); // bots never take a slot
  leaveSpace(ws);
  c.space = roomId;
  room.add(profiles.publicView(c.profile), { x: (Math.random() - 0.5) * 5, z: 2.6 + Math.random() * 1.4 });
  send(ws, { type: 'room.state', selfId: c.profile.id, seats: SEATS, effectsList: EFFECTS, ...room.snapshot() });
  const entrance = c.profile.equipped.find((e) => e.startsWith('entrance-'));
  if (entrance) room.broadcast({ type: 'show', kind: 'entrance', item: entrance, id: c.profile.id, by: c.profile.name });
  roomBots.get(roomId).greet(c.profile.name);
  markRooms();
}

// signed in: into the game if there is room, else into the waiting queue (admins and a second tab never wait)
function signedIn(ws, profile, token) {
  if (!clients.has(ws)) return;
  const same = wsOf(profile.id);
  const r = gate.request(ws, { profile, token }, { vip: !!profile.admin || (!!same && same !== ws) });
  if (r === 'in') return enterGame(ws, profile, token);
  if (r === 'full') { send(ws, { type: 'wait', full: true, ...gate.status() }); setTimeout(() => ws.close(), 300); return; }
  clients.get(ws).token = token;
  send(ws, { type: 'wait', position: gate.position(ws), ...gate.status(), token });
}
const queueStatus = () => { for (const w of gate.waiting) send(w.conn, { type: 'wait', position: gate.position(w.conn), ...gate.status() }); };
function leaveGate(ws) {
  for (const w of gate.leave(ws)) if (clients.has(w.conn)) enterGame(w.conn, w.data.profile, w.data.token);
  queueStatus();
}
setInterval(queueStatus, 4000);

function enterGame(ws, profile, token) {
  const c = clients.get(ws); if (!c) return; // closed while we waited
  if (c.profile && c.profile.id !== profile.id) leaveSpace(ws); // switching identity on this socket: drop the old member (no ghosts)
  const old = wsOf(profile.id); if (old && old !== ws) { send(old, { type: 'kicked', code: 'otherTab' }); old.close(); }
  const firstSignIn = !c.profile; c.profile = profile; c.token = token;
  if (firstSignIn && !profile.guest) setTimeout(() => announceOnline(profile), 1500); // friends see you come online
  send(ws, { type: 'me', me: meView(profile), token });
  if (profile.admin) send(ws, { type: 'proom.admin', ...privateRooms.adminView() });
}

const meView = (p) => ({ ...profiles.privateView(p), questsReady: quests.ready(p), proom: privateRooms.mine(p.id), blocked: p.blocked ?? [], friendReqs: (p.friendReq ?? []).length });
function refreshMe(ws) {
  const c = clients.get(ws); send(ws, { type: 'me', me: meView(c.profile) });
  const view = profiles.publicView(c.profile);
  if (c.space === 'lobby') lobby.update(c.profile.id, view); else if (c.space) rooms.get(c.space)?.update(c.profile.id, view);
}

async function videoMeta(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`);
    if (r.ok) { const j = await r.json(); return { title: j.title, channel: j.author_name }; }
  } catch {}
  return { title: `YouTube · ${videoId}`, channel: '' };
}

// ---------- clubs ----------
// where a member is right now (for "go to them"): lobby, a public room (joinable) or a private room (code needed)
function whereIs(profileId) {
  const ws = wsOf(profileId); const c = ws && clients.get(ws); if (!c?.space) return ws ? { online: true } : { online: false };
  if (c.space === 'lobby') return { online: true, place: 'lobby' };
  const r = rooms.get(c.space); return { online: true, place: 'room', room: c.space, roomName: r?.def.name, private: !!r?.def.private };
}
const clubView = (club, viewerId) => { const v = clubs.view(club, viewerId); v.members = v.members.map((m) => ({ ...m, ...whereIs(m.id) })).sort((a, b) => b.online - a.online); return v; };
function pushClub(club) { for (const id of club.members) { const ws = wsOf(id); if (ws) send(ws, { type: 'club.state', club: clubView(club, id) }); } }
function clubNotice(profileId, code, extra = {}) { const ws = wsOf(profileId); if (ws) send(ws, { type: 'notice', code, ...extra }); }
setInterval(() => { // weekly prize for the top 3 clubs
  for (const w of clubs.awardLastWeek()) { const ws = wsOf(w.profile.id); if (ws) { send(ws, { type: 'coins', coins: w.profile.coins, delta: w.coins, reason: 'club' }); send(ws, { type: 'notice', code: 'clubPrize', name: w.club.name, rank: w.rank, coins: w.coins }); refreshMe(ws); } }
}, 60_000);
function onClub(ws, c, msg) {
  const me = c.profile; const err = (code) => send(ws, { type: 'error', code });
  const changed = (club, ...who) => { for (const p of who) { const w = p && wsOf(p.id); if (w) refreshMe(w); } if (club && clubs.get(club.id)) pushClub(club); };
  switch (msg.type) {
    case 'club.list': {
      const q = String(msg.q ?? '').trim().toLowerCase().slice(0, 30);
      const list = clubs.ranking().filter((x) => !q || x.name.toLowerCase().includes(q) || x.tag.toLowerCase().includes(q)).slice(0, 50);
      const mine = clubs.of(me);
      return send(ws, { type: 'club.list', clubs: list, price: CLUB_PRICE, icons: CLUB_ICONS, pending: clubs.data.list.filter((x) => x.requests.includes(me.id)).map((x) => x.id), club: mine ? clubView(mine, me.id) : null });
    }
    case 'club.view': { const mine = clubs.of(me); return send(ws, { type: 'club.state', club: mine ? clubView(mine, me.id) : null }); }
    case 'club.create': { const r = clubs.create(me, msg); if (!r.ok) return err(r.error); send(ws, { type: 'coins', coins: me.coins, delta: -CLUB_PRICE, reason: 'spend' }); return changed(r.club, me); }
    case 'club.join': {
      const r = clubs.join(me, String(msg.id ?? '')); if (!r.ok) return err(r.error);
      if (r.requested) { clubNotice(r.club.ownerId, 'clubRequest', { name: me.name }); send(ws, { type: 'notice', code: 'clubRequested', name: r.club.name }); return pushClub(r.club); }
      for (const id of r.club.members) if (id !== me.id) clubNotice(id, 'clubWelcome', { name: me.name });
      return changed(r.club, me);
    }
    case 'club.cancel': clubs.cancelRequest(me, String(msg.id ?? '')); return;
    case 'club.answer': {
      const r = clubs.answer(me, String(msg.id ?? ''), !!msg.accept); if (!r.ok) return err(r.error);
      if (r.joined) clubNotice(r.joined.id, 'clubAccepted', { name: r.club.name });
      return changed(r.club, r.joined);
    }
    case 'club.leave': { const r = clubs.leave(me); if (!r.ok) return err(r.error); send(ws, { type: 'club.state', club: null }); return changed(r.club, me); }
    case 'club.kick': { const r = clubs.kick(me, String(msg.id ?? '')); if (!r.ok) return err(r.error); if (r.kicked) { clubNotice(r.kicked.id, 'clubKicked', { name: r.club.name }); const w = wsOf(r.kicked.id); if (w) send(w, { type: 'club.state', club: null }); } return changed(r.club, r.kicked); }
    case 'club.edit': { const r = clubs.edit(me, msg); if (!r.ok) return err(r.error); return pushClub(r.club); }
    case 'club.say': {
      const r = clubs.say(me, msg.text); if (!r) return;
      for (const id of r.club.members) { const w = wsOf(id); if (w) send(w, { type: 'club.msg', tag: r.club.tag, msg: r.msg }); }
      return;
    }
  }
}

// ---------- player ↔ player ----------
const spaceOf = (c) => (c?.space === 'lobby' ? lobby : c?.space ? rooms.get(c.space) : null);
const nameOf = (id) => profiles.get(id)?.name ?? '?';
function friendList(p) {
  const row = (id) => ({ id, name: nameOf(id), clubTag: profiles.get(id)?.clubTag ?? null, ...whereIs(id) });
  return { type: 'friend.list', friends: (p.friends ?? []).map(row).sort((a, b) => b.online - a.online), requests: (p.friendReq ?? []).map((id) => ({ id, name: nameOf(id) })), blocked: (p.blocked ?? []).map((id) => ({ id, name: nameOf(id) })) };
}
const pushFriends = (id) => { const ws = wsOf(id); const p = profiles.get(id); if (ws && p) { send(ws, friendList(p)); refreshMe(ws); } };
function announceOnline(profile) { for (const id of profile.friends ?? []) { const ws = wsOf(id); if (ws) send(ws, { type: 'notice', code: 'friendOnline', name: profile.name }); } }
function onSocial(ws, c, msg) {
  const me = c.profile; const err = (code) => send(ws, { type: 'error', code });
  const space = spaceOf(c);
  switch (msg.type) {
    case 'player.card': {
      const id = String(msg.id ?? ''); const m = space?.members.get(id); const p = profiles.get(id);
      if (!m && !p) return;
      const club = p ? clubs.of(p) : null; const week = p && !p.guest ? profiles.leaderboardRow(id) : null;
      return send(ws, { type: 'player.card', id, name: m?.name ?? p?.name, bot: !!m?.bot, guest: !!(p?.guest ?? m?.guest), here: !!m,
        club: club ? { tag: club.tag, name: club.name, icon: club.icon } : null, songs: week?.songs ?? 0, ...social.relation(me, id) });
    }
    case 'social.do': {
      const to = String(msg.to ?? ''); const kind = String(msg.kind ?? ''); const m = space?.members.get(to); const mine = space?.members.get(me.id);
      if (!m || !mine || to === me.id) return err('notHere');
      const target = profiles.get(to);
      if (target && social.apart(me, target)) return err('blocked');
      if (FREE_KINDS.includes(kind)) { questEv(me.id, 'social', 1); return space.broadcast({ type: 'social', kind, from: me.id, toId: to, fromName: me.name, toName: m.name }); }
      if (kind === 'flowers') {
        if (me.guest) return err('needAccount');
        if (!profiles.spend(me.id, FLOWER_PRICE)) return err('coins');
        send(ws, { type: 'coins', coins: me.coins, delta: -FLOWER_PRICE, reason: 'spend' }); profiles.stat(me.id, 'spent', FLOWER_PRICE);
        if (target && !target.guest && !m.bot) { const coins = profiles.addCoins(to, FLOWER_SHARE); profiles.stat(to, 'gifts', 1); const tw = wsOf(to); if (tw) send(tw, { type: 'coins', coins, delta: FLOWER_SHARE, reason: 'gift' }); }
        questEv(me.id, 'social', 1); return space.broadcast({ type: 'social', kind, from: me.id, toId: to, fromName: me.name, toName: m.name });
      }
      if (!ASK_KINDS.includes(kind)) return err('unknown');
      if (Math.hypot(m.x - mine.x, m.z - mine.z) > NEAR) return err('tooFar');
      if (m.bot) questEv(me.id, 'social', 1); if (m.bot) return space.broadcast({ type: 'social', kind, from: me.id, toId: to, fromName: me.name, toName: m.name }); // bots (hosts, dancers…) always say yes
      const r = social.ask(me, target ?? { id: to }, kind); if (!r.ok) return err(r.error);
      const tw = wsOf(to); if (!tw) return err('notHere');
      send(tw, { type: 'social.ask', id: r.id, kind, from: me.id, fromName: me.name });
      return send(ws, { type: 'notice', code: 'socialAsked', name: m.name });
    }
    case 'social.answer': {
      const r = social.answer(me, String(msg.id ?? ''), !!msg.accept); if (!r) return;
      const fw = wsOf(r.from); const fc = fw && clients.get(fw);
      if (!r.accepted) { if (fw) send(fw, { type: 'notice', code: 'socialDeclined', name: me.name }); return; }
      const a = space?.members.get(r.from); const b = space?.members.get(me.id);
      if (!a || !b || fc?.space !== c.space || Math.hypot(a.x - b.x, a.z - b.z) > NEAR + 1) { if (fw) send(fw, { type: 'error', code: 'tooFar' }); return; }
      questEv(r.from, 'social', 1); questEv(me.id, 'social', 1);
      return space.broadcast({ type: 'social', kind: r.kind, from: r.from, toId: me.id, fromName: a.name, toName: b.name });
    }
    case 'whisper': {
      const to = String(msg.to ?? ''); const text = String(msg.text ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
      const target = profiles.get(to); const tw = wsOf(to);
      if (!text || !target || to === me.id) return;
      if (social.apart(me, target)) return err('blocked');
      const now = Date.now(); if (now - (c.lastWhisper ?? 0) < 800) return err('tooFast'); c.lastWhisper = now;
      if (!tw) return err('offline');
      const out = { type: 'whisper', from: me.id, fromName: me.name, to, toName: target.name, text };
      send(tw, out); return send(ws, out);
    }
    case 'friend.list': return send(ws, friendList(me));
    case 'friend.add': {
      const other = profiles.get(String(msg.id ?? '')); const r = social.addFriend(me, other); if (!r.ok) return err(r.error);
      if (r.requested) { const ow = wsOf(other.id); if (ow) { send(ow, { type: 'notice', code: 'friendAsk', name: me.name }); refreshMe(ow); } send(ws, { type: 'notice', code: 'friendAsked', name: other.name }); }
      else { questEv(me.id, 'friend', 1); questEv(other.id, 'friend', 1); const ow = wsOf(other.id); if (ow) send(ow, { type: 'notice', code: 'friendNew', name: me.name }); send(ws, { type: 'notice', code: 'friendNew', name: other.name }); pushFriends(other.id); }
      return pushFriends(me.id);
    }
    case 'friend.accept': { const r = social.accept(me, String(msg.id ?? '')); if (!r.ok) return err(r.error); questEv(me.id, 'friend', 1); questEv(r.other.id, 'friend', 1); const ow = wsOf(r.other.id); if (ow) send(ow, { type: 'notice', code: 'friendNew', name: me.name }); pushFriends(r.other.id); return pushFriends(me.id); }
    case 'friend.decline': social.decline(me, String(msg.id ?? '')); return pushFriends(me.id);
    case 'friend.remove': { const r = social.unfriend(me, String(msg.id ?? '')); if (r.other) pushFriends(r.other.id); return pushFriends(me.id); }
    case 'block': { const r = social.setBlock(me, String(msg.id ?? ''), !!msg.on); if (!r.ok) return err(r.error); pushFriends(String(msg.id)); return pushFriends(me.id); }
  }
}

// ---------- messages ----------
async function onMessage(ws, msg) {
  const c = clients.get(ws);
  switch (msg.type) {
    case 'ping': return send(ws, { type: 'pong', t: msg.t, now: Date.now() });
    case 'hello': {
      const p = profiles.byToken(msg.token);
      send(ws, { type: 'welcome', shop: SHOP, slots: SLOTS, prices: PRICES, earn: EARN, searchEnabled: true, iceServers: await ice.get(), voice: hub.enabled ? 'sfu' : 'mesh', build: BUILD });
      if (!clients.has(ws)) return; // closed while fetching TURN credentials
      if (p) signedIn(ws, p, msg.token); else send(ws, { type: 'me', me: null });
      return;
    }
    case 'auth.guest': case 'auth.register': case 'auth.login': { // password hashing is CPU-heavy: at most 6 tries per 30 s per connection
      const now = Date.now(); c.authTries = (c.authTries ?? []).filter((t) => now - t < 30_000);
      if (c.authTries.length >= 6) return send(ws, { type: 'error', code: 'tooFast' });
      c.authTries.push(now);
    }
  }
  switch (msg.type) {
    case 'auth.guest': { const p = profiles.guest(msg); return signedIn(ws, p, p.token); }
    case 'auth.register': {
      const r = profiles.register({ ...msg, fromToken: c.token });
      if (!r.ok) return send(ws, { type: 'error', code: r.error });
      if (msg.ref && quests.joined(r.profile, msg.ref)) setTimeout(() => send(ws, { type: 'notice', code: 'newbieBonus', coins: quests.state(r.profile).invite.newbie }), 2500);
      return signedIn(ws, r.profile, r.token);
    }
    case 'auth.login': {
      const r = profiles.login(msg);
      if (!r.ok) return send(ws, { type: 'error', code: r.error });
      leaveSpace(ws); return signedIn(ws, r.profile, r.token);
    }
    case 'auth.logout': leaveSpace(ws); profiles.logout(c.token); c.profile = null; c.token = null; leaveGate(ws); return send(ws, { type: 'me', me: null });
    case 'queue.leave': if (!gate.position(ws)) return; leaveGate(ws); return send(ws, { type: 'me', me: null }); // only from the queue: a player inside must not free their slot
  }
  if (!c.profile) return;
  const me = c.profile.id;
  const room = c.space && c.space !== 'lobby' ? rooms.get(c.space) : null;
  const space = c.space === 'lobby' ? lobby : room;

  switch (msg.type) {
    case 'profile': profiles.update(me, msg); return refreshMe(ws);
    case 'lobby.enter': return enterLobby(ws);
    case 'room.join': return enterRoom(ws, msg.room, msg.code);
    // ----- private rooms -----
    case 'proom.request': {
      const r = privateRooms.request(c.profile, msg);
      if (!r.ok) return send(ws, { type: 'error', code: r.error });
      refreshMe(ws); send(ws, { type: 'notice', code: 'roomRequested', name: r.request.name });
      for (const a of admins()) send(a, { type: 'notice', code: 'roomRequestNew', name: `${r.request.ownerName}: ${r.request.name}` });
      return pushAdminRooms();
    }
    case 'proom.review': {
      if (!c.profile.admin) return send(ws, { type: 'error', code: 'notAdmin' });
      const r = privateRooms.review(msg.id, !!msg.approve, c.profile, msg.note);
      if (!r.ok) return send(ws, { type: 'error', code: r.error });
      if (r.room) { createRoom(privateRooms.def(r.room)); markRooms(); }
      const ows = wsOf(r.request.ownerId);
      if (ows) { refreshMe(ows); send(ows, { type: 'notice', code: r.room ? 'roomApproved' : 'roomRejected', name: r.request.name }); }
      return pushAdminRooms();
    }
    case 'proom.code': { const r = privateRooms.newCode(msg.room, c.profile); if (!r.ok) return send(ws, { type: 'error', code: r.error }); refreshMe(ws); return pushAdminRooms(); }
    case 'proom.delete': {
      const r = privateRooms.remove(msg.room, c.profile); if (!r.ok) return send(ws, { type: 'error', code: r.error });
      closeRoom(msg.room); refreshMe(ws); return pushAdminRooms();
    }
    case 'proom.admin': if (c.profile.admin) send(ws, { type: 'proom.admin', ...privateRooms.adminView() }); return;
    case 'player.card': case 'social.do': case 'social.answer': case 'whisper': case 'friend.list': case 'friend.add': case 'friend.accept': case 'friend.decline': case 'friend.remove': case 'block': return onSocial(ws, c, msg);
    case 'club.list': case 'club.view': case 'club.create': case 'club.join': case 'club.cancel': case 'club.answer': case 'club.leave': case 'club.kick': case 'club.edit': case 'club.say': return onClub(ws, c, msg);
    case 'checkin': { const r = profiles.checkin(me); if (r.ok) { clubs.addPoints(me, 'checkin', 1); questEv(me, 'checkin', 1); } if (!r.ok) return send(ws, { type: 'error', code: r.error }); send(ws, { type: 'coins', coins: c.profile.coins, delta: r.reward, reason: 'checkin' }); return refreshMe(ws); }
    case 'leaderboard': return send(ws, { type: 'leaderboard', ...profiles.leaderboard() });
    case 'quests': return c.profile.guest ? undefined : send(ws, { type: 'quests', ...quests.state(c.profile) });
    case 'quest.claim': {
      const r = quests.claim(c.profile, String(msg.id ?? '')); if (!r.ok) return send(ws, { type: 'error', code: r.error });
      profiles.addCoins(me, r.coins); send(ws, { type: 'coins', coins: c.profile.coins, delta: r.coins, reason: 'quest' });
      for (const q of r.done) send(ws, { type: 'notice', code: 'questDone', quest: q });
      send(ws, { type: 'quests', ...quests.state(c.profile) }); return refreshMe(ws);
    }
    case 'share': { // the player used a share button (counted at most once per 10 s)
      const now = Date.now(); if (now - (c.lastShare ?? 0) < 10_000) return; c.lastShare = now;
      return questEv(me, 'share', 1);
    }
    case 'admin.grant': {
      if (!c.profile.admin) return send(ws, { type: 'error', code: 'notAdmin' });
      const r = profiles.grant(msg.username, msg.amount);
      if (!r.ok) return send(ws, { type: 'error', code: r.error });
      const delta = Math.trunc(Number(msg.amount)); pushCoins(r.profile, delta, 'admin');
      return send(ws, { type: 'admin.ok', username: r.profile.username, coins: r.coins, delta });
    }
    case 'shop.buy': case 'shop.equip': {
      const r = msg.type === 'shop.buy' ? profiles.buy(me, msg.item) : profiles.equip(me, msg.item, !!msg.on);
      if (!r.ok) return send(ws, { type: 'error', code: r.error });
      return refreshMe(ws);
    }
  }
  if (!space) return;
  switch (msg.type) {
    case 'move': return space.move(me, msg);
    case 'chat': { if (space.chat(me, msg.text) && String(msg.text).trim().length >= 2 && Date.now() - (c.lastChatQ ?? 0) > 3000) { c.lastChatQ = Date.now(); questEv(me, 'chat', 1); } return; }
    case 'emote': return void space.emote(me, msg.kind);
  }
  if (!room) return;
  switch (msg.type) {
    case 'react': { if (room.react(me, msg.kind) && Date.now() - (c.lastReactQ ?? 0) > 1000) { c.lastReactQ = Date.now(); questEv(me, 'react', 1); } return; }
    case 'sit': return void room.sit(me, Number(msg.seat));
    case 'take': if (!room.take(me, msg.item || '')) send(ws, { type: 'error', code: 'soldOut' }); return;
    case 'act': return void room.act(me, msg.kind);
    case 'order': { const r = room.order(me, msg); if (!r.ok) send(ws, { type: 'error', code: r.error }); return; }
    case 'effect': return void room.toggleEffect(me, msg.name);
    case 'queue.add': {
      const videoId = String(msg.videoId || '');
      const meta = msg.title ? { title: String(msg.title), channel: String(msg.channel || '') } : await videoMeta(videoId);
      if (!room.enqueue(me, { videoId, ...meta })) send(ws, { type: 'error', code: 'queueFull' });
      else room.broadcast({ type: 'notice', code: 'queued', name: c.profile.name, title: meta.title });
      return markRooms();
    }
    case 'queue.remove': room.removeQueued(me, msg.id); return markRooms();
    case 'queue.prioritize': if (!room.prioritize(me, msg.id)) send(ws, { type: 'error', code: 'hostOnly' }); return;
    case 'control': { const r = room.control(me, msg.action); if (r.asked) send(ws, { type: 'notice', code: 'asked', name: r.singerName, sec: r.timeoutSec, action: msg.action }); return markRooms(); }
    case 'control.answer': room.answerControl(me, msg.reqId, msg.accept); return markRooms();
    case 'player.duration': return room.setDuration(msg.songId, Number(msg.seconds));
    case 'player.ended': room.ended(msg.songId); return markRooms();
    case 'duet.invite': if (!room.inviteDuet(me, msg.to)) send(ws, { type: 'error', code: 'cantInvite' }); return;
    case 'duet.accept': if (!room.acceptDuet(me, msg.songId)) send(ws, { type: 'error', code: 'inviteExpired' }); return;
    case 'duet.leave': { const song = room.playback.song; if (song && song.singers.includes(me) && song.ownerId !== me) { song.singers = song.singers.filter((x) => x !== me); room.broadcast({ type: 'playback', now: Date.now(), ...room.playback }); } return; }
    case 'mic': room.update(me, { mic: !!msg.on }); return;
    case 'sfu': return onSfu(ws, c, room, msg);
    case 'voice.log': { // client voice diagnostics (rate-limited client side): what real phones do
      const clip = (v) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 160);
      console.log(`VOICE ${clip(c.profile.name)} ${clip(msg.event)} mode=${clip(msg.mode)} ctx=${clip(msg.ctx)}${msg.ctxAfter ? `->${clip(msg.ctxAfter)}` : ''}${msg.packets != null ? ` packets=${Number(msg.packets)}` : ''}${msg.pc ? ` pc=${clip(msg.pc)}/${clip(msg.ice)}` : ''}${msg.msg ? ` err=${clip(msg.msg)}` : ''}${msg.sig ? ` sig=${clip(msg.sig)}` : ''}${msg.tracks != null ? ` tracks=${Number(msg.tracks)} retry=${Number(msg.retry)}` : ''}${msg.live != null ? ` live=${Number(msg.live)}` : ''} | ${clip(msg.ua)}`);
      return;
    }
    case 'rtc': { const t = wsOf(msg.to); if (t && clients.get(t)?.space === room.id) send(t, { type: 'rtc', from: me, data: msg.data }); return; }
  }
}

// voice through Cloudflare SFU: the browser's SDP goes through here so the app secret never leaves the server
async function onSfu(ws, c, room, msg) {
  const me = c.profile.id; const reply = (data) => send(ws, { type: 'sfu', rid: msg.rid, ...data });
  if (!hub.enabled) return reply({ ok: false, error: 'sfuOff' });
  try {
    switch (msg.op) {
      case 'join': {
        const r = await hub.join(me, room.id, msg);
        if (c.space !== room.id) { hub.leave(me); return reply({ ok: false, error: 'left' }); } // left while waiting for Cloudflare
        return reply({ ok: true, ...r });
      }
      case 'live':
        if (hub.goLive(me, room.id)) for (const [w, x] of clients) if (x.space === room.id && w !== ws) send(w, { type: 'sfu.track', id: me });
        return reply({ ok: true });
      case 'publish': return reply({ ok: true, ...(await hub.publish(me, room.id, msg)) });
      case 'unpublish': {
        const r = await hub.unpublish(me, room.id, msg);
        if (r.was) for (const [w, x] of clients) if (x.space === room.id && w !== ws) send(w, { type: 'sfu.untrack', id: me });
        return reply({ ok: true, sdp: r.sdp });
      }
      case 'pull': return reply({ ok: true, ...(await hub.pull(me, room.id, msg.ids)) });
      case 'answer': return reply({ ok: true, ...(await hub.answer(me, room.id, msg.sdp)) });
      case 'close': return reply({ ok: true, ...(await hub.close(me, room.id, msg.mids, msg.sdp)) });
      default: return reply({ ok: false, error: 'badRequest' });
    }
  } catch (e) {
    if (e.code === 'sfu') console.warn('SFU:', e.message);
    return reply({ ok: false, error: e.code || 'sfu' });
  }
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
async function search(q, pageToken) {
  if (!YT_API_KEY) return searchYouTube(q, pageToken); // no key needed: reads YouTube's own results page
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  const params = { part: 'snippet', type: 'video', maxResults: '20', videoEmbeddable: 'true', q, key: YT_API_KEY };
  if (pageToken) params.pageToken = pageToken;
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u); if (!r.ok) throw new Error(`YouTube API ${r.status}`);
  const j = await r.json();
  return { next: j.nextPageToken ?? null, items: j.items.map((i) => ({ videoId: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle, thumb: i.snippet.thumbnails?.medium?.url, duration: null })) };
}
function readJson(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e4) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); }); }

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/admin' && req.method === 'POST') { // used by `npm run coins` / `npm run admin`
    res.setHeader('content-type', 'application/json');
    const key = String(req.headers['x-admin-key'] || '');
    if (key.length !== ADMIN_KEY.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(ADMIN_KEY))) { res.writeHead(403); return res.end('{"error":"forbidden"}'); }
    const b = await readJson(req);
    const r = b.action === 'admin' ? profiles.setAdmin(b.username, b.on !== false) : profiles.grant(b.username, b.amount);
    if (!r.ok) { res.writeHead(404); return res.end(JSON.stringify({ error: r.error })); }
    if (b.action === 'admin') { const ws = wsOf(r.profile.id); if (ws) refreshMe(ws); }
    else pushCoins(r.profile, Math.trunc(Number(b.amount)), 'admin');
    profiles.flush();
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, username: r.profile.username, coins: r.profile.coins, admin: !!r.profile.admin }));
  }
  if (url.pathname === '/api/status') { // how full the server is (public: counts only)
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify(gate.status()));
  }
  if (url.pathname === '/api/search') {
    res.setHeader('content-type', 'application/json');
    try { res.writeHead(200); return res.end(JSON.stringify(await search(url.searchParams.get('q') || 'karaoke', url.searchParams.get('page')))); }
    catch (e) { res.writeHead(502); return res.end(JSON.stringify({ error: e.message })); }
  }
  let rel; try { rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('Bad request'); } // '/%' would throw
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'cdn-cache-control': 'no-store' }); // never serve a stale build (browser or Cloudflare)
  if (rel === '/index.html') { // link previews (Facebook, Zalo…) need absolute URLs
    const origin = `${req.headers['x-forwarded-proto'] ?? (req.socket.encrypted ? 'https' : 'http')}://${req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost'}`.replace(/[^\w.:/-]/g, '');
    return res.end(fs.readFileSync(file, 'utf8').replaceAll('{{ORIGIN}}', origin));
  }
  fs.createReadStream(file).pipe(res);
}
const safeHandle = (req, res) => handle(req, res).catch((e) => { console.error('HTTP', e); try { if (!res.headersSent) res.writeHead(500); res.end(); } catch {} });
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e)); // log, never exit (everyone would be disconnected)
const server = http.createServer(safeHandle);


function onConnection(ws) {
  clients.set(ws, { profile: null, token: null, space: null });
  ws.on('message', (d) => { let m; try { m = JSON.parse(d); } catch { return; } onMessage(ws, m).catch((e) => console.error(e)); });
  ws.on('close', () => { leaveSpace(ws); clients.delete(ws); leaveGate(ws); });
}
new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 }).on('connection', onConnection);
process.on('SIGINT', () => { profiles.flush(); process.exit(0); });
process.on('SIGTERM', () => { profiles.flush(); process.exit(0); });
server.listen(PORT, () => console.log(`KTV: http://localhost:${PORT}`));
console.log(`max online: ${gate.max} (+${gate.maxWaiting} waiting)`);
console.log(`ICE: ${ice.mode}  voice: ${hub.enabled ? 'cloudflare-sfu' : 'mesh'}  build: ${BUILD}`); ice.get(); // warm the TURN credential cache
// HTTPS (self-signed, from `npm run cert`): browsers only allow the microphone on https:// or localhost,
// so other devices on the network must use the https address
const TLS = path.resolve(HERE, '../data/tls');
if (fs.existsSync(path.join(TLS, 'key.pem')) && fs.existsSync(path.join(TLS, 'cert.pem'))) {
  const secure = https.createServer({ key: fs.readFileSync(path.join(TLS, 'key.pem')), cert: fs.readFileSync(path.join(TLS, 'cert.pem')) }, safeHandle);
  new WebSocketServer({ server: secure, path: '/ws', maxPayload: 64 * 1024 }).on('connection', onConnection);
  secure.listen(HTTPS_PORT, () => {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    console.log(`KTV HTTPS (mic cho máy khác trong mạng): ${ips.map((ip) => `https://${ip}:${HTTPS_PORT}`).join('  ') || `https://localhost:${HTTPS_PORT}`}`);
  });
} else console.log('Chưa có chứng chỉ HTTPS — chạy `npm run cert` để máy khác trong mạng dùng được mic.');
