// Sets the front page of The Radomir Times as a pure ink mask, the way the Times
// made up its 1940s pages: eight narrow columns, stacked decks, one big picture,
// columns that simply stop on a jump line at the foot. photo.py prints the mask
// on newsprint and photographs it. Every story comes from the project's own README.
// Run: npm ci && pip install -r requirements.txt && GH_TOKEN=... npm run build
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const BODY = { font: 'body', size: 10.9, lead: 12.7, sx: .9 };
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

// Pour a galley through frames. Whatever overflows the last frame is cut by the jump line.
const JUMP = 21;
function pour(galley, frames, { jump = true } = {}) {
  let s = '', i = 0, words = 0;
  frames.forEach((fr, fi) => {
    const limit = fr.y1 - (jump && fi === frames.length - 1 ? JUMP : 0);
    const placed = [];
    let y = fr.y;
    while (i < galley.length && y + galley[i].h <= limit) { placed.push({ slug: galley[i], y }); y += galley[i].h; i++; }
    // Spacing out a short column: compositors fed extra lead between slugs.
    const slack = limit - y;
    const between = Math.min(slack / Math.max(placed.length, 1), .55);
    placed.forEach((p, k) => { s += p.slug.draw(fr.x, p.y + between * k); });
    fr.used = y - fr.y + between * placed.length;
    fr.short = slack - between * placed.length;
  });
  const left = galley.length - i;
  if (jump) {
    const fr = frames.at(-1);
    s += rule(fr.x + fr.w * .28, fr.y1 - JUMP + 5, fr.x + fr.w * .72, .7);
    s += text('Continued on GitHub', fr.x + fr.w / 2, fr.y1 - 3.5, { font: 'bodyB', size: 9, anchor: 'middle', sx: .9 });
  }
  return { s, left, words };
}
const frame = (x, w, y, y1) => ({ x, w, y, y1 });

async function fetchStats() {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is required');
  const query = `query($l:String!){user(login:$l){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}
    repositories(first:100,ownerAffiliations:OWNER,privacy:PUBLIC,isFork:false,orderBy:{field:PUSHED_AT,direction:DESC}){totalCount nodes{name stargazerCount createdAt primaryLanguage{name} defaultBranchRef{target{... on Commit{history{totalCount}}}} languages(first:12,orderBy:{field:SIZE,direction:DESC}){edges{size node{name}}}}}}}`;
  const res = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { Authorization: `bearer ${token}`, 'User-Agent': 'profile-graphics' }, body: JSON.stringify({ query, variables: { l: LOGIN } }) });
  const json = await res.json();
  if (json.errors || !json.data?.user) throw new Error(JSON.stringify(json.errors ?? json));
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
const commitsOf = (n) => repo[n]?.defaultBranchRef?.target?.history?.totalCount ?? 0;
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

