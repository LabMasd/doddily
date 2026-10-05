// Turns the raw open-data collection (collected/openactive.json, made by openactive.mjs) into the file the merge reads:
// data/uk-research/openactive.json. Only the three operators agreed on 4 Oct 2026: Everyone Active, Better, Places Leisure.
//
//   node data/uk-research/scripts/openactive-clean.mjs          write the file and print what happened
//   node data/uk-research/scripts/openactive-clean.mjs --dry    print only
//
// What it does, and why:
//   - Names: the feeds carry till-roll abbreviations ("Soft Ply & Swim", "Discover L1-3 3-5y 45m"). They are rewritten
//     from the table below. A name with no rule and an abbreviation in it is dropped and listed, never guessed.
//   - Soft play: a centre publishes its soft play as many hourly slots under several names. They become ONE listing per
//     centre with the slots joined into opening-style ranges. Sessions for children with additional needs stay separate.
//   - Upgrades, not doubles: where Doddily already lists that centre's soft play (with no times), the new record takes
//     the old one's name, venue and ages, so the merge sees the same listing and the id (and anyone's Saved copy) survives.
//   - Times before 07:00 or from 19:00 are dropped: for under-fives they are almost always pool or hall availability.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..');
const DRY = process.argv.includes('--dry');
const OPERATORS = ['Everyone Active', 'Better', 'Places Leisure'];
const pcKey = (p) => String(p || '').replace(/\s+/g, '').toUpperCase();
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hm = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const raw = JSON.parse(fs.readFileSync(path.join(dir, 'collected', 'openactive.json'), 'utf8')).filter((r) => OPERATORS.includes(r.provider));

// ---- names -------------------------------------------------------------------------------------------------------
const SEND = /\b(send?|s e n|aln|inclusive|inc|quiet)\b/i;
const months = (a, b) => ` (${a}–${b} months)`;
/** [pattern, name, changes]. First match wins. `null` as the name drops the record. */
const RULES = [
  // swimming
  [/^(small group |cc - )?adult & child \(?4-18mths\)?$/i, (m) => `${m[1] && /small/i.test(m[1]) ? 'Small group adult' : 'Adult'} and child swimming lessons${months(4, 18)}`],
  [/^(small group |cc - )?adult & child \(?19-36mths\)?$/i, (m) => `${m[1] && /small/i.test(m[1]) ? 'Small group adult' : 'Adult'} and child swimming lessons${months(19, 36)}`],
  // Stage 1 and Stage 2 are the same thing to a parent choosing a pool (and the merge would treat them as one listing
  // and keep only the first), so they are one listing with every lesson time.
  [/^(small group )?pre school (stage|s) ?[12]?$/i, () => 'Pre-school swimming lessons'],
  [/^u5 fun swim(ming)?$/i, () => 'Under 5s fun swim'],
  [/^(soft pl(a)?y|act play) & swim$/i, () => 'Swim and soft play'], // worded so the merge does not take it for the centre's soft play
  [/^family fun baby (& )?toddler$/i, () => 'Baby and toddler family swim'],
  [/^baby toddler beach area$/i, () => 'Baby and toddler pool'],
  // movement
  [/^discover l1-3 3-5y \d+m$/i, () => 'Gymnastics Discover (3–5 years)', { age_min_months: 36, age_max_months: 60 }],
  [/^gym discover 1 adult & child 18-36m?$/i, () => `Adult and child gymnastics${months(18, 36)}`, { age_min_months: 18, age_max_months: 36 }],
  [/^gymnast disc 1$/i, () => 'Gymnastics Discover'],
  [/^adult & child gymnastics$/i, () => 'Adult and child gymnastics'],
  [/^tennis tots 2-4y$/i, () => 'Tennis Tots (2–4 years)'],
  [/^adult & child ice$/i, () => 'Adult and child ice skating'],
  [/^ice - tots 2-5y$/i, () => 'Tots ice skating (2–5 years)'],
  [/^tramp pre school 4-5yrs$/i, () => 'Pre-school trampolining (4–5 years)'],
  [/^adult & child trampoline$/i, () => 'Adult and child trampolining'],
  [/^adult ?& ?baby yoga$/i, () => 'Adult and baby yoga'],
  [/^adult & child football$/i, () => 'Adult and child football'],
  [/^athletot athletics 18m-4y$/i, () => 'Athletots athletics (18 months–4 years)'],
  [/^tots climb(ing)?$/i, () => 'Tots climbing'],
  [/^pre-sch gym 3-4y$/i, () => 'Pre-school gymnastics (3–4 years)'],
  [/^active antz$/i, () => 'Active Antz', { category: 'movement' }], // a led toddler activity session, not free soft play
  [/^toddler bounce( session)?$/i, () => 'Toddler Bounce'],
  [/^parent and baby$/i, null], // says nothing about what it is
  // parent-and-baby fitness (Places Leisure): the parent exercises, the baby comes along. One listing per centre with
  // every class time; the feed's own names ("Parent Baby L B T", "Parent Baby The Trip Vir") mean little to a parent.
  [/^parent (and |& )?baby (group cycl(e|ing)|cycle virtual|l b t|sculpt|(body ?)?balance( virt)?|pump virtual|core virtual|the trip vir)$/i, () => 'Parent and baby fitness classes',
    { category: 'fitness', description: 'Exercise classes for a parent with their baby alongside: cycle, legs, bums and tums, Body Balance and similar. Ask the centre which class is on which day.' }],
  [/^aerobics baby$/i, () => 'Aerobics with baby'],
  // stay and play
  [/^stay ?(&|and) ?play$/i, () => 'Stay and Play'],
  [/^(gymnastics stay and play|stay and play gymnastics)$/i, () => 'Stay and Play gymnastics'],
  // fine as they are
  [/^(toddler splash|swim for under 5s|buggy workout|buggy walk|tennis tots|coffee skate for under 5s|toddler active multi-zone|toddler time)$/i, (m) => m[0]],
];
const SOFTPLAY_UNKNOWN = /^(tag play|play park)$/i; // could not tell what these are

