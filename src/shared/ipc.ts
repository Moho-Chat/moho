/** Channel names shared between main and preload. */
export const IPC = {
  // renderer -> main (invoke)
  rpc: 'moho:rpc',
  prefsGetAll: 'moho:prefs:getAll',
  prefsSet: 'moho:prefs:set',
  windowMinimize: 'moho:window:minimize',
  windowToggleMaximize: 'moho:window:toggleMaximize',
  windowClose: 'moho:window:close',
  windowIsMaximized: 'moho:window:isMaximized',
  openExternal: 'moho:openExternal',
  pickFile: 'moho:pickFile',
  pickSavePath: 'moho:pickSavePath',
  pickDirectory: 'moho:pickDirectory',
  downloadMedia: 'moho:downloadMedia',
  importGroupIcon: 'moho:importGroupIcon',
  defaultDownloadDir: 'moho:defaultDownloadDir',
  readClipboardImage: 'moho:readClipboardImage',
  restartDaemon: 'moho:restartDaemon',
  daemonStatus: 'moho:daemonStatus',
  smiliesDir: 'moho:smiliesDir',
  markBufferRead: 'moho:markBufferRead',
  browserLogin: 'moho:browserLogin',
  popoutOpen: 'moho:popout:open',
  popoutClose: 'moho:popout:close',
  popoutList: 'moho:popout:list',

  // main -> renderer (send)
  event: 'moho:event',
  link: 'moho:link',
  prefsChanged: 'moho:prefs:changed',
  maximizeChanged: 'moho:window:maximizeChanged',
  activateBuffer: 'moho:activateBuffer',
  deepLink: 'moho:deepLink',
  popoutsChanged: 'moho:popout:changed'
} as const

/**
 * How a popped-out window is told which conversation it is.
 *
 * Passed as an extra argument to that window's preload rather than put in its
 * URL, so it survives a reload and never has to be encoded into a path that
 * differs between the dev server and a packaged file.
 */
export const POPOUT_FLAG = '--moho-popout='

/** Which conversations have a window of their own, and which are being watched. */
export interface PopoutState {
  /** Every conversation with a window open, whether or not it can be seen. */
  open: string[]
  /**
   * Those whose window is actually on screen.
   *
   * A conversation someone is looking at needs no unread badge and no desktop
   * alert - that is the point of having put it in a window of its own - but a
   * popout that has been minimised is not being looked at, and goes back to
   * behaving like any other conversation.
   */
  watched: string[]
}
