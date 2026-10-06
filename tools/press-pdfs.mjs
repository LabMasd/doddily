// The press kit's two PDFs (doddily.app/press), made from their words so a change of wording is one command.
//
//   node tools/press-pdfs.mjs [press folder]        default ~/doddily-site/press
//
// press-release.pdf is drawn from <press>/press-release.md (everything above the "---" line; the notes for the
// editor below it are not for publication). fact-sheet.pdf is drawn from FACTS below, which also takes its two
// quotes, the "About" paragraph and the contact line from the release, so the two can never disagree.
// Needs Google Chrome. Nothing is uploaded; commit and push the website to publish.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/Users/marcos/qr-lab/site/node_modules/playwright');

const press = (process.argv[2] || `${process.env.HOME}/doddily-site/press`).replace(/\/$/, '');
const md = readFileSync(`${press}/press-release.md`, 'utf8').split(/\n---\n/)[0];
const logo = `data:image/svg+xml;base64,${readFileSync(`${press}/assets/logos/doddily-lockup-ink.svg`).toString('base64')}`;

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// addresses become links, the way the earlier PDFs had them
const rich = (s) => esc(s).replace(/hello@doddily\.app/g, '<a href="mailto:hello@doddily.app">hello@doddily.app</a>').replace(/doddily\.app\/press/g, '<a href="https://doddily.app/press">doddily.app/press</a>').replace(/(^|[\s(])doddily\.app(?=[\s.·)]|$)/g, '$1<a href="https://doddily.app">doddily.app</a>');

// the release, block by block
const blocks = md.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).filter((b) => !b.startsWith('# '));
let release = '', seenStand = false; const by = {};
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i], bold = /^\*\*(.+)\*\*$/s.exec(b);
  if (b.startsWith('**FOR IMMEDIATE RELEASE**')) release += `<p class="dateline">${esc(b.replace(/\*\*/g, ''))}</p>`;
  else if (b.startsWith('## ')) release += `<h1>${esc(b.slice(3))}</h1>`;
  else if (bold && !seenStand) { seenStand = true; release += `<p class="stand">${esc(bold[1])}</p>`; }
  else if (bold) { release += `<h2>${esc(bold[1])}</h2>`; by.last = bold[1]; }
  else if (b.startsWith('- ')) release += `<ul>${b.split('\n').map((l) => `<li>${rich(l.replace(/^- /, ''))}</li>`).join('')}</ul>`;
  else { release += `<p>${rich(b)}</p>`; if (by.last) { by[by.last] = b; by.last = null; } }
}
const quote = (who) => { const m = new RegExp(`“([^”]+),?” said \\[?${who}[^,]*\\]?, ([^.]+)\\. “([^”]+)”`).exec(md); return m ? { text: `${m[1].replace(/,$/, '')}. ${m[3]}`, by: `${/said (\[?[^,]+\]?),/.exec(m[0])[1]}, ${m[2]}` } : null; };
const quotes = [quote('Victoria'), quote('Marcos')].filter(Boolean);

const FACTS = {
  line: 'Baby and toddler classes, groups, soft play and parks near you, laid out like a timetable.',
  cards: [
    ['What it is', 'An iPhone app that shows what’s on for your little one today, near you, in time order. Add your postcode and your children’s ages; Today lists that day’s sessions with the walking time from your door. Filters for free, no booking and rainy day. Four screens: Today, Map, Saved, You.'],
    ['Who it’s for', 'Parents and carers of babies and toddlers across the UK. Class providers can have their sessions listed by emailing a link to their page.'],
    ['Price and model', '£2.99, once, on the App Store, with Family Sharing. No subscription. No account, no ads, no tracking: your postcode, your children and your saved places stay on your phone.'],
    ['Availability', 'On the UK App Store for iPhone since 2 October 2026. An Android version is in development.'],
  ],
  asOf: 'live dataset, 4 October 2026; counts grow weekly',
  numbers: [['13,572', 'classes and groups, UK-wide'], ['7,226', 'with set days and times'], ['3,912', 'free sessions'], ['129,642', 'parks, playgrounds, libraries, baby change'], ['921', 'soft play centres'], ['0', 'accounts, ads, trackers']],
};

