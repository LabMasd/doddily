/* Little Days — baby activities near you */
(() => {
  'use strict';

  const STORE = 'littledays-v1';
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MI = 1609.344;
  const PLACE_MAX_MI = 5; // OSM queries get heavy beyond this in London

  const CATS = {
    library:  { e: '📚', label: 'Rhymes & stories' },
    stayplay: { e: '🧸', label: 'Stay & play' },
    support:  { e: '💬', label: 'Baby group' },
    music:    { e: '🎵', label: 'Music' },
    sensory:  { e: '✨', label: 'Sensory' },
    movement: { e: '🤸', label: 'Movement' },
    massage:  { e: '🤲', label: 'Massage & yoga' },
    fitness:  { e: '🏃', label: 'Fitness with baby' },
    swim:     { e: '🏊', label: 'Swim' },
    cinema:   { e: '🎬', label: 'Cinema' },
    museum:   { e: '🏛️', label: 'Museum' },
    farm:     { e: '🐐', label: 'Farm' },
    softplay: { e: '🧩', label: 'Soft play' },
    cafe:     { e: '☕', label: 'Café' },
    outdoor:  { e: '🌳', label: 'Outdoors' },
    playground: { e: '🛝', label: 'Playground' },
    park:     { e: '🌳', label: 'Park' },
    libplace: { e: '📚', label: 'Library' },
    change:   { e: '🚼', label: 'Baby change' },
    pool:     { e: '🏊', label: 'Swimming pool' },
    softplace: { e: '🧩', label: 'Soft play' },
    farmplace: { e: '🐐', label: 'Farm' },
    museumplace: { e: '🏛️', label: 'Museum' },
  };

  const GROUPS = [
    { id: 'all', label: 'Everything' },
    { id: 'rhymes', label: 'Rhymes & stay-and-play', cats: ['library', 'stayplay', 'support'] },
    { id: 'classes', label: 'Classes', cats: ['music', 'sensory', 'movement', 'massage', 'fitness'] },
    { id: 'swim', label: 'Swim', cats: ['swim', 'pool'] },
    { id: 'cinema', label: 'Cinema', cats: ['cinema'] },
    { id: 'out', label: 'Days out', cats: ['museum', 'farm', 'softplay', 'cafe', 'outdoor', 'softplace', 'farmplace', 'museumplace'] },
    { id: 'parks', label: 'Parks & playgrounds', cats: ['playground', 'park'] },
    { id: 'change', label: 'Baby change', cats: ['change', 'libplace'] },
  ];

  // ---------- state ----------
  const saved = load();
  const state = {
    loc: saved.loc || null,
    radius: saved.radius || 3,
    born: saved.born || '',
    group: 'all', // always open on Everything; a remembered filter makes the list look empty days later
    free: false, drop: false, indoor: false, ageFit: true,
    saved: new Set(saved.saved || []),
    showSaved: false,
    day: 0, // offset from today, or 'any'
    open: null,
    data: { checked: '', items: [] },
    places: [],
    placesStatus: 'idle',
  };

  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
  function persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        loc: state.loc, radius: state.radius, born: state.born, group: state.group, saved: [...state.saved],
      }));
    } catch { /* private mode: keep working without storage */ }
  }

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

  function miles(a, b) {
    const R = 3958.8, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function distLabel(mi) {
    const walk = Math.round(mi * 1.25 * 20); // buggy pace, streets aren't straight
    if (walk <= 35) return `${Math.max(2, walk)} min walk`;
    return `${mi.toFixed(1)} mi`;
  }
  function babyMonths() {
    if (!state.born) return null;
    const [y, m] = state.born.split('-').map(Number);
    const now = new Date();
    return Math.max(0, (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m));
  }
  function ageText(it) {
    const a = it.age_min_months ?? 0, b = it.age_max_months;
    if (b == null || b >= 60) return a ? `${a}m+` : 'All ages';
    if (b <= 24) return `${a}–${b} months`;
    return `${a}m – ${Math.round(b / 12)} yrs`;
  }
  function dateFor(offset) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function directionsUrl(it) {
    return isIOS
      ? `https://maps.apple.com/?daddr=${it.lat},${it.lng}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${it.lat},${it.lng}&travelmode=walking`;
  }

  // ---------- data ----------
  // UK data is split into 0.5° map tiles; load only the ones around the chosen location.
  const tileCache = new Map();
  let tileIndex = null;
  async function loadData() {
    try {
      if (!tileIndex) tileIndex = await (await fetch('data/tiles/index.json', { cache: 'no-cache' })).json();
      if (!state.loc) { state.data = { checked: tileIndex.checked, items: [] }; return; }
      const T = tileIndex.tile, { lat, lng } = state.loc, r = state.radius;
      const dLat = r / 69, dLng = r / (69 * Math.cos(lat * Math.PI / 180));
      const keys = [];
      for (let y = Math.floor((lat - dLat) / T); y <= Math.floor((lat + dLat) / T); y++)
        for (let x = Math.floor((lng - dLng) / T); x <= Math.floor((lng + dLng) / T); x++)
          if (tileIndex.tiles[`${y}_${x}`]) keys.push(`${y}_${x}`);
      await Promise.all(keys.filter((k) => !tileCache.has(k)).map(async (k) => {
        tileCache.set(k, await (await fetch(`data/tiles/${k}.json`)).json());
      }));
      state.data = { checked: tileIndex.checked, items: keys.flatMap((k) => tileCache.get(k) || []) };
    } catch { state.data = { checked: '', items: [] }; }
  }

  async function loadPlaces() {
    if (!state.loc) return;
    const r = Math.min(state.radius, PLACE_MAX_MI);
    // Prefer the monthly prebuilt places (OpenStreetMap extract); fall back to Overpass below.
    try {
      const idx = await (await fetch('data/places/index.json', { cache: 'no-cache' })).json();
      const T = idx.tile, { lat, lng } = state.loc;
      const dLat = r / 69, dLng = r / (69 * Math.cos(lat * Math.PI / 180));
      const keys = [];
      for (let y = Math.floor((lat - dLat) / T); y <= Math.floor((lat + dLat) / T); y++)
        for (let x = Math.floor((lng - dLng) / T); x <= Math.floor((lng + dLng) / T); x++)
          if (idx.tiles[`${y}_${x}`]) keys.push(`${y}_${x}`);
      const tiles = await Promise.all(keys.map(async (k) => (await fetch(`data/places/${k}.json`)).json()));
      const byName = new Map();
      for (const p of tiles.flat()) {
        if (miles(state.loc, p) > r) continue;
        const k = `${p.category}|${p.name}`, prev = byName.get(k);
        if (!prev || miles(state.loc, p) < miles(state.loc, prev)) byName.set(k, p);
      }
      state.places = [...byName.values()];
      dedupePlaces();
      state.placesStatus = 'ok'; render();
      return;
    } catch { /* not built yet */ }
    const key = `ld-places:${state.loc.lat.toFixed(3)},${state.loc.lng.toFixed(3)},${r}`;
    try {
      const c = JSON.parse(localStorage.getItem(key));
      if (c && Date.now() - c.t < 7 * 864e5) { state.places = c.items; dedupePlaces(); state.placesStatus = 'ok'; render(); return; }
    } catch { /* no cache */ }

    state.placesStatus = 'loading'; render();
    const m = Math.round(r * MI), { lat, lng } = state.loc;
    const around = `(around:${m},${lat},${lng})`;
    const q = `[out:json][timeout:30];(
      nwr${around}[leisure=playground];
      nwr${around}[leisure=park][name];
      nwr${around}[amenity=library];
      nwr${around}[amenity=toilets][changing_table=yes];
    );out center tags;`;
    const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!res.ok) continue;
        const json = await res.json();
        state.places = shapePlaces(json.elements || []);
        state.placesStatus = 'ok';
        try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), items: state.places })); } catch { /* full */ }
        dedupePlaces();
        render();
        return;
      } catch { /* try next */ }
    }
    state.placesStatus = 'error'; render();
  }

  function shapePlaces(els) {
    const pts = els.map((e) => ({ t: e.tags || {}, lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, id: `${e.type}/${e.id}` }))
      .filter((p) => p.lat != null);
    const parks = pts.filter((p) => p.t.leisure === 'park');
    const out = [];
    const nearestPark = (p) => {
      let best = null, bd = 0.2; // within ~320 m of a park centre
      for (const k of parks) { const d = miles(p, k); if (d < bd) { bd = d; best = k; } }
      return best;
    };
    const parksWithPlay = new Set();
    for (const p of pts) {
      const t = p.t;
      const street = t['addr:street'] || '';
      const base = { id: 'osm:' + p.id, lat: p.lat, lng: p.lng, sessions: [], osm: true, url: t.website || t['contact:website'] || '', phone: t.phone || t['contact:phone'] || '', schedule_note: t.opening_hours ? `Opening hours: ${t.opening_hours}` : '', free: true, price: 'Free', booking: 'drop-in' };
      if (t.leisure === 'playground') {
        const park = t.name ? null : nearestPark(p);
        if (park) parksWithPlay.add(park.id);
        out.push({ ...base, category: 'playground', name: t.name || (park ? `Playground in ${park.t.name}` : 'Playground'), venue: park?.t.name || street, indoor: t.indoor === 'yes', description: [t.surface && `Surface: ${t.surface}`, t['playground:theme']].filter(Boolean).join('. '), unnamed: !t.name && !park });
      } else if (t.amenity === 'library') {
        out.push({ ...base, category: 'libplace', name: t.name || 'Library', venue: street, indoor: true, description: t.changing_table === 'yes' ? 'Has baby changing.' : 'Warm, quiet and free. Most have a children’s corner.' });
      } else if (t.amenity === 'toilets') {
        out.push({ ...base, category: 'change', name: t.name || 'Toilets with baby change', venue: street || (nearestPark(p)?.t.name ?? ''), indoor: true, description: [t.fee === 'yes' ? 'Small fee' : 'Free', t.wheelchair === 'yes' ? 'step-free' : ''].filter(Boolean).join(', ') + '.' });
      }
    }
    for (const k of parks) {
      const big = /park|fields|marsh|common|wetland|heath|wood/i.test(k.t.name);
      if (!big && !parksWithPlay.has(k.id)) continue;
      out.push({ id: 'osm:' + k.id, category: 'park', name: k.t.name, venue: parksWithPlay.has(k.id) ? 'Has a playground' : '', lat: k.lat, lng: k.lng, sessions: [], osm: true, free: true, price: 'Free', booking: 'drop-in', indoor: false, description: k.t.opening_hours ? `Opening hours: ${k.t.opening_hours}` : '', url: k.t.website || '' });
    }
    // A big park often has several mapped playgrounds; one card per name is enough.
    const byName = new Map();
    for (const p of out) {
      const k = `${p.category}|${p.name}`;
      if (!byName.has(k) || miles(state.loc, p) < miles(state.loc, byName.get(k))) byName.set(k, p);
    }
    return [...byName.values()];
  }

  // ---------- filtering ----------
  function visibleItems() {
    const all = [...state.data.items, ...state.places];
    const g = GROUPS.find((x) => x.id === state.group);
    const age = babyMonths();
    const res = [];
    for (const it of all) {
      if (!state.loc) break;
      const d = miles(state.loc, it);
      if (d > state.radius) continue;
      if (state.showSaved) { if (!state.saved.has(it.id)) continue; }
      else {
        if (g.cats && !g.cats.includes(it.category)) continue;
        if (g.id === 'all' && (['change', 'libplace', 'playground', 'pool'].includes(it.category) || (it.category === 'park' && !it.venue))) continue;
        if (g.id === 'parks' && it.unnamed && d > 0.6) continue;
      }
      if (state.free && !it.free) continue;
      if (state.drop && it.booking !== 'drop-in') continue;
      if (state.indoor && !it.indoor) continue;
      if (state.ageFit && age != null && !it.osm) {
        if ((it.age_min_months ?? 0) > age + 1) continue;
        if (it.age_max_months != null && it.age_max_months < age) continue;
      }
      res.push({ it, d });
    }
    return res;
  }

  // ---------- render ----------
  function renderHeader() {
    $('#whereName').textContent = state.loc ? state.loc.name : 'Set your location';
    $('#whereRadius').textContent = state.loc ? `within ${state.radius} mi` : '';
    $('#savedCount').textContent = state.saved.size || '';
    $('#savedBtn').setAttribute('aria-pressed', state.showSaved);

    const week = $('#week');
    let h = '';
    for (let i = 0; i < 7; i++) {
      const d = dateFor(i);
      const label = i === 0 ? 'Today' : DAYS[d.getDay()];
      h += `<button class="day" data-day="${i}" aria-pressed="${state.day === i}" aria-label="${DAY_LONG[d.getDay()]} ${d.getDate()}"><small>${label}</small><strong>${d.getDate()}</strong></button>`;
    }
    h += `<button class="day any" data-day="any" aria-pressed="${state.day === 'any'}"><small>Week</small><strong>All</strong></button>`;
    week.innerHTML = h;

    const age = babyMonths();
    let f = GROUPS.map((g) => `<button class="chip" data-group="${g.id}" aria-pressed="${!state.showSaved && state.group === g.id}">${esc(g.label)}</button>`).join('');
    f += '<span class="sep" aria-hidden="true"></span>';
    f += `<button class="chip toggle" data-toggle="free" aria-pressed="${state.free}">Free</button>`;
    f += `<button class="chip toggle" data-toggle="drop" aria-pressed="${state.drop}">No booking</button>`;
    f += `<button class="chip toggle rain" data-toggle="indoor" aria-pressed="${state.indoor}">Rainy day</button>`;
    if (age != null) f += `<button class="chip toggle" data-toggle="ageFit" aria-pressed="${state.ageFit}">Right for ${age} months</button>`;
    $('#filters').innerHTML = f;
  }

  function cardHTML({ it, d }, when, extraClass = '') {
    const cat = CATS[it.category] || { e: '📍', label: '' };
    const open = state.open === it.id;
    const tags = [];
    if (it.free) tags.push('<span class="tag free">Free</span>');
    else if (it.price) tags.push(`<span class="tag">${esc(it.price)}</span>`);
    if (it.booking === 'drop-in' && !it.osm) tags.push('<span class="tag drop">Drop in</span>');
    else if (it.booking === 'book') tags.push('<span class="tag">Book ahead</span>');
    else if (it.booking === 'term') tags.push('<span class="tag">Term booking</span>');
    if (!it.osm) tags.push(`<span class="tag">${esc(ageText(it))}</span>`);
    if (it.tier === 'venue') tags.push('<span class="tag">Times on their site</span>');
    else if (it.confidence === 'low') tags.push('<span class="tag warn">Check times</span>');

    const sessions = (it.sessions || []).map((s) => `${s.day}${s.start ? ' ' + s.start : ''}${s.end ? '–' + s.end : ''}`).join(', ');
    const addr = [it.address, it.postcode].filter(Boolean).join(', ');
    const isSaved = state.saved.has(it.id);
    const canCal = typeof state.day === 'number' && when && when.start;

    return `<article class="item ${open ? 'open' : ''} ${extraClass}" id="i-${cssId(it.id)}" data-id="${esc(it.id)}">
      <div class="when ${when?.start ? '' : 'emoji'}" aria-hidden="${when?.start ? 'false' : 'true'}">${when?.start ? `${esc(when.start)}<small>${when.end ? 'to ' + esc(when.end) : cat.label}</small>` : cat.e}</div>
      <div class="body">
        <button class="more" data-open="${esc(it.id)}" aria-expanded="${open}">
          <div class="head"><h3>${esc(it.name)}</h3><span class="dist">${distLabel(d)}</span></div>
          <div class="venue">${esc(venueLine(it) || cat.label)}</div>
          <div class="tags">${tags.join('')}</div>
        </button>
        <div class="detail">
          ${it.description ? `<p>${esc(it.description)}</p>` : ''}
          <div class="meta">
            ${addr ? `${esc(addr)}<br>` : ''}
            ${sessions ? `When: ${esc(sessions)}<br>` : ''}
            ${it.schedule_note ? `${esc(it.schedule_note)}<br>` : ''}
            ${!it.osm && it.price ? `Price: ${esc(it.price)}` : ''}
          </div>
          <div class="actions">
            <a class="act primary" href="${directionsUrl(it)}" target="_blank" rel="noopener">Directions</a>
            ${it.url ? `<a class="act" href="${esc(it.url)}" target="_blank" rel="noopener">${it.booking === 'drop-in' ? 'Website' : 'Book or check'}</a>` : ''}
            ${it.phone ? `<a class="act" href="tel:${esc(it.phone.replace(/\s/g, ''))}">Call</a>` : ''}
            <button class="act ${isSaved ? 'saved' : ''}" data-save="${esc(it.id)}">${isSaved ? '♥ Saved' : '♡ Save'}</button>
            ${canCal ? `<button class="act" data-cal="${esc(it.id)}" data-start="${esc(when.start)}" data-end="${esc(when.end || '')}">Add to calendar</button>` : ''}
            ${navigator.share ? `<button class="act" data-share="${esc(it.id)}">Send</button>` : ''}
          </div>
        </div>
      </div>
    </article>`;
  }
  const cssId = (id) => id.replace(/[^a-z0-9]/gi, '_');
  const norm = (s) => String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
  function venueLine(it) {
    const v = norm(it.venue), p = norm(it.provider), n = norm(it.name);
    const showProvider = p && !v.includes(p) && !p.includes(v) && !n.includes(p);
    return [it.venue, showProvider ? it.provider : ''].filter(Boolean).join(', ');
  }
  // Drop OSM places that the curated list already covers (e.g. Clissold Park twice).
  function dedupePlaces() {
    const curated = state.data.items;
    state.places = state.places.filter((p) => !['park', 'libplace'].includes(p.category) || !curated.some((c) => {
      const cn = norm(c.name), cv = norm(c.venue), pn = norm(p.name);
      return pn && miles(c, p) < 0.3 && (cn.includes(pn) || cv.includes(pn) || (cn && pn.includes(cn)));
    }));
  }

  function render() {
    renderHeader();
    const list = $('#list');
    if (!state.loc) {
      list.innerHTML = `<div class="empty"><h3>Where are you starting from?</h3><p>Add a postcode to see baby activities nearby.</p><button class="btn" data-action="where">Add postcode</button></div>`;
      renderMap([]);
      return;
    }

    const rows = visibleItems();
    let html = '';
    const mapRows = [];

    if (state.day === 'any' || state.showSaved) {
      const byGroup = new Map();
      for (const r of rows) {
        const g = GROUPS.find((x) => x.cats && x.cats.includes(r.it.category));
        const k = g ? g.label : 'Other';
        if (!byGroup.has(k)) byGroup.set(k, []);
        byGroup.get(k).push(r);
      }
      html += `<p class="summary">${rows.length} ${state.showSaved ? 'saved' : 'things'} within ${state.radius} miles${state.showSaved ? '' : ', any day'}</p>`;
      for (const g of GROUPS) {
        const arr = byGroup.get(g.label);
        if (!arr) continue;
        arr.sort((a, b) => a.d - b.d);
        html += `<h2 class="group-title">${esc(g.label)}<small>${arr.length}</small></h2>`;
        for (const r of arr.slice(0, 80)) {
          const days = [...new Set((r.it.sessions || []).map((s) => s.day))];
          html += cardHTML(r, days.length ? { start: null } : null).replace('class="when emoji"', `class="when emoji"`);
          mapRows.push(r);
        }
      }
    } else {
      const date = dateFor(state.day);
      const wd = DAYS[date.getDay()];
      const nowMin = state.day === 0 ? new Date().getHours() * 60 + new Date().getMinutes() : -1;
      const timed = [], anytime = [], past = [], venues = [];
      for (const r of rows) {
        const ss = (r.it.sessions || []).filter((s) => s.day === wd);
        if (ss.length) {
          for (const s of ss) {
            const end = toMin(s.end) ?? (toMin(s.start) ?? 0) + 60;
            const entry = { ...r, s };
            (s.start && end < nowMin ? past : timed).push(entry);
          }
        } else if (!(r.it.sessions || []).length) {
          (r.it.tier === 'venue' ? venues : anytime).push(r);
        }
      }
      const byTime = (a, b) => (toMin(a.s.start) ?? 9999) - (toMin(b.s.start) ?? 9999) || a.d - b.d;
      timed.sort(byTime); past.sort(byTime); anytime.sort((a, b) => a.d - b.d);
      if (state.group === 'all') {
        // Everything view: every curated outing, plus only the nearest few parks.
        const parks = anytime.filter((r) => r.it.osm).slice(0, 8);
        anytime.splice(0, anytime.length, ...anytime.filter((r) => !r.it.osm), ...parks);
        anytime.sort((a, b) => a.d - b.d);
      }

      const dayName = state.day === 0 ? 'today' : state.day === 1 ? 'tomorrow' : `on ${DAY_LONG[date.getDay()]}`;
      html += `<p class="summary">${timed.length} session${timed.length === 1 ? '' : 's'} ${dayName} within ${state.radius} miles</p>`;
      if (timed.length) {
        html += `<h2 class="group-title">Sessions</h2>`;
        for (const r of timed) { html += cardHTML(r, { start: r.s.start || 'Time?', end: r.s.end }); mapRows.push(r); }
      } else if (past.length) {
        html += `<div class="empty"><h3>That's everything for today</h3><p><button class="btn" data-day="1">See tomorrow</button></p></div>`;
      } else if (state.group !== 'parks' && state.group !== 'change') {
        html += `<div class="empty"><h3>Nothing timetabled ${dayName}</h3><p>Try a wider distance, another day, or the places below.</p></div>`;
      }
      if (venues.length) {
        venues.sort((a, b) => a.d - b.d);
        const shown = venues.slice(0, state.group === 'all' ? 12 : 60);
        html += `<h2 class="group-title">Classes nearby, check times<small>${venues.length}</small></h2>`;
        for (const r of shown) { html += cardHTML(r, null); mapRows.push(r); }
        if (venues.length > shown.length) html += `<p class="summary">Showing the closest ${shown.length}. Pick a category to see more.</p>`;
      }
      if (anytime.length) {
        const shown = anytime.slice(0, state.group === 'all' ? 25 : 80);
        html += `<h2 class="group-title">Go any time<small>${anytime.length}</small></h2>`;
        for (const r of shown) { html += cardHTML(r, null); mapRows.push(r); }
        if (anytime.length > shown.length) html += `<p class="summary">Showing the closest ${shown.length}. Pick a category to see more.</p>`;
      }
      if (past.length) {
        html += `<h2 class="group-title">Earlier today<small>${past.length}</small></h2>`;
        for (const r of past) html += cardHTML(r, { start: r.s.start, end: r.s.end }, 'past');
      }
    }

    if (state.placesStatus === 'loading') html += `<p class="summary">Finding parks and playgrounds nearby…</p>`;
    if (state.placesStatus === 'error') html += `<p class="summary">Parks and playgrounds didn't load. <button class="act" data-action="retry">Try again</button></p>`;
    if (state.showSaved && !rows.length) html = `<div class="empty"><h3>Nothing saved yet</h3><p>Tap ♡ Save on anything you like the look of.</p></div>`;

    const checked = state.data.checked ? new Date(state.data.checked).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    html += `<p class="foot">${checked ? `Class times checked ${checked}. ` : ''}Timetables change, so check the provider's page before you head out. Parks and playgrounds from OpenStreetMap.</p>`;
    list.innerHTML = html;
    renderMap(mapRows);
  }

  // ---------- map ----------
  let map, layer, homeLayer;
  function renderMap(rows) {
    if (typeof L === 'undefined') return;
    const visible = getComputedStyle($('.mapwrap')).display !== 'none';
    if (!map) {
      if (!visible) return;
      map = L.map('map', { zoomControl: false, attributionControl: true, fadeAnimation: false }).setView([51.5648, -0.0898], 13);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
      L.control.zoom({ position: 'topright' }).addTo(map);
      layer = L.layerGroup().addTo(map);
      homeLayer = L.layerGroup().addTo(map);
      map._fitKey = '';
    }
    map.invalidateSize();
    layer.clearLayers(); homeLayer.clearLayers();
    if (!state.loc) return;
    const c = [state.loc.lat, state.loc.lng];
    const circle = L.circle(c, { radius: state.radius * MI, color: '#F2A007', weight: 2, fillOpacity: 0.05 }).addTo(homeLayer);
    L.marker(c, { icon: L.divIcon({ className: '', html: '<div class="pin home">🏠</div>', iconSize: [30, 30] }) }).addTo(homeLayer);
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.it.id)) continue; seen.add(r.it.id);
      const cat = CATS[r.it.category] || { e: '📍' };
      const icon = L.divIcon({ className: '', html: `<div class="pin ${r.it.osm ? 'place' : ''}">${cat.e}</div>`, iconSize: r.it.osm ? [24, 24] : [30, 30] });
      const when = r.s ? `${r.s.start || ''}${r.s.end ? '–' + r.s.end : ''}, ` : '';
      L.marker([r.it.lat, r.it.lng], { icon })
        .bindPopup(`<b>${esc(r.it.name)}</b>${esc(when)}${distLabel(r.d)}<br><button class="act" style="margin-top:8px" data-goto="${esc(r.it.id)}">Details</button>`)
        .addTo(layer);
    }
    const key = `${c}|${state.radius}`;
    if (map._fitKey !== key) { map.fitBounds(circle.getBounds(), { padding: [10, 10] }); map._fitKey = key; }
  }

  // ---------- location sheet ----------
  function openSheet() {
    const root = $('#sheetRoot');
    root.innerHTML = `<div class="scrim" data-action="close"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
        <h2 id="sheetTitle">Where and how far</h2>
        <p class="sub">Saved on this phone only.</p>
        <div class="field">
          <label for="pc">Postcode</label>
          <div class="row"><input class="input" id="pc" autocomplete="postal-code" placeholder="E8 3PB" value="${esc(state.loc?.postcode || '')}"><button class="btn ghost" id="geo" type="button">Use where I am</button></div>
          <div class="err" id="pcErr" hidden></div>
        </div>
        <div class="field">
          <label for="rad">Distance</label>
          <div class="range-row"><input type="range" id="rad" min="0.5" max="10" step="0.5" value="${state.radius}"><span class="range-val" id="radVal">${state.radius} mi</span></div>
          <div class="hint" id="radHint"></div>
        </div>
        <div class="field">
          <label for="born">Baby's birth month <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
          <input class="input plain" type="month" id="born" value="${esc(state.born)}">
          <div class="hint">Hides classes she's too young or too old for.</div>
        </div>
        <button class="btn wide" id="sheetSave">Show activities</button>
      </div>`;
    const rad = $('#rad');
    const hint = () => { const v = +rad.value; $('#radVal').textContent = `${v} mi`; $('#radHint').textContent = `About ${Math.round(v * 25)} minutes' walk with a buggy at the edge.`; };
    rad.oninput = hint; hint();
    let pending = null;
    $('#geo').onclick = () => {
      const err = $('#pcErr'); err.hidden = true;
      if (!navigator.geolocation) { err.textContent = 'This browser can’t share location. Type a postcode instead.'; err.hidden = false; return; }
      $('#geo').textContent = 'Finding you…';
      navigator.geolocation.getCurrentPosition(async (p) => {
        const lat = p.coords.latitude, lng = p.coords.longitude;
        let name = 'Current location', postcode = '';
        try {
          const j = await (await fetch(`https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1`)).json();
          if (j.result?.[0]) { postcode = j.result[0].postcode; name = postcode; }
        } catch { /* keep generic name */ }
        pending = { lat, lng, name, postcode };
        $('#pc').value = postcode; $('#geo').textContent = 'Using where you are';
      }, () => { $('#geo').textContent = 'Use where I am'; err.textContent = 'Location is blocked. Type a postcode instead.'; err.hidden = false; }, { enableHighAccuracy: false, timeout: 10000 });
    };
    $('#pc').oninput = () => { pending = null; };
    $('#sheetSave').onclick = async () => {
      const err = $('#pcErr'); err.hidden = true;
      const raw = $('#pc').value.trim();
      let loc = pending;
      if (!loc && raw && raw.replace(/\s/g, '').toUpperCase() !== (state.loc?.postcode || '').replace(/\s/g, '')) {
        loc = await lookupPostcode(raw);
        if (!loc) { err.textContent = 'That postcode wasn’t found. Check it and try again.'; err.hidden = false; return; }
      }
      const moved = loc && (!state.loc || loc.lat !== state.loc.lat || loc.lng !== state.loc.lng);
      if (loc) state.loc = loc;
      if (!state.loc) { err.textContent = 'Add a postcode first.'; err.hidden = false; return; }
      const radChanged = +rad.value !== state.radius;
      state.radius = +rad.value;
      state.born = $('#born').value;
      persist(); closeSheet(); render();
      if (moved || radChanged) { await loadData(); render(); loadPlaces(); }
    };
    setTimeout(() => (state.loc ? $('#rad') : $('#pc')).focus(), 50);
  }
  function closeSheet() { $('#sheetRoot').innerHTML = ''; }

  async function lookupPostcode(raw) {
    const pc = raw.replace(/\s+/g, '').toUpperCase();
    try {
      let j = await (await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`)).json();
      if (j.status === 200) return { lat: j.result.latitude, lng: j.result.longitude, name: j.result.postcode, postcode: j.result.postcode };
      j = await (await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(pc)}`)).json();
      if (j.status === 200) return { lat: j.result.latitude, lng: j.result.longitude, name: j.result.outcode, postcode: j.result.outcode };
    } catch { /* offline */ }
    return null;
  }

  // ---------- calendar & share ----------
  function addToCalendar(it, start, end) {
    const d = dateFor(state.day);
    const stamp = (hm) => { const [h, m] = hm.split(':'); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${h.padStart(2, '0')}${m}00`; };
    const endHM = end || (() => { const t = toMin(start) + 60; return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; })();
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Little Days//EN', 'BEGIN:VEVENT',
      `UID:${Date.now()}@littledays`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;TZID=Europe/London:${stamp(start)}`, `DTEND;TZID=Europe/London:${stamp(endHM)}`,
      `SUMMARY:${it.name}`, `LOCATION:${[it.venue, it.address, it.postcode].filter(Boolean).join(', ')}`,
      `DESCRIPTION:${[it.price, it.url].filter(Boolean).join(' — ')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = `${it.name.replace(/[^a-z0-9]+/gi, '-')}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function findItem(id) { return state.data.items.find((x) => x.id === id) || state.places.find((x) => x.id === id); }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-action]');
    if (!t) return;
    if (t.id === 'whereBtn' || t.dataset.action === 'where') return openSheet();
    if (t.dataset.action === 'close') return closeSheet();
    if (t.dataset.action === 'retry') { Object.keys(localStorage).filter((k) => k.startsWith('ld-places:')).forEach((k) => localStorage.removeItem(k)); return loadPlaces(); }
    if (t.id === 'savedBtn') { state.showSaved = !state.showSaved; return render(); }
    if (t.dataset.day) { state.day = t.dataset.day === 'any' ? 'any' : +t.dataset.day; state.showSaved = false; return render(); }
    if (t.dataset.group) { state.group = t.dataset.group; state.showSaved = false; persist(); render(); return; }
    if (t.dataset.toggle) { state[t.dataset.toggle] = !state[t.dataset.toggle]; return render(); }
    if (t.dataset.open) { state.open = state.open === t.dataset.open ? null : t.dataset.open; return render(); }
    if (t.dataset.save) {
      const id = t.dataset.save;
      state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
      persist(); return render();
    }
    if (t.dataset.cal) return addToCalendar(findItem(t.dataset.cal), t.dataset.start, t.dataset.end);
    if (t.dataset.share) {
      const it = findItem(t.dataset.share);
      const text = [it.name, it.venue, (it.sessions || []).map((s) => `${s.day} ${s.start || ''}`).join(', '), it.price].filter(Boolean).join(' · ');
      navigator.share({ title: it.name, text, url: it.url || directionsUrl(it) }).catch(() => {});
      return;
    }
    if (t.dataset.goto) {
      state.open = t.dataset.goto; setTab('list'); render();
      document.getElementById('i-' + cssId(t.dataset.goto))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (t.id === 'tabList') return setTab('list');
    if (t.id === 'tabMap') return setTab('map');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  function setTab(which) {
    document.body.classList.toggle('show-map', which === 'map');
    $('#tabList').setAttribute('aria-pressed', which === 'list');
    $('#tabMap').setAttribute('aria-pressed', which === 'map');
    if (which === 'map') { render(); setTimeout(() => map && map.invalidateSize(), 60); }
  }
  window.addEventListener('resize', () => map && map.invalidateSize());

  // Setup link: #at=E83PB&r=3&born=2026-01 — stores on the phone, then clears the address bar.
  async function applyHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.has('at') && !p.has('r') && !p.has('born')) return;
    if (p.get('at')) { const loc = await lookupPostcode(p.get('at')); if (loc) state.loc = loc; }
    if (p.get('r')) state.radius = Math.min(10, Math.max(0.5, +p.get('r') || 3));
    if (p.get('born')) state.born = p.get('born');
    persist();
    history.replaceState(null, '', location.pathname + location.search);
  }

  (async () => {
    render();
    await applyHash();
    await loadData();
    render();
    if (!state.loc) openSheet(); else loadPlaces();
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();
