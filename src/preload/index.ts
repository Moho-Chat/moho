import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, POPOUT_FLAG, type PopoutState } from '../shared/ipc'
import type { NobilisEvent } from '../shared/wire'

/**
 * The conversation this window was opened to show, or null in the main window.
 *
 * Read from the arguments main gave this window rather than from its URL, so a
 * reload cannot lose it and the dev server and a packaged build are told the
 * same way.
 */
const popoutBufferId =
  process.argv.find((a) => a.startsWith(POPOUT_FLAG))?.slice(POPOUT_FLAG.length) || null

/**
 * The entire surface the renderer gets. Deliberately narrow: no `ipcRenderer`
 * passthrough and no filesystem access, so a hostile message body rendered in
 * the page has nothing privileged to reach for.
 */
const api = {
  /**
   * Resolves to nobilis's result, or rejects with nobilis's own error text.
   * Errors travel as values over IPC (see main's handler) and are re-thrown
   * here so callers can just try/catch.
   */
  async rpc<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await ipcRenderer.invoke(IPC.rpc, method, params)
    if (!res.ok) throw new Error(res.error)
    return res.result as T
  },

  /**
   * Signs in through the service's own login page, in a real browser window.
   *
   * Only the outcome comes back. The credential the window captures goes
   * straight from main to the daemon and is deliberately never returned here -
   * the renderer has no reason to hold a token, so it never does.
   */
  browserLogin(service: string, accountId?: string): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke(IPC.browserLogin, service, accountId)
  },

  /**
   * Puts Discord's captcha on screen and resolves with the solved token.
   *
   * The challenge itself is answered in a window of its own, on Discord's
   * origin - see main/captcha.ts for why it cannot be answered in this page.
   * What comes back is handed straight to the daemon, which repeats the
   * request that asked for it.
   */
  solveCaptcha(request: { sitekey: string; rqdata?: string | null }): Promise<{
    ok: boolean
    token?: string
    error?: string
  }> {
    return ipcRenderer.invoke(IPC.solveCaptcha, request)
  },

  onEvent(cb: (frame: NobilisEvent) => void): () => void {
    const handler = (_e: unknown, frame: NobilisEvent): void => cb(frame)
    ipcRenderer.on(IPC.event, handler)
    return () => ipcRenderer.off(IPC.event, handler)
  },

  onLinkChange(cb: (up: boolean) => void): () => void {
    const handler = (_e: unknown, up: boolean): void => cb(up)
    ipcRenderer.on(IPC.link, handler)
    return () => ipcRenderer.off(IPC.link, handler)
  },

  /**
   * An `irc://` link opened somewhere else on the machine - a browser, a mail
   * client - that the desktop handed to moho.
   */
  onDeepLink(cb: (url: string) => void): () => void {
    const handler = (_e: unknown, url: string): void => cb(url)
    ipcRenderer.on(IPC.deepLink, handler)
    return () => ipcRenderer.off(IPC.deepLink, handler)
  },

  onActivateBuffer(cb: (bufferId: string) => void): () => void {
    const handler = (_e: unknown, id: string): void => cb(id)
    ipcRenderer.on(IPC.activateBuffer, handler)
    return () => ipcRenderer.off(IPC.activateBuffer, handler)
  },

  onMaximizeChange(cb: (maximized: boolean) => void): () => void {
    const handler = (_e: unknown, v: boolean): void => cb(v)
    ipcRenderer.on(IPC.maximizeChanged, handler)
    return () => ipcRenderer.off(IPC.maximizeChanged, handler)
  },

  prefs: {
    getAll: (): Promise<Record<string, unknown>> => ipcRenderer.invoke(IPC.prefsGetAll),
    set: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke(IPC.prefsSet, key, value),
    /** A setting changed in one of the other windows. */
    onChange(cb: (key: string, value: unknown) => void): () => void {
      const handler = (_e: unknown, key: string, value: unknown): void => cb(key, value)
      ipcRenderer.on(IPC.prefsChanged, handler)
      return () => ipcRenderer.off(IPC.prefsChanged, handler)
    }
  },

  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized)
  },

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),

  /**
   * Which picture a page is showing, read from its own OpenGraph tag.
   *
   * Here rather than in the window because the window is a `file://` document
   * and a fetch from one carries no origin any host will answer: the reply
   * comes back and the browser refuses to let the page read it. The main
   * process has no such rule, being the thing that would enforce it.
   */
  resolveImagePage: (url: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.resolveImagePage, url),

  /** Puts a line of text on the system clipboard. */
  copyText: (text: string): Promise<void> => ipcRenderer.invoke(IPC.writeClipboardText, text),
  /**
   * Where a dropped file actually lives.
   *
   * A File from a drop carries no usable path of its own any more - Electron
   * removed the `path` property it used to have - and this is the sanctioned
   * replacement. It reads a path the OS already handed us for a file the
   * person themself dragged in; it cannot be pointed at anything else, so it
   * opens no door a hostile message body could walk through.
   */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  pickFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickFile),
  /**
   * What could be shared into a call: every screen and window, each with a
   * still of what is on it.
   *
   * Asked of the desktop rather than of the browser. Electron refuses
   * getDisplayMedia's own picker, and a person choosing what to show a room
   * needs to see which window they are choosing.
   */
  screenSources: (): Promise<{ id: string; name: string; thumbnail: string }[]> =>
    ipcRenderer.invoke(IPC.screenSources),
  pickSavePath: (suggested?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.pickSavePath, suggested),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickDirectory),
  importGroupIcon: (groupId: string): Promise<{ path?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.importGroupIcon, groupId),
  defaultDownloadDir: (): Promise<string> => ipcRenderer.invoke(IPC.defaultDownloadDir),
  downloadMedia: (source: string, filename?: string): Promise<{ path?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.downloadMedia, source, filename),
  readClipboardImage: (): Promise<string | null> => ipcRenderer.invoke(IPC.readClipboardImage),
  restartDaemon: (): Promise<void> => ipcRenderer.invoke(IPC.restartDaemon),
  daemonStatus: (): Promise<{ binaryPath: string; available: boolean; linkUp: boolean }> =>
    ipcRenderer.invoke(IPC.daemonStatus),
  smiliesDir: (): Promise<string> => ipcRenderer.invoke(IPC.smiliesDir),
  markBufferRead: (bufferId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.markBufferRead, bufferId),

  /** Conversations in windows of their own. */
  popout: {
    /** Set only in a popped-out window, naming the conversation it shows. */
    bufferId: popoutBufferId,
    open: (bufferId: string, title?: string): Promise<void> =>
      ipcRenderer.invoke(IPC.popoutOpen, bufferId, title),
    /** `andShow` opens the conversation in the main window on the way back. */
    close: (bufferId: string, andShow = false): Promise<void> =>
      ipcRenderer.invoke(IPC.popoutClose, bufferId, andShow),
    list: (): Promise<PopoutState> => ipcRenderer.invoke(IPC.popoutList),
    onChange(cb: (state: PopoutState) => void): () => void {
      const handler = (_e: unknown, state: PopoutState): void => cb(state)
      ipcRenderer.on(IPC.popoutsChanged, handler)
      return () => ipcRenderer.off(IPC.popoutsChanged, handler)
    }
  }
}

contextBridge.exposeInMainWorld('moho', api)

export type MohoApi = typeof api
