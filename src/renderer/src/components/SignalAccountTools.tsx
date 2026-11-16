import { useEffect, useState } from 'react'
import { useChat, useStore } from '../state/hooks'
import { resolveMediaUrl } from '../lib/util'
import { ChoiceSetting } from './settings/controls'
import { Icon } from './Icon'
import { SwitchRow } from './Switch'
import { Asking, SideTabs, ToolPane } from './AccountList'
import type { Account, SignalCallLink } from '../../../shared/wire'

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
export function SignalAccountTools({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [section, setSection] = useState<'profile' | 'privacy' | 'blocked' | 'stories' | 'stickers' | 'links' | 'profiles' | 'devices' | 'export'>('profile')
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

  // An account still connecting has no answer yet: said, rather than a tab with nothing in it.
  if (!devices) {
    return (
      <div className="card">
        <div className="setting-row">
          <div className="setting-text">
            <div>Nothing to show until this account is connected</div>
            <div className="small muted">Its profile, privacy and linked devices are read from Signal.</div>
          </div>
        </div>
      </div>
    )
  }
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

  const toggle = (key: string, label: string, on: boolean | null, help?: string): JSX.Element => (
    <SwitchRow
      key={key}
      title={label}
      description={on === null ? 'Not known yet' : help}
      checked={!!on}
      disabled={busy || on === null}
      onChange={(next) => setShared({ setting: key, on: next }, `${label}: ${next ? 'on' : 'off'}, on all your devices`)}
    />
  )

  // A section each, down the side (#339): what was one column of everything Signal keeps for an account.
  return (
    <SideTabs
      label="Signal"
      value={section}
      onChange={setSection}
      groups={[
        {
          label: 'You',
          items: [
            { id: 'profile', label: 'Profile', icon: 'badge' },
            { id: 'privacy', label: 'Privacy', icon: 'shield' },
            { id: 'blocked', label: 'Blocked', icon: 'block' }
          ]
        },
        {
          label: 'Yours',
          items: [
            { id: 'stories', label: 'Stories', icon: 'auto_stories' },
            { id: 'stickers', label: 'Sticker packs', icon: 'mood' },
            { id: 'links', label: 'Call links', icon: 'link' },
            { id: 'profiles', label: 'Notification profiles', icon: 'notifications' }
          ]
        },
        { label: 'This device', items: [{ id: 'devices', label: 'Linked devices', icon: 'devices' }, { id: 'export', label: 'Export', icon: 'save' }] }
      ]}
    >
      {section === 'profile' && (
        <ToolPane title="Profile" desc="What people you message see. Your phone picks a change up too.">
          {profile && edited ? (
            <>
              <div className="card">
                <div className="setting-row">
                  {profile.avatar ? <img className="tool-avatar" src={resolveMediaUrl(profile.avatar)} alt="" /> : <span className="tool-avatar placeholder"><Icon name="person" size={24} /></span>}
                  <div className="setting-text">
                    <div>{profile.avatar ? 'Your picture' : 'No picture yet'}</div>
                    <div className="small muted">A JPEG, PNG or WebP.</div>
                  </div>
                  <button
                    type="button"
                    className="button quiet"
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
                    <button type="button" className="button quiet" disabled={busy || !profile.given.trim()} onClick={() => setPicture('')}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="card card-fields">
                <div className="tool-grid">
                  <label className="field">
                    <span className="field-label">First name</span>
                    <input className="text-field" placeholder="First name" value={edited.given} disabled={busy} onChange={(e) => setEdited({ ...edited, given: e.target.value })} />
                  </label>
                  <label className="field">
                    <span className="field-label">Last name</span>
                    <input className="text-field" placeholder="Last name (optional)" value={edited.family} disabled={busy} onChange={(e) => setEdited({ ...edited, family: e.target.value })} />
                  </label>
                </div>
                <label className="field">
                  <span className="field-label">About</span>
                  <div className="action-field">
                    <input className="text-field emoji-field" placeholder="🙂" value={edited.emoji} disabled={busy} onChange={(e) => setEdited({ ...edited, emoji: e.target.value })} />
                    <input className="text-field" placeholder="About" value={edited.about} disabled={busy} onChange={(e) => setEdited({ ...edited, about: e.target.value })} />
                  </div>
                </label>
                <div className="tool-actions">
                  <button type="button" className="button primary" disabled={busy || !profileChanged || !edited.given.trim()} onClick={saveProfile}>
                    Save
                  </button>
                </div>
              </div>
              <div className="card tool-own">
                <UsernameRow accountId={account.id} username={profile.username ?? null} onChanged={loadProfile} />
              </div>
            </>
          ) : (
            <Asking what="Signal" />
          )}
        </ToolPane>
      )}

      {section === 'privacy' && (
        <ToolPane title="Privacy" desc="Kept by Signal for the whole account: a change here reaches the phone too.">
          {settings ? (
            <>
              <div className="card">
                {toggle('readReceipts', 'Read receipts', settings.readReceipts)}
                {toggle('typingIndicators', 'Typing indicators', settings.typingIndicators)}
                {toggle('linkPreviews', 'Link previews', settings.linkPreviews)}
                {toggle('sealedSenderIndicators', 'Sealed sender indicators', settings.sealedSenderIndicators)}
              </div>
              <div className="card">
                {toggle('findableByNumber', 'People can find you by your number', settings.findableByNumber)}
                {toggle('storyViewReceipts', 'Tell people you viewed their stories', settings.storyViewReceipts)}
                {toggle('storiesDisabled', 'Turn stories off', settings.storiesDisabled)}
                {toggle('keepMutedChatsArchived', 'Keep muted chats archived', settings.keepMutedChatsArchived)}
              </div>
              <div className="card tool-own">
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
              </div>
            </>
          ) : (
            <Asking what="Signal" />
          )}
        </ToolPane>
      )}

      {section === 'blocked' && (
        <ToolPane title="Blocked" desc="People this account has blocked, on every device. Blocking somebody is done from their conversation.">
          <div className="card tool-list">
            {(settings?.blocked ?? []).map((b) => (
              <div key={b.id} className="setting-row">
                <Icon name="block" size={18} color="var(--warning)" />
                <div className="setting-text ellipsis">{b.name}</div>
                <button
                  type="button"
                  className="button quiet small"
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
              </div>
            ))}
            {!settings?.blocked.length && <p className="small muted tool-none">Nobody is blocked</p>}
          </div>
        </ToolPane>
      )}

      {section === 'stories' && (
        <ToolPane title="Stories" desc="Who your stories reach, kept for all your devices.">
          <div className="card tool-own">
            <StoryLists accountId={account.id} />
          </div>
        </ToolPane>
      )}
      {section === 'stickers' && (
        <ToolPane title="Sticker packs" desc="Added or taken off here, they are on your phone too.">
          <div className="card tool-own">
            <StickerPacks accountId={account.id} />
          </div>
        </ToolPane>
      )}
      {section === 'links' && (
        <ToolPane title="Call links" desc="Links anybody can join a call by, made and taken down here.">
          <div className="card tool-own">
            <CallLinks accountId={account.id} />
          </div>
        </ToolPane>
      )}
      {section === 'profiles' && (
        <ToolPane title="Notification profiles" desc="The profiles your phone made, which decide who may notify you and when.">
          <div className="card tool-own">
            <NotificationProfiles accountId={account.id} />
          </div>
        </ToolPane>
      )}

      {section === 'devices' && (
        <ToolPane title="Linked devices" desc="Everything signed in to this Signal account. Remove one from Signal on your phone: Settings, then Linked devices.">
          <div className="card tool-list">
            {devices.map((d) => (
              <div key={d.id} className="setting-row">
                <Icon name={d.id === 1 ? 'smartphone' : 'computer'} size={18} />
                <div className="setting-text">
                  <div>
                    {d.name || (d.id === 1 ? 'Phone' : `Device ${d.id}`)}
                    {d.isThis ? ' (this one)' : ''}
                  </div>
                  <div className="small muted">last seen {when(d.lastSeen)}</div>
                </div>
              </div>
            ))}
          </div>
          {mine && (
            <div className="card card-fields">
              <label className="field">
                <span className="field-label">Name of this device in that list</span>
                <div className="action-field">
                  <input className="text-field" type="text" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
                  <button type="button" className="button primary" disabled={busy || !name.trim() || name.trim() === mine.name} onClick={rename}>
                    Rename
                  </button>
                </div>
              </label>
            </div>
          )}
        </ToolPane>
      )}

      {section === 'export' && (
        <ToolPane
          title="Export this device"
          desc="A file sealed with a passphrase, holding this linked device's keys and conversations, to bring it back after moho is put on again (Add account, Signal)."
        >
          <div className="card card-fields">
            <p className="warning-note">
              <Icon name="warning" size={16} /> Only bring it back where this copy is gone: two copies of one device break each other. Messages that come after the export are not in it.
            </p>
            {exporting ? (
              <>
                <div className="tool-grid">
                  <label className="field">
                    <span className="field-label">Passphrase</span>
                    <input
                      className="text-field"
                      type="password"
                      placeholder="8 or more characters"
                      value={exporting.passphrase}
                      autoFocus
                      disabled={busy}
                      onChange={(e) => setExporting({ ...exporting, passphrase: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Again</span>
                    <input className="text-field" type="password" placeholder="Again" value={exporting.again} disabled={busy} onChange={(e) => setExporting({ ...exporting, again: e.target.value })} />
                  </label>
                </div>
                <div className="tool-actions">
                  <button type="button" className="button primary" disabled={busy || exporting.passphrase.length < 8 || exporting.passphrase !== exporting.again} onClick={exportAccount}>
                    Save…
                  </button>
                  <button type="button" className="button quiet" disabled={busy} onClick={() => setExporting(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="tool-actions">
                <button type="button" className="button quiet" disabled={busy} onClick={() => setExporting({ passphrase: '', again: '' })}>
                  Export…
                </button>
              </div>
            )}
          </div>
        </ToolPane>
      )}
    </SideTabs>
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
  const [newName, setNewName] = useState('')
  /** Names being typed for lists, by id. */
  const [renaming, setRenaming] = useState<Record<string, string>>({})
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
      <div className="field-row">
        <input className="text-field" placeholder="A new story list's name" value={newName} disabled={busy} onChange={(e) => setNewName(e.target.value)} />
        <button
          type="button"
          className="button subtle small"
          disabled={busy || !newName.trim()}
          onClick={() => {
            const name = newName.trim()
            setBusy(true)
            void window.moho
              .rpc('signalCreateStoryList', { accountId, name, people: [] })
              .then(() => {
                store.toast('info', `${name} was made: add people to it below`)
                setNewName('')
                load()
              })
              .catch((e: Error) => store.toast('error', e.message))
              .finally(() => setBusy(false))
          }}
        >
          Make
        </button>
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
            {l.myStory ? (
              <select
                className="text-field"
                value={l.excluding ? 'except' : 'only'}
                disabled={busy}
                onChange={(e) => change(l.id, { excluding: e.target.value === 'except' }, e.target.value === 'except' ? 'My Story goes to all your connections' : 'My Story goes only to the people you choose')}
              >
                <option value="except">All your connections, except…</option>
                <option value="only">Only the people chosen</option>
              </select>
            ) : (
              <div className="field-row">
                <input
                  className="text-field"
                  value={renaming[l.id] ?? l.name}
                  disabled={busy}
                  onChange={(e) => setRenaming({ ...renaming, [l.id]: e.target.value })}
                />
                <button
                  type="button"
                  className="button subtle small"
                  disabled={busy || !(renaming[l.id] ?? '').trim() || renaming[l.id]?.trim() === l.name}
                  onClick={() => change(l.id, { rename: (renaming[l.id] ?? '').trim() }, `Renamed to ${(renaming[l.id] ?? '').trim()}`)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="button subtle small danger"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete the story list ${l.name}? Stories already posted to it stay up for their day.`)) change(l.id, { delete: true }, `${l.name} was deleted`)
                  }}
                >
                  Delete
                </button>
              </div>
            )}
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

/**
 * The account's call links (the phone lists the same ones): making one, joining one by its address, and for those
 * this account made, renaming, choosing whether people ask to join, and taking it down.
 */
function CallLinks({ accountId }: { accountId: string }): JSX.Element | null {
  const store = useStore()
  const available = useChat((s) => s.signalCallsAvailable)
  const [links, setLinks] = useState<SignalCallLink[]>([])
  const [missing, setMissing] = useState(0)
  const [name, setName] = useState('')
  const [approval, setApproval] = useState(false)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const load = (): void => {
    void window.moho
      .rpc<{ rootKey: string; admin: boolean }[]>('signalCallLinks', { accountId })
      .then(async (kept) => {
        const read = await Promise.all(kept.map((k) => window.moho.signalCall<SignalCallLink>('readCallLink', { accountId, link: k.rootKey }).catch(() => null)))
        setLinks(read.filter((l): l is SignalCallLink => !!l && !l.revoked))
        setMissing(read.filter((l) => !l).length)
      })
      .catch(() => setLinks([]))
  }
  useEffect(() => {
    if (available) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, available])
  if (!available) return null
  const act = (work: () => Promise<unknown>, done?: string): void => {
    setBusy(true)
    void work()
      .then(() => {
        if (done) store.toast('info', done)
        load()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }
  const call = <T,>(action: string, params: Record<string, unknown>): Promise<T> => window.moho.signalCall<T>(action, { accountId, ...params })
  return (
    <>
      <div className="setting-row">
        <div className="setting-text">
          <div>Call links</div>
          <div className="small muted">
            A call anyone with the address can join, with no group. Links made here are on your phone too.
            {missing > 0 && ` ${missing} could not be read just now.`}
          </div>
        </div>
      </div>
      {links.map((l) => (
        <div key={l.rootKey} className="field-row small">
          <span className="grow ellipsis" title={l.link}>
            {l.name || 'Untitled call'}
            {l.approval && ' · asks to join'}
          </span>
          <button type="button" className="button subtle small" disabled={busy} onClick={() => void store.joinSignalCallLink(accountId, l.link, false)}>
            Join
          </button>
          <button
            type="button"
            className="button subtle small"
            title={l.link}
            onClick={() => {
              void navigator.clipboard.writeText(l.link).then(() => store.toast('info', 'The call link was copied'))
            }}
          >
            Copy link
          </button>
          {l.admin && (
            <>
              <button
                type="button"
                className="button subtle small"
                disabled={busy}
                title={l.approval ? 'Let anyone with the link straight in' : 'Have people ask, and let them in yourself'}
                onClick={() => act(() => call('updateCallLink', { link: l.link, approval: !l.approval }))}
              >
                {l.approval ? 'Let anyone in' : 'Ask to join'}
              </button>
              <RenameLink link={l} busy={busy} onRename={(newName) => act(() => call('updateCallLink', { link: l.link, name: newName }), 'The call link was renamed')} />
            </>
          )}
          <button
            type="button"
            className="button subtle small"
            disabled={busy}
            onClick={() => {
              if (l.admin && !window.confirm(`Take down ${l.name || 'this call link'}? Its address stops working for everybody.`)) return
              act(() => call('deleteCallLink', { link: l.link }), l.admin ? 'The call link was taken down' : 'The call link was taken off your list')
            }}
          >
            {l.admin ? 'Take down' : 'Remove'}
          </button>
        </div>
      ))}
      <div className="field-row">
        <input className="text-field" placeholder="Name for a new call link" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        <label className="small">
          <input type="checkbox" checked={approval} disabled={busy} onChange={(e) => setApproval(e.target.checked)} /> Ask to join
        </label>
        <button
          type="button"
          className="button subtle small"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const made = await call<SignalCallLink>('createCallLink', { name, approval })
              setName('')
              await navigator.clipboard.writeText(made.link).catch(() => {})
              store.toast('info', 'The call link was made, and its address copied')
            })
          }
        >
          New call link
        </button>
      </div>
      <div className="field-row">
        <input className="text-field" placeholder="https://signal.link/call/#key=…" value={address} disabled={busy} onChange={(e) => setAddress(e.target.value)} />
        <button
          type="button"
          className="button subtle small"
          disabled={busy || !address.trim()}
          onClick={() => {
            const link = address.trim()
            setAddress('')
            void store.openSignalCallLink(accountId, link)
          }}
        >
          Join
        </button>
      </div>
    </>
  )
}

/** A rename field that opens beside the button that asked for it. */
function RenameLink({ link, busy, onRename }: { link: SignalCallLink; busy: boolean; onRename: (name: string) => void }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(link.name)
  if (!editing)
    return (
      <button type="button" className="button subtle small" disabled={busy} onClick={() => setEditing(true)}>
        Rename
      </button>
    )
  const save = (): void => {
    setEditing(false)
    if (text.trim() !== link.name) onRename(text.trim())
  }
  return (
    <input
      className="text-field"
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}

/** The sticker packs the account has (on every device), with adding one from a signal.art link and taking one off. */
function StickerPacks({ accountId }: { accountId: string }): JSX.Element {
  const store = useStore()
  const [packs, setPacks] = useState<{ packId: string; title: string; count: number }[]>([])
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const load = (): void => {
    void window.moho.rpc<typeof packs>('signalStickerPacks', { accountId }).then(setPacks).catch(() => setPacks([]))
  }
  useEffect(load, [accountId])
  const act = (method: string, params: Record<string, unknown>, done: string, after?: () => void): void => {
    setBusy(true)
    void window.moho
      .rpc(method, { accountId, ...params })
      .then(() => {
        store.toast('info', done)
        after?.()
        load()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <div className="setting-row">
        <div className="setting-text">
          <div>Sticker packs</div>
          <div className="small muted">Added or taken off here, they are on your phone too.</div>
        </div>
      </div>
      {packs.map((p) => (
        <div key={p.packId} className="field-row small">
          <span className="grow">
            {p.title || 'Untitled pack'} · {p.count} stickers
          </span>
          <button type="button" className="button subtle small" disabled={busy} onClick={() => act('signalRemoveStickerPack', { packId: p.packId }, `${p.title || 'The pack'} was taken off`)}>
            Remove
          </button>
        </div>
      ))}
      <div className="field-row">
        <input className="text-field" placeholder="https://signal.art/addstickers/#pack_id=…" value={link} disabled={busy} onChange={(e) => setLink(e.target.value)} />
        <button type="button" className="button subtle small" disabled={busy || !link.trim()} onClick={() => act('signalStickerPackLink', { link: link.trim() }, 'The sticker pack was added', () => setLink(''))}>
          Add
        </button>
      </div>
    </>
  )
}

/** The phone's notification profiles: while one is on, moho announces only what it allows, as the phone does. */
function NotificationProfiles({ accountId }: { accountId: string }): JSX.Element | null {
  const on = useChat((s) => s.signalProfiles[accountId] ?? null)
  const [profiles, setProfiles] = useState<{ id: string; name: string; emoji?: string | null; scheduled: boolean; start: number; end: number; days: number[]; allowMentions: boolean; allowed: number }[]>([])
  useEffect(() => {
    void window.moho
      .rpc<{ profiles: typeof profiles }>('signalProfiles', { accountId })
      .then((r) => setProfiles(r.profiles))
      .catch(() => setProfiles([]))
  }, [accountId, on?.id])
  if (profiles.length === 0) return null
  const clock = (hhmm: number): string => `${Math.floor(hhmm / 100)}:${String(hhmm % 100).padStart(2, '0')}`
  const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return (
    <>
      <div className="setting-row">
        <div className="setting-text">
          <div>Notification profiles</div>
          <div className="small muted">
            {on ? `${on.emoji ?? ''} ${on.name} is on: moho notifies only for what it allows.` : 'None is on. They are made and switched on the phone; moho follows them.'}
          </div>
        </div>
      </div>
      {profiles.map((p) => (
        <div key={p.id} className="small field-row">
          <span className="grow">
            {p.emoji ? `${p.emoji} ` : ''}
            {p.name}
            {p.id === on?.id && ' · on'}
          </span>
          <span className="muted">
            {p.scheduled ? `${p.days.map((d) => dayNames[d] ?? '').join(' ')} ${clock(p.start)}–${clock(p.end)}` : 'by hand'} · {p.allowed} allowed{p.allowMentions ? ' · mentions' : ''}
          </span>
        </div>
      ))}
    </>
  )
}

/**
 * The account's username: chosen here (a name, and a number or one Signal picks), removed, and its link and QR code
 * shown or made anew - as on the phone, which hears of it through the shared settings.
 */
function UsernameRow({ accountId, username, onChanged }: { accountId: string; username: string | null; onChanged: () => void }): JSX.Element {
  const store = useStore()
  const [nickname, setNickname] = useState('')
  const [number, setNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<{ link: string; qr: string } | null>(null)
  const ask = (params: Record<string, unknown>, done: (name: string | null) => string): void => {
    setBusy(true)
    void window.moho
      .rpc<{ username: string | null }>('signalUsername', { accountId, ...params })
      .then((r) => {
        store.toast('info', done(r.username))
        setNickname('')
        setNumber('')
        setLink(null)
        onChanged()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }
  const showLink = (): void => {
    void window.moho
      .rpc<{ link: string; qr: string }>('signalUsernameLink', { accountId })
      .then(setLink)
      .catch((e: Error) => store.toast('error', e.message))
  }
  return (
    <>
      <div className="small muted">{username ? `Your username is ${username}.` : 'You have no username yet: people can find you by it without your number.'}</div>
      <div className="field-row">
        <input className="text-field" placeholder={username ? 'A new name part' : 'Name part, like moho'} value={nickname} disabled={busy} onChange={(e) => setNickname(e.target.value)} />
        <input className="text-field" style={{ maxWidth: '7em' }} placeholder="Number (optional)" value={number} disabled={busy} onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, ''))} />
        <button
          type="button"
          className="button"
          disabled={busy || !nickname.trim()}
          onClick={() => {
            if (username && !window.confirm(`Change your username from ${username}? The old one stops working, and so do links to it.`)) return
            ask({ nickname: nickname.trim(), number: number || undefined }, (name) => `Your username is now ${name}`)
          }}
        >
          {username ? 'Change' : 'Choose'}
        </button>
      </div>
      {username && (
        <div className="field-row">
          <button type="button" className="button subtle small" disabled={busy} onClick={showLink}>
            Link and QR code
          </button>
          <button
            type="button"
            className="button subtle small"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Make a new link? The old link and QR code stop working.')) ask({ resetLink: true }, () => 'Your username has a new link')
            }}
          >
            New link
          </button>
          <button
            type="button"
            className="button subtle small danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Remove the username ${username}? People will need your number to find you.`)) ask({ remove: true }, () => 'Your username was removed')
            }}
          >
            Remove
          </button>
        </div>
      )}
      {link && (
        <div className="field">
          <img className="qr-image" src={link.qr} alt="Your username link as a QR code" />
          <div className="field-row">
            <input className="text-field" readOnly value={link.link} onFocus={(e) => e.target.select()} />
            <button type="button" className="button subtle small" onClick={() => void navigator.clipboard.writeText(link.link).then(() => store.toast('info', 'Link copied'))}>
              Copy
            </button>
          </div>
        </div>
      )}
    </>
  )
}
