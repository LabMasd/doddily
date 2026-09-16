// Turns the social playbook's posts into image files you can actually post.
//
//   node tools/social/render.mjs <playbook.html> [output folder]
//
// The playbook holds every post as data plus a set of artwork templates that build HTML.
// This reuses both, drops each card into a page at full Instagram size, and screenshots it
// with headless Chrome. The artwork is sized in container units, so it scales exactly.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FEED = { w: 1080, h: 1350 };   // 4:5, the tallest Instagram allows in the feed
const STORY = { w: 1080, h: 1920 };  // 9:16

const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length);
const playbookPath = resolve(process.argv[2] ?? `${process.env.HOME}/Downloads/doddily-social.html`);
const outDir = resolve(process.argv[3] ?? `${process.env.HOME}/Downloads/doddily-posts`);
const workDir = `${process.env.TMPDIR ?? '/tmp'}/doddily-posts-work`;
const html = readFileSync(playbookPath, 'utf8');

// The playbook's own CSS, so the exports match the previews exactly.
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
const flowerSymbol = (html.match(/<svg width="0"[\s\S]*?<\/svg>/) || [''])[0];

// The artwork templates and post data are plain string builders, so they can be run here.
const scriptStart = html.indexOf("const flower =");
const scriptEnd = html.indexOf("// A four-week calendar");
if (scriptStart < 0 || scriptEnd < 0) throw new Error('Could not find the post definitions in the playbook');
const defs = html.slice(scriptStart, scriptEnd);
const { FEED: feed, STORIES: stories } = new Function(`${defs}; return { FEED, STORIES };`)();

const page = (inner, size, ratioClass) => `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&display=swap">
<style>${css}
  html,body{margin:0;padding:0;background:transparent}
  body{width:${size.w}px;height:${size.h}px;overflow:hidden}
  .art{width:${size.w}px;height:${size.h}px;aspect-ratio:auto;display:block;overflow:hidden}
  .art > .frame{width:${size.w}px;height:${size.h}px;aspect-ratio:auto;box-sizing:border-box}
  .art.slides{display:block}
</style>${flowerSymbol}
<div class="art ${ratioClass}">${inner}</div>`;

mkdirSync(outDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
let made = 0;

const shoot = (name, inner, size, ratioClass) => {
  if (only && !name.includes(only)) return;   // partial render: skip anything not asked for
  const file = join(workDir, `${name}.html`);
  writeFileSync(file, page(inner, size, ratioClass));
  const out = join(outDir, `${name}.png`);
  const args = [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${size.w},${size.h}`, '--virtual-time-budget=6000',
    `--screenshot=${out}`, `file://${file}`,
  ];
  try {
    // A capture that hangs must not wedge the whole run.
    execFileSync(CHROME, args, { stdio: "ignore", timeout: 45000, killSignal: "SIGKILL" });
    console.log("made", out);
    made++;
  } catch (e) {
    console.log("SKIPPED", name, "-", e.code === "ETIMEDOUT" ? "Chrome hung" : e.message.split("\n")[0]);
  }
};

for (const p of feed) {
  const base = `post-${String(p.id).padStart(2, '0')}-${slug(p.pillar || p.phase)}`;
  p.frames.forEach((frame, i) => shoot(p.frames.length > 1 ? `${base}-${i + 1}` : base, frame, FEED, 'r45'));
}
for (const s of stories) {
  shoot(`story-${String(s.id).toLowerCase()}-${slug(s.phase)}`, s.frames[0], STORY, 'r916');
}

// Captions alongside, so posting is copy and paste.
const captions = [
  ...feed.map((p) => `POST ${p.id} — ${p.phase} · ${p.format}\n\n${p.caption}\n\n${p.tags}\n\nAlt text: ${p.alt}`),
  ...stories.map((s) => `STORY ${s.id} — ${s.phase}\n${s.use}\n\n${s.caption}\n\nAlt text: ${s.alt}`),
].join('\n\n---\n\n');
if (!only) writeFileSync(join(outDir, 'captions.txt'), captions);
console.log(`\n${made} images and captions.txt in ${outDir}`);
