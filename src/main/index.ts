import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  session,
  Menu,
  screen,
  shell,
  Tray,
  type MenuItemConstructorOptions
} from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { defaultSocketPath, NobilisClient } from './nobilis-client'
import { NobilisProcess } from './nobilis-process'
import { Prefs } from './prefs'
import { Notifier } from './notifications'
import { IdleWatcher } from './idle'
import { NOTHING_WAITING, PAUSED_FOREVER, isPaused, pauseEnd, trayIconFile, trayMenu, trayTooltip, type TrayMode, type TrayState, type TrayStatus, type TrayWaiting } from './tray'
import { browserLogin, LOGIN_FLOWS, mattermostFlow, rocketchatSsoLogin } from './browser-login'
import { feedTwitchSignIn, twitchSignIn } from './twitch-signin'
import { answerIntegrity, mintIntegrity } from './twitch-integrity'
import { EDIT_ACTIONS, IPC, POPOUT_FLAG, UI_SHOTS_FLAG, type EditAction, type EditMenuRequest, type PopoutState } from '../shared/ipc'
import { clearnetLinks } from '../shared/clearnet'
import { readCapped, pictureNamedIn } from './imagepage'
import { DEEP_LINK_SCHEMES, isDeepLink } from '../shared/deeplink'
import { allowPickedFile, allowRoot, attachmentName, installMediaHandler, isCachedFile, registerMediaScheme } from './media-protocol'
import { installScreenShare } from './screenshare'
import { defaultDownloadDir, readMedia, saveMedia, uniquePath } from './downloads'
import {
  Anonymizer,
  buildLogExport,
  currentOsInfo,
  exportFilename,
  PASTE_GG_MAX_BYTES,
  readLogLines,
  type KnownAnonymizerNames
} from './log-export'
import { checkPasteGg, deleteFromPasteGg, LogUploadStore, toPublicUpload, uploadToPasteGg, type PasteGgFetch } from './paste-gg'
import type { Account, Buffer as ChatBuffer } from '../shared/wire'
import { log } from './log'

declare const __APP_VERSION__: string
declare const __BUILD_COMMIT__: string
import { SignalCalls } from './signal-calls'
import { applyPolicy, applyTunnel } from './tunnel'
import { installRoutedHandler, resetRoute } from './routed'

registerMediaScheme()

/**
 * A ceiling on Chromium's own HTTP cache - the pictures, emoji and embeds the
 * window loads straight from Discord's and Kick's CDNs. Left to itself it
 * sizes against free disk space and was found at 1.2GB; every other cache
 * moho keeps has a size, and this one now has one too. Settings shows it and
 * can empty it.
 */
app.commandLine.appendSwitch('disk-cache-size', String(256 * 1024 * 1024))

/**
 * One client per profile. Launching moho again - from a launcher, a terminal,
 * a desktop file - should raise the window that already exists rather than
 * start a second copy.
 *
 * Stacked copies are not merely untidy: they contend for the same daemon,
 * whose own flock lets exactly one nobilis own the socket, so the extras sit
 * there half-working. They also each hold their own notification and tray
 * state, so unread counts and alerts diverge between windows.
 *
 * The lock is per user-data directory, so an explicit `--user-data-dir` still
 * gets its own instance. That is deliberate: it keeps a throwaway profile
 * usable for testing without disturbing a running client.
 */
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) {
  app.quit()
}

/**
 * Whether this process got Chromium's sandbox.
 *
 * Read off the command line, because that is the only place the answer lives:
 * `--no-sandbox` is what turns the OS sandbox off, and whoever passed it -
 * usually the AppImage's own launcher, having found unprivileged user
 * namespaces restricted - is the one that decided.
 *
 * Not `process.sandboxed`, which is a different question wearing the same
 * word. It describes a renderer's own context - no Node, its own V8 - and
 * answers true under `--no-sandbox` just the same, so it would report a
 * sandbox that is not there.
 */
function sandboxed(): boolean {
  return !app.commandLine.hasSwitch('no-sandbox')
}

/**
 * An `irc://` link that arrived before there was a window to give it to.
 *
 * Clicking one in a browser while moho is closed launches it with the link as
 * an argument, so the link exists a second or two before anything can act on
 * it. Held here and handed over once the renderer is listening, rather than
 * dropped for arriving early.
 */
let pendingDeepLink: string | null = null

/**
 * The command that starts this binary as the daemon's web helper.
 *
 * The AppImage itself rather than the binary inside it: the daemon outlives
 * this process, and the AppImage's mount goes when it does. `--no-sandbox`
 * passes on when this process was given it - whatever made that necessary
 * here is just as true for the helper.
 */
function webHelperCommand(): string[] {
  // Headless on Linux: the helper shows nothing (its pages render offscreen),
  // and a daemon may well be running where there is no display to open.
  const extra = [...(sandboxed() ? [] : ['--no-sandbox']), ...(process.platform === 'linux' ? ['--ozone-platform=headless'] : [])]
  if (!app.isPackaged) return [process.execPath, app.getAppPath(), ...extra, '--moho-web-helper']
  return [process.env.APPIMAGE || process.execPath, ...extra, '--moho-web-helper']
}

/** The first argument that is a link this client handles, if any. */
function deepLinkIn(argv: string[]): string | null {
  return argv.find((a) => isDeepLink(a)) ?? null
}

/**
 * Passes a link to the window, or keeps it until there is one.
 *
 * The scheme is checked again here even though the desktop only sends us the
 * ones we registered for: this comes in as a command-line argument, and an
 * argument is not a promise about its own contents.
 */
function deliverDeepLink(url: string | null): void {
  if (!url || !isDeepLink(url)) return
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send(IPC.deepLink, url)
    return
  }
  pendingDeepLink = url
}

let mainWindow: BrowserWindow | null = null

/**
 * Conversations opened in a window of their own, by buffer id.
 *
 * One window per conversation rather than a free-for-all: the point of popping
 * a channel out is to watch it, and two windows watching the same channel
 * would each mark it read and each argue about where its window belongs. So
 * asking for one that is already out raises it instead.
 */
const popouts = new Map<string, BrowserWindow>()

let tray: Tray | null = null
let prefs: Prefs
let nobilis: NobilisProcess
let client: NobilisClient
let signalCalls: SignalCalls
let notifier: Notifier
let idleWatcher: IdleWatcher
let registeredHotkey: string | null = null

/**
 * Where the bundled icons and other resources actually are.
 *
 * Packaged, that is simply process.resourcesPath. Unpackaged it is not
 * app.getAppPath(): Electron given a script reports that script's *directory*
 * as the app path, which for `electron out/main/index.js` is out/main, and
 * resources live two levels up from there. Guessing wrong is quiet in the
 * worst way - the tray falls back to an empty image and the panel draws a
 * broken-icon placeholder where the icon should be - so this looks for the
 * directory rather than assuming where it is.
 */
function resourceRoot(): string {
  if (app.isPackaged) return process.resourcesPath
  let dir = app.getAppPath()
  for (let up = 0; up < 4; up++) {
    const candidate = path.join(dir, 'resources')
    if (fs.existsSync(path.join(candidate, 'icons'))) return candidate
    dir = path.dirname(dir)
  }
  return path.join(app.getAppPath(), 'resources')
}

function resourcePath(...parts: string[]): string {
  return path.join(resourceRoot(), ...parts)
}

/**
 * The Sneedchat smiley images live in the nobilis repository, next to the table
 * that names them, so the daemon's shortcode list and the files it refers to
 * can't drift apart. Packaging copies them out of the submodule; in
 * development they are read from the checkout in place.
 */
function smiliesPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'sneedchat-smilies')
    : path.join(app.getAppPath(), 'nobilis', 'resources', 'sneedchat-smilies')
}

/**
 * The image format a file's own leading bytes call for, or null.
 *
 * By content rather than by extension: the picker filters on names, which say
 * nothing about what is actually inside.
 */
