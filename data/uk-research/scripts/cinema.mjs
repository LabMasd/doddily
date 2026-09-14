#!/usr/bin/env node
// Little Days — UK parent & baby cinema screenings (chains).
// Polite collector: ≤1 request/second, identifying User-Agent, on-disk cache.
// Chains covered: Picturehouse, Everyman, Showcase, Cineworld, Curzon, Reel, Arc, Scott, Savoy, WTW, The Light.
// Skipped (reported): ODEON (Cloudflare bot challenge — not worked around), Vue (no dedicated baby screenings),
// Merlin (no parent & baby programme found on its cinema pages).
// Independents are researched by hand and merged from independents.json if present.
//
// Usage: TODAY=2026-09-15 node cinema.mjs

import fs from "node:fs";
import crypto from "node:crypto";

const UA = "LittleDaysBot/1.0 (non-commercial family app; links back to providers)";
const WORK = "/private/tmp/claude-501/-Users-marcos/0163a3c6-bbf9-4559-87fa-6bce78e5fab8/scratchpad/uk/cinema";
const CACHE = `${WORK}/pages`;
const INDEPENDENTS = `${WORK}/independents.json`;
const OUT = "/Users/marcos/little-days/data/uk-research/cinema.json";
fs.mkdirSync(CACHE, { recursive: true });

const TODAY = process.env.TODAY || new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const report = { skipped: [], notes: [] };

