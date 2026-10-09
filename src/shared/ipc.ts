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
  resolveImagePage: 'moho:resolveImagePage',
  pickFile: 'moho:pickFile',
  pickSavePath: 'moho:pickSavePath',
  pickDirectory: 'moho:pickDirectory',
  downloadMedia: 'moho:downloadMedia',
  copyImage: 'moho:copyImage',
  fileSize: 'moho:fileSize',
  importGroupIcon: 'moho:importGroupIcon',
  defaultDownloadDir: 'moho:defaultDownloadDir',
  readClipboardImage: 'moho:readClipboardImage',
  /** Undo, cut, paste... on whatever has focus - see main's editAction. */
  editAction: 'moho:editAction',
  replaceMisspelling: 'moho:replaceMisspelling',
  addToDictionary: 'moho:addToDictionary',
  writeClipboardText: 'moho:writeClipboardText',
  restartDaemon: 'moho:restartDaemon',
  daemonStatus: 'moho:daemonStatus',
  smiliesDir: 'moho:smiliesDir',
  /** Chromium's own HTTP cache: its size, and emptying it. */
  webCacheSize: 'moho:webCacheSize',
  clearWebCache: 'moho:clearWebCache',
  /** Whether this process got Chromium's sandbox, or is running without it. */
  sandboxState: 'moho:sandboxState',
  /** The screens and windows that could be shared into a call. */
  /** main -> window: show the screen picker (question id, sources). */
  screenPick: 'moho:screenPick',
  /** window -> main: the picker's answer (question id, source id or null). */
  screenPicked: 'moho:screenPicked',
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
  /** main -> window: a right click landed on somewhere text is typed. */
  editMenu: 'moho:editMenu',
  deepLink: 'moho:deepLink',
  popoutsChanged: 'moho:popout:changed',
  /** main -> window: something from the tray menu that the window carries out. */
  trayCommand: 'moho:tray:command',
  /** window -> main: the status each connected account is at. */
  trayStatus: 'moho:tray:status'
} as const

/**
 * How a popped-out window is told which conversation it is.
 *
 * Passed as an extra argument to that window's preload rather than put in its
 * URL, so it survives a reload and never has to be encoded into a path that
 * differs between the dev server and a packaged file.
 */
export const POPOUT_FLAG = '--moho-popout='

/**
 * Set only when main was started with MOHO_UI_SHOTS=1, by the screenshot
 * harness (scripts/ui-shots.mjs). Lets that harness put Discord-shaped state
 * into a window that has no Discord account, so screens it cannot otherwise
 * reach can be photographed. Never present in a normal launch.
 */
export const UI_SHOTS_FLAG = '--moho-ui-shots'

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

/** Something that can be shared into a call, as the picker draws it. */
export interface ScreenSource {
  id: string
  name: string
  /** A data: URL of what is on it. */
  thumbnail: string
}

/** What can be done to the text at the caret, by Chromium, on whatever has focus. */
export type EditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll'

export const EDIT_ACTIONS: readonly EditAction[] = ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll']

/** A right click where text is typed, as Chromium saw it. */
export interface EditMenuRequest {
  x: number
  y: number
  /** The word under the click, if it is misspelled. */
  word: string
  suggestions: string[]
  can: Record<EditAction, boolean>
  hasSelection: boolean
}
