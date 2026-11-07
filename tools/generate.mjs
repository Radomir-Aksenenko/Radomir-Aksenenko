// Sets the front page of The Radomir Times as a pure ink mask, the way the Times
// made up its 1940s pages: eight narrow columns, stacked decks, one big picture,
// columns that simply stop on a jump line at the foot. Stories are built from each
// project's README and its public log by fixed rules: no model writes a word.
// Run: npm ci && pip install -r requirements.txt && GH_TOKEN=... npm run build
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import Hypher from 'hypher';
import english from 'hyphenation.en-us';
import opentype from 'opentype.js';
import * as si from 'simple-icons';

const LOGIN = 'Radomir-Aksenenko';
const FIRST_YEAR = 2022; // the account opened in October 2022
const here = dirname(fileURLToPath(import.meta.url));
const build = join(here, '.build');
mkdirSync(build, { recursive: true });
const require = createRequire(import.meta.url);
const hypher = new Hypher(english);

const parse = (b) => opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const local = (f) => parse(readFileSync(join(here, 'fonts', f)));
const pkg = (f) => parse(readFileSync(require.resolve(f)));
const fonts = {
  mark: local('Chomsky.otf'),
  chelt: local('CheltenhamClassic.ttf'),
  cheltB: local('CheltenhamClassicBold.ttf'),
  cheltBI: local('CheltenhamClassicBoldItalic.ttf'),
  body: local('schola-regular.otf'),
  bodyI: local('schola-italic.otf'),
  bodyB: local('schola-bold.otf'),
  latin: pkg('@fontsource/stint-ultra-condensed/files/stint-ultra-condensed-latin-400-normal.woff'),
  league: pkg('@fontsource/league-gothic/files/league-gothic-latin-400-normal.woff'),
  gothic: pkg('@fontsource/pathway-gothic-one/files/pathway-gothic-one-latin-400-normal.woff'),
};

// Cheltenham Classic ships no kerning, and caps set this large show it.
const KERN = { AV: -.09, VA: -.09, AW: -.07, WA: -.07, AY: -.09, YA: -.09, AT: -.07, TA: -.07, LT: -.07, LV: -.07, LY: -.08, TO: -.04, OT: -.02, FA: -.05, PA: -.05, RT: -.02, RV: -.03, RY: -.03, TR: -.02 };
const unkerned = new Set(['chelt', 'cheltB', 'cheltBI']);
const INK = '#000';

function shape(s, font, size, sp = 0) {
  const f = fonts[font];
  if (!unkerned.has(font)) return { w: f.getAdvanceWidth(s, size, { letterSpacing: sp }), d: (x, y) => f.getPath(s, x, y, size, { letterSpacing: sp }).toPathData(2) };
  const pos = [];
  let cx = 0;
  [...s].forEach((c, i, a) => {
    pos.push([c, cx]);
    cx += f.getAdvanceWidth(c, size) + sp * size + (KERN[c + (a[i + 1] ?? '')] ?? 0) * size + (c === ' ' ? size * .07 : 0);
  });
  return { w: cx, d: (x, y) => pos.map(([c, p]) => f.getPath(c, x + p, y, size).toPathData(2)).join('') };
}
const widthOf = (s, font, size, sx = 1, sp = 0) => shape(s, font, size, sp).w * sx;
function text(s, x, y, { font = 'body', size = 11, anchor = 'start', sx = 1, sp = 0 } = {}) {
  const sh = shape(s, font, size, sp);
  const w = sh.w * sx;
  const left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
  return `<path fill="${INK}" transform="translate(${left.toFixed(2)} ${y.toFixed(2)})${sx === 1 ? '' : ` scale(${sx.toFixed(4)} 1)`}" d="${sh.d(0, 0)}"/>`;
}
const fit = (s, x, y, w, font, size, opt = {}) => {
  const wd = widthOf(s, font, size);
  const sx = Math.min(opt.maxSx ?? 1, w / wd);
  const z = sx < (opt.minSx ?? .9) ? size * (w / (wd * (opt.minSx ?? .9))) : size;
  return text(s, x + w / 2, y, { font, size: z, anchor: 'middle', sx: Math.min(1, w / widthOf(s, font, z)) });
};
const rule = (x1, y, x2, h = .8) => `<rect x="${x1.toFixed(2)}" y="${y.toFixed(2)}" width="${(x2 - x1).toFixed(2)}" height="${h}" fill="${INK}"/>`;
const vrule = (x, y1, y2, w = .7) => `<rect x="${x.toFixed(2)}" y="${y1.toFixed(2)}" width="${w}" height="${(y2 - y1).toFixed(2)}" fill="${INK}"/>`;
const box = (x, y, w, h, t = .8) => rule(x, y, x + w, t) + rule(x, y + h - t, x + w, t) + vrule(x, y, y + h, t) + vrule(x + w - t, y, y + h, t);

// Body type, as cast on a Linotype: justified, hyphenated, condensed a little.
const BODY = { font: 'body', size: 9.8, lead: 11.3, sx: .91 };
const bw = (s, st = BODY) => widthOf(s, st.font, st.size, st.sx);
function syllables(word) {
  const m = word.match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/);
  if (!m || m[2].length < 6 || m[2] === m[2].toUpperCase()) return null;
  const parts = hypher.hyphenate(m[2]);
  return parts.length < 2 ? null : parts.map((p, i) => (i === 0 ? m[1] : '') + p + (i === parts.length - 1 ? m[3] : ''));
}
function setLines(str, w, st = BODY, indent = 0) {
  const space = bw(' ', st);
  const lines = [];
  let line = [], used = 0, room = w - indent;
  const push = (last) => { lines.push({ words: line, used, room, last, indent: lines.length ? 0 : indent }); line = []; used = 0; room = w; };
  const queue = str.split(/\s+/).filter(Boolean);
  while (queue.length) {
    const t = queue.shift();
    const need = bw(t, st) + (line.length ? space : 0);
    if (used + need <= room) { line.push(t); used += need; continue; }
    const parts = syllables(t);
    let done = false;
    if (parts) {
      for (let k = parts.length - 1; k >= 1 && !done; k--) {
        const head = `${parts.slice(0, k).join('')}-`;
        const hn = bw(head, st) + (line.length ? space : 0);
        if (used + hn <= room) { line.push(head); used += hn; queue.unshift(parts.slice(k).join('')); done = true; }
      }
    }
    if (!done) queue.unshift(t);
    if (!line.length) { line.push(queue.shift()); used = bw(line[0], st); }
    push(false);
  }
  if (line.length) push(true);
  return lines;
}
function drawLine(l, x, y, w, st = BODY) {
  const words = l.words;
  const natural = words.reduce((a, t) => a + bw(t, st), 0);
  const avail = w - l.indent;
  const gap = l.last || words.length < 2 ? bw(' ', st) : Math.min((avail - natural) / (words.length - 1), st.size * .95);
  let cx = x + l.indent, s = '';
  for (const t of words) { s += text(t, cx, y, { font: st.font, size: st.size, sx: st.sx }); cx += bw(t, st) + gap; }
  return s;
}

// A galley is a list of slugs. Each knows its height and draws itself at any measure.
const space = (h) => ({ h, draw: () => '' , stretch: true });
const para = (str, w, st = BODY, indent = st.size * .9) => setLines(str, w, st, indent).map((l) => ({ h: st.lead, keep: true, draw: (x, y) => drawLine(l, x, y + st.size * .78, w, st) }));
const centred = (lines, font, size, lead, w) => lines.map((t) => ({ h: lead, draw: (x, y) => fit(t, x, y + lead * .82, w, font, size) }));
const dash = (w, len = 42) => [space(3), { h: 1, draw: (x, y) => rule(x + w / 2 - len / 2, y, x + w / 2 + len / 2, .7) }, space(3)];

