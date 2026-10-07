# Changelog

Every release of moho, newest first. The release page for a version is its
section here, copied by the release workflow - a version tagged without one
is not published.

Versions are MAJOR.FEATURE.FIX: the first number is a major release, the
middle one counts protocols added and major features, the last counts
bug and security fixes. 1.1.0 would add a protocol; 1.0.5 is the fifth fix
release of 1.0.

Each section has two parts:

- **Major features** - new protocols and features too large for one commit,
  without links.
- **Fixes, patches and changes** - one short line each, linked to the commit
  that made it, including dependency updates
  (`node scripts/changelog-deps.mjs <previous tag>` lists those).

## [1.0.0]

### Major features

- **Five protocols in one window:** IRC, Discord, Matrix with end-to-end encryption, Sneedchat, and Kick.
- **Discord voice and video:** calls, cameras, screen sharing and Go Live, stage channels, the soundboard and per-person volume, all with Discord's DAVE end-to-end encryption.
- **Matrix:** encrypted rooms with device verification and key backup, Element Call, sliding sync, spaces, and signing in by QR code from a phone.
- **Per-account Tor and SOCKS5 routing:** Clearnet, Service tunnel or Strict - Strict sends every picture, link check and embed through the account's route too. Or send everything through Tor at once.
- **One mentions inbox across every service,** link previews, YouTube cards that play in place, voice messages, polls, and exporting a conversation to disk.
- **A background daemon** (nobilis) that keeps every connection alive with the window closed.

### Fixes, patches and changes

