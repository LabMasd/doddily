#!/usr/bin/env node
// Little Days — UK library rhyme time collector helpers.
//
//   node libraries.mjs fetch <url>      polite cached GET (robots.txt checked, >=1s between requests), prints body
//   node libraries.mjs text <url>       same, but strips HTML to plain text
//   node libraries.mjs merge            merge parts/*.json -> ../libraries.json, geocode postcodes via postcodes.io
//
// Parts are hand/agent-curated JSON arrays (one per region) in the cache dir's parts/ folder.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UA = 'LittleDaysBot/1.0 (non-commercial family app; links back to providers)';
const CACHE = '/private/tmp/claude-501/-Users-marcos/0163a3c6-bbf9-4559-87fa-6bce78e5fab8/scratchpad/uk/libraries';
const PARTS = path.join(CACHE, 'parts');
const OUT = new URL('../libraries.json', import.meta.url).pathname;
fs.mkdirSync(PARTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCK = path.join(CACHE, '.last-request');

async function throttle() {
  // global (cross-process) 1 req/s spacing via a timestamp file
  for (;;) {
    let last = 0;
    try { last = Number(fs.readFileSync(LOCK, 'utf8')) || 0; } catch {}
    const wait = last + 1100 - Date.now();
    if (wait <= 0) { fs.writeFileSync(LOCK, String(Date.now())); return; }
    await sleep(wait + Math.random() * 200);
  }
}

const key = (u) => crypto.createHash('sha1').update(u).digest('hex').slice(0, 16);

async function rawGet(url) {
  const f = path.join(CACHE, key(url) + '.cache');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  await throttle();
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*' }, redirect: 'follow' });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  fs.writeFileSync(f, body);
  return body;
}

async function robotsAllows(url) {
  const u = new URL(url);
  let txt = '';
  try { txt = await rawGet(`${u.origin}/robots.txt`); } catch { return true; }
  // minimal parser: groups for '*' or LittleDaysBot
  let applies = false; const dis = []; const allow = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = line.replace(/#.*/, '').match(/^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2];
    if (k === 'user-agent') applies = v === '*' || /littledaysbot/i.test(v);
    else if (applies && k === 'disallow' && v) dis.push(v);
    else if (applies && k === 'allow' && v) allow.push(v);
  }
  const p = u.pathname + u.search;
  const match = (rule) => new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')).test(p);
  const d = dis.filter(match).sort((a, b) => b.length - a.length)[0];
  const a = allow.filter(match).sort((a, b) => b.length - a.length)[0];
  return !d || (a && a.length >= d.length);
}

async function politeGet(url) {
  if (!(await robotsAllows(url))) throw new Error(`ROBOTS_DISALLOW ${url}`);
  return rawGet(url);
}

const toText = (html) => html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, '\n')
  .replace(/<\/t[dh]>/gi, ' | ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&ndash;|&mdash;/g, '-')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const normPc = (pc) => (pc || '').toUpperCase().replace(/\s+/g, '').replace(/^(.+)(\d[A-Z]{2})$/, '$1 $2');

async function merge() {
  const items = [];
  for (const f of fs.readdirSync(PARTS).filter((f) => f.endsWith('.json')).sort()) {
    const arr = JSON.parse(fs.readFileSync(path.join(PARTS, f), 'utf8'));
    for (const it of arr) items.push(it);
  }
  // geocode
  const pcs = [...new Set(items.map((i) => normPc(i.postcode)).filter(Boolean))];
  const geo = {};
  for (let i = 0; i < pcs.length; i += 100) {
    await throttle();
    const res = await fetch('https://api.postcodes.io/postcodes', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ postcodes: pcs.slice(i, i + 100) }),
    });
    const j = await res.json();
    for (const r of j.result || []) if (r.result) geo[normPc(r.query)] = [r.result.latitude, r.result.longitude];
  }
  // fallback: terminated postcodes
  for (const pc of pcs.filter((p) => !geo[p])) {
    await throttle();
    try {
      const j = await (await fetch(`https://api.postcodes.io/terminated_postcodes/${encodeURIComponent(pc)}`, { headers: { 'User-Agent': UA } })).json();
      if (j.result) geo[pc] = [j.result.latitude, j.result.longitude];
    } catch {}
  }
  const out = []; const seen = new Set(); const problems = [];
  for (const it of items) {
    const pc = normPc(it.postcode);
    const sessions = (it.sessions || []).filter((s) => DAYS.includes(s.day)).map((s) => ({ day: s.day, start: s.start || null, end: s.end || null }));
    const g = geo[pc];
    if (!g) problems.push(`no geocode: ${it.provider} / ${it.venue} (${it.postcode})`);
    const rec = {
      name: it.name, provider: it.provider, category: 'library', venue: it.venue, address: it.address || '', postcode: pc,
      lat: g ? g[0] : null, lng: g ? g[1] : null, sessions,
      tier: sessions.some((s) => s.start) ? 'timetable' : 'venue',
      schedule_note: it.schedule_note || '', age_min_months: it.age_min_months ?? 0, age_max_months: it.age_max_months ?? 60,
      price: 'Free', free: true, booking: it.booking || 'drop-in', indoor: true,
      description: it.description || 'Free songs and rhymes for babies and toddlers with their grown-ups.',
      url: it.url, phone: it.phone || '', source: it.source || (it.url ? new URL(it.url).hostname.replace(/^www\./, '') : ''),
      confidence: it.confidence || 'medium',
    };
    const k = [rec.provider, rec.venue, rec.name].join('|').toLowerCase();
    if (seen.has(k)) { // merge sessions of duplicates
      const prev = out.find((o) => [o.provider, o.venue, o.name].join('|').toLowerCase() === k);
      for (const s of sessions) if (!prev.sessions.some((p) => p.day === s.day && p.start === s.start)) prev.sessions.push(s);
      prev.tier = prev.sessions.some((s) => s.start) ? 'timetable' : 'venue';
      continue;
    }
    seen.add(k); out.push(rec);
  }
  for (const o of out) o.sessions.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || String(a.start).localeCompare(String(b.start)));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const byProv = {};
  for (const o of out) byProv[o.provider] = (byProv[o.provider] || 0) + 1;
  console.log(`wrote ${out.length} items -> ${OUT}`);
  console.log(byProv);
  if (problems.length) console.log(problems.join('\n'));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'fetch') process.stdout.write(await politeGet(arg));
else if (cmd === 'text') process.stdout.write(toText(await politeGet(arg)) + '\n');
else if (cmd === 'merge') await merge();
else console.log('usage: libraries.mjs fetch|text <url> | merge');
