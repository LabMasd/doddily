// Merge research/*.json into data/activities.json: validate, dedupe, give stable ids.
// Usage: node scripts/merge.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(root, 'data/research');
const CATS = new Set(['library', 'stayplay', 'support', 'music', 'sensory', 'movement', 'massage', 'fitness', 'swim', 'cinema', 'museum', 'farm', 'softplay', 'cafe', 'outdoor']);
const DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const HM = /^\d{1,2}:\d{2}$/;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pad = (t) => (t && HM.test(t) ? t.padStart(5, '0') : null);

const items = [];
const seen = new Map();
const problems = [];

for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { problems.push(`${f}: bad JSON (${e.message})`); continue; }
  for (const raw of arr) {
    const it = { ...raw };
    if (!it.name || typeof it.lat !== 'number' || typeof it.lng !== 'number') { problems.push(`${f}: skipped "${it.name}" (no name/coords)`); continue; }
    if (!CATS.has(it.category)) { problems.push(`${f}: "${it.name}" unknown category ${it.category} → support`); it.category = 'support'; }
    it.sessions = (it.sessions || [])
      .map((s) => ({ day: String(s.day).slice(0, 3), start: pad(s.start), end: pad(s.end) }))
      .filter((s) => DAYS.has(s.day));
    if (!['drop-in', 'book', 'term'].includes(it.booking)) it.booking = 'book';
    it.free = !!it.free;
    it.indoor = it.indoor !== false;
    it.id = slug(`${it.name}-${it.venue || it.provider}`);
    const key = it.id;
    if (seen.has(key)) {
      // Same class at same venue from two searches: keep the one with more sessions.
      const prev = seen.get(key);
      if (it.sessions.length > prev.sessions.length) Object.assign(prev, it);
      continue;
    }
    seen.set(key, it);
    items.push(it);
  }
}

const checked = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(root, 'data/activities.json'), JSON.stringify({ checked, items }, null, 1));
console.log(`${items.length} activities written (checked ${checked})`);
if (problems.length) console.log(problems.join('\n'));