const HEADS = {
  latin: { font: 'latin', size: 37, lead: 31 },
  league: { font: 'league', size: 28, lead: 27 },
  chelt: { font: 'cheltBI', size: 18.6, lead: 20.5 },
};
function story(w, { head, style = 'latin', deck = [], deckB = [], special = true, body = [] }) {
  const H = HEADS[style];
  const out = [...centred(head, H.font, H.size, H.lead, w)];
  if (deck.length) { out.push(...dash(w)); out.push(...centred(deck, 'gothic', 17.2, 16.6, w)); }
  if (deckB.length) { out.push(...dash(w)); out.push(...centred(deckB, 'body', 10.8, 13, w)); }
  if (special) {
    out.push(...dash(w, 26));
    out.push(...centred(['Special to The Radomir Times'], 'bodyI', 8.2, 10.5, w));
    out.push(space(3));
  } else out.push(space(4));
  body.forEach((p) => out.push(...para(p, w)));
  return out;
}
const sep = (w) => [space(6), { h: 1.6, draw: (x, y) => rule(x, y, x + w, 1.6) }, space(6)];
const thin = (w) => [space(5), { h: 1, draw: (x, y) => rule(x + w * .3, y, x + w * .7, .7) }, space(5)];
function table(w, title, rows, note) {
  const out = [...centred([title], 'league', 17.5, 18, w)];
  out.push({ h: 3, draw: (x, y) => rule(x, y + 1.4, x + w, .8) });
  out.push(space(2));
  for (const [a, b] of rows) {
    out.push({
      h: 11.6,
      draw: (x, y) => {
        const by = y + 9.2;
        const bx = widthOf(b, 'body', 9.6, .9);
        const room = w - bx - 7;
        const wa = widthOf(a, 'body', 9.6, .9);
        const sx = Math.min(.9, .9 * room / wa);
        let s = text(a, x, by, { font: 'body', size: 9.6, sx });
        s += text(b, x + w, by, { font: 'body', size: 9.6, sx: .9, anchor: 'end' });
        for (let d = x + wa * sx / .9 + 3; d < x + w - bx - 3; d += 3.3) s += `<rect x="${d.toFixed(1)}" y="${(by - .8).toFixed(1)}" width=".8" height=".8" fill="${INK}"/>`;
        return s;
      },
    });
  }
  if (note) { out.push(space(3)); out.push(...para(note, w, { ...BODY, font: 'bodyI', size: 9.4, lead: 11 }, 0)); }
  return out;
}

// Pour a galley through frames. A jump line appears only when something really is cut off.
const JUMP = 21;
const heightOf = (g) => g.reduce((a, x) => a + x.h, 0);
const jumpLine = (w) => ({ h: JUMP, draw: (x, y) => rule(x + w * .28, y + 5, x + w * .72, .7) + text('Continued on GitHub', x + w / 2, y + JUMP - 3.5, { font: 'bodyB', size: 9, anchor: 'middle', sx: .9 }) });
function pour(galley, frames) {
  let s = '', i = 0;
  const marks = [];
  const jump = heightOf(galley) > frames.reduce((a, f) => a + f.y1 - f.y, 0);
  frames.forEach((fr, fi) => {
    const limit = fr.y1 - (jump && fi === frames.length - 1 ? JUMP : 0);
    const placed = [];
    let y = fr.y;
    while (i < galley.length && y + galley[i].h <= limit) {
      if (galley[i].mark) marks.push({ mark: galley[i].mark, col: fr.col });
      placed.push({ slug: galley[i], y });
      y += galley[i].h;
      i++;
    }
    // Spacing out a short column: compositors fed extra lead between slugs.
    const slack = limit - y;
    const between = Math.min(slack / Math.max(placed.length, 1), .8);
    placed.forEach((p, k) => { s += p.slug.draw(fr.x, p.y + between * k); });
    fr.short = slack - between * placed.length;
  });
  const left = galley.length - i;
  if (jump) { const fr = frames.at(-1); s += jumpLine(fr.w).draw(fr.x, fr.y1 - JUMP); }
  return { s, left, marks };
}
// Cuts a galley to a height, for a story with something else set below it in the same column.
function clip(g, w, h) {
  if (heightOf(g) <= h) return g;
  const out = [];
  let y = 0;
  for (const x of g) {
    if (y + x.h > h - JUMP) break;
    out.push(x);
    y += x.h;
  }
  out.push(space(h - JUMP - y), jumpLine(w));
  return out;
}
const frame = (x, w, y, y1, col) => ({ x, w, y, y1, col });

