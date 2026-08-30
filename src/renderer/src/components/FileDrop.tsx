import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { useActiveBuffer, useStore } from '../state/hooks'
import { bufferDisplayName, fileNameOf } from '../lib/util'

/**
 * Dropping a file anywhere on the window.
 *
 * The whole window rather than the message box, because the message box is a
 * line of text and a file is not going into it - aiming at it was fiddly, and
 * a miss meant the browser navigated away from the app to display whatever
 * had been dropped.
 *
 * It asks before sending. A file dragged in is one gesture away from being
 * posted to a room full of people, and the wrong window happens to be
 * focused often enough that "which conversation is this going to" is worth a
 * sentence and a button rather than a surprise afterwards.
 */
interface Dropped {
  /** Where the file is, for the daemon to read. */
  path: string
  /** The file itself, so a picture can be previewed without a path. */
  file: File
}

export function FileDrop(): JSX.Element | null {
  const store = useStore()
  const buffer = useActiveBuffer()
  const [dragging, setDragging] = useState(false)
  const [dropped, setDropped] = useState<Dropped[] | null>(null)

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
      if (items.length > 0) setDropped(items)
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

  useEffect(() => {
    if (!dropped) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDropped(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dropped])

  const send = (): void => {
    if (!buffer || !dropped) return
    // One message each, the same as several files staged in the composer:
    // every service here takes one file per message.
    for (const item of dropped) void store.sendMessage(buffer.id, '', item.path)
    setDropped(null)
  }

  const where = buffer ? bufferDisplayName(buffer.name) : null

  if (dropped) {
    return createPortal(
      <div className="lightbox-backdrop" onClick={() => setDropped(null)}>
        <div
          className="drop-confirm"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="drop-confirm-head">
            <Icon name="upload_file" size={20} />
            <span>
              {where ? (
                <>
                  Upload to <b>{where}</b>?
                </>
              ) : (
                'Nowhere to upload to'
              )}
            </span>
          </div>

          <div className="drop-preview">
            {dropped.map((item) => (
              <DroppedItem key={item.path} item={item} />
            ))}
          </div>

          {where ? (
            <p className="small muted">
              {dropped.length === 1
                ? 'It will be sent as its own message.'
                : `${dropped.length} files, each sent as its own message.`}
            </p>
          ) : (
            <p className="small muted">Open a conversation first, then drop the file again.</p>
          )}

          <div className="drop-confirm-actions">
            <button type="button" className="button" onClick={() => setDropped(null)} autoFocus>
              Cancel
            </button>
            {where && (
              <button type="button" className="button primary" onClick={send}>
                Upload
              </button>
            )}
          </div>
        </div>
      </div>,
      document.body
    )
  }

  if (!dragging) return null

  return createPortal(
    <div className="drop-hint">
      <Icon name="upload_file" size={34} />
      <span>{where ? `Drop to upload to ${where}` : 'Drop a file'}</span>
    </div>,
    document.body
  )
}

/**
 * One dropped file in the dialog.
 *
 * A picture is shown from the File itself rather than from its path. The
 * guarded media scheme only serves what the daemon cached or what somebody
 * picked in a dialog, and widening it to take a path the renderer supplies
 * would be a real hole for one preview - where the dropped File is already
 * here and needs no filesystem access at all.
 */
function DroppedItem({ item }: { item: Dropped }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!item.file.type.startsWith('image/')) return
    const made = URL.createObjectURL(item.file)
    setUrl(made)
    // Revoked on unmount, or the blob is held for as long as the window is.
    return () => URL.revokeObjectURL(made)
  }, [item.file])

  return (
    <div className="drop-item">
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span className="drop-item-file">
          <Icon name="description" size={26} />
        </span>
      )}
      <span className="small ellipsis">{fileNameOf(item.path)}</span>
    </div>
  )
}
