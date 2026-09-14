// Little Days — UK baby-friendly paid play venues & outings (soft play chains, class franchises, city/community farms).
// Official location lists only; robots.txt respected via fetch-lib (<=1 req/s, crawl-delay honoured, disk cache).
// Run: node play.mjs  -> ../play.json
import fs from 'node:fs';
import path from 'node:path';
import { get, CACHE, UA } from './fetch-lib.mjs';

const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../play.json');
const PC_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const PC_G = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/gi;
const normPC = (s) => { const m = String(s || '').toUpperCase().match(PC_RE); return m ? `${m[1]} ${m[2]}` : ''; };
const ent = (s) => String(s || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&').replace(/&pound;/g, '£').replace(/&nbsp;/g, ' ').replace(/&rsquo;|&lsquo;/g, "'").replace(/&quot;/g, '"').replace(/&ndash;/g, '–').replace(/&eacute;/g, 'é');
const txt = (h) => ent(String(h || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' | ')).replace(/[\u200b\u00a0]/g, ' ').replace(/\s*(\|\s*)+/g, ' | ');
const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\s*,\s*,+/g, ',').replace(/^[\s,|]+|[\s,|]+$/g, '').trim();
const log = (...a) => console.error(...a);
const report = { counts: {}, dropped: {}, notes: [] };
const drop = (src, why) => { report.dropped[src] = report.dropped[src] || []; report.dropped[src].push(why); };

async function page(url) {
  const r = await get(url);
  if (r.blocked) { report.notes.push(`robots.txt disallows ${url}`); return ''; }
  if (r.status !== 200) { log('HTTP', r.status, url); return ''; }
  return r.text;
}
function base(o) {
  return {
    name: o.name, provider: o.provider, category: o.category, venue: o.venue, address: clean(o.address), postcode: normPC(o.postcode || o.address),
    lat: 0, lng: 0, sessions: o.sessions || [], tier: o.tier || 'place', schedule_note: o.schedule_note || '',
    age_min_months: o.age_min_months ?? 0, age_max_months: o.age_max_months ?? 60, price: o.price || '', free: o.free ?? false,
    booking: o.booking || 'drop-in', indoor: o.indoor ?? true, description: o.description, url: o.url, phone: clean(o.phone || ''),
    source: o.source, confidence: o.confidence || 'medium', _lat: o.lat, _lng: o.lng,
  };
}
const DAY = { mo: 'Mon', tu: 'Tue', we: 'Wed', th: 'Thu', fr: 'Fri', sa: 'Sat', su: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
const ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hhmm = (s) => { const m = String(s).trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i); if (!m) return null; let h = +m[1]; const mi = m[2] || '00'; if (m[3]) { if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; } return `${String(h).padStart(2, '0')}:${mi}`; };
function groupHours(pairs) { // pairs: [[Day,'09:00–17:00'],...] -> "Mon–Thu 09:00–19:00, Fri–Sat 09:00–20:00"
  const sorted = ORDER.map((d) => pairs.find((p) => p[0] === d)).filter(Boolean);
  const out = []; let i = 0;
  while (i < sorted.length) { let j = i; while (j + 1 < sorted.length && sorted[j + 1][1] === sorted[i][1] && ORDER.indexOf(sorted[j + 1][0]) === ORDER.indexOf(sorted[j][0]) + 1) j++; out.push(`${sorted[i][0]}${j > i ? '–' + sorted[j][0] : ''} ${sorted[i][1]}`); i = j + 1; }
  if (out.length === 1 && sorted.length === 7) return 'Daily ' + sorted[0][1];
  return out.join(', ');
}