async function fetchStats() {
  if (process.env.PROFILE_RAW) return JSON.parse(readFileSync(process.env.PROFILE_RAW, 'utf8'));
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is required');
  // The token can read private repositories, so every query below stays on PUBLIC ones.
  // Only the contribution calendar, an aggregate, counts private work.
  const query = `query($l:String!,$s:GitTimestamp!){user(login:$l){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}
    repositories(first:100,ownerAffiliations:OWNER,privacy:PUBLIC,isFork:false,orderBy:{field:PUSHED_AT,direction:DESC}){totalCount nodes{name url pushedAt stargazerCount createdAt primaryLanguage{name}
      releases(first:5,orderBy:{field:CREATED_AT,direction:DESC}){nodes{tagName publishedAt isDraft isPrerelease}}
      defaultBranchRef{target{... on Commit{total:history{totalCount} recent:history(first:100,since:$s){nodes{messageHeadline committedDate author{user{login}}}}}}}
      languages(first:12,orderBy:{field:SIZE,direction:DESC}){edges{size node{name}}}}}}}`;
  const since = new Date(Date.now() - 40 * 864e5).toISOString();
  const res = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { Authorization: `bearer ${token}`, 'User-Agent': 'profile-graphics' }, body: JSON.stringify({ query, variables: { l: LOGIN, s: since } }) });
  const json = await res.json();
  if (json.errors || !json.data?.user) throw new Error(JSON.stringify(json.errors ?? json));
  writeFileSync(join(build, 'raw.json'), JSON.stringify(json.data.user));
  return json.data.user;
}
function streaks(days) {
  let longest = 0, run = 0;
  for (const d of days) { run = d.contributionCount ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0, i = days.length - 1;
  if (!days[i].contributionCount) i--; // today's work may not have started yet
  for (; i >= 0 && days[i].contributionCount; i--) current++;
  return { longest, current };
}

const u = await fetchStats();
const cal = u.contributionsCollection.contributionCalendar;
const days = cal.weeks.flatMap((w) => w.contributionDays);
const { longest, current } = streaks(days);
const stars = u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0);
const repos = u.repositories.totalCount;
const repo = Object.fromEntries(u.repositories.nodes.map((r) => [r.name, r]));
const commitsOf = (n) => repo[n]?.defaultBranchRef?.target?.total?.totalCount ?? 0;
const NOT_CODE = new Set(['HTML', 'TeX', 'CSS', 'SCSS', 'Dockerfile', 'CMake', 'Makefile', 'Batchfile', 'Shell', 'PowerShell', 'Inno Setup', 'Ruby', 'Objective-C']);
const bytes = new Map();
for (const r of u.repositories.nodes) for (const e of r.languages.edges) {
  if (!NOT_CODE.has(e.node.name)) bytes.set(e.node.name, (bytes.get(e.node.name) ?? 0) + e.size);
}
const allBytes = [...bytes.values()].reduce((a, b) => a + b, 0);
const topLangs = [...bytes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
const pct = (b) => `${Math.round((b / allBytes) * 100)}%`;

const stack = [
  ['TypeScript', si.siTypescript], ['JavaScript', si.siJavascript], ['Python', si.siPython], ['C++', si.siCplusplus], ['C#', si.siDotnet], ['Go', si.siGo],
  ['Rust', si.siRust], ['Kotlin', si.siKotlin], ['Dart', si.siDart], ['HTML5', si.siHtml5], ['Next.js', si.siNextdotjs], ['Svelte', si.siSvelte],
  ['Tailwind CSS', si.siTailwindcss], ['Node.js', si.siNodedotjs], ['Flutter', si.siFlutter], ['Figma', si.siFigma], ['Docker', si.siDocker], ['Windows Terminal', { path: 'M2 4h20v16H2V4zm2 2v12h16V6H4zm2.7 2.3 3.7 3.7-3.7 3.7-1.4-1.4L7.6 12 5.3 9.7l1.4-1.4zM12 14.5h6v2h-6v-2z' }],
];

const now = process.env.PROFILE_NOW ? new Date(process.env.PROFILE_NOW) : new Date();
const zone = { timeZone: 'Asia/Krasnoyarsk' };
const dateLine = new Intl.DateTimeFormat('en-US', { ...zone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now).toUpperCase();
const year = Number(new Intl.DateTimeFormat('en-US', { ...zone, year: 'numeric' }).format(now));
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const vol = ROMAN[year - FIRST_YEAR] ?? String(year - FIRST_YEAR + 1);
const total = cal.totalContributions.toLocaleString('en-US');
const daysOf = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
const weeks = cal.weeks.map((w) => w.contributionDays.reduce((a, d) => a + d.contributionCount, 0));
const weekDates = cal.weeks.map((w) => w.contributionDays[0].date);
const peak = Math.max(...weeks);
const MON = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const stamp = (iso) => `${MON[new Date(iso).getUTCMonth()]} ${new Date(iso).getUTCDate()}`;
const peakDate = stamp(weekDates[weeks.indexOf(peak)]);
const shortDate = new Intl.DateTimeFormat('en-US', { ...zone, month: 'numeric' }).format(now) && `${MON[Number(new Intl.DateTimeFormat('en-US', { ...zone, month: 'numeric' }).format(now)) - 1]} ${new Intl.DateTimeFormat('en-US', { ...zone, day: 'numeric' }).format(now)}`;
const months = new Map();
for (const d of days) { const k = d.date.slice(0, 7); months.set(k, (months.get(k) ?? 0) + d.contributionCount); }
const ledger = [...months.entries()].slice(-12).map(([k, v]) => [`${MON[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`, v.toLocaleString('en-US')]);
const SHORT = { 'NEX-Neural-Execution-Language': 'NEX Language', 'Airport-Security-Lib-ASL': 'Airport Security Lib', 'ultimate-anti-ai-ui-slop': 'Anti-AI UI Slop', 'Radomir-Aksenenko': 'This Profile', 'ObsidianVPN-App': 'Obsidian App', ObsidianVPN: 'Obsidian VPN', code_to_redstone: 'code_to_redstone', 'tank-priborka': 'TANK Priborka', 'fluent-transfer': 'Fluent Transfer', 'audio-normalizer': 'Audio Normalizer' };
const nameOf = (n) => SHORT[n] ?? n;
const repoRows = u.repositories.nodes.slice().sort((a, b) => commitsOf(b.name) - commitsOf(a.name)).map((r) => [nameOf(r.name), String(commitsOf(r.name))]);
const opened = u.repositories.nodes.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => [nameOf(r.name), `${MON[Number(r.createdAt.slice(5, 7)) - 1]} ${r.createdAt.slice(0, 4)}`]);
const newest = u.repositories.nodes.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
const langs = [...new Set(u.repositories.nodes.map((r) => r.primaryLanguage?.name).filter((l) => l && !NOT_CODE.has(l)))];
const listed = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
const plural = (n, one, many = one + (one === one.toUpperCase() ? 'S' : 's')) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// ---- The news desk. No model writes here: a fact is measured, and a fixed rule picks its words. ----
const AGE = (iso) => (now - new Date(iso)) / 864e5;
const canSet = (t) => [...t].every((c) => fonts.body.charToGlyphIndex(c) > 0);
// A commit subject in print: no type prefix, no GitHub ellipsis, and only if the type can set it.
function subject(line) {
  let t = line.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '').replace(/[“”]/g, '"').trim();
  if (t.endsWith('…')) { t = t.slice(0, -1); t = t.slice(0, Math.max(t.lastIndexOf(','), t.lastIndexOf(' '))).trim(); }
  t = t.replace(/[,;:]$/, '');
  return t.length >= 8 && canSet(t) ? t : null;
}
const log = u.repositories.nodes.flatMap((r) => (r.name === LOGIN ? [] : (r.defaultBranchRef?.target?.recent?.nodes ?? []).map((c) => ({ repo: r.name, date: c.committedDate, line: c.messageHeadline, who: c.author?.user?.login ?? '' }))))
  .filter((c) => !c.who.includes('[bot]') && !/^chore\(stats\)/.test(c.line) && AGE(c.date) >= 0)
  .sort((a, b) => b.date.localeCompare(a.date));