function sniffImage(head: Buffer): string | null {
  const ascii = head.subarray(0, 12).toString('latin1')
  if (head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'png'
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpg'
  if (ascii.startsWith('GIF8')) return 'gif'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp'
  if (ascii.slice(4, 8) === 'ftyp' && ascii.slice(8, 12).startsWith('avi')) return 'avif'
  // SVG is text, so there are no magic bytes - look for the root element.
  if (/^\s*(<\?xml|<svg)/i.test(ascii)) return 'svg'
  return null
}

/** Every window with a renderer in it, main and popped-out conversations alike. */
/**
 * Sets a preference and tells whoever holds a copy of it.
 *
 * `except` is the window that made the change, which already knows and has
 * drawn it. The tray's own entries come through here too, so a setting flipped
 * from the tray moves its switch in Settings.
 */
function applyPref(key: string, value: unknown, except?: Electron.WebContents): void {
  prefs.set(key, value)
  // The badge and the flash are decided from these as they stand.
  if (key === 'notifications.badge' || key === 'notifications.flash') updateTray(lastTray)
  // Every window keeps its own cache of these, so a setting changed in one
  // is stale in the others until they are told. That is not cosmetic once
  // there are several windows: muting a conversation, or switching the log
  // to compact, would apply to whichever window happened to be asked.
  for (const w of liveWindows()) {
    if (w.webContents !== except) w.webContents.send(IPC.prefsChanged, key, value)
  }
  // Pins and mutes feed the tray/notification rules, which live here.
  if (key === 'pinnedBuffers' || key === 'mutedBuffers') notifier.publish()
  if (key === 'hotkey.toggle') applyHotkey(String(value))
  if (key === 'presence.autoIdle' || key === 'presence.autoIdleMinutes') idleWatcher?.evaluate()
}

/**
 * Brings up a conversation: a click on its notification, or on the tray's
 * "open" entry.
 *
 * If it has a window of its own, that window is what the click asked for.
 * Raising the main one and switching it would move somebody away from whatever
 * they were reading in order to show them a conversation that was already open
 * on their screen.
 */
function openConversation(bufferId: string): void {
  const popout = popouts.get(bufferId)
  if (popout && !popout.isDestroyed()) {
    if (popout.isMinimized()) popout.restore()
    popout.show()
    popout.focus()
    return
  }
  mainWindow?.show()
  mainWindow?.focus()
  mainWindow?.webContents.send(IPC.activateBuffer, bufferId)
}

function liveWindows(): BrowserWindow[] {
  const all = mainWindow ? [mainWindow, ...popouts.values()] : [...popouts.values()]
  return all.filter((w) => !w.isDestroyed())
}

/**
 * A daemon event, to every window.
 *
 * Each window runs its own copy of the renderer's store, so each has to be
 * told separately - a popped-out channel that only main heard about would sit
 * there frozen at whatever it held when it opened.
 */
function send(channel: string, ...args: unknown[]): void {
  for (const w of liveWindows()) w.webContents.send(channel, ...args)
}

/** The window an IPC call came from, so a handler acts on its own caller. */
function callerWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

/**
 * Put a window on screen, once.
 *
 * Not `ready-to-show` alone, which is what every one of these used to be.
 * That event is the first frame the compositor accepted, and a GPU process
 * that restarts underneath it can leave that frame - and so the event - never
 * arriving. The window then exists, holds its buffer, answers IPC and is
 * simply invisible: moho looks like it failed to start, or a conversation
 * popped out looks like a click that did nothing until a second click finds it
 * already open and raises it.
 *
 * So whichever of "painted" and "loaded" comes first is taken as good enough.
 * The gap between them is a fraction of a second of the background colour,
 * which is a far better failure than no window at all.
 */
/**
 * What to do when a window's page dies under it.
 *
 * Nothing used to be done, and nothing said: the renderer process would be
 * gone - out of memory, killed, crashed - and the window stayed on screen as an
 * empty shell with no page in it, which is what "the window just went
 * invisible" was. Now the reason is written to the log, where it outlives the
 * process, and the page is loaded again so the window comes back with the
 * conversation list and everything else intact: the daemon is a separate
 * process and kept running all along.
 *
 * Not when the app is quitting, and not more than a few times a minute: a page that dies as it loads would otherwise be reloaded for
 * ever.
 */
function recoverFromCrash(win: BrowserWindow, name: string): void {
  const recent: number[] = []
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error(
      `[window] ${name}: the page process is gone - ${details.reason} (exit code ${details.exitCode}) at ${win.isDestroyed() ? 'a destroyed window' : win.webContents.getURL()}`
    )
    // A page that exits cleanly while its window is still there is no window
    // being closed - that would have taken the window with it - and left the
    // window empty just the same. Only the app quitting is let go.
    if (win.isDestroyed() || quitting) return
    const now = Date.now()
    while (recent.length > 0 && now - recent[0] > 60_000) recent.shift()
    recent.push(now)
    if (recent.length > 3) {
      log.error(`[window] ${name}: it keeps dying; leaving it`)
      return
    }
    setTimeout(() => {
      // Loaded afresh rather than reloaded: a page that had navigated away
      // would otherwise reload wherever it had got to.
      if (!win.isDestroyed()) loadRenderer(win)
    }, 500)
  })
  win.webContents.on('unresponsive', () => log.warn(`[window] ${name}: the page has stopped responding`))
  win.webContents.on('responsive', () => log.warn(`[window] ${name}: the page is responding again`))
}

function revealOnce(win: BrowserWindow, focus = false): void {
  let done = false
  const reveal = (): void => {
    if (done || win.isDestroyed()) return
    done = true
    win.show()
    if (focus) win.focus()
  }
  win.once('ready-to-show', reveal)
  win.webContents.once('did-finish-load', reveal)
}

/**
 * Right click where text is typed. The page cannot know what Chromium's
 * spellchecker thinks of the word under the pointer, so Chromium's answer is
 * handed to the window, which draws the menu in the app's own style.
 */
function wireEditMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return
    const f = params.editFlags
    win.webContents.send(IPC.editMenu, {
      x: params.x,
      y: params.y,
      word: params.misspelledWord,
      suggestions: params.dictionarySuggestions.slice(0, 5),
      can: {
        undo: f.canUndo,
        redo: f.canRedo,
        cut: f.canCut,
        copy: f.canCopy,
        paste: f.canPaste,
        delete: f.canDelete,
        selectAll: f.canSelectAll
      },
      hasSelection: params.selectionText.length > 0,
      selection: params.selectionText.slice(0, 1000)
    } satisfies EditMenuRequest)
  })
}

/** The screenshot harness's flag, passed on to every window when it asked for it. */
const shotsArguments = process.env.MOHO_UI_SHOTS === '1' ? [UI_SHOTS_FLAG] : []

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 480,
    minHeight: 360,
    show: false,
    // The title bar is drawn by the renderer (TitleBar.tsx) so it can carry
    // the same surface treatment as the rest of the app, matching how the
    // original floating window looked.
    frame: false,
    backgroundColor: '#101418',
    icon: resourcePath('icons', 'moho.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The OS sandbox, not just the absence of Node. `sandbox: false` opts a
      // renderer out of Chromium's own process isolation entirely, which is a
      // strange thing for the process that draws untrusted text, images and
      // attachments from four networks to be doing. The preload survives it:
      // it imports nothing but `electron`, which is what a sandboxed preload
      // is allowed, and reads its popout flag from process.argv, which stays
      // readable. See the note in whenReady for the hosts that cannot honour
      // this.
      sandbox: true,
      additionalArguments: shotsArguments
    }
  })

  revealOnce(mainWindow)
  recoverFromCrash(mainWindow, 'main')
  wireEditMenu(mainWindow)

  // A link that arrived before this window existed - from the click that
  // launched moho - goes over once the renderer is listening for it. Cleared
  // as it goes, so it is acted on once rather than again on every reload.
  mainWindow.webContents.on('did-finish-load', () => {
    if (!pendingDeepLink) return
    const url = pendingDeepLink
    pendingDeepLink = null
    mainWindow?.webContents.send(IPC.deepLink, url)
  })
  // The tray's first action is to show or hide this window, and says which.
  mainWindow.on('show', refreshTrayMenu)
  mainWindow.on('hide', refreshTrayMenu)
  mainWindow.on('maximize', () => mainWindow?.webContents.send(IPC.maximizeChanged, true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send(IPC.maximizeChanged, false))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // The one window the page may open itself: a call popped out of the
    // conversation. The page draws into it directly - see StageWindow - so it
    // is blank, frameless like this one, and black before anything arrives.
    // A Kick stream popped out of moho is the same kind of window.
    // And a stream kept over everything else: the same window, small, and asked to stay on top.
    const onTop = frameName === 'moho-stream-top'
    if ((frameName === 'moho-call' || frameName === 'moho-stream' || onTop) && (url === '' || url === 'about:blank')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: onTop ? 'moho — picture-in-picture' : frameName === 'moho-stream' ? 'moho — stream' : 'moho — call',
          frame: false,
          backgroundColor: '#000000',
          minWidth: onTop ? 240 : 360,
          minHeight: onTop ? 135 : 240,
          alwaysOnTop: onTop,
          skipTaskbar: onTop,
          autoHideMenuBar: true
        }
      }
    }
    // The same schemes the window's own openExternal allows. The page now
    // holds a frame of somebody else's (a YouTube player), and a frame can
    // call window.open with anything - a file: URL or another program's
    // scheme is not something it gets to have opened.
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(mainWindow)
}

/**
 * The directory this machine keeps throwaway files in.
 *
 * Asked of Electron, which knows the platform's answer - `~/.cache`,
 * `%LOCALAPPDATA%`, `~/Library/Caches` - but does not list `cache` among the
 * names in `getPath`'s typings, hence the widened signature and the guard.
 *
 * The fallback is the XDG rule, and it is a fallback rather than the rule
 * because on Windows it produces `C:\Users\<name>\.cache`: a dotfile
 * directory in the profile root, which works and is not where anything else on
 * that system looks. nobilis learned that one the hard way with its own data
 * directory - see `default_data_dir` there.
 */
function cacheRoot(): string {
  try {
    return (app.getPath as (name: string) => string)('cache')
  } catch {
    return process.env['XDG_CACHE_HOME'] || path.join(app.getPath('home'), '.cache')
  }
}

function loadRenderer(win: BrowserWindow): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/** What is popped out, and what of it is actually on screen. */
function popoutState(): PopoutState {
  const open: string[] = []
  const watched: string[] = []
  for (const [bufferId, win] of popouts) {
    if (win.isDestroyed()) continue
    open.push(bufferId)
    if (win.isVisible() && !win.isMinimized()) watched.push(bufferId)
  }
  return { open, watched }
}

