// Sorts the rendered posts into the weeks of the playbook calendar, with a plan for each.
//
//   node tools/social/organise.mjs <playbook.html> [posts folder]
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const book = readFileSync(resolve(process.argv[2]), 'utf8');
const src = resolve(process.argv[3] ?? `${process.env.HOME}/Downloads/doddily-posts`);
const grab = (start, end) => {
  const a = book.indexOf(start), b = book.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`could not find ${start}`);
  return book.slice(a, b);
};
const defs = grab('const flower =', '// A four-week calendar');
const cal = grab('const CAL = [', 'const DAYS =');
const { FEED, STORIES, REELS, CAL } = new Function(`${defs}\n${cal}\n return { FEED, STORIES, REELS, CAL };`)();

const files = readdirSync(src).filter((f) => f.endsWith('.png'));
const filesFor = (label) => {
  const post = label.match(/^Post (\d+)$/);
  if (post) return files.filter((f) => f.startsWith(`post-${String(post[1]).padStart(2, '0')}-`));
  const story = label.match(/^S(\d+)$/);
  if (story) return files.filter((f) => f.startsWith(`story-s${story[1]}-`));
  return [];
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const weeks = {
  'week-0-teasers': [['Day 1', 'Post 1', 'Teaser'], ['Day 2', 'Post 2', 'The 9am problem'], ['Day 3', 'Post 3', 'How it works'], ['Day 4', 'Post 21', 'The app itself, four slides'], ['Any day', 'S1', 'Countdown sticker'], ['Any day', 'S17', 'Today screen'], ['Any day', 'S18', 'Map screen'], ['Day 4', 'S19', 'Series 1 of 4'], ['Day 4', 'S20', 'Series 2 of 4'], ['Day 4', 'S21', 'Series 3 of 4'], ['Day 4', 'S22', 'Series 4 of 4']],
};
CAL.forEach(([, days], i) => {
  weeks[`week-${i + 1}`] = days.map(([, what, note], d) => [DAYS[d], what, note]).filter(([, what]) => what !== 'Rest');
});

for (const [folder, items] of Object.entries(weeks)) {
  const dir = join(src, folder);
  mkdirSync(dir, { recursive: true });
  const lines = [folder.replace(/-/g, ' ').toUpperCase(), ''];
  let copied = 0;
  for (const [day, label, note] of items) {
    for (const f of filesFor(label)) {
      copyFileSync(join(src, f), join(dir, `${day.toLowerCase().replace(/ /g, '-')}-${f}`));
      copied++;
    }
    const post = FEED.find((p) => `Post ${p.id}` === label);
    const story = STORIES.find((s) => s.id === label);
    const reel = label.startsWith('Reel') ? REELS[Number(label.split(' ')[1]) - 1] : null;
    lines.push(`${day} — ${label}${note ? ' · ' + note : ''}`);
    if (post) lines.push('', post.caption, '', post.tags, '', `Alt text: ${post.alt}`, '');
    if (story) lines.push('', story.use, '', story.caption, '', `Alt text: ${story.alt}`, '');
    if (reel) lines.push('', `Film it — ${reel.hook} (${reel.len})`, ...reel.shots.map(([t, s]) => `  ${t}  ${s}`), '');
    lines.push('-'.repeat(52), '');
  }
  writeFileSync(join(dir, 'plan.txt'), lines.join('\n'));
  console.log(`${folder}: ${copied} images`);
}
