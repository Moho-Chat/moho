import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  Menu,
  shell,
  Tray
} from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { NobilisClient } from './nobilis-client'
import { NobilisProcess } from './nobilis-process'
import { Prefs } from './prefs'
import { Notifier } from './notifications'
import { IPC } from '../shared/ipc'
import { allowRoot, installMediaHandler, registerMediaScheme } from './media-protocol'
import type { Buffer as ChatBuffer } from '../shared/wire'

registerMediaScheme()

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

function applyHotkey(accelerator: string): void {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey)
    registeredHotkey = null
  }
  if (!accelerator) return
  try {
    if (globalShortcut.register(accelerator, toggleWindow)) registeredHotkey = accelerator
    else console.warn('[hotkey] refused by the system:', accelerator)
  } catch (e) {
    console.warn('[hotkey] invalid accelerator:', accelerator, (e as Error).message)
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
  electronApp.setAppUserModelId('com.salastil.moho')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // Bundled Sneedchat smilies are served through the same guarded scheme as
  // nobilis's cached media, so the renderer needs no file access of its own.
  allowRoot(resourcePath())
  allowRoot(smiliesPath())
  installMediaHandler()

  prefs = new Prefs()
  nobilis = new NobilisProcess()
  client = new NobilisClient()

  notifier = new Notifier(prefs, updateTray, (bufferId) => {
    mainWindow?.show()
    mainWindow?.focus()
    send(IPC.activateBuffer, bufferId)
  })

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
  nobilis.start()
  client.start()
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

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  prefs?.flushNow()
  client?.stop()
  nobilis?.stop()
})