function publishPopouts(): void {
  send(IPC.popoutsChanged, popoutState())
  // The tray counts what is unread, and a watched conversation is not.
  notifier?.publish()
}

/**
 * Where this conversation's window was last left.
 *
 * Remembered per conversation rather than one size for all of them, because
 * the reason to pop several out is to arrange them - and an arrangement that
 * has to be rebuilt every session is not one worth making.
 *
 * A remembered position is only honoured if some display still contains it.
 * Monitors get unplugged, and a window restored onto one that is no longer
 * there opens somewhere nobody can reach.
 */
function savedPopoutBounds(bufferId: string): Partial<Electron.Rectangle> {
  const all = prefs.get<Record<string, Electron.Rectangle>>('ui.popoutBounds', {}) ?? {}
  const b = all[bufferId]
  if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return {}
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return { width: b.width, height: b.height }

  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    // Overlap rather than containment: half off the edge of a display is a
    // position somebody chose, and dragging it back is trivial. Entirely
    // outside every display is not.
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
  })
  return onScreen ? b : { width: b.width, height: b.height }
}

function rememberPopoutBounds(bufferId: string, win: BrowserWindow): void {
  // A maximised or minimised window's bounds are the state it is in, not the
  // size it should come back as.
  if (win.isDestroyed() || win.isMaximized() || win.isMinimized() || !win.isVisible()) return
  const all = { ...(prefs.get<Record<string, Electron.Rectangle>>('ui.popoutBounds', {}) ?? {}) }
  all[bufferId] = win.getBounds()
  prefs.set('ui.popoutBounds', all)
}

/**
 * Opens a conversation in a window of its own, or raises the one it has.
 *
 * The window loads the same renderer as everything else and is told which
 * conversation it is; what makes it a popout is only that its store is pinned
 * to that one buffer, so every part of a conversation - the log, the composer,
 * the member list, dropping a file on it - is the same code doing the same job
 * in a smaller frame.
 */
function openPopout(bufferId: string, title?: string): void {
  const existing = popouts.get(bufferId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }

  const win = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 320,
    minHeight: 240,
    ...savedPopoutBounds(bufferId),
    show: false,
    frame: false,
    backgroundColor: '#101418',
    icon: resourcePath('icons', 'moho.png'),
    title: title ?? 'moho',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // As the main window - a popout draws the same conversations.
      sandbox: true,
      additionalArguments: [`${POPOUT_FLAG}${bufferId}`, ...shotsArguments]
    }
  })
  popouts.set(bufferId, win)

  // Focused as well as shown: unlike the main window at startup, this one was
  // asked for just now.
  revealOnce(win, true)
  recoverFromCrash(win, `popout ${bufferId}`)
  wireEditMenu(win)

  // Sent to this window rather than broadcast: every window draws its own
  // title bar, and they are not maximised together.
  win.on('maximize', () => win.webContents.send(IPC.maximizeChanged, true))
  win.on('unmaximize', () => win.webContents.send(IPC.maximizeChanged, false))
  // Whether this conversation counts as watched changes with the window, so
  // every one of these has to be answered - a minimised popout badges and
  // alerts again, and a restored one stops.
  win.on('show', publishPopouts)
  win.on('hide', publishPopouts)
  win.on('minimize', publishPopouts)
  win.on('restore', publishPopouts)
  // Coming back into view is reading it: whatever piled up while this window
  // was minimised has now been looked at, and should stop lighting the tray.
  const seen = (): void => notifier?.clear(bufferId)
  win.on('show', seen)
  win.on('restore', seen)
  win.on('focus', seen)
  win.on('resize', () => rememberPopoutBounds(bufferId, win))
  win.on('move', () => rememberPopoutBounds(bufferId, win))
  win.on('closed', () => {
    popouts.delete(bufferId)
    publishPopouts()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    // As the main window's: web addresses only, whatever a frame asks for.
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(win)
  publishPopouts()
}

function toggleWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide()
  else {
    mainWindow.show()
    mainWindow.focus()
  }
}

/**
 * What a left click on the tray icon does: put the window away if it is showing, bring it back if it is not.
 *
 * By whether it is showing, and not by whether it has focus. Clicking the tray takes the focus off the window first
 * on most desktops, so asking whether it is focused always said no, and a click could only ever show the window -
 * never put it away. The hotkey keeps the focus test (see `toggleWindow`): pressed while typing somewhere else it
 * means "bring moho here", not "hide it".
 */
function toggleFromTray(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** When notifications were paused until, in milliseconds: 0 for not, PAUSED_FOREVER for no end. */
const pausedUntil = (): number => prefs.get<number>('notifications.pausedUntil', 0)
const notificationsPaused = (): boolean => isPaused(pausedUntil(), Date.now())
let pauseTimer: ReturnType<typeof setTimeout> | null = null

/** Pauses notifications until then, or ends a pause with 0, and redraws the tray when the pause runs out. */
function setPausedUntil(until: number): void {
  prefs.set('notifications.pausedUntil', until)
  if (pauseTimer) clearTimeout(pauseTimer)
  pauseTimer = null
  const left = until - Date.now()
  // A timer cannot be set further out than about 24 days; a pause never is.
  if (until > 0 && left > 0) pauseTimer = setTimeout(() => updateTray(lastTray), Math.min(left + 500, 2 ** 31 - 1))
  updateTray(lastTray)
}

/** "until 14:30", by the clock the system uses. */
function pausedWords(): string | null {
  const until = pausedUntil()
  if (!isPaused(until, Date.now())) return null
  if (until === PAUSED_FOREVER) return 'until turned back on'
  const end = new Date(until)
  const time = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return end.toDateString() === new Date().toDateString() ? `until ${time}` : `until tomorrow, ${time}`
}

/**
 * What the icon says besides the count: that nothing can arrive, or that what arrives will not be announced.
 * Offline is the daemon not answering or no account connected - the window says which accounts are.
 */
function trayMode(): TrayMode {
  if (!client.linkUp || Object.keys(accountStatus).length === 0) return 'offline'
  if (trayStatus === 'dnd' || notificationsPaused()) return 'quiet'
  return 'normal'
}

function trayIcon(unread: number): Electron.NativeImage {
  lastTrayIcon = trayIconFile(nativeTheme.shouldUseDarkColors, unread, trayMode())
  const img = nativeImage.createFromPath(resourcePath('icons', lastTrayIcon))
  // A missing icon file would otherwise produce an invisible tray entry the
  // user can never click; fall back to the app icon so the entry still exists.
  return img.isEmpty() ? nativeImage.createFromPath(resourcePath('icons', 'moho.png')) : img
}

/** What the window last said each connected account's status is. */
let accountStatus: Record<string, string> = {}
/** The status the menu shows as checked, and the ones it offers: what the connected accounts can be set to. */
let trayStatus: TrayStatus | null = null
let trayOffered: TrayStatus[] = []
let trayInvisibleName = 'Invisible'
const isTrayStatus = (v: unknown): v is TrayStatus => v === 'online' || v === 'idle' || v === 'dnd' || v === 'invisible'

/**
 * Asks the window to do something, showing it first: the tray's entries that
 * are about moho itself - settings, and a status set across every account -
 * are the window's to carry out, since it is what holds the accounts.
 */
function tellWindow(command: 'settings' | 'status' | 'mentions' | 'markAllRead', arg?: string): void {
  if (!mainWindow) createWindow()
  if (command === 'settings' || command === 'mentions') {
    mainWindow?.show()
    mainWindow?.focus()
  }
  mainWindow?.webContents.send(IPC.trayCommand, command, arg)
}

/**
 * Starts moho again, daemon and all.
 *
 * Quitting already takes the daemon down cleanly - QUIT to every network, then
 * gone - and the new process starts its own, so restarting is quit-and-relaunch.
 * An AppImage has to be relaunched by the path it was started from: its
 * executable is a temporary mount that disappears when it exits.
 */
function restartMoho(): void {
  const appImage = process.env.APPIMAGE
  app.relaunch(appImage ? { execPath: appImage, args: process.argv.slice(1) } : undefined)
  app.quit()
}

/** What the tray last offered and showed, kept for the UI harness to read. */
let lastTrayMenu: MenuItemConstructorOptions[] = []
let lastTrayIcon = ''
let lastTrayTooltip = 'moho'

function refreshTrayMenu(): void {
  if (!tray) return
  lastTrayMenu = trayMenu(
    {
      state: lastTray,
      windowVisible: !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(),
      status: trayStatus,
      offered: trayOffered,
      invisibleName: trayInvisibleName,
      paused: pausedWords(),
      version: app.getVersion()
    },
    {
      toggleWindow,
      openLatest: () => {
        const id = lastTray.latest ?? notifier.latestUnread()
        if (id) openConversation(id)
      },
      openConversation,
      openMentions: () => tellWindow('mentions'),
      markAllRead: () => tellWindow('markAllRead'),
      pause: (choice) => setPausedUntil(pauseEnd(choice, Date.now())),
      resume: () => setPausedUntil(0),
      openSettings: () => tellWindow('settings'),
      setStatus: (status) => {
        trayStatus = status
        tellWindow('status', status)
      },
      restart: restartMoho,
      quit: () => app.quit()
    }
  )
  tray.setContextMenu(Menu.buildFromTemplate(lastTrayMenu))
}

function createTray(): void {
  tray = new Tray(trayIcon(0))
  tray.setToolTip('moho')
  refreshTrayMenu()
  tray.on('click', toggleFromTray)
  // The icon is drawn for the panel it sits on, so it is drawn again when the
  // system changes colour scheme.
  nativeTheme.on('updated', () => updateTray(lastTray))
}

/** What the notifier last said, kept so a change of setting can redraw without waiting for the next message. */
let lastTray: TrayState = NOTHING_WAITING

function updateTray(state: TrayState): void {
  lastTray = state
  // The unread badge: the tray's count and the launcher's count where the
  // desktop has one. Off, the tray is just the tray.
  const badge = prefs.get<boolean>('notifications.badge', true)
  app.setBadgeCount(badge ? state.unread : 0)
  // The taskbar flash: asking for attention while the window is not in front.
  const flash = prefs.get<boolean>('notifications.flash', true)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.flashFrame(flash && state.unread > 0 && trayStatus !== 'dnd' && !notificationsPaused() && !mainWindow.isFocused())
  }
  refreshTrayMenu()
  if (!tray) return
  tray.setImage(trayIcon(badge ? state.unread : 0))
  lastTrayTooltip = trayTooltip(state, badge, trayMode(), notificationsPaused() ? 'notifications paused' : 'do not disturb')
  tray.setToolTip(lastTrayTooltip)
  send(IPC.link, client.linkUp)
}