// ---------- polite fetch ----------
let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle() { const w = 1100 - (Date.now() - last); if (w > 0) await sleep(w); last = Date.now(); }
async function get(url, { method = "GET", body, headers = {}, accept, cacheKey, noCache } = {}) {
  const key = crypto.createHash("md5").update(cacheKey || url + (body || "")).digest("hex");
  const f = `${CACHE}/${key}`;
  if (!noCache && fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  await throttle();
  let r;
  try {
    r = await fetch(url, { method, body, headers: { "User-Agent": UA, Accept: accept || "text/html,application/json;q=0.9,*/*;q=0.8", ...headers } });
  } catch (e) { console.error("ERR", url, e.cause?.message || e.message); return null; }
  const t = await r.text();
  fs.appendFileSync(`${CACHE}/index.tsv`, `${key}\t${r.status}\t${t.length}\t${url}\n`);
  if (!r.ok) { console.error("HTTP", r.status, url); return null; }
  if (!noCache) fs.writeFileSync(f, t);
  return t;
}
const getJSON = async (url, o = {}) => { const t = await get(url, { accept: "application/json", ...o }); try { return t ? JSON.parse(t) : null; } catch { return null; } };

// ---------- helpers ----------
const ENT = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—", pound: "£", copy: "©" };
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const lines = (h) => decode((h || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, "").replace(/<[^>]+>/g, "\n")).split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
const PC = /\b([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\b/;
const normPC = (p) => { if (!p) return ""; const s = p.toUpperCase().replace(/\s+/g, ""); return s.length > 3 ? s.slice(0, -3) + " " + s.slice(-3) : s; };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dow = (iso) => DAYS[new Date(iso.slice(0, 10) + "T12:00:00Z").getUTCDay()];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dmToISO(dm) { // "Wed 16 Sep" or "Wednesday 23 September"
  const m = dm.match(/(\d{1,2}) ([A-Z][a-z]{2})/); if (!m) return null;
  const mon = MONTHS.indexOf(m[2]); if (mon < 0) return null;
  let y = +TODAY.slice(0, 4); if (mon + 1 < +TODAY.slice(5, 7) - 2) y++;
  return `${y}-${String(mon + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
const fmtDay = (iso) => `${dow(iso)} ${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
const hhmm = (t) => t.replace(/^(\d):/, "0$1:");

// Derive the usual weekly pattern from observed start times ("YYYY-MM-DDTHH:MM").
function pattern(starts) {
  starts = [...new Set(starts.filter((s) => s && s.slice(0, 10) >= TODAY))].sort();
  const byDay = {};
  for (const s of starts) { const d = dow(s); ((byDay[d] ??= {})[s.slice(0, 10)] ??= new Set()).add(hhmm(s.slice(11, 16))); }
  // One session per weekday. Start = earliest first-screening time when each week's first screening
  // falls within 45 minutes of the others; otherwise null (times vary too much to be useful).
  const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const sessions = []; let varied = false; const perDay = [];
  for (const day of ORDER) {
    const dates = byDay[day]; if (!dates) continue;
    const ds = Object.keys(dates);
    const firsts = ds.map((d) => [...dates[d]].sort()[0]).sort();
    const spread = mins(firsts[firsts.length - 1]) - mins(firsts[0]);
    const start = spread <= 45 ? firsts[0] : null;
    if (spread > 0) varied = true;
    sessions.push({ day, start, end: null });
    const all = [...new Set(ds.flatMap((d) => [...dates[d]]))].sort();
    perDay.push({ day, weeks: ds.length, times: all, many: Math.max(...ds.map((d) => dates[d].size)) > 1 });
  }
  const allTimes = starts.map((s) => hhmm(s.slice(11, 16))).sort();
  return { sessions, varied, perDay, n: starts.length, first: starts[0], last: starts[starts.length - 1], range: allTimes.length ? `${allTimes[0]}–${allTimes[allTimes.length - 1]}` : "" };
}
function scheduleNote(p, lead) {
  if (!p.n) return lead;
  const days = p.perDay.map((d) => d.day);
  const dayTxt = days.length > 1 ? days.slice(0, -1).join(", ") + " and " + days[days.length - 1] : days[0];
  const bits = [lead];
  bits.push(p.first.slice(0, 10) === p.last.slice(0, 10) ? `only listing so far is ${fmtDay(p.first)}` : `listings ${fmtDay(p.first)}–${fmtDay(p.last)} show ${dayTxt}`);
  if (p.perDay.some((d) => d.many)) bits.push(`often more than one screening a day (${p.range})`);
  else if (p.varied) bits.push(`start times vary a little (${p.range})`);
  if (p.perDay.some((d) => d.weeks === 1) && p.perDay.length) bits.push("some days seen only once so far");
  return bits.join("; ") + "; film changes each week.";
}
function item(o) {
  const p = o.pattern;
  const sessions = o.sessions ?? p?.sessions ?? [];
  return {
    name: o.name, provider: o.provider, category: "cinema", venue: o.venue, address: o.address, postcode: normPC(o.postcode),
    lat: o.lat ?? null, lng: o.lng ?? null, sessions, tier: sessions.length ? "timetable" : "venue",
    schedule_note: o.schedule_note, age_min_months: o.age_min ?? 0, age_max_months: o.age_max ?? 12,
    price: o.price, free: false, booking: o.booking || "book", indoor: true, description: o.description,
    url: o.url, phone: o.phone || "", source: o.source, confidence: o.confidence,
  };
}
const items = [];
const count = (prov) => items.filter((i) => i.provider === prov).length;

// ---------- Picturehouse ----------
async function picturehouse() {
  const EVENT = "https://www.picturehouses.com/event-details/0000000008/big-scream-parent-baby/100";
  // Session cookies + tokens are needed for the site's own AJAX endpoints (fetched live, one request).
  await throttle();
  const r0 = await fetch(EVENT, { headers: { "User-Agent": UA } });
  const html = await r0.text();
  const cookie = (r0.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const xsrf = (html.match(/var token = "([^"]+)"/) || [])[1];
  const csrf = (html.match(/_token: "([^"]+)"/) || [])[1];
  const i = html.indexOf('id="cinema_list"');
  const ids = [...html.slice(i, i + 8000).matchAll(/<option value="(\d+)"/g)].map((m) => m[1]);
  const hdr = { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", Cookie: cookie };
  const list = await getJSON("https://www.picturehouses.com/ajax-cinema-list", { method: "POST", body: "_token=" + csrf, headers: hdr, cacheKey: `ph-cinema-list-${TODAY}` });
  const cin = Object.fromEntries((list?.cinema_list || []).map((c) => [c.cinema_id, c]));
  // Venue display names and gaps in Picturehouse's own address data (postcode for Chester from OpenStreetMap).
  const VENUE = { "001": "Cinema City", "004": "Ritzy Picturehouse", "005": "Cameo Picturehouse", "008": "Duke of York's Picturehouse", "013": "Picturehouse at FACT", "014": "Phoenix Picturehouse", "017": "Harbour Lights Picturehouse", "018": "City Screen Picturehouse", "019": "Duke's at Komedia" };
  const FIX = { "032": { address: "Exchange Square, Chester", postcode: "CH1 2AR" } };
  for (const id of ids) {
    const d = await getJSON("https://www.picturehouses.com/api/scheduled-movies-ajax", { method: "POST", body: "cinema_id=" + id, headers: { ...hdr, "X-XSRF-TOKEN": xsrf }, cacheKey: `ph-sched-${id}-${TODAY}` });
    const starts = [];
    for (const mv of d?.movies || []) for (const st of mv.show_times || []) if ((st.SessionAttributesNames || []).some((a) => /baby/i.test(a))) starts.push(st.Showtime.slice(0, 16));
    const c = cin[id] || {}; const p = pattern(starts);
    const venue = VENUE[id] || (/picturehouse/i.test(c.name) ? c.name : `${c.name} Picturehouse`);
    const parts = [c.address1, c.address2, c.city].filter((x) => x && x.trim()).map((x) => x.trim());
    const pc = (parts.join(" ").match(PC) || [])[1] || FIX[id]?.postcode || "";
    const address = FIX[id]?.address || [...new Set(parts.filter((x) => !PC.test(x) || x.replace(PC, "").trim()))].join(", ");
    items.push(item({
      name: "Watch with Baby", provider: "Picturehouse", venue, address: [address, pc].filter(Boolean).join(", "), postcode: pc,
      lat: c.latitude ? +c.latitude : null, lng: c.longitude ? +c.longitude : null, pattern: p,
      schedule_note: scheduleNote(p, "Weekly parent and baby screening (formerly Big Scream)"),
      age_max: 12, price: "Adult ticket price varies by cinema; see booking page", description: "Parent and baby screening of a current film for grown-ups with babies under one, with the lights up a little and the sound lower.",
      url: EVENT, phone: "", source: "picturehouses.com", confidence: p.n ? "high" : "medium",
    }));
  }
}

// ---------- Everyman & Showcase (same Webedia platform) ----------
async function webediaTheaters(host, page) {
  const pd = await getJSON(`https://${host}/page-data/${page}/page-data.json`);
  for (const h of pd?.staticQueryHashes || []) {
    const sq = await getJSON(`https://${host}/page-data/sq/d/${h}.json`);
    const nodes = sq?.data?.allTheater?.nodes; if (nodes) return nodes;
  }
  return [];
}
async function webedia({ host, page, provider, name, venuePrefix, lead, price, description, url, source }) {
  const th = (await webediaTheaters(host, page)).filter((t) => t.country?.iso31661A2 === "GB" && !t.practicalInfo?.closed);
  for (const t of th) {
    const q = encodeURIComponent(JSON.stringify({ id: t.id, timeZone: "Europe/London" }));
    const u = `https://${host}/api/gatsby-source-boxofficeapi/schedule?from=${TODAY}T03%3A00%3A00&to=${addDays(TODAY, 14)}T03%3A00%3A00&theaters=${q}`;
    const d = await getJSON(u);
    const starts = [];
    for (const days of Object.values(d?.[t.id]?.schedule || {})) for (const arr of Object.values(days)) for (const s of arr) if (s.tags.some((x) => /BabyClub/i.test(x))) starts.push(s.startsAt.slice(0, 16));
    if (!starts.length) continue;
    const p = pattern(starts); const loc = t.practicalInfo?.location || {};
    items.push(item({
      name, provider, venue: provider === "Showcase" ? `${/de-lux/.test(t.path) ? "Showcase Cinema de Lux" : "Showcase Cinemas"} ${t.name}` : `${venuePrefix} ${t.name}`, address: [loc.address, loc.city, loc.zip].filter(Boolean).join(", "), postcode: loc.zip,
      lat: t.practicalInfo?.coordinates?.latitude, lng: t.practicalInfo?.coordinates?.longitude, pattern: p,
      schedule_note: scheduleNote(p, lead), age_max: 12, price, description, url, phone: t.practicalInfo?.phone || "", source, confidence: "high",
    }));
  }
}

// ---------- Cineworld ----------
async function cineworld() {
  const base = "https://www.cineworld.co.uk/uk/data-api-service/v1/quickbook/10108";
  const until = addDays(TODAY, 30);
  const c = await getJSON(`${base}/cinemas/with-event/until/${until}?attr=cinebabies&lang=en_GB`);
  for (const cin of c?.body?.cinemas || []) {
    const dates = (await getJSON(`${base}/dates/in-cinema/${cin.id}/until/${until}?attr=cinebabies&lang=en_GB`))?.body?.dates || [];
    const starts = [];
    for (const dt of dates) {
      const e = (await getJSON(`${base}/film-events/in-cinema/${cin.id}/at-date/${dt}?attr=cinebabies&lang=en_GB`))?.body;
      for (const x of e?.events || []) if (x.attributeIds.includes("cinebabies")) starts.push(x.eventDateTime.slice(0, 16));
    }
    const p = pattern(starts);
    items.push(item({
      name: "Cinebabies", provider: "Cineworld", venue: `Cineworld ${cin.displayName}`, address: cin.address, postcode: cin.addressInfo?.postalCode,
      lat: cin.latitude, lng: cin.longitude, pattern: p, schedule_note: scheduleNote(p, "Parent and baby screenings, not every week at every cinema"),
      age_max: 18, price: "Adult ticket; see booking page", description: "Screening just for parents and babies, with pushchair storage, dimmed lights and the sound turned down a little.",
      url: "https://www.cineworld.co.uk/cinebabies", phone: "", source: "cineworld.co.uk", confidence: p.n >= 2 ? "high" : "medium",
    }));
  }
}

// ---------- Curzon (Vista digital API with the anonymous token the website itself serves) ----------
async function curzon() {
  const PAGE = "https://www.curzon.com/community-screenings/baby-club/";
  const html = await get(PAGE);
  const m = html?.match(/window\.initialData\s*=\s*(\{[\s\S]*?\});\s*window\.pageData/);
  if (!m) { report.skipped.push("Curzon: could not read site config"); return; }
  const { apiUrl, authToken } = JSON.parse(m[1]).api;
  const H = { Authorization: "Bearer " + authToken };
  const sites = (await getJSON(`${apiUrl}/ocapi/v1/sites`, { headers: H }))?.sites || [];
  const starts = {};
  for (let n = 0; n < 14; n++) {
    const d = addDays(TODAY, n);
    const j = await getJSON(`${apiUrl}/ocapi/v1/showtimes/by-business-date/${d}?siteIds=${sites.map((s) => s.id).join("&siteIds=")}`, { headers: H });
    if (!j) continue;
    const baby = new Set((j.relatedData?.attributes || []).filter((a) => /baby/i.test(a.name?.text)).map((a) => a.id));
    for (const st of j.showtimes || []) if ((st.attributeIds || []).some((a) => baby.has(a))) (starts[st.siteId] ??= []).push(st.schedule.startsAt.slice(0, 16));
  }
  for (const s of sites) {
    if (!starts[s.id]) continue;
    const a = s.contactDetails?.address || {};
    const parts = [a.line1, a.line2, a.city].filter(Boolean).map((x) => x.replace(/,\s*$/, "").trim());
    const pc = (parts.join(" ").match(PC) || [])[1] || "";
    const p = pattern(starts[s.id]);
    items.push(item({
      name: "Baby Club", provider: "Curzon", venue: `Curzon ${s.name.text}`, address: parts.join(", "), postcode: pc,
      lat: s.location?.latitude, lng: s.location?.longitude, pattern: p, schedule_note: scheduleNote(p, "Weekly baby-friendly screening"),
      age_max: 12, price: "Adult ticket; babies under 12 months free", description: "Baby-friendly screening with the lights at half and the sound turned lower, plus changing mats and a bottle warmer.",
      url: PAGE, phone: "", source: "curzon.com", confidence: "high",
    }));
  }
}

// ---------- Reel ----------
async function reel() {
  const idx = await get("https://reelcinemas.co.uk/cinemas");
  const slugs = [...new Set([...(idx || "").matchAll(/href="\/cinemas\/([a-z-]+)"/g)].map((m) => m[1]))];
  for (const s of slugs) {
    const info = lines(await get(`https://reelcinemas.co.uk/cinemas/${s}`));
    const wo = (await get(`https://reelcinemas.co.uk/${s}/whatson`)) || "";
    const ti = wo.indexOf('id="scheduleTabs"');
    const tabs = Object.fromEntries([...wo.slice(ti, ti + 20000).matchAll(/data-target="(\d+)"[^>]*>\s*([^<]+?)\s*</g)].map((m) => [m[1], m[2]]));
    const panels = [...wo.matchAll(/id="panel(\d+)"/g)].map((m) => [m.index, m[1]]);
    const starts = [];
    panels.forEach(([at, n], k) => {
      const seg = wo.slice(at, panels[k + 1]?.[0] ?? wo.length);
      const label = tabs[n] || ""; const date = label === "Today" ? TODAY : label === "Tomorrow" ? addDays(TODAY, 1) : dmToISO(label);
      for (const b of seg.matchAll(/Parent \+ Baby<\/p>\s*<div[^>]*>([\s\S]*?)<\/div>/g)) for (const t of b[1].matchAll(/>\s*(\d{1,2}:\d{2})\s*</g)) if (date) starts.push(`${date}T${hhmm(t[1])}`);
    });
    const vi = info.indexOf("VISIT US"); let addr = [];
    if (vi >= 0) for (let k = vi + 1; k < vi + 8 && k < info.length; k++) { addr.push(info[k].replace(/,\s*$/, "")); if (PC.test(info[k])) break; }
    const pc = (addr.join(" ").match(PC) || [])[1] || "";
    const ph = info[info.findIndex((l) => /^TEL:?$/i.test(l)) + 1] || "";
    const name = s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    const p = pattern(starts);
    const listed = p.n > 0;
    items.push(item({
      name: "Parent + Baby", provider: "Reel", venue: `Reel Cinema ${name}`, address: addr.join(", "), postcode: pc, pattern: p,
      sessions: listed ? p.sessions : [{ day: "Tue", start: null, end: null }],
      schedule_note: listed ? scheduleNote(p, "Reel runs Parent + Baby every Tuesday morning") : "Reel says Parent + Baby runs every Tuesday morning; nothing listed at this cinema right now, so check before going.",
      age_max: 12, price: "£4.99 including hot drinks and refills", description: "Tuesday morning screening just for parents and carers with babies under 12 months, with lower volume and softer lighting.",
      url: `https://reelcinemas.co.uk/${s}/parentandbaby`, phone: /\d/.test(ph) ? ph : "", source: "reelcinemas.co.uk", confidence: listed ? "high" : "medium",
    }));
  }
}

// ---------- Arc ----------
async function arc() {
  const home = await get("https://www.arccinema.co.uk/");
  const subs = [...new Set([...(home || "").matchAll(/https?:\/\/([a-z-]+)\.arccinema\.co\.uk/g)].map((m) => m[1]).filter((s) => s !== "www"))];
  for (const s of subs) {
    const pb = lines(await get(`https://${s}.arccinema.co.uk/whatson/parent-baby`));
    if (!pb.some((l) => /Parent & Baby screenings, scheduled/i.test(l))) { report.skipped.push(`Arc ${s}: no Parent & Baby programme on its page`); continue; }
    const info = lines(await get(`https://${s}.arccinema.co.uk/cinema-info`));
    const addr = info.find((l) => PC.test(l) && l.length < 120 && !/postcode/i.test(l)) || "";
    const next = [];
    pb.forEach((l, k) => { if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2} [A-Z][a-z]{2}$/.test(l) && /^\d{2}:\d{2}$/.test(pb[k + 1] || "")) next.push(`${l}, ${pb[k + 1]}`); });
    const town = s === "greatyarmouth" ? "Great Yarmouth" : s[0].toUpperCase() + s.slice(1);
    items.push(item({
      name: "Parent & Baby", provider: "Arc", venue: `The Arc Cinema ${town}`, address: addr, postcode: (addr.match(PC) || [])[1] || "", sessions: [],
      schedule_note: `Usually monthly on a weekday morning, not in school holidays. ${next.length ? "Next: " + [...new Set(next)].join("; ") + "." : "No date listed right now."}`,
      age_max: 18, price: "Standard ticket; babies under 18 months free", description: "Monthly screening of a new release for parents with babies under 18 months, with lights dimmed but not off and the sound lowered.",
      url: `https://${s}.arccinema.co.uk/whatson/parent-baby`, phone: "", source: "arccinema.co.uk", confidence: "medium",
    }));
  }
}

// ---------- Scott Cinemas ----------
async function scott() {
  const home = await get("https://www.scottcinemas.co.uk/");
  const opts = [...(home || "").matchAll(/<option[^>]*value="([a-z]+)"[^>]*>([^<]+)/g)].map((m) => [m[1], decode(m[2]).trim()]);
  for (const [sub, label] of opts) {
    const L = lines(await get(`https://${sub}.scottcinemas.co.uk/offers/parent-and-baby`));
    if (!L.some((l) => /Little Screeners screenings are on/i.test(l))) { report.skipped.push(`Scott ${label}: no Little Screeners text`); continue; }
    const starts = [];
    L.forEach((l, k) => { if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d{1,2} [A-Z][a-z]+$/.test(l) && /^\d{1,2}:\d{2}$/.test(L[k + 1] || "")) starts.push(`${dmToISO(l)}T${hhmm(L[k + 1])}`); });
    const p = pattern(starts);
    const ci = L.findIndex((l) => /^© \d{4} WTW Scott/.test(l));
    const addr = ci > 0 ? L.slice(Math.max(0, ci - 4), ci).filter((l) => !/^Scott Cinemas,?$/.test(l) && !/Automated|Direct/.test(l)).map((l) => l.replace(/,\s*$/, "")) : [];
    const pc = (addr.join(" ").match(PC) || [])[1] || "";
    const phone = (L.find((l) => /^Direct:/.test(l)) || "").replace(/^Direct:\s*/, "");
    items.push(item({
      name: "Little Screeners", provider: "Scott Cinemas", venue: `Scott Cinemas ${label}`, address: addr.join(", "), postcode: pc, pattern: p,
      sessions: p.n ? p.sessions : [{ day: "Wed", start: "12:00", end: null }],
      schedule_note: p.n ? scheduleNote(p, "Scott says Little Screeners runs Wednesdays at noon (doors 11:45, film 12:25)") : "Wednesdays at noon: doors 11:45, film starts 12:25.",
      age_max: 24, price: "Ticket includes tea/coffee or a small fountain drink and a Twix", description: "Wednesday parent and baby screening for babies under two, with house lights on low and the sound turned down.",
      url: `https://${sub}.scottcinemas.co.uk/offers/parent-and-baby`, phone, source: "scottcinemas.co.uk", confidence: "high",
    }));
  }
}

// ---------- Savoy (Northern Morris) ----------
async function savoy() {
  const SITES = [["savoyboston.co.uk", "SavoyBoston", "Boston"], ["savoycorby.co.uk", "SavoyCorby", "Corby"], ["savoydoncaster.uk", "SavoyDoncaster", "Doncaster"], ["savoygrantham.co.uk", "SavoyGrantham", "Grantham"], ["savoyworksop.co.uk", "SavoyWorksop", "Worksop"], ["savoycatterick.co.uk", "SavoyCatterick", "Catterick"], ["savoyonline.co.uk", "SavoyNottingham", "Nottingham"]];
  for (const [host, dll, town] of SITES) {
    const url = `https://${host}/${dll}.dll/Page?p=1&m=mm&sp=2`;
    const L = lines(await get(url));
    const starts = [];
    L.forEach((l, k) => { if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}$/.test(l) && /^\d{1,2}:\d{2}$/.test(L[k + 1] || "") && L[k + 2] === "PB") starts.push(`${dmToISO(l)}T${hhmm(L[k + 1])}`); });
    if (!starts.length) { report.skipped.push(`Savoy ${town}: no parent & baby dates listed`); continue; }
    let C = lines(await get(`https://${host}/${dll}.dll/Page?p=1&m=fm`));
    let pi = C.findIndex((l) => PC.test(l) && l.length < 20);
    if (pi < 0) { C = lines(await get(`https://${host}/${dll}.dll/Page?p=3&m=mm&sp=0`)); pi = C.findIndex((l) => PC.test(l) && l.length < 20); }
    const addr = pi >= 0 ? C.slice(Math.max(0, pi - 3), pi + 1).filter((l) => !/^Savoy Cinema$/.test(l)).map((l) => l.replace(/,\s*$/, "")) : [];
    const phone = (C.find((l) => /^(Box Office: )?0\d{3,4} ?\d{3} ?\d{3,4}$/.test(l)) || "").replace(/^Box Office:\s*/, "");
    const p = pattern(starts);
    items.push(item({
      name: "Parent & Baby", provider: "Savoy Cinemas", venue: `Savoy Cinema ${town}`, address: addr.join(", "), postcode: (addr.join(" ").match(PC) || [])[1] || "", pattern: p,
      schedule_note: scheduleNote(p, "Parent & Baby screenings of U, PG and 12A films; tickets from the cinema on the day"),
      age_max: 12, price: "Standard ticket; under-18-months free", booking: "drop-in", description: "Screening for parents with young babies, with low lights left on and the soundtrack volume reduced.",
      url, phone, source: host, confidence: "high",
    }));
  }
}

// ---------- WTW (Cornwall) ----------
async function wtw() {
  for (const [slug, town] of [["truro", "Plaza Truro"], ["st-austell", "White River St Austell"], ["newquay", "Lighthouse Newquay"], ["wadebridge", "Regal Wadebridge"]]) {
    const url = `https://wtwcinemas.co.uk/${slug}/cinema-details/accessible-screenings/`;
    const L = lines(await get(url));
    if (!L.some((l) => /Parent & Baby Friendly Screening/i.test(l))) continue;
    const k = L.findIndex((l) => PC.test(l) && l.length < 12);
    const addr = k > 0 ? L.slice(k - 3, k + 1).filter((l) => l !== "Cornwall" || true).map((l) => l.replace(/,\s*$/, "")) : [];
    const phone = (L.find((l) => /^Tel:/.test(l)) || "").replace(/^Tel:\s*/, "");
    items.push(item({
      name: "Parent & Baby Friendly Screening", provider: "WTW Cinemas", venue: `WTW ${town}`, address: addr.join(", "), postcode: L[k] || "", sessions: [],
      schedule_note: "Occasional parent & baby screenings, no fixed weekly day; check the cinema's What's On filter.",
      age_max: 36, price: "See cinema for prices", description: "Parent and baby friendly screening with the house lights left on and the film volume reduced.",
      url, phone, source: "wtwcinemas.co.uk", confidence: "medium",
    }));
  }
}

// ---------- The Light ----------
async function light() {
  const landing = await get("https://thelight.co.uk/");
  const towns = [...(landing || "").matchAll(/name="go" value="\d+">\s*<strong>([^<]+)<\/strong>/g)].map((m) => m[1].trim());
  for (const town of towns) {
    const sub = town.toLowerCase().replace(/[^a-z]/g, "");
    const url = `https://${sub}.thelight.co.uk/baby-friendly`;
    const h = await get(url); if (!h) continue;
    const L = lines(h);
    const flat = L.join(" ");
    const starts = [];
    for (const m of flat.matchAll(/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2})(.*?)(?=(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}|Looking for other|$)/g)) {
      const iso = dmToISO(m[1]); const ts = [...m[2].matchAll(/\b(\d{2}:\d{2})\b/g)].map((x) => x[1]);
      if (iso) (ts.length ? ts : ["??"]).forEach((t) => starts.push(t === "??" ? `${iso}T` : `${iso}T${t}`));
    }
    const clean = starts.filter((s) => s.length === 16);
    const dayOnly = [...new Set(starts.filter((s) => s.length === 11).map((s) => s.slice(0, 10)))];
    const p = pattern(clean.length ? clean : []);
    for (const d of dayOnly) if (!p.sessions.some((x) => x.day === dow(d))) p.sessions.push({ day: dow(d), start: null, end: null });
    const addr = L.find((l) => PC.test(l) && l.length < 120) || "";
    items.push(item({
      name: "Baby Friendly Screenings", provider: "The Light", venue: `The Light ${town}`, address: addr, postcode: (addr.match(PC) || [])[1] || "", pattern: p,
      sessions: p.sessions, schedule_note: scheduleNote(p, "Weekly baby friendly screening"),
      age_max: 12, price: "Standard ticket; free refill on fountain or hot drinks", description: "Screening only for parents and carers with babies under one, with the sound lowered and the lights dimmed but not off.",
      url, phone: "", source: "thelight.co.uk", confidence: p.sessions.length ? "high" : "medium",
    }));
  }
}

