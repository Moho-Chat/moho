import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { rankBuffers, whereText } from '../lib/switcher'
import { bufferKindGlyph, classes } from '../lib/util'

/** The window event that opens it - from Ctrl+K and from the title bar's search button. */
export const OPEN_SWITCHER = 'moho:open-switcher'

/**
 * Jump to any conversation on any account by typing a few letters of its name.
 * What is waiting comes first, so pressing the key and Enter is "take me to
 * the next thing that needs me".
 */
export function QuickSwitcher(): JSX.Element | null {
  const store = useStore()
  const buffers = useChat((s) => s.buffers)
  const accounts = useChat((s) => s.accounts)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const toggle = (): void => {
      setOpen((was) => !was)
      setQuery('')
      setIndex(0)
    }
    window.addEventListener(OPEN_SWITCHER, toggle)
    return () => window.removeEventListener(OPEN_SWITCHER, toggle)
  }, [])

  const accountName = (id: string): string => accounts.find((a) => a.id === id)?.displayName ?? ''
  const hits = useMemo(
    () => (open ? rankBuffers(buffers, query, (b) => whereText(b, accountName)) : []),
    // accountName closes over accounts, which is what changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, buffers, query, accounts]
  )

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  // Keeps the chosen row in view as the arrows move it.
  useEffect(() => {
    list.current?.querySelector('.switcher-row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [index, hits.length])

  if (!open) return null

  const close = (): void => setOpen(false)
  const go = (i: number): void => {
    const hit = hits[i]
    if (!hit) return
    close()
    void store.selectBuffer(hit.buffer.id, true)
  }

  return createPortal(
    <div className="modal-scrim switcher-scrim" onMouseDown={close}>
      <div
        className="switcher"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a conversation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="switcher-field">
          <Icon name="search" size={18} />
          <input
            ref={input}
            className="switcher-input"
            placeholder="Where would you like to go?"
            value={query}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                close()
              } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
                e.preventDefault()
                setIndex((i) => Math.min(hits.length - 1, i + 1))
              } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                go(index)
              }
            }}
          />
        </div>
        <div className="switcher-list" ref={list} role="listbox">
          {hits.length === 0 && <div className="switcher-empty muted">Nothing by that name.</div>}
          {hits.map((hit, i) => {
            const b = hit.buffer
            return (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={i === index}
                className={classes('switcher-row', i === index && 'selected', b.unread > 0 && 'unread')}
                onMouseMove={() => i !== index && setIndex(i)}
                onClick={() => go(i)}
              >
                <span className="switcher-lead">
                  {b.kind === 'dm' ? (
                    <Avatar name={hit.title} url={b.avatarUrl} size={20} accountId={b.accountId} />
                  ) : (
                    <Icon name={bufferKindGlyph(b.kind)} size={16} />
                  )}
                </span>
                <span className="switcher-title ellipsis">{hit.title}</span>
                <span className="switcher-where muted small ellipsis">{hit.where}</span>
                {b.unread > 0 && (
                  <span className={classes('unread-badge', b.highlight && 'highlight')}>
                    {b.unread > 99 ? '99+' : b.unread}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div className="switcher-hint muted small">
          <span>↑↓ to move</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
