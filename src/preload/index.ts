import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { NobilisEvent } from '../shared/wire'

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
    set: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke(IPC.prefsSet, key, value)
  },

  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized)
  },

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
  pickFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickFile),
  readClipboardImage: (): Promise<string | null> => ipcRenderer.invoke(IPC.readClipboardImage),
  restartDaemon: (): Promise<void> => ipcRenderer.invoke(IPC.restartDaemon),
  daemonStatus: (): Promise<{ binaryPath: string; available: boolean; linkUp: boolean }> =>
    ipcRenderer.invoke(IPC.daemonStatus),
  smiliesDir: (): Promise<string> => ipcRenderer.invoke(IPC.smiliesDir),
  markBufferRead: (bufferId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.markBufferRead, bufferId)
}

contextBridge.exposeInMainWorld('moho', api)

export type MohoApi = typeof api
