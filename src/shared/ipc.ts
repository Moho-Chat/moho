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
  pickDirectory: 'moho:pickDirectory',
  downloadMedia: 'moho:downloadMedia',
  defaultDownloadDir: 'moho:defaultDownloadDir',
  readClipboardImage: 'moho:readClipboardImage',
  restartDaemon: 'moho:restartDaemon',
  daemonStatus: 'moho:daemonStatus',
  smiliesDir: 'moho:smiliesDir',
  markBufferRead: 'moho:markBufferRead',

  // main -> renderer (send)
  event: 'moho:event',
  link: 'moho:link',
  prefsChanged: 'moho:prefs:changed',
  maximizeChanged: 'moho:window:maximizeChanged',
  activateBuffer: 'moho:activateBuffer'
} as const