function rename(r) {
  const n = r.name.trim();
  for (const [re, make, changes] of RULES) {
    const m = re.exec(n);
    if (m) return make ? { ...r, ...changes, name: make(m) } : null;
  }
  return undefined; // no rule
}

// ---- sessions ----------------------------------------------------------------------------------------------------
const sane = (s) => s.start && toMin(s.start) >= 7 * 60 && toMin(s.start) < 19 * 60;
const sortSessions = (list) => list.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || toMin(a.start) - toMin(b.start));
function unique(list) {
  const seen = new Set();
  return sortSessions(list.filter((s) => { const k = `${s.day}|${s.start}|${s.end || ''}`; if (seen.has(k)) return false; seen.add(k); return true; }));
}
/** Back-to-back or overlapping slots on a day become one range: 09:00-10:00 + 10:00-11:00 = 09:00-11:00. */
function joined(list) {
  const out = [];
  for (const day of DAY_ORDER) {
    const spans = list.filter((s) => s.day === day && s.start).map((s) => [toMin(s.start), s.end ? toMin(s.end) : toMin(s.start) + 60]).sort((a, b) => a[0] - b[0]);
    let cur = null;
    for (const [a, b] of spans) {
      if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
      else { if (cur) out.push({ day, start: hm(cur[0]), end: hm(cur[1]) }); cur = [a, b]; }
    }
    if (cur) out.push({ day, start: hm(cur[0]), end: hm(cur[1]) });
  }
  return out;
}

// ---- what Doddily already lists (to upgrade, not double) ---------------------------------------------------------
const existing = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'openactive.json')) {
  for (const it of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) existing.push({ ...it, _file: f });
}
const existingAt = (pc, category) => existing.filter((e) => pcKey(e.postcode) === pc && e.category === category);

// ---- build ---------------------------------------------------------------------------------------------------------
const dropped = { 'no rule for the name': [], 'name says nothing': [], 'unclear soft play': [], 'no daytime session left': [] };
const softplay = new Map(); // one per centre: `${pc}` -> { parts, send }
const others = new Map(); // `${pc}|${category}|${name}|${ages}` -> record
const tidy = (r) => { const o = { ...r }; delete o.feed; delete o.licence; delete o.evidence; return o; };

