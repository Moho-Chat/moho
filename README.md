# moho

**Every conversation you're in, in one window.**
<img width="1545" height="912" alt="showcase-screenshot" src="https://github.com/user-attachments/assets/b9dabddb-bb3c-4a71-b872-9ad167ecd400" />

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
  spoilers, code blocks, inline images and video, GIFs, YouTube cards, and custom emoji. There
  are two roomier modes if you prefer one: Comfy, with avatars, and Bubbles.
- **Made for being open all day.** A quick switcher on Ctrl+K, a tray with the number waiting
  and your status, Do not disturb that really silences everything, idle detection, and
  conversations that open where you stopped reading rather than a thousand messages back.
- **It stays connected.** The daemon keeps IRC registered, Matrix syncing and Tor circuits
  open while the window is shut. Quitting says a proper goodbye rather than dropping the
  socket, so you don't come back to a ghosted nick.
- **Calls.** Voice, camera and screen sharing on Discord and on Matrix, including the group
  calls Element holds on a media server. On Discord, Go Live streams both ways with sound,
  echo cancellation, volume per person, the soundboard and stage channels. A call can sit in
  the corner or pop out into a window of its own.
- **Matrix, properly encrypted.** End-to-end encryption with device verification by emoji or
  QR, cross-signing, key backup, and encrypted attachments.
- **Sneedchat, and Tor where you want it.** The site's proof-of-work gate and its login
  captcha both handled, and every room you've joined connected at once. Any account on any of
  the five can go through an embedded Tor client or a SOCKS5 proxy instead of the open internet.
- **Kick streams in the window.** Watch the stream beside its chat, in the corner or in a
  window of its own, with VODs, clips, 7TV and BTTV emotes, polls and predictions.
- **No captchas on Discord, on purpose.** Discord puts joining a server, adding a friend and
  making a server behind a captcha when they come from anything but its own client, and
  answering one gets an account flagged for spam. moho opens discord.com for those three
  instead of putting your account at risk.
- **Yours.** GPL-3.0, no telemetry, no account with us — your history is a SQLite file on
  your own disk.

## Get it

Prebuilt Linux and Windows downloads are on the
[latest release](https://github.com/Moho-Chat/moho/releases/latest); what each version
changed is in [CHANGELOG.md](CHANGELOG.md). moho tells you in its mentions inbox when a newer
version is out.

Versions are MAJOR.FEATURE.FIX: a major release, then protocols added and major features,
then bug and security fixes - 1.1.0 would add a protocol, 1.0.5 is the fifth fix release
of 1.0.

The AppImage needs `libfuse2` on recent distributions; if it refuses to start, either install
that or run it with `APPIMAGE_EXTRACT_AND_RUN=1`.

The Windows installer is not code-signed, and won't be. Two things in Windows react to that:

- **SmartScreen** warns when you run the downloaded installer. Choose *More info*, then
  *Run anyway* - or beforehand, right-click the file, open *Properties* and tick *Unblock*.
- **Smart App Control**, on some fresh Windows 11 installs, silently refuses to start any
  unsigned program: moho installs, then never opens. Turn it off in *Windows Security > App
  & browser control > Smart App Control settings*. Windows does not let it be switched back
  on without resetting the PC. The installer checks for this and says so before installing.

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

## Test it

```bash
npm test            # the window's unit tests (Vitest)
npm run test:ui     # layout checks against the real app - popups must stay inside the window
npm run test:tray   # the tray: its icon, tooltip, menu, statuses and restart
npm run test:gif    # GIFs drawn as pictures, and the GIF picker
npm run test:scroll # scrolling and where a conversation opens
npm run test:kick   # where Kick event cards sit in each layout
cd nobilis && cargo test --release
```

The `test:` scripts other than `test` build the window, run it against a scratch home and a
fake IRC server, and need the daemon built first. On a machine with no display, run them under
`xvfb-run`. `npm run shots` photographs the interface scene by scene, for looking at changes.

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
directory to run in place, `npm run pack:deb` for a Debian package, `npm run pack:win` for the
Windows installer (cross-built with mingw-w64; packaging it also needs wine with 32-bit
support), and `makepkg -si` against the bundled `PKGBUILD` to install it as an Arch package
under `/opt/moho`.

Packaging leaves a lot behind - an AppImage per build, and Rust build output that Cargo never
cleans up. `npm run deploy` first runs `npm run tidy`, which keeps the newest two AppImages and
empties `nobilis/target/` once it passes 8 GB.

---

Architecture, the daemon's wire protocol, what each backend actually implements, and where
state lives on disk: [ARCHITECTURE.md](ARCHITECTURE.md).
