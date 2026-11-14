import { useEffect, useState } from 'react'
import { useStore } from '../state/hooks'
import { resolveMediaUrl } from '../lib/util'
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
    blocked: { id: string; name: string }[]
  } | null>(null)
  const loadSettings = (): void => {
    void window.moho
      .rpc<NonNullable<typeof settings>>('signalSettings', { accountId: account.id })
      .then(setSettings)
      .catch(() => setSettings(null))
  }
  useEffect(loadSettings, [account.id, account.state])
  const word = (on: boolean | null): string => (on === null ? 'not known yet' : on ? 'on' : 'off')

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
              <div>Privacy, as set on your phone</div>
              <div className="small muted">
                Read receipts {word(settings.readReceipts)} · typing indicators {word(settings.typingIndicators)} · link
                previews {word(settings.linkPreviews)} · sealed sender indicators {word(settings.sealedSenderIndicators)}
                {settings.defaultTimer ? ` · new chats disappear after ${settings.defaultTimer} seconds` : ''}. moho follows
                them; change them in Signal on the phone.
              </div>
            </div>
          </div>
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