const SOCKET_PATH = defaultSocketPath()

/**
 * Stop the daemon and wait for it to be gone. Asking over the socket is what
 * reaches a daemon this process adopted; a spawned one is signalled directly.
 * Either way nobilis sends real QUITs to every connected network on the way
 * out, so this waits rather than cutting them short.
 */
async function stopDaemon(): Promise<void> {
  await nobilis.stopAndWait(SOCKET_PATH, () => client.request('shutdown'))
  client.stop()
  send(IPC.link, false)
}

function applyHotkey(accelerator: string): void {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey)
    registeredHotkey = null
  }
  if (!accelerator) return
  try {
    if (globalShortcut.register(accelerator, toggleWindow)) registeredHotkey = accelerator
    else log.warn('[hotkey] refused by the system:', accelerator)
  } catch (e) {
    log.warn('[hotkey] invalid accelerator:', accelerator, (e as Error).message)
  }
}

app.on('child-process-gone', (_e, details) => {
  // The graphics process or a utility: a window that stops painting with its
  // page still alive is this.
  log.error(`[process] ${details.type} process gone - ${details.reason} (exit code ${details.exitCode})`)
})

function wireIpc(): void {
  // Signal calls (RingRTC, in this process). Answered as a value, like rpc, so the window sees the words.
  ipcMain.handle(IPC.signalCall, async (_e, action: string, params: Record<string, unknown> = {}) => {
    try {
      switch (action) {
        case 'available':
          return { ok: true, result: signalCalls.available() }
        case 'current':
          return { ok: true, result: signalCalls.current() }
        case 'start':
          await signalCalls.start(String(params.accountId), String(params.bufferId), String(params.remote), !!params.video)
          return { ok: true, result: null }
        case 'accept':
          signalCalls.accept(!!params.video)
          return { ok: true, result: null }
        case 'decline':
          signalCalls.decline()
          return { ok: true, result: null }
        case 'hangup':
          signalCalls.hangup()
          return { ok: true, result: null }
        case 'mute':
          signalCalls.mute(params.audio as boolean | undefined, params.video as boolean | undefined)
          return { ok: true, result: null }
        case 'share':
          signalCalls.share(!!params.on)
          return { ok: true, result: null }
        case 'currentGroup':
          return { ok: true, result: signalCalls.currentGroup() }
        case 'readCallLink':
          return { ok: true, result: await signalCalls.readCallLink(String(params.accountId), String(params.link)) }
        case 'createCallLink':
          return { ok: true, result: await signalCalls.createCallLink(String(params.accountId), String(params.name ?? ''), !!params.approval) }
        case 'updateCallLink':
          return {
            ok: true,
            result: await signalCalls.updateCallLink(String(params.accountId), String(params.link), {
              name: params.name === undefined ? undefined : String(params.name),
              approval: params.approval === undefined ? undefined : !!params.approval
            })
          }
        case 'deleteCallLink':
          await signalCalls.deleteCallLink(String(params.accountId), String(params.link))
          return { ok: true }
        case 'joinCallLink':
          await signalCalls.joinCallLink(String(params.accountId), String(params.link), !!params.video)
          return { ok: true }
        case 'joinGroup':
          await signalCalls.joinGroup(String(params.bufferId), !!params.video, !!params.ring)
          return { ok: true, result: null }
        case 'leaveGroup':
          signalCalls.leaveGroup()
          return { ok: true, result: null }
        case 'muteGroup':
          signalCalls.muteGroup(params.audio as boolean | undefined, params.video as boolean | undefined)
          return { ok: true, result: null }
        case 'shareGroup':
          signalCalls.shareGroup(!!params.on)
          return { ok: true, result: null }
        case 'reactInGroup':
          signalCalls.reactInGroup(String(params.value))
          return { ok: true, result: null }
        case 'raiseHand':
          signalCalls.raiseHand(!!params.up)
          return { ok: true, result: null }
        case 'answerJoinRequest':
          signalCalls.answerJoinRequest(String(params.userId), !!params.letIn)
          return { ok: true, result: null }
        case 'declineGroupRing':
          signalCalls.declineGroupRing(String(params.groupId), String(params.ringId))
          return { ok: true, result: null }
        default:
          return { ok: false, error: `no Signal call action "${action}"` }
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.on(IPC.signalCallFrame, (_e, width: number, height: number, rgba: Uint8Array) => signalCalls.sendFrame(width, height, rgba))
  ipcMain.handle(IPC.rpc, async (_e, method: string, params: Record<string, unknown>) => {
    try {
      return { ok: true, result: await client.request(method, params) }
    } catch (err) {
      // Surfaced as a value rather than a rejection so the renderer sees
      // nobilis's own error text (which is often the actionable part - "account
      // not connected", "no such buffer") instead of a generic IPC failure.
      return { ok: false, error: (err as Error).message }
    }
  })

  // A downloaded file, opened or shown where it is. The window says which
  // transfer and what to do; where that is on disk is the daemon's to say,
  // asked here. A path from the page is never opened: it is the one process
  // that renders what strangers send, and "open this file" is not something
  // it should be able to ask of an arbitrary path.
  ipcMain.handle(IPC.transferFile, async (_e, action: string, id: string): Promise<{ error?: string }> => {
    try {
      if (action === 'folder') {
        const dcc = (await client.request('getDccPrefs', {})) as { resolvedDirectory?: string }
        const dir = dcc.resolvedDirectory
        if (!dir || !fs.existsSync(dir)) return { error: 'The downloads folder does not exist yet. It is made when the first file arrives.' }
        const failed = await shell.openPath(dir)
        return failed ? { error: failed } : {}
      }
      const all = (await client.request('listTransfers', {})) as { id: string; path?: string | null }[]
      const file = all.find((t) => t.id === id)?.path
      if (!file) return { error: 'moho has no record of where that file went.' }
      if (!fs.existsSync(file)) {
        // Moved, renamed or deleted since. Its folder is the next best thing to show, if that is still there.
        const dir = path.dirname(file)
        if (action === 'reveal' && fs.existsSync(dir)) {
          const failed = await shell.openPath(dir)
          return failed ? { error: failed } : { error: 'The file is no longer there. This is the folder it was saved to.' }
        }
        return { error: 'The file is no longer where it was saved.' }
      }
      if (action === 'reveal') {
        shell.showItemInFolder(file)
        return {}
      }
      const failed = await shell.openPath(file)
      return failed ? { error: failed } : {}
    } catch (err) {
      return { error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.prefsGetAll, () => prefs.all())
  ipcMain.handle(IPC.prefsSet, (e, key: string, value: unknown) => applyPref(key, value, e.sender))

  // The window says what status its accounts are at, for the tray's menu to check.
  ipcMain.on(IPC.trayStatus, (_e, statuses: Record<string, string>, offered: string[], shown: string | null, invisibleName: string) => {
    accountStatus = statuses && typeof statuses === 'object' ? statuses : {}
    trayOffered = Array.isArray(offered) ? offered.filter(isTrayStatus) : []
    trayStatus = isTrayStatus(shown) ? shown : null
    trayInvisibleName = invisibleName === 'Offline' ? 'Offline' : 'Invisible'
    refreshTrayMenu()
    // Do not disturb is asking for quiet, including from the taskbar.
    updateTray(lastTray)
  })

  ipcMain.on(IPC.activity, () => idleWatcher.activity())

  // What is waiting, as the window counts it. The tray's number is the window's
  // own: counted here from notifications it drifted from what the window showed.
  ipcMain.on(IPC.trayUnread, (_e, count: { dms: number; mentions: number; latest: string | null; waiting?: unknown }) => {
    const dms = Math.max(0, Number(count?.dms) || 0)
    const mentions = Math.max(0, Number(count?.mentions) || 0)
    // Names come from the services, so they are taken as text and nothing else, and not many of them.
    const waiting: TrayWaiting[] = (Array.isArray(count?.waiting) ? count.waiting : [])
      .filter((w): w is TrayWaiting => !!w && typeof w.id === 'string' && typeof w.name === 'string')
      .slice(0, 20)
      .map((w) => ({ id: w.id, name: w.name.replace(/[\r\n]+/g, ' ').slice(0, 80), count: Math.max(1, Number(w.count) || 1), direct: !!w.direct }))
    updateTray({ unread: dms + mentions, dms, mentions, latest: typeof count?.latest === 'string' ? count.latest : null, waiting })
  })

  ipcMain.handle(IPC.markBufferRead, (_e, bufferId: string) => notifier.clear(bufferId))

  // Every window draws its own title bar, so these act on whichever window
  // asked rather than on the main one - a popout's minimise button used to
  // minimise the window behind it.
  ipcMain.handle(IPC.windowMinimize, (e) => callerWindow(e)?.minimize())
  ipcMain.handle(IPC.windowToggleMaximize, (e) => {
    const win = callerWindow(e)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle(IPC.windowClose, (e) => {
    const win = callerWindow(e)
    if (!win) return
    // Closing the main window hides it to the tray, which is where moho's
    // lifetime lives. A popout has no such role: closing one is meant to be
    // closing it, and hiding it instead would leave a conversation marked as
    // watched with no window to watch it in.
    if (win === mainWindow) win.hide()
    else win.close()
  })
  ipcMain.handle(IPC.windowIsMaximized, (e) => callerWindow(e)?.isMaximized() ?? false)

  ipcMain.handle(IPC.popoutOpen, (_e, bufferId: string, title?: string) => {
    if (typeof bufferId === 'string' && bufferId) openPopout(bufferId, title)
  })
  ipcMain.handle(IPC.popoutClose, (_e, bufferId: string, andShow?: boolean) => {
    const win = popouts.get(bufferId)
    if (win && !win.isDestroyed()) win.close()
    // Putting a conversation back means it should still be in front of you.
    if (!andShow || !mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send(IPC.activateBuffer, bufferId)
  })
  ipcMain.handle(IPC.popoutList, () => popoutState())

  /**
   * Which picture a page is showing.
   *
   * Forum posts wrap a thumbnail in a link to the image host's *page* - the
   * picture is one thing on it - so the only address the message carries for
   * the full-size copy is a page address. Every such host says what it is
   * showing in an OpenGraph tag, because every one of them wants a preview
   * when the link is pasted into a chat window, so one request and one tag
   * answers it for all of them with no per-host knowledge.
   *
   * In the main process because a `file://` document cannot read a
   * cross-origin reply, and asked only when somebody opens a picture - never
   * as a message arrives.
   */
  ipcMain.handle(IPC.resolveImagePage, async (_e, raw: string): Promise<string | null> => {
    let page: URL
    try {
      page = new URL(clearnetLinks(raw))
    } catch {
      return null
    }
    if (page.protocol !== 'https:') return null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      // Electron's net, not Node's fetch: it goes where the session's proxy
      // says, so a tunnelled window's previews are tunnelled too.
      const res = await net.fetch(page.toString(), { signal: controller.signal, redirect: 'follow' })
      // Only a page has the tag, and only a page is small enough to read
      // without asking how big it is first. Anything else - a file, a stream,
      // a download - is refused before a byte of the body is touched.
      if (!res.ok || !(res.headers.get('content-type') || '').startsWith('text/html')) return null
      const html = await readCapped(res)
      return pictureNamedIn(html, page)
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  })

  ipcMain.handle(IPC.openExternal, (_e, raw: string) => {
    // The forum's onion address, sent to the browser as the clearnet one it is
    // the same site as. Here as well as in the window because a link is not
    // always something a message said: a picture fetched from the site carries
    // an address of its own, and "open in browser" on one of those would hand
    // the system a name it cannot resolve.
    const url = clearnetLinks(raw)
    // Only ever hand the OS a real web/mail link - a message body is fully
    // attacker-controlled, and shell.openExternal will happily launch things
    // like `file://` or a custom app scheme otherwise.
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
  })

  // An article, drawn from a document the daemon built (see nobilis's backend/telegram/instant.rs). It gets a window
  // of its own that can do nothing but show it: no script, no preload, no way to navigate away - a link opens in the
  // browser - and the only pictures it may draw are the daemon's cached ones, through moho-media.
  ipcMain.handle(IPC.openArticle, (_e, title: unknown, html: unknown) => {
    if (typeof html !== 'string' || html.length > 8_000_000) return
    const win = new BrowserWindow({
      width: 900,
      height: 800,
      minWidth: 360,
      minHeight: 300,
      autoHideMenuBar: true,
      backgroundColor: '#0e1621',
      icon: resourcePath('icons', 'moho.png'),
      title: typeof title === 'string' && title ? title : 'Article',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false }
    })
    const external = (url: string): void => {
      if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    }
    win.webContents.setWindowOpenHandler(({ url }) => {
      external(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      // A place in the same page is fine; anything else is somewhere else.
      if (url.startsWith('data:') && url.includes('#')) return
      event.preventDefault()
      external(url)
    })
    void win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`)
  })

  // Where to write something the app is about to produce - a key export, so
  // far. Separate from pickFile because the two dialogs ask opposite
  // questions, and a save dialog that cannot name a default file is a save
  // dialog people cancel.
  ipcMain.handle(IPC.pickSavePath, async (e, suggested?: string) => {
    const parent = callerWindow(e) ?? mainWindow
    if (!parent) return null
    const res = await dialog.showSaveDialog(parent, { defaultPath: suggested })
    return res.canceled || !res.filePath ? null : res.filePath
  })

  // A file someone sent - a document, an archive, anything that is not drawn - saved where the person chooses. Saved,
  // never opened: the file is whatever its sender made it, and handing it to the system to open could run it. Only a
  // file the daemon keeps in its caches (see isCachedFile); 'missing' tells the window to have the daemon fetch it
  // first, as a file that was never downloaded or that the cache let go is not there yet.
  ipcMain.handle(IPC.saveAttachment, async (e, raw: unknown, name: unknown) => {
    if (typeof raw !== 'string') return 'refused'
    let cached: string
    try {
      cached = raw.startsWith('file:') ? fileURLToPath(raw) : raw
    } catch {
      return 'refused'
    }
    if (!fs.existsSync(cached)) return 'missing'
    if (!isCachedFile(cached)) return 'refused'
    const parent = callerWindow(e) ?? mainWindow
    if (!parent) return 'cancelled'
    const res = await dialog.showSaveDialog(parent, { defaultPath: path.join(app.getPath('downloads'), attachmentName(name)) })
    if (res.canceled || !res.filePath) return 'cancelled'
    await fsp.copyFile(fs.realpathSync(cached), res.filePath)
    return 'saved'
  })

  // Only for the check scripts, which cannot press a native dialog: files named in the environment are handed out in turn.
  const scriptedPicks = process.env.MOHO_UI_SHOTS === '1' && process.env.MOHO_PICK_FILES ? process.env.MOHO_PICK_FILES.split('\n').filter(Boolean) : []
  ipcMain.handle(IPC.pickFile, async (e, extensions?: string[]) => {
    const parent = callerWindow(e) ?? mainWindow
    if (!parent) return null
    const scripted = scriptedPicks.shift()
    if (scripted) {
      allowPickedFile(scripted)
      return scripted
    }
    // Where a service takes only some kinds of file, the dialog shows only
    // those and has no "all files" to widen it: a file that would be refused
    // is not offered. Extensions only, as the dialog wants them - no dots.
    const taken = Array.isArray(extensions)
      ? extensions.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9]{1,8}$/.test(x))
      : []
    const res = await dialog.showOpenDialog(parent, {
      properties: ['openFile'],
      ...(taken.length ? { filters: [{ name: 'Pictures and videos', extensions: taken }] } : {})
    })
    if (res.canceled || !res.filePaths[0]) return null
    // The renderer draws a thumbnail of what was staged, and that goes back
    // through the guarded media scheme like every other local file. Where
    // somebody keeps their pictures is not an allowed root and should not
    // become one, so the picked file is permitted on its own.
    allowPickedFile(res.filePaths[0])
    return res.filePaths[0]
  })

  ipcMain.handle(IPC.pickDirectory, async (e) => {
    const parent = callerWindow(e) ?? mainWindow
    if (!parent) return null
    const res = await dialog.showOpenDialog(parent, {
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  // Where downloads land when the user hasn't chosen somewhere. Electron
  // resolves this per-platform - XDG_DOWNLOAD_DIR on Linux, FOLDERID_Downloads
  // on Windows - with one guard for where that lookup degrades; see
  // defaultDownloadDir.
  ipcMain.handle(IPC.defaultDownloadDir, () => defaultDownloadDir(app.getPath('downloads')))

  ipcMain.handle(IPC.downloadMedia, async (_e, source: string, filename?: string) =>
    saveMedia(
      source,
      filename,
      String(prefs.get('downloads.directory', '') || defaultDownloadDir(app.getPath('downloads'))),
      // Electron's net rather than global fetch: it follows the app's own
      // proxy and certificate settings, which a plain fetch would not.
      async (url) => {
        const res = await net.fetch(url)
        return {
          ok: res.ok,
          status: res.status,
          bytes: async () => new Uint8Array(await res.arrayBuffer())
        }
      }
    )
  )

  /**
   * Picks an image and keeps a copy as a rail entry's icon.
   *
   * Copied into the app's own directory rather than referenced where it sits:
   * the original may be on removable media, in a temp folder, or simply moved
   * later, and an icon that silently disappears is worse than none. That
   * directory is already a permitted media root, so the renderer can load it
   * back through the same guarded scheme as everything else.
   */
  ipcMain.handle(IPC.importGroupIcon, async (e, groupId: string) => {
    const parent = callerWindow(e) ?? mainWindow
    if (!parent) return { error: 'no window' }
    const res = await dialog.showOpenDialog(parent, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] }]
    })
    if (res.canceled || !res.filePaths[0]) return {}
    try {
      const source = res.filePaths[0]
      // Trust the bytes, not the extension - a file named .png that isn't one
      // would render as a broken tile with nothing to explain why.
      const head = await fsp.readFile(source, { flag: 'r' }).then((b) => b.subarray(0, 16))
      const kind = sniffImage(head)
      if (!kind) return { error: 'that file is not an image moho can display' }

      const dir = path.join(app.getPath('userData'), 'group-icons')
      await fsp.mkdir(dir, { recursive: true })
      // Named for the group, so replacing an icon leaves nothing behind, with
      // a cache-buster since the path is what the renderer keys on.
      const safe = groupId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80)
      for (const stale of await fsp.readdir(dir).catch(() => [])) {
        if (stale.startsWith(`${safe}.`)) await fsp.rm(path.join(dir, stale)).catch(() => {})
      }
      const target = path.join(dir, `${safe}.${Date.now()}.${kind}`)
      await fsp.copyFile(source, target)
      return { path: target }
    } catch (e) {
      return { error: (e as Error).message }
    }
  })

  // The edit menu's verbs. Chromium does these to whatever has focus in the
  // window that asked, which is what makes paste go through the box's own
  // paste handling and cut and delete go through its undo history.
  ipcMain.handle(IPC.editAction, (e, action: EditAction) => {
    if (!EDIT_ACTIONS.includes(action)) return
    e.sender[action]()
  })
  ipcMain.handle(IPC.replaceMisspelling, (e, word: string) => {
    if (typeof word === 'string' && word) e.sender.replaceMisspelling(word)
  })
  ipcMain.handle(IPC.addToDictionary, (e, word: string) => {
    if (typeof word === 'string' && word) e.sender.session.addWordToSpellCheckerDictionary(word)
  })

  ipcMain.handle(IPC.readClipboardImage, async () => {
    // Electron 44 replaced the synchronous clipboard with the W3C shape:
    // asynchronous, and addressed by MIME type rather than by readImage().
    const items = await clipboard.read()
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (!type) continue
      const blob = (await item.getType(type)) as Blob
      const dir = path.join(os.tmpdir(), 'moho-paste')
      fs.mkdirSync(dir, { recursive: true })
      const ext = type.slice('image/'.length).split(/[;+]/)[0] || 'png'
      const file = path.join(dir, `paste-${Date.now()}.${ext}`)
      fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()))
      // Drawn in the composer before it is sent - and allowed by name, since
      // the temp directory as a whole is not something the window may read.
      allowPickedFile(file)
      return file
    }
    return null
  })

  // Putting something on the clipboard from here rather than through the
  // page's own `navigator.clipboard`, which wants a secure context and a
  // permission this app has no way to grant itself. Text only: the renderer
  // has no business writing anything else onto the system clipboard.
  ipcMain.handle(IPC.writeClipboardText, (_e, text: string) => {
    if (typeof text === 'string' && text.length > 0) clipboard.writeText(text)
  })

  // A picture on the clipboard, for pasting into another app. Taken from the
  // page's own pixels when it could read them (that also covers formats the
  // clipboard does not take as they are, such as WebP), and otherwise from
  // wherever the picture lives.
  ipcMain.handle(IPC.copyImage, async (_e, source: string, dataUrl?: string) => {
    try {
      const img =
        typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')
          ? nativeImage.createFromDataURL(dataUrl)
          : nativeImage.createFromBuffer(
              Buffer.from(
                await readMedia(String(source), async (url) => {
                  const res = await net.fetch(url)
                  return { ok: res.ok, status: res.status, bytes: async () => new Uint8Array(await res.arrayBuffer()) }
                })
              )
            )
      if (img.isEmpty()) return { error: "this kind of picture can't be copied" }
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })])
      return {}
    } catch (e) {
      return { error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.fileSize, async (_e, file: string) => {
    try {
      const st = await fsp.stat(String(file))
      return st.isFile() ? st.size : null
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.restartDaemon, () => nobilis.restart())
  ipcMain.handle(IPC.daemonStatus, () => ({
    binaryPath: nobilis.binaryPath,
    available: nobilis.available(),
    linkUp: client.linkUp
  }))

  // Anonymized log export (Downloads & paste.gg) - issue #343.
  const logUploads = new LogUploadStore(path.join(app.getPath('userData'), 'log-uploads.json'))
  const pasteFetch: PasteGgFetch = async (url, init) => {
    const res = await net.fetch(url, init)
    return { ok: res.ok, status: res.status, text: () => res.text() }
  }
  const collectLogs = async (maxBytes?: number) => {
    let nobilisVersion = client.linkUp ? 'not reported' : 'not connected'
    let nobilisBuild = client.linkUp ? 'unknown' : 'not connected'
    let tunnel = 'unknown'
    let backends: string | undefined
    const knownUsers = new Set<string>()
    const knownServers = new Set<string>()
    const knownGuilds = new Set<string>()
    const knownChannels = new Set<string>()
    const knownRooms = new Set<string>()
    const knownAccounts = new Set<string>()

    if (client.linkUp) {
      const [verRes, acctRes, bufRes, tunRes] = await Promise.allSettled([
        client.request('version', {}) as Promise<{ version?: string; commit?: string } | null>,
        client.request('listAccounts', {}) as Promise<Account[] | null>,
        client.request('listBuffers', {}) as Promise<ChatBuffer[] | null>,
        client.request('netTunnel', {}) as Promise<{ tunnelAll?: boolean; socks?: string | null } | null>
      ])

      if (verRes.status === 'fulfilled' && verRes.value) {
        if (verRes.value.version) nobilisVersion = verRes.value.version
        if (verRes.value.commit) nobilisBuild = verRes.value.commit
      }

      if (tunRes.status === 'fulfilled' && tunRes.value) {
        tunnel = tunRes.value.tunnelAll
          ? tunRes.value.socks
            ? 'tunnel-all (socks)'
            : 'tunnel-all (offline)'
          : 'direct'
      }

      if (acctRes.status === 'fulfilled' && Array.isArray(acctRes.value)) {
        const counts = new Map<string, { connected: number; total: number }>()
        for (const a of acctRes.value) {
          const entry = counts.get(a.service) ?? { connected: 0, total: 0 }
          entry.total++
          if (a.state === 'connected') entry.connected++
          counts.set(a.service, entry)

          if (a.id) {
            knownAccounts.add(a.id)
            const colon = a.id.indexOf(':')
            const tail = colon >= 0 ? a.id.slice(colon + 1) : a.id
            const at = tail.indexOf('@')
            if (at > 0 && at < tail.length - 1) {
              knownUsers.add(tail.slice(0, at))
              knownServers.add(tail.slice(at + 1).split('/')[0])
            } else if (tail) {
              knownUsers.add(tail)
            }
          }
          if (a.displayName) knownUsers.add(a.displayName)
          if (a.currentNick) knownUsers.add(a.currentNick)
          if (a.saslUsername) knownUsers.add(a.saslUsername)
          if (a.sneedchatRooms) {
            for (const r of a.sneedchatRooms) {
              if (r.name) knownRooms.add(r.name)
            }
          }
        }
        if (counts.size > 0) {
          backends = [...counts.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([svc, c]) => `${svc}(${c.connected}/${c.total})`)
            .join(', ')
        }
      }

      if (bufRes.status === 'fulfilled' && Array.isArray(bufRes.value)) {
        for (const b of bufRes.value) {
          if (!b.name) continue
          const slash = b.name.indexOf('/')
          if (slash > 0 && slash < b.name.length - 1) {
            knownGuilds.add(b.name.slice(0, slash))
            knownChannels.add(b.name.slice(slash + 1))
          } else if (b.kind === 'dm') {
            knownUsers.add(b.name)
          } else if (b.name.startsWith('#')) {
            knownChannels.add(b.name)
          } else {
            knownRooms.add(b.name)
          }
        }
      }
    }

    const displayServer =
      process.platform === 'linux'
        ? process.env.XDG_SESSION_TYPE ||
          (process.env.WAYLAND_DISPLAY ? 'wayland' : process.env.DISPLAY ? 'x11' : 'headless')
        : process.platform
    const packaging = !app.isPackaged ? 'development' : process.env.APPIMAGE ? 'AppImage' : 'packaged'
    const known: KnownAnonymizerNames = {
      accounts: knownAccounts,
      users: knownUsers,
      servers: knownServers,
      guilds: knownGuilds,
      channels: knownChannels,
      rooms: knownRooms
    }

    const rawLines = await readLogLines(log.dir())
    return buildLogExport(
      rawLines,
      {
        mohoVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : app.getVersion(),
        mohoBuild: typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'unknown',
        nobilisVersion,
        nobilisBuild,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        ...currentOsInfo(),
        displayServer,
        packaging,
        sandboxed: sandboxed(),
        tunnel,
        backends,
        exportedAt: new Date().toISOString()
      },
      { maxBytes, anonymizer: new Anonymizer(known) }
    )
  }

  ipcMain.handle(IPC.logsPreview, async () => {
    const res = await collectLogs()
    return { text: res.text, sizeBytes: res.sizeBytes, linesOmitted: res.linesOmitted }
  })

  ipcMain.handle(IPC.logsSave, async () => {
    try {
      const res = await collectLogs()
      const dir = String(prefs.get('downloads.directory', '') || defaultDownloadDir(app.getPath('downloads')))
      await fsp.mkdir(dir, { recursive: true })
      const target = uniquePath(path.join(dir, exportFilename()))
      await fsp.writeFile(target, res.text, 'utf8')
      return { path: target, sizeBytes: res.sizeBytes }
    } catch (e) {
      return { error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.logsUpload, async () => {
    try {
      const res = await collectLogs(PASTE_GG_MAX_BYTES)
      const uploaded = await uploadToPasteGg(res.text, pasteFetch)
      const record = {
        id: uploaded.id,
        url: uploaded.url,
        deletionKey: uploaded.deletionKey,
        createdAt: uploaded.createdAt,
        expiresAt: uploaded.expiresAt,
        sizeBytes: res.sizeBytes,
        linesOmitted: res.linesOmitted,
        status: 'active' as const
      }
      const uploads = logUploads.add(record)
      return { upload: toPublicUpload(record), uploads }
    } catch (e) {
      return { error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.logsList, () => logUploads.publicList())

  ipcMain.handle(IPC.logsCheck, async () => {
    const active = logUploads.all().filter((u) => u.status === 'active')
    await Promise.all(
      active.map(async (u) => {
        const state = await checkPasteGg(u.id, pasteFetch)
        if (state === 'expired') {
          logUploads.markExpired(u.id, 'expired')
        }
      })
    )
    return logUploads.publicList()
  })

  ipcMain.handle(IPC.logsDelete, async (_e, id: string) => {
    const rec = logUploads.get(String(id))
    if (!rec) return { uploads: logUploads.publicList(), error: 'upload not found' }
    const outcome = await deleteFromPasteGg(rec.id, rec.deletionKey, pasteFetch)
    if (!outcome.ok) return { uploads: logUploads.publicList(), error: outcome.error }
    logUploads.markExpired(rec.id, 'deleted')
    return { uploads: logUploads.publicList() }
  })

  ipcMain.handle(IPC.logsForget, (_e, id: string) => logUploads.forget(String(id)))
  /**
   * Sign in through the service's own login page.
   *
   * The captured credential goes straight from the login window to the daemon
   * and is never returned here, so it never enters the renderer at all - only
   * whether it worked comes back. Nothing in this path is logged: an error
   * from the daemon is passed through, but the token never appears in one.
   */
  ipcMain.handle(IPC.browserLogin, async (_e, service: string, accountId?: string, options?: { useTor?: boolean; server?: string }) => {
    // A Mattermost server is wherever the person says, so its flow is made for that server.
    const server = service === 'mattermost' && typeof options?.server === 'string' ? options.server : ''
    const flow = service === 'mattermost' ? mattermostFlow(server) : LOGIN_FLOWS[service]
    if (!flow) return { ok: false, error: service === 'mattermost' ? 'Type the address of the Mattermost server first' : `No browser sign-in is defined for ${service}` }
    const outcome = await browserLogin(service, { flow })
    if (!outcome.ok || !outcome.value) return { ok: false, error: outcome.error }
    try {
      await client.request(flow.finish.method, {
        // How a new account should connect, chosen on the form that opened
        // this window. Named rather than passed through whole, so nothing the
        // renderer sends can stand in for the credential below.
        ...(typeof options?.useTor === 'boolean' ? { useTor: options.useTor } : {}),
        [flow.finish.param]: outcome.value,
        ...(outcome.extra ? { [outcome.extra.param]: outcome.extra.value } : {}),
        // The session the server's page made is this client's own, and is ended at the server when the account goes.
        ...(service === 'mattermost' ? { server, madeHere: true } : {}),
        ...(accountId ? { accountId } : {})
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // Twitch's sign-in, both halves in one window (see twitch-signin.ts). Only whether it worked comes back.
  ipcMain.handle(IPC.twitchSignIn, (_e, options?: { useTor?: boolean }) =>
    twitchSignIn((method, params) => client.request(method, params), {
      useTor: typeof options?.useTor === 'boolean' ? options.useTor : undefined
    })
  )

  // Rocket.Chat OAuth / SAML / OIDC / LDAP SSO browser sign-in capturing Meteor.loginToken.
  ipcMain.handle(
    IPC.rocketchatSsoLogin,
    async (_e, serverUrl: string, options?: { useTor?: boolean }) => {
      const outcome = await rocketchatSsoLogin(serverUrl)
      if (!outcome.ok || !outcome.token) return { ok: false, error: outcome.error }
      try {
        await client.request('addRocketChatAccountToken', {
          serverUrl,
          authToken: outcome.token,
          userId: outcome.userId ?? '',
          madeHere: true,
          ...(typeof options?.useTor === 'boolean' ? { useTor: options.useTor } : {})
        })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.smiliesDir, () => smiliesPath())

  // Chromium's HTTP cache, which Settings reports beside the daemon's.
  ipcMain.handle(IPC.webCacheSize, () => session.defaultSession.getCacheSize())
  ipcMain.handle(IPC.clearWebCache, async () => {
    await session.defaultSession.clearCache()
    return session.defaultSession.getCacheSize()
  })

  ipcMain.handle(IPC.sandboxState, () => sandboxed())
}

app.whenReady().then(() => {
  // A losing second instance is on its way out; it must not spawn a daemon,
  // claim a tray icon or register a hotkey on the way.
  if (!isPrimaryInstance) return

  // Before anything worth logging happens. Everything the daemon says is
  // piped through `log`, and in a launched build stdout is /dev/null - so
  // without this there is no record of a backend failing, anywhere, ever.
  log.toDirectory(path.join(cacheRoot(), 'moho'))
  log.info('moho starting, logging to', log.file() ?? '(nowhere)')

  // Record main-process crashes and unhandled rejections synchronously before
  // Node/Electron exits or continues, without altering Node's fatal crash path.
  process.on('uncaughtExceptionMonitor', (err, origin) => {
    log.error('[main] uncaughtException:', origin, err)
  })
  process.on('unhandledRejection', (reason) => {
    log.error('[main] unhandledRejection:', reason)
  })

  // What a call, restore, or renderer error did, from the window that held it.
  // Structured moho prefixes (`[call] `, `[restore] `, `[moho] `) are always
  // recorded, plus any console error coming from moho's own app pages (never
  // third-party sign-in popups) so UI crashes survive a reload or restart.
  app.on('web-contents-created', (_e, contents) => {
    // Every page, including ones opened later, under the same WebRTC rule.
    applyPolicy(contents)
    contents.on('console-message', (event) => {
      const { message, level, sourceId, lineNumber } = event
      if (typeof message !== 'string') return
      const isTagged =
        message.startsWith('[call] ') ||
        message.startsWith('[restore] ') ||
        message.startsWith('[moho] ')
      if (isTagged) {
        if (level === 'error') log.error(message)
        else if (level === 'warning') log.warn(message)
        else log.info(message)
        return
      }
      if (level === 'error') {
        const pageUrl = contents.getURL()
        const ownPage =
          pageUrl.startsWith('file://') ||
          pageUrl.startsWith('http://localhost:') ||
          pageUrl.startsWith('http://127.0.0.1:')
        if (ownPage) {
          const src = sourceId ? ` (${sourceId.split('/').pop()}:${lineNumber})` : ''
          log.error(`[renderer] ${message}${src}`)
        }
      }
    })
  })

  // Said once, in the log and in the window, and never in the way.
  //
  // Chromium's sandbox needs unprivileged user namespaces, and an AppImage
  // has no other way to get them: its mount is nosuid, so the setuid helper
  // is unreachable, and an AppArmor profile needs an install step an AppImage
  // by definition does not have. On a host that restricts them - Ubuntu 24.04
  // and after - the AppImage's own launcher starts this process with
  // --no-sandbox, and the only choice left is to run without one or not to
  // run at all.
  //
  // Running is the answer. Refusing would leave somebody with a chat client
  // that will not open and a dialog pointing at a different download; saying
  // so leaves them with the client and the knowledge. The deb carries an
  // AppArmor profile and an install step to put it in place, which is why it
  // is what the notice names.
  if (!sandboxed()) {
    log.info(
      'starting without Chromium\'s sandbox - this host restricts unprivileged',
      'user namespaces; the .deb package ships an AppArmor profile that restores it'
    )
  }

  electronApp.setAppUserModelId('com.salastil.moho')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // A call needs a microphone, and Chromium will not hand one over without
  // being asked. Unanswered, the request does not fail - it hangs, which is
  // what a call that never started looked like: no error, no ringing, nothing.
  //
  // Granted only to this application's own windows, on the default session.
  // A sign-in window loads somebody else's page and runs in a partition of
  // its own, which this handler never sees.
  // And full screen, which a page asks for with requestFullscreen: a handler that does not name it refuses it, and the
  // video player's button then did nothing.
  const allowed = new Set(['media', 'display-capture', 'audioCapture', 'videoCapture', 'fullscreen'])
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(allowed.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission))

  // Every screen share in the app, on every desktop - see screenshare.ts.
  installScreenShare(session.defaultSession, () => mainWindow?.webContents)

  // Someone tried to launch a second copy: treat it as "show me moho", which
  // is almost always what they meant - especially when the window is hidden
  // to the tray and looks like nothing is running.
  app.on('second-instance', (_event, argv) => {
    // The desktop launches a fresh copy to open a link and lets the running
    // one take it, so the link arrives here rather than at startup on every
    // click after the first.
    const link = deepLinkIn(argv)
    if (!mainWindow) {
      pendingDeepLink = link ?? pendingDeepLink
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    deliverDeepLink(link)
  })

  // macOS does not use argv for this; it wakes a running app with an event.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    deliverDeepLink(url)
  })

  // Asks the desktop to send us irc:// links. Registered every start rather
  // than once: an association can be taken by something else installed later,
  // and re-registering is how every other client keeps it.
  for (const scheme of DEEP_LINK_SCHEMES) {
    // In development the executable is Electron itself, so the entry point has
    // to be named too or the desktop would launch a bare Electron.
    if (is.dev && process.platform === 'win32') {
      app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1] ?? '')])
    } else {
      app.setAsDefaultProtocolClient(scheme)
    }
  }

  // One that came in on the command line, from a click that started moho.
  pendingDeepLink = deepLinkIn(process.argv) ?? pendingDeepLink

  // Bundled Sneedchat smilies are served through the same guarded scheme as
  // nobilis's cached media, so the renderer needs no file access of its own.
  allowRoot(resourcePath())
  allowRoot(smiliesPath())
  // Rail icons somebody chose, copied here after being checked as images.
  allowRoot(path.join(app.getPath('userData'), 'group-icons'))
  installMediaHandler()
  installRoutedHandler((method, params) => client.request(method, params))
  // YouTube's player refuses to play (error 153) for an embedder it cannot
  // name, and a window loaded from a file sends no Referer at all. YouTube's
  // own answer for an app with no web address is to send its app id as one.
  // Only on the player's own pages: nothing else hears from moho this way.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube-nocookie.com/embed/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://com.salastil.moho/'
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  prefs = new Prefs()
  nobilis = new NobilisProcess()
  client = new NobilisClient()

  // Going idle when the person steps away. What it says, and to whom, is
  // decided in the daemon - which accounts are online, which are in a call -
  // so all this says is whether they are here.
  idleWatcher = new IdleWatcher({
    now: () => Date.now(),
    systemIdleSeconds: () => powerMonitor.getSystemIdleTime(),
    enabled: () => prefs.get<boolean>('presence.autoIdle', true),
    thresholdMs: () => (Number(prefs.get<unknown>('presence.autoIdleMinutes', '10')) || 10) * 60_000,
    onChange: (idle) => void client.request('setUserIdle', { idle }).catch(() => {})
  })
  setInterval(() => idleWatcher.evaluate(), 10_000).unref()
  app.on('browser-window-focus', () => idleWatcher.activity())
  powerMonitor.on('lock-screen', () => idleWatcher.lock())
  powerMonitor.on('suspend', () => idleWatcher.lock())
  powerMonitor.on('unlock-screen', () => idleWatcher.unlock())
  powerMonitor.on('resume', () => idleWatcher.unlock())

  notifier = new Notifier(
    prefs,
    // The tray's number is the window's, not this tally's - see IPC.trayUnread.
    () => {},
    openConversation,
    () => mainWindow?.webContents ?? null,
    (bufferId) => popoutState().watched.includes(bufferId),
    // Paused from the tray counts as every account asking for quiet: nothing pops up, and it all still counts.
    (accountId) => accountStatus[accountId] === 'dnd' || notificationsPaused()
  )

  signalCalls = new SignalCalls({
    request: (method, params) => client.request(method, params),
    emit: (event, data) => send(IPC.event, { event, data }),
    frame: (width, height, rgba, demuxId) => send(IPC.signalCallFrame, width, height, rgba, demuxId)
  })

  client.on('link', (up) => {
    send(IPC.link, up)
    // The tray says when the daemon is not answering.
    updateTray(lastTray)
    if (!up) return
    // A daemon that has just started knows nothing of this.
    if (idleWatcher.isIdle()) void client.request('setUserIdle', { idle: true }).catch(() => {})
    // Before anything is fetched for the window: whether its own traffic goes
    // through Tor or the proxy is the daemon's setting, asked of it here.
    void applyTunnel((method, params) => client.request(method, params))
    resetRoute()
    // How the daemon starts its web helper - this same binary - for sites that
    // admit only a browser's network stack (see web-helper.ts). Told on every
    // connection, because the daemon may have been started by something else.
    void client.request('setWebHelper', { command: webHelperCommand() }).catch(() => {})
    // The daemon usually outlives this process, so its buffers were announced
    // long before this connection existed and no bufferListChange is coming
    // for them. Without asking outright, main knows of no conversations at
    // all - and it has to know which ones are direct messages to light the
    // tray for them, and which group each belongs to for the mute rules.
    void client
      .request('listBuffers')
      .then((list: ChatBuffer[]) => {
        for (const b of list) notifier.trackBuffer(b, false)
        notifier.publish()
      })
      .catch(() => {
        // Not fatal: live events still fill this in as things change.
      })
  })
  client.on('push', (frame) => {
    // Main watches two event kinds of its own: the buffer list (so mute
    // cascade can find an account's server buffer) and notifications (tray +
    // desktop alerts, which must keep working while the window is closed).
    if (frame.event === 'bufferListChange') {
      notifier.trackBuffer(frame.data as ChatBuffer, !!frame.data?.removed)
    } else if (frame.event === 'notification') {
      void notifier.handle(frame.data)
    } else if (frame.event === 'netSettings') {
      void applyTunnel((method, params) => client.request(method, params))
      resetRoute()
    } else if (frame.event === 'signalCallMessage') {
      // RingRTC's, here; the windows hear what becomes of the call as signalCall events.
      signalCalls.arrived(frame.data as Parameters<SignalCalls['arrived']>[0])
      return
    } else if (frame.event.startsWith('twitchLogin')) {
      feedTwitchSignIn(frame as { event: string; data?: Record<string, unknown> })
    } else if (frame.event === 'twitchIntegrityNeeded') {
      // Twitch wants proof that a browser is asking for a stream; only a page of its own can make it.
      void answerIntegrity(frame.data as { requestId?: string; deviceId?: string; authToken?: string }, (method, params) => client.request(method, params))
      // Not forwarded: it carries the session, which only main and the daemon are to hold.
      return
    }
    send(IPC.event, frame)
  })

  wireIpc()
  // Adopt a daemon that is already listening rather than launching a second
  // one that would immediately lose the flock race and exit.
  void nobilis.ensureRunning(SOCKET_PATH).then(() => client.start())
  createWindow()
  createTray()
  applyHotkey(prefs.get<string>('hotkey.toggle'))
  // For the UI harness, which has no way to look inside a tray: what it shows
  // and offers, and the entries themselves to be clicked. Only when it asks.
  if (process.env.MOHO_UI_SHOTS === '1') {
    ;(globalThis as Record<string, unknown>).__mohoTwitchIntegrity = { mint: mintIntegrity }
    ;(globalThis as Record<string, unknown>).__mohoTray = {
      update: updateTray,
      idle: (v: boolean | null) => idleWatcher.forceForTesting(v),
      lastActivity: () => idleWatcher.lastActivityAt(),
      state: () => lastTray,
      pref: (key: string, value: unknown) => applyPref(key, value),
      icon: () => lastTrayIcon,
      tooltip: () => lastTrayTooltip,
      menu: () => lastTrayMenu,
      click: (path: string[]) => {
        let items: MenuItemConstructorOptions[] = lastTrayMenu
        let item: MenuItemConstructorOptions | undefined
        for (const label of path) {
          item = items.find((i) => i.label === label || (i.label ?? '').startsWith(label))
          items = (item?.submenu as MenuItemConstructorOptions[]) ?? []
        }
        item?.click?.({ checked: !item.checked } as never, undefined, {} as never)
      }
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// The tray is the app's real lifetime anchor: closing the window hides it, so
// there is nothing to quit on last-window-closed on any platform.
app.on('window-all-closed', () => {})

/**
 * Quitting takes the daemon with it, adopted or not.
 *
 * will-quit is synchronous, which is not enough here: nobilis needs a moment
 * to send QUITs to every connected network before exiting, and a bare kill
 * leaves ghost sessions holding nicks until the server's ping timeout notices.
 * So the quit is deferred until the daemon is actually gone.
 */
let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  log.info('moho quitting')
  globalShortcut.unregisterAll()
  prefs?.flushNow()
  void stopDaemon()
    .catch((e) => log.warn('[nobilis] stop on quit failed:', (e as Error).message))
    .finally(() => app.exit(0))
})