// ---------------------------------------------------------------- Wacky Warehouse (Greene King)
async function wacky() {
  const sm = await page('https://www.wackywarehouse.co.uk/venues-sitemap');
  const paths = [...new Set(sm.match(/\/play-area\/[a-z0-9-]+\/[a-z0-9-]+/g) || [])];
  const rows = [];
  for (const p of paths) {
    const url = 'https://www.wackywarehouse.co.uk' + p;
    const h = await page(url); if (!h) { drop('Wacky Warehouse', 'fetch ' + url); continue; }
    const lds = [...h.matchAll(/application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
    const lb = lds.find((j) => j['@type'] === 'LocalBusiness'); const pub = lds.find((j) => j['@type'] === 'BarOrPub') || {};
    if (!lb) { drop('Wacky Warehouse', 'no LocalBusiness data ' + url); continue; }
    const a = lb.address || {}; const t = txt(h);
    const hours = (lb.openingHours || pub.openingHours || []).map((s) => { const m = s.match(/^(\w\w)\s+(\d\d:\d\d)-(\d\d:\d\d)/); return m ? [DAY[m[1].toLowerCase()], `${m[2]}–${m[3]}`] : null; }).filter(Boolean);
    const ga = (t.match(/General Admission \| £\s*([\d.]+)/i) || [])[1];
    const tots = t.match(/Tots Club \| £\s*([\d.]+)[^|]*/i);
    const babyFree = /babies under 12 months/i.test(t);
    let note = hours.length ? groupHours(hours) : '';
    if (tots) note += (note ? '; ' : '') + 'Tots Club term-time weekdays';
    if (/last admissions 1 hour before/i.test(t)) note += '; last entry 1 hr before close';
    const priceParts = []; if (ga) priceParts.push(`£${ga} per child`); if (tots) priceParts.push(`Tots Club £${tots[1]}`); if (babyFree) priceParts.push('under-1s free');
    const venueName = ent(lb.name);
    rows.push(base({
      name: `Wacky Warehouse ${venueName}`, provider: 'Wacky Warehouse', category: 'softplay', venue: `Wacky Warehouse at ${venueName}`,
      address: [a.streetAddress, a.addressLocality, a.addressRegion].filter(Boolean).map(ent).join(', '), postcode: a.postalCode,
      schedule_note: note, age_min_months: 0, age_max_months: 144, price: priceParts.join('; '), free: false, booking: 'drop-in',
      description: tots ? 'Indoor soft play at a family pub, with a Tots Club session for under-5s on term-time weekdays.' : 'Indoor soft play attached to a family pub, with play areas for younger children.',
      url, phone: lb.telephone, source: 'wackywarehouse.co.uk', confidence: 'high', lat: +lb.geo?.latitude, lng: +lb.geo?.longitude,
    }));
  }
  return rows;
}

// ---------------------------------------------------------------- Gymboree Play & Music (gymbo.co.uk; crawl-delay 10)
async function gymboree() {
  const idx = await page('https://gymbo.co.uk/locations/');
  const urls = [...new Set([...idx.matchAll(/href="(https?:\/\/(?:www\.)?gymbo\.co\.uk\/locations\/[a-z0-9-]+\/)"/g)].map((m) => m[1]))];
  const rows = [];
  for (const url of urls) {
    const h = await page(url); if (!h) continue;
    const t = txt(h);
    const ld = [...h.matchAll(/application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).find((j) => j && j['@type'] === 'LocalBusiness');
    const title = ent((h.match(/<title>([^<|]*)/) || [])[1] || '').trim();
    const place = title.replace(/^Gymboree Play & Music\s*/i, '').trim();
    // Contact block: "Contact Us | line | line | ... | POSTCODE | phone"
    const cm = t.match(/Contact Us \|((?:[^|]{2,80}\|){1,6}?)\s*([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\s*\|\s*([0-9 +]{9,16})?/);
    const address = cm ? cm[1].split('|').map((s) => s.replace(/\*[^*]*\*/g, '').trim()).filter(Boolean).join(', ') : ld?.address?.streetAddress || '';
    const postcode = cm ? cm[2] : ld?.address?.postalCode;
    if (!normPC(postcode)) { drop('Gymboree Play & Music', 'no postcode ' + url); continue; }
    const trial = (t.match(/Trial Class \| £\s*(\d+)/i) || [])[1];
    const memb = [...t.matchAll(/Membership \| £\s*(\d+)\s*per month/gi)].map((m) => +m[1]);
    const price = [trial && `Trial class £${trial}`, memb.length && `membership from £${Math.min(...memb)}/month`].filter(Boolean).join('; ');
    rows.push(base({
      name: 'Gymboree Play & Music', provider: 'Gymboree Play & Music', category: 'movement', venue: `Gymboree Play & Music ${place}`,
      address, postcode, tier: 'venue', sessions: [], schedule_note: 'Weekly term classes by age stage (Babies, Crawlers, Walkers…); see venue timetable',
      age_min_months: 0, age_max_months: 60, price, booking: 'book', description: 'Play-and-learn classes for babies and pre-schoolers, grouped by developmental stage.',
      url, phone: cm?.[3] || ld?.telephone, source: 'gymbo.co.uk', confidence: 'high', lat: ld?.geo?.latitude, lng: ld?.geo?.longitude,
    }));
  }
  return rows;
}

// ---------------------------------------------------------------- The Little Gym (thelittlegym.co.uk/find-a-gym)
async function littleGym() {
  const h = await page('https://thelittlegym.co.uk/find-a-gym');
  const flat = h.replace(/\\"/g, '"').replace(/\\\\r\\\\n|\\r\\n|\\\\n/g, ', ');
  const m = flat.match(/"locations":(\[\{[\s\S]*?\}\])/);
  if (!m) { report.notes.push('Little Gym: location data not found'); return []; }
  let locs; try { locs = JSON.parse(m[1].replace(/\\r|\\n/g, ' ')); } catch (e) { report.notes.push('Little Gym parse error ' + e); return []; }
  return locs.filter((l) => l.countryShort === 'GB').map((l) => {
    const addr = l.address.replace(/^The Little Gym [^,]*,?\s*/i, '').replace(/,?\s*United Kingdom\s*$/i, '');
    return base({
      name: 'The Little Gym', provider: 'The Little Gym', category: 'movement', venue: `The Little Gym ${l.name}`, address: addr.replace(PC_G, '').replace(/,\s*$/, ''), postcode: addr,
      tier: 'venue', sessions: [], schedule_note: 'Weekly term classes; parent & child classes for 4 months–3 years', age_min_months: 4, age_max_months: 144,
      booking: 'book', description: 'Gymnastics-based development classes, with parent-and-child sessions for babies from four months.',
      url: l.href, phone: l.phone, source: 'thelittlegym.co.uk', confidence: 'high', lat: l.latitude, lng: l.longitude,
    });
  });
}

// ---------------------------------------------------------------- Tumble Tots (official map data endpoint)
async function tumbleTots() {
  const r = await get('https://www.tumbletots.com/wp-admin/admin-ajax.php?action=wd_tt_all_locations_data&limit=500');
  let rows = []; try { rows = JSON.parse(r.text).data.rows; } catch { report.notes.push('Tumble Tots: map data unavailable'); return []; }
  const out = [];
  for (const x of rows) {
    const lines = x.address.split(/\n/).map((s) => s.trim().replace(/,$/, '')).filter(Boolean);
    const pc = normPC(x.address); if (!pc) { drop('Tumble Tots', `no postcode: ${x.franchise_title} ${lines[0] || ''}`); continue; }
    const hall = lines[0] || '';
    const sessions = (x.class_days || []).map((d) => DAY[d.toLowerCase()]).filter(Boolean).map((day) => ({ day, start: null, end: null }));
    out.push(base({
      name: 'Tumble Tots', provider: 'Tumble Tots', category: 'movement', venue: `Tumble Tots ${x.franchise_title} – ${hall}`,
      address: lines.filter((l) => !PC_RE.test(l)).join(', '), postcode: pc, tier: 'timetable', sessions,
      schedule_note: sessions.length ? `Classes on ${sessions.map((s) => s.day).join(', ')}; times on centre page` : 'See centre page for class days',
      age_min_months: 6, age_max_months: 84, booking: 'book', description: 'Active physical play classes on climbing and balancing equipment, starting from six months.',
      url: x.franchise_url, phone: x.tel, source: 'tumbletots.com', confidence: 'medium', lat: +x.lat, lng: +x.lng,
    }));
  }
  return out;
}

// ---------------------------------------------------------------- Little Street role-play towns
async function littleStreet() {
  const idx = await page('https://www.little-street.co.uk/find-us/');
  const urls = [...new Set([...idx.matchAll(/href="(https:\/\/www\.little-street\.co\.uk\/find-us\/[a-z0-9-]+\/)"/g)].map((m) => m[1]))];
  const rows = [];
  for (const url of urls) {
    const t = txt(await page(url));
    const am = t.match(/(?:Address: \| )?([^|]{5,160}?)\.?\s*\|?\s*([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\s*\|/);
    const addrIdx = t.search(/Address:/); let address = '', pc = '';
    const seg = addrIdx > 0 ? t.slice(addrIdx + 8, addrIdx + 260) : '';
    const pm = seg.match(PC_RE); if (pm) { pc = pm[0]; address = seg.slice(0, seg.indexOf(pm[0])).split('|').map((s) => s.trim()).filter(Boolean).join(', ').replace(/\.\s*$/, ''); }
    if (!normPC(pc)) { // no "Address:" label: take the cells just before the first postcode, after the offers link
      const all = t.match(PC_G); pc = all ? all[0] : '';
      if (pc) {
        const cells = t.slice(0, t.indexOf(pc)).split('|').map((s) => s.trim()).filter(Boolean);
        const k = cells.map((c) => /click here|offers|free of charge/i.test(c)).lastIndexOf(true);
        address = cells.slice(k + 1).slice(-5).join(', ').replace(/\.\s*$/, '');
      }
    }
    if (!normPC(pc)) { drop('Little Street', 'no postcode ' + url); continue; }
    { const parts = address.split(/,\s*/); const k = parts.map((p) => /click here|offers|please|free of charge|booked space/i.test(p)).lastIndexOf(true); address = parts.slice(k + 1).join(', '); }
    const slug = url.split('/').slice(-2)[0];
    const place = slug === 'horsham-rudgwick' ? 'Horsham (Rudgwick)' : slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    const child = (t.match(/Child(?:ren)?(?:’s|'s)? ticket:?\s*£\s*([\d.]+)/i) || [])[1];
    const adult = (t.match(/Adult ticket:?\s*£\s*([\d.]+)/i) || [])[1];
    const times = [...t.matchAll(/(\d\d:\d\d) ?(?:am|pm) – \d\d:\d\d ?(?:am|pm)/g)].map((m) => m[1]);
    rows.push(base({
      name: 'Little Street', provider: 'Little Street', category: 'softplay', venue: `Little Street ${place}`, address, postcode: pc,
      schedule_note: `Four 85-minute play sessions daily${times.length ? ' (' + times.join(', ') + ')' : ''}; book online; non-walkers free`,
      age_min_months: 0, age_max_months: 96, price: [child && `Child £${child}`, adult && `adult £${adult}`, 'babies in arms free'].filter(Boolean).join('; '),
      booking: 'book', description: 'Indoor role-play town for under-eights with a mini supermarket, vets, café and ride-on road.',
      url, source: 'little-street.co.uk', confidence: 'high',
    }));
  }
  return rows;
}

// ---------------------------------------------------------------- Rugrats & Halfpints
async function rugrats() {
  const rows = [];
  for (const slug of ['banbury', 'cirencester']) {
    const url = `https://www.rugratsandhalfpints.com/${slug}`;
    const t = txt(await page(url));
    const Town = slug[0].toUpperCase() + slug.slice(1);
    const blk = t.match(new RegExp(`${Town} \\| [^A-Za-z]*Mon-Thur: ([^|]+) \\| Fri: ([^|]+) \\| Sat-Sun: ([^|]+) \\| Holiday[^|]*\\| ([^|]+?)\\s*\\|(?:\\s*\\|)* [^|]*@rugratsandhalfpints\\.com \\| ([^|]+)`));
    if (!blk || !normPC(blk[4])) { drop('Rugrats & Halfpints', 'no address ' + url); continue; }
    const infant = (t.match(/6-11 months £\s*([\d.]+)/i) || [])[1];
    const tod = (t.match(/2-4 Years £\s*([\d.]+)/i) || [])[1];
    const addr = blk[4].trim().replace(/\.\s*[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, '');
    rows.push(base({
      name: 'Rugrats & Halfpints', provider: 'Rugrats & Halfpints', category: 'softplay', venue: `Rugrats & Halfpints ${Town}`, address: addr, postcode: blk[4],
      schedule_note: [['Mon–Thu', blk[1]], ['Fri', blk[2]], ['Sat–Sun', blk[3]]].map(([d, s]) => { const [a, b] = s.split(/\s+[-–]\s+/); return `${d} ${hhmm(a.replace(/\./, ':')) || a.trim()}–${hhmm((b || '').replace(/\./, ':')) || (b || '').trim()}`; }).join(', ') + '; baby sensory area',
      age_min_months: 0, age_max_months: 168, price: [infant && `6–11 months from £${infant}`, tod && `2–4 years from £${tod}`, 'under-6 months free with paying sibling'].filter(Boolean).join('; '),
      booking: 'drop-in', description: 'Indoor soft play with a toddler zone and a dedicated sensory area for babies.', url, phone: blk[5], source: 'rugratsandhalfpints.com', confidence: 'high',
    }));
  }
  return rows;
}

// ---------------------------------------------------------------- Kidspace (Croydon, Romford)
async function kidspace() {
  const rows = [];
  for (const k of ['croydon', 'romford']) {
    const baseUrl = `https://kidspaceadventures.com/${k}/`;
    const pages = [await page(baseUrl + 'plan-your-visit/location/'), await page(baseUrl), await page(baseUrl + 'plan-your-visit/opening-times/')].map(txt);
    let address = '', pc = '';
    for (const t of pages) {
      const i = t.search(/Our Address \| Our Address \|/);
      if (i >= 0) { const seg = t.slice(i + 26, i + 220); const m = seg.match(PC_RE); if (m) { pc = m[0]; address = seg.slice(0, seg.indexOf(m[0])).split('|').map((s) => s.trim()).filter((s) => s && !/^Kidspace/i.test(s)).join(', '); break; } }
      const m = t.match(PC_RE); if (m && !pc) { pc = m[0]; const s = t.slice(Math.max(0, t.indexOf(m[0]) - 120), t.indexOf(m[0])); address = s.split('|').map((x) => x.trim()).filter(Boolean).slice(-3).join(', '); }
    }
    if (!normPC(pc)) { drop('Kidspace', `no postcode on official pages (${k})`); continue; }
    const pt = txt(await page(baseUrl + 'ticket-prices/'));
    const u3 = (pt.match(/Children under 3 \| from £\s*([\d.]+)/i) || [])[1];
    rows.push(base({
      name: 'Kidspace', provider: 'Kidspace', category: 'softplay', venue: `Kidspace ${k[0].toUpperCase() + k.slice(1)}`, address, postcode: pc,
      schedule_note: 'Opening hours vary by date (see calendar); toddler village for under-4s', age_min_months: 6, age_max_months: 144,
      price: ['under-1s free', u3 && `under-3s from £${u3}`].filter(Boolean).join('; '), booking: 'book',
      description: 'Large indoor adventure play centre with a separate toddler village for under-fours.', url: baseUrl, source: 'kidspaceadventures.com', confidence: 'medium',
    }));
  }
  return rows;
}

// ---------------------------------------------------------------- Gambado (Chelsea)
async function gambado() {
  const t = txt(await page('https://www.gambado.com/contact-us'));
  const pm = t.match(/📍 \| ([^|]+)/); if (!pm || !normPC(pm[1])) { drop('Gambado', 'no address'); return []; }
  const hours = [...t.matchAll(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \| (\d{1,2}(?:[:.]\d\d)?\s*[ap]m)\s*[–-]\s*(\d{1,2}(?:[:.]\d\d)?\s*[ap]m)/gi)]
    .map((m) => [DAY[m[1].toLowerCase()], `${hhmm(m[2])}–${hhmm(m[3])}`]).filter((p, i, a) => a.findIndex((q) => q[0] === p[0]) === i);
  const pl = txt(await page('https://www.gambado.com/play'));
  // price grid lists 5 labels then 5 prices; only the lowest "From" price is unambiguous
  const grid = pl.match(/Adult Supervisors \| U1 \|[^£]*((?:From £\s*[\d.]+ \| ){3,})/);
  const low = grid ? Math.min(...[...grid[1].matchAll(/£\s*([\d.]+)/g)].map((m) => +m[1])) : null;
  const u1 = null;
  const phone = (t.match(/📞 \| ([0-9 ]{10,14})/) || [])[1];
  return [base({
    name: 'Gambado', provider: 'Gambado', category: 'softplay', venue: 'Gambado Chelsea', address: pm[1].replace(PC_G, '').replace(/,\s*$/, ''), postcode: pm[1],
    schedule_note: groupHours(hours), age_min_months: 0, age_max_months: 204,
    price: low ? `Play session tickets from £${low}` : '', booking: 'book',
    description: 'Indoor soft play and activity centre with ticket prices for under-ones and toddlers.', url: 'https://www.gambado.com/', phone, source: 'gambado.com', confidence: 'medium',
  })];
}

// ---------------------------------------------------------------- Clambers (Edinburgh Leisure, Royal Commonwealth Pool)
async function clambers() {
  const url = 'https://www.edinburghleisure.co.uk/clambers-soft-play/';
  const t = txt(await page(url));
  const am = t.match(/Getting Here \| ([^|]*?EH\d+ ?\d[A-Z]{2})/); if (!am) { drop('Clambers', 'no address'); return []; }
  const hours = [...t.matchAll(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \| (\d\d)\.(\d\d) [-–] (\d\d)\.(\d\d)/g)].map((m) => [DAY[m[1].toLowerCase()], `${m[2]}:${m[3]}–${m[4]}:${m[5]}`])
    .filter((p, i, a) => a.findIndex((q) => q[0] === p[0]) === i);
  return [base({
    name: 'Clambers', provider: 'Edinburgh Leisure', category: 'softplay', venue: 'Clambers at Royal Commonwealth Pool', address: am[1].replace(PC_G, '').replace(/,\s*$/, '').replace(/,(?=\S)/g, ', '), postcode: am[1],
    schedule_note: `${groupHours(hours)}; baby area for up to 18 months`, age_min_months: 0, age_max_months: 120, price: '', booking: 'drop-in',
    description: 'Soft play for children up to ten with a separate cosy area for non-walking babies.', url, source: 'edinburghleisure.co.uk', confidence: 'high',
  })];
}

// ---------------------------------------------------------------- Social Farms & Gardens members (farm-named, open to public, livestock)
async function farms() {
  const members = new Map();
  for (let p = 0; p <= 8; p++) {
    const h = await page('https://www.farmgarden.org.uk/about-us/our-members?page=' + p);
    for (const m of h.matchAll(/href="(\/org\/public-profile\/\d+)"[^>]*>([^<]+)</g)) members.set(m[1], ent(m[2]).trim());
  }
  report.notes.push(`Social Farms & Gardens: ${members.size} members listed; ${[...members.values()].filter((n) => /farm/i.test(n)).length} with "farm" in the name checked`);
  const rows = [];
  for (const [p, name] of members) {
    if (!/farm/i.test(name)) continue;
    const url = 'https://www.farmgarden.org.uk' + p;
    const t = txt(await page(url)); if (!t) continue;
    const field = (label) => { const re = new RegExp(`${label}:? \\| ([^|]*)`, 'g'); return [...t.matchAll(re)].map((m) => m[1].trim()).filter((v) => v && !/[?:]$/.test(v) && !/^(Footer menu|Directions|Email|Website)$/i.test(v)); };
    const open = field('Open to the public\\?'); const livestock = field('Has livestock\\?')[0] || '';
    if (!open.some((v) => /^yes/i.test(v))) { drop('Social Farms & Gardens', `not open to public: ${name}`); continue; }
    if (!/^yes/i.test(livestock)) { drop('Social Farms & Gardens', `no livestock listed: ${name}`); continue; }
    const ai = t.search(/\| Address: \|/); let address = '', pc = '';
    if (ai >= 0) {
      let seg = t.slice(ai + 12, ai + 400);
      const stop = seg.search(/\| (Email|Website|Facilities:|Open to the public)/); if (stop > 0) seg = seg.slice(0, stop);
      const m = seg.match(PC_RE);
      if (m) { pc = m[0]; address = seg.slice(0, seg.indexOf(m[0])).split('|').map((s) => s.trim()).filter(Boolean).filter((s, i, a) => a.indexOf(s) === i).join(', '); }
    }
    if (!normPC(pc)) { drop('Social Farms & Gardens', `no postcode: ${name}`); continue; }
    const hours = clean(field('Opening hours')[0] || '');
    const stock = clean(field('Details of livestock and rare breeds kept')[0] || '');
    const facilities = field('Facilities')[0] || '';
    const phone = (t.match(/Phone: \| ([0-9 +]{9,16})/) || [])[1];
    const web = (txt('') , null);
    const isCity = /city farm|community farm|urban farm/i.test(name);
    rows.push(base({
      name, provider: 'Social Farms & Gardens member', category: 'farm', venue: name, address, postcode: pc, tier: 'place',
      schedule_note: [hours ? (hours.length > 140 ? (hours.slice(0, 140).match(/^.*[.;]/) || [hours.slice(0, 137) + '…'])[0].replace(/[.;]$/, '') : hours) : 'Opening hours not listed', /play area/i.test(facilities) ? 'play area' : ''].filter(Boolean).join('; '),
      age_min_months: 0, age_max_months: 216, price: '', free: false, booking: 'drop-in', indoor: false,
      description: `${isCity ? 'Community-run city farm' : 'Community farm'} open to visitors${stock ? ', with animals such as ' + stock.split(/,|;| and /).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 3).join(', ') : ''}.`,
      url, phone, source: 'farmgarden.org.uk', confidence: 'medium',
    }));
  }
  return rows;
}

// ---------------------------------------------------------------- geocode (postcodes.io bulk)
async function geocode(rows) {
  const pcs = [...new Set(rows.map((r) => r.postcode).filter(Boolean))];
  const found = new Map();
  const cacheFile = CACHE + 'postcodes-io.json';
  const cached = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const todo = pcs.filter((p) => !(p in cached));
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    const r = await fetch('https://api.postcodes.io/postcodes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ postcodes: batch }) });
    const j = await r.json();
    for (const x of j.result || []) cached[x.query] = x.result ? { lat: x.result.latitude, lng: x.result.longitude, country: x.result.country, region: x.result.region || x.result.country } : null;
    await new Promise((res) => setTimeout(res, 1100));
  }
  fs.writeFileSync(cacheFile, JSON.stringify(cached));
  for (const p of pcs) if (cached[p]) found.set(p, cached[p]);
  // terminated postcodes: fall back to provider-published coordinates when present
  return rows.flatMap((r) => {
    const g = found.get(r.postcode);
    const { _lat, _lng, ...row } = r;
    if (g && g.lat != null) { row.lat = g.lat; row.lng = g.lng; row._country = g.country; row._region = g.region; return [row]; }
    drop(r.provider, `postcode not valid on postcodes.io: ${r.venue} ${r.postcode}`);
    return [];
  });
}

// ---------------------------------------------------------------- main
const sources = { wacky, gymboree, littleGym, tumbleTots, littleStreet, rugrats, kidspace, gambado, clambers, farms };
let all = [];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null; // e.g. ONLY=wacky,gymboree for a partial test run
for (const [k, fn] of Object.entries(sources)) {
  if (only && !only.includes(k)) continue;
  try { const rows = await fn(); log(k, rows.length); all.push(...rows); } catch (e) { log('ERROR', k, e.stack); report.notes.push(`${k} failed: ${e.message}`); }
}
all = await geocode(all);
// de-dupe exact provider+postcode+venue
const seen = new Set(); all = all.filter((r) => { const k = `${r.provider}|${r.venue}|${r.postcode}`; if (seen.has(k)) return false; seen.add(k); return true; });
const countries = {}; const regions = {};
for (const r of all) { report.counts[r.provider] = (report.counts[r.provider] || 0) + 1; countries[r._country] = (countries[r._country] || 0) + 1; regions[r._region] = (regions[r._region] || 0) + 1; delete r._country; delete r._region; }
fs.writeFileSync(OUT, JSON.stringify(all, null, 2) + '\n');
fs.writeFileSync(CACHE + '../play-report.json', JSON.stringify({ total: all.length, ...report, countries, regions, droppedCounts: Object.fromEntries(Object.entries(report.dropped).map(([k, v]) => [k, v.length])) }, null, 2));
log('wrote', all.length, OUT); log(JSON.stringify({ counts: report.counts, countries, regions }, null, 1));