for (const r of raw) {
  const sessions = r.sessions.filter(sane);
  if (!sessions.length) { dropped['no daytime session left'].push(`${r.name} @ ${r.venue}`); continue; }
  const pc = pcKey(r.postcode);

  if (r.category === 'softplay' && !/^active antz$/i.test(r.name) && !/& swim$/i.test(r.name)) {
    if (SOFTPLAY_UNKNOWN.test(r.name)) { dropped['unclear soft play'].push(`${r.name} @ ${r.venue}`); continue; }
    const key = `${pc}|${SEND.test(r.name) ? 'send' : 'open'}`;
    if (!softplay.has(key)) softplay.set(key, { send: SEND.test(r.name), parts: [] });
    softplay.get(key).parts.push({ ...r, sessions });
    continue;
  }

  const named = rename(r);
  if (named === null) { dropped['name says nothing'].push(`${r.name} @ ${r.venue}`); continue; }
  if (named === undefined) { dropped['no rule for the name'].push(`${r.name} @ ${r.venue}`); continue; }
  const key = `${pc}|${named.category}|${named.name}|${named.age_min_months ?? ''}-${named.age_max_months ?? ''}`;
  if (others.has(key)) { const o = others.get(key); o.sessions = unique([...o.sessions, ...sessions]); if (!o.price && named.price) o.price = named.price; }
  // Lessons run as a course you sign up to for a term, not something to turn up to.
  else others.set(key, tidy({ ...named, booking: /lessons/i.test(named.name) ? 'term' : named.booking, sessions: unique(sessions) }));
}

const out = [...others.values()];
let upgraded = 0, newSoftplay = 0, sendListings = 0;
for (const [key, group] of softplay) {
  const first = group.parts[0];
  const pc = key.split('|')[0];
  const sessions = joined(group.parts.flatMap((p) => p.sessions));
  const prices = [...new Set(group.parts.map((p) => p.price).filter(Boolean))];
  const base = tidy({ ...first, sessions, price: prices.length === 1 ? prices[0] : first.price || '' });
  if (group.send) {
    sendListings++;
    out.push({ ...base, name: 'SEND soft play session', age_min_months: 0, age_max_months: Math.max(...group.parts.map((p) => p.age_max_months || 60)),
      description: 'A quieter soft play session for children with additional needs and their families. Check with the centre who it is for before you go.' });
    continue;
  }
  const old = existingAt(pc, 'softplay').filter((e) => !(e.sessions || []).some((s) => s.start));
  const toddlers = group.parts.every((p) => /toddler'?s'? world/i.test(p.name));
  if (old.length) {
    // the listing Doddily already has for this centre: keep who it is, add when it is open
    upgraded++;
    const o = { ...old[0] }; delete o._file;
    out.push({ ...o, sessions, tier: 'timetable', schedule_note: base.schedule_note, price: base.price || o.price || '', url: o.url || base.url, source: base.source, attribution: base.attribution, confidence: 'high' });
  } else {
    newSoftplay++;
    out.push({ ...base, name: toddlers ? 'Toddlers’ World soft play' : 'Soft play', age_min_months: 0, age_max_months: Math.max(...group.parts.map((p) => p.age_max_months || 60)) });
  }
}

// ---- report --------------------------------------------------------------------------------------------------------
const by = (f) => out.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {});
console.log(`read ${raw.length} raw records from ${OPERATORS.join(', ')}`);
console.log(`wrote ${out.length} listings |`, JSON.stringify(by((r) => r.provider || 'existing listing')), '|', JSON.stringify(by((r) => r.category)));
console.log(`soft play: ${upgraded} existing listings given times, ${newSoftplay} new, ${sendListings} SEND sessions kept separate`);
for (const [why, list] of Object.entries(dropped)) if (list.length) console.log(`dropped (${why}): ${list.length} — ${[...new Set(list.map((x) => x.split(' @ ')[0]))].slice(0, 12).join(', ')}`);
const names = by((r) => r.name);
console.log('names:', Object.entries(names).sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n} x${k}`).join(' | '));
const most = Math.max(...out.map((r) => r.sessions.length)); console.log(`most sessions on one listing: ${most}`);
// anything left that sits beside an existing listing of the same kind at the same postcode, and is not the same listing
const near = out.filter((r) => existingAt(pcKey(r.postcode), r.category).some((e) => slug(e.name) !== slug(r.name)) && !existingAt(pcKey(r.postcode), r.category).some((e) => slug(e.name) === slug(r.name)));
console.log(`beside an existing listing of the same kind at the same postcode (worth a look): ${near.length}`, near.slice(0, 8).map((r) => `${r.name} @ ${r.venue} ~ ${existingAt(pcKey(r.postcode), r.category)[0].name}`).join(' ; '));

if (!DRY) { fs.writeFileSync(path.join(dir, 'openactive.json'), JSON.stringify(out, null, 1)); console.log(`-> data/uk-research/openactive.json`); }