const now = new Date();
const zone = { timeZone: 'Asia/Krasnoyarsk' };
const dateLine = new Intl.DateTimeFormat('en-US', { ...zone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now).toUpperCase();
const shortDate = new Intl.DateTimeFormat('en-US', { ...zone, month: 'short', day: 'numeric' }).format(now);
const year = Number(new Intl.DateTimeFormat('en-US', { ...zone, year: 'numeric' }).format(now));
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const vol = ROMAN[year - FIRST_YEAR] ?? String(year - FIRST_YEAR + 1);
const total = cal.totalContributions.toLocaleString('en-US');
const daysOf = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
const weeks = cal.weeks.map((w) => w.contributionDays.reduce((a, d) => a + d.contributionCount, 0));
const peak = Math.max(...weeks);
const peakDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(new Date(cal.weeks[weeks.indexOf(peak)].contributionDays[0].date));
const MON = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const months = new Map();
for (const d of days) { const k = d.date.slice(0, 7); months.set(k, (months.get(k) ?? 0) + d.contributionCount); }
const ledger = [...months.entries()].slice(-12).map(([k, v]) => [`${MON[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`, v.toLocaleString('en-US')]);
const SHORT = { 'NEX-Neural-Execution-Language': 'NEX Language', 'Airport-Security-Lib-ASL': 'Airport Security Lib', 'ultimate-anti-ai-ui-slop': 'Anti-AI UI Slop', 'Radomir-Aksenenko': 'This Profile' };
const repoRows = u.repositories.nodes.slice().sort((a, b) => commitsOf(b.name) - commitsOf(a.name)).map((r) => [SHORT[r.name] ?? r.name, String(commitsOf(r.name))]);
const opened = u.repositories.nodes.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => [SHORT[r.name] ?? r.name, `${MON[Number(r.createdAt.slice(5, 7)) - 1]} ${r.createdAt.slice(0, 4)}`]);
const newest = u.repositories.nodes.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
const langs = [...new Set(u.repositories.nodes.map((r) => r.primaryLanguage?.name).filter((l) => l && !NOT_CODE.has(l)))];
const listed = (a) => `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`;

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
s += ear(R - 150, [{ s: 'LATE CITY EDITION', f: 'cheltB', z: 13.5, y: 36 }, { s: `Current streak, ${daysOf(current)};`, f: 'body', z: 10, y: 52 }, { s: `longest in the year, ${daysOf(longest)}.`, f: 'body', z: 10, y: 65 }, { s: `Stars to date, ${stars}.`, f: 'body', z: 10, y: 78 }]);
s += fit('The Radomir Times', L + 164, 90, R - L - 328, 'mark', 104, { minSx: 1 });
s += text(`Copyright, ${year}, by Radomir Aksenenko.`, W / 2, 110, { font: 'bodyI', size: 8.4, anchor: 'middle' });
s += text('Entered as Public Matter at', L, 104, { font: 'body', size: 7.4 }) + text(`github.com/${LOGIN}`, L, 113, { font: 'body', size: 7.4 });

// Dateline.
s += rule(L, 118, R, .8) + rule(L, 120.6, R, .8);
s += text(`VOL. ${vol} . . . No. ${total}`, L + 2, 133, { font: 'cheltB', size: 11.5 });
s += text(`KRASNOYARSK, ${dateLine}`, W / 2, 133, { font: 'cheltB', size: 11.5, anchor: 'middle' });
s += text(`${repos} PUBLIC REPOSITORIES`, R - 2, 133, { font: 'cheltB', size: 11.5, anchor: 'end' });
s += rule(L, 139, R, 1.8);

// Banner: Cheltenham Bold Italic in three decks, set to the full measure like June 6, 1944.
const banner = ['DESIGNER AND FRONT-END DEVELOPER', `FILES ${total} CONTRIBUTIONS IN A YEAR;`, `${repos} REPOSITORIES NOW OPEN ON GITHUB`];
const bz = Math.min(...banner.map((b) => (R - L) / widthOf(b, 'cheltBI', 1)));
banner.forEach((b, i) => {
  const extra = ((R - L) - widthOf(b, 'cheltBI', bz)) / Math.max(1, b.length - 1) / bz;
  s += text(b, L, 139 + 52 + i * (bz + 4.5), { font: 'cheltBI', size: bz, sp: extra });
});
const TOP = Math.round(139 + 52 + 2 * (bz + 4.5) + 12);
s += rule(L, TOP, R, 1.8);
const Y0 = TOP + 7;

