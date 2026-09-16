// App Store promo pages: a caption in Doddily's type above the phone, 1320 x 2868.
//
//   node tools/simulator/promo.mjs <screenshot folder> [output folder]
//
// Renders an HTML page per screenshot with headless Chrome, so the type matches the app.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1320, H = 2868;
const shotsDir = resolve(process.argv[2] ?? `${process.env.HOME}/Downloads/doddily-screenshots`);
const outDir = resolve(process.argv[3] ?? `${process.env.HOME}/Downloads/doddily-promo`);
const workDir = `${process.env.TMPDIR ?? '/tmp'}/doddily-promo-work`;

// Each page: the screen, a line that says what it does, and the ground it sits on.
const PAGES = [
  { file: '1-today.png', ground: 'milk', headline: 'What’s on today,\nin time order', sub: 'With walking time from your door.' },
  { file: '2-map.png', ground: 'purple', headline: 'Everything near you,\non one map', sub: 'Inside the distance you choose.' },
  { file: '4-you.png', ground: 'soft', headline: 'Only what suits\ntheir age', sub: 'Add their birth month once, in You.' },
];

const GROUNDS = {
  milk: { bg: '#F4F6F8', ink: '#1E2536', muted: '#5F6878' },
  purple: { bg: '#C7B5F5', ink: '#1E2536', muted: '#4B3A8C' },
  soft: { bg: '#F0EAFE', ink: '#1E2536', muted: '#4B3A8C' },
  ink: { bg: '#1E2536', ink: '#FFFFFF', muted: '#C7B5F5' },
};

const page = ({ dataUri, ground, headline, sub }) => {
  const c = GROUNDS[ground];
  return `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Figtree:wght@500;600&display=swap">
<style>
  *{margin:0;box-sizing:border-box}
  body{width:${W}px;height:${H}px;background:${c.bg};color:${c.ink};overflow:hidden;
       display:flex;flex-direction:column;align-items:center;font-family:"Figtree",system-ui,sans-serif}
  h1{font:800 104px/1.02 "Bricolage Grotesque",system-ui,sans-serif;letter-spacing:-.03em;text-align:center;
     white-space:pre-line;margin-top:170px}
  p{font:600 46px/1.35 "Figtree",system-ui,sans-serif;color:${c.muted};text-align:center;margin-top:34px;max-width:1000px}
  /* The phone: the screenshot inside a thin dark bezel, cropped at the bottom of the page. */
  .phone{margin-top:96px;width:1010px;border-radius:78px;background:#0E1118;padding:14px;
         box-shadow:0 60px 120px -40px rgba(30,37,54,.45)}
  .phone img{display:block;width:100%;border-radius:64px}
</style>
<h1>${headline}</h1>
<p>${sub}</p>
<div class="phone"><img src="${dataUri}"></div>`;
};

mkdirSync(outDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

for (const spec of PAGES) {
  const src = join(shotsDir, spec.file);
  if (!existsSync(src)) {
    console.log(`skipped ${spec.file}: not found`);
    continue;
  }
  const dataUri = `data:image/png;base64,${readFileSync(src).toString('base64')}`;
  const html = join(workDir, spec.file.replace('.png', '.html'));
  writeFileSync(html, page({ ...spec, dataUri }));
  const out = join(outDir, spec.file.replace(/^\d+-/, 'promo-'));
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${W},${H}`, '--virtual-time-budget=6000',
    `--screenshot=${out}`, `file://${html}`,
  ], { stdio: 'ignore' });
  console.log('made', out);
}
console.log(`Promo pages in ${outDir}`);
