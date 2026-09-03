# moho

A unified desktop chat client: IRC, Discord, Sneedchat (SneedChat, the Tor-only XenForo chat
feature), and Matrix in one window, with XMPP/Slack landing protocol by protocol without
frontend changes. The architecture is deliberately service-agnostic - the UI only ever sees a
unified account/buffer/message model, never a protocol-specific concept.

## Why two parts

- **`chatd`** (`chatd/`, Rust) speaks each protocol directly and translates it into a small
  unified JSON model (accounts, buffers, messages) over a Unix socket. It never exposes
  protocol-specific concepts to the client; it speaks the unified model, and each backend module
  happens to be how that model gets populated for a given service.
- **The Electron client** (`src/`) spawns and supervises `chatd` and renders whatever it reports.

Keeping the protocol work in a separate long-lived daemon means connections, Tor circuits, and
Matrix sync survive the UI being closed, restarted, or reloaded during development.

```
chatd/src/backend/      one module per protocol (irc, discord, sneedchat, matrix, ...)
chatd/src/rpc/          the Unix-socket JSON-RPC server
chatd/src/store.rs      SQLite-backed scrollback persistence
chatd/src/runtime.rs    protocol-agnostic connection/buffer/message state
src/main/               Electron main: daemon supervision, RPC socket, tray, notifications
src/preload/            the contextBridge surface exposed to the renderer
src/renderer/           React UI: buffer list, message log, member list, accounts, settings
resources/              bundled assets (Sneedchat smilies, icons)
```

## Building

```bash
cargo build --release
npm install
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

Starts the renderer with hot reload and launches Electron, which spawns `target/release/chatd`.

### Installing it properly

Run `cargo build --release` first — the daemon is bundled from `target/release/chatd`, so a stale
or missing binary ships a stale or missing daemon.

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

Every packaged form bundles `chatd`, the Sneedchat smilies and the icons under `resources/`, and
the app resolves them from there rather than from the source tree.

### One daemon, many clients

chatd holds an `flock`-based singleton lock on its data directory, so launching a second client
does not start a second daemon — it attaches to the running one. Quitting the app sends the
daemon a clean shutdown (real QUITs to IRC, rather than dropping the connections), so your nick
isn't left ghosted.

## The client

Three panes: an account-grouped buffer sidebar, the message log, and a member list, with the
sidebar and member list independently foldable. Closing the window hides it to the tray; chatd
keeps running, so connections and unread tracking survive.

- **Message rendering** - an IRC-style log rather than chat bubbles, with nick colouring,
  BBCode and markdown, spoilers, code and quote blocks, inline image/video/YouTube embeds,
  reactions, replies, inline edit, and Sneedchat's bundled smilies. A "comfy" mode groups
  consecutive messages under one avatar.
- **Settings** - a category rail covering Display, IRC, Sneedchat, Tor, Matrix and the daemon
  itself. Message-kind filters (joins, parts, mode changes) are applied client-side, so toggling
  one takes effect immediately without a reconnect.
- **Per-protocol join pages** - each service's mechanism is genuinely different (IRC joins by
  channel name, Discord accepts an invite and offers a friends list, Matrix takes a room id or
  alias, Sneedchat's rooms are a fixed set edited in Settings), so each gets its own page.
- **Matrix security** - SAS device verification, server-side key backup, and signing other
  sessions out, all under the account's own row in the Accounts pane.

### Security notes

Message bodies are fully attacker-controlled. The renderer runs with `contextIsolation` and no
Node integration, and its preload surface is a fixed list of calls - there is no `ipcRenderer`
passthrough and no filesystem access. Formatted message HTML is never injected directly: it is
parsed into an inert document and rebuilt through a tag and attribute whitelist, so unknown tags
degrade to text and `javascript:`/`data:` URLs, inline event handlers and `<script>` cannot
survive. Local media chatd has fetched is served through a dedicated scheme that resolves only
inside the known cache directories, rather than by disabling `webSecurity`.

### Global hotkey on Wayland

The show/hide hotkey (`Control+Shift+M` by default, configurable) uses Electron's
`globalShortcut`, which only works under X11 — Wayland compositors do not let an ordinary client
grab keys globally. Under Wayland the registration is refused, logged, and otherwise ignored;
bind the compositor to focus the window instead.

## Wire protocol

Newline-delimited JSON over a Unix socket at `$XDG_RUNTIME_DIR/moho/chatd.sock`:

```
request:  {"id": 1, "method": "sendMessage", "params": {...}}
response: {"id": 1, "result": {...}}  or  {"id": 1, "error": "..."}
push:     {"event": "message", "data": {...}}
```

Core methods: `listAccounts`, `listBuffers`, `listProtocols`, `addAccount`, `removeAccount`,
`setAccountConnected`, `joinBuffer`, `partBuffer`, `sendMessage`, `editMessage`, `deleteMessage`,
`subscribe`/`unsubscribe`, `getBacklog` (SQLite-backed, persists across `chatd` restarts). Each
protocol also has its own account-creation method (`addAccount` for IRC, `addDiscordAccount`,
`addSneedChatAccount`, `addMatrixAccount`).

Push events: `message`, `messageUpdated`, `messageDeleted`, `reactionsChanged`, `presenceChange`,
`bufferListChange`, `connectionState`, `notification`, plus per-protocol login-flow events
(`discordLoginQr`/`discordLoginScanned`/`discordLoginResult`, `sneedChatLoginStatus`/
`sneedChatLoginResult`, `matrixLoginStatus`/`matrixLoginResult`). `message`, `presenceChange`,
`messageUpdated`, `messageDeleted` and `reactionsChanged` are only delivered to clients that
called `subscribe` for that buffer.

## Protocol backends

- **IRC** - TLS with SASL PLAIN, NickServ auto-identify, autojoin, optional SOCKS5 proxying.
- **Discord** - official cross-device QR login (the same one discord.com/app offers), a real-time
  gateway client, message edit/delete/reactions/replies sync.
- **Sneedchat (SneedChat)** - the Tor-only chat built into Kiwi Farms. Runs over an embedded Tor
  client (or an external SOCKS5 proxy), solves the site's own proof-of-work anti-bot gate, and
  connects to every configured room simultaneously (one persistent websocket per room, sharing a
  single login). Supports message edit/delete and avatars (fetched through the same Tor session
  and cached locally, since the client has no route to a `.onion` host on its own).
- **Matrix** - Client-Server API with full end-to-end encryption (vodozemac-backed Olm/Megolm via
  `matrix-sdk-crypto`), SAS device verification, server-side key backup, and room moderation.
- **XMPP/Slack** - not implemented yet.

## On-disk state

| Path | Contents |
|---|---|
| `~/.config/moho/accounts.toml` | account config and credentials |
| `~/.config/moho/scrollback.db` | SQLite scrollback |
| `~/.config/moho/matrix-crypto/` | Matrix E2EE device keys and Olm sessions |
| `~/.cache/moho/` | re-derivable media caches (Matrix media, Sneedchat avatars/attachments) |
| `$XDG_RUNTIME_DIR/moho/chatd.sock` | the daemon's control socket |
