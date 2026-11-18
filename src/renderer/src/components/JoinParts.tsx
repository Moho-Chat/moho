import { useState } from 'react'
import { Icon } from './Icon'
import { classes } from '../lib/util'

/**
 * What every service's page in the "+" pane is built from (#339).
 *
 * Each service still has a page of its own - what there is to join on IRC and
 * on Signal has little in common - but they are assembled from the same few
 * parts in the same order: people first, then joining, making, browsing, and
 * last whatever the service only allows in its own client. So "message
 * somebody" is the first thing on every page that has it, and a field with a
 * button looks and behaves the same wherever it is.
 */

/** The sections, in the order they come on every page. A page uses the ones it has something for. */
export const SECTIONS = {
  people: 'People',
  join: 'Join',
  create: 'Create',
  browse: 'Browse',
  elsewhere: 'Elsewhere',
  manage: 'Manage'
} as const

/** A group of actions under a small heading. */
export function JoinSection({ kind, label, children }: { kind: keyof typeof SECTIONS; label?: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="page-section" data-join-section={kind}>
      <h4 className="section-label">{label ?? SECTIONS[kind]}</h4>
      <div className="card join-card">{children}</div>
    </section>
  )
}

/**
 * One thing that can be done: its icon, what it is, a line on what it means,
 * and its control - beside the words when it is a single button, under them
 * when it is a field.
 */
export function JoinAction({
  icon,
  title,
  help,
  aside,
  children
}: {
  icon: string
  title: React.ReactNode
  help?: React.ReactNode
  /** A control that fits on the title's line: a button, a pair of tabs. */
  aside?: React.ReactNode
  /** What goes under the words: the field, a list. */
  children?: React.ReactNode
}): JSX.Element {
  return (
    <div className="join-action">
      <span className="join-action-icon">
        <Icon name={icon} size={18} />
      </span>
      <div className="join-action-body">
        <div className="join-action-head">
          <div className="join-action-text">
            <div className="join-action-title">{title}</div>
            {help && <div className="join-action-help">{help}</div>}
          </div>
          {aside}
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * A field and the button that sends it. Enter does the same as the button,
 * and the button says the verb it performs - "Message", not "Join", where
 * what happens is a message.
 */
export function ActionField({
  placeholder,
  verb,
  onSubmit,
  disabled,
  busy,
  value: held,
  onChange,
  keep,
  type,
  valid
}: {
  placeholder: string
  verb: string
  onSubmit: (value: string) => void
  disabled?: boolean
  busy?: boolean
  /** Held by the caller, where something else needs to read or fill the field. */
  value?: string
  onChange?: (value: string) => void
  /** Leave what was typed in place after sending: the caller clears it once the answer is in. */
  keep?: boolean
  type?: string
  /** Whether what is typed can be sent. Anything non-empty, unless said. */
  valid?: (value: string) => boolean
}): JSX.Element {
  const [own, setOwn] = useState('')
  const value = held ?? own
  const set = (v: string): void => (onChange ? onChange(v) : setOwn(v))
  const ready = !disabled && !busy && (valid ? valid(value.trim()) : !!value.trim())
  const submit = (): void => {
    if (!ready) return
    onSubmit(value.trim())
    if (!keep) set('')
  }
  return (
    <div className="action-field">
      <input
        className="text-field"
        type={type}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        value={value}
        disabled={disabled || busy}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button type="button" className="button primary" disabled={!ready} onClick={submit}>
        {verb}
      </button>
    </div>
  )
}

/**
 * A row in a list of people or places: a face, a name, what else is known,
 * and what can be done about it.
 */
export function JoinRow({
  face,
  name,
  sub,
  title,
  onClick,
  picked,
  children,
  onContextMenu
}: {
  face?: React.ReactNode
  name: React.ReactNode
  sub?: React.ReactNode
  title?: string
  /** The whole row is the action, where there is one obvious thing to do with it. */
  onClick?: () => void
  picked?: boolean
  children?: React.ReactNode
  onContextMenu?: (e: React.MouseEvent) => void
}): JSX.Element {
  const inner = (
    <>
      {face}
      <span className="join-row-text">
        <span className="join-row-name ellipsis">{name}</span>
        {sub && <span className="join-row-sub ellipsis">{sub}</span>}
      </span>
      {children}
    </>
  )
  return onClick ? (
    <button type="button" className={classes('join-row', 'pressable', picked && 'picked')} title={title} onClick={onClick} onContextMenu={onContextMenu}>
      {inner}
    </button>
  ) : (
    <div className={classes('join-row', picked && 'picked')} title={title}>
      {inner}
    </div>
  )
}

/** A letter on a disc, for somebody with no picture. */
export function Initial({ name }: { name: string }): JSX.Element {
  return <span className="friend-avatar placeholder">{name.trim().slice(0, 1).toUpperCase() || '?'}</span>
}

/** A heading inside a card, over a list that belongs to the action above it. */
export function JoinListHead({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="join-list-head">{children}</div>
}
