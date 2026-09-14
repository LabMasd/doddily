#!/usr/bin/env python3
"""Little Days - UK free family hubs / children's centres directory.

Builds /Users/marcos/little-days/data/uk-research/hubs.json from official sources:
  England  - GIAS "open children's centres" extract (DfE), + DfE "List of family hub sites" CSV
             council fallback links from GOV.UK Local Links Manager export
  N Ireland - Family Support NI directory, "Sure Start" category (official DoH/HSCB directory)
  Wales    - Vale of Glamorgan Flying Start Family Centre (Vale Family Compass page)
  Scotland - no structured official list with postcodes found (gap)
Postcodes geocoded with postcodes.io bulk API (<=100 per request).

Polite: fetches only if the cache file is missing, 1 s between requests, fixed UA.
Usage: python3 hubs.py [cache_dir]
"""
import csv, html, http.cookiejar, io, json, os, re, sys, time, urllib.parse, urllib.request, zipfile

CACHE = sys.argv[1] if len(sys.argv) > 1 else '/private/tmp/claude-501/-Users-marcos/0163a3c6-bbf9-4559-87fa-6bce78e5fab8/scratchpad/uk/hubs'
OUT = '/Users/marcos/little-days/data/uk-research/hubs.json'
UA = 'LittleDaysBot/1.0 (non-commercial family app; links back to providers)'
os.makedirs(CACHE, exist_ok=True)

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def fetch(url, data=None, headers=None):
    time.sleep(1)
    h = {'User-Agent': UA}
    h.update(headers or {})
    if isinstance(data, dict):
        data = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=data, headers=h)
    with opener.open(req, timeout=120) as r:
        return r.read(), r.geturl()


def cached(name, url):
    p = os.path.join(CACHE, name)
    if not os.path.exists(p):
        body, _ = fetch(url)
        open(p, 'wb').write(body)
    return p


# ---------------------------------------------------------------- sources
def gias_children_centres():
    p = os.path.join(CACHE, 'cc', 'edubaseallchildrencentre.csv')
    found = [f for f in os.listdir(os.path.join(CACHE, 'cc'))] if os.path.isdir(os.path.join(CACHE, 'cc')) else []
    main = [f for f in found if f.startswith('edubaseallchildrencentre')]
    if not main:
        base = 'https://get-information-schools.service.gov.uk'
        page = fetch(base + '/Downloads')[0].decode('utf-8', 'replace')
        i = page.index('action="/Downloads/Collate"')
        form = page[i:page.index('</form>', i)]
        fields = []
        for m in re.finditer(r'<input([^>]+)>', form):
            a = dict(re.findall(r'([\w\-]+)="([^"]*)"', m.group(1)))
            n = a.get('name')
            if not n:
                continue
            if a.get('type') == 'checkbox':
                idx = re.search(r'Downloads\[(\d+)\]', n)
                tag = re.search(r'name="Downloads\[%s\]\.Tag"[^>]*value="([^"]+)"' % idx.group(1), form) if idx else None
                if tag and tag.group(1) in ('all.open.childrens.centres', 'all.open.childrens.centres.links'):
                    fields.append((n, 'true'))
                continue
            fields.append((n, html.unescape(a.get('value', ''))))
        body, gen_url = fetch(base + '/Downloads/Collate', urllib.parse.urlencode(fields).encode())
        for _ in range(30):
            if b'Please wait while your file' not in body:
                break
            body, gen_url = fetch(gen_url)
        g = body.decode('utf-8', 'replace')
        tok = re.search(r'Download/Extract" method="post"><input name="__RequestVerificationToken" type="hidden" value="([^"]+)"', g).group(1)
        gid = re.search(r'name="id" type="hidden" value="([^"]+)"', g).group(1)
        path = html.unescape(re.search(r'name="path" type="hidden" value="([^"]+)"', g).group(1))
        z, _ = fetch(base + '/Downloads/Download/Extract', {'__RequestVerificationToken': tok, 'id': gid, 'path': path, 'returnSource': 'Downloads'})
        zipfile.ZipFile(io.BytesIO(z)).extractall(os.path.join(CACHE, 'cc'))
        main = [f for f in os.listdir(os.path.join(CACHE, 'cc')) if f.startswith('edubaseallchildrencentre')]
    raw = open(os.path.join(CACHE, 'cc', sorted(main)[-1]), 'rb').read()
    try:
        txt = raw.decode('utf-8')
    except UnicodeDecodeError:
        txt = raw.decode('cp1252', 'replace')
    return list(csv.DictReader(io.StringIO(txt)))


