// X TV: draws Adam's X timeline onto the TV screen and scrolls it.
//
// Reads feed/feed.json (written by ../feeder/feeder.mjs) every 30 s. Offline only:
// avatars and photos are local files in feed/img/. index.html maps this canvas onto
// the TV glass and calls xtvDraw(now) once per rendered frame.
//
// The TV model's glass only shows canvas rows from 24.26% down (its UVs run
// v = 0.2426..1 with flipY off), on a 4:3 screen, so everything is drawn below VIS_Y.

var canvasFeed = document.createElement("canvas");
canvasFeed.width = canvasFeed.height = 800;

var xtv = (function () {
  const W = 800, H = 800;
  // Measured on the model at the default camera: the bezel hides the first rows of the
  // UV area, the last ~35 rows, ~30 px on the left and ~50 px on the right.
  const VIS_Y = 228; // first fully visible row
  const VIS_B = 762; // last visible row
  const PAD = 34; // left safe margin
  const PAD_R = 56; // right safe margin (the TV is turned, so the right edge hides more)
  const HEADER = 62;
  const FOOTER = 50;
  const PHOTO_H = 260;
  const SPEED = 42; // canvas px per second
  const POLL_MS = 30000;
  const FONT = '"Segoe UI", "Segoe UI Emoji", "Segoe UI Symbol", Arial, sans-serif';

  const C = {
    bg: "#000000",
    text: "#e7e9ea",
    gray: "#8b9096",
    line: "#2f3336",
    blue: "#1d9bf0",
    amber: "#ffb340",
    red: "#f4212e",
  };

  const params = new URLSearchParams(location.search);
  const FEED_URL = params.get("feed") || "feed/feed.json";
  const IMG_BASE = FEED_URL.replace(/[^/]*$/, ""); // image paths are relative to feed.json

  const ctx = canvasFeed.getContext("2d");
  let feed = null; // last feed.json
  let layout = []; // [{post, y, h, lines, ...}]
  let total = 0; // height of one pass through the list
  let scroll = 0;
  let lastNow = 0;
  let fade = 1; // 0..1, used to cross over to a new feed
  let pendingFeed = null;
  let loadError = false;
  const images = new Map();

  // ---------- data ----------
  function img(path) {
    if (!path) return null;
    let im = images.get(path);
    if (im && im.failedAt && Date.now() - im.failedAt > 60000) im = null; // try a failed one again
    if (!im) {
      im = new Image();
      im.onerror = function () { this.failedAt = Date.now(); };
      im.src = IMG_BASE + path;
      images.set(path, im);
    }
    return im.complete && im.naturalWidth ? im : null;
  }

  async function poll() {
    try {
      const res = await fetch(FEED_URL + (FEED_URL.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const next = await res.json();
      loadError = false;
      if (!feed) {
        feed = next;
        build();
      } else if (next.updated !== feed.updated) {
        pendingFeed = next; // swap at the bottom of a fade
      } else {
        feed.status = next.status;
        feed.detail = next.detail;
        feed.checked = next.checked;
      }
    } catch (e) {
      loadError = true;
    }
  }

  // ---------- layout ----------
  const font = (size, weight) => `${weight || 400} ${size}px ${FONT}`;
  const TEXT_X = PAD + 64 + 16;
  const TEXT_W = W - TEXT_X - PAD_R;

  function wrap(text, maxW, maxLines) {
    ctx.font = font(29);
    const lines = [];
    const paras = text.replace(/\n{3,}/g, "\n\n").split("\n");
    for (const para of paras) {
      if (!para.trim()) {
        if (lines.length && lines[lines.length - 1] !== "") lines.push("");
        continue;
      }
      let line = "";
      for (const word of para.split(" ")) {
        const test = line ? line + " " + word : word;
        if (ctx.measureText(test).width <= maxW) {
          line = test;
          continue;
        }
        if (line) lines.push(line);
        line = "";
        // A word wider than the column (long links): break it by character.
        let piece = "";
        for (const ch of Array.from(word)) {
          if (ctx.measureText(piece + ch).width > maxW) {
            lines.push(piece);
            piece = ch;
          } else piece += ch;
        }
        line = piece;
      }
      if (line) lines.push(line);
    }
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (lines.length > maxLines) {
      lines.length = maxLines;
      let last = lines[maxLines - 1];
      while (last && ctx.measureText(last + "…").width > maxW) last = Array.from(last).slice(0, -1).join("");
      lines[maxLines - 1] = last + "…";
    }
    return lines;
  }

  function build() {
    layout = [];
    let y = 0;
    for (const post of (feed && feed.posts) || []) {
      const item = { post, y };
      let h = 22;
      if (post.social) h += 32;
      item.headY = h;
      h += 40; // name row
      item.lines = post.text ? wrap(post.text, TEXT_W, 9) : [];
      item.textY = h;
      h += item.lines.length * 38;
      if (post.photo) {
        item.photoY = h + 10;
        h += 10 + PHOTO_H;
      }
      item.statsY = h + 14;
      h += 14 + 34 + 18;
      item.h = Math.max(h, 22 + (post.social ? 32 : 0) + 64 + 24);
      y += item.h;
      layout.push(item);
      img(post.avatar);
      img(post.photo);
    }
    total = y;
    scroll = 0;
    // Forget images the new feed no longer uses, so a 24/7 wallpaper doesn't pile them up.
    const used = new Set(layout.flatMap(it => [it.post.avatar, it.post.photo]).filter(Boolean));
    for (const key of images.keys()) if (!used.has(key)) images.delete(key);
  }

  // ---------- drawing helpers ----------
  function ago(iso) {
    if (!iso) return "";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function fitText(text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = Array.from(text);
    while (t.length && ctx.measureText(t.join("") + "…").width > maxW) t.pop();
    return t.join("") + "…";
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function badge(x, y) {
    ctx.fillStyle = C.blue;
    ctx.beginPath();
    ctx.arc(x + 11, y + 11, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 11.5);
    ctx.lineTo(x + 9.5, y + 15);
    ctx.lineTo(x + 16, y + 7.5);
    ctx.stroke();
  }

  // 22x22 line icons drawn at (x, y) top-left.
  function statIcon(kind, x, y) {
    ctx.save();
    ctx.strokeStyle = C.gray;
    ctx.fillStyle = C.gray;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.beginPath();
    if (kind === "reply") {
      roundRect(x + 1, y + 2, 20, 15, 7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 6, y + 16);
      ctx.lineTo(x + 4, y + 22);
      ctx.lineTo(x + 11, y + 17);
      ctx.stroke();
    } else if (kind === "repost") {
      ctx.moveTo(x + 4, y + 15); ctx.lineTo(x + 4, y + 5); ctx.lineTo(x + 16, y + 5);
      ctx.moveTo(x + 1, y + 8); ctx.lineTo(x + 4, y + 4); ctx.lineTo(x + 7, y + 8);
      ctx.moveTo(x + 18, y + 7); ctx.lineTo(x + 18, y + 17); ctx.lineTo(x + 6, y + 17);
      ctx.moveTo(x + 15, y + 14); ctx.lineTo(x + 18, y + 18); ctx.lineTo(x + 21, y + 14);
      ctx.stroke();
    } else if (kind === "like") {
      ctx.moveTo(x + 11, y + 20);
      ctx.bezierCurveTo(x - 4, y + 10, x + 3, y - 1, x + 11, y + 6);
      ctx.bezierCurveTo(x + 19, y - 1, x + 26, y + 10, x + 11, y + 20);
      ctx.stroke();
    } else {
      ctx.fillRect(x + 2, y + 11, 3.5, 10);
      ctx.fillRect(x + 9, y + 3, 3.5, 18);
      ctx.fillRect(x + 16, y + 8, 3.5, 13);
    }
    ctx.restore();
  }

  function drawPost(item, top) {
    const p = item.post;
    let y = top + 22;
    if (p.social) {
      ctx.font = font(23, 600);
      ctx.fillStyle = C.gray;
      ctx.fillText(fitText("⟳  " + p.social, TEXT_W + 40), TEXT_X - 40, y + 22);
      y += 32;
    }
    // avatar
    const av = img(p.avatar);
    ctx.save();
    ctx.beginPath();
    ctx.arc(PAD + 32, y + 32, 32, 0, Math.PI * 2);
    ctx.clip();
    if (av) ctx.drawImage(av, PAD, y, 64, 64);
    else {
      ctx.fillStyle = "#333639";
      ctx.fillRect(PAD, y, 64, 64);
    }
    ctx.restore();

    // name · @handle · 3h
    ctx.textBaseline = "alphabetic";
    let x = TEXT_X;
    ctx.font = font(28, 700);
    ctx.fillStyle = C.text;
    const name = fitText(p.name || p.handle || "", TEXT_W * 0.55);
    ctx.fillText(name, x, y + 29);
    x += ctx.measureText(name).width + 6;
    if (p.verified) {
      badge(x, y + 9);
      x += 28;
    }
    ctx.font = font(25);
    ctx.fillStyle = C.gray;
    const when = ago(p.time);
    const meta = fitText((p.handle || "") + (when ? " · " + when : ""), W - PAD_R - x - 4);
    ctx.fillText(meta, x + 4, y + 29);

    // text
    ctx.font = font(29);
    ctx.fillStyle = C.text;
    let ty = top + item.textY + 30;
    for (const line of item.lines) {
      ctx.fillText(line, TEXT_X, ty);
      ty += 38;
    }

    // photo
    if (p.photo) {
      const ph = img(p.photo);
      const py = top + item.photoY;
      ctx.save();
      roundRect(TEXT_X, py, TEXT_W, PHOTO_H, 18);
      ctx.clip();
      ctx.fillStyle = "#16181c";
      ctx.fillRect(TEXT_X, py, TEXT_W, PHOTO_H);
      if (ph) {
        // cover crop
        const s = Math.max(TEXT_W / ph.naturalWidth, PHOTO_H / ph.naturalHeight);
        const dw = ph.naturalWidth * s, dh = ph.naturalHeight * s;
        ctx.drawImage(ph, TEXT_X + (TEXT_W - dw) / 2, py + (PHOTO_H - dh) / 2, dw, dh);
      }
      ctx.restore();
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 2;
      roundRect(TEXT_X, py, TEXT_W, PHOTO_H, 18);
      ctx.stroke();
      if (p.isVideo) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.arc(TEXT_X + TEXT_W / 2, py + PHOTO_H / 2, 38, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(TEXT_X + TEXT_W / 2 - 12, py + PHOTO_H / 2 - 22);
        ctx.lineTo(TEXT_X + TEXT_W / 2 + 20, py + PHOTO_H / 2);
        ctx.lineTo(TEXT_X + TEXT_W / 2 - 12, py + PHOTO_H / 2 + 22);
        ctx.fill();
      }
    }

    // stats: small gray icons like X's action row
    ctx.font = font(24);
    const colW = TEXT_W / 4;
    const sy = top + item.statsY + 26;
    [["reply", p.replies], ["repost", p.reposts], ["like", p.likes], ["views", p.views]].forEach(([kind, n], i) => {
      const ix = TEXT_X + i * colW;
      statIcon(kind, ix, sy - 18);
      ctx.fillStyle = C.gray;
      if (n) ctx.fillText(n, ix + 30, sy);
    });

    // divider
    ctx.fillStyle = C.line;
    ctx.fillRect(0, top + item.h - 2, W, 2);
  }

  function drawCentered(big, small, color) {
    const mid = VIS_Y + HEADER + (VIS_B - VIS_Y - HEADER) / 2;
    ctx.textAlign = "center";
    ctx.font = font(40, 700);
    ctx.fillStyle = color || C.text;
    ctx.fillText(big, W / 2, mid - 10);
    if (small) {
      ctx.font = font(27);
      ctx.fillStyle = C.gray;
      ctx.fillText(small, W / 2, mid + 36);
    }
    ctx.textAlign = "left";
  }

  function statusLine() {
    if (loadError && !feed) return { text: "waiting for feed", color: C.gray, dot: C.gray };
    if (!feed) return { text: "", color: C.gray, dot: C.gray };
    const age = feed.updated ? ago(feed.updated) : "";
    switch (feed.status) {
      case "ok": {
        const mins = (Date.now() - new Date(feed.updated).getTime()) / 60000;
        if (mins > 30) return { text: "stale · " + age, color: C.amber, dot: C.amber };
        return { text: "LIVE · " + (age === "now" ? "just now" : age + " ago"), color: C.gray, dot: C.red, pulse: true };
      }
      case "logged-out":
        return { text: "log in to X", color: C.amber, dot: C.amber };
      case "paused":
        return { text: "paused" + (age ? " · " + age : ""), color: C.gray, dot: C.gray };
      default:
        return { text: "feed error" + (age ? " · " + age : ""), color: C.amber, dot: C.amber };
    }
  }

  function drawHeader(now) {
    const y = VIS_Y;
    ctx.fillStyle = "rgba(0,0,0,0.92)";
    ctx.fillRect(0, y, W, HEADER);
    ctx.fillStyle = C.line;
    ctx.fillRect(0, y + HEADER - 2, W, 2);

    ctx.font = font(38, 700);
    ctx.fillStyle = C.text;
    ctx.fillText("𝕏", PAD + 4, y + 44);
    ctx.font = font(28, 700);
    ctx.fillText("Home", PAD + 52, y + 41);

    const st = statusLine();
    ctx.font = font(24, 600);
    ctx.textAlign = "right";
    ctx.fillStyle = st.color;
    ctx.fillText(st.text, W - PAD_R, y + 40);
    const tw = ctx.measureText(st.text).width;
    ctx.textAlign = "left";
    if (st.text) {
      const a = st.pulse ? 0.55 + 0.45 * Math.sin(now / 400) : 1;
      ctx.globalAlpha = a;
      ctx.fillStyle = st.dot;
      ctx.beginPath();
      ctx.arc(W - PAD_R - tw - 16, y + 32, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function musicOn() {
    return typeof isSignalNotFound !== "undefined" && isSignalNotFound === false &&
      typeof songTitle !== "undefined" && songTitle;
  }

  function drawFooter(now) {
    const y = VIS_B - FOOTER;
    const col = typeof albumColor !== "undefined" ? albumColor : [225, 225, 225];
    ctx.fillStyle = "rgba(0,0,0,0.88)";
    ctx.fillRect(0, y, W, FOOTER);
    ctx.fillStyle = `rgb(${col.join(",")})`;
    ctx.fillRect(0, y, W, 2);
    ctx.font = font(24, 600);
    const label = "♪  " + songTitle + (typeof songArtist !== "undefined" && songArtist ? "  —  " + songArtist : "");
    const lw = ctx.measureText(label).width;
    const room = W * 0.66 - PAD; // the visualizer bars sit on the right
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD, y, room, FOOTER);
    ctx.clip();
    let x = PAD;
    if (lw > room) {
      // marquee for long titles
      const span = lw + 80;
      x = PAD - ((now / 1000) * 40) % span;
      ctx.fillText(label, x + span, y + 34);
    }
    ctx.fillText(label, x, y + 34);
    ctx.restore();
  }

  // CRT glass: scanlines + vignette, built once.
  const glass = document.createElement("canvas");
  glass.width = W;
  glass.height = H;
  (function () {
    const g = glass.getContext("2d");
    g.fillStyle = "rgba(0,0,0,0.16)";
    for (let y = VIS_Y - 20; y < H; y += 3) g.fillRect(0, y, W, 1);
    const cx = (PAD + W - PAD_R) / 2, cy = (VIS_Y + VIS_B) / 2;
    const v = g.createRadialGradient(cx, cy, (VIS_B - VIS_Y) * 0.4, cx, cy, W * 0.6);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.5)");
    g.fillStyle = v;
    g.fillRect(0, VIS_Y - 20, W, H - VIS_Y + 20);
  })();

  // ---------- frame ----------
  function draw(now) {
    const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.1) : 0;
    lastNow = now;

    // Cross over to a fresh feed: fade out, swap, fade in.
    if (pendingFeed) {
      fade = Math.max(0, fade - dt * 2.5);
      if (fade === 0) {
        feed = pendingFeed;
        pendingFeed = null;
        build();
      }
    } else if (fade < 1) fade = Math.min(1, fade + dt * 2.5);

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    const music = musicOn();
    const listTop = VIS_Y + HEADER;
    const listBottom = music ? VIS_B - FOOTER : VIS_B;
    const viewH = listBottom - listTop;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.rect(0, listTop, W, viewH);
    ctx.clip();
    if (layout.length) {
      if (total > viewH) scroll = (scroll + SPEED * dt) % total;
      else scroll = 0;
      // Draw the list twice so the end runs straight into the start again.
      for (const pass of total > viewH ? [0, total] : [0]) {
        for (const item of layout) {
          const top = listTop + item.y + pass - scroll;
          if (top > listBottom || top + item.h < listTop) continue;
          drawPost(item, top);
        }
      }
    } else if (feed && feed.status === "logged-out") {
      drawCentered("Log in to X", "An Edge window is open for it", C.amber);
    } else if (feed && feed.detail) {
      drawCentered("No posts yet", feed.detail, C.amber);
    } else {
      drawCentered("X TV", "Waiting for the feed…");
    }
    ctx.restore();

    drawHeader(now);
    if (music) drawFooter(now);
    ctx.drawImage(glass, 0, 0);
  }

  poll();
  setInterval(poll, POLL_MS);

  return { draw, VIS_Y, VIS_B, FOOTER, reload: poll, state: () => ({ feed, total, scroll, posts: layout.length }) };
})();

function xtvDraw(now) {
  xtv.draw(now);
}