// The stories. Facts below come from each repository's own README.
const leadStory = {
  head: ['A DESIGNER', 'WHO WRITES', 'THE CODE'],
  deck: ['Radomir Draws the Page,', 'Then Builds It; Year in', 'Figures Printed Here'],
  body: [
    `KRASNOYARSK, ${shortDate}. Radomir is a designer and front-end developer, the GitHub profile states. Much of the work is public, and this page prints what the record of that work shows, repository by repository.`,
    `The account was opened in October, 2022. It holds ${repos} public repositories, with ${listed(langs)} as their leading languages.`,
    `GitHub's ledger credits it with ${total} contributions in the past twelve months, private work included, so a good part of the year's labor cannot be read from the outside.`,
    `The heaviest week began on ${peakDate} and brought ${peak}. The longest unbroken run stands at ${daysOf(longest)}.`,
  ],
};
const obsidian = {
  head: ['VPN PROTOCOL', 'TAKES AIM AT', 'CENSORS\' FILTERS'],
  deck: ['Obsidian Builds a Full', 'Virtual Network Device,', 'Not a Proxy, in Go'],
  body: [
    'KRASNOYARSK. Obsidian, an open layer-3 network protocol, was built to defeat deep packet inspection, active probing and state-level censors such as the TSPU system, according to its specification.',
    'Application-level proxies like VLESS, Shadowsocks and Trojan work on streams. Obsidian creates a full virtual network interface instead. Its README claims throughput above 350 megabits a second and no TCP-over-TCP slowdown for games, streaming and live calls.',
    'Fixed identifiers give most protocols away, the document argues. WireGuard marks a handshake with one byte value and its transport data with another, and a filter can block both by matching a pattern. Obsidian draws random four-byte headers from ranges and varies its padding.',
    'Traffic is sealed with ChaCha20-Poly1305. Keys are exchanged by X25519 or the post-quantum ML-KEM, and a sliding window guards against replay. The control channel replays a REALITY TLS 1.3 ClientHello, while fast data moves over UDP with port hopping, timing jitter and background noise.',
    'Android, iOS, Linux, macOS and Windows are listed as supported. The project calls its status beta and offers the code as an open specification with a reference implementation.',
  ],
};
const vpnApp = {
  head: ['ONE APP FOR', 'FIVE SYSTEMS'],
  style: 'league',
  deck: ['Flutter Client Installs', 'Its Own Server Over SSH'],
  body: [
    `KRASNOYARSK. A client for Obsidian followed in a separate repository, ObsidianVPN-App, now at ${commitsOf('ObsidianVPN-App')} commits. It is one Flutter application for Windows, macOS, Linux, Android and iOS, and it can set up the Go server on an owner's own VPS over SSH, along with a small keyserver script.`,
    'The Go core is attached as a submodule. The apps are built only in GitHub Actions, where one workflow compiles for all five systems and another publishes the release.',
  ],
};
const gitai = {
  head: ['An Issue Goes In, a Reviewed', 'Pull Request Comes Out'],
  style: 'chelt',
  deck: ['Gitai Runs on Its Owner\'s Server; Models', 'Write and Judge, but Tests Hold the Gate'],
  body: [
    'KRASNOYARSK. A label on an issue starts the line. A strong model writes the specification that every later stage is judged against, and cheap models then work on it in parallel, each in a sandbox of its own.',
    'Next comes the gate: build, tests, lint, scope and size. "No model gets a vote here," the README says. Attempts that fail go back with precise instructions from an editor stage.',
    'Survivors get one reviewer apiece. An arbiter, again a strong model, picks a winner or sends the whole round back, and only then does a pull request reach a human.',
    'The gate is the point of the design. "A hundred iterations of models grading each other converge on code that reads well and does not run," the README says, so nothing reaches a reviewer until it compiles and the tests pass.',
    'The Rust program works against Gitea, Forgejo, GitHub and GitLab and runs whatever models its operator points it at, local ones included.',
    'Model judgment is saved for what a test suite cannot see: whether the change does the right thing, and whether it is worth a maintainer\'s time.',
    'The README is plain about the limits. Every stage is implemented and the loop runs end to end, it says, but it has not yet had a real repository at scale, with real models, over weeks.',
  ],
};
const fleet = {
  head: ['ONE CONFIG,', 'A WHOLE FLEET'],
  deck: ['AmneziaWG Servers Share', 'One Domain; a Dead Node\'s', 'Clients Move Unaware'],
  body: [
    'KRASNOYARSK. WireGuard and AmneziaWG are point to point: a client config pins one endpoint and one server key, so a domain cannot simply be spread across servers that hold keys of their own.',
    'Awg-fleet settles it the way commercial providers do. Every node shares one server keypair and one peer list, so a client can complete its handshake with any of them.',
    'Each client is pinned to a node when created and told apart by a personal port. Whichever node DNS hands it, the fleet relays it home, and websites go on seeing one address.',
    'Placement follows measured capacity. Each node\'s cores and network speed are benchmarked when it joins and again every Monday at midnight, Krasnoyarsk time, so a gigabit box takes about ten times the clients of a 100-megabit one.',
    'Two missed probes and a dead node\'s clients are repointed at a live one, with their configs untouched. They return when the node recovers.',
    'Tunnel MTU is pinned low and every node clamps TCP MSS to the path, so large packets do not vanish behind a reseller who quietly delivers less than 1,500 bytes. A command, client add, writes a .conf file, a QR code and a link, ready for the AmneziaWG or AmneziaVPN app.',
  ],
};
const redstone = {
  head: ['COMPILER LAYS', 'THE REDSTONE'],
  deck: ['Logic Goes In, a Minecraft', 'Build Comes Out, Tested', 'Tick by Tick'],
  body: [
    'KRASNOYARSK. Nobody need lay dust, repeaters and comparators by hand any longer, the code_to_redstone README says. A circuit is described in code or as a graph of nodes, and the compiler returns a finished build as a .schem, .litematic or .mcfunction file.',
    'Placement and routing are automatic. Every structure generated in the tests goes through a simulator that follows Java Edition rules tick by tick, and the result is checked against the logical model.',
    'A small language called RSL describes a full adder in a few lines. A React editor does the same work in a browser, and an annealing search hunts for gates built without torches or repeaters.',
    'Cells come in fast and compact modes, among them an XOR made from two comparators. The router is deterministic and works in channels, with branches at y=1 and trunks at y=3. Parametric templates cover farms, logic blocks and displays.',
  ],
};
const asl = {
  head: ['Airport Game', 'Gets a Mod Kit'],
  style: 'chelt',
  deck: ['A Folder in mods/ Is All', 'That Loading Requires'],
  body: [
    `KRASNOYARSK. ASL, a modding framework for Airport Security Sucks!, turns a bare BepInEx 6 install into a platform where a folder dropped in mods/ simply loads. It has ${repo['Airport-Security-Lib-ASL']?.stargazerCount ?? 0} stars so far.`,
    'Authors may ship no-code content, C# scripts compiled at runtime or finished DLLs, all on one API for logging, game events and hooks. The status reads early but functional, verified in the game, with the public API not yet frozen.',
    'A full networking stack is in place as well, with identity, synced state and message transport over Mirror.',
  ],
};
const taste = {
  head: ['Design Library Takes On', 'the Three Identical Cards'],
  style: 'chelt',
  deck: ['Welvar Taste Craft Lists the Habits of Machine-Made', 'Pages, Then Warns Against Its Own Dogmas'],
  body: [
    'KRASNOYARSK. Neon blobs, watery marketing copy and three identical cards are what the README calls first-order clichés of generated design. The library of modular skills goes after those, then after a second order: dogmatic dark tech styling, a mandatory 7:5 bento and bans on tables.',
    'Work starts from the user\'s task, the shape of the data, the brand and the accessibility floor, which the README sets at WCAG 2.1 AA with keyboard navigation, touch ergonomics and reduced motion. A twelve-point audit closes the job before release.',
    'The repository also holds Figma guidance on tokens and components, and a research pipeline for studying visual material.',
  ],
};
const tank = {
  head: ['TANK DASHBOARD', 'ONLY LISTENS'],
  style: 'league',
  deck: ['New Instrument Cluster', 'Writes Nothing to the Car'],
  body: [
    'KRASNOYARSK. TANK Priborka is a digital instrument cluster for the TANK 500, the TANK 300 and other GWM vehicles running NOBO Automotive IN9.0-OS on a Snapdragon SA8155P.',
    'It draws a 270-degree speedometer to 240 km/h, an 8,000 r.p.m. tachometer, a compass and tire pressure for each wheel. It listens to the CAN bus and FDBus and, by its own account, writes nothing to the car\'s control blocks. It also carries a catalog of more than 825 alarm codes.',
  ],
};
const fluent = {
  head: ['FILE CLIENT IN', 'WINDOWS 11 DRESS'],
  style: 'league',
  body: [
    'KRASNOYARSK. Fluent Transfer speaks SFTP, FTP and FTPS from two panes, local on the left and remote on the right. It keeps passwords with Windows DPAPI, runs one to four transfers at once and takes files by drag and drop.',
  ],
};
const audio = {
  head: ['SOUND LEVELED', 'IN VIDEO FILES'],
  style: 'league',
  body: [
    'KRASNOYARSK. Audio Normalizer applies the EBU R128 broadcast standard to video soundtracks and can suppress noise with RNNoise. It works through folders in batches, and PyTorch can lend it a GPU.',
  ],
};
const briefs = {
  head: ['TWO ON THE', 'QUIET LIST'],
  style: 'league',
  special: false,
  body: [
    `DiamondDrop has the longest history in the account, at ${commitsOf('DiamondDrop')} commits. Its README names React, Next.js and Tailwind on the client, C# and .NET on the server, with Radomir on the front end and a second author on the back. The license is MIT.`,
    `The NEX Neural Execution Language, in C++, stands at ${commitsOf('NEX-Neural-Execution-Language')} commits. It has no README, and so no statement to report.`,
  ],
};
const summary = {
  head: ['The Year\'s News Summarized'],
  style: 'chelt',
  special: false,
  body: [
    `${dateLine.split(', ').slice(0, 2).join(', ')}, ${year}.`,
    `GitHub's count for the past twelve months stood today at ${total} contributions. The current streak is ${daysOf(current)}; the longest of the year, ${daysOf(longest)}.`,
    `${topLangs[0][0]} remains the largest language in the public code at ${pct(topLangs[0][1])}, followed by ${topLangs[1][0]} at ${pct(topLangs[1][1])} and ${topLangs[2][0]} at ${pct(topLangs[2][1])}. Markup and build files are not counted.`,
    `The longest history belongs to DiamondDrop, a Next.js and C# project made with a second author, at ${commitsOf('DiamondDrop')} commits. The newest repository, ${newest.name}, opened in ${MON[Number(newest.createdAt.slice(5, 7)) - 1]} ${newest.createdAt.slice(0, 4)}.`,
    `The stack as advertised runs to ${stack.length} tools, set out in the panel on this page. Correspondence is welcome at the addresses printed at the foot.`,
  ],
};

