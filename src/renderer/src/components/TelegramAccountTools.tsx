import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { Asking, SideTabs, ToolPane } from './AccountList'
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

type Section = 'profile' | 'sessions'

/** When a session was last used, in words. */
function lastUsed(ts: number): string {
  const ago = Date.now() / 1000 - ts
  if (ago < 120) return 'active now'
  if (ago < 3600) return `${Math.round(ago / 60)} minutes ago`
  if (ago < 86400) return `${Math.round(ago / 3600)} hours ago`
  return new Date(ts * 1000).toLocaleDateString()
}

/**
 * The account's own profile on Telegram, and the sessions signed in to it, in the account's service tab. Separate
 * from the local name moho calls the account by: this is what everybody on Telegram sees. Only what was changed is
 * sent.
 */
export function TelegramAccountTools({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [section, setSection] = useState<Section>('profile')
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
      // An account still connecting has no answer yet.
      .catch(() => setProfile(null))
    void ask<Session[]>('telegramSessions', { accountId: account.id })
      .then(setSessions)
      .catch(() => setSessions(null))
  }
  // Asked again once the account is up, since the first open can be before it is.
  useEffect(load, [account.id, account.state])

  const fail = (e: Error): void => store.toast('error', e.message)
  const nameChanged = profile ? (['firstName', 'lastName', 'bio'] as const).filter((k) => form[k].trim() !== profile[k].trim()) : []
  const usernameChanged = !!profile && form.username.trim().replace(/^@/, '') !== profile.username
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
  const field = (key: keyof typeof form, label: string, placeholder = '', max?: number): JSX.Element => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="text-field" type="text" placeholder={placeholder} maxLength={max} value={form[key]} disabled={busy} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  )

  return (
    <SideTabs
      label="Telegram"
      value={section}
      onChange={setSection}
      groups={[
        {
          label: 'You',
          items: [
            { id: 'profile', label: 'Profile', icon: 'badge' },
            { id: 'sessions', label: 'Sessions', icon: 'devices' }
          ]
        }
      ]}
    >
      {section === 'profile' && (
        <ToolPane title="Profile" desc={`What everybody on Telegram sees${profile?.phone ? ` of ${profile.phone}` : ''}. A change here reaches your phone too.`}>
          {profile ? (
            <>
              <div className="card">
                <div className="setting-row">
                  {profile.avatarUrl ? (
                    <img className="tool-avatar" src={resolveMediaUrl(profile.avatarUrl)} alt="" />
                  ) : (
                    <span className="tool-avatar placeholder">
                      <Icon name="person" size={24} />
                    </span>
                  )}
                  <div className="setting-text">
                    <div>{profile.avatarUrl ? 'Your picture' : 'No picture yet'}</div>
                    <div className="small muted">A JPEG, PNG or WebP.</div>
                  </div>
                  <button
                    type="button"
                    className="button quiet"
                    disabled={busy}
                    onClick={() => void window.moho.pickFile(['jpg', 'jpeg', 'png', 'webp']).then((path) => path && picture(path))}
                  >
                    {profile.avatarUrl ? 'Change picture…' : 'Choose a picture…'}
                  </button>
                  {profile.avatarUrl && (
                    <button type="button" className="button quiet" disabled={busy} onClick={() => picture('')}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="card card-fields">
                <div className="tool-grid">
                  {field('firstName', 'First name', 'First name', 64)}
                  {field('lastName', 'Last name', 'Last name (optional)', 64)}
                </div>
                {field('username', 'Username', 'Lets people find you without your number', 32)}
                {field('bio', 'Bio', 'A few words about yourself', 70)}
                <div className="tool-actions">
                  <button type="button" className="button primary" disabled={busy || (nameChanged.length === 0 && !usernameChanged) || !form.firstName.trim()} onClick={() => void save()}>
                    Save
                  </button>
                </div>
              </div>
            </>
          ) : (
            <Asking what="Telegram" />
          )}
        </ToolPane>
      )}

      {section === 'sessions' && (
        <ToolPane title="Sessions" desc="Everywhere this account is signed in, as Telegram's own Devices list shows it. Signing one out ends it there.">
          {sessions ? (
            <div className="card tool-list">
              {sessions.map((s) => (
                <div key={s.id} className="setting-row">
                  <Icon name={s.current ? 'verified_user' : 'devices'} size={18} color={s.current ? 'var(--success)' : undefined} />
                  <div className="setting-text">
                    <div className="ellipsis">
                      {s.app || 'Unknown app'}
                      {s.current ? ' (this one)' : ''}
                      {s.unconfirmed ? ' · not yet confirmed' : ''}
                    </div>
                    <div className="small muted ellipsis">{[s.device, s.place, s.ip, s.current ? '' : lastUsed(s.lastActive)].filter(Boolean).join(' · ')}</div>
                  </div>
                  {!s.current &&
                    (ending === s.id ? (
                      <>
                        <button type="button" className="button danger" onClick={() => end(s.id)}>
                          Sign it out
                        </button>
                        <button type="button" className="button quiet" onClick={() => setEnding(null)}>
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button type="button" className="button quiet" onClick={() => setEnding(s.id)}>
                        Sign out
                      </button>
                    ))}
                </div>
              ))}
            </div>
          ) : (
            <Asking what="Telegram" />
          )}
        </ToolPane>
      )}
    </SideTabs>
  )
}
