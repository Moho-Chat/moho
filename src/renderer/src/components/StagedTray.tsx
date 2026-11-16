import { useRef, useState } from 'react'
import { Icon } from './Icon'
import { Lightbox } from './Lightbox'
import { classes, humanSize, resolveMediaUrl } from '../lib/util'
import { fileKind, fileKindIcon, clockLength, type FileKind } from '../lib/filekind'

/** A file waiting in the box to be sent. */
export interface StagedAttachment {
  id: number
  path: string
  name: string
  isImage: boolean
  /** A picture of it where the path cannot be shown: made from the dropped file. */
  preview?: string
  /** In bytes, once it has been asked. */
  size?: number | null
  /** Sent hidden behind a spoiler: Discord, Steam, Telegram and Stoat. On Signal, sent to view once. */
  spoiler: boolean
}

/**
 * What is about to be sent with the message: one small card a file, in the
 * order they will go (#339).
 *
 * A card shows the thing itself where it can - the picture, a frame of the
 * video - and what kind of thing it is where it cannot. They sit in one row
 * that scrolls sideways, so ten files take the height of one, and are dragged
 * into the order wanted.
 */
export function StagedTray({
  staged,
  onChange,
  service
}: {
  staged: StagedAttachment[]
  onChange: (next: StagedAttachment[]) => void
  service: string
}): JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [viewing, setViewing] = useState<StagedAttachment | null>(null)

  const sizes = staged.map((a) => a.size).filter((s): s is number => typeof s === 'number')
  const total = sizes.reduce((sum, s) => sum + s, 0)
  const hides = service === 'discord' || service === 'steam' || service === 'telegram' || service === 'stoat'

  const move = (id: number, before: number): void => {
    if (id === before) return
    const moved = staged.find((a) => a.id === id)
    if (!moved) return
    const rest = staged.filter((a) => a.id !== id)
    const at = rest.findIndex((a) => a.id === before)
    // Dropped on one further along: it lands after it, which is where the pointer was heading.
    const forward = staged.findIndex((a) => a.id === id) < staged.findIndex((a) => a.id === before)
    rest.splice(forward ? at + 1 : at, 0, moved)
    onChange(rest)
  }
  const toggle = (id: number): void => onChange(staged.map((a) => (a.id === id ? { ...a, spoiler: !a.spoiler } : a)))

  return (
    <div className="staged-tray">
      <div className="staged-summary small muted">
        {staged.length} file{staged.length === 1 ? '' : 's'}
        {sizes.length > 0 && ` · ${humanSize(total)}`}
        {staged.length > 1 && <span className="staged-hint"> · drag to reorder</span>}
        {staged.length > 1 && (
          <button type="button" className="staged-clear" onClick={() => onChange([])}>
            Remove all
          </button>
        )}
      </div>
      <div className="composer-attachments">
        {staged.map((att) => {
          const kind = fileKind(att.name)
          const src = att.preview ?? resolveMediaUrl(att.path)
          const looks = kind === 'image' || kind === 'video'
          return (
            <div
              key={att.id}
              className={classes(
                'staged-card',
                att.spoiler && 'is-spoiler',
                dragging === att.id && 'dragging',
                over === att.id && dragging !== null && dragging !== att.id && 'drop-target'
              )}
              draggable={staged.length > 1}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('application/x-moho-staged', String(att.id))
                setDragging(att.id)
              }}
              onDragEnd={() => {
                setDragging(null)
                setOver(null)
              }}
              onDragOver={(e) => {
                if (dragging === null) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOver(att.id)
              }}
              onDrop={(e) => {
                if (dragging === null) return
                e.preventDefault()
                e.stopPropagation()
                move(dragging, att.id)
                setDragging(null)
                setOver(null)
              }}
            >
              <button
                type="button"
                className="staged-preview"
                title={looks ? `Look at ${att.name}` : att.name}
                disabled={!looks}
                onClick={() => setViewing(att)}
              >
                <StagedFace kind={kind} src={src} name={att.name} />
                {att.spoiler && <span className="staged-spoiler-pill">{service === 'signal' ? 'VIEW ONCE' : 'SPOILER'}</span>}
              </button>
              <div className="staged-meta">
                <span className="staged-name ellipsis" title={att.name}>
                  {att.name}
                </span>
                <span className="small muted">{typeof att.size === 'number' ? humanSize(att.size) : ' '}</span>
              </div>
              <div className="staged-actions">
                {service === 'signal' && /\.(jpe?g|png|gif|webp|heic|mp4|m4v|mov|webm)$/i.test(att.name) && (
                  <button
                    type="button"
                    className={classes('staged-action', att.spoiler && 'on')}
                    title={att.spoiler ? 'Send normally' : 'View once: each person can open it one time'}
                    aria-pressed={att.spoiler}
                    onClick={() => toggle(att.id)}
                  >
                    <Icon name={att.spoiler ? 'timer' : 'timer_off'} size={14} />
                  </button>
                )}
                {hides && (
                  <button
                    type="button"
                    className={classes('staged-action', att.spoiler && 'on')}
                    title={att.spoiler ? 'Not a spoiler' : 'Mark as spoiler'}
                    aria-pressed={att.spoiler}
                    onClick={() => toggle(att.id)}
                  >
                    <Icon name={att.spoiler ? 'visibility_off' : 'visibility'} size={14} />
                  </button>
                )}
                {/* Always there: taking a file back out is the one thing every card is for. */}
                <button
                  type="button"
                  className="staged-action danger always"
                  title={`Remove ${att.name}`}
                  onClick={() => onChange(staged.filter((x) => x.id !== att.id))}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {viewing && (
        <Lightbox
          source={{
            kind: fileKind(viewing.name) === 'video' ? 'video' : 'image',
            src: viewing.preview ?? resolveMediaUrl(viewing.path),
            filename: viewing.name
          }}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  )
}

/**
 * What a card shows of its file: the picture, a frame of the video with how
 * long it runs, or a glyph for what kind of file it is with its ending on a
 * chip.
 */
function StagedFace({ kind, src, name }: { kind: FileKind; src: string; name: string }): JSX.Element {
  const [length, setLength] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toUpperCase()

  if (kind === 'image' && !failed) return <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />

  if (kind === 'video' && !failed) {
    return (
      <>
        {/* The frame a second in, which is past the black most videos open on. Never played here. */}
        <video
          ref={video}
          src={`${src}#t=1`}
          preload="metadata"
          muted
          playsInline
          draggable={false}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (Number.isFinite(v.duration)) setLength(v.duration)
            // Shorter than the second asked for: its middle, rather than its last frame.
            if (v.duration < 1.2) v.currentTime = v.duration / 2
          }}
          onError={() => setFailed(true)}
        />
        <span className="staged-play">
          <Icon name="play_arrow" size={18} fill />
        </span>
        {length !== null && <span className="staged-length">{clockLength(length)}</span>}
      </>
    )
  }

  return (
    <>
      {kind === 'audio' && (
        <audio
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLength(e.currentTarget.duration)}
        />
      )}
      <Icon name={fileKindIcon(kind)} size={30} />
      {kind === 'audio' && length !== null ? (
        <span className="staged-length">{clockLength(length)}</span>
      ) : (
        ext && <span className="staged-ext">{ext}</span>
      )}
    </>
  )
}
