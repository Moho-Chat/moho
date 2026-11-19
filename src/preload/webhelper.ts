/**
 * The web helper's socket page.
 *
 * Loaded into a hidden window whose page is a plain-text file on the site's
 * own origin, so a websocket opened here carries that origin - which the chat
 * requires - and runs on Chromium's network stack, which the site's gate
 * requires. Nothing is exposed to the page: this only listens for the helper
 * to say what to do and tells it what happened.
 */
import { ipcRenderer } from 'electron'

const sockets = new Map<number, WebSocket>()

ipcRenderer.on('ws-open', (_e, id: number, url: string, protocols: string[]) => {
  let ws: WebSocket
  try {
    ws = new WebSocket(url, protocols)
  } catch (err) {
    ipcRenderer.send('ws-event', id, 'close', 1006, String(err))
    return
  }
  sockets.set(id, ws)
  ws.onopen = () => ipcRenderer.send('ws-event', id, 'open', ws.protocol)
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') ipcRenderer.send('ws-event', id, 'message', e.data)
  }
  ws.onclose = (e) => {
    sockets.delete(id)
    ipcRenderer.send('ws-event', id, 'close', e.code, e.reason)
  }
})

ipcRenderer.on('ws-send', (_e, id: number, data: string) => {
  const ws = sockets.get(id)
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(data)
})

ipcRenderer.on('ws-close', (_e, id: number) => {
  sockets.get(id)?.close()
})
