// Community: a unique @handle per profile, follow requests the followed person approves, and a
// read-only view of an approved person's training: what they did, the sets, reps and loads.
//
// What leaves the server about someone else is built here, field by field, from their workouts
// only (publicWorkout). Never their body weight (the workout's `bw` included), measurements,
// photos, notes, gym, health data, e-mail or settings: a whitelist, so a field added to the state
// later stays private until it is added here on purpose.
//
// Stored in db.json: `user.handle` and `db.follows` = [{ from, to, status: 'pending'|'accepted', at }].

export const HANDLE = /^[a-z0-9](?:[a-z0-9._]{1,18})[a-z0-9]$/;   // 3 to 20, no dot or _ at the ends
const RESERVED = new Set(['admin', 'root', 'support', 'help', 'api', 'forlife', 'opengym', 'me', 'settings', 'null', 'undefined']);
const FEED_DAYS = 30;
const FEED_MAX = 50;
const PROFILE_MAX = 20;

/** The handle as stored: lowercase, no leading @. Null when it is not one a profile may take. */
export function cleanHandle(v) {
  if (typeof v !== 'string') return null;
  const h = v.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(h) || /[._]{2}/.test(h) || RESERVED.has(h)) return null;
  return h;
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const row = s => {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  for (const k of ['w', 'r', 'sec', 'dist']) if (num(s[k]) !== undefined) out[k] = s[k];
  for (const k of ['phase', 'kind']) if (typeof s[k] === 'string' && s[k].length <= 20) out[k] = s[k];
  if (s.done === true) out.done = true;
  return out;
};
function publicSet(s) {
  if (s && s.sides && typeof s.sides === 'object') {
    const L = row(s.sides.L), R = row(s.sides.R);
    const base = row(s) || {};
    return { ...base, sides: { L: L || {}, R: R || {} } };
  }
  return row(s);
}
const done = s => s && (s.done === true || s.sides?.L?.done === true || s.sides?.R?.done === true);
const volumeOf = s => {
  if (!s) return 0;
  if (s.sides) return volumeOf({ ...s.sides.L, done: s.sides.L?.done }) + volumeOf({ ...s.sides.R, done: s.sides.R?.done });
  return s.done ? (Number(s.w) || 0) * (Number(s.r) || 0) : 0;
};

/** One finished workout as anyone approved may see it. */
export function publicWorkout(w, customNames) {
  const entries = (Array.isArray(w?.entries) ? w.entries : []).map(e => {
    const sets = (Array.isArray(e?.sets) ? e.sets : []).filter(done).map(publicSet).filter(Boolean);
    if (!sets.length || typeof e?.id !== 'string') return null;
    const out = { id: e.id.slice(0, 120), sets };
    if (customNames.has(e.id)) out.name = customNames.get(e.id);
    return out;
  }).filter(Boolean);
  const volume = entries.reduce((t, e) => t + e.sets.reduce((u, s) => u + volumeOf(s), 0), 0);
  return {
    id: String(w.id ?? '').slice(0, 80),
    d: typeof w.d === 'string' ? w.d.slice(0, 10) : null,
    ...(num(w.start) !== undefined ? { start: w.start } : {}),
    ...(num(w.end) !== undefined ? { end: w.end } : {}),
    name: typeof w.name === 'string' ? w.name.slice(0, 80) : '',
    entries,
    sets: entries.reduce((t, e) => t + e.sets.length, 0),
    volume: Math.round(volume * 100) / 100,
    ...(Array.isArray(w.prs) && w.prs.length ? { prs: w.prs.length } : {}),
  };
}