// ---------- geocoding (postcodes.io) ----------
const countryOf = {};
async function geocode(all) {
  const pcs = [...new Set(all.map((i) => normPC(i.postcode)).filter(Boolean))];
  const res = {};
  for (let k = 0; k < pcs.length; k += 100) {
    const body = JSON.stringify({ postcodes: pcs.slice(k, k + 100) });
    const j = await getJSON("https://api.postcodes.io/postcodes", { method: "POST", body, headers: { "Content-Type": "application/json" } });
    for (const r of j?.result || []) if (r.result) res[normPC(r.query)] = r.result;
  }
  // valid-looking postcode not in the live register: try terminated postcodes (keeps the published address)
  for (const pc of pcs.filter((p) => !res[p])) {
    const j = await getJSON(`https://api.postcodes.io/terminated_postcodes/${encodeURIComponent(pc)}`);
    if (j?.result) { res[pc] = { postcode: pc, latitude: j.result.latitude, longitude: j.result.longitude, country: null }; report.notes.push(`${pc}: terminated postcode, coordinates from postcodes.io terminated register`); }
  }
  // postcode missing or not found: reverse-geocode provider coordinates
  const need = all.filter((i) => !res[normPC(i.postcode)] && i.lat != null && i.lng != null);
  for (let k = 0; k < need.length; k += 100) {
    const geos = need.slice(k, k + 100).map((i) => ({ latitude: +i.lat, longitude: +i.lng, radius: 300, limit: 1 }));
    const body = JSON.stringify({ geolocations: geos });
    const j = await getJSON("https://api.postcodes.io/postcodes", { method: "POST", body, headers: { "Content-Type": "application/json" } });
    (j?.result || []).forEach((r, n) => { const hit = r.result?.[0]; const it = need[k + n]; if (hit) { it.postcode = hit.postcode; res[normPC(hit.postcode)] = { ...hit, _keepCoords: true }; report.notes.push(`${it.venue}: postcode ${hit.postcode} from reverse geocode of provider coordinates`); } });
  }
  for (const i of all) {
    const r = res[normPC(i.postcode)];
    if (r) {
      if (!r._keepCoords) { i.lat = r.latitude; i.lng = r.longitude; }
      i.lat = +(+i.lat).toFixed(6); i.lng = +(+i.lng).toFixed(6); i.postcode = r.postcode; countryOf[i.venue] = r.country;
      if (i.address && !i.address.toUpperCase().replace(/\s/g, "").includes(r.postcode.replace(/\s/g, ""))) i.address = `${i.address}, ${r.postcode}`;
    } else report.notes.push(`${i.venue}: postcode ${i.postcode || "(none)"} not geocoded`);
  }
}

