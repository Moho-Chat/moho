import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useStore } from '../state/hooks'
import { resolveMediaUrl } from '../lib/util'
import type { Account } from '../../../shared/wire'

/** What the account looks like to everybody on Stoat. */
interface OwnProfile {
  handle: string
  displayName: string
  pronouns: string
  bio: string
  statusText: string
  avatarUrl?: string | null
}

/**
 * The account's own profile on Stoat, under its card in the Accounts pane. Separate from the local name moho calls the
 * account by: this is what every server and conversation shows. Only what was changed is sent.
 */
export function StoatAccountTools({ account }: { account: Account }): JSX.Element | null {
  const store = useStore()
  const [profile, setProfile] = useState<OwnProfile | null>(null)
  const [form, setForm] = useState({ displayName: '', pronouns: '', bio: '', statusText: '' })
  const [busy, setBusy] = useState(false)

  const load = (): void => {
    void window.moho
      .rpc<OwnProfile>('stoatOwnProfile', { accountId: account.id })
      .then((p) => {
        setProfile(p)
        setForm({ displayName: p.displayName, pronouns: p.pronouns, bio: p.bio, statusText: p.statusText })
      })
      // An account still connecting has no answer yet; the panel shows nothing in its place.
      .catch(() => setProfile(null))
  }
  // Asked again once the account is up, since the first open can be before it is.
  useEffect(load, [account.id, account.state])

  if (!profile) return null

  const changed = (Object.keys(form) as (keyof typeof form)[]).filter((k) => form[k].trim() !== profile[k].trim())
  const save = (): void => {
    setBusy(true)
    const body: Record<string, string> = {}
    for (const k of changed) body[k] = form[k]
    void window.moho
      .rpc('setStoatProfile', { accountId: account.id, ...body })
      .then(() => {
        store.toast('info', 'Profile changed')
        load()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }
  const picture = (path: string): void => {
    setBusy(true)
    void window.moho
      .rpc('setStoatProfileAvatar', { accountId: account.id, path })
      .then(() => {
        store.toast('info', path ? 'Picture changed' : 'Picture taken off')
        load()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }
  const field = (key: keyof typeof form, label: string, placeholder = '', area = false): JSX.Element => (
    <label className="field">
      <span className="small muted">{label}</span>
      {area ? (
        <textarea className="text-field" rows={3} placeholder={placeholder} value={form[key]} disabled={busy} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      ) : (
        <input className="text-field" type="text" placeholder={placeholder} value={form[key]} disabled={busy} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      )}
    </label>
  )

  return (
    <div className="account-tools">
      <div className="setting-row">
        <div className="setting-text">
          <div>Your profile on Stoat ({profile.handle})</div>
          <div className="small muted">Changing these changes them for everyone who can see you.</div>
        </div>
      </div>
      <div className="device-row">
        {profile.avatarUrl ? <img className="account-avatar" src={resolveMediaUrl(profile.avatarUrl)} alt="" /> : <Icon name="account_circle" size={18} />}
        <div className="setting-text" />
        <button type="button" className="button subtle" disabled={busy} onClick={() => void window.moho.pickFile().then((path) => path && picture(path))}>
          Change picture
        </button>
        {profile.avatarUrl && (
          <button type="button" className="button subtle" disabled={busy} onClick={() => picture('')}>
            Take it off
          </button>
        )}
      </div>
      <div className="field-row">
        {field('displayName', 'Display name', 'Your username is shown if empty')}
        {field('pronouns', 'Pronouns', 'she, her')}
      </div>
      {field('statusText', 'Beside your status', 'What you are up to')}
      {field('bio', 'About you', 'Shown on your profile card', true)}
      <div className="field-row">
        <button type="button" className="button primary" disabled={busy || changed.length === 0} onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}