let overflow = {};
const run = (name, galley, frames, opt) => { const r = pour(galley, frames, opt); s += r.s; overflow[name] = { left: r.left, short: frames.map((f) => Math.round(f.short)) }; return r; };

// Column 1: the lead, then the ledger.
const gal0 = [...story(CW, leadStory), ...sep(CW), ...table(CW, 'THE LEDGER', ledger, 'Contributions by month, GitHub\'s own count.'), ...sep(CW), ...story(CW, audio), ...thin(CW), ...story(CW, fluent), ...sep(CW), ...table(CW, 'THE PUBLIC CODE', topLangs.map(([n, v]) => [n, pct(v)]))];
run('c0', gal0, [frame(colX(0), CW, Y0, FOOT)]);
// Column 2: the VPN.
run('c1', [...story(CW, obsidian), ...sep(CW), ...story(CW, tank)], [frame(colX(1), CW, Y0, FOOT)]);
// Columns 7 and 8.
run('c6', [...story(CW, redstone), ...sep(CW), ...story(CW, asl), ...sep(CW), ...table(CW, 'OPENED, BY DATE', opened), ...sep(CW), ...story(CW, briefs)], [frame(colX(6), CW, Y0, FOOT)]);
run('c7', [...story(CW, fleet), ...sep(CW), ...table(CW, 'REPOSITORIES', repoRows, 'Commits on the default branch.'), ...sep(CW), ...story(CW, vpnApp)], [frame(colX(7), CW, Y0, FOOT)]);

