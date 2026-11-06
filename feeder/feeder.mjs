// X TV feeder: keeps Adam's X home timeline fresh for the X TV wallpaper.
//
// X refuses headless browsers, so this runs ONE normal Edge window with its own
// profile (never his everyday browser), parks it off-screen, and re-reads x.com/home
// about every 10 minutes. The wallpaper never goes online: it only reads the files
// this writes to wallpaper/feed/ (feed.json + avatars/photos in img/).
//
//   node feeder.mjs            run in the background (Task Scheduler starts this at logon)
//   node feeder.mjs --once     one read, then exit (testing)
//   node feeder.mjs --visible  leave the window where it is (debugging)
//
// First run: the window comes on screen at X's login page until Adam logs in.
// Closing the Edge window stops the feed until the next logon (the TV says "paused").

import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(HERE, 'profile');
const OUT = resolve(HERE, '..', 'wallpaper', 'feed');
const IMG = join(OUT, 'img');
const FEED = join(OUT, 'feed.json');
const LOG = join(HERE, 'feeder.log');
const PIPE = '\\\\.\\pipe\\x-tv-feeder';

// Never faster than every 5 minutes, whatever the setting says.
const INTERVAL_MS = Math.max(5, Number(process.env.XTV_INTERVAL_MIN) || 10) * 60_000;
const JITTER_MS = 2 * 60_000; // +/- so reads are not on an exact clock
const READ_TIMEOUT_MS = 3 * 60_000; // a frozen tab gets replaced after this
const MAX_POSTS = 40;
const MAX_SCROLLS = 14;

const args = new Set(process.argv.slice(2));
const ONCE = args.has('--once');
const VISIBLE = args.has('--visible');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  process.stdout.write(line);
  try {
    if (existsSync(LOG) && statSync(LOG).size > 200_000) {
      const old = await fs.readFile(LOG, 'utf8');
      await fs.writeFile(LOG, old.slice(-100_000));
    }
    await fs.appendFile(LOG, line);
  } catch {}
}

// ---------- single instance ----------
// A named pipe: Windows frees it the moment the process dies, so a crash, logoff or
// End Task can never leave a stale lock behind.
function takeLock() {
  return new Promise((ok) => {
    const server = createServer();
    server.once('error', () => ok(false));
    server.listen(PIPE, () => ok(true));
  });
}

// ---------- files ----------
async function replaceFile(tmp, dest) {
  // The wallpaper (or Defender) may hold the old file for a moment; keep trying ~5 s.
  for (let i = 0, wait = 100; ; i++, wait = Math.min(wait * 2, 1000)) {
    try { await fs.rename(tmp, dest); return; } catch (e) {
      if (i >= 9) { await fs.unlink(tmp).catch(() => {}); throw e; }
      await sleep(wait);
    }
  }
}

async function readOldFeed() {
  try { return JSON.parse(await fs.readFile(FEED, 'utf8')); } catch { return null; }
}

async function writeFeed(feed) {
  await fs.mkdir(OUT, { recursive: true });
  const tmp = FEED + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(feed, null, 1));
  await replaceFile(tmp, FEED);
}

// Keep the old posts when something goes wrong, so the TV keeps scrolling.
async function writeStatus(status, detail) {
  const old = await readOldFeed();
  await writeFeed({
    status,
    detail: detail || '',
    checked: new Date().toISOString(),
    updated: old?.updated || null,
    posts: old?.posts || [],
  });
}

