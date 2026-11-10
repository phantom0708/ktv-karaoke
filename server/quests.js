// Daily / weekly quests that pay coins, plus invite links (referrals). Days and weeks follow Vietnam time (UTC+7),
// so the daily quests reset at midnight for the players. Progress lives on the profile: p.quests, p.refBy, p.invites.
// Pure logic: index.js feeds it events (track) and pays out what claim() returns.
const TZ = 7 * 3600_000;
const dayKey = (ms) => new Date(ms + TZ).toISOString().slice(0, 10);
const weekKey = (ms) => { const d = new Date(ms + TZ); const dow = (d.getUTCDay() + 6) % 7; return new Date(ms + TZ - dow * 86400_000).toISOString().slice(0, 10); };

// ev = event name fed to track(); goal in the event's unit (listen: seconds, online: minutes)
export const DAILY = [
  { id: 'checkin', ev: 'checkin', goal: 1, coins: 20 },
  { id: 'online15', ev: 'online', goal: 15, coins: 30, unit: 'mins' },
  { id: 'listen10', ev: 'listen', goal: 600, coins: 30, unit: 'min' },
  { id: 'sing1', ev: 'sing', goal: 1, coins: 50 },
  { id: 'sing3', ev: 'sing', goal: 3, coins: 120 },
  { id: 'react10', ev: 'react', goal: 10, coins: 30 },
  { id: 'chat5', ev: 'chat', goal: 5, coins: 20 },
  { id: 'social3', ev: 'social', goal: 3, coins: 40 },
  { id: 'spend1', ev: 'spend', goal: 1, coins: 40 },
  { id: 'share1', ev: 'share', goal: 1, coins: 50 },
];
export const DAILY_BONUS = 200; // claim every daily quest → bonus chest
export const WEEKLY = [
  { id: 'wsing20', ev: 'sing', goal: 20, coins: 600 },
  { id: 'wonline300', ev: 'online', goal: 300, coins: 400, unit: 'hours' },
  { id: 'wdays5', ev: 'dayDone', goal: 5, coins: 800 },
  { id: 'wfriend1', ev: 'friend', goal: 1, coins: 200 },
  { id: 'winvite1', ev: 'invite', goal: 1, coins: 500 },
];
export const INVITE_REWARD = 300;  // to the inviter, once the invited player finishes their first song
export const INVITE_CAP = 10;      // paid invites per week
export const NEWBIE_BONUS = 100;   // to the invited player when they sign up

export class Quests {
  constructor(profiles, { clock = Date.now } = {}) { this.profiles = profiles; this.clock = clock; }
  #save() { this.profiles.dirty = true; }

  // the profile's quest record, rolled over to today / this week
  #q(p) {
    const now = this.clock(); const day = dayKey(now); const week = weekKey(now);
    const q = (p.quests ??= {});
    if (q.day !== day) Object.assign(q, { day, d: {}, dc: [], bonus: false });
    if (q.week !== week) Object.assign(q, { week, w: {}, wc: [], invites: 0 });
    return q;
  }

  // something happened: returns the quests that just got completed (to tell the player)
  track(p, ev, n = 1) {
    if (!p || p.guest || !(n > 0)) return [];
    const q = this.#q(p); const done = [];
    for (const [list, prog] of [[DAILY, q.d], [WEEKLY, q.w]]) {
      const relevant = list.filter((x) => x.ev === ev); if (!relevant.length) continue;
      const before = prog[ev] ?? 0; prog[ev] = before + n;
      for (const x of relevant) if (before < x.goal && prog[ev] >= x.goal) done.push(x.id);
    }
    if (done.length || DAILY.some((x) => x.ev === ev) || WEEKLY.some((x) => x.ev === ev)) this.#save();
    return done;
  }

  state(p) {
    const q = this.#q(p);
    const row = (prog, claimed) => (x) => ({ id: x.id, goal: x.goal, unit: x.unit ?? null, coins: x.coins, progress: Math.min(x.goal, prog[x.ev] ?? 0), claimed: claimed.includes(x.id) });
    const daily = DAILY.map(row(q.d, q.dc)); const weekly = WEEKLY.map(row(q.w, q.wc));
    const now = this.clock(); const nextDay = Date.parse(`${dayKey(now)}T00:00:00Z`) - TZ + 86400_000;
    return { daily, weekly, bonus: { coins: DAILY_BONUS, ready: daily.every((x) => x.claimed), claimed: !!q.bonus },
      resetIn: nextDay - now, invite: { reward: INVITE_REWARD, newbie: NEWBIE_BONUS, cap: INVITE_CAP, week: q.invites ?? 0, total: p.invites ?? 0 } };
  }

  // how many rewards are waiting to be claimed (badge on the button)
  ready(p) {
    if (!p || p.guest) return 0;
    const s = this.state(p); const n = (l) => l.filter((x) => !x.claimed && x.progress >= x.goal).length;
    return n(s.daily) + n(s.weekly) + (s.bonus.ready && !s.bonus.claimed ? 1 : 0);
  }

  // claim a finished quest ('bonus' = the daily chest); returns the coins to pay
  claim(p, id) {
    if (!p || p.guest) return { ok: false, error: 'needAccount' };
    const q = this.#q(p);
    if (id === 'bonus') {
      if (q.bonus) return { ok: false, error: 'questClaimed' };
      if (!DAILY.every((x) => q.dc.includes(x.id))) return { ok: false, error: 'questNotDone' };
      q.bonus = true; this.#save();
      const done = this.track(p, 'dayDone', 1);
      return { ok: true, coins: DAILY_BONUS, done };
    }
    const daily = DAILY.find((x) => x.id === id); const quest = daily ?? WEEKLY.find((x) => x.id === id);
    if (!quest) return { ok: false, error: 'unknown' };
    const [prog, claimed] = daily ? [q.d, q.dc] : [q.w, q.wc];
    if (claimed.includes(id)) return { ok: false, error: 'questClaimed' };
    if ((prog[quest.ev] ?? 0) < quest.goal) return { ok: false, error: 'questNotDone' };
    claimed.push(id); this.#save();
    return { ok: true, coins: quest.coins, done: [] };
  }

  // ---- invites ----
  // a new account signed up from someone's invite link: remember who, give the newcomer a welcome bonus
  joined(p, refId) {
    const inviter = this.profiles.get(String(refId ?? ''));
    if (!p || p.guest || p.refBy || !inviter || inviter.guest || inviter.id === p.id) return 0;
    p.refBy = inviter.id; p.coins += NEWBIE_BONUS; this.#save();
    return NEWBIE_BONUS;
  }
  // the invited player finished their first song: pay the inviter (capped per week). Returns the inviter or null.
  firstSong(p) {
    if (!p?.refBy || p.refPaid) return null;
    p.refPaid = true; this.#save();
    const inviter = this.profiles.get(p.refBy); if (!inviter || inviter.guest) return null;
    const q = this.#q(inviter);
    if ((q.invites ?? 0) >= INVITE_CAP) return null;
    q.invites = (q.invites ?? 0) + 1; inviter.invites = (inviter.invites ?? 0) + 1; inviter.coins += INVITE_REWARD;
    return { inviter, coins: INVITE_REWARD, done: this.track(inviter, 'invite', 1) };
  }
}