// The picture, four columns wide; photo.py prints it through a halftone screen.
const PX = colX(2), PW = span(4);
s += fit('THE YEAR\'S WORK, ONE WEEK TO A TOWER', PX, Y0 + 24, PW, 'latin', 34, { minSx: .86 });
const picY = Y0 + 32, picH = 470;
const capY = picY + picH + 13;
s += text('EVERY WEEK A BUILDING.', PX, capY, { font: 'bodyB', size: 9.6, sx: .92 });
{
  const lead = widthOf('EVERY WEEK A BUILDING. ', 'bodyB', 9.6, .92);
  const cap = `The height of each tower stands for one week of contributions, from last winter at the left to this week at the right. The tallest went up in the week of ${peakDate}.`;
  const st = { font: 'bodyI', size: 10, lead: 12, sx: .94 };
  setLines(cap, PW, st, lead).forEach((l, i) => { s += drawLine(l, PX, capY + i * st.lead, PW, st); });
}
const belowY = capY + 22;
s += rule(PX, belowY, PX + PW, 1.8);

// Under the picture: two columns of story, two of stack and summary.
const yFoot = 1338;
const C2 = PX, C3 = colX(3), C4 = colX(4), C5 = colX(5), W2 = span(2);
const gh = [...centred(gitai.head, 'cheltBI', 24, 26, W2), ...dash(W2), ...centred(gitai.deck, 'gothic', 17.2, 17, W2), ...dash(W2, 26), ...centred(['Special to The Radomir Times'], 'bodyI', 8.2, 10.5, W2)];
let gy = belowY + 7;
for (const g of gh) { s += g.draw(C2, gy); gy += g.h; }
const gg = gitai.body.flatMap((p) => para(p, CW));
run('gitai', gg, [frame(C2, CW, gy + 3, yFoot - 4), frame(C3, CW, gy + 3, yFoot - 4)]);
s += vrule(C3 - G / 2, gy + 3, yFoot - 6);