const inDays = (d) => log.filter((c) => AGE(c.date) <= d);
const tally = (list) => [...list.reduce((m, c) => m.set(c.repo, (m.get(c.repo) ?? 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1]);
const week = inDays(7), month = inDays(30);
const busy = tally(week);
const sum = (a) => a.reduce((x, d) => x + d.contributionCount, 0);
const last7 = sum(days.slice(-7)), prev7 = sum(days.slice(-14, -7));
const avgWeek = Math.round(cal.totalContributions / 52);
const yesterday = days.at(-2)?.contributionCount ?? 0;
const released = u.repositories.nodes.flatMap((r) => r.releases.nodes.filter((x) => !x.isDraft && !x.isPrerelease && x.publishedAt).map((x) => ({ repo: r.name, tag: x.tagName, date: x.publishedAt })))
  .filter((x) => canSet(x.tag)).sort((a, b) => b.date.localeCompare(a.date));
const STATE = join(here, 'edition.json');
const before = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null;
// A weekly paper since the account opened, so the number is the count of weeks.
const weekNo = Math.floor((now - new Date('2022-10-03T00:00:00Z')) / (7 * 864e5));
// News runs once. A rerun inside the same week prints the same front page.
const ran = before?.ran ?? [];
const unprinted = (key) => !ran.some((r) => r.key === key && r.week !== weekNo);
const releaseKey = (x) => `release:${x.repo}:${x.tag}`;
const freshRelease = released[0] && AGE(released[0].date) <= 14 && unprinted(releaseKey(released[0])) ? released[0] : null;
const freshRepo = AGE(newest.createdAt) <= 30 && newest.name !== LOGIN && unprinted(`repo:${newest.name}`) ? newest : null;
const starGain = before ? stars - before.stars : 0;
const delta = prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : 0;
const CAP = (n) => nameOf(n).toUpperCase();

function pickLead() {
  const led = busy[0];
  const count = led ? `${plural(led[1], 'commit')} in ${nameOf(led[0])}` : '';
  if (freshRelease) {
    const c = week.filter((x) => x.repo === freshRelease.repo).length;
    return { key: releaseKey(freshRelease), head: [CAP(freshRelease.repo), 'GOES OUT AS', freshRelease.tag.toUpperCase()], deck: ['New Release Heads the Week', `With ${plural(week.length, 'Public Commit')}`, `and ${plural(last7, 'Contribution')} in All`], banner: `${CAP(freshRelease.repo)} ${freshRelease.tag.toUpperCase()} GOES OUT TO USERS`, line: `${nameOf(freshRelease.repo)} went out as ${freshRelease.tag} on ${stamp(freshRelease.date)}${c ? `, with ${plural(c, 'commit')} on the branch in the past seven days` : ''}.` };
  }
  if (freshRepo) return { key: `repo:${freshRepo.name}`, head: ['NEW PROJECT', 'OPENS ON', 'GITHUB'], deck: [nameOf(freshRepo.name), `Appeared on ${stamp(freshRepo.createdAt)};`, `${plural(repos, 'Repository', 'Repositories')} Now Public`], banner: `${CAP(freshRepo.name)} OPENS TO THE PUBLIC`, line: `A new public repository, ${nameOf(freshRepo.name)}, opened on ${stamp(freshRepo.createdAt)}.` };
  if (last7 >= peak && last7 > 0) return { head: ['WEEK BREAKS', 'THE YEAR\'S', 'RECORD'], deck: [`${plural(last7, 'Contribution')} in`, 'Seven Days, the Most', 'Since the Count Began'], banner: `RECORD WEEK BRINGS ${plural(last7, 'CONTRIBUTION')}`, line: `No week in the past year brought more.` };
  if (delta >= 40 && last7 >= avgWeek) return { head: ['WORK RISES', `${delta}% ON THE`, 'WEEK BEFORE'], deck: [`${plural(last7, 'Contribution')}`, `Against ${prev7} Last Week;`, `${led ? `${nameOf(led[0])} Leads` : 'Private Work Leads'}`], banner: `WEEK'S WORK UP ${delta}%${led ? `, LED BY ${CAP(led[0])}` : ''}`, line: count ? `The largest share of the public work was ${count}.` : '' };
  if (led && led[1] >= 5) return { head: [CAP(led[0]), `TAKES ${led[1]}`, 'COMMITS'], deck: ['Most Active Project of', `the Week; ${plural(last7, 'Contribution')}`, 'Counted Across the Account'], banner: `${led[1]} COMMITS IN A WEEK GO TO ${CAP(led[0])}`, line: `The week's public work went mostly into ${nameOf(led[0])}, with ${plural(led[1], 'commit')}.` };
  if (current >= 7) return { head: [`${current}-DAY RUN`, 'GOES ON', 'UNBROKEN'], deck: ['No Day Without a', `Contribution; Record for`, `the Year Stands at ${longest}`], banner: `${current}-DAY RUN OF WORK CONTINUES UNBROKEN`, line: `Not a day has passed without a contribution in ${current} days.` };
  if (last7 < avgWeek * .4) return { head: ['A QUIETER', 'WEEK IN THE', 'WORKSHOP'], deck: [`${plural(last7, 'Contribution')}`, `Against a Weekly Mean`, `of ${avgWeek} This Year`], banner: `QUIET WEEK: ${plural(last7, 'CONTRIBUTION')} ON THE BOOKS`, line: '' };
  return { head: ['A DESIGNER', 'WHO WRITES', 'THE CODE'], deck: ['Radomir Draws the Page,', 'Then Builds It; Week in', 'Figures Printed Here'], banner: `${plural(repos, 'REPOSITORY', 'REPOSITORIES')} NOW OPEN ON GITHUB`, line: count ? `The largest share of the public work was ${count}.` : '' };
}
const lead = pickLead();
const compare = !prev7 ? 'after a blank week' : last7 === prev7 ? `the same as the week before` : `${last7 > prev7 ? 'up from' : 'down from'} ${prev7} the week before`;
const meanWord = last7 >= avgWeek * 1.15 ? 'above' : last7 <= avgWeek * .85 ? 'below' : 'near';
const latest = week.map((c) => ({ ...c, say: subject(c.line) })).find((c) => c.say);

const W = 1200, H = 1644, L = 22, R = W - 22, G = 12, CW = (R - L - 7 * G) / 8;
const colX = (i) => L + i * (CW + G);
const span = (n) => n * CW + (n - 1) * G;
const FOOT = H - 22;
let s = '';

// Ears and nameplate.
const ear = (x, lines) => {
  let e = box(x, 16, 150, 74);
  lines.forEach((t, i) => { e += fit(t.s, x + 6, t.y, 138, t.f, t.z); });
  return e;
};
s += ear(L, [{ s: '"All the Commits', f: 'cheltBI', z: 15.5, y: 41 }, { s: 'That Are Fit', f: 'cheltBI', z: 15.5, y: 58 }, { s: 'to Push"', f: 'cheltBI', z: 15.5, y: 75 }]);
s += ear(R - 150, [{ s: 'LATE CITY EDITION', f: 'cheltB', z: 13.5, y: 36 }, { s: `Yesterday, ${plural(yesterday, 'contribution')};`, f: 'body', z: 9.6, y: 52 }, { s: `current run, ${daysOf(current)};`, f: 'body', z: 9.6, y: 65 }, { s: `longest, ${daysOf(longest)}. Stars, ${stars}.`, f: 'body', z: 9.6, y: 78 }]);
s += fit('The Radomir Times', L + 164, 90, R - L - 328, 'mark', 104, { minSx: 1 });
s += text(`Copyright, ${year}, by Radomir Aksenenko.`, W / 2, 110, { font: 'bodyI', size: 8.4, anchor: 'middle' });
s += text('Entered as Public Matter at', L, 104, { font: 'body', size: 7.4 }) + text(`github.com/${LOGIN}`, L, 113, { font: 'body', size: 7.4 });

// Dateline.
const issue = weekNo.toLocaleString('en-US');
s += rule(L, 118, R, .8) + rule(L, 120.6, R, .8);
s += text(`VOL. ${vol} . . . No. ${issue}`, L + 2, 133, { font: 'cheltB', size: 11.5 });
s += text(`KRASNOYARSK, ${dateLine}`, W / 2, 133, { font: 'cheltB', size: 11.5, anchor: 'middle' });
s += text(`${plural(repos, 'PUBLIC REPOSITORY', 'PUBLIC REPOSITORIES')}`, R - 2, 133, { font: 'cheltB', size: 11.5, anchor: 'end' });
s += rule(L, 139, R, 1.8);

// Banner: Cheltenham Bold Italic in three decks, set to the full measure like June 6, 1944.
const banner = ['RADOMIR, DESIGNER AND FRONT-END DEVELOPER,', `FILES ${total} CONTRIBUTIONS IN A YEAR;`, lead.banner];
const fitsAt = (b) => (R - L) / widthOf(b, 'cheltBI', 1);
const bz = Math.min(...banner.map(fitsAt));
function setDeck(str, x, y, w, font, z) {
  const words = str.split(' ');
  const space = widthOf(' ', font, z);
  const room = w - words.reduce((a, t) => a + widthOf(t, font, z), 0) - space * (words.length - 1);
  // A compositor opened the word spaces first and touched the letters hardly at all.
  const sp = Math.max(0, Math.min(.012, room / Math.max(1, str.length - 1) / z));
  const set = words.map((t) => widthOf(t, font, z, 1, sp));
  const gap = words.length > 1 ? (w - set.reduce((a, b) => a + b, 0)) / (words.length - 1) : Infinity;
  if (gap > space * 1.7) return text(str, x + w / 2, y, { font, size: z, sp, anchor: 'middle' });
  let out = '', cx = x;
  words.forEach((t, i) => { out += text(t, cx, y, { font, size: z, sp }); cx += set[i] + gap; });
  return out;
}
let deckY = 139 + 8;
banner.forEach((b, i) => {
  const z = Math.min(fitsAt(b), bz * 1.16);
  deckY += z + (i ? 4.5 : 0);
  s += setDeck(b, L, deckY, R - L, 'cheltBI', z);
});
const TOP = Math.round(deckY + 12);
s += rule(L, TOP, R, 1.8);
const Y0 = TOP + 7;

// The lead is written fresh from the numbers of the week.
const DL = `KRASNOYARSK, ${shortDate}.`;
const leadStory = {
  head: lead.head,
  deck: lead.deck,
  body: [
    `${DL} GitHub's ledger shows ${plural(last7, 'contribution')} for the seven days ended today, ${compare} and ${meanWord} the year's weekly mean of ${avgWeek}.${lead.line ? ` ${lead.line}` : ''}`,
    week.length ? `The public log for the week holds ${plural(week.length, 'commit')} in ${plural(busy.length, 'repository', 'repositories')}: ${listed(busy.slice(0, 4).map(([n, c]) => `${nameOf(n)} with ${c}`))}.` : (last7 ? 'The public log shows no commits for the week, so the work went into private repositories.' : 'The public log shows no commits for the week.'),
    latest ? `The most recent entry, under ${nameOf(latest.repo)} on ${stamp(latest.date)}, reads: "${latest.say}."` : '',
    `Radomir is a designer and front-end developer, the profile states. The account opened in October, 2022, and holds ${plural(repos, 'public repository', 'public repositories')}, with ${listed(langs)} as their leading languages.`,
    `GitHub credits it with ${total} contributions in the past twelve months, private work included. The heaviest week began on ${peakDate} and brought ${peak}. The longest unbroken run stands at ${daysOf(longest)}.`,
    starGain > 0 ? `Stars rose by ${starGain} since the last edition, to ${stars}.` : '',
  ].filter(Boolean),
};

// The stories. Facts below come from each repository's own README; the second paragraph is the
// repository's own log, so a story changes when the work does.
function activity(name) {
  const r = repo[name];
  if (!r) return '';
  const own = month.filter((c) => c.repo === name);
  const rel = released.find((x) => x.repo === name);
  const said = own.map((c) => subject(c.line)).find(Boolean);
  const parts = [];
  if (own.length) parts.push(`The repository took ${plural(own.length, 'commit')} in the past month${said ? `; the latest ${own.length === 1 ? 'one' : 'of them'} reads, "${said}."` : '.'}`);
  else parts.push(`Its last push came on ${stamp(r.pushedAt)}${AGE(r.pushedAt) > 300 ? `, ${new Date(r.pushedAt).getUTCFullYear()}` : ''}.`);
  if (rel) parts.push(`The current release is ${rel.tag}, out ${stamp(rel.date)}${AGE(rel.date) > 300 ? `, ${new Date(rel.date).getUTCFullYear()}` : ''}.`);
  return parts.join(' ');
}
const STORIES = [
  { repo: 'ObsidianVPN',
    head: ['VPN PROTOCOL', 'TAKES AIM AT', 'CENSORS\' FILTERS'], deck: ['Obsidian Builds a Full', 'Virtual Network Device,', 'Not a Proxy, in Go'],
    wide: { head: ['VPN Protocol Takes Aim', 'at the Censors\' Filters'], deck: ['Obsidian Builds a Full Virtual Network Device,', 'Not a Proxy, and Draws Its Headers at Random'] },
    body: [
      'Obsidian, an open layer-3 network protocol, was built to defeat deep packet inspection, active probing and state-level censors such as the TSPU system, according to its specification.',
      'Application-level proxies like VLESS, Shadowsocks and Trojan work on streams. Obsidian creates a full virtual network interface instead. Its README claims throughput above 350 megabits a second and no TCP-over-TCP slowdown for games, streaming and live calls.',
      'Fixed identifiers give most protocols away, the document argues. WireGuard marks a handshake with one byte value and its transport data with another, and a filter can block both by matching a pattern. Obsidian draws random four-byte headers from ranges and varies its padding.',
      'Traffic is sealed with ChaCha20-Poly1305. Keys are exchanged by X25519 or the post-quantum ML-KEM, and a sliding window guards against replay. The control channel replays a REALITY TLS 1.3 ClientHello, while fast data moves over UDP with port hopping, timing jitter and background noise.',
      'Android, iOS, Linux, macOS and Windows are listed as supported. The project calls its status beta and offers the code as an open specification with a reference implementation.',
    ] },
  { repo: 'ObsidianVPN-App',
    head: ['ONE APP FOR', 'FIVE SYSTEMS'], deck: ['Flutter Client Installs', 'Its Own Server Over SSH'],
    wide: { head: ['One Flutter App Serves Five', 'Systems, and Installs Its Server'], deck: ['Obsidian Client Sets Up the Go Server on an', 'Owner\'s VPS Over SSH, With a Keyserver Script'] },
    body: [
      () => `A client for Obsidian followed in a separate repository, ObsidianVPN-App, now at ${commitsOf('ObsidianVPN-App')} commits. It is one Flutter application for Windows, macOS, Linux, Android and iOS, and it can set up the Go server on an owner's own VPS over SSH, along with a small keyserver script.`,
      'The Go core is attached as a submodule. The apps are built only in GitHub Actions, where one workflow compiles for all five systems and another publishes the release.',
    ] },
  { repo: 'gitai',
    head: ['AN ISSUE GOES', 'IN, A PULL', 'REQUEST OUT'], deck: ['Gitai Runs on Its Owner\'s', 'Server; Tests, Not Models,', 'Hold the Gate'],
    wide: { head: ['An Issue Goes In, a Reviewed', 'Pull Request Comes Out'], deck: ['Gitai Runs on Its Owner\'s Server; Models', 'Write and Judge, but Tests Hold the Gate'] },
    body: [
      'A label on an issue starts the line. A strong model writes the specification that every later stage is judged against, and cheap models then work on it in parallel, each in a sandbox of its own.',
      'Next comes the gate: build, tests, lint, scope and size. "No model gets a vote here," the README says. Attempts that fail go back with precise instructions from an editor stage.',
      'Survivors get one reviewer apiece. An arbiter, again a strong model, picks a winner or sends the whole round back, and only then does a pull request reach a human.',
      'The gate is the point of the design. "A hundred iterations of models grading each other converge on code that reads well and does not run," the README says, so nothing reaches a reviewer until it compiles and the tests pass.',
      'The Rust program works against Gitea, Forgejo, GitHub and GitLab and runs whatever models its operator points it at, local ones included.',
      'The README is plain about the limits. Every stage is implemented and the loop runs end to end, it says, but it has not yet had a real repository at scale, with real models, over weeks.',
    ] },
  { repo: 'awg-fleet',
    head: ['ONE CONFIG,', 'A WHOLE FLEET'], deck: ['AmneziaWG Servers Share', 'One Domain; a Dead Node\'s', 'Clients Move Unaware'],
    wide: { head: ['One Config Serves a Whole', 'Fleet of AmneziaWG Servers'], deck: ['Nodes Share a Domain and a Keypair; a Dead', 'Node\'s Clients Move Without Noticing'] },
    body: [
      'WireGuard and AmneziaWG are point to point: a client config pins one endpoint and one server key, so a domain cannot simply be spread across servers that hold keys of their own.',
      'Awg-fleet settles it the way commercial providers do. Every node shares one server keypair and one peer list, so a client can complete its handshake with any of them.',
      'Each client is pinned to a node when created and told apart by a personal port. Whichever node DNS hands it, the fleet relays it home, and websites go on seeing one address.',
      'Placement follows measured capacity. Each node\'s cores and network speed are benchmarked when it joins and again every Monday at midnight, Krasnoyarsk time, so a gigabit box takes about ten times the clients of a 100-megabit one.',
      'Two missed probes and a dead node\'s clients are repointed at a live one, with their configs untouched. They return when the node recovers.',
      'Tunnel MTU is pinned low and every node clamps TCP MSS to the path, so large packets do not vanish behind a reseller who quietly delivers less than 1,500 bytes.',
    ] },
  { repo: 'code_to_redstone',
    head: ['COMPILER LAYS', 'THE REDSTONE'], deck: ['Logic Goes In, a Minecraft', 'Build Comes Out, Tested', 'Tick by Tick'],
    wide: { head: ['Compiler Lays the Redstone', 'So Nobody Has To'], deck: ['Logic Goes In, a Minecraft Build Comes Out,', 'Checked by a Simulator Tick by Tick'] },
    body: [
      'Nobody need lay dust, repeaters and comparators by hand any longer, the code_to_redstone README says. A circuit is described in code or as a graph of nodes, and the compiler returns a finished build as a .schem, .litematic or .mcfunction file.',
      'Placement and routing are automatic. Every structure generated in the tests goes through a simulator that follows Java Edition rules tick by tick, and the result is checked against the logical model.',
      'A small language called RSL describes a full adder in a few lines. A React editor does the same work in a browser, and an annealing search hunts for gates built without torches or repeaters.',
      'Cells come in fast and compact modes, among them an XOR made from two comparators. The router is deterministic and works in channels, with branches at y=1 and trunks at y=3.',
    ] },
  { repo: 'Airport-Security-Lib-ASL',
    head: ['AIRPORT GAME', 'GETS A MOD KIT'], deck: ['A Folder in mods/ Is All', 'That Loading Requires'],
    wide: { head: ['Airport Game Gets a Mod Kit;', 'A Folder Is All It Asks'], deck: ['ASL Turns a Bare BepInEx 6 Install Into a Platform', 'for No-Code Content, Scripts and Finished DLLs'] },
    body: [
      () => `ASL, a modding framework for Airport Security Sucks!, turns a bare BepInEx 6 install into a platform where a folder dropped in mods/ simply loads. It has ${plural(repo['Airport-Security-Lib-ASL']?.stargazerCount ?? 0, 'star')} so far.`,
      'Authors may ship no-code content, C# scripts compiled at runtime or finished DLLs, all on one API for logging, game events and hooks. The status reads early but functional, verified in the game, with the public API not yet frozen.',
      'A full networking stack is in place as well, with identity, synced state and message transport over Mirror.',
    ] },
  { repo: 'ultimate-anti-ai-ui-slop',
    head: ['DESIGN LIBRARY', 'FIGHTS THREE', 'SAME CARDS'], deck: ['Lists the Habits of Machine', 'Pages, Then Warns Against', 'Its Own Dogmas'],
    wide: { head: ['Design Library Takes On', 'the Three Identical Cards'], deck: ['Welvar Taste Craft Lists the Habits of Machine-Made', 'Pages, Then Warns Against Its Own Dogmas'] },
    body: [
      'Neon blobs, watery marketing copy and three identical cards are what the README calls first-order clichés of generated design. The library of modular skills goes after those, then after a second order: dogmatic dark tech styling, a mandatory 7:5 bento and bans on tables.',
      'Work starts from the user\'s task, the shape of the data, the brand and the accessibility floor, which the README sets at WCAG 2.1 AA with keyboard navigation, touch ergonomics and reduced motion. A twelve-point audit closes the job before release.',
      'The repository also holds Figma guidance on tokens and components, and a research pipeline for studying visual material.',
    ] },
  { repo: 'tank-priborka',
    head: ['TANK DASHBOARD', 'ONLY LISTENS'], deck: ['New Instrument Cluster', 'Writes Nothing to the Car'],
    wide: { head: ['Tank Dashboard Only Listens,', 'and Writes Nothing to the Car'], deck: ['Digital Cluster for GWM Vehicles Reads the CAN', 'Bus and Carries 825 Alarm Codes'] },
    body: [
      'TANK Priborka is a digital instrument cluster for the TANK 500, the TANK 300 and other GWM vehicles running NOBO Automotive IN9.0-OS on a Snapdragon SA8155P.',
      'It draws a 270-degree speedometer to 240 km/h, an 8,000 r.p.m. tachometer, a compass and tire pressure for each wheel. It listens to the CAN bus and FDBus and, by its own account, writes nothing to the car\'s control blocks. It also carries a catalog of more than 825 alarm codes.',
    ] },
  { repo: 'fluent-transfer',
    head: ['FILE CLIENT IN', 'WINDOWS 11 DRESS'], deck: ['SFTP, FTP and FTPS From', 'Two Panes'],
    wide: { head: ['File Client in Windows 11 Dress', 'Speaks SFTP, FTP and FTPS'], deck: ['Two Panes, Drag and Drop, and Passwords', 'Kept by Windows DPAPI'] },
    body: [
      'Fluent Transfer speaks SFTP, FTP and FTPS from two panes, local on the left and remote on the right. It keeps passwords with Windows DPAPI, runs one to four transfers at once and takes files by drag and drop.',
    ] },
  { repo: 'audio-normalizer',
    head: ['SOUND LEVELED', 'IN VIDEO FILES'], deck: ['EBU R128 Applied in', 'Batches, Folder by Folder'],
    wide: { head: ['Sound Leveled in Video Files', 'by the Broadcast Standard'], deck: ['Audio Normalizer Applies EBU R128 in Batches', 'and Can Suppress Noise With RNNoise'] },
    body: [
      'Audio Normalizer applies the EBU R128 broadcast standard to video soundtracks and can suppress noise with RNNoise. It works through folders in batches, and PyTorch can lend it a GPU.',
    ] },
];
const finish = (st) => {
  const body = st.body.map((p) => (typeof p === 'function' ? p() : p));
  const act = activity(st.repo);
  return [`${DL} ${body[0]}`, ...(act ? [act] : []), ...body.slice(1)];
};
// The news decides the order: most public commits this month first, then the latest push.
const heat = (n) => month.filter((c) => c.repo === n).length;
const ranked = STORIES.filter((st) => repo[st.repo]).sort((a, b) => heat(b.repo) - heat(a.repo) || repo[b.repo].pushedAt.localeCompare(repo[a.repo].pushedAt));
const printed = ranked.map((st) => ({ ...st, text: finish(st) }));
const briefs = {
  head: ['TWO ON THE', 'QUIET LIST'],
  style: 'league',
  special: false,
  body: [
    `DiamondDrop has the longest history in the account, at ${commitsOf('DiamondDrop')} commits. Its README names React, Next.js and Tailwind on the client, C# and .NET on the server, with Radomir on the front end and a second author on the back. The license is MIT.`,
    `The NEX Neural Execution Language, in C++, stands at ${commitsOf('NEX-Neural-Execution-Language')} commits. It has no README, and so no statement to report.`,
  ],
};
const summaryBody = [
  `${dateLine.split(', ').slice(0, 2).join(', ')}, ${year}.`,
  `The week's count stood today at ${last7}, ${compare}. For the past twelve months GitHub's figure is ${total} contributions. The current run is ${daysOf(current)}; the longest of the year, ${daysOf(longest)}.`,
  `${busy.length ? `${nameOf(busy[0][0])} was the busiest public project of the week, with ${plural(busy[0][1], 'commit')}.` : 'No public project moved this week.'} ${released[0] ? `The latest release anywhere in the account is ${nameOf(released[0].repo)} ${released[0].tag}, out ${stamp(released[0].date)}.` : ''}`,
  `${topLangs[0][0]} remains the largest language in the public code at ${pct(topLangs[0][1])}, followed by ${topLangs[1][0]} at ${pct(topLangs[1][1])} and ${topLangs[2][0]} at ${pct(topLangs[2][1])}. Markup and build files are not counted.`,
  `The longest history belongs to DiamondDrop, a Next.js and C# project made with a second author, at ${commitsOf('DiamondDrop')} commits. The newest repository, ${nameOf(newest.name)}, opened in ${MON[Number(newest.createdAt.slice(5, 7)) - 1]} ${newest.createdAt.slice(0, 4)}.`,
  `The stack as advertised runs to ${stack.length} tools, set out in the panel on this page. Correspondence is welcome at the addresses printed at the foot.`,
];

const overflow = {};
const index = [];
const place = (st, cols) => { if (!index.some(([n]) => n === nameOf(st.repo))) index.push([nameOf(st.repo), cols]); };
const run = (name, galley, frames) => {
  const r = pour(galley, frames);
  s += r.s;
  overflow[name] = { left: r.left, short: frames.map((f) => Math.round(f.short)) };
  r.marks.forEach(({ mark, col }) => place(mark, col));
};
const narrow = (st, style) => {
  const g = story(CW, { head: st.head, deck: st.deck, style: style ?? (st.head.length < 3 ? 'league' : 'latin'), body: st.text });
  g[0].mark = st;
  return g;
};
if (printed.length < 7) throw new Error(`only ${printed.length} stories have a public repository; the page needs 7`);

// Slots go to the freshest news. The coldest stories wait for a hole, and small holes take a note.
const extras = printed.slice(7);
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const byWeekday = WEEKDAY.map((_, i) => sum(days.filter((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === i)));
const bestWeekday = byWeekday.indexOf(Math.max(...byWeekday));
const [bestMonthKey, bestMonthN] = [...months.entries()].slice(-12).sort((a, b) => b[1] - a[1])[0];
const bestDay = days.reduce((a, d) => (d.contributionCount > a.contributionCount ? d : a), days[0]);
const idle = days.filter((d) => !d.contributionCount).length;
const notes = [
  `${FULL[Number(bestMonthKey.slice(5)) - 1]} was the busiest month of the past twelve, with ${plural(bestMonthN, 'contribution')}.`,
  `The heaviest single day of the year was ${stamp(bestDay.date)}, with ${plural(bestDay.contributionCount, 'contribution')}.`,
  `${WEEKDAY[bestWeekday]} has been the busiest day of the week, with ${plural(byWeekday[bestWeekday], 'contribution')} in twelve months.`,
  `The ledger shows ${plural(idle, 'day')} of the past year without a contribution.`,
  `Public repositories on the account hold ${plural(stars, 'star')} between them.`,
].map((t) => [...thin(CW), ...para(t, CW, BODY, 0)]);
function fillTo(g, cap) {
  const out = [...g];
  let room = cap - heightOf(out);
  while (room >= 165 && extras.length) {
    const piece = [...sep(CW), ...narrow(extras.shift(), 'league')];
    out.push(...piece);
    room -= heightOf(piece);
  }
  for (let i = notes.findIndex((n) => heightOf(n) <= room); room > 12 && i >= 0; i = notes.findIndex((n) => heightOf(n) <= room)) {
    const [note] = notes.splice(i, 1);
    out.push(...note);
    room -= heightOf(note);
  }
  return out;
}

// The picture, six columns wide; photo.py prints it through a halftone screen.
const PX = colX(1), PW = span(6);
s += fit('THE YEAR\'S WORK, ONE WEEK TO A TOWER', PX, Y0 + 27, PW, 'latin', 40, { minSx: .86 });
const picY = Y0 + 34, picH = Math.round(PW * 1080 / 1800);
const capY = picY + picH + 13;
const FRAME_T = 0.74 * 0.85 * weeks.length * 12.5 * 1.03 * (1040 / 934) / (1800 / 1080);
const storeys = (v) => Math.max(5, Math.round((26 + Math.sqrt(v / peak) * (FRAME_T - 26)) / 3.6));
s += text('EVERY WEEK A BUILDING.', PX, capY, { font: 'bodyB', size: 9.6, sx: .92 });
{
  const lead2 = widthOf('EVERY WEEK A BUILDING. ', 'bodyB', 9.6, .92);
  const thisWeek = weeks.at(-1);
  const cap = `Each tower across the river stands for one week of contributions, the oldest at the left and this week's at the far right, where ${thisWeek ? `${plural(thisWeek, 'contribution')} so far have raised it ${storeys(thisWeek)} stories` : 'nothing has been built yet'}. The tallest, at ${storeys(peak)} stories, went up in the week of ${peakDate}. The town is rebuilt from GitHub's figures with every edition.`;
  const st = { font: 'bodyI', size: 10, lead: 12, sx: .94 };
  setLines(cap, PW, st, lead2).forEach((l, i) => { s += drawLine(l, PX, capY + i * st.lead, PW, st); });
}
const belowY = capY + 28;
s += rule(PX, belowY, PX + PW, 1.8);

// Under the picture, three pairs of columns; the foot of the page carries three more stories.
const yFoot = 1352;
const C1 = colX(1), C2 = colX(2), C3 = colX(3), C4 = colX(4), C5 = colX(5), C6 = colX(6), W2 = span(2);
const wideHead = (st, hz) => [...centred(st.wide.head, 'cheltBI', hz, hz + 2, W2), ...dash(W2), ...centred(st.wide.deck, 'gothic', 14.8, 15, W2), ...dash(W2, 26), ...centred(['Special to The Radomir Times'], 'bodyI', 8.2, 10.5, W2)];
function wideStory(name, st, x, x2, y, y1, cols, hz = 22) {
  const gh = wideHead(st, hz);
  let gy = y;
  for (const g of gh) { s += g.draw(x, gy); gy += g.h; }
  const top = gy + 3;
  const body = fillTo(st.text.flatMap((p) => para(p, CW)), 2 * (y1 - top));
  run(name, body, [frame(x, CW, top, y1, cols.split('-')[0]), frame(x2, CW, top, y1, cols.split('-')[1])]);
  s += vrule(x2 - G / 2, top, y1 - 2);
  place(st, cols);
}
// Left pair: this month's busiest project.
wideStory('A', printed[0], C1, C2, belowY + 7, yFoot - 4, '2-3');

// Middle pair: the stack in line cuts, the summary under it.
{
  const x = C3, y = belowY + 8, ch = 26, rows = 6;
  const boxH = 30 + rows * ch + 6;
  s += box(x, y, W2, boxH, .9);
  s += fit(`THE STACK: ${stack.length} TOOLS`, x + 6, y + 24, W2 - 12, 'latin', 28, { minSx: .86 });
  s += rule(x + 6, y + 30, x + W2 - 6, .7);
  stack.forEach(([name, ic], i) => {
    const cw = (W2 - 12) / 3;
    const cx = x + 8 + (i % 3) * cw, cy = y + 34 + Math.floor(i / 3) * ch;
    s += `<path transform="translate(${cx.toFixed(1)} ${cy + 3}) scale(${15 / 24})" fill="${INK}" d="${ic.path}"/>`;
    s += text(name, cx + 19, cy + 16, { font: 'gothic', size: 15.5, sx: Math.min(1, (cw - 23) / widthOf(name, 'gothic', 15.5)) });
  });
  const sy = y + boxH + 7;
  let hy = sy;
  for (const g of centred(['The Week\'s News Summarized'], 'cheltBI', 22, 24, W2)) { s += g.draw(C3, hy); hy += g.h; }
  s += rule(C3 + W2 * .3, hy + 2, C3 + W2 * .7, .7);
  const gs = [...para(summaryBody[0], CW, { ...BODY, font: 'bodyB' }, 0), space(2), ...summaryBody.slice(1).flatMap((p) => para(p, CW))];
  run('sum', fillTo(gs, 2 * (yFoot - 4 - (hy + 7))), [frame(C3, CW, hy + 7, yFoot - 4, 4), frame(C4, CW, hy + 7, yFoot - 4, 5)]);
  s += vrule(C4 - G / 2, hy + 7, yFoot - 6);
  index.push(['Stack, The', '4-5'], ['News Summary', '4-5']);
}

// Right pair: the second story, then the wire: real commits, newest first. The wire takes up
// whatever depth the story leaves, so the two end together.
{
  const dispatches = [];
  const seen = new Map();
  for (const c of log) {
    const say = subject(c.line);
    if (!say) continue;
    const n = seen.get(c.repo) ?? 0;
    if (n >= 5) continue; // no one project gets the whole wire
    seen.set(c.repo, n + 1);
    dispatches.push({ ...c, say });
    if (dispatches.length >= 22) break;
  }
  const rowH = 11.2;
  const y0 = belowY + 7;
  const headH = heightOf(wideHead(printed[1], 22)) + 3;
  const textH = heightOf(printed[1].text.flatMap((p) => para(p, CW)));
  const depthFor = (n) => (n ? 30 + n * rowH + 6 + 8 : 0);
  // Largest wire that still leaves the story its room, but never fewer than eight rows.
  let rows = Math.min(8, dispatches.length);
  while (rows < dispatches.length && 2 * (yFoot - 4 - depthFor(rows + 1) - y0 - headH) >= textH) rows++;
  const shown = dispatches.slice(0, rows);
  const wireH = shown.length ? 30 + shown.length * rowH + 6 : 0;
  const wireY = yFoot - 4 - wireH;
  wideStory('B', printed[1], C5, C6, y0, wireY - 8, '6-7');
  if (shown.length) {
    s += rule(C5, wireY - 5, C5 + W2, 1.6);
    s += fit('OFF THE WIRE', C5, wireY + 17, W2, 'latin', 26, { minSx: .86 });
    s += rule(C5, wireY + 22, C5 + W2, .8);
    shown.forEach((d, i) => {
      const y = wireY + 33 + i * rowH;
      const when = stamp(d.date);
      const tag = `${nameOf(d.repo)}:`;
      const tw = widthOf(tag, 'bodyB', 8.8, .88);
      const ww = widthOf(when, 'body', 8.8, .88);
      const room = W2 - tw - ww - 9;
      let t = d.say;
      while (t.length > 8 && widthOf(t, 'body', 8.8, .84) > room) { const cut = t.lastIndexOf(' '); t = t.slice(0, cut > 0 ? cut : t.length - 1); }
      s += text(tag, C5, y, { font: 'bodyB', size: 8.8, sx: .88 });
      s += text(t, C5 + tw + 3, y, { font: 'body', size: 8.8, sx: .84 });
      s += text(when, C5 + W2, y, { font: 'body', size: 8.8, sx: .88, anchor: 'end' });
    });
    index.push(['Off the Wire', '6-7']);
  }
}

// The foot.
s += rule(PX, yFoot - 1, PX + PW, 1.8);
const yF = yFoot + 6;
wideStory('D', printed[3], C1, C2, yF, FOOT, '2-3', 20);
run('E', fillTo(narrow(printed[4]), FOOT - yF), [frame(C5, CW, yF, FOOT, 6)]);
run('F', fillTo(narrow(printed[5]), FOOT - yF), [frame(C6, CW, yF, FOOT, 7)]);
s += vrule(C6 - G / 2, yF, FOOT);

// Column 8: a story, then the tables of record and the quiet list.
{
  const tail = [...sep(CW), ...table(CW, 'REPOSITORIES', repoRows, 'Commits on the default branch.'), ...sep(CW), ...table(CW, 'OPENED, BY DATE', opened), ...sep(CW), ...story(CW, briefs)];
  const room = FOOT - Y0 - heightOf(tail);
  run('c7', [...fillTo(clip(narrow(printed[2]), CW, room), room), ...tail], [frame(colX(7), CW, Y0, FOOT, 8)]);
  index.push(['Opened, by Date', 8], ['Repositories', 8]);
}
// Column 1: the lead, the two tables, then a story down to the foot.
{
  const top = [...story(CW, { ...leadStory, special: false }), ...sep(CW), ...table(CW, 'THE LEDGER', ledger, 'Contributions by month, GitHub\'s own count.'), ...sep(CW), ...table(CW, 'THE PUBLIC CODE', topLangs.map(([n, v]) => [n, pct(v)])), ...sep(CW)];
  run('c0', fillTo([...top, ...narrow(printed[6])], FOOT - Y0), [frame(colX(0), CW, Y0, FOOT, 1)]);
  index.push(['Ledger, The', 1], ['Public Code, The', 1], ['Week, The', 1]);
}

// Letters to the Editor and the index, set last so the index can name what actually landed.
{
  const y = yF, lx = C3, lh = 92;
  s += box(lx, y, W2, lh, .9);
  s += fit('LETTERS TO THE EDITOR', lx + 8, y + 22, W2 - 16, 'latin', 27, { minSx: .86 });
  s += rule(lx + 8, y + 27, lx + W2 - 8, .7);
  s += text('By Telegram', lx + W2 / 2, y + 38, { font: 'bodyI', size: 8.6, anchor: 'middle' });
  s += fit('random_ak', lx + 10, y + 53, W2 - 20, 'cheltB', 15.5, { minSx: 1 });
  s += text('By Post', lx + W2 / 2, y + 66, { font: 'bodyI', size: 8.6, anchor: 'middle' });
  s += fit('amazerust@mail.ru', lx + 10, y + 82, W2 - 20, 'cheltB', 15.5, { minSx: 1 });
  const iy = y + lh + 6;
  s += fit('INDEX TO THIS PAGE', lx, iy + 14, W2, 'league', 17, { minSx: 1 });
  s += rule(lx, iy + 18, lx + W2, .8);
  const entries = index.slice().sort((a, b) => a[0].localeCompare(b[0], 'en'));
  const half = Math.ceil(entries.length / 2);
  const step = Math.min(11.4, (FOOT - iy - 26) / half);
  entries.forEach(([n, c], i) => {
    const cx = i < half ? C3 : C4, cy = iy + 28 + (i < half ? i : i - half) * step;
    const v = `Col. ${c}`;
    const vw = widthOf(v, 'body', 8.8, .88);
    s += text(n, cx, cy, { font: 'body', size: 8.8, sx: Math.min(.88, .88 * (CW - vw - 5) / widthOf(n, 'body', 8.8, .88)) });
    s += text(v, cx + CW, cy, { font: 'body', size: 8.8, sx: .88, anchor: 'end' });
  });
}

// Column rules run from the banner to the trim; the inner ones start under the picture.
for (const i of [1, 7]) s += vrule(colX(i) - G / 2, Y0 - 2, FOOT);
for (const i of [3, 5]) s += vrule(colX(i) - G / 2, belowY + 2, FOOT);

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
const raster = (name, source, w, h, width) => {
  writeFileSync(join(build, `${name}.svg`), source);
  const r = new Resvg(source, { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)', font: { loadSystemFonts: false } });
  writeFileSync(join(build, `${name}.png`), r.render().asPng());
};
const MASK_W = 3400;
raster('page', svg(W, H, s), W, H, MASK_W);

// Contacts are separate clippings, so each can be a real link.
const clipping = (name, title, handle) => {
  const cw = 575, ch = 128;
  let c = rule(26, 22, cw - 26, 1.8) + rule(26, 25.5, cw - 26, .7);
  c += text(title, cw / 2, 52, { font: 'latin', size: 30, anchor: 'middle' });
  c += fit(handle, 36, 92, cw - 72, 'cheltB', 40, { minSx: 1 });
  c += rule(26, ch - 22, cw - 26, .7);
  raster(name, svg(cw, ch, c), cw, ch, 2300);
};
clipping('telegram', 'WRITE TO THE EDITOR BY TELEGRAM', 'random_ak');
clipping('email', 'WRITE TO THE EDITOR BY POST', 'amazerust@mail.ru');

const label = `The Radomir Times, a newspaper front page. Radomir is a designer and front-end developer. ${total} contributions in the past year, ${last7} in the past week, current streak ${daysOf(current)}, longest ${daysOf(longest)}, ${stars} stars, ${repos} public repositories. The picture is a city in which each tower is one week of contributions. Stack: ${stack.map(([n]) => n).join(', ')}. Contacts: Telegram random_ak, email amazerust@mail.ru.`;
writeFileSync(join(build, 'layout.json'), JSON.stringify({ width: W, height: H, bodyFrom: Y0 / H, picture: { x: PX, y: picY, w: PW, h: picH }, weeks, weekDates, label, peakDate }, null, 1));
const ranNext = (lead.key ? [...ran.filter((r) => r.key !== lead.key), { key: lead.key, week: weekNo }] : ran).slice(-12);
writeFileSync(STATE, `${JSON.stringify({ stars, repos, total: cal.totalContributions, ran: ranNext }, null, 1)}\n`);

// The README around the picture: links the page can only print, and the edition as real text.
const linkOf = (n) => `[${nameOf(n)}](${repo[n].url})`;
const onWire = [...new Set([...printed.map((st) => st.repo), ...log.map((c) => c.repo)])].filter((n) => repo[n]);
const plain = (t) => t.replace(/[<>]/g, '');
const edition = [
  `### ${plain(lead.head.join(' ')).replace(/\s+/g, ' ')}`, '',
  ...leadStory.body.map(plain).flatMap((p) => [p, '']),
  ...printed.flatMap((st) => [`### [${plain(st.wide.head.join(' '))}](${repo[st.repo].url})`, '', ...st.text.map(plain).flatMap((p) => [p, ''])]),
];
const readme = `<div align="center">

<img src="assets/page.webp" width="100%" alt="${label.replace(/"/g, '&quot;')}">

<a href="https://t.me/random_ak"><img src="assets/telegram.webp" width="47%" alt="By Telegram: random_ak"></a>
<a href="mailto:amazerust@mail.ru"><img src="assets/email.webp" width="47%" alt="By post: amazerust@mail.ru"></a>

<sub><b>Continued on GitHub:</b> ${onWire.map(linkOf).join(' &nbsp;·&nbsp; ')}</sub>

</div>

<details>
<summary><sub>Read this edition as text</sub></summary>

${edition.join('\n')}
</details>
`;
writeFileSync(join(here, '..', 'README.md'), readme);
console.log('overflow', JSON.stringify(overflow));
console.log('printed', dateLine, `VOL. ${vol} No. ${issue}`, total, 'week', last7, 'prev', prev7, 'commits', week.length, current, longest, stars, repos, peak, peakDate, 'lead', lead.banner, 'bz', bz.toFixed(1), 'top', TOP, 'picH', picH, 'below', belowY);
console.log('order', printed.map((st) => st.repo).join(' > '));
console.log('index', index.map(([n, c]) => `${n}:${c}`).join(', '), '| unused', extras.map((st) => st.repo).join(','), '| notes left', notes.length);