/** The newest finished workouts of a state, public shape, newest first. */
export function publicWorkouts(S, { max = PROFILE_MAX, since = 0 } = {}) {
  const list = Array.isArray(S?.workouts) ? S.workouts : [];
  // A user's own exercises are named by them; the catalogue ones the app names itself.
  const customNames = new Map((Array.isArray(S?.customEx) ? S.customEx : [])
    .filter(c => c && typeof c.id === 'string' && typeof c.name === 'string').map(c => [c.id, c.name.slice(0, 80)]));
  const when = w => num(w?.end) ?? num(w?.start) ?? (typeof w?.d === 'string' ? Date.parse(w.d) || 0 : 0);
  return list.filter(w => w && !w.deleted && !w._del && when(w) >= since)
    .sort((a, b) => when(b) - when(a))
    .slice(0, max)
    .map(w => publicWorkout(w, customNames))
    .filter(w => w.entries.length);
}

export function communityRoutes({ json, readBody, readSession, notSignedIn, getDb, saveDb, readState, audit }) {
  const db = () => { const d = getDb(); d.follows = d.follows || []; return d; };
  const byHandle = h => db().users.find(u => u.handle === h && !u.disabled) || null;
  const edge = (from, to) => db().follows.find(f => f.from === from && f.to === to) || null;
  const card = u => ({ handle: u.handle, name: u.name });
  const counts = u => ({
    followers: db().follows.filter(f => f.to === u.id && f.status === 'accepted').length,
    following: db().follows.filter(f => f.from === u.id && f.status === 'accepted').length,
  });
  const relation = (me, u) => {
    if (me.id === u.id) return 'self';
    const e = edge(me.id, u.id);
    return e ? e.status : 'none';            // 'accepted' | 'pending' | 'none'
  };
  const followsMe = (me, u) => edge(u.id, me.id)?.status === 'accepted';
  const signedIn = (req, res) => { const u = readSession(req); if (!u) { notSignedIn(res); return null; } return u; };
  const needHandle = (res, me) => { if (me.handle) return false; json(res, 409, { error: 'pick a handle first', code: 'no-handle' }); return true; };
  const target = (res, body) => {
    const h = cleanHandle(body?.handle);
    const u = h && byHandle(h);
    if (!u) { json(res, 404, { error: 'no profile with that handle', code: 'not-found' }); return null; }
    return u;
  };
  const people = ids => ids.map(id => db().users.find(u => u.id === id)).filter(u => u && u.handle && !u.disabled).map(card);

  return {
    'GET /api/community/me': async (req, res) => {
      const me = signedIn(req, res); if (!me) return;
      const d = db();
      json(res, 200, {
        handle: me.handle || null, name: me.name, ...counts(me),
        requests: people(d.follows.filter(f => f.to === me.id && f.status === 'pending').map(f => f.from)),
        followers: people(d.follows.filter(f => f.to === me.id && f.status === 'accepted').map(f => f.from)),
        following: people(d.follows.filter(f => f.from === me.id && f.status === 'accepted').map(f => f.to)),
        pending: people(d.follows.filter(f => f.from === me.id && f.status === 'pending').map(f => f.to)),
      });
    },

    'POST /api/community/handle': async (req, res) => {
      const me = signedIn(req, res); if (!me) return;
      const body = await readBody(req);
      const h = cleanHandle(body.handle);
      if (!h) return json(res, 400, { error: 'that handle is not allowed', code: 'handle-invalid' });
      // Checked after the await above, with nothing awaited from here to the save.
      if (db().users.some(u => u.id !== me.id && u.handle === h)) return json(res, 409, { error: 'that handle is taken', code: 'handle-taken' });
      const was = me.handle || null;
      me.handle = h;
      saveDb();
      audit(req, 'community.handle', { user: me, msg: was ? `${was} -> ${h}` : h });
      json(res, 200, { handle: h });
    },

    'GET /api/community/search': async (req, res) => {
      const me = signedIn(req, res); if (!me) return;
      const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
      const k = q.trim().replace(/^@/, '').toLowerCase().slice(0, 40);
      if (k.length < 2) return json(res, 200, { results: [] });
      const results = db().users
        .filter(u => u.handle && !u.disabled && u.id !== me.id && (u.handle.includes(k) || String(u.name || '').toLowerCase().includes(k)))
        .sort((a, b) => (b.handle.startsWith(k) - a.handle.startsWith(k)) || a.handle.localeCompare(b.handle))
        .slice(0, 20)
        .map(u => ({ ...card(u), relation: relation(me, u) }));
      json(res, 200, { results });
    },

    'GET /api/community/profile': async (req, res) => {
      const me = signedIn(req, res); if (!me) return;
      const u = target(res, { handle: new URL(req.url, 'http://x').searchParams.get('handle') }); if (!u) return;
      const rel = relation(me, u);
      const out = { ...card(u), ...counts(u), relation: rel, followsYou: followsMe(me, u) };
      // The training is shown to the person themself and to followers they approved. Nobody else.
      if (rel === 'self' || rel === 'accepted') out.workouts = publicWorkouts(readState(u.id)), out.unit = unitOf(readState(u.id));
      json(res, 200, out);
    },

    'POST /api/community/follow': async (req, res) => {
      const me = signedIn(req, res); if (!me) return;
      if (needHandle(res, me)) return;
      const u = target(res, await readBody(req)); if (!u) return;
      if (u.id === me.id) return json(res, 400, { error: 'you cannot follow yourself', code: 'self' });
      let e = edge(me.id, u.id);
      if (!e) { e = { from: me.id, to: u.id, status: 'pending', at: new Date().toISOString() }; db().follows.push(e); saveDb(); }
      json(res, 200, { relation: e.status });
    },

    // Unfollowing, or taking back a request not answered yet.
    'POST /api/community/unfollow': async (req, res) => {
      const me = signedIn(req, res); if (!me) return;
      const u = target(res, await readBody(req)); if (!u) return;
      const d = db();
      const n = d.follows.length;
      d.follows = d.follows.filter(f => !(f.from === me.id && f.to === u.id));
      if (d.follows.length !== n) saveDb();
      json(res, 200, { relation: 'none' });
    },

    // Answering a request: accept lets them see your training, decline drops the request.
    'POST /api/community/requests/answer': async (req, res) => {
      const me = signedIn(req, res); if (!me) return;
      const body = await readBody(req);
      const u = target(res, body); if (!u) return;
      const e = edge(u.id, me.id);
      if (!e || e.status !== 'pending') return json(res, 404, { error: 'no such request', code: 'not-found' });
      const d = db();
      if (body.accept === true) { e.status = 'accepted'; e.at = new Date().toISOString(); }
      else d.follows = d.follows.filter(f => f !== e);
      saveDb();
      json(res, 200, { ok: true });
    },

    // Removing a follower: they stop seeing your training, and would have to ask again.
    'POST /api/community/followers/remove': async (req, res) => {
      const me = signedIn(req, res); if (!me) return;
      const u = target(res, await readBody(req)); if (!u) return;
      const d = db();
      d.follows = d.follows.filter(f => !(f.from === u.id && f.to === me.id));
      saveDb();
      json(res, 200, { ok: true });
    },

    // The newest workouts of everyone you follow (approved), last 30 days.
    'GET /api/community/feed': async (req, res) => {
      const me = signedIn(req, res); if (!me) return;
      const since = Date.now() - FEED_DAYS * 86400000;
      const items = [];
      for (const f of db().follows) {
        if (f.from !== me.id || f.status !== 'accepted') continue;
        const u = db().users.find(x => x.id === f.to);
        if (!u || !u.handle || u.disabled) continue;
        const S = readState(u.id);
        const unit = unitOf(S);
        for (const w of publicWorkouts(S, { max: 10, since })) items.push({ ...card(u), unit, workout: w });
      }
      const when = i => i.workout.end ?? i.workout.start ?? (Date.parse(i.workout.d) || 0);
      items.sort((a, b) => when(b) - when(a));
      json(res, 200, { items: items.slice(0, FEED_MAX) });
    },
  };
}
const unitOf = S => (S?.unit === 'lb' ? 'lb' : 'kg');

/** What removing an account takes out of the community: every follow to or from it. */
export function dropFollows(db, uid) {
  if (Array.isArray(db.follows)) db.follows = db.follows.filter(f => f.from !== uid && f.to !== uid);
}
