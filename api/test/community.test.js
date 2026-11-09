/* The community: handles, follow requests, and above all what another person's training view
   carries. Approved followers see exercises, sets, reps and loads; nobody sees body weight,
   measurements, notes, photos or settings, and nobody unapproved sees any workout at all. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { cleanHandle, publicWorkouts } from '../community.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const session = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

// A state with everything private in it, so a leak of any of it shows up in the JSON.
const SECRET_BITS = ['bodyweight-77.7', 'measure-waist', 'private-note', 'my-gym-name', 'photo-xyz'];
const stateOf = () => ({
  unit: 'kg',
  bodyweight: [{ d: '2026-11-01', w: 77.7, note: 'bodyweight-77.7' }],
  measurements: [{ d: '2026-11-01', waist: 80, note: 'measure-waist' }],
  photos: [{ id: 'photo-xyz' }],
  customEx: [{ id: 'cx1', name: 'My Curl', notes: 'private-note' }],
  workouts: [
    { id: 'w1', d: '2026-11-08', start: Date.now() - 7200000, end: Date.now() - 3600000, name: 'Push', bw: 77.7,
      note: 'private-note', gym: { id: 'g', name: 'my-gym-name' }, prs: [{ ex: 'bench' }],
      entries: [
        { id: 'bench-press', note: 'private-note', topW: 80, muscleSnapshot: { chest: 1 },
          sets: [{ w: 60, r: 10, done: true, phase: 'warmup' }, { w: 80, r: 8, done: true, rpe: 9 }, { w: 85, r: 5, done: false }] },
        { id: 'cx1', sets: [{ w: 12, r: 12, done: true }] },
        { id: 'skipped', sets: [{ w: 10, r: 10 }] },
      ] },
  ],
});

test('cleanHandle takes what an @ can be and nothing else', () => {
  assert.equal(cleanHandle('@Igor.Silva'), 'igor.silva');
  assert.equal(cleanHandle(' irmao_2 '), 'irmao_2');
  for (const bad of ['ab', 'a'.repeat(21), '.igor', 'igor_', 'ig..or', 'igor silva', 'ígor', 'admin', '', null, 42]) assert.equal(cleanHandle(bad), null, String(bad));
});

test('publicWorkouts keeps sets, reps, loads and volume, and drops every private field', () => {
  const [w] = publicWorkouts(stateOf());
  assert.equal(w.name, 'Push');
  assert.deepEqual(w.entries.map(e => e.id), ['bench-press', 'cx1']);       // the undone one is gone
  assert.deepEqual(w.entries[0].sets, [{ w: 60, r: 10, phase: 'warmup', done: true }, { w: 80, r: 8, done: true }]);
  assert.equal(w.entries[1].name, 'My Curl');
  assert.equal(w.volume, 60 * 10 + 80 * 8 + 12 * 12);
  assert.equal(w.sets, 3);
  const text = JSON.stringify(w);
  for (const bit of SECRET_BITS) assert.ok(!text.includes(bit), bit);
  for (const key of ['"bw"', '"note"', '"gym"', '"muscleSnapshot"', '"rpe"', '"topW"']) assert.ok(!text.includes(key), key);
});

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-community-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'igor', name: 'Igor', created: now }, { id: 'bro', name: 'Irmão', created: now }, { id: 'eve', name: 'Eve', created: now }],
    creds: [], subs: [], invites: [] }));
  fs.writeFileSync(path.join(dataDir, 'state-bro.json'), JSON.stringify(stateOf()));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', INVITE_ONLY: '' }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const api = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  return (uid, method, p, body) => fetch(api + p, {
    method, headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: session(uid) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async r => ({ status: r.status, body: await r.json() }));
}

test('follow, approve, see the training; unapproved and removed followers see none', async t => {
  const as = await startServer(t);
  // Handles: one each, unique, and a follow needs one first.
  assert.equal((await as('igor', 'POST', '/api/community/follow', { handle: 'irmao' })).body.code, 'no-handle');
  assert.equal((await as('igor', 'POST', '/api/community/handle', { handle: 'Igor' })).body.handle, 'igor');
  assert.equal((await as('bro', 'POST', '/api/community/handle', { handle: '@IGOR' })).body.code, 'handle-taken');
  assert.equal((await as('bro', 'POST', '/api/community/handle', { handle: 'a' })).body.code, 'handle-invalid');
  assert.equal((await as('bro', 'POST', '/api/community/handle', { handle: 'irmao' })).status, 200);
  assert.equal((await as('eve', 'POST', '/api/community/follow', { handle: 'irmao' })).body.code, 'no-handle');
  assert.equal((await as('eve', 'POST', '/api/community/handle', { handle: 'eve' })).status, 200);

  // Before approval: the profile, no workouts.
  assert.equal((await as('igor', 'POST', '/api/community/follow', { handle: 'irmao' })).body.relation, 'pending');
  let p = (await as('igor', 'GET', '/api/community/profile?handle=irmao')).body;
  assert.equal(p.relation, 'pending');
  assert.equal(p.workouts, undefined);
  assert.equal((await as('igor', 'GET', '/api/community/feed')).body.items.length, 0);

  // The followed person sees the request and approves it.
  const me = (await as('bro', 'GET', '/api/community/me')).body;
  assert.deepEqual(me.requests, [{ handle: 'igor', name: 'Igor' }]);
  assert.equal((await as('bro', 'POST', '/api/community/requests/answer', { handle: 'igor', accept: true })).status, 200);

  p = (await as('igor', 'GET', '/api/community/profile?handle=irmao')).body;
  assert.equal(p.relation, 'accepted');
  assert.equal(p.unit, 'kg');
  assert.equal(p.workouts[0].entries[0].sets[1].w, 80);
  const feed = (await as('igor', 'GET', '/api/community/feed')).body;
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].handle, 'irmao');
  for (const bit of SECRET_BITS) assert.ok(!JSON.stringify([p, feed]).includes(bit), bit);

  // Search finds by handle or name, and someone not approved still sees no workouts.
  assert.equal((await as('eve', 'GET', '/api/community/search?q=irm')).body.results[0].handle, 'irmao');
  await as('eve', 'POST', '/api/community/follow', { handle: 'irmao' });
  await as('bro', 'POST', '/api/community/requests/answer', { handle: 'eve', accept: false });
  assert.equal((await as('eve', 'GET', '/api/community/profile?handle=irmao')).body.workouts, undefined);

  // Removed: gone again.
  await as('bro', 'POST', '/api/community/followers/remove', { handle: 'igor' });
  assert.equal((await as('igor', 'GET', '/api/community/profile?handle=irmao')).body.workouts, undefined);
  assert.equal((await as('igor', 'GET', '/api/community/feed')).body.items.length, 0);
});
