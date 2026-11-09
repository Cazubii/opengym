// openGym on Vercel + Neon. The API keeps its state as files under DATA_DIR; a serverless
// function has no lasting disk, so this mirrors DATA_DIR (in /tmp) to one Postgres table:
// pulled before each request, changed files pushed back before the response ends.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { neon } from '@neondatabase/serverless';
// web-push lives in the api's own node_modules, beside server.js.
const apiRequire = createRequire(new URL('../../../api/server.js', import.meta.url));

const DATA = process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/opengym-data';
const sql = neon(process.env.DATABASE_URL);
let lastRev = 0;
let known = new Map(); // relative path -> "mtime:size" as last synced
let server = null;
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

async function pull() {
  const rows = await sql`SELECT path, content, deleted, rev FROM files WHERE rev > ${lastRev} ORDER BY rev`;
  let dbChanged = false;
  for (const r of rows) {
    const p = path.join(DATA, r.path);
    if (r.deleted) { try { fs.unlinkSync(p); } catch { /* gone */ } }
    else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(r.content, 'base64'), { mode: 0o600 }); }
    if (r.path === 'db.json') dbChanged = true;
    lastRev = Math.max(lastRev, Number(r.rev));
  }
  if (rows.length) known = walk();
  return dbChanged;
}

async function push() {
  const now = walk();
  const ops = [];
  for (const [rel, sig] of now) if (known.get(rel) !== sig) {
    ops.push(sql`INSERT INTO files (path, content, deleted) VALUES (${rel}, ${fs.readFileSync(path.join(DATA, rel)).toString('base64')}, false)
      ON CONFLICT (path) DO UPDATE SET content = EXCLUDED.content, deleted = false, rev = nextval('files_rev_seq'), updated_at = now()`);
  }
  for (const rel of known.keys()) if (!now.has(rel)) {
    ops.push(sql`UPDATE files SET deleted = true, content = NULL, rev = nextval('files_rev_seq'), updated_at = now() WHERE path = ${rel}`);
  }
  known = now;
  if (ops.length) await sql.transaction(ops);
}

// secret and vapid.json are made once for the whole deployment, not once per instance.
async function seedOnce(rel, make) {
  await sql`INSERT INTO files (path, content) VALUES (${rel}, ${Buffer.from(make()).toString('base64')}) ON CONFLICT (path) DO NOTHING`;
}

async function boot(reload) {
  if (!reload) {
    fs.mkdirSync(DATA, { recursive: true });
    await seedOnce('secret', () => crypto.randomBytes(32).toString('hex'));
    const webpush = apiRequire('web-push');
    await seedOnce('vapid.json', () => JSON.stringify(webpush.generateVAPIDKeys()));
    await pull();
  }
  // server.js keeps db.json in memory: a copy written by another instance means a fresh module.
  const mod = await import(`../../../api/server.js?g=${++generation}`);
  server = mod.server;
}

let ready = null;
export default async function handler(req, res) {
  try {
    if (!ready) ready = boot(false);
    await ready;
    if (await pull()) { ready = boot(true); await ready; }
  } catch (e) {
    ready = null;
    console.error('sync failed', e);
    res.statusCode = 503; res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'storage unavailable' }));
  }
  const end = res.end.bind(res);
  res.end = (...args) => { push().catch(e => console.error('push failed', e)).finally(() => end(...args)); return res; };
  server.emit('request', req, res);
}
