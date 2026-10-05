// Brings in the classes Marcos and Victoria added by hand on the home server (the private doddily-add page)
// and writes them to data/research/added-by-us.json, where scripts/merge.mjs treats them as hand-checked.
//
//   node scripts/from-server.mjs              fetch, write the file, say what changed
//   node scripts/from-server.mjs --mark-live  after the data is published: tell the server those are now in the app
//
// The server is only reachable on the tailnet. DODDILY_ADD_URL overrides the address (for example a laptop test run).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASE = (process.env.DODDILY_ADD_URL || 'https://homeserver.tail6d7a62.ts.net:8206').replace(/\/$/, '');
const file = path.join(root, 'data', 'research', 'added-by-us.json');

const r = await fetch(`${BASE}/api/feed`, { signal: AbortSignal.timeout(15000) }).catch((e) => { console.error(`Could not reach ${BASE} (${e.message}). Is this Mac on the tailnet, and is the app running?`); process.exit(1); });
if (!r.ok) { console.error(`${BASE}/api/feed answered ${r.status}`); process.exit(1); }
const feed = await r.json();

if (process.argv.includes('--mark-live')) {
  for (const it of feed) await fetch(`${BASE}/api/classes/${it.added_id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'live' }) });
  console.log(`marked ${feed.length} as in the app`);
} else {
  const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const was = new Map(before.map((x) => [x.added_id, JSON.stringify(x)]));
  const added = feed.filter((x) => !was.has(x.added_id)), changed = feed.filter((x) => was.has(x.added_id) && was.get(x.added_id) !== JSON.stringify(x));
  const gone = before.filter((x) => !feed.some((y) => y.added_id === x.added_id));
  fs.writeFileSync(file, JSON.stringify(feed, null, 1) + '\n');
  console.log(`${feed.length} classes from the server -> data/research/added-by-us.json (${added.length} new, ${changed.length} changed, ${gone.length} removed)`);
  for (const x of added) console.log(`  new: ${x.name} · ${x.venue || x.postcode} · ${x.sessions.map((s) => `${s.day} ${s.start || ''}`.trim()).join(', ') || 'no days yet'}`);
  for (const x of gone) console.log(`  removed: ${x.name}`);
  if (added.length || changed.length || gone.length) console.log('next: node scripts/merge.mjs, check, commit, publish, then run this again with --mark-live');
}
