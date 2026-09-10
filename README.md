# moho

A unified desktop chat client: IRC, Discord, Sneedchat (the Tor-only chat built into Kiwi
Farms), Matrix and Kick in one window, with XMPP/Slack landing protocol by protocol without
frontend changes. The architecture is deliberately service-agnostic - the UI only ever sees a
unified account/buffer/message model, never a protocol-specific concept.

## Why two parts

- **`nobilis`** (`nobilis/`, Rust) speaks each protocol directly and translates it into a small
  unified JSON model (accounts, buffers, messages) over a Unix socket. It never exposes
  protocol-specific concepts to the client; it speaks the unified model, and each backend module
  happens to be how that model gets populated for a given service.
- **The Electron client** (`src/`) spawns and supervises `nobilis` and renders whatever it reports.

Keeping the protocol work in a separate long-lived daemon means connections, Tor circuits, and
Matrix sync survive the UI being closed, restarted, or reloaded during development.

```
nobilis/src/backend/    one module per protocol (irc, discord, sneedchat, matrix, kick)
nobilis/src/rpc/        the Unix-socket JSON-RPC server
nobilis/src/store.rs    SQLite-backed scrollback persistence
nobilis/src/runtime.rs  protocol-agnostic connection/buffer/message state
src/main/               Electron main: daemon supervision, RPC socket, tray, notifications
src/preload/            the contextBridge surface exposed to the renderer
src/renderer/           React UI: buffer list, message log, member list, accounts, settings
resources/icons/        bundled artwork (service marks, IRC network logos, tray icons)
```

## Building

```bash
npm install
npm run daemon   # cargo build --release, inside nobilis/
```

If npm reports that install scripts were blocked, approve the two that fetch platform binaries —
without them there is no Electron or esbuild to run:

```bash
npm install-scripts approve electron esbuild
```

### Running from source

```bash
npm run dev
```

Starts the renderer with hot reload and launches Electron, which spawns `nobilis/target/release/nobilis`.

### Installing it properly

`npm run deploy` is the one-liner: it builds the daemon and the renderer, packages an AppImage,
installs it, and writes the `.desktop` entry.

`npm run pack` and `npm run deploy` build the daemon first, so a stale binary cannot ship - but
`cargo build --release` inside `nobilis/` does the same thing if you are building by hand.

**Arch (recommended):**

```bash
npm run pack
sudo pacman -U dist/moho-0.1.0.pacman
```

Installs to `/opt/moho` with a desktop entry and icon, so moho shows up in your launcher. Remove
it with `sudo pacman -R moho`.

**Any distribution, no install:**

```bash
npm run pack:dir
```

Produces `dist/linux-unpacked/`, a self-contained directory — run `dist/linux-unpacked/moho`.
No runtime dependencies beyond what Electron itself needs.

**AppImage:**

```bash
npm run pack:appimage
```

Note that AppImages need `libfuse2` at runtime, which Arch and other recent distributions no
longer install by default; without it the file refuses to start with a `libfuse.so.2` error.
Either `sudo pacman -S fuse2`, or skip FUSE entirely:

```bash
APPIMAGE_EXTRACT_AND_RUN=1 ./dist/moho-0.1.0.AppImage
```

Every packaged form bundles `nobilis`, the Sneedchat smilies and the icons under `resources/`, and
the app resolves them from there rather than from the source tree.

### One daemon, many clients

nobilis holds an `flock`-based singleton lock on its data directory, so launching a second client
does not start a second daemon — it attaches to the running one. Quitting the app sends the
daemon a clean shutdown (real QUITs to IRC, rather than dropping the connections), so your nick
isn't left ghosted.

## The client

Three panes: an account-grouped buffer sidebar, the message log, and a member list, with the
sidebar and member list independently foldable. Closing the window hides it to the tray; nobilis
keeps running, so connections and unread tracking survive.

- **Message rendering** - an IRC-style log rather than chat bubbles, with nick colouring,
  BBCode and markdown, spoilers, code and quote blocks, inline image/video/YouTube embeds,
  reactions, replies, inline edit, and Sneedchat's bundled smilies. A "comfy" mode groups
  consecutive messages under one avatar.
- **Settings** - a category rail covering Display, IRC, Sneedchat, Tor, Matrix, Kick and the
  daemon itself. Message-kind filters (joins, parts, mode changes) are applied client-side, so toggling
  one takes effect immediately without a reconnect.
- **Per-protocol join pages** - each service's mechanism is genuinely different (IRC joins by
  channel name, Discord accepts an invite and offers a friends list, Matrix takes a room address
  or searches every homeserver's directory at once, Sneedchat lists the rooms the site itself
  publishes, Kick takes a streamer's handle), so each gets its own page.
- **Matrix security** - SAS device verification, server-side key backup, and signing other
  sessions out, all under the account's own row in the Accounts pane. Verification is between
  your own sessions only: there is no cross-signing yet, so a session verified here is not
  verified in Element.
- **Tagging** - typing "@" lists the people here, the roles the service lets anybody ping, and
  its whole-room words, matched fuzzily. What is sent is what the service understands: an id on
  Discord, `m.mentions` on Matrix, "nick: " on IRC.
- **Profiles** - right-click somebody in the member list or on a message. Each service answers
  what it keeps: an idle time and shared channels on IRC, an account age and a join date on
  Discord, a power level and a last-seen on Matrix.

### Security notes

Message bodies are fully attacker-controlled. The renderer runs with `contextIsolation` and no
Node integration, and its preload surface is a fixed list of calls - there is no `ipcRenderer`
passthrough and no filesystem access. Formatted message HTML is never injected directly: it is
parsed into an inert document and rebuilt through a tag and attribute whitelist, so unknown tags
degrade to text and `javascript:`/`data:` URLs, inline event handlers and `<script>` cannot
survive. Local media nobilis has fetched is served through a dedicated scheme that resolves only
inside the known cache directories, rather than by disabling `webSecurity`.

