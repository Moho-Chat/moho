import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  net,
  Menu,
  shell,
  Tray
} from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { defaultSocketPath, NobilisClient } from './nobilis-client'
import { NobilisProcess } from './nobilis-process'
import { Prefs } from './prefs'
import { Notifier } from './notifications'
import { IPC } from '../shared/ipc'
import { allowRoot, installMediaHandler, registerMediaScheme } from './media-protocol'
import { saveMedia } from './downloads'
import type { Buffer as ChatBuffer } from '../shared/wire'
import { log } from './log'

registerMediaScheme()

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

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let prefs: Prefs
let nobilis: NobilisProcess
let client: NobilisClient
let notifier: Notifier
let registeredHotkey: string | null = null

function resourcePath(...parts: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(app.getAppPath(), 'resources', ...parts)
}

/**
 * The Sneedchat smiley images live in the nobilis repository, next to the table
 * that names them, so the daemon's shortcode list and the files it refers to
 * can't drift apart. Packaging copies them out of the submodule; in
 * development they are read from the checkout in place.
 */
function smiliesPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'sockchat-smilies')
    : path.join(app.getAppPath(), 'nobilis', 'resources', 'sockchat-smilies')
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

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('maximize', () => send(IPC.maximizeChanged, true))
  mainWindow.on('unmaximize', () => send(IPC.maximizeChanged, false))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
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

function trayIcon(hasPinnedAlert: boolean): Electron.NativeImage {
  const file = resourcePath('icons', hasPinnedAlert ? 'tray-alert.png' : 'tray.png')
  const img = nativeImage.createFromPath(file)
  // A missing icon file would otherwise produce an invisible tray entry the
  // user can never click; fall back to the app icon so the entry still exists.
  return img.isEmpty() ? nativeImage.createFromPath(resourcePath('icons', 'moho.png')) : img
}

function createTray(): void {
  tray = new Tray(trayIcon(false))
  tray.setToolTip('moho')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show/hide', click: toggleWindow },
      { label: 'Restart daemon', click: () => nobilis.restart() },
      {
        label: 'Stop daemon',
        // Deliberately separate from Quit: stopping the daemon disconnects
        // every account, which is worth asking for explicitly rather than
        // making it a side effect of closing a window.
        click: () => {
          void stopDaemon()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit()
        }
      }
    ])
  )
  tray.on('click', toggleWindow)
}

function updateTray(unreadCount: number, hasPinnedAlert: boolean): void {
  if (!tray) return
  tray.setImage(trayIcon(hasPinnedAlert))
  tray.setToolTip(unreadCount > 0 ? `moho - ${unreadCount} unread` : 'moho')
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

function wireIpc(): void {
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

  ipcMain.handle(IPC.prefsGetAll, () => prefs.all())
  ipcMain.handle(IPC.prefsSet, (_e, key: string, value: unknown) => {
    prefs.set(key, value)
    // Pins and mutes feed the tray/notification rules, which live here.
    if (key === 'pinnedBuffers' || key === 'mutedBuffers') notifier.publish()
    if (key === 'hotkey.toggle') applyHotkey(String(value))
  })

  ipcMain.handle(IPC.markBufferRead, (_e, bufferId: string) => notifier.clear(bufferId))

  ipcMain.handle(IPC.windowMinimize, () => mainWindow?.minimize())
  ipcMain.handle(IPC.windowToggleMaximize, () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle(IPC.windowClose, () => mainWindow?.hide())
  ipcMain.handle(IPC.windowIsMaximized, () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    // Only ever hand the OS a real web/mail link - a message body is fully
    // attacker-controlled, and shell.openExternal will happily launch things
    // like `file://` or a custom app scheme otherwise.
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
  })

  ipcMain.handle(IPC.pickFile, async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle(IPC.pickDirectory, async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  // Where downloads land when the user hasn't chosen somewhere. Electron
  // resolves this per-platform (XDG's Downloads dir on Linux), so there is
  // nothing to guess at.
  ipcMain.handle(IPC.defaultDownloadDir, () => app.getPath('downloads'))

  ipcMain.handle(IPC.downloadMedia, async (_e, source: string, filename?: string) =>
    saveMedia(
      source,
      filename,
      String(prefs.get('downloads.directory', '') || app.getPath('downloads')),
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
  ipcMain.handle(IPC.importGroupIcon, async (_e, groupId: string) => {
    if (!mainWindow) return { error: 'no window' }
    const res = await dialog.showOpenDialog(mainWindow, {
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

  ipcMain.handle(IPC.readClipboardImage, () => {
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    const dir = path.join(os.tmpdir(), 'moho-paste')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `paste-${Date.now()}.png`)
    fs.writeFileSync(file, img.toPNG())
    return file
  })

  ipcMain.handle(IPC.restartDaemon, () => nobilis.restart())
  ipcMain.handle(IPC.daemonStatus, () => ({
    binaryPath: nobilis.binaryPath,
    available: nobilis.available(),
    linkUp: client.linkUp
  }))
  ipcMain.handle(IPC.smiliesDir, () => smiliesPath())
}

app.whenReady().then(() => {
  // A losing second instance is on its way out; it must not spawn a daemon,
  // claim a tray icon or register a hotkey on the way.
  if (!isPrimaryInstance) return

  electronApp.setAppUserModelId('com.salastil.moho')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // Someone tried to launch a second copy: treat it as "show me moho", which
  // is almost always what they meant - especially when the window is hidden
  // to the tray and looks like nothing is running.
  app.on('second-instance', () => {
    if (!mainWindow) {
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  // Bundled Sneedchat smilies are served through the same guarded scheme as
  // nobilis's cached media, so the renderer needs no file access of its own.
  allowRoot(resourcePath())
  allowRoot(smiliesPath())
  installMediaHandler()

  prefs = new Prefs()
  nobilis = new NobilisProcess()
  client = new NobilisClient()

  notifier = new Notifier(
    prefs,
    updateTray,
    (bufferId) => {
      mainWindow?.show()
      mainWindow?.focus()
      send(IPC.activateBuffer, bufferId)
    },
    () => mainWindow?.webContents ?? null
  )

  client.on('link', (up) => send(IPC.link, up))
  client.on('push', (frame) => {
    // Main watches two event kinds of its own: the buffer list (so mute
    // cascade can find an account's server buffer) and notifications (tray +
    // desktop alerts, which must keep working while the window is closed).
    if (frame.event === 'bufferListChange') {
      notifier.trackBuffer(frame.data as ChatBuffer, !!frame.data?.removed)
    } else if (frame.event === 'notification') {
      void notifier.handle(frame.data)
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
  globalShortcut.unregisterAll()
  prefs?.flushNow()
  void stopDaemon()
    .catch((e) => log.warn('[nobilis] stop on quit failed:', (e as Error).message))
    .finally(() => app.exit(0))
})
