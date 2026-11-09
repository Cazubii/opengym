// openGym on Vercel + Neon. The API keeps its state as files under DATA_DIR; a serverless
// function has no lasting disk, so DATA_DIR (in /tmp) is mirrored to one Postgres table.
//
// Several instances of this function can run at once, each with its own copy. So every request
// runs like this: catch up with the table, let the API answer it on a loopback port while the
// answer is held back, then write the files it changed in one transaction that only succeeds if
// nobody else wrote those files in between (commit_files below). If someone did, nothing is
// written: the copy is thrown away, the table read again, and the request run again on the
// fresh data, so a check such as "is this name free" is always made against the latest accounts.
// Only a committed answer reaches the client.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { neon } from '@neondatabase/serverless';

const DATA = process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/opengym-data';
// web-push lives in the api's own node_modules, beside server.js.
const apiRequire = createRequire(new URL('../../../api/server.js', import.meta.url));
const sql = neon(process.env.DATABASE_URL);
const ATTEMPTS = 4;

let lastRev = 0;
let known = new Map();   // relative path -> { sig: "mtime:size", rev } as last synced
let api = null;          // { server, port } of the API module now loaded
let generation = 0;

const skip = rel => rel.endsWith('.tmp') || rel.endsWith('.sock') || rel.startsWith('tmp/');
function walk(dir = DATA, out = new Map()) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    const rel = path.relative(DATA, p);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && !skip(rel)) { const st = fs.statSync(p); out.set(rel, `${st.mtimeMs}:${st.size}`); }
  }
  return out;
}

// Applies a batch of writes only if every file is still at the revision this copy last saw
// (0: not in the table). Raises 'conflict' otherwise, which rolls the whole batch back.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS files (path text PRIMARY KEY, content text, deleted boolean NOT NULL DEFAULT false,
     rev bigserial NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE OR REPLACE FUNCTION commit_files(w jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
   DECLARE e jsonb; cur bigint; nr bigint; out jsonb := '{}'::jsonb;
   BEGIN
     FOR e IN SELECT * FROM jsonb_array_elements(w) LOOP
       SELECT rev INTO cur FROM files WHERE path = e->>'path' FOR UPDATE;
       IF COALESCE(cur, 0) <> (e->>'expect')::bigint THEN RAISE EXCEPTION 'conflict' USING ERRCODE = 'P0409'; END IF;
       nr := nextval('files_rev_seq');
       INSERT INTO files (path, content, deleted, rev, updated_at)
         VALUES (e->>'path', e->>'content', (e->>'content') IS NULL, nr, now())
         ON CONFLICT (path) DO UPDATE SET content = EXCLUDED.content, deleted = EXCLUDED.deleted, rev = nr, updated_at = now();
       out := out || jsonb_build_object(e->>'path', nr);
     END LOOP;
     RETURN out;
   END $$`
];

function writeLocal(rel, content) {
  const p = path.join(DATA, rel);
  if (content == null) { try { fs.unlinkSync(p); } catch { /* gone */ } return; }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.from(content, 'base64'), { mode: 0o600 });
}

/** Catches up with the table. True when db.json changed, which the loaded API holds in memory. */
async function pull() {
  const rows = await sql`SELECT path, content, deleted, rev FROM files WHERE rev > ${lastRev} ORDER BY rev`;
  if (!rows.length) return false;
  let dbChanged = false;
  for (const r of rows) {
    writeLocal(r.path, r.deleted ? null : r.content);
    if (r.path === 'db.json') dbChanged = true;
    lastRev = Math.max(lastRev, Number(r.rev));
  }
  const sigs = walk();
  for (const r of rows) {
    if (r.deleted) known.delete(r.path);
    else known.set(r.path, { sig: sigs.get(r.path), rev: Number(r.rev) });
  }
  return dbChanged;
}

function dirty() {
  const now = walk();
  if (now.size !== known.size) return true;
  for (const [rel, sig] of now) if (known.get(rel)?.sig !== sig) return true;
  return false;
}

/** Writes what the last request changed. False on a conflict, with nothing written. */
async function commit() {
  const now = walk();
  const writes = [];
  for (const [rel, sig] of now) {
    const k = known.get(rel);
    if (!k || k.sig !== sig) writes.push({ path: rel, content: fs.readFileSync(path.join(DATA, rel)).toString('base64'), expect: k ? k.rev : 0 });
  }
  for (const [rel, k] of known) if (!now.has(rel)) writes.push({ path: rel, content: null, expect: k.rev });
  if (!writes.length) return true;
  let revs;
  try {
    [{ commit_files: revs }] = await sql`SELECT commit_files(${JSON.stringify(writes)}::jsonb)`;
  } catch (e) {
    if (String(e?.message).includes('conflict') || e?.code === 'P0409') return false;
    throw e;
  }
  for (const w of writes) {
    if (w.content == null) known.delete(w.path);
    else known.set(w.path, { sig: now.get(w.path), rev: Number(revs[w.path]) });
  }
  return true;
}

async function loadApi() {
  if (api) api.server.close();
  const mod = await import(`../../../api/server.js?g=${++generation}`);
  const server = mod.server;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  api = { server, port: server.address().port };
}

/** Back to the table's version: this copy's own unsaved changes are dropped. */
async function reset() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  lastRev = 0;
  known = new Map();
  await pull();
  await loadApi();
}

// secret and vapid.json are made once for the whole deployment, not once per instance.
async function seedOnce(rel, make) {
  await sql`INSERT INTO files (path, content) VALUES (${rel}, ${Buffer.from(make()).toString('base64')}) ON CONFLICT (path) DO NOTHING`;
}

async function boot() {
  for (const s of SCHEMA) await sql.query(s);
  await seedOnce('secret', () => crypto.randomBytes(32).toString('hex'));
  await seedOnce('vapid.json', () => JSON.stringify(apiRequire('web-push').generateVAPIDKeys()));
  await reset();
}

/** The request, sent to the API on loopback, with its answer held in full. */
function run(req, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: api.port, method: req.method, path: req.url, headers: req.headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    r.on('error', reject);
    r.end(body);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// One request at a time per instance: the commit takes every file changed since the last one,
// so two requests interleaved here would be committed (or retried) as one.
let queue = Promise.resolve();
const serial = fn => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

let ready = null;
async function handle(req, body) {
  if (!ready) ready = boot().catch(e => { ready = null; throw e; });
  await ready;
  // Files changed between requests come from a timer inside the API (a reminder tick), maybe one
  // left running by a copy of the module replaced since, holding an older db.json. Nothing is
  // committed outside a request, so they are dropped rather than written over newer data.
  if (dirty()) await reset();
  for (let i = 0; i < ATTEMPTS; i++) {
    if (await pull()) await loadApi();
    const answer = await run(req, body);
    if (await commit()) return answer;
    console.warn(`write conflict on ${req.method} ${req.url.split('?')[0]}, running it again (${i + 1})`);
    await reset();
  }
  return { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '1' }, body: Buffer.from(JSON.stringify({ error: 'busy, try again', code: 'busy' })) };
}

export default async function handler(req, res) {
  try {
    const body = await readBody(req);
    const answer = await serial(() => handle(req, body));
    const headers = { ...answer.headers };
    delete headers['transfer-encoding'];
    delete headers.connection;
    headers['content-length'] = String(answer.body.length);
    res.writeHead(answer.status, headers);
    res.end(answer.body);
  } catch (e) {
    console.error('request failed', e);
    if (!res.headersSent) { res.statusCode = 503; res.setHeader('content-type', 'application/json'); }
    res.end(JSON.stringify({ error: 'storage unavailable' }));
  }
}