### Global hotkey on Wayland

The show/hide hotkey (`Control+Shift+M` by default, configurable) uses Electron's
`globalShortcut`, which only works under X11 — Wayland compositors do not let an ordinary client
grab keys globally. Under Wayland the registration is refused, logged, and otherwise ignored;
bind the compositor to focus the window instead.

## Wire protocol

Newline-delimited JSON over a Unix socket at `$XDG_RUNTIME_DIR/moho/nobilis.sock`:

```
request:  {"id": 1, "method": "sendMessage", "params": {...}}
response: {"id": 1, "result": {...}}  or  {"id": 1, "error": "..."}
push:     {"event": "message", "data": {...}}
```

Core methods: `listAccounts`, `listBuffers`, `listProtocols`, `addAccount`, `removeAccount`,
`setAccountConnected`, `joinBuffer`, `partBuffer`, `sendMessage`, `editMessage`, `deleteMessage`,
`subscribe`/`unsubscribe`, `getBacklog` (SQLite-backed, persists across `nobilis` restarts),
`searchMessages`, `requestProfile`, `markBufferRead`. Each protocol also has its own
account-creation method (`addAccount` for IRC, `addDiscordAccount`, `addSneedChatAccount`,
`addMatrixAccount`, `addKickAccount`) and its own verbs beyond the shared ones - the full list is
the match in `nobilis/src/rpc/methods.rs`, which is the only place it cannot go stale.

Requests are answered concurrently, so a slow one - a room-directory search across several
homeservers, a Tor round trip - does not hold up anything else on the same connection. Responses
carry the id of the request they answer and may arrive in any order.

Push events: `message`, `messageUpdated`, `messageDeleted`, `reactionsChanged`, `presenceChange`,
`bufferListChange`, `connectionState`, `notification`, `profile`, `readReceipts`, plus
per-protocol login-flow events
(`discordLoginQr`/`discordLoginScanned`/`discordLoginResult`, `sneedChatLoginStatus`/
`sneedChatLoginResult`, `matrixLoginStatus`/`matrixLoginResult`). `message`, `presenceChange`,
`messageUpdated`, `messageDeleted` and `reactionsChanged` are only delivered to clients that
called `subscribe` for that buffer.

## Protocol backends

- **IRC** - TLS with SASL (PLAIN, EXTERNAL, SCRAM-SHA-256), NickServ auto-identify and GHOST
  reclaim, autojoin, optional SOCKS5 proxying, DCC send and receive, and the network's own colour
  codes. Twelve IRCv3 capabilities plus SASL: `server-time`, `multi-prefix`, `away-notify`,
  `extended-join`, `account-notify`, `chghost`, `message-tags`, `batch`, `chathistory` (both
  spellings), `echo-message` and `labeled-response` - so a sent line is the one the server
  actually delivered rather than this client's guess at it. Typing over `+typing`, a notify list
  over MONITOR, WHOIS, away, and channel modes passed through raw.
- **Discord** - official cross-device QR login (the same one discord.com/app offers), password
  sign-in, or a token; a real-time gateway client over the user gateway. Messages with
  edit/delete/reactions/replies/forwarding, threads and forum posts, slash commands with buttons,
  menus and modal forms, polls that can be voted in, pinned messages, Discord's own search,
  invites made as well as accepted, server and channel mutes read from the account itself, voice
  calls with real audio (Songbird), and the account's own mute settings honoured. Where Discord
  asks for a captcha, it is shown in a window of moho's own rather than sending you to a browser.
  No video or screen share.
- **Sneedchat (SneedChat)** - the Tor-only chat built into Kiwi Farms. Runs over an embedded Tor
  client (or an external SOCKS5 proxy), solves the site's own proof-of-work anti-bot gate *and*
  the Tartarus captcha on its login form, and connects to every configured room simultaneously
  (one persistent websocket per room, sharing a single login). Message edit/delete, whispers,
  attachments (uploaded to postimg, since the chat itself is text-only), and avatars fetched
  through the same Tor session and cached locally.
- **Matrix** - Client-Server API with full end-to-end encryption (vodozemac-backed Olm/Megolm via
  `matrix-sdk-crypto`), SAS device verification, cross-signing, server-side key backup and key
  import/export, encrypted attachments. Threads, read receipts, spaces (created and filled),
  polls, stickers, knocking, reporting, room moderation, ignore lists, and a room directory
  search that asks every homeserver this account knows at once. Calls both ways: one-to-one
  signalling, and the group calls Element holds on a LiveKit media server, with the media keys
  the room passes round.
- **Kick** - the streaming site's chat, over its Pusher socket. Joins by streamer handle, imports
  the account's follows, and carries the three emote tiers with subscriber gating, redemptions,
  subscriptions, gifted subs and raids, moderation, and polls and predictions that can be
  answered rather than only watched.
- **XMPP/Slack** - not implemented yet; `listProtocols` reports them as unavailable rather than
  leaving a frontend to guess.

## On-disk state

| Path | Contents |
|---|---|
| `~/.config/nobilis/accounts.toml` | account config and credentials |
| `~/.config/nobilis/scrollback.db` | SQLite scrollback |
| `~/.config/nobilis/matrix-crypto/` | Matrix E2EE device keys and Olm sessions |
| `~/.cache/moho/` | re-derivable media caches (Matrix media, Sneedchat avatars/attachments) |
| `$XDG_RUNTIME_DIR/moho/nobilis.sock` | the daemon's control socket |
