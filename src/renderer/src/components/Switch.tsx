import { classes } from '../lib/util'

/**
 * The one on/off control. Every boolean in the app is this, at the right-hand
 * end of its row: there used to be a native checkbox, a checkbox with its box
 * on the left and this, sometimes on the same page.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** What a screen reader says it is, where the row's own text is not next to it in the tree. */
  label?: string
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={classes('switch', checked && 'on')}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  )
}

/**
 * A switch with its words: what it does on the left, the switch on the right,
 * centred on the pair. Every boolean in settings and accounts is a row of
 * this shape, so the right-hand edge is always where to look.
 */
export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled
}: {
  title: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="switch-row">
      <span className="switch-text">
        <span>{title}</span>
        {description && <span className="small muted">{description}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  )
}
