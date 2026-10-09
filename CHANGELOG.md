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

## [1.0.0-rc.4]

### Major features

- **A rebuilt tray:** an icon drawn for the system's colour scheme with the number of conversations waiting on it, a tooltip that says what is waiting, and a menu of what is new, Show/Hide, Status, Settings, Restart moho and Quit - Restart moho brings back both the window and the daemon
- **Status by service:** the plaque and the tray offer only the statuses each service has - Discord all four, IRC away and back, Matrix online and offline, Kick and Sneedchat none - and Do not disturb silences desktop notifications on every service, and is Discord's real mode there

### Fixes, patches and changes

- Reworked the tray icon and menu, and dropped Restart daemon and Stop daemon from it ([moho `24106e5`](https://github.com/Moho-Chat/moho/commit/24106e5))
- Do not disturb now silences an account's desktop notifications and the taskbar flash; the tray no longer has a switch of its own for it ([moho `53fb0f3`](https://github.com/Moho-Chat/moho/commit/53fb0f3))
- Idle from the tray reaches Discord and IRC and leaves Matrix, Kick and Sneedchat as they were; a service is no longer asked for a status it does not have ([moho `c1bcb72`](https://github.com/Moho-Chat/moho/commit/c1bcb72), [nobilis `a8441ab`](https://github.com/Moho-Chat/nobilis/commit/a8441ab))
- Fixed Matrix's rate limit on changing status showing as M_LIMIT_EXCEEDED: a limited request now waits the time the server names, and a longer wait is applied when it is over ([moho `0dfff0d`](https://github.com/Moho-Chat/moho/commit/0dfff0d), [nobilis `43135c1`](https://github.com/Moho-Chat/nobilis/commit/43135c1))
- Fixed the window being pulled back to the open conversation's server whenever you chose another: the daemon link coming up is acted on once, a refresh no longer follows the open conversation, and the tray is told only what changed ([moho `745641a`](https://github.com/Moho-Chat/moho/commit/745641a))
- Matrix's invisible is called Offline in the plaque, its popout and the tray, which is what it sets ([moho `745641a`](https://github.com/Moho-Chat/moho/commit/745641a))
- A room muted on a Matrix account can now be unmuted from the menu, including a mute set from Element ([moho `745641a`](https://github.com/Moho-Chat/moho/commit/745641a), [nobilis `59db82c`](https://github.com/Moho-Chat/nobilis/commit/59db82c))
- Server rail tiles now count the mentions waiting in them rather than the messages, and a muted room counts for nothing, mentions included ([moho `0dc048c`](https://github.com/Moho-Chat/moho/commit/0dc048c))
- Fixed a room unmuted on a Matrix account still being drawn as muted; a mute or unmute the server did not take is now reported with its reason, and Matrix requests to a server that does not answer give up ([moho `95f1784`](https://github.com/Moho-Chat/moho/commit/95f1784), [nobilis `d1bbcaf`](https://github.com/Moho-Chat/nobilis/commit/d1bbcaf))
- Discord requests now give up on a connection that has gone quiet, a history catch-up always releases its place, and the gateway logs what it receives and why a message is dropped ([moho `b151ef8`](https://github.com/Moho-Chat/moho/commit/b151ef8), [nobilis `a34821e`](https://github.com/Moho-Chat/nobilis/commit/a34821e))
- Fixed Discord reconnecting every few seconds after being told it is rate limited: it now waits out the minute Discord asks for ([nobilis `59db82c`](https://github.com/Moho-Chat/nobilis/commit/59db82c))

## [1.0.0-rc.3]

### Major features

- **Discord forums:** forum and media channels appear in the channel list and open as a pane of posts - title, tags, the first message's words, replies, age, picture and top reaction - with search, sorting, older posts, and a New Post form
- **A redesigned interface:** Discord-shaped messages with date separators and an unread bar, red mention badges, a Ctrl+K quick switcher, keyboard navigation, a rail with mention counts and folders, a member list with faces, and motion throughout
- **Settings rebuilt:** one click from the gear, a grouped rail with a search over every setting, and new Appearance (layout, spacing, zoom, clock, reduce motion), Notifications and Keybinds pages with a hotkey recorder
- **A one-box message composer:** a + menu, Send only when there is something to send, Shift+Enter for a new line on every service, an attachment tray with spoilers, and dropped files going into the tray
- **Discord notices and permissions:** Discord's own safety notices drawn as the cards they are, and a banner in place of the message box wherever nothing can be written

### Fixes, patches and changes

- Fixed Sneedchat pictures posted back to back by a script merging into one unusable link ([moho `6edae7a`](https://github.com/Moho-Chat/moho/commit/6edae7a))
- Discord files staged together now go as one message, with an upload ring that fills as it uploads ([moho `9888c80`](https://github.com/Moho-Chat/moho/commit/9888c80), [nobilis `9690905`](https://github.com/Moho-Chat/nobilis/commit/9690905))
- Fixed the release mirror script printing a traceback while the release did not exist yet ([moho `a8d9f41`](https://github.com/Moho-Chat/moho/commit/a8d9f41))
- Defined the design tokens the stylesheet used but never had, and applied one set across it ([moho `9db25c8`](https://github.com/Moho-Chat/moho/commit/9db25c8), [moho `3cdfe37`](https://github.com/Moho-Chat/moho/commit/3cdfe37))
- Added a screenshot harness for before-and-after pictures of the interface ([moho `88375ba`](https://github.com/Moho-Chat/moho/commit/88375ba))
- Unread channels now read as unread, mentions are red, and every badge is one style ([moho `4ca37dd`](https://github.com/Moho-Chat/moho/commit/4ca37dd))
- Added date separators to the message list ([moho `b2464e4`](https://github.com/Moho-Chat/moho/commit/b2464e4))
- Added Mark as read on channels, categories and servers, and Escape to read what you are in ([moho `2745a2f`](https://github.com/Moho-Chat/moho/commit/2745a2f))
- Added a Ctrl+K quick switcher and keyboard navigation between channels ([moho `1eef37e`](https://github.com/Moho-Chat/moho/commit/1eef37e))
- Voice panel: a horizontal microphone bar, the connection's real latency, and a share button ([moho `ad0f0c0`](https://github.com/Moho-Chat/moho/commit/ad0f0c0), [nobilis `e0f6169`](https://github.com/Moho-Chat/nobilis/commit/e0f6169))
- Replies jump to the message they answer, and names and pictures open the profile ([moho `bf45147`](https://github.com/Moho-Chat/moho/commit/bf45147))
- Added Copy and Copy text on every message, and Copy message link on Discord ([moho `0033955`](https://github.com/Moho-Chat/moho/commit/0033955))
- The hover toolbar fades in, can be reached by keyboard, and offers Edit, Copy and your recent reactions ([moho `57e1856`](https://github.com/Moho-Chat/moho/commit/57e1856))
- Fixed six interface bugs: a nested voice button, folded categories hiding unread, muted channels hiding mentions, overlapping corners, the typing strip moving the log, and pinned rows missing their service mark ([moho `6598043`](https://github.com/Moho-Chat/moho/commit/6598043))
- Pending sends dim only their text, failed ones can be deleted, and Up in an empty box edits your last message in a multi-line editor ([moho `6a82c32`](https://github.com/Moho-Chat/moho/commit/6a82c32))
- Server rail: mention counts, folders that say what is waiting and stay open, an instant name flyout and a red close button ([moho `8072b24`](https://github.com/Moho-Chat/moho/commit/8072b24))
- Member list: faces, presence dots, and a click for the profile; Discord's member pictures now come with the list ([moho `c912ed3`](https://github.com/Moho-Chat/moho/commit/c912ed3), [nobilis `4099305`](https://github.com/Moho-Chat/nobilis/commit/4099305))
- Voice channel list: faces, muted and deafened marks, a speaking ring and a collapsible heading ([moho `843288d`](https://github.com/Moho-Chat/moho/commit/843288d))
- Comfy messages in Discord's shape, amber mention rows, one code and quote style, and marked system lines ([moho `3a7677e`](https://github.com/Moho-Chat/moho/commit/3a7677e))
- Buttons are primary, subtle or the one danger style, and the restarts ask first ([moho `2c8609c`](https://github.com/Moho-Chat/moho/commit/2c8609c))
- Escape closes only the top layer, and full-page panels close on Escape ([moho `c5e7619`](https://github.com/Moho-Chat/moho/commit/c5e7619))
- Thread panel reads the display settings, groups replies and follows the newest ([moho `33129f9`](https://github.com/Moho-Chat/moho/commit/33129f9))
- Toasts slide in and out, come in three kinds, pause on hover and fold repeats ([moho `2d1b8be`](https://github.com/Moho-Chat/moho/commit/2d1b8be))
- Context menu: keyboard navigation, checked items, shortcut hints, and placement that holds while it animates ([moho `4065963`](https://github.com/Moho-Chat/moho/commit/4065963), [moho `fcb7df5`](https://github.com/Moho-Chat/moho/commit/fcb7df5))
- A conversation opens at its first unread, with a bar saying how many are above ([moho `55fd192`](https://github.com/Moho-Chat/moho/commit/55fd192))
- Added hover fades, turning fold arrows, arriving messages, a reaction pop and growing overlays ([moho `6d8a050`](https://github.com/Moho-Chat/moho/commit/6d8a050))
- Every dialog is built from one shared frame with a close button, kept focus and a scrim below the title bar ([moho `5cb30ce`](https://github.com/Moho-Chat/moho/commit/5cb30ce), [moho `420a2f7`](https://github.com/Moho-Chat/moho/commit/420a2f7), [moho `6a329c6`](https://github.com/Moho-Chat/moho/commit/6a329c6))
- Shift+Enter makes a new line on every service and pasted line breaks stay; IRC sends them as a batch or separate lines, Sneedchat as [br], Kick as one line ([moho `9ba630c`](https://github.com/Moho-Chat/moho/commit/9ba630c), [nobilis `ccc8de6`](https://github.com/Moho-Chat/nobilis/commit/ccc8de6))
- Reply bar: its own surface, the author's face, Esc to cancel, and an @ switch to answer without pinging on Discord ([moho `f48185e`](https://github.com/Moho-Chat/moho/commit/f48185e), [nobilis `918fcfa`](https://github.com/Moho-Chat/nobilis/commit/918fcfa))
- One style for the name, command and emoji lists, with member pictures and :shortcode emoji completion ([moho `28d8b3c`](https://github.com/Moho-Chat/moho/commit/28d8b3c))
- Lightbox: step through a conversation's pictures, wheel and pinch zoom with panning, and Copy picture ([moho `817cb1e`](https://github.com/Moho-Chat/moho/commit/817cb1e))
- Emoji picker: walk it with the arrow keys, Enter picks the top result, and skin tones are remembered ([moho `99fd0d3`](https://github.com/Moho-Chat/moho/commit/99fd0d3))
- Attachment tray cards with name, size and a Discord spoiler toggle; dropped files go into the tray instead of being sent at once ([moho `15e7061`](https://github.com/Moho-Chat/moho/commit/15e7061), [nobilis `0f5669b`](https://github.com/Moho-Chat/nobilis/commit/0f5669b))
- Composer: one box with the + on the left and emoji, stickers, voice and Send on the right ([moho `a59c1ab`](https://github.com/Moho-Chat/moho/commit/a59c1ab))
- Several pictures in one message lay out as a grid, and SPOILER_ files are blurred until clicked ([moho `87ea3b8`](https://github.com/Moho-Chat/moho/commit/87ea3b8))
- Pinned messages show as a banner over the log for Discord and Matrix, with a count on the header ([moho `3a74cf0`](https://github.com/Moho-Chat/moho/commit/3a74cf0))
- Reactions say what they are and who gave them on hover ([moho `506140d`](https://github.com/Moho-Chat/moho/commit/506140d), [nobilis `1da3ad8`](https://github.com/Moho-Chat/nobilis/commit/1da3ad8))
- User footer: muted and deafened are red, voice buttons stay on every service, and the status is a popout with a custom status for Discord and Matrix and Apply to all accounts ([moho `c026609`](https://github.com/Moho-Chat/moho/commit/c026609), [nobilis `f280563`](https://github.com/Moho-Chat/nobilis/commit/f280563))
- The footer's join button is gone; the rail's + is the one way in, pinned under a rule above the settings cog while the server list scrolls ([moho `b4c1ced`](https://github.com/Moho-Chat/moho/commit/b4c1ced), [moho `dad5543`](https://github.com/Moho-Chat/moho/commit/dad5543))
- Header: one 48px row across every column, filled toggles, and the channel topic from IRC, Matrix and Discord ([moho `2ef9e35`](https://github.com/Moho-Chat/moho/commit/2ef9e35), [nobilis `44d1611`](https://github.com/Moho-Chat/nobilis/commit/44d1611))
- "(edited)" says when on hover, for edits seen live ([moho `7f4c356`](https://github.com/Moho-Chat/moho/commit/7f4c356), [nobilis `e51f139`](https://github.com/Moho-Chat/nobilis/commit/e51f139))
- Incoming Discord and Matrix calls share one card style and stack ([moho `59d4893`](https://github.com/Moho-Chat/moho/commit/59d4893))
- Settings: the gear opens it directly, with Accounts and Downloads as pages, a search, one switch for every boolean and a saved tick ([moho `66a0c0f`](https://github.com/Moho-Chat/moho/commit/66a0c0f), [moho `cc4c9f6`](https://github.com/Moho-Chat/moho/commit/cc4c9f6))
- Settings: added Appearance, Notifications and Keybinds pages, the last with a recorder for the global hotkey ([moho `fe6ad97`](https://github.com/Moho-Chat/moho/commit/fe6ad97), [moho `adca84d`](https://github.com/Moho-Chat/moho/commit/adca84d), [moho `82a0bdf`](https://github.com/Moho-Chat/moho/commit/82a0bdf))
- Accounts open by default with few accounts, Remove sits in a danger zone, and Join picks its account and says Join ([moho `f8dcccd`](https://github.com/Moho-Chat/moho/commit/f8dcccd))
- Mentions page: service and unread filters, day groups, two-line bodies and put-away ([moho `078fe41`](https://github.com/Moho-Chat/moho/commit/078fe41))
- Room settings is a tabbed dialog instead of a popover ([moho `f8936c6`](https://github.com/Moho-Chat/moho/commit/f8936c6))
- Quiet buttons such as Cancel have their own fill, so they no longer vanish into a dialog ([moho `50aaa97`](https://github.com/Moho-Chat/moho/commit/50aaa97))
- Fixed browsing an IRC network's channels freezing or blanking the window: the daemon holds the list and sends a page, it times out after a minute, and a refusal is reported ([moho `2b41c5e`](https://github.com/Moho-Chat/moho/commit/2b41c5e), [nobilis `152fdf1`](https://github.com/Moho-Chat/nobilis/commit/152fdf1))
- Channels in the list no longer jump to the top as messages arrive ([moho `9f03d6b`](https://github.com/Moho-Chat/moho/commit/9f03d6b))
- Fixed Discord's notices showing only a stand-in title: they are read as cards, and a banner replaces the message box in them and in channels this account cannot write in ([moho `ff7d313`](https://github.com/Moho-Chat/moho/commit/ff7d313), [moho `d7c4215`](https://github.com/Moho-Chat/moho/commit/d7c4215), [moho `2a4f797`](https://github.com/Moho-Chat/moho/commit/2a4f797), [nobilis `1b270be`](https://github.com/Moho-Chat/nobilis/commit/1b270be), [nobilis `97ac6bc`](https://github.com/Moho-Chat/nobilis/commit/97ac6bc), [nobilis `7561b88`](https://github.com/Moho-Chat/nobilis/commit/7561b88))
- A window whose page dies is reloaded and the reason logged, instead of being left empty ([moho `6899694`](https://github.com/Moho-Chat/moho/commit/6899694), [moho `06bb812`](https://github.com/Moho-Chat/moho/commit/06bb812))
- Discord forums, with live and archived posts read together ([moho `dd0c25e`](https://github.com/Moho-Chat/moho/commit/dd0c25e), [nobilis `d02bba0`](https://github.com/Moho-Chat/nobilis/commit/d02bba0), [nobilis `8363003`](https://github.com/Moho-Chat/nobilis/commit/8363003), [nobilis `3cf1a5b`](https://github.com/Moho-Chat/nobilis/commit/3cf1a5b), [nobilis `6abcb8e`](https://github.com/Moho-Chat/nobilis/commit/6abcb8e))
- Added Rust crate tokio-util 0.7.19 ([nobilis `9690905`](https://github.com/Moho-Chat/nobilis/commit/9690905))

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
