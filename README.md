# X TV

A [Lively Wallpaper](https://www.rocksdanister.com/lively/) for Windows: a 3D CRT TV on your desktop
with **your X home timeline scrolling on its screen**. When music plays, a now-playing strip with
visualizer bars runs along the bottom of the screen.

Built on **Music TV** by rocksdanister ([audio-visualizer-wallpaper](https://github.com/rocksdanister/audio-visualizer-wallpaper), MIT).

## How it works

```
feeder/feeder.mjs  --(about every 10 min)-->  wallpaper/feed/feed.json + feed/img/*.jpg  --(every 30 s)-->  wallpaper/feed.js  -->  TV screen
```

- **The wallpaper never goes online.** It only reads `wallpaper/feed/`. Lively serves a wallpaper's
  folder from its own private address, so `fetch('feed/feed.json')` works inside Lively.
- **The feeder** is a small Node script ([playwright-core](https://playwright.dev)) that drives Microsoft
  Edge with its **own profile** (`feeder/profile/`, separate from your everyday browser). It opens one
  normal Edge window, parks it off-screen, and re-reads `x.com/home` about every 10 minutes: about 40
  posts with text, names, avatars, the first photo or video poster, and counts. Ads are skipped.
  - X refuses headless browsers, so the window is a real one. It sits off-screen rather than
    minimized, because a minimized window counts as hidden and X stops loading posts.
  - X also refuses logins from a script-driven browser. So when you're logged out, the feeder opens a
    **plain** Edge window (same profile, no script attached) on X's login page. Log in, close that
    window, and the feeder carries on, only reading from then on.
- No X API key is needed.

## Setup (Windows)

Needs [Lively Wallpaper](https://www.rocksdanister.com/lively/), [Node.js](https://nodejs.org) 18+,
and Microsoft Edge (comes with Windows).

1. Clone this repo, then install the feeder's one dependency:
   ```
   cd feeder
   npm install
   ```
2. Start the feeder: double-click `Start X TV feed.cmd`. An Edge window opens on X's login page. Log in,
   see your timeline, close the window. Within a minute `wallpaper/feed/feed.json` has your posts.
3. Add the wallpaper: in Lively, **Add Wallpaper -> Browse**, pick `wallpaper/index.html`. Point Lively at
   the file in place rather than importing the folder as a package, because Lively would copy the folder
   and then read a copy that never updates.
4. Optional, start the feeder at every logon:
   ```
   powershell -ExecutionPolicy Bypass -File install-autostart.ps1
   ```
   (`-Remove` undoes it.)

**Off switch:** close the feeder's Edge window (it's in the taskbar). The TV keeps the last posts and
shows "paused" until the feeder starts again.

## Files

| Path | What |
|---|---|
| `wallpaper/index.html` | Music TV, with every change marked "X TV" in comments (screen texture, camera framing, smaller visualizer, no "no signal" video) |
| `wallpaper/feed.js` | Lays out and scrolls the feed on an 800x800 canvas mapped onto the TV glass |
| `wallpaper/dev/sample.json` | Made-up posts for testing: serve `wallpaper/` over HTTP and open `?feed=dev/sample.json` |
| `feeder/feeder.mjs` | The timeline reader (flags: `--once`, `--visible`) |
| `feeder/start-hidden.vbs` | Starts the feeder with no console window |
| `Start X TV feed.cmd` | Start the feeder by hand |
| `install-autostart.ps1` | Task Scheduler task "X TV Feed" at logon |

## Knobs

- Scroll speed: `SPEED` in `wallpaper/feed.js` (canvas pixels per second).
- Refresh rate: `XTV_INTERVAL_MIN` environment variable for the feeder (default 10, never under 5).
- TV size and angle: Lively's Customise panel (Vertical, Horizontal, Zoom), or the camera lines marked
  "X TV" in `index.html`.

## Screen geometry

The TV model's glass uses canvas rows 24.26% to 100% (the `SCREEN` mesh's texture coordinates run
v = 0.2426 to 1, with `flipY` off) on a 4:3 face, and the bezel hides a little more. The safe drawing
area on the 800x800 canvas is rows 228 to 762 and columns 34 to 744 (`VIS_Y`, `VIS_B`, `PAD`, `PAD_R`
in `feed.js`).

## Caveat

X's terms discourage automated access. This reads only your own home timeline, from your own login,
about six times an hour, which is roughly how often a person checks it. It still isn't zero risk to
your account; use it at your own judgement. It's for personal use: don't point it at accounts that
aren't yours, and don't redistribute what it collects.

## Credits and licenses

- X TV changes and the feeder: MIT, see [LICENSE](LICENSE).
- Music TV wallpaper: MIT, Copyright (c) 2023 Rocksdanister,
  [audio-visualizer-wallpaper](https://github.com/rocksdanister/audio-visualizer-wallpaper).
- "Old TV" model by **visualdiscette**,
  [Sketchfab](https://sketchfab.com/3d-models/old-tv-3fb1a4b9d14c44abaac69fec119bf251), CC-BY-4.0.
- Colorful Studio HDRI, [Poly Haven](https://polyhaven.com/a/colorful_studio), CC0.
- [Color Thief](https://github.com/lokesh/color-thief), MIT.

Full notices are in `wallpaper/license.txt`. Not affiliated with X Corp.