def family_hub_sites():
    p = cached('fh_sites.csv', 'https://assets.publishing.service.gov.uk/media/6980dbf0ec71a16669612e3d/List_of_family_hub_sites.csv')
    return list(csv.DictReader(open(p, encoding='utf-8-sig')))


def council_links():
    p = cached('llm_links.csv', 'https://local-links-manager.publishing.service.gov.uk/data/links_to_services_provided_by_local_authorities.csv')
    rows = [r for r in csv.DictReader(open(p, encoding='utf-8')) if r['GSS'].startswith('E') and r['URL']]
    hubpat = re.compile(r'family.?hub|children.?s.?cent|start.?for.?life|family.?cent', re.I)
    by, home = {}, {}
    for r in rows:
        m = re.match(r'(https?://[^/]+\.gov\.uk)', r['URL'])
        if m:
            home.setdefault(r['Authority Name'], m.group(1))
        if r['LGIL'] != '8' or r['LGSL'] not in ('831', '1579', '1741'):
            continue
        by.setdefault(r['Authority Name'], {})[r['LGSL']] = r['URL']
    out = {}
    for a, d in by.items():
        hub = [u for u in d.values() if hubpat.search(u)]
        out[a] = hub[0] if hub else d.get('1579') or d.get('831') or d.get('1741')
    for a, u in home.items():
        out.setdefault(a, u)  # council homepage when no family-service link is registered
    return out


def norm_la(s):
    s = s.lower().replace('&', 'and')
    s = re.sub(r"\b(council|city of|city|county|borough|metropolitan|district|royal|london|the|of|mbc|unitary|corporation)\b", ' ', s)
    return re.sub(r'[^a-z]', '', s)


LA_ALIASES = {'Kingston upon Hull, City of': 'Hull City Council', 'Newcastle upon Tyne': 'Newcastle City Council',
              'City of London': 'City of London Corporation'}


def sure_start_ni():
    base = 'https://www.familysupportni.gov.uk/Search/Results?page=%d&sTypeID=99&serviceID=135&distance=0&order=4&vacancies=0&specialneeds=0&pickup=0&vouchers=0&flexible=0&funded=0&taxfree=0&breakfast=0&studentPlacements=0'
    rows = []
    for pg, name in ((1, 'fsni_results.html'), (2, 'fsni_results_p2.html')):
        h = open(cached(name, base % pg), encoding='utf-8', errors='replace').read()
        for blk in re.split(r'(?=<a[^>]+href="/Search/Details/\d+\?slug)', h)[1:]:
            m = re.match(r'<a[^>]+href="/Search/Details/(\d+)\?slug=[^"]*"[^>]*>(.*?)</a>', blk, re.S)
            if not m:
                continue
            flat = html.unescape(re.sub(r'<[^>]+>', ' ', blk))
            a = re.search(r'Address:(.*?)Phone', flat, re.S)
            p = re.search(r'Phone:(.*?)(Email|Details)', flat, re.S)
            rows.append({'id': m.group(1), 'name': ' '.join(html.unescape(re.sub(r'<[^>]+>', '', m.group(2))).split()),
                         'address': ' '.join((a.group(1) if a else '').split()), 'phone': ' '.join((p.group(1) if p else '').split())})
    return rows


# ---------------------------------------------------------------- helpers
PC_RE = re.compile(r'\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b')


def fmt_pc(s):
    s = re.sub(r'\s+', '', (s or '').upper())
    m = re.fullmatch(r'([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})', s)
    return f'{m.group(1)} {m.group(2)}' if m else ''


def clean_url(u):
    u = (u or '').strip()
    if not u or ' ' in u or '.' not in u:
        return ''
    if not re.match(r'https?://', u, re.I):
        u = 'https://' + u.lstrip('/')
    return u


def clean_phone(p):
    return re.sub(r'\s+', ' ', (p or '').replace('-', ' ')).strip()