// ---------- run ----------
const chains = [
  ["Picturehouse", picturehouse],
  ["Everyman", () => webedia({ host: "www.everymancinema.com", page: "venues-list", provider: "Everyman", name: "Baby Club", venuePrefix: "Everyman", lead: "Baby Club runs weekly on Tuesday and Thursday mornings", price: "Ticket includes a hot drink and cake or small popcorn", description: "Morning screening of a new release with the volume down and soft lighting, with a hot drink and cake included.", url: "https://www.everymancinema.com/films-baby-club/", source: "everymancinema.com" })],
  ["Showcase", () => webedia({ host: "www.showcasecinemas.co.uk", page: "showtimes", provider: "Showcase", name: "Baby Friendly Screenings", venuePrefix: "Showcase", lead: "Baby friendly screenings every Monday and Thursday morning", price: "From £5.99 per parent and baby in cinema (£7.99 at Bluewater)", description: "Monday and Thursday morning screenings with soft lighting, lower volume and pram parking at the front.", url: "https://www.showcasecinemas.co.uk/baby-cinema/", source: "showcasecinemas.co.uk" })],
  ["Cineworld", cineworld], ["Curzon", curzon], ["Reel", reel], ["Arc", arc], ["Scott Cinemas", scott], ["Savoy Cinemas", savoy], ["WTW Cinemas", wtw], ["The Light", light],
];
for (const [label, fn] of chains) {
  try { await fn(); console.log(`${label}: ${count(label)} programmes`); }
  catch (e) { console.error(`${label} failed:`, e.message); report.skipped.push(`${label}: ${e.message}`); }
}
report.skipped.push("ODEON (Newbies): odeon.co.uk returns a Cloudflare bot challenge (HTTP 403, cf-mitigated) to automated requests — not worked around");
report.skipped.push("Vue: no dedicated parent & baby screenings (babies welcome at 12A-or-below screenings)");
report.skipped.push("Merlin: no parent & baby screenings found on checked cinema pages (Weston Plaza, Cromer, Redcar, Redruth, Ritz Penzance)");

let all = [...items];
if (fs.existsSync(INDEPENDENTS)) {
  const ind = JSON.parse(fs.readFileSync(INDEPENDENTS, "utf8"));
  const seen = new Set(all.map((i) => `${normPC(i.postcode)}|${i.venue.toLowerCase()}`));
  for (const i of ind) {
    const k = `${normPC(i.postcode)}|${(i.venue || "").toLowerCase()}`; if (seen.has(k)) continue;
    i.tier = (i.sessions || []).length ? "timetable" : "venue"; // same rule as chains: usual day known => timetable
    all.push(i); seen.add(k);
  }
}
await geocode(all);
all.sort((a, b) => a.provider.localeCompare(b.provider) || a.venue.localeCompare(b.venue));
fs.writeFileSync(OUT, JSON.stringify(all, null, 1) + "\n");

// summary
const by = {}; for (const i of all) by[i.provider] = (by[i.provider] || 0) + 1;
const nations = {}; for (const i of all) { const c = countryOf[i.venue] || "unknown"; nations[c] = (nations[c] || 0) + 1; }
console.log(JSON.stringify({ total: all.length, withDay: all.filter((i) => i.sessions.length).length, byProvider: by, nations, skipped: report.skipped, notes: report.notes }, null, 1));
