import { useMemo, useRef, useState } from 'react'
import { HeaderPopover } from './HeaderPopover'
import { RichText } from '../lib/richtext'
import { formatMessage } from '../lib/format'

/**
 * What a conversation says it is for, on one line beside its name.
 *
 * Every client of this kind has it and it was the one thing here that did
 * not: an IRC channel's topic arrived as a line in the log and then scrolled
 * away. A click opens the whole of it, with its links live - a topic is very
 * often a rule, a schedule and a few links, and one line holds the start of
 * that.
 */
export function HeaderTopic({ topic }: { topic: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  // Through the same pipeline every other body goes through, so a link is a
  // link. Built only when opened.
  const html = useMemo(() => (open ? formatMessage(topic) : ''), [open, topic])
  const oneLine = topic.replace(/\s+/g, ' ').trim()

  return (
    <>
      <button
        ref={button}
        type="button"
        className="header-topic"
        title="Show the whole topic"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="ellipsis">{oneLine}</span>
      </button>
      {open && (
        <HeaderPopover anchor={button.current} width={460} onClose={() => setOpen(false)}>
          <div className="small muted">Topic</div>
          <div className="header-topic-full">
            <RichText html={html} />
          </div>
        </HeaderPopover>
      )}
    </>
  )
}
