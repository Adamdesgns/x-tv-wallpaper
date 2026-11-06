# X TV

A Lively Wallpaper: the **Music TV** scene (a 3D CRT TV, by rocksdanister, MIT) with Adam's **X home
timeline scrolling on the TV screen**. When music plays, a now-playing strip with the visualizer bars
sits along the bottom of the screen.

## How it works

```
feeder/feeder.mjs  --(every 10 min)-->  wallpaper/feed/feed.json + feed/img/*.jpg  --(every 30 s)-->  wallpaper/feed.js  -->  TV screen
```

- **The wallpaper never goes online.** It only reads `wallpaper/feed/`. Lively serves the wallpaper
  folder from its own private address, so `fetch('feed/feed.json')` works there.
- **The feeder** is a small Node script (`playwright-core`) that drives Microsoft Edge with its **own
  profile** (`feeder/profile/`, never Adam's everyday browser). X refuses headless browsers, so it opens
  one normal Edge window, minimizes it, and re-reads `x.com/home` every 10 minutes (about 40 posts:
  text, names, avatars, the first photo or video poster, counts). Ads are skipped.
- **First run:** the Edge window stays open on X's login page. Log in there once; it minimizes itself and
  the TV fills up within a minute.
- **Off switch:** close that Edge window. The TV keeps the last posts and says "paused". It starts again
  at the next logon, or with `Start X TV feed.cmd`.

## Files

| Path | What |
|---|---|
| `wallpaper/index.html` | Music TV, with the "X TV" changes marked in comments (screen texture, no "no signal" video, smaller visualizer) |
| `wallpaper/feed.js` | Lays out and scrolls the feed on an 800x800 canvas mapped onto the TV glass |
| `wallpaper/dev/sample.json` | Made-up posts for testing: open the page with `?feed=dev/sample.json` |
| `feeder/feeder.mjs` | The timeline reader (see the comment at the top for flags) |
| `feeder/start-hidden.vbs` | Starts the feeder with no console window |
| `Start X TV feed.cmd` | Start the feeder by hand |
| `install-autostart.ps1` | Task Scheduler task "X TV Feed" at logon (`-Remove` undoes it) |

Lively's library entry is `%LOCALAPPDATA%\Lively Wallpaper\Library\wallpapers\xtv.feed\LivelyInfo.json`;
it points at `wallpaper\index.html` here (the same pattern as the Bot Status wallpaper). The original
Music TV is untouched in Lively's library, so switching back is one click in Lively.

## Screen geometry (measured)

The TV model's glass uses canvas rows 24.26%..100% (`SCREEN` mesh UVs v = 0.2426..1, `flipY` off) on a
4:3 face, and the bezel hides a bit more at the default camera. Safe drawing area on the 800x800 canvas:
rows 228..762, columns 34..744 (`VIS_Y`, `VIS_B`, `PAD`, `PAD_R` in `feed.js`).

## Knobs

- Scroll speed: `SPEED` in `feed.js` (canvas px per second).
- Refresh rate: `XTV_INTERVAL_MIN` environment variable for the feeder (default 10).
- TV size and angle: Lively's Customise panel (Vertical, Horizontal, Zoom sliders).

## Caveat

X's terms discourage automated reading. This reads only Adam's own home timeline, from his own login,
six times an hour, in a normal Edge window, which is about how often a person checks it. Still not zero
risk; turning it off is closing the Edge window and `install-autostart.ps1 -Remove`.
