# moho

**Every conversation you're in, in one window.**
<img width="1545" height="912" alt="showcase-screenshot" src="https://github.com/user-attachments/assets/b9dabddb-bb3c-4a71-b872-9ad167ecd400" />

moho is a desktop chat client that speaks IRC, Discord, Matrix, Kick, Sneedchat, Steam and many more protocols at the
same time. Whether the room is a twenty-year-old IRC channel, a Discord server, an encrypted Matrix room, or a
stream's chat going past at forty lines a minute you're able to be part of the conversation.

## What it does

- **Many networks, one place.** IRC, Discord, Matrix, Kick, Sneedchat, Steam and many more protocols soon, side by side, with
  the same reply, edit, react, search and tag-someone gestures on each — as far as each
  service actually supports them.
- **Calls.** Voice, camera and screen sharing on Discord and on Matrix, voice rooms and calls on Steam, including the group
  calls Element holds on a media server. On Discord, Go Live, streams both ways with sound,
  echo cancellation, volume per person, the soundboard and stage channels. A call can sit in
  the corner or pop out into a window of its own.
- **Matrix, properly encrypted.** End-to-end encryption with device verification by emoji or
  QR, cross-signing, key backup, and encrypted attachments.
- **Kick streams in the window.** Watch the stream beside its chat, in the corner or in a
  window of its own, polls, predictions and other interactive methods are functional and at your fingertips. 
- **Yours.** GPL-3.0, no telemetry, no account with us — your history is a SQLite file on
  your own disk.

## Supported protocols

| Protocol | State | What you get |
| --- | --- | --- |
| **IRC** | Supported | Channels and queries on any number of networks, with SASL, TLS, DCC file transfers and the IRCv3 capabilities servers offer |
| **Matrix** | Supported | Rooms, spaces and direct messages, end-to-end encryption with device verification and key backup, Element Call, and signing in by QR code |
| **Discord** | Supported | Servers, direct messages, forums and threads, voice, video, screen sharing and Go Live with end-to-end encryption, stages and the soundboard |
| **Kick** | Supported | A streamer's chat beside the stream, with polls, predictions and its events drawn as cards |
| **Sneedchat** | Supported | The forum's chat rooms, over clearnet or Tor |
| **Steam** | Supported, fully ported | Friends and direct messages, group chats with rooms, roles and invitations, voice rooms and calls, emoticons, stickers, reactions, pictures and files, friend folders, and signing in by password or by QR code |

Every protocol gets the same window, mentions inbox, search and per-account Tor or SOCKS5 routing.
How much of each service's own feature set a protocol has is as far as its service lets a
third-party client go; more protocols are planned.

## Get it

Prebuilt Linux and Windows downloads are on the
[latest release](https://github.com/Moho-Chat/moho/releases/latest); what each version
changed is in [CHANGELOG.md](CHANGELOG.md). moho tells you in its mentions inbox when a newer
version is out.

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
