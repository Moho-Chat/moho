import { useEffect, useState } from 'react'
import { usePref } from '../../state/hooks'

/**
 * The setting primitives the original frontend's PluginSettings provided,
 * rebuilt against the local preference store. Each writes through on change,
 * so there's no save button anywhere in Settings.
 */

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
    <label className="setting-row">
      <div className="setting-text">
        <div>{label}</div>
        {description && <div className="small muted">{description}</div>}
      </div>
      <input
        type="checkbox"
        className="setting-toggle"
        checked={value}
        onChange={(e) => setValue(e.target.checked)}
      />
    </label>
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

  return (
    <div className="setting-row">
      <div className="setting-text">
        <div>{label}</div>
        {description && <div className="small muted">{description}</div>}
      </div>
      <input
        className="text-field setting-input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && setValue(draft)}
        onKeyDown={(e) => e.key === 'Enter' && setValue(draft)}
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
