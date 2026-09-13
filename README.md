# moho

**Every conversation you're in, in one window.**

moho is a desktop chat client that speaks IRC, Discord, Matrix, Kick and Sneedchat at the
same time. One buffer list down the side, one log in the middle, one set of habits — whether
the room is a twenty-year-old IRC channel, a Discord server, an encrypted Matrix room, or a
stream's chat going past at forty lines a minute.

It isn't five web apps in a trenchcoat. Underneath sits a small Rust daemon that holds the
connections; the window is just what draws them. Close it and you stay connected. Open it
again and everything is where you left it.

## What it does

- **Five networks, one place.** IRC, Discord, Matrix, Kick and Sneedchat, side by side, with
  the same reply, edit, react, search and tag-someone gestures on each — as far as each
  service actually supports them.
- **A log, not a feed.** Compact IRC-style scrollback with nick colours, markdown and BBCode,
  spoilers, code blocks, inline images and video, and custom emoji. There's a roomier mode
  with avatars if you prefer one.
- **It stays connected.** The daemon keeps IRC registered, Matrix syncing and Tor circuits
  open while the window is shut. Quitting says a proper goodbye rather than dropping the
  socket, so you don't come back to a ghosted nick.
- **Calls.** Real audio on Discord and on Matrix, including the group calls Element holds
  on a media server. On Matrix the camera and the screen both work, and either can be turned
  on part-way through a call. Discord is voice only for now.
- **Matrix, properly encrypted.** End-to-end encryption with device verification by emoji or
  QR, cross-signing, key backup, and encrypted attachments.
- **Sneedchat over Tor.** An embedded Tor client, the site's proof-of-work gate and its login
  captcha both handled, and every room you've joined connected at once.
- **The awkward bits, in-app.** Where Discord demands a captcha to add a friend or join a
  server, it opens in a moho window instead of sending you to a browser.
- **Yours.** GPL-3.0, no telemetry, no account with us — your history is a SQLite file on
  your own disk.

## Get it

Prebuilt Linux and Windows downloads are on the
[latest release](https://github.com/Moho-Chat/moho/releases/tag/latest), rebuilt from `master`
on every change.

The AppImage needs `libfuse2` on recent distributions; if it refuses to start, either install
that or run it with `APPIMAGE_EXTRACT_AND_RUN=1`. The Windows installer is unsigned and
cross-built, so SmartScreen will warn on first run.

## Build it

You'll need Rust, Node, git, and — for the daemon — `cmake`, `pkg-config` and the ALSA
headers (`alsa-lib` on Arch, `libasound2-dev` on Debian).

```bash
git clone --recurse-submodules https://github.com/Moho-Chat/moho.git
cd moho
npm install
npm run daemon    # cargo build --release in nobilis/ — this is the long one
```

If npm says install scripts were blocked, approve the two that fetch platform binaries;
without them there is no Electron to run:

```bash
npm install-scripts approve electron esbuild
```

## Run it

```bash
npm run dev       # hot-reloading renderer, Electron, and the daemon
```

To install it like a real application — builds everything, packages an AppImage, drops it in
`~/.local/bin` and writes a launcher entry, after which moho is in your application menu:

```bash
npm run deploy
```

Other ways out of the box: `npm run pack:dir` for a self-contained `dist/linux-unpacked/`
directory to run in place, `npm run pack:win` for the Windows installer (cross-built with
mingw-w64; packaging it also needs wine with 32-bit support), and `makepkg -si` against the
bundled `PKGBUILD` to install it as an Arch package under `/opt/moho`.

---

Architecture, the daemon's wire protocol, what each backend actually implements, and where
state lives on disk: [ARCHITECTURE.md](ARCHITECTURE.md).