// ---------- reading the page ----------
// Runs inside the X page. Reads every post card currently in the DOM.
function extractPosts() {
  const flat = (el) => {
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) s += n.textContent;
      else if (n.tagName === 'IMG') s += n.alt || '';
      else if (n.tagName === 'BR') s += '\n';
      else s += flat(n);
    }
    return s;
  };
  // First match that belongs to this post, not to a post it quotes
  // (a quoted post sits inside a div[role="link"] within the article).
  const own = (a, sel) => {
    for (const el of a.querySelectorAll(sel)) {
      const q = el.closest('div[role="link"]');
      if (!q || !a.contains(q)) return el;
    }
    return null;
  };
  const num = (a, ids) => {
    for (const id of ids) {
      const el = own(a, `[data-testid="${id}"]`);
      if (el) return (el.innerText || '').trim();
    }
    return '';
  };
  const out = [];
  for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
    const timeEl = own(a, 'time');
    const link = timeEl && timeEl.closest('a[href*="/status/"]');
    if (!link) continue; // ads have no timestamp link
    const href = link.getAttribute('href');
    const id = (href.split('/status/')[1] || '').split(/[/?]/)[0];
    if (!id) continue;
    let name = '', handle = '';
    const un = own(a, '[data-testid="User-Name"]');
    if (un) {
      const bits = [...un.querySelectorAll('span')].map(s => flat(s).trim()).filter(Boolean);
      name = bits[0] || '';
      handle = bits.find(t => t.startsWith('@')) || '';
    }
    const textEl = own(a, '[data-testid="tweetText"]');
    const photoImg = own(a, '[data-testid="tweetPhoto"] img');
    const video = own(a, '[data-testid="videoPlayer"] video, [data-testid="tweetPhoto"] video');
    out.push({
      id,
      url: 'https://x.com' + href,
      name,
      handle,
      verified: !!own(a, '[data-testid="icon-verified"]'),
      time: timeEl.getAttribute('datetime'),
      social: (a.querySelector('[data-testid="socialContext"]')?.innerText || '').trim(),
      text: textEl ? flat(textEl).trim() : '',
      avatarUrl: own(a, '[data-testid="Tweet-User-Avatar"] img')?.src || '',
      photoUrl: photoImg?.src || video?.poster || '',
      isVideo: !!video,
      replies: num(a, ['reply']),
      reposts: num(a, ['retweet', 'unretweet']),
      likes: num(a, ['like', 'unlike']),
      views: (own(a, 'a[href$="/analytics"]')?.innerText || '').trim(),
    });
  }
  return out;
}

async function saveImage(context, url, kind) {
  if (!url) return '';
  let u = url;
  if (kind === 'avatar') u = u.replace('_normal.', '_bigger.');
  if (kind === 'photo' && u.includes('pbs.twimg.com/media/')) {
    const x = new URL(u);
    x.searchParams.set('name', 'small');
    u = x.toString();
  }
  const name = createHash('sha1').update(u).digest('hex').slice(0, 16) + '.jpg';
  const file = join(IMG, name);
  if (existsSync(file) && statSync(file).size > 0) return 'img/' + name;
  try {
    const res = await context.request.get(u, { timeout: 15_000 });
    if (!res.ok()) return '';
    const body = await res.body();
    if (!body.length) return '';
    // Write then swap, so a half-written image is never mistaken for a finished one.
    await fs.writeFile(file + '.tmp', body);
    await replaceFile(file + '.tmp', file);
    return 'img/' + name;
  } catch {
    return '';
  }
}

// ---------- the Edge window ----------
let context, page, cdp, windowId, closed = false;

// Use the first tab, and replace it if it was closed or crashed.
async function ensurePage() {
  if (page && !page.isClosed() && !page.__crashed) return page;
  if (page && !page.isClosed()) await page.close().catch(() => {});
  page = context.pages().find(p => !p.isClosed()) || await context.newPage();
  page.on('crash', () => { page.__crashed = true; });
  cdp = null;
  return page;
}

// 'park' = off-screen but still "visible" to Chromium. A minimized window counts as
// hidden, and X's list stops loading more posts and images while hidden.
async function setWindow(state) {
  if (VISIBLE && state === 'park') return;
  try {
    if (!cdp) {
      cdp = await context.newCDPSession(page);
      ({ windowId } = await cdp.send('Browser.getWindowForTarget'));
    }
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    const bounds = state === 'park'
      ? { left: -4000, top: 0, width: 700, height: 1100 }
      : { left: 120, top: 60, width: 700, height: 1000 };
    await cdp.send('Browser.setWindowBounds', { windowId, bounds });
  } catch (e) {
    cdp = null;
    await log('window: could not ' + state + ': ' + e.message);
  }
}

// Logged in = X's session cookie is in this profile.
async function loggedIn() {
  const cookies = await context.cookies('https://x.com').catch(() => []);
  return cookies.some(c => c.name === 'auth_token' && c.value);
}