const page = (label, title, body, kind) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Figtree:wght@400;500;600&display=swap">
<style>
@page{size:A4;margin:16mm 21mm 13mm}
*{box-sizing:border-box}html,body{margin:0}
body{font:400 9.6pt/1.58 "Figtree",system-ui,sans-serif;color:#1E2536;-webkit-print-color-adjust:exact;print-color-adjust:exact}
a{color:#4B3A8C;text-decoration:none}
.top{display:flex;justify-content:space-between;align-items:center;border-bottom:.3mm solid #DFE3E9;padding-bottom:5mm;margin-bottom:6mm;color:#667085;font-size:8pt}
.top img{height:7.2mm;display:block}
h1{font:800 21pt/1.14 "Bricolage Grotesque",system-ui,sans-serif;letter-spacing:-.015em;margin:0 0 5mm}
h2{font:700 11.5pt/1.2 "Bricolage Grotesque",system-ui,sans-serif;margin:6mm 0 2mm;break-after:avoid}
p{margin:0 0 3.6mm;break-inside:avoid}ul{margin:0 0 3.6mm;padding-left:5mm}li{margin-bottom:1.2mm}
.dateline{color:#667085;font-size:8pt;font-weight:500;margin-bottom:2.5mm}
.stand{font:600 11.4pt/1.3 "Figtree",system-ui,sans-serif;margin-bottom:3mm}
.foot{display:flex;justify-content:space-between;border-top:.3mm solid #DFE3E9;padding-top:3mm;margin-top:6mm;color:#667085;font-size:8pt}.foot a{color:inherit}
/* the fact sheet */
.sheet h1{font-size:19pt;margin-bottom:1.5mm}.sheet .line{font-size:10pt;margin-bottom:5mm}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:3.5mm}
.cards div{background:#F4F6F8;border-radius:2.6mm;padding:3.5mm 4.2mm;font-size:8.6pt;line-height:1.55}
.cards b,.sheet h2{display:block;font:700 10pt/1.2 "Bricolage Grotesque",system-ui,sans-serif;margin:0 0 1.6mm}
.sheet h2{margin:5.5mm 0 2.4mm}.sheet h2 small{font:400 7.6pt "Figtree",system-ui,sans-serif;color:#667085;margin-left:2mm}
.nums{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm}
.nums div{border:.3mm solid #DFE3E9;border-radius:2.6mm;padding:3mm 3.6mm;font-size:7.8pt;color:#667085;line-height:1.4}
.nums b{display:block;font:800 13.5pt/1.2 "Bricolage Grotesque",system-ui,sans-serif;color:#1E2536;margin-bottom:.8mm}
.q{background:#F0EAFE;border-left:.9mm solid #C7B5F5;border-radius:1.6mm;padding:3mm 4mm;margin-bottom:2.4mm;font-size:8.8pt}
.q small{display:block;color:#667085;font-size:7.8pt;margin-top:1mm}
.sheet p{font-size:8.8pt;margin-bottom:0}
/* the release reads at a comfortable size over two pages; the fact sheet is one page, so it is set tighter */
.release{font-size:10pt}.release h1{font-size:22pt}.release .stand{font-size:12pt}.release h2{font-size:12pt;margin-top:5mm}
.release .about{break-inside:avoid}
body.sheetpage .top{margin-bottom:4.5mm;padding-bottom:4mm}body.sheetpage .foot{margin-top:4mm}
body.sheetpage .sheet h2{margin-top:4.6mm}body.sheetpage .cards div{padding:3mm 4mm}body.sheetpage .sheet .line{margin-bottom:4mm}body.sheetpage .q{padding:2.6mm 4mm}
</style></head><body class="${kind}"><div class="top"><img src="${logo}" alt="Doddily"><span>${label}</span></div>${body}
<div class="foot"><a href="https://doddily.app/press">doddily.app/press</a><a href="mailto:hello@doddily.app">hello@doddily.app</a></div></body></html>`;

const sheet = `<div class="sheet"><h1>Doddily</h1><p class="line">${esc(FACTS.line)}</p>
<div class="cards">${FACTS.cards.map(([t, x]) => `<div><b>${esc(t)}</b>${esc(x)}</div>`).join('')}</div>
<h2>In numbers<small>${esc(FACTS.asOf)}</small></h2><div class="nums">${FACTS.numbers.map(([n, l]) => `<div><b>${n}</b>${esc(l)}</div>`).join('')}</div>
<h2>${quotes.length === 1 ? 'Quote' : 'Quotes'}</h2>${quotes.map((q) => `<div class="q">“${esc(q.text)}”<small>${esc(q.by)}</small></div>`).join('')}
<h2>About Doddily</h2><p>${rich(by['About Doddily'] || '')}</p>
<h2>Contact</h2><p>${rich((by['Press contact'] || '').replace('Images, screenshots', 'Logos, screenshots'))}</p></div>`;

const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage();
for (const [file, html] of [['press-release.pdf', page('Press release', 'Doddily press release', release, 'release')], ['fact-sheet.pdf', page('Fact sheet', 'Doddily fact sheet', sheet, 'sheetpage')]]) {
  await p.setContent(html, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready);
  writeFileSync(`${press}/assets/${file}`, await p.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })); console.log('made', file);
}
await b.close();
copyFileSync(`${press}/press-release.md`, `${press}/assets/press-release.md`);
