import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { ask } from '../lib/ask'
import { useStore } from '../state/hooks'
import { resolveMediaUrl } from '../lib/util'
import type { Account } from '../../../shared/wire'

/** What the account looks like to everybody on Telegram. */
interface OwnProfile {
  firstName: string
  lastName: string
  bio: string
  username: string
  phone: string
  avatarUrl?: string | null
}

/** One session signed in to the account, as Telegram's Settings, Devices lists it. */
interface Session {
  id: string
  app: string
  device: string
  place: string
  ip: string
  lastActive: number
  current: boolean
  unconfirmed: boolean
}

/** When a session was last used, in words. */
function lastUsed(ts: number): string {
  const ago = Date.now() / 1000 - ts
  if (ago < 120) return 'active now'
  if (ago < 3600) return `${Math.round(ago / 60)} minutes ago`
  if (ago < 86400) return `${Math.round(ago / 3600)} hours ago`
  return new Date(ts * 1000).toLocaleDateString()
}

/**
 * The account's own profile on Telegram, and the sessions signed in to it, under its card in the Accounts pane.
 * Separate from the local name moho calls the account by: this is what everybody on Telegram sees. Only what was
 * changed is sent.
 */
export function TelegramAccountTools({ account }: { account: Account }): JSX.Element | null {
  const store = useStore()
  const [profile, setProfile] = useState<OwnProfile | null>(null)
  const [form, setForm] = useState({ firstName: '', lastName: '', bio: '', username: '' })
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [ending, setEnding] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = (): void => {
    void ask<OwnProfile>('telegramOwnProfile', { accountId: account.id })
      .then((p) => {
        setProfile(p)
        setForm({ firstName: p.firstName, lastName: p.lastName, bio: p.bio, username: p.username })
      })
      // An account still connecting has no answer yet; the panel shows nothing in its place.
      .catch(() => setProfile(null))
    void ask<Session[]>('telegramSessions', { accountId: account.id })
      .then(setSessions)
      .catch(() => setSessions(null))
  }
  // Asked again once the account is up, since the first open can be before it is.
  useEffect(load, [account.id, account.state])

  if (!profile) return null

  const fail = (e: Error): void => store.toast('error', e.message)
  const nameChanged = (['firstName', 'lastName', 'bio'] as const).filter((k) => form[k].trim() !== profile[k].trim())
  const usernameChanged = form.username.trim().replace(/^@/, '') !== profile.username
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      if (nameChanged.length > 0) {
        const body: Record<string, string> = {}
        for (const k of nameChanged) body[k] = form[k]
        await ask('setTelegramProfile', { accountId: account.id, ...body })
      }
      if (usernameChanged) await ask('setTelegramUsername', { accountId: account.id, username: form.username })
      store.toast('info', 'Profile changed')
      load()
    } catch (e) {
      fail(e as Error)
    } finally {
      setBusy(false)
    }
  }
  const picture = (path: string): void => {
    setBusy(true)
    void ask('setTelegramProfilePhoto', { accountId: account.id, path })
      .then(() => {
        store.toast('info', path ? 'Picture changed' : 'Picture taken off')
        load()
      })
      .catch(fail)
      .finally(() => setBusy(false))
  }
  const end = (id: string): void => {
    setEnding(null)
    void ask('endTelegramSession', { accountId: account.id, sessionId: id })
      .then(() => {
        store.toast('info', 'That session is signed out')
        load()
      })
      .catch(fail)
  }
  const field = (key: keyof typeof form, label: string, placeholder = '', area = false): JSX.Element => (
    <label className="field">
      <span className="small muted">{label}</span>
      {area ? (
        <textarea className="text-field" rows={2} maxLength={70} placeholder={placeholder} value={form[key]} disabled={busy} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      ) : (
        <input className="text-field" type="text" placeholder={placeholder} value={form[key]} disabled={busy} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      )}
    </label>
  )

  return (
    <div className="account-tools">
      <div className="setting-row">
        <div className="setting-text">
          <div>Your profile on Telegram{profile.phone ? ` (${profile.phone})` : ''}</div>
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
        {field('firstName', 'First name')}
        {field('lastName', 'Last name', 'Optional')}
      </div>
      {field('username', 'Username', 'Lets people find you without your number')}
      {field('bio', 'Bio', 'A few words about yourself', true)}
      <div className="field-row">
        <button type="button" className="button primary" disabled={busy || (nameChanged.length === 0 && !usernameChanged)} onClick={() => void save()}>
          Save
        </button>
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <div>Signed-in sessions</div>
          <div className="small muted">Everywhere this account is signed in, as Telegram&rsquo;s own Devices list shows it. Signing one out ends it there.</div>
        </div>
      </div>
      {sessions?.map((s) => (
        <div key={s.id} className="device-row">
          <Icon name={s.current ? 'verified_user' : 'devices'} size={18} color={s.current ? 'var(--success)' : undefined} />
          <div className="setting-text">
            <div className="ellipsis">
              {s.app || 'Unknown app'}
              {s.current ? ' · this one' : ''}
              {s.unconfirmed ? ' · not yet confirmed' : ''}
            </div>
            <div className="small muted ellipsis">
              {[s.device, s.place, s.ip, s.current ? '' : lastUsed(s.lastActive)].filter(Boolean).join(' · ')}
            </div>
          </div>
          {!s.current &&
            (ending === s.id ? (
              <>
                <button type="button" className="button danger" onClick={() => end(s.id)}>
                  Sign it out
                </button>
                <button type="button" className="button subtle" onClick={() => setEnding(null)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className="button subtle" onClick={() => setEnding(s.id)}>
                Sign out
              </button>
            ))}
        </div>
      ))}
    </div>
  )
}
