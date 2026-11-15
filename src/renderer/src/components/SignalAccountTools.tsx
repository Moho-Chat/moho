import { useEffect, useState } from 'react'
import { useStore } from '../state/hooks'
import { resolveMediaUrl } from '../lib/util'
import { ChoiceSetting } from './settings/controls'
import type { Account } from '../../../shared/wire'

/** One of the account's devices, as the phone's list of linked devices shows it. */
interface Device {
  id: number
  name: string
  createdAt: number
  lastSeen: number
  isThis: boolean
}

function when(seconds: number): string {
  return seconds > 0 ? new Date(seconds * 1000).toLocaleDateString() : 'never'
}

/**
 * The devices linked to a Signal account, under its card in the Accounts pane, and the name this one has among them.
 * Signal lets only the phone remove another device, so the others are listed and not offered for removal; this one is
 * removed by removing the account here.
 */
export function SignalAccountTools({ account }: { account: Account }): JSX.Element | null {
  const store = useStore()
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  /** The account's own profile: what others see it called, and its about line. */
  const [profile, setProfile] = useState<{ given: string; family: string; about: string; emoji: string; username?: string | null; avatar?: string | null } | null>(null)
  const [edited, setEdited] = useState<{ given: string; family: string; about: string; emoji: string } | null>(null)

  const load = (): void => {
    void window.moho
      .rpc<Device[]>('signalDevices', { accountId: account.id })
      .then((list) => {
        setDevices(list)
        setName(list.find((d) => d.isThis)?.name ?? '')
      })
      // An account still connecting has no answer yet; nothing is shown in its place.
      .catch(() => setDevices(null))
  }
  // Asked again once the account is up, since the first open can be before it is.
  useEffect(load, [account.id, account.state])
  const loadProfile = (): void => {
    void window.moho
      .rpc<{ given: string; family: string; about: string; emoji: string; username?: string | null; avatar?: string | null }>('signalOwnProfile', { accountId: account.id })
      .then((p) => {
        setProfile(p)
        setEdited({ given: p.given, family: p.family, about: p.about, emoji: p.emoji })
      })
      .catch(() => setProfile(null))
  }
  useEffect(loadProfile, [account.id, account.state])

  /** A new picture (a file), or none (''): sent with the profile as it is now. */
  const setPicture = (picturePath: string): void => {
    if (!profile) return
    setBusy(true)
    void window.moho
      .rpc('signalSetProfile', { accountId: account.id, given: profile.given, family: profile.family, about: profile.about, emoji: profile.emoji, picturePath })
      .then(() => {
        store.toast('info', picturePath ? 'Your picture was changed. Your phone picks it up too' : 'Your picture was taken away')
        loadProfile()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const saveProfile = (): void => {
    if (!edited) return
    setBusy(true)
    void window.moho
      .rpc('signalSetProfile', { accountId: account.id, ...edited })
      .then(() => {
        setProfile(profile ? { ...profile, ...edited } : null)
        store.toast('info', 'Your profile was changed. Your phone picks it up too')
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }
  /** The phone's privacy settings and the people it blocks: shown here, changed on the phone (unblocking aside). */
  const [settings, setSettings] = useState<{
    readReceipts: boolean | null
    typingIndicators: boolean | null
    linkPreviews: boolean | null
    sealedSenderIndicators: boolean | null
    defaultTimer: number | null
    phoneNumberSharing: number | null
    findableByNumber: boolean | null
    storiesDisabled: boolean | null
    storyViewReceipts: boolean | null
    keepMutedChatsArchived: boolean | null
    blocked: { id: string; name: string }[]
  } | null>(null)
  /** An account setting every device keeps, changed, then read back. */
  const setShared = (params: Record<string, unknown>, done: string): void => {
    setBusy(true)
    void window.moho
      .rpc('signalSharedChange', { accountId: account.id, ...params })
      .then(() => {
        store.toast('info', done)
        loadSettings()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }
  const loadSettings = (): void => {
    void window.moho
      .rpc<NonNullable<typeof settings>>('signalSettings', { accountId: account.id })
      .then(setSettings)
      .catch(() => setSettings(null))
  }
  useEffect(loadSettings, [account.id, account.state])

  /** Sealing this device into a file, for putting it back after a reinstall. */
  const [exporting, setExporting] = useState<{ passphrase: string; again: string } | null>(null)
  const exportAccount = (): void => {
    if (!exporting) return
    void window.moho.pickSavePath('signal-account.mohosignal').then((path) => {
      if (!path) return
      setBusy(true)
      void window.moho
        .rpc('exportSignalAccount', { accountId: account.id, path, passphrase: exporting.passphrase })
        .then(() => {
          setExporting(null)
          store.toast('info', `Saved to ${path}. Keep it and its passphrase safe: it is this device's keys`)
        })
        .catch((e: Error) => store.toast('error', e.message))
        .finally(() => setBusy(false))
    })
  }

  const profileChanged =
    !!profile && !!edited && (edited.given !== profile.given || edited.family !== profile.family || edited.about !== profile.about || edited.emoji !== profile.emoji)

  if (!devices) return null
  const mine = devices.find((d) => d.isThis)
  const rename = (): void => {
    setBusy(true)
    void window.moho
      .rpc('renameSignalDevice', { accountId: account.id, name })
      .then(() => {
        store.toast('info', 'Device renamed')
        load()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="account-tools">
      <div className="setting-row">
        <div className="setting-text">
          <div>Export this device</div>
          <div className="small muted">
            A file sealed with a passphrase, holding this linked device&apos;s keys and conversations, to bring it back after
            moho is put on again (Add account, Signal). Only bring it back where this copy is gone: two copies of one device
            break each other. Messages that come after the export are not in it.
          </div>
        </div>
        {!exporting && (
          <button type="button" className="button" disabled={busy} onClick={() => setExporting({ passphrase: '', again: '' })}>
            Export…
          </button>
        )}
      </div>
      {exporting && (
        <div className="field-row">
          <input
            className="text-field"
            type="password"
            placeholder="Passphrase (8 or more characters)"
            value={exporting.passphrase}
            autoFocus
            disabled={busy}
            onChange={(e) => setExporting({ ...exporting, passphrase: e.target.value })}
          />
          <input
            className="text-field"
            type="password"
            placeholder="Again"
            value={exporting.again}
            disabled={busy}
            onChange={(e) => setExporting({ ...exporting, again: e.target.value })}
          />
          <button
            type="button"
            className="button"
            disabled={busy || exporting.passphrase.length < 8 || exporting.passphrase !== exporting.again}
            onClick={exportAccount}
          >
            Save…
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => setExporting(null)}>
            Cancel
          </button>
        </div>
      )}
      {profile && edited && (
        <>
          <div className="setting-row">
            <div className="setting-text">
              <div>Your profile</div>
              <div className="small muted">
                What people you message see.{profile.username ? ` Your username is ${profile.username}.` : ''} A username is
                chosen or changed on the phone.
              </div>
            </div>
          </div>
          <div className="field-row">
            <input className="text-field" placeholder="First name" value={edited.given} disabled={busy} onChange={(e) => setEdited({ ...edited, given: e.target.value })} />
            <input className="text-field" placeholder="Last name (optional)" value={edited.family} disabled={busy} onChange={(e) => setEdited({ ...edited, family: e.target.value })} />
          </div>
          <div className="field-row">
            <input className="text-field emoji-field" placeholder="🙂" value={edited.emoji} disabled={busy} onChange={(e) => setEdited({ ...edited, emoji: e.target.value })} />
            <input className="text-field" placeholder="About" value={edited.about} disabled={busy} onChange={(e) => setEdited({ ...edited, about: e.target.value })} />
            <button type="button" className="button" disabled={busy || !profileChanged || !edited.given.trim()} onClick={saveProfile}>
              Save
            </button>
          </div>
          <div className="field-row">
            {profile.avatar && <img className="avatar-preview" src={resolveMediaUrl(profile.avatar)} alt="" width={40} height={40} style={{ borderRadius: '50%' }} />}
            <button
              type="button"
              className="button"
              disabled={busy || !profile.given.trim()}
              onClick={() =>
                void window.moho.pickFile(['jpg', 'jpeg', 'png', 'webp']).then((path) => {
                  if (path) setPicture(path)
                })
              }
            >
              {profile.avatar ? 'Change picture…' : 'Choose a picture…'}
            </button>
            {profile.avatar && (
              <button type="button" className="button" disabled={busy || !profile.given.trim()} onClick={() => setPicture('')}>
                Remove picture
              </button>
            )}
          </div>
        </>
      )}
      {settings && (
        <>
          <div className="setting-row">
            <div className="setting-text">
              <div>Privacy, on all your devices</div>
              <div className="small muted">
                Kept by Signal for the whole account: a change here reaches the phone too.
                {settings.defaultTimer ? ` New chats disappear after ${settings.defaultTimer} seconds.` : ''}
              </div>
            </div>
          </div>
          {(
            [
              ['readReceipts', 'Read receipts', settings.readReceipts],
              ['typingIndicators', 'Typing indicators', settings.typingIndicators],
              ['linkPreviews', 'Link previews', settings.linkPreviews],
              ['sealedSenderIndicators', 'Sealed sender indicators', settings.sealedSenderIndicators]
            ] as const
          ).map(([key, label, on]) => (
            <label key={key} className="small poll-disclosed" title={on === null ? 'Not known yet' : undefined}>
              <input
                type="checkbox"
                checked={!!on}
                disabled={busy || on === null}
                onChange={(e) => {
                  setBusy(true)
                  void window.moho
                    .rpc('signalSharedChange', { accountId: account.id, setting: key, on: e.target.checked })
                    .then(() => {
                      store.toast('info', `${label} ${e.target.checked ? 'on' : 'off'}, on all your devices`)
                      loadSettings()
                    })
                    .catch((err: Error) => store.toast('error', err.message))
                    .finally(() => setBusy(false))
                }}
              />
              {label}
            </label>
          ))}
          {(
            [
              ['findableByNumber', 'People can find you by your number', settings.findableByNumber],
              ['storyViewReceipts', 'Tell people you viewed their stories', settings.storyViewReceipts],
              ['storiesDisabled', 'Turn stories off', settings.storiesDisabled],
              ['keepMutedChatsArchived', 'Keep muted chats archived', settings.keepMutedChatsArchived]
            ] as const
          ).map(([key, label, on]) => (
            <label key={key} className="small poll-disclosed" title={on === null ? 'Not known yet' : undefined}>
              <input type="checkbox" checked={!!on} disabled={busy || on === null} onChange={(e) => setShared({ setting: key, on: e.target.checked }, `${label}: ${e.target.checked ? 'on' : 'off'}`)} />
              {label}
            </label>
          ))}
          <ChoiceSetting
            label="Who can see your number"
            value={String(settings.phoneNumberSharing ?? 0)}
            options={[
              ...(settings.phoneNumberSharing ? [] : [{ value: '0', label: 'Not known yet' }]),
              { value: '1', label: 'Everybody' },
              { value: '2', label: 'Nobody' }
            ]}
            disabled={busy || settings.phoneNumberSharing === null}
            onChange={(v) => setShared({ setting: 'phoneNumberSharing', value: Number(v) }, v === '1' ? 'Everybody can see your number' : 'Nobody can see your number')}
          />
          <ChoiceSetting
            label="Disappearing messages for new chats"
            value={String(settings.defaultTimer ?? 0)}
            options={[
              { value: '0', label: 'Off' },
              { value: '3600', label: '1 hour' },
              { value: '28800', label: '8 hours' },
              { value: '86400', label: '1 day' },
              { value: '604800', label: '1 week' },
              { value: '2419200', label: '4 weeks' },
              ...([0, 3600, 28800, 86400, 604800, 2419200].includes(settings.defaultTimer ?? 0) ? [] : [{ value: String(settings.defaultTimer), label: `${settings.defaultTimer} seconds` }])
            ]}
            disabled={busy || settings.defaultTimer === null}
            onChange={(v) => setShared({ setting: 'defaultTimer', value: Number(v) }, 'The timer for new chats was changed')}
          />
          <StoryLists accountId={account.id} />
          {settings.blocked.length > 0 && (
            <>
              <div className="small muted">Blocked</div>
              <ul className="plain-list">
                {settings.blocked.map((b) => (
                  <li key={b.id} className="small field-row">
                    <span className="grow">{b.name}</span>
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void window.moho
                          .rpc('signalBlock', { accountId: account.id, id: b.id, blocked: false })
                          .then(() => {
                            store.toast('info', `${b.name} is unblocked`)
                            loadSettings()
                          })
                          .catch((e: Error) => store.toast('error', e.message))
                      }
                    >
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <div className="setting-row">
        <div className="setting-text">
          <div>Linked devices</div>
          <div className="small muted">Remove one from Signal on your phone: Settings, then Linked devices.</div>
        </div>
      </div>
      <ul className="plain-list">
        {devices.map((d) => (
          <li key={d.id} className="small">
            {d.name || (d.id === 1 ? 'Phone' : `Device ${d.id}`)}
            {d.isThis ? ' (this one)' : ''} <span className="muted">· last seen {when(d.lastSeen)}</span>
          </li>
        ))}
      </ul>
      {mine && (
        <div className="field-row">
          <label className="field">
            <span className="small muted">Name of this device in that list</span>
            <input className="text-field" type="text" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="button" className="button" disabled={busy || !name.trim() || name.trim() === mine.name} onClick={rename}>
            Rename
          </button>
        </div>
      )}
    </div>
  )
}

interface StoryListRow {
  id: string
  name: string
  myStory: boolean
  count: number
  replies: boolean
  excluding: boolean
  people: { userId: string; nick: string }[]
}

/**
 * The account's story lists, as the phone keeps them for every device: who each reaches, whether they can reply, and
 * people added or taken off. For My Story set to "all connections except", the people listed are the ones left out.
 */
function StoryLists({ accountId }: { accountId: string }): JSX.Element | null {
  const store = useStore()
  const [lists, setLists] = useState<StoryListRow[] | null>(null)
  const [connections, setConnections] = useState<{ userId: string; nick: string }[]>([])
  const [busy, setBusy] = useState(false)
  const load = (): void => {
    void window.moho.rpc<StoryListRow[]>('signalStoryLists', { accountId }).then(setLists).catch(() => setLists(null))
    void window.moho.rpc<{ userId: string; nick: string }[]>('signalConnections', { accountId }).then(setConnections).catch(() => {})
  }
  useEffect(load, [accountId])
  if (!lists || lists.length === 0) return null

  const change = (listId: string, params: Record<string, unknown>, done: string): void => {
    setBusy(true)
    void window.moho
      .rpc('signalSharedChange', { accountId, listId, ...params })
      .then(() => {
        store.toast('info', done)
        load()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <div className="setting-row">
        <div className="setting-text">
          <div>Story lists</div>
          <div className="small muted">Who your stories reach, kept for all your devices.</div>
        </div>
      </div>
      {lists.map((l) => {
        const listed = new Set(l.people.map((p) => p.userId))
        const addable = connections.filter((c) => !listed.has(c.userId))
        return (
          <div key={l.id} className="field">
            <span className="small">
              {l.name} · reaches {l.count === 1 ? '1 person' : `${l.count} people`}
              {l.myStory && (l.excluding ? ' (all your connections but those below)' : ' (only those below)')}
            </span>
            <label className="small poll-disclosed">
              <input type="checkbox" checked={l.replies} disabled={busy} onChange={(e) => change(l.id, { replies: e.target.checked }, e.target.checked ? 'Replies allowed' : 'Replies turned off')} />
              Let people reply
            </label>
            {l.people.map((p) => (
              <div key={p.userId} className="field-row small">
                <span className="grow">{p.nick}</span>
                <button type="button" className="button subtle small" disabled={busy} onClick={() => change(l.id, { person: p.userId, add: false }, `${p.nick} taken off ${l.name}`)}>
                  Take off
                </button>
              </div>
            ))}
            {addable.length > 0 && (
              <select
                className="text-field"
                value=""
                disabled={busy}
                onChange={(e) => {
                  const who = addable.find((c) => c.userId === e.target.value)
                  if (who) change(l.id, { person: who.userId, add: true }, `${who.nick} added to ${l.name}`)
                }}
              >
                <option value="">{l.myStory && l.excluding ? 'Leave somebody out…' : 'Add somebody…'}</option>
                {addable.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.nick}
                  </option>
                ))}
              </select>
            )}
          </div>
        )
      })}
    </>
  )
}
