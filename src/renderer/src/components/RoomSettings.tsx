import { useRef, useState } from 'react'
import { IconButton } from './Icon'
import { HeaderPopover } from './HeaderPopover'
import { ChoiceSetting } from './settings/controls'
import { useStore } from '../state/hooks'
import type { BufferEntry } from '../state/store'

/** What the daemon says about one of a room's settings. */
interface Choice {
  value: string
  choices: string[]
  canChange: boolean
}

/**
 * The settings a room keeps about itself.
 *
 * Matrix room state, as opposed to the account's own preferences: these
 * belong to the room and change it for everybody in it, which is why they are
 * here rather than in the settings panel and why each one says whether this
 * account may actually change it.
 *
 * Read when the panel opens rather than held. They change rarely and are
 * looked at rarely, and a value fetched at the moment it is shown cannot be
 * stale - which matters more here than elsewhere, since somebody opening this
 * is usually checking what is true rather than browsing.
 */
export function RoomSettings({ buffer }: { buffer: BufferEntry }): JSX.Element {
  const store = useStore()
  const button = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<Choice | null>(null)
  const [saving, setSaving] = useState(false)

  const load = (): void => {
    setHistory(null)
    void window.moho
      .rpc<Choice>('matrixHistoryVisibility', { bufferId: buffer.id })
      .then(setHistory)
      .catch((e: Error) => store.toast('error', e.message))
  }

  const show = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    load()
  }

  const setHistoryVisibility = (value: string): void => {
    const before = history
    setHistory(history ? { ...history, value } : null)
    setSaving(true)
    void window.moho
      .rpc('setMatrixHistoryVisibility', { bufferId: buffer.id, value })
      .then(() => store.toast('info', `New members can now read ${readableAs(value)}`))
      .catch((e: Error) => {
        setHistory(before)
        store.toast('error', `Couldn't change that: ${e.message}`)
      })
      .finally(() => setSaving(false))
  }

  return (
    <>
      <span ref={button} className="header-anchor">
        <IconButton
          name="tune"
          title="What this room keeps"
          className={open ? 'active' : undefined}
          onClick={show}
        />
      </span>
      {open && (
        <HeaderPopover anchor={button.current} width={400} onClose={() => setOpen(false)}>
          <div className="small muted">This room&apos;s settings</div>
          {history === null && <div className="small muted">Looking…</div>}
          {history && (
            <>
              <ChoiceSetting
                label="Who can read the past"
                description={
                  history.canChange
                    ? 'Applies from now on. What has already been said keeps the rule it was said under.'
                    : 'Only somebody who can change this room’s settings can change this.'
                }
                value={history.value}
                options={history.choices.map((value) => ({ label: historyLabel(value), value }))}
                disabled={!history.canChange || saving}
                onChange={setHistoryVisibility}
              />
              {/* Worth saying plainly rather than leaving to the wording of
                  the option: this is the one room setting here with a
                  consequence somebody may not expect, and "world readable"
                  really does mean anybody at all. */}
              {history.value === 'world_readable' && (
                <div className="small muted">
                  Anyone can read this room without joining it, including people with no account.
                </div>
              )}
            </>
          )}
        </HeaderPopover>
      )}
    </>
  )
}

/**
 * The spec's four values as a sentence about people rather than as protocol
 * words.
 *
 * "shared" and "invited" say nothing on their own - they are the names of
 * rules, not descriptions of them - and this is a setting somebody gets wrong
 * once and cannot take back, because it only ever applies from now on.
 */
function historyLabel(value: string): string {
  switch (value) {
    case 'world_readable':
      return 'Anyone, without joining'
    case 'shared':
      return 'Everything, once they join'
    case 'invited':
      return 'From when they were invited'
    case 'joined':
      return 'Only from when they joined'
    default:
      // A value this client does not know is shown as itself. Quietly
      // relabelling somebody's setting would be worse than admitting it.
      return value
  }
}

/** The same thing said as the end of a sentence, for the toast. */
function readableAs(value: string): string {
  switch (value) {
    case 'world_readable':
      return 'this room without joining it'
    case 'shared':
      return 'everything said before they joined'
    case 'invited':
      return 'what was said after they were invited'
    case 'joined':
      return 'only what is said after they join'
    default:
      return value
  }
}
