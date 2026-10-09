/** What the window announces when files are dropped on it, for the message box to take. */
export const STAGE_FILES = 'moho:stage-files'

/** One file on its way to the tray. */
export interface StagedFile {
  path: string
  /**
   * The file itself where it was dropped, so a picture can be shown from it.
   * The guarded media scheme serves only what the daemon cached or somebody
   * picked in a dialog, and the renderer cannot add to that - a dropped
   * file's own bytes are already here and need no filesystem access at all.
   */
  file?: File
}

/** Hands files to the box's tray: the same place a pasted or picked one goes. */
export function stageFiles(files: StagedFile[]): void {
  window.dispatchEvent(new CustomEvent<StagedFile[]>(STAGE_FILES, { detail: files }))
}
