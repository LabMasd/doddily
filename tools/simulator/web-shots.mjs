// Store screenshots rendered from the app's own code, without a simulator: the web export of the app, drawn by Chrome at
// three device pixels per point, with an iPhone status bar on top. 440 x 956 points is an iPhone 17 Pro Max, so each
// image is 1320 x 2868, the size Apple asks for.
//
//   DODDILY_WEB=1 npx expo export -p web --output-dir <dir>/doddily     (in app/)
//   serve <dir> on a local port with a fallback to doddily/index.html
//   node tools/simulator/web-shots.mjs http://127.0.0.1:8266/doddily <output folder>
//
// What differs from an iPhone: the map is drawn with OpenStreetMap tiles instead of Apple Maps, and the Directions
// choice has no Apple Maps chip. Everything else is the same components the phone runs.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/Users/marcos/qr-lab/site/node_modules/playwright');

const base = (process.argv[2] || 'http://127.0.0.1:8266/doddily').replace(/\/$/, '');
const out = process.argv[3] || `${process.env.HOME}/Downloads/doddily-screenshots`;
mkdirSync(out, { recursive: true });
const W = 440, H = 956, BAR = 62;

const settings = { loc: { lat: 51.545033, lng: -0.056407, name: 'E8 1EA', postcode: 'E8 1EA' }, radius: 3, group: 'all', onboarded: true, name: '', kids: [{ id: 'k1', name: 'Ada', band: '1to2' }], mapApp: 'google' };
// A few saved classes, so the Saved screen has something on it (the same sample the simulator shots used).
const seedFile = new URL('./saved-seed.json', import.meta.url);
const saved = existsSync(seedFile) ? readFileSync(seedFile, 'utf8') : '{}';
// The status bar Apple uses in its own shots: 9:41, full signal, Wi-Fi, full battery, and the Dynamic Island.
const STATUS = `<div id="sb" style="position:fixed;top:0;left:0;right:0;height:${BAR}px;z-index:99999;pointer-events:none;font:600 17px/1 -apple-system,'SF Pro Text',system-ui;color:#000">
  <span style="position:absolute;left:0;width:132px;top:23px;text-align:center;letter-spacing:-.2px">9:41</span>
  <span style="position:absolute;left:50%;top:14px;width:126px;height:37px;margin-left:-63px;border-radius:19px;background:#000"></span>
  <svg style="position:absolute;right:33px;top:23px" width="78" height="14" viewBox="0 0 78 14" fill="#000">
    <rect x="0" y="9" width="3.2" height="4.4" rx=".8"/><rect x="5" y="6.6" width="3.2" height="6.8" rx=".8"/><rect x="10" y="3.8" width="3.2" height="9.6" rx=".8"/><rect x="15" y="1" width="3.2" height="12.4" rx=".8"/>
    <path d="M32.5 3.2c2.6 0 5 1 6.8 2.7.2.2.5.2.6 0l1-1c.2-.2.2-.5 0-.6A12.3 12.3 0 0 0 32.5 1c-3.2 0-6.200 1.200-8.400 3.300-.2.1-.2.4 0 .6l1 1c.1.2.4.2.6 0a9.800 9.800 0 0 1 6.800-2.700Zm0 4c1.500 0 2.900.600 4 1.500.200.200.500.200.600 0l1-1c.200-.200.200-.500 0-.600a8.200 8.200 0 0 0-11.200 0c-.2.100-.2.400 0 .600l1 1c.1.200.4.200.6 0a6 6 0 0 1 4-1.500Zm2.300 3.300c.2-.2.200-.5 0-.600a3.700 3.700 0 0 0-4.600 0c-.2.100-.2.400 0 .600l2 2c.1.200.4.200.6 0l2-2Z"/>
    <rect x="48.500" y="1" width="24" height="12" rx="3.800" fill="none" stroke="#000" stroke-opacity=".4"/><rect x="50.200" y="2.700" width="20.600" height="8.600" rx="2.300"/><path d="M74.300 5v4c.9-.3 1.400-1.100 1.400-2s-.5-1.700-1.400-2Z" fill-opacity=".45"/>
  </svg></div>`;

const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3 });
await ctx.addInitScript(([s, sv]) => { try { localStorage.setItem('ld:settings:v1', JSON.stringify(s)); localStorage.setItem('ld:saved:v1', sv); } catch {} }, [settings, saved]);
const p = await ctx.newPage();
const dress = () => p.evaluate(({ STATUS, BAR }) => {
  if (!document.getElementById('sb')) document.body.insertAdjacentHTML('beforeend', STATUS);
  const root = document.getElementById('root'); Object.assign(root.style, { position: 'absolute', top: BAR + 'px', left: '0', right: '0', bottom: '0', height: 'auto' });
  document.body.style.background = '#F4F6F8'; // the app's own background, so the status bar sits on the same ground
}, { STATUS, BAR });
const shot = async (name, path, settle, prep) => {
  await p.goto(base + path, { waitUntil: 'networkidle' }); await dress(); await p.waitForTimeout(settle);
  if (prep) { await prep(); await p.waitForTimeout(900); }
  await dress(); await p.screenshot({ path: `${out}/${name}.png` }); console.log('rendered', name);
};
await shot('1-today', '/', 4500);
// the web map opens a little further out than the phone does: one step in, so the circle fills the width as it does on an iPhone
await shot('2-map', '/map', 5000, async () => { await p.mouse.move(220, 600); await p.mouse.wheel(0, -160); await p.waitForTimeout(2500); });
await shot('3-saved', '/saved', 2500);
await shot('4-you', '/you', 2500);
await shot('6-calendar', '/', 4500, () => p.getByRole('button', { name: /Open the calendar/ }).click());
await shot('5-today-week', '/', 4500, () => p.getByRole('tab', { name: /All, any day/ }).click());
await b.close();
console.log('Screenshots in', out);
