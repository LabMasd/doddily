// A preview of the rendered posts: an Instagram profile grid, plus a contact sheet per week.
//
//   node tools/social/preview.mjs [posts folder]
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? `${process.env.HOME}/Downloads/doddily-posts`);
const captions = existsSync(join(dir, 'captions.txt')) ? readFileSync(join(dir, 'captions.txt'), 'utf8') : '';

// captions.txt is blocks separated by ---, each starting "POST 4 — …" or "STORY S5 — …"
const capFor = {};
for (const block of captions.split(/\n---\n/)) {
  const head = block.trim().split('\n')[0] || '';
  const post = head.match(/^POST (\d+)/);
  const story = head.match(/^STORY (S\d+)/);
  const body = block.trim().split('\n').slice(1).join('\n').trim();
  if (post) capFor[`post-${String(post[1]).padStart(2, '0')}`] = { head, body };
  if (story) capFor[`story-${story[1].toLowerCase()}`] = { head, body };
}
const keyOf = (file) => (file.match(/^(post-\d+|story-s\d+)/) || [''])[0];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The profile grid shows the first slide of each feed post, newest first, as Instagram does.
const feedTiles = readdirSync(dir)
  .filter((f) => /^post-\d+.*\.png$/.test(f) && !/-[2-9]\.png$/.test(f))
  .sort()
  .reverse();

const weeks = readdirSync(dir).filter((f) => f.startsWith('week-') && statSync(join(dir, f)).isDirectory()).sort();
const groups = [
  { id: 'profile', title: `Profile grid · ${feedTiles.length} posts`, profile: true, files: feedTiles.map((f) => ({ src: f, file: f })) },
  ...weeks.map((w) => ({
    id: w,
    title: w.replace('week-0-teasers', 'Before launch · teasers').replace(/^week-(\d)$/, 'Week $1'),
    files: readdirSync(join(dir, w)).filter((f) => f.endsWith('.png')).sort().map((f) => ({ src: `${w}/${f}`, file: f })),
  })),
];
const all = readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => ({ src: f, file: f }));
groups.push({ id: 'all', title: `Everything · ${all.length} images`, files: all });

const card = ({ src, file }) => {
  const c = capFor[keyOf(file.replace(/^(mon|tue|wed|thu|fri|sat|sun|day-\d|any-day)-/, ''))] || {};
  const story = /story-/.test(file);
  const day = (file.match(/^(mon|tue|wed|thu|fri|sat|sun|day-\d|any-day)/) || [])[0];
  return [
    `<figure class="card${story ? ' story' : ''}">`,
    `<a href="${esc(src)}" target="_blank"><img loading="lazy" src="${esc(src)}" alt="${esc(file)}"></a>`,
    '<figcaption>',
    day ? `<span class="day">${esc(day.replace(/-/g, ' '))}</span>` : '',
    `<b>${esc(c.head || file)}</b>`,
    c.body ? `<p>${esc(c.body)}</p><button class="copy" type="button">Copy caption</button>` : '',
    '</figcaption></figure>',
  ].join('');
};

const FLOWER = '<svg viewBox="0 0 18 18"><g fill="#C7B5F5"><circle cx="9" cy="3.6" r="3.6"/><circle cx="14.14" cy="7.33" r="3.6"/><circle cx="12.17" cy="13.37" r="3.6"/><circle cx="5.83" cy="13.37" r="3.6"/><circle cx="3.86" cy="7.33" r="3.6"/></g></svg>';

const profileSection = (g, i) => [
  `<section id="${g.id}"${i === 0 ? '' : ' hidden'}>`,
  `<h2>${esc(g.title)}</h2>`,
  '<p class="note">The first slide of each post, newest first, as it will sit on the profile. Instagram crops grid tiles to 4:5.</p>',
  '<div class="phone">',
  `<div class="ig-head"><span class="avatar">${FLOWER}</span>`,
  `<div class="ig-stats"><b>${g.files.length}</b><b>&mdash;</b><b>&mdash;</b><span>posts</span><span>followers</span><span>following</span></div></div>`,
  '<div class="ig-bio"><b>doddily.app</b><span>Doddily &middot; what&rsquo;s on for your little one today.</span><span class="link">doddily.app</span></div>',
  `<div class="ig-grid">${g.files.map((f) => `<img loading="lazy" src="${esc(f.src)}" alt="${esc(f.file)}">`).join('')}</div>`,
  '</div></section>',
].join('');

const sheetSection = (g, i) => [
  `<section id="${g.id}"${i === 0 ? '' : ' hidden'}>`,
  `<h2>${esc(g.title)}</h2>`,
  `<div class="grid">${g.files.map(card).join('')}</div>`,
  '</section>',
].join('');

