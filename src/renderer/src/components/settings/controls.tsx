import { useEffect, useRef, useState } from 'react'
import { usePref } from '../../state/hooks'
import { Icon } from '../Icon'
import { Switch } from '../Switch'

/**
 * The setting primitives the original frontend's PluginSettings provided,
 * rebuilt against the local preference store. Each writes through on change,
 * so there's no save button anywhere in Settings.
 */

/**
 * A brief tick beside a field that saves when it is left, so leaving it says
 * that it took. Anything that writes on blur or Enter has no button to say so.
 */
export function useSavedFlash(): [boolean, () => void] {
  const [shown, setShown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return [
    shown,
    () => {
      setShown(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setShown(false), 1400)
    }
  ]
}

export function SavedMark({ shown }: { shown: boolean }): JSX.Element {
  return (
    <span className={`saved-mark${shown ? ' shown' : ''}`} aria-live="polite" title="Saved">
      {shown && <Icon name="check" size={16} />}
    </span>
  )
}

export function SettingsSection({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children?: React.ReactNode
}): JSX.Element {
  return (
    <div className="settings-section">
      <h4 className="settings-section-title">{title}</h4>
      {description && <p className="small muted settings-section-desc">{description}</p>}
      {children}
    </div>
  )
}

export function ToggleSetting({
  settingKey,
  label,
  description,
  defaultValue = false
}: {
  settingKey: string
  label: string
  description?: string
  defaultValue?: boolean
}): JSX.Element {
  const [value, setValue] = usePref<boolean>(settingKey, defaultValue)
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div>{label}</div>
        {description && <div className="small muted">{description}</div>}
      </div>
      <Switch checked={value} onChange={setValue} label={label} />
    </div>
  )
}

export function StringSetting({
  settingKey,
  label,
  description,
  defaultValue = '',
  placeholder
}: {
  settingKey: string
  label: string
  description?: string
  defaultValue?: string
  placeholder?: string
}): JSX.Element {
  const [value, setValue] = usePref<string>(settingKey, defaultValue)
  // Local draft so every keystroke isn't a write through IPC to the prefs
  // file; committed on blur or Enter.
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const [saved, flash] = useSavedFlash()
  const save = (): void => {
    if (draft === value) return
    setValue(draft)
    flash()
  }

  return (
    <div className="setting-row">
      <div className="setting-text">
        <div>{label}</div>
        {description && <div className="small muted">{description}</div>}
      </div>
      <SavedMark shown={saved} />
      <input
        className="text-field setting-input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
    </div>
  )
}

export function SelectionSetting({
  settingKey,
  label,
  description,
  defaultValue,
  options
}: {
  settingKey: string
  label: string
  description?: string
  defaultValue: string
  options: { label: string; value: string }[]
}): JSX.Element {
  const [value, setValue] = usePref<string>(settingKey, defaultValue)
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div>{label}</div>
        {description && <div className="small muted">{description}</div>}
      </div>
      <div className="setting-segmented">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={value === opt.value ? 'active' : undefined}
            onClick={() => setValue(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * A folder chosen through the system picker, with the platform default shown
 * (and used) until the user overrides it.
 *
 * Stored empty rather than pre-filled with the resolved default: writing the
 * default in would freeze today's path into the preferences file, so a later
 * change to the account's own Downloads location would stop being followed.
 */
export function DirectorySetting({
  settingKey,
  label,
  description,
  defaultPath
}: {
  settingKey: string
  label: string
  description?: string
  defaultPath?: string
}): JSX.Element {
  const [value, setValue] = usePref<string>(settingKey, '')

  return (
    <div className="setting-row">
      <div className="setting-text">
        <div>{label}</div>
        {description && <div className="small muted">{description}</div>}
        <div className="small muted ellipsis">
          {value || defaultPath || 'the system downloads folder'}
          {!value && ' (default)'}
        </div>
      </div>
      <div className="setting-actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            void window.moho.pickDirectory().then((dir) => dir && setValue(dir))
          }}
        >
          Browse…
        </button>
        {value && (
          <button type="button" className="button" onClick={() => setValue('')}>
            Reset
          </button>
        )}
      </div>
    </div>
  )
}


/**
 * A dropdown over values the daemon owns rather than a stored preference.
 *
 * Separate from SelectionSetting because that one is backed by a pref key and
 * renders every option as a button: sound devices are neither - they live in
 * the daemon, and a machine can easily have a dozen.
 */
export function ChoiceSetting({
  label,
  description,
  value,
  options,
  onChange,
  disabled
}: {
  label: string
  description?: string
  value: string
  options: { label: string; value: string; disabled?: boolean }[]
  onChange: (value: string) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div>{label}</div>
        {description && <div className="small muted">{description}</div>}
      </div>
      <select
        className="setting-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          // Offered greyed rather than dropped: "this room is too old for
          // that" is a fact worth having, and a menu with three entries on
          // one room and five on another is one nobody can learn.
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
