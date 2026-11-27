import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { formatFullTime, resolveMediaUrl } from '../lib/util'
import type { Account } from '../../../shared/wire'

/** What the account looks like to everybody on the server. */
interface OwnProfile {
  username: string
  firstName: string
  lastName: string
  nickname: string
  position: string
  email?: string
  avatarUrl?: string | null
  customStatus?: { emoji: string; text: string } | null
  customStatuses?: boolean
}

interface Session {
  id: string
  what: string
  lastActive?: number
  created?: number
  this: boolean
  kind: string
}

/** How long a custom status lasts: until cleared, or for a while. */
const DURATIONS: { label: string; hours: number }[] = [
  { label: "Don't clear", hours: 0 },
  { label: '30 minutes', hours: 0.5 },
  { label: '1 hour', hours: 1 },
  { label: '4 hours', hours: 4 },
  { label: 'Today', hours: -1 },
  { label: 'This week', hours: 24 * 7 }
]

/**
 * A Mattermost account's own things, in its Accounts tab: its profile on the server (names, nickname, position,
 * picture), its custom status, how it reads threads, and the places it is signed in - each of which can be ended.
 * Only what was changed is sent.
 */
export function MattermostAccountTools({ account }: { account: Account }): JSX.Element | null {
  const store = useStore()
  const server = useChat((s) => s.mattermostServers[account.id])
  const [profile, setProfile] = useState<OwnProfile | null>(null)
  const [form, setForm] = useState({ firstName: '', lastName: '', nickname: '', position: '' })
  const [status, setStatus] = useState({ emoji: '', text: '', hours: 0 })
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [busy, setBusy] = useState(false)
  const call = <T,>(action: string, params: Record<string, unknown> = {}): Promise<T> => window.moho.rpc<T>('mattermost', { action, accountId: account.id, ...params })

  const load = (): void => {
    void call<OwnProfile>('ownProfile')
      .then((p) => {
        setProfile(p)
        setForm({ firstName: p.firstName ?? '', lastName: p.lastName ?? '', nickname: p.nickname ?? '', position: p.position ?? '' })
        setStatus({ emoji: p.customStatus?.emoji ?? '', text: p.customStatus?.text ?? '', hours: 0 })
      })
      .catch(() => setProfile(null))
    void call<{ sessions: Session[] }>('sessions')
      .then((a) => setSessions(a.sessions))
      .catch(() => setSessions(null))
  }
  useEffect(load, [account.id, account.state])

  if (!profile) return null
  const done = (words: string): void => {
    store.toast('info', words)
    load()
  }
  const failed = (e: Error): void => store.toast('error', e.message)
  const changed = (Object.keys(form) as (keyof typeof form)[]).filter((k) => form[k].trim() !== (profile[k] ?? '').trim())

  const save = (): void => {
    setBusy(true)
    const body: Record<string, string> = {}
    for (const k of changed) body[k] = form[k].trim()
    void call('setProfile', body)
      .then(() => done('Profile changed'))
      .catch(failed)
      .finally(() => setBusy(false))
  }
  const setStatusNow = (clear: boolean): void => {
    setBusy(true)
    let until: string | undefined
    if (!clear && status.hours !== 0) {
      const end = new Date()
      if (status.hours < 0) end.setHours(23, 59, 59, 0)
      else end.setTime(end.getTime() + status.hours * 3_600_000)
      until = end.toISOString()
    }
    void call('setCustomStatus', clear ? { text: '', emoji: '' } : { text: status.text.trim(), emoji: status.emoji.trim().replace(/^:|:$/g, ''), ...(until ? { until } : {}) })
      .then(() => done(clear ? 'Status cleared' : 'Status set'))
      .catch(failed)
      .finally(() => setBusy(false))
  }
  const field = (key: keyof typeof form, label: string, placeholder = ''): JSX.Element => (
    <label className="field">
      <span className="small muted">{label}</span>
      <input className="text-field" type="text" placeholder={placeholder} value={form[key]} disabled={busy} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  )

  return (
    <div className="account-tools">
      <div className="setting-row">
        <div className="setting-text">
          <div>
            Your profile on {server?.siteName || 'the server'} (@{profile.username})
          </div>
          <div className="small muted">
            Changing these changes them for everyone on the server.{server?.version ? ` Mattermost ${server.version}.` : ''}
          </div>
        </div>
      </div>
      <div className="device-row">
        {profile.avatarUrl ? <img className="account-avatar" src={resolveMediaUrl(profile.avatarUrl)} alt="" /> : <Icon name="account_circle" size={18} />}
        <div className="setting-text" />
        <button
          type="button"
          className="button subtle"
          disabled={busy}
          onClick={() =>
            void window.moho.pickFile(['png', 'jpg', 'jpeg', 'gif', 'webp']).then((path) => {
              if (!path) return
              setBusy(true)
              void call('setAvatar', { path })
                .then(() => done('Picture changed'))
                .catch(failed)
                .finally(() => setBusy(false))
            })
          }
        >
          Change picture
        </button>
      </div>
      <div className="field-row">
        {field('firstName', 'First name')}
        {field('lastName', 'Last name')}
      </div>
      <div className="field-row">
        {field('nickname', 'Nickname')}
        {field('position', 'Position', 'What you do')}
      </div>
      <div className="field-row">
        <button type="button" className="button primary" disabled={busy || changed.length === 0} onClick={save}>
          Save
        </button>
      </div>

      {profile.customStatuses !== false && (
        <>
          <div className="setting-row">
            <div className="setting-text">
              <div>Custom status</div>
              <div className="small muted">An emoji and a few words beside your name, for everyone on the server.</div>
            </div>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="small muted">Emoji name</span>
              <input className="text-field" placeholder="calendar" value={status.emoji} disabled={busy} onChange={(e) => setStatus({ ...status, emoji: e.target.value })} />
            </label>
            <label className="field">
              <span className="small muted">Words</span>
              <input className="text-field" placeholder="In a meeting" maxLength={100} value={status.text} disabled={busy} onChange={(e) => setStatus({ ...status, text: e.target.value })} />
            </label>
            <label className="field">
              <span className="small muted">Clear after</span>
              <select className="text-field" value={status.hours} disabled={busy} onChange={(e) => setStatus({ ...status, hours: Number(e.target.value) })}>
                {DURATIONS.map((d) => (
                  <option key={d.label} value={d.hours}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field-row">
            <button type="button" className="button primary" disabled={busy || (!status.text.trim() && !status.emoji.trim())} onClick={() => setStatusNow(false)}>
              Set status
            </button>
            {profile.customStatus && (
              <button type="button" className="button" disabled={busy} onClick={() => setStatusNow(true)}>
                Clear it
              </button>
            )}
          </div>
        </>
      )}

      {server && server.collapsedThreads !== 'disabled' && server.collapsedThreads !== 'always_on' && (
        <div className="setting-row">
          <div className="setting-text">
            <div>Collapsed reply threads</div>
            <div className="small muted">Replies stay in their thread, opened beside the channel, rather than in the channel. Kept on the account, for its other apps too.</div>
          </div>
          <input
            type="checkbox"
            checked={!!server.collapsedOn}
            disabled={busy}
            onChange={(e) =>
              void call('setCollapsedThreads', { on: e.target.checked })
                .then(() => store.toast('info', e.target.checked ? 'Threads collapsed' : 'Replies shown in the channel'))
                .catch(failed)
            }
          />
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <>
          <div className="setting-row">
            <div className="setting-text">
              <div>Where you are signed in</div>
              <div className="small muted">Ending a session signs that app out. Ending moho&apos;s own signs this account out here.</div>
            </div>
          </div>
          {sessions.map((s) => (
            <div key={s.id} className="device-row">
              <Icon name={s.this ? 'computer' : 'devices'} size={18} />
              <div className="setting-text">
                <div>
                  {s.what} <span className="small muted">· {s.kind}</span>
                </div>
                <div className="small muted">
                  {s.lastActive ? `Last active ${formatFullTime(s.lastActive)}` : ''}
                  {s.created ? ` · signed in ${formatFullTime(s.created)}` : ''}
                </div>
              </div>
              {!s.this && (
                <button
                  type="button"
                  className="button subtle"
                  disabled={busy}
                  onClick={() =>
                    void call('revokeSession', { sessionId: s.id })
                      .then(() => done('Session ended'))
                      .catch(failed)
                  }
                >
                  End
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
