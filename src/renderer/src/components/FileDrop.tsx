import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { useActiveBuffer } from '../state/hooks'
import { bufferDisplayName } from '../lib/util'
import { stageFiles } from '../lib/staging'

/**
 * Dropping a file anywhere on the window.
 *
 * The whole window rather than the message box, because the message box is a
 * line of text and a file is not going into it - aiming at it was fiddly, and
 * a miss meant the browser navigated away from the app to display whatever
 * had been dropped.
 *
 * It does not send. A dropped file goes into the message box's tray, beside
 * anything already there, where it can be looked at, given a caption or taken
 * out again - and goes with the next message, as one chosen from the file
 * picker does. Nothing is posted to a room by a gesture that may have landed
 * on the wrong window.
 */
export function FileDrop(): JSX.Element | null {
  const buffer = useActiveBuffer()
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    /**
     * A drag that started in this window, so it is something being moved
     * around the app rather than a file arriving from outside.
     *
     * Carrying files is not enough on its own to tell those apart. Dragging
     * a server tile picks up the icon inside it, and Chromium hands a dragged
     * image to the page as a real file - so reordering the rail, or dropping
     * a server into a folder, offered to upload the icon.
     *
     * dragstart is the discriminator because it only fires for a drag that
     * began in the document: a file dragged off the desktop never fires one.
     */
    let internal = false
    const onStart = (): void => {
      internal = true
    }
    const onEnd = (): void => {
      internal = false
    }

    // Only a drag carrying files, and only one from outside. The rail
    // reorders its tiles with drags of its own, and swallowing those would
    // break moving a server.
    const carriesFiles = (e: DragEvent): boolean =>
      !internal && Array.from(e.dataTransfer?.types ?? []).includes('Files')

    // Depth rather than a boolean: dragging across a child fires leave on the
    // one being left before enter on the one being entered, so a flag flickers
    // off every time the pointer crosses anything.
    let depth = 0

    const onEnter = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      depth += 1
      setDragging(true)
    }
    const onOver = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      // Without this the drop never happens and the window navigates to the
      // file instead, replacing the app with a picture and no way back.
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length === 0) return
      // A File carries no usable path of its own; the preload asks Electron
      // for the one the OS already gave us. Anything it cannot place is
      // dropped rather than sent as a guess.
      const items = files
        .map((file) => ({ file, path: window.moho.pathForFile(file) }))
        .filter((item) => !!item.path)
      if (items.length > 0) stageFiles(items)
    }

    // Captured, so the flag is set before anything else in the app sees the
    // drag, and cleared however it ends - dropped, or abandoned with Escape.
    window.addEventListener('dragstart', onStart, true)
    window.addEventListener('dragend', onEnd, true)
    window.addEventListener('drop', onEnd, true)
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragstart', onStart, true)
      window.removeEventListener('dragend', onEnd, true)
      window.removeEventListener('drop', onEnd, true)
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  const where = buffer ? bufferDisplayName(buffer.name) : null

  if (!dragging) return null

  return createPortal(
    <div className="drop-hint">
      <Icon name="upload_file" size={34} />
      <span>{where ? `Drop to add to your message in ${where}` : 'Open a conversation to send a file'}</span>
    </div>,
    document.body
  )
}