def norm_name(s):
    return re.sub(r'[^a-z0-9]', '', re.sub(r"children'?s|centre|center|family|hub|sure ?start|and|the", '', s.lower()))


def item(**kw):
    base = {"name": "Stay & play and baby groups", "provider": "", "category": "stayplay", "venue": "", "address": "",
            "postcode": "", "lat": 0, "lng": 0, "sessions": [], "tier": "venue",
            "schedule_note": "Free groups most weekdays; check the centre's timetable",
            "age_min_months": 0, "age_max_months": 60, "price": "Free", "free": True, "booking": "drop-in", "indoor": True,
            "description": "", "url": "", "phone": "", "source": "", "confidence": "medium"}
    base.update(kw)
    return base


# ---------------------------------------------------------------- build
def build():
    links = council_links()
    amap = {}
    for a in links:
        amap.setdefault(norm_la(a), a)

    def council(la):
        a = LA_ALIASES.get(la) or amap.get(norm_la(la))
        return (a or (la + ' Council')), (links.get(a, '') if a else '')

    items = []
    seen = {}
    # England: GIAS
    for r in gias_children_centres():
        if not r['EstablishmentStatus (name)'].lower().startswith('open'):
            continue
        pc = fmt_pc(r['Postcode'])
        if not pc:
            continue
        prov, curl = council(r['LA (name)'])
        site = clean_url(r['SchoolWebsite'])
        name = r['EstablishmentName'].strip()
        key = (pc, norm_name(name))
        if key in seen:
            continue
        addr = ', '.join(x.strip() for x in (r['Street'], r['Locality'], r['Address3'], r['Town']) if x.strip() and x.strip() != name)
        linked = 'linked site' in r['TypeOfEstablishment (name)'].lower()
        it = item(provider=prov, venue=name, address=addr, postcode=pc, url=site or curl, phone=clean_phone(r['TelephoneNum']),
                  description=("Free council children's centre site" if linked else "Free council children's centre") +
                  " offering stay and play, baby groups and feeding support for under-5s.",
                  source='GIAS (DfE open children\'s centres)' + ('' if site else ' / council page via GOV.UK Local Links'),
                  confidence='medium' if site else 'low', _la=r['LA (name)'])
        seen[key] = it
        items.append(it)
    by_pc = {}
    for it in items:
        by_pc.setdefault(it['postcode'], []).append(it)

    # England: DfE family hub sites
    for r in family_hub_sites():
        pc = fmt_pc(r['Postcode'])
        if not pc:
            continue
        name = r['Family_Hub'].strip()
        cands = by_pc.get(pc, [])
        match = next((c for c in cands if norm_name(c['venue']) == norm_name(name)), None) or (cands[0] if len(cands) == 1 else None)
        desc = "Free council family hub with stay and play, baby groups, feeding support and Start for Life services."
        if match:
            match['description'] = desc
            match['source'] = match['source'].replace('GIAS (DfE open children\'s centres)', 'GIAS + DfE family hub sites list')
            match['confidence'] = 'high' if not match['source'].endswith('Local Links') else 'medium'
            if 'hub' in name.lower() and 'hub' not in match['venue'].lower():
                match['venue'] = name
            continue
        prov, curl = council(r['Local_Authority'])
        it = item(provider=prov, venue=name, address='', postcode=pc, url=curl, description=desc,
                  source='DfE family hub sites list / council page via GOV.UK Local Links', confidence='medium', _la=r['Local_Authority'])
        items.append(it)
        by_pc.setdefault(pc, []).append(it)

    # Northern Ireland: Sure Start
    for r in sure_start_ni():
        pcs = PC_RE.findall(re.sub(r'\bBT\s+(\d)', r'BT\1', r['address'].upper()))
        if not pcs:
            continue
        pc = fmt_pc(''.join(pcs[-1]))
        nm = re.sub(r'^Sure Start\s*-\s*', '', r['name'])
        prov = 'Action for Children' if 'action for children' in nm.lower() else 'Sure Start NI (Education Authority / DoE funded)'
        nm = re.sub(r'\s*-\s*Action For Children', '', nm, flags=re.I)
        addr = re.sub(r',?\s*' + re.escape(pc.split()[0]) + r'\s*' + re.escape(pc.split()[1]) + r'\s*$', '', r['address']).strip(' ,')
        addr = re.sub(r',\s*,', ',', addr)
        items.append(item(provider=prov, venue='Sure Start ' + nm, address=addr, postcode=pc,
                          age_max_months=48, url='https://www.familysupportni.gov.uk/Search/Details/' + r['id'],
                          phone=r['phone'], description="Free Sure Start centre for families with children under 4: stay and play, baby groups and parenting and feeding support (some services for families in the catchment area).",
                          source='Family Support NI directory (Sure Start category)', confidence='high', _la='Northern Ireland'))

    # Wales: Vale of Glamorgan Flying Start Family Centre
    vpath = os.path.join(CACHE, 'vale_flyingstart.html')
    if os.path.exists(vpath) and 'CF63 1NH' in open(vpath, encoding='utf-8', errors='replace').read():
        items.append(item(provider='Vale of Glamorgan Council', venue='Flying Start Family Centre', address='Gladstone Road, Barry',
                          postcode='CF63 1NH', age_max_months=48, url='https://valefamilycompass.co.uk/information/flying-start/',
                          phone='01446 725106', description="Flying Start family centre: free groups, parenting and feeding support for families in Flying Start areas.",
                          source='Vale Family Compass (Vale of Glamorgan FIS)', confidence='medium', _la='Vale of Glamorgan'))

    # ---- geocode
    gpath = os.path.join(CACHE, 'geocode.json')
    geo = json.load(open(gpath)) if os.path.exists(gpath) else {}
    todo = sorted({it['postcode'] for it in items} - set(geo))
    for i in range(0, len(todo), 100):
        batch = todo[i:i + 100]
        req = urllib.request.Request('https://api.postcodes.io/postcodes', data=json.dumps({'postcodes': batch}).encode(),
                                     headers={'Content-Type': 'application/json', 'User-Agent': UA})
        res = json.load(urllib.request.urlopen(req, timeout=60))['result']
        for r in res:
            g = r['result']
            geo[r['query']] = {'lat': g['latitude'], 'lng': g['longitude'], 'country': g['country'], 'region': g.get('region')} if g and g.get('latitude') is not None else None
        json.dump(geo, open(gpath, 'w'))
        time.sleep(0.5)
    # recover retired (terminated) postcodes - real coords, flagged low confidence
    for pc in sorted(p for p in {it['postcode'] for it in items} if geo.get(p) is None and not geo.get('T:' + p)):
        try:
            req = urllib.request.Request('https://api.postcodes.io/terminated_postcodes/' + pc.replace(' ', ''), headers={'User-Agent': UA})
            g = json.load(urllib.request.urlopen(req, timeout=30))['result']
            geo['T:' + pc] = {'lat': g['latitude'], 'lng': g['longitude'], 'country': 'England' if not pc.startswith('BT') else 'Northern Ireland', 'region': 'retired postcode', 'terminated': True}
        except Exception:
            geo['T:' + pc] = False
        json.dump(geo, open(gpath, 'w'))
        time.sleep(1)

    out, dropped, stats = [], [], {}
    for it in items:
        g = geo.get(it['postcode']) or geo.get('T:' + it['postcode'])
        la = it.pop('_la')
        if not g:
            dropped.append((it['venue'], it['postcode'], la))
            continue
        if g.get('terminated'):
            it['confidence'] = 'low'
            it['source'] += ' (retired postcode; location approximate)'
        it['lat'], it['lng'] = round(g['lat'], 6), round(g['lng'], 6)
        out.append(it)
        k = g['country'] + (' / ' + g['region'] if g.get('region') else '')
        stats[k] = stats.get(k, 0) + 1
    out.sort(key=lambda x: (x['postcode'], x['venue']))
    json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
    print('written', len(out), 'items to', OUT)
    for k in sorted(stats):
        print(f'  {stats[k]:5d}  {k}')
    print('dropped (no valid/live postcode):', len(dropped))
    for d in dropped[:40]:
        print('   ', d)
    print('confidence', {c: sum(1 for x in out if x['confidence'] == c) for c in ('high', 'medium', 'low')})
    print('no url', sum(1 for x in out if not x['url']))


if __name__ == '__main__':
    build()