async function goHome() {
  if (!(await loggedIn())) return 'login';
  try {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (e) {
    // Redirects abort the first navigation; anything else we judge by what's on the page.
    await log('read: navigation said ' + e.message.split('\n')[0]);
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (closed) throw new Error('window closed');
    if (await page.$('article[data-testid="tweet"]')) return 'ok';
    if (!(await loggedIn())) return 'login';
    await sleep(500);
  }
  return 'timeout';
}

async function waitForLogin() {
  await log('login: waiting for Adam to log in in the Edge window');
  await writeStatus('logged-out', 'Log in to X in the Edge window');
  await setWindow('show');
  await page.bringToFront().catch(() => {});
  await page.goto('https://x.com/login').catch(() => {});
  while (!closed && !(await loggedIn())) {
    await sleep(1500);
    if (!closed && page.isClosed()) { // he closed the tab but not the window
      await ensurePage();
      await page.goto('https://x.com/login').catch(() => {});
    }
  }
  if (closed) throw new Error('window closed');
  await log('login: done');
  await sleep(4000); // let X finish its own redirect to /home
}

async function readTimeline() {
  await ensurePage();
  let state = await goHome();
  if (state === 'login') {
    await waitForLogin();
    state = await goHome();
  }
  if (state !== 'ok') {
    await writeStatus('error', 'Timeline did not load');
    await log('read: timeline did not load (' + state + ', ' + page.url() + ')');
    return;
  }
  await setWindow('park');

  const seen = new Map();
  for (let i = 0; i < MAX_SCROLLS && seen.size < MAX_POSTS; i++) {
    for (const p of await page.evaluate(extractPosts)) {
      if (!seen.has(p.id)) seen.set(p.id, p);
    }
    await page.evaluate(() => window.scrollBy(0, 1400));
    await sleep(1300);
  }
  const posts = [...seen.values()].slice(0, MAX_POSTS);
  if (posts.length === 0) {
    await writeStatus('error', 'No posts found');
    await log('read: page loaded but no posts were read');
    return;
  }

  await fs.mkdir(IMG, { recursive: true });
  let avatars = 0;
  for (const p of posts) {
    p.avatar = await saveImage(context, p.avatarUrl, 'avatar');
    p.photo = await saveImage(context, p.photoUrl, 'photo');
    if (p.avatar) avatars++;
    delete p.avatarUrl;
    delete p.photoUrl;
  }
  const now = new Date().toISOString();
  await writeFeed({ status: 'ok', detail: '', checked: now, updated: now, posts });

  // Drop images no post points at any more.
  const keep = new Set(posts.flatMap(p => [p.avatar, p.photo]).filter(Boolean).map(s => s.slice(4)));
  for (const f of await fs.readdir(IMG)) {
    if (!keep.has(f)) await fs.unlink(join(IMG, f)).catch(() => {});
  }
  await log(`read: saved ${posts.length} posts (${avatars} avatars)`);
}

// A frozen tab must not stall the loop forever: give up, replace the tab, carry on.
async function readWithWatchdog() {
  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('read took over 3 min')), READ_TIMEOUT_MS);
  });
  try {
    await Promise.race([readTimeline(), watchdog]);
  } catch (e) {
    if (/over 3 min/.test(e.message) && page && !page.isClosed()) {
      page.__crashed = true; // ensurePage() swaps it for a fresh tab next time
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (!(await takeLock())) { await log('skip: already running'); process.exit(0); }
  context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'msedge',
    headless: false,
    viewport: null,
    args: [
      '--window-size=700,1100',
      // Keep the page working while its window is off-screen or covered.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-features=CalculateNativeWinOcclusion',
    ],
  });
  context.on('close', () => { closed = true; });
  await ensurePage();
  await log('start: Edge open, reading about every ' + INTERVAL_MS / 60_000 + ' min');

  while (!closed) {
    try {
      await readWithWatchdog();
    } catch (e) {
      if (closed) break;
      await log('error: ' + (e?.stack || e));
      await writeStatus('error', String(e?.message || e).split('\n')[0].slice(0, 120)).catch(() => {});
    }
    if (ONCE) break;
    const wait = INTERVAL_MS + (Math.random() * 2 - 1) * JITTER_MS;
    for (let t = 0; t < wait && !closed; t += 1000) await sleep(1000);
  }

  if (closed) {
    await log('stop: the Edge window was closed');
    await writeStatus('paused', 'Feed paused (Edge window closed)');
  } else {
    await context.close().catch(() => {});
  }
  process.exit(0);
}

main().catch(async (e) => {
  await log('fatal: ' + (e?.stack || e));
  await writeStatus('error', String(e?.message || e).split('\n')[0].slice(0, 120)).catch(() => {});
  process.exit(1);
});