// The stack: a panel of trade marks, in line cuts.
{
  const x = C4, y = belowY + 8, ch = 26, rows = 6;
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
  const head = centred(summary.head, 'cheltBI', 24, 26, W2);
  let hy = sy;
  for (const g of head) { s += g.draw(C4, hy); hy += g.h; }
  s += rule(C4 + W2 * .3, hy + 2, C4 + W2 * .7, .7);
  const gs = [...para(summary.body[0], CW, { ...BODY, font: 'bodyB' }, 0), space(2), ...summary.body.slice(1).flatMap((p) => para(p, CW))];
  run('sum', gs, [frame(C4, CW, hy + 7, yFoot - 4), frame(C5, CW, hy + 7, yFoot - 4)]);
  s += vrule(C5 - G / 2, hy + 7, yFoot - 6);
}

// The foot: a story on the left, then letters and the index, as the Times boxed them.
s += rule(PX, yFoot - 1, PX + PW, 1.8);
{
  const y = yFoot + 6;
  let ty = y;
  for (const g of [...centred(taste.head, 'cheltBI', 20, 22, W2), ...dash(W2), ...centred(taste.deck, 'gothic', 14.6, 15, W2), space(4)]) { s += g.draw(C2, ty); ty += g.h; }
  const gt = taste.body.flatMap((p) => para(p, CW));
  run('taste', gt, [frame(C2, CW, ty, FOOT), frame(C3, CW, ty, FOOT)]);
  s += vrule(C3 - G / 2, ty, FOOT);

  // Letters to the Editor: the contacts.
  const lx = C4, lh = 112;
  s += box(lx, y, W2, lh, .9);
  s += fit('LETTERS TO THE EDITOR', lx + 8, y + 23, W2 - 16, 'latin', 28, { minSx: .86 });
  s += rule(lx + 8, y + 29, lx + W2 - 8, .7);
  s += text('By Telegram', lx + W2 / 2, y + 42, { font: 'bodyI', size: 9.2, anchor: 'middle' });
  s += fit('random_ak', lx + 10, y + 59, W2 - 20, 'cheltB', 16.5, { minSx: 1 });
  s += text('By Post', lx + W2 / 2, y + 74, { font: 'bodyI', size: 9.2, anchor: 'middle' });
  s += fit('amazerust@mail.ru', lx + 10, y + 91, W2 - 20, 'cheltB', 16.5, { minSx: 1 });
  s += text('Either address will reach the editor.', lx + W2 / 2, y + 105, { font: 'body', size: 7.6, anchor: 'middle', sx: .92 });

  // Index to this page, with its real column numbers.
  const iy = y + lh + 8;
  s += fit('INDEX TO THIS PAGE', lx, iy + 15, W2, 'league', 18, { minSx: 1 });
  s += rule(lx, iy + 19, lx + W2, .8);
  const entries = [['Audio Normalizer', 1], ['awg-fleet', 8], ['Airport Security Lib', 7], ['code_to_redstone', 7], ['Fluent Transfer', 1], ['gitai', '3-4'], ['Ledger, The', 1], ['Obsidian VPN', '2, 8'], ['Opened, by Date', 7], ['Repositories', 8], ['Stack, The', '5-6'], ['TANK Priborka', 2], ['Taste Craft', '3-4']];
  const half = Math.ceil(entries.length / 2);
  entries.forEach(([n, c], i) => {
    const cx = i < half ? C4 : C5, cy = iy + 31 + (i < half ? i : i - half) * 12.6;
    const v = `Col. ${c}`;
    const vw = widthOf(v, 'body', 9.2, .9);
    s += text(n, cx, cy, { font: 'body', size: 9.2, sx: Math.min(.9, .9 * (CW - vw - 6) / widthOf(n, 'body', 9.2, .9)) });
    s += text(v, cx + CW, cy, { font: 'body', size: 9.2, sx: .9, anchor: 'end' });
  });
  // The small printer's box the Times tucked into the corner of the foot.
  const by = iy + 31 + half * 12.6 - 3;
  if (FOOT - by > 16) {
    s += box(lx + W2 * .1, by, W2 * .8, FOOT - by, .6);
    s += text('Figures are GitHub\'s own as of the date above.', lx + W2 / 2, by + (FOOT - by) / 2 + 3, { font: 'bodyI', size: 8, anchor: 'middle', sx: .92 });
  }
}

