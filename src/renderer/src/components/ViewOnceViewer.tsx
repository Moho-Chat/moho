import { Lightbox } from './Lightbox'
import { useChat, useStore } from '../state/hooks'
import { resolveMediaUrl } from '../lib/util'

/**
 * A Signal view-once picture or video, opened from its message. Shown over everything in the viewer every other
 * picture uses, and given back when closed: the daemon takes the file away, and the message has already forgotten it.
 */
export function ViewOnceViewer(): JSX.Element | null {
  const store = useStore()
  const shown = useChat((s) => s.viewOnce)
  if (!shown) return null
  return (
    <Lightbox
      source={{
        kind: shown.kind,
        src: resolveMediaUrl(shown.path),
        from: shown.from,
        filename: 'View once',
        once: true,
        ...(shown.width ? { width: shown.width } : {}),
        ...(shown.height ? { height: shown.height } : {})
      }}
      onClose={() => store.closeViewOnce()}
    />
  )
}