- Channel rows in the sidebar now show a single `#` instead of two ([moho `ccdf090`](https://github.com/Moho-Chat/moho/commit/ccdf090))
- Typing anywhere in the window now goes into the message box, without clicking it first ([moho `b5f920f`](https://github.com/Moho-Chat/moho/commit/b5f920f))
- Added a formatting strip over selected text in the message box, offering the formats each service can carry ([moho `9ca477c`](https://github.com/Moho-Chat/moho/commit/9ca477c))
- Added a right-click menu to every text field, with spelling suggestions, Undo, Cut, Copy, Paste and Select all ([moho `b2a6210`](https://github.com/Moho-Chat/moho/commit/b2a6210))
- Fixed YouTube cards not appearing on Sneedchat when YouTube refused a Tor exit, so most links there had none ([moho `0368796`](https://github.com/Moho-Chat/moho/commit/0368796), [nobilis `71e6036`](https://github.com/Moho-Chat/nobilis/commit/71e6036))
- Fixed live and premiere YouTube videos vanishing because they have no thumbnail yet ([moho `916abd4`](https://github.com/Moho-Chat/moho/commit/916abd4))
- Fixed YouTube links with the video id after other parameters, `music.youtube.com` and `youtube-nocookie.com` links getting no card ([nobilis `f8409fc`](https://github.com/Moho-Chat/nobilis/commit/f8409fc))
- Patched a flaw that let a message's content make moho load a local file ([moho `7138201`](https://github.com/Moho-Chat/moho/commit/7138201), [nobilis `f972611`](https://github.com/Moho-Chat/nobilis/commit/f972611))
- Strict routing now sends a Tor or proxy account's pictures, links and embeds through its route instead of directly ([moho `cee8604`](https://github.com/Moho-Chat/moho/commit/cee8604), [nobilis `a3897ba`](https://github.com/Moho-Chat/nobilis/commit/a3897ba))
- Discord voice and soundboard audio is now checked before it reaches the C decoder ([nobilis `8eca16e`](https://github.com/Moho-Chat/nobilis/commit/8eca16e))
- Fixed Discord showing "connecting" after every successful resume ([nobilis `52b0001`](https://github.com/Moho-Chat/nobilis/commit/52b0001))
- Fixed reconnect waits growing to a minute and never resetting ([nobilis `52b0001`](https://github.com/Moho-Chat/nobilis/commit/52b0001))
- The interruption banner now counts down to the next reconnect attempt ([moho `89da9ba`](https://github.com/Moho-Chat/moho/commit/89da9ba))
- Fixed Kick over Tor failing every channel lookup until a reconnect ([nobilis `5755c4e`](https://github.com/Moho-Chat/nobilis/commit/5755c4e))
- Fixed failed Kick joins vanishing without a message ([nobilis `5755c4e`](https://github.com/Moho-Chat/nobilis/commit/5755c4e))
- IRC now shows the server's own reason when it refuses a connection ([nobilis `9eeab7e`](https://github.com/Moho-Chat/nobilis/commit/9eeab7e))
- Fixed Disconnect and Remove showing a "cancelled" error ([nobilis `8bcba8b`](https://github.com/Moho-Chat/nobilis/commit/8bcba8b))
- Fixed new accounts not appearing on the server rail until a restart ([moho `e207224`](https://github.com/Moho-Chat/moho/commit/e207224))
- Joining a channel now opens it ([moho `e207224`](https://github.com/Moho-Chat/moho/commit/e207224))
- Removing an account now asks first ([moho `16fa8a2`](https://github.com/Moho-Chat/moho/commit/16fa8a2))
- Fixed the Matrix form saying matrix.org takes no new accounts ([moho `16fa8a2`](https://github.com/Moho-Chat/moho/commit/16fa8a2))
- Fixed Kick's mark drawing as a blank square in the accounts pane ([moho `0ea63f5`](https://github.com/Moho-Chat/moho/commit/0ea63f5))
- Fixed a cleared service interruption staying on screen ([moho `fd09b6b`](https://github.com/Moho-Chat/moho/commit/fd09b6b))
- Conversations now show at start, before their account has connected ([nobilis `7976452`](https://github.com/Moho-Chat/nobilis/commit/7976452))
- Fixed Kick follows being saved before Kick confirmed the channel exists ([nobilis `c2e40dd`](https://github.com/Moho-Chat/nobilis/commit/c2e40dd), [nobilis `4d8f17b`](https://github.com/Moho-Chat/nobilis/commit/4d8f17b))
- Kick requests are now spaced out, and a rate limit pauses every Kick request instead of retrying at once ([nobilis `f592a22`](https://github.com/Moho-Chat/nobilis/commit/f592a22), [nobilis `c99d52b`](https://github.com/Moho-Chat/nobilis/commit/c99d52b), [nobilis `2732d08`](https://github.com/Moho-Chat/nobilis/commit/2732d08))
- Fixed a changed Sneedchat avatar never being fetched again ([nobilis `04cb759`](https://github.com/Moho-Chat/nobilis/commit/04cb759))
- Every media cache now expires old files, with a way to fetch removed pictures again ([nobilis `25a0912`](https://github.com/Moho-Chat/nobilis/commit/25a0912), [moho `9e67ca6`](https://github.com/Moho-Chat/moho/commit/9e67ca6))
- Fixed Kick emotes removed by the cache sweep not drawing again ([moho `70cd8d7`](https://github.com/Moho-Chat/moho/commit/70cd8d7))
- Fixed Matrix reactions being counted more than once ([nobilis `8ea9a70`](https://github.com/Moho-Chat/nobilis/commit/8ea9a70))
- Fixed the scrollback being written to disk once per message ([nobilis `bd33f88`](https://github.com/Moho-Chat/nobilis/commit/bd33f88))
- Fixed the migration deleting the client's own config directory ([nobilis `9e885a4`](https://github.com/Moho-Chat/nobilis/commit/9e885a4), [nobilis `207de58`](https://github.com/Moho-Chat/nobilis/commit/207de58))
- Fixed a removed account leaving its data behind ([nobilis `2dd755e`](https://github.com/Moho-Chat/nobilis/commit/2dd755e))
- Fixed new members of an encrypted Matrix room not receiving its keys ([nobilis `b894dea`](https://github.com/Moho-Chat/nobilis/commit/b894dea))
- Fixed two ways a Matrix sign-in could leave an account permanently unusable ([nobilis `ded9cc5`](https://github.com/Moho-Chat/nobilis/commit/ded9cc5))
- Fixed sliding sync failing against Synapse ([nobilis `e2bb988`](https://github.com/Moho-Chat/nobilis/commit/e2bb988))
- Fixed Discord media links expiring on screen; they now refresh themselves ([moho `dc15c4b`](https://github.com/Moho-Chat/moho/commit/dc15c4b), [nobilis `f5a455b`](https://github.com/Moho-Chat/nobilis/commit/f5a455b))
- Repaired Discord messages stored with attachments in their text ([nobilis `15007d6`](https://github.com/Moho-Chat/nobilis/commit/15007d6))
- Fixed Discord streams opening a second connection ([nobilis `7b64414`](https://github.com/Moho-Chat/nobilis/commit/7b64414))
- Fixed lost video packets, phone streams and stream sound in Discord calls ([nobilis `92dffca`](https://github.com/Moho-Chat/nobilis/commit/92dffca))
- Fixed the Discord stream heartbeat using the wrong protocol version ([nobilis `64dfa08`](https://github.com/Moho-Chat/nobilis/commit/64dfa08))
- Fixed a running upload being reported as failed ([moho `ee60271`](https://github.com/Moho-Chat/moho/commit/ee60271))
- Fixed thumbnails opening as the thumbnail instead of the picture ([moho `6af6ac3`](https://github.com/Moho-Chat/moho/commit/6af6ac3))
- Fixed avif links not drawing as pictures ([moho `1511c4b`](https://github.com/Moho-Chat/moho/commit/1511c4b), [nobilis `4e3c65d`](https://github.com/Moho-Chat/nobilis/commit/4e3c65d))
- Fixed links in brackets not being recognised ([nobilis `dd450eb`](https://github.com/Moho-Chat/nobilis/commit/dd450eb))
- Fixed a full-size photo being downloaded to draw a thumbnail ([nobilis `873a908`](https://github.com/Moho-Chat/nobilis/commit/873a908))
- Fixed a crash in the room preview panel ([moho `04a6b7d`](https://github.com/Moho-Chat/moho/commit/04a6b7d))
- Fixed call renegotiation not waiting for its answer ([moho `db0f651`](https://github.com/Moho-Chat/moho/commit/db0f651))
- Fixed a screen share on Wayland asking twice ([moho `2c146d9`](https://github.com/Moho-Chat/moho/commit/2c146d9))
- Discord no longer attempts what it puts behind a captcha ([nobilis `8da2e7a`](https://github.com/Moho-Chat/nobilis/commit/8da2e7a))
- The renderer now runs sandboxed ([moho `e791fcf`](https://github.com/Moho-Chat/moho/commit/e791fcf))
- The installer warns when Windows Smart App Control will block moho ([moho `5a8d7f7`](https://github.com/Moho-Chat/moho/commit/5a8d7f7))
- The uninstaller now offers to remove saved sign-ins and history, and stops the daemon first ([moho `76eabac`](https://github.com/Moho-Chat/moho/commit/76eabac))
- Linux builds now run on Ubuntu 22.04 and later ([moho `4c6e24b`](https://github.com/Moho-Chat/moho/commit/4c6e24b))
- Updated Rust crate h2 from 0.4.15 to 0.4.19 ([nobilis `2f5918e`](https://github.com/Moho-Chat/nobilis/commit/2f5918e))
- Added Rust crate opus2 0.4.0 ([nobilis `f9b5be5`](https://github.com/Moho-Chat/nobilis/commit/f9b5be5))
- Added Rust crate aes-gcm 0.10.3 ([nobilis `9d50723`](https://github.com/Moho-Chat/nobilis/commit/9d50723))
- Added Rust crate chacha20poly1305 0.10.1 ([nobilis `9d50723`](https://github.com/Moho-Chat/nobilis/commit/9d50723))
- Added Rust crate davey 0.1.4 ([nobilis `8ae2148`](https://github.com/Moho-Chat/nobilis/commit/8ae2148))
- Removed Rust crate async-trait 0.1.92 ([nobilis `cbb044d`](https://github.com/Moho-Chat/nobilis/commit/cbb044d))
- Removed Rust crate songbird 0.6.0 ([nobilis `cbb044d`](https://github.com/Moho-Chat/nobilis/commit/cbb044d))
- Added Rust crate socket2 0.6.5 ([nobilis `92dffca`](https://github.com/Moho-Chat/nobilis/commit/92dffca))
- Added Rust crate sonora 0.2.0 ([nobilis `72ef1b5`](https://github.com/Moho-Chat/nobilis/commit/72ef1b5))
- Updated Rust crate arti-client from 0.44.0 to 0.47.0 ([nobilis `c34b751`](https://github.com/Moho-Chat/nobilis/commit/c34b751))
- Updated Rust crate matrix-sdk-common from 0.18.0 to 0.19.1 ([nobilis `c34b751`](https://github.com/Moho-Chat/nobilis/commit/c34b751))
- Updated Rust crate matrix-sdk-crypto from 0.18.0 to 0.19.1 ([nobilis `c34b751`](https://github.com/Moho-Chat/nobilis/commit/c34b751))
- Updated Rust crate matrix-sdk-sqlite from 0.18.0 to 0.19.1 ([nobilis `c34b751`](https://github.com/Moho-Chat/nobilis/commit/c34b751))
- Updated Rust crate ruma-client-api from 0.24.0 to 0.25.0 ([nobilis `c34b751`](https://github.com/Moho-Chat/nobilis/commit/c34b751))
- Updated Rust crate ruma-common from 0.19.0 to 0.20.0 ([nobilis `c34b751`](https://github.com/Moho-Chat/nobilis/commit/c34b751))
- Updated Rust crate ruma-events from 0.34.0 to 0.35.0 ([nobilis `c34b751`](https://github.com/Moho-Chat/nobilis/commit/c34b751))
- Updated Rust crate rusqlite from 0.37.0 to 0.40.2 ([nobilis `c34b751`](https://github.com/Moho-Chat/nobilis/commit/c34b751))
- Updated Rust crate tor-rtcompat from 0.44.0 to 0.47.0 ([nobilis `c34b751`](https://github.com/Moho-Chat/nobilis/commit/c34b751))
- Updated Rust crate rustls from 0.23.43 to 0.23.45 ([nobilis `2f5918e`](https://github.com/Moho-Chat/nobilis/commit/2f5918e))
- Updated npm package electron-builder from 25.1.8 to 26.15.3 ([moho `e791fcf`](https://github.com/Moho-Chat/moho/commit/e791fcf))
- Updated npm package electron from 33.4.11 to 44.4.4 ([moho `932a07a`](https://github.com/Moho-Chat/moho/commit/932a07a))
- Added npm package lottie-web 5.13.0 ([moho `f67c753`](https://github.com/Moho-Chat/moho/commit/f67c753))
- Added npm package happy-dom 15.11.7 ([moho `53a6f92`](https://github.com/Moho-Chat/moho/commit/53a6f92))
- Added npm package vitest 2.1.9 ([moho `53a6f92`](https://github.com/Moho-Chat/moho/commit/53a6f92))