// Column rules run from the banner to the trim.
for (const i of [1, 2, 6, 7]) s += vrule(colX(i) - G / 2, Y0 - 2, FOOT);

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
const raster = (name, source, w, h, width) => {
  writeFileSync(join(build, `${name}.svg`), source);
  const r = new Resvg(source, { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)', font: { loadSystemFonts: false } });
  writeFileSync(join(build, `${name}.png`), r.render().asPng());
};
const MASK_W = 3400;
raster('page', svg(W, H, s), W, H, MASK_W);

// Contacts are separate photographs of a clipping, so each can be a real link.
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

const label = `The Radomir Times, a newspaper front page photographed on a wooden table. Radomir is a designer and front-end developer. ${total} contributions in the past year, current streak ${daysOf(current)}, longest ${daysOf(longest)}, ${stars} stars, ${repos} public repositories. Stack: ${stack.map(([n]) => n).join(', ')}. Contacts: Telegram random_ak, email amazerust@mail.ru.`;
writeFileSync(join(build, 'layout.json'), JSON.stringify({ width: W, height: H, bodyFrom: Y0 / H, picture: { x: PX, y: picY, w: PW, h: picH }, weeks, label, peakDate }, null, 1));
console.log('overflow', JSON.stringify(overflow));
console.log('printed', dateLine, `VOL. ${vol}`, total, current, longest, stars, repos, peak, peakDate, 'banner', bz.toFixed(1), 'top', TOP, 'capY', capY, 'below', belowY);
