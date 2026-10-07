import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { FORMAT_LABELS, PALETTE, type FormatKind } from '../lib/composeFormat'
import { applyFormat } from '../lib/composeFormatDom'

const ICONS: Record<FormatKind, string> = {
  bold: 'format_bold',
  italic: 'format_italic',
  underline: 'format_underlined',
  strike: 'format_strikethrough',
  code: 'code',
  spoiler: 'visibility_off',
  quote: 'format_quote',
  color: 'palette'
}

/** Which of the formats read as a group, so a rule can be drawn between groups. */
const GROUPS: FormatKind[][] = [
  ['bold', 'italic', 'underline', 'strike'],
  ['code', 'spoiler', 'quote'],
  ['color']
]

/**
 * The strip that appears over selected text in the message box, offering what
 * the service the message is going to can carry - and only that. It follows
 * the selection and is gone with it.
 */
export function FormatBar({
  input,
  formats,
  onChange
}: {
  input: React.RefObject<HTMLDivElement>
  formats: FormatKind[]
  onChange: () => void
}): JSX.Element | null {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const [colours, setColours] = useState(false)

  useEffect(() => {
    const follow = (): void => {
      const root = input.current
      const selection = window.getSelection()
      if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setAt(null)
        setColours(false)
        return
      }
      const range = selection.getRangeAt(0)
      if (!root.contains(range.commonAncestorContainer)) {
        setAt(null)
        setColours(false)
        return
      }
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      setAt({ x: rect.left + rect.width / 2, y: rect.top })
    }
    // A right click selects the word under it, which is the spellchecker's
    // business and not an invitation to format it. Kept away until the next
    // press or key, so the strip is not drawn behind the menu.
    let held = false
    const guarded = (): void => {
      if (!held) follow()
    }
    const hold = (): void => {
      held = true
      setAt(null)
      setColours(false)
    }
    const release = (): void => {
      held = false
    }
    document.addEventListener('selectionchange', guarded)
    document.addEventListener('contextmenu', hold)
    document.addEventListener('mousedown', release, true)
    document.addEventListener('keydown', release, true)
    return () => {
      document.removeEventListener('selectionchange', guarded)
      document.removeEventListener('contextmenu', hold)
      document.removeEventListener('mousedown', release, true)
      document.removeEventListener('keydown', release, true)
    }
  }, [input])

  const shown = GROUPS.map((g) => g.filter((k) => formats.includes(k))).filter((g) => g.length > 0)
  if (!at || shown.length === 0) return null

  const apply = (kind: FormatKind, colour?: string): void => {
    if (input.current && applyFormat(input.current, kind, colour)) onChange()
    setColours(false)
  }

  return createPortal(
    <div
      className="format-bar"
      style={{ left: at.x, top: at.y }}
      // A press here must not take the selection away from the text it is for.
      onMouseDown={(e) => e.preventDefault()}
      role="toolbar"
      aria-label="Format selected text"
    >
      {shown.map((group, i) => (
        <span key={i} className="format-group">
          {group.map((kind) => (
            <button
              key={kind}
              type="button"
              className="format-button"
              title={FORMAT_LABELS[kind]}
              aria-label={FORMAT_LABELS[kind]}
              onClick={() => (kind === 'color' ? setColours((c) => !c) : apply(kind))}
            >
              <Icon name={ICONS[kind]} size={18} />
            </button>
          ))}
        </span>
      ))}
      {colours && (
        <div className="format-colours">
          {PALETTE.map((hex) => (
            <button
              key={hex}
              type="button"
              className="format-swatch"
              style={{ background: hex }}
              title={hex}
              aria-label={`Colour ${hex}`}
              onClick={() => apply('color', hex)}
            />
          ))}
          <button type="button" className="format-swatch none" title="No colour" aria-label="No colour" onClick={() => apply('color')}>
            <Icon name="format_color_reset" size={14} />
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}
