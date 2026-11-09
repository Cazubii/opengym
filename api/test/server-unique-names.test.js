/* UNIQUE_NAMES: a passkey sign-up may not take a name another profile already has, compared the
   way nameKey() folds names. Off, names stay as free as they always were. The ceremony itself
   is not run here: the refusal comes at /api/register/options, before any passkey prompt. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startServer(t, env, users) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-names-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', INVITE_ONLY: '', UNIQUE_NAMES: '', ...env }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const api = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  return name => fetch(`${api}/api/register/options`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ name })
  }).then(async r => ({ status: r.status, body: await r.json() }));
}
const users = [{ id: 'u1', name: 'Ana Souza', created: new Date().toISOString() }];

test('UNIQUE_NAMES refuses a name a passkey profile already has, however it is cased or spaced', async t => {
  const options = await startServer(t, { UNIQUE_NAMES: '1' }, users);
  for (const n of ['Ana Souza', 'ana souza', '  ANA SOUZA ']) {
    const r = await options(n);
    assert.equal(r.status, 409, n);
    assert.equal(r.body.code, 'name-taken');
  }
  assert.equal((await options('Ana Lima')).status, 200);
});

test('without UNIQUE_NAMES a passkey profile may share a name, as before', async t => {
  const options = await startServer(t, {}, users);
  assert.equal((await options('Ana Souza')).status, 200);
});