const STYLE = `
  :root{--ink:#1E2536;--milk:#F4F6F8;--muted:#5F6878;--line:#DFE3E9;--accent:#C7B5F5;--accent-line:#8A6FD6;--card:#fff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--milk);color:var(--ink);font:16px/1.5 "Figtree",system-ui,sans-serif;padding:0 20px 80px}
  header{position:sticky;top:0;z-index:5;background:rgba(244,246,248,.88);backdrop-filter:blur(12px);padding:18px 20px 12px;margin:0 -20px 8px}
  h1{font:800 34px/1 "Bricolage Grotesque",system-ui,sans-serif;margin:0 0 12px;letter-spacing:-.02em}
  nav{display:flex;flex-wrap:wrap;gap:8px}
  nav button{font:600 14px "Figtree",system-ui,sans-serif;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:7px 14px;cursor:pointer}
  nav button[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:#fff}
  section{padding-top:26px}
  h2{font:700 22px "Bricolage Grotesque",system-ui,sans-serif;margin:0 0 10px}
  .note{color:var(--muted);font-size:14px;margin:0 0 18px;max-width:52ch}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:22px}
  .card{margin:0;background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:grid;grid-template-rows:auto 1fr}
  .card img{display:block;width:100%;height:auto;background:var(--milk)}
  .card.story img{background:var(--ink)}
  figcaption{padding:12px 14px 14px;display:grid;gap:6px;align-content:start}
  .day{font:700 11px "Figtree",system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:var(--accent-line)}
  figcaption b{font:700 14px "Figtree",system-ui,sans-serif}
  figcaption p{margin:0;font-size:13px;line-height:1.45;color:var(--muted);white-space:pre-line;max-height:7.5em;overflow:auto}
  .copy{justify-self:start;font:600 13px "Figtree",system-ui,sans-serif;border:1px solid var(--line);background:transparent;border-radius:999px;padding:5px 11px;cursor:pointer}
  .copy[data-done]{background:#E3F2EA;border-color:#2F7A52;color:#2F7A52}
  .phone{width:430px;max-width:100%;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:26px;overflow:hidden;box-shadow:0 24px 60px -34px rgba(30,37,54,.55)}
  .ig-head{display:flex;align-items:center;gap:20px;padding:18px 16px 10px}
  .avatar{width:76px;height:76px;border-radius:50%;background:var(--ink);display:grid;place-items:center;flex:none}
  .avatar svg{width:40px;height:40px}
  .ig-stats{display:grid;grid-template-columns:repeat(3,1fr);text-align:center;flex:1;font-size:13px;color:var(--muted)}
  .ig-stats b{font:700 17px "Figtree",system-ui,sans-serif;color:var(--ink)}
  .ig-bio{padding:0 16px 14px;display:grid;gap:2px;font-size:14px}
  .ig-bio b{font-weight:600}
  .ig-bio .link{color:var(--accent-line)}
  .ig-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}
  .ig-grid img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;background:var(--milk)}
  @media (max-width:520px){.grid{grid-template-columns:1fr 1fr;gap:12px}figcaption p{display:none}}
`;

const SCRIPT = `
  const nav = document.getElementById('nav');
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-go]');
    if (!b) return;
    nav.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('section').forEach((s) => { s.hidden = s.id !== b.dataset.go; });
    window.scrollTo({ top: 0 });
  });
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy');
    if (!btn) return;
    const text = btn.parentElement.querySelector('p').textContent;
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; btn.setAttribute('data-done', ''); }
    catch (err) { btn.textContent = 'Select it to copy'; }
    setTimeout(() => { btn.textContent = 'Copy caption'; btn.removeAttribute('data-done'); }, 1800);
  });
`;

const html = [
  '<!doctype html><meta charset="utf-8"><title>Doddily posts</title>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Figtree:wght@400;500;600&display=swap">',
  `<style>${STYLE}</style>`,
  '<header><h1>Doddily posts</h1><nav id="nav">',
  groups.map((g, i) => `<button type="button" data-go="${g.id}" aria-pressed="${i === 0}">${esc(g.title.split(' · ')[0])}</button>`).join(''),
  '</nav></header>',
  groups.map((g, i) => (g.profile ? profileSection(g, i) : sheetSection(g, i))).join(''),
  `<script>${SCRIPT}</script>`,
].join('\n');

writeFileSync(join(dir, 'preview.html'), html);
console.log(`preview.html: profile grid (${feedTiles.length} tiles) plus ${groups.length - 1} other views`);
