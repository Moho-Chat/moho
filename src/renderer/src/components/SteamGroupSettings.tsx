import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { Switch, SwitchRow } from './Switch'
import { ConfirmButton } from './ConfirmButton'
import { useStore } from '../state/hooks'
import { STEAM_KICK_LENGTHS, STEAM_NOTIFY_LEVELS, steamGroupOfRail, type SteamChatGroup } from '../lib/steamchat'

/**
 * Asks the daemon; or, in a window the screenshot harness started, takes the
 * answer it left in `__rpcFixture`, since the harness has no Steam to ask.
 */
function ask<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __mohoShots?: unknown; __rpcFixture?: Record<string, (p: Record<string, unknown>) => unknown> }
  const stub = w.__mohoShots ? w.__rpcFixture?.[method] : undefined
  return stub ? Promise.resolve(stub(params) as T) : window.moho.rpc<T>(method, params)
}

type Tab = 'general' | 'rooms' | 'people' | 'roles' | 'invites'

interface Link {
  code: string
  link: string
  expires?: number | null
}

/** What a role may do, by the names the daemon gives each permission. */
type Permissions = Record<string, boolean>

const LINK_LIFETIMES: { label: string; seconds: number }[] = [
  { label: 'An hour', seconds: 3600 },
  { label: 'A day', seconds: 86400 },
  { label: 'A week', seconds: 604800 }
]

/**
 * Everything about one Steam chat group that the group itself keeps: its name
 * and tagline, its rooms, who is in it and what they may do, and the links
 * that let people in.
 *
 * Read from the daemon each time it is opened and after every change, so what
 * is shown is what Steam holds rather than what this thought it asked for.
 * What the account may not change is shown but not offered; Steam checks again
 * and refuses, which is said in its own words.
 */
export function SteamGroupSettings({
  accountId,
  railId,
  onClose
}: {
  accountId: string
  railId: string
  onClose: () => void
}): JSX.Element {
  const store = useStore()
  const groupId = steamGroupOfRail(railId) ?? ''
  const [group, setGroup] = useState<SteamChatGroup | null>(null)
  const [tab, setTab] = useState<Tab>('general')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const all = await ask<SteamChatGroup[]>('steamChatGroups', { accountId, groupId })
    setGroup(all[0] ?? null)
  }, [accountId, groupId])

  useEffect(() => {
    void reload().catch((e: Error) => store.toast('error', e.message))
  }, [reload, store])

  /** One change, then the group read again; the error is Steam's own. */
  const act = useCallback(
    async <T,>(action: string, extra: Record<string, unknown> = {}): Promise<T | undefined> => {
      setBusy(true)
      try {
        const done = await ask<T>('steamChatGroupAction', { accountId, groupId, action, ...extra })
        await reload()
        return done
      } catch (e) {
        store.toast('error', (e as Error).message)
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [accountId, groupId, reload, store]
  )

  if (!group) {
    return (
      <Modal title="Group" icon="groups" onClose={onClose} className="steam-group">
        <p className="small muted">
          <span className="spinner" /> Asking Steam…
        </p>
      </Modal>
    )
  }

  const tabs: [Tab, string][] = [
    ['general', 'General'],
    ['rooms', 'Rooms'],
    ['people', 'People'],
    ['roles', 'Roles'],
    ['invites', 'Invites']
  ]

  return (
    <Modal title={group.name || 'Group'} icon="groups" onClose={onClose} className="steam-group">
      <div className="room-settings-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`room-settings-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="room-settings-body steam-group-body">
        {tab === 'general' && <General group={group} busy={busy} act={act} onLeft={onClose} />}
        {tab === 'rooms' && <Rooms group={group} busy={busy} act={act} />}
        {tab === 'people' && <People group={group} busy={busy} act={act} />}
        {tab === 'roles' && <Roles group={group} busy={busy} act={act} />}
        {tab === 'invites' && <Invites group={group} act={act} />}
      </div>
    </Modal>
  )
}

type Act = <T>(action: string, extra?: Record<string, unknown>) => Promise<T | undefined>

function General({ group, busy, act, onLeft }: { group: SteamChatGroup; busy: boolean; act: Act; onLeft: () => void }): JSX.Element {
  const store = useStore()
  const [name, setName] = useState(group.name)
  const [tagline, setTagline] = useState(group.tagline)
  const mayChange = group.mayManage
  return (
    <>
      <div className="field">
        <span className="small muted">Picture</span>
        <div className="field-row steam-group-row">
          <span className="grow small muted">{group.mayManage ? 'Shown on the rail and in the channel list.' : 'Only those who may change the group can change it.'}</span>
          {/* Sent to Steam's site and then named to the group; the new picture
              arrives on the rail when Steam says the group changed. */}
          <button
            type="button"
            className="button subtle small"
            disabled={!group.mayManage || busy}
            onClick={() => {
              void window.moho.pickFile(['jpg', 'jpeg', 'png', 'gif']).then((path) => path && void act('avatar', { path }))
            }}
          >
            Change picture
          </button>
        </div>
      </div>
      <div className="field">
        <span className="small muted">Name</span>
        <div className="field-row">
          <input className="text-field" value={name} disabled={!mayChange || busy} onChange={(e) => setName(e.target.value)} />
          <button type="button" className="button" disabled={!mayChange || busy || !name.trim() || name === group.name} onClick={() => void act('rename', { name })}>
            Save
          </button>
        </div>
      </div>
      <div className="field">
        <span className="small muted">Tagline</span>
        <div className="field-row">
          <input className="text-field" value={tagline} disabled={!mayChange || busy} onChange={(e) => setTagline(e.target.value)} />
          <button type="button" className="button" disabled={!mayChange || busy || tagline === group.tagline} onClick={() => void act('tagline', { text: tagline })}>
            Save
          </button>
        </div>
      </div>
      {!mayChange && <p className="small muted">Only {group.myRankWord === 'Member' ? 'its officers' : 'someone with more say'} can change these.</p>}
      <div className="field">
        <span className="small muted">Tell me about</span>
        <div className="segmented" role="radiogroup" aria-label="Notifications">
          {STEAM_NOTIFY_LEVELS.map((l) => (
            <button key={l.value} type="button" role="radio" aria-checked={group.notify === l.value} className={group.notify === l.value ? 'active' : ''} disabled={busy} onClick={() => void act('notify', { level: l.value })}>
              {l.label}
            </button>
          ))}
        </div>
        {/* Separate from the level, as Steam keeps them: being told of everything shows the marker again. */}
        {group.notify !== 4 && <SwitchRow title="Show unread messages" description="The marker on the group when something was written in it" checked={!group.muted} disabled={busy} onChange={(show) => void act('notify', { muted: !show })} />}
        <p className="small muted">Kept by Steam for your account, so it is the same on your other devices.</p>
      </div>
      <div className="field">
        <span className="small muted">You are</span>
        <span>{group.myRankWord}</span>
      </div>
      <div className="leave-confirm-actions">
        <ConfirmButton
          label="Leave group"
          question={`Leave ${group.name}?`}
          confirmLabel="Leave"
          danger
          onConfirm={() => {
            // The window's own leave: it takes the rail entry away with it.
            void store.leaveGroup(group.railId).then((left) => left && onLeft())
          }}
        />
      </div>
    </>
  )
}

function Rooms({ group, busy, act }: { group: SteamChatGroup; busy: boolean; act: Act }): JSX.Element {
  const [fresh, setFresh] = useState('')
  const [withVoice, setWithVoice] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  return (
    <>
      {group.rooms.map((r) => (
        <div key={r.id} className="field-row steam-group-row">
          {editing?.id === r.id ? (
            <>
              <input className="text-field grow" autoFocus value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} />
              <button
                type="button"
                className="button small"
                disabled={busy}
                onClick={() => void act('renameRoom', { roomId: r.id, name: editing.name }).then(() => setEditing(null))}
              >
                Save
              </button>
              <button type="button" className="button subtle small" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <Icon name={r.voice ? 'volume_up' : 'tag'} size={16} />
              <span className="grow ellipsis">{r.name || 'General'}</span>
              {r.voice && <span className="small muted">voice</span>}
              {group.mayManage && (
                <>
                  <button type="button" className="button subtle small" onClick={() => setEditing({ id: r.id, name: r.name })}>
                    Rename
                  </button>
                  {group.rooms.length > 1 && (
                    <ConfirmButton label="Delete" question={`Delete ${r.name || 'General'} and what was said in it?`} confirmLabel="Delete" danger onConfirm={() => void act('deleteRoom', { roomId: r.id })} />
                  )}
                </>
              )}
            </>
          )}
        </div>
      ))}
      {group.mayManage && (
        <>
          <div className="field-row">
            <input className="text-field" placeholder="A new room" value={fresh} onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fresh.trim() && void act('createRoom', { name: fresh, voice: withVoice }).then(() => setFresh(''))} />
            <button type="button" className="button" disabled={busy || !fresh.trim()} onClick={() => void act('createRoom', { name: fresh, voice: withVoice }).then(() => setFresh(''))}>
              Add room
            </button>
          </div>
          <SwitchRow title="With voice" description="People in it can talk, as well as write; it is chosen when the room is made" checked={withVoice} onChange={setWithVoice} />
        </>
      )}
    </>
  )
}

function People({ group, busy, act }: { group: SteamChatGroup; busy: boolean; act: Act }): JSX.Element {
  const store = useStore()
  const [bans, setBans] = useState<{ steamid: string; name: string }[] | null>(null)
  const [kickFor, setKickFor] = useState(3600)
  const roleName = (id: string): string => group.roles.find((r) => r.id === id)?.name ?? id
  const loadBans = (): void => {
    void act<{ bans: { steamid: string; name: string }[] }>('bans').then((r) => r && setBans(r.bans))
  }
  return (
    <>
      {group.members.map((m) => {
        const own = m.steamid === group.owner
        return (
          <div key={m.steamid} className="steam-group-person">
            <div className="field-row steam-group-row">
              <span className="grow ellipsis" title={m.steamid}>
                {m.name}
              </span>
              <span className="small muted">{m.rankWord}</span>
              {group.mayModerate && !own && (
                <>
                  <button type="button" className="button subtle small" disabled={busy} onClick={() => void act('mute', { steamid: m.steamid, seconds: 600 }).then(() => store.toast('info', `Muted ${m.name} for 10 minutes`))}>
                    Mute 10 min
                  </button>
                  <select className="text-field small" value={kickFor} aria-label="How long a removal lasts" onChange={(e) => setKickFor(Number(e.target.value))}>
                    {STEAM_KICK_LENGTHS.map((l) => (
                      <option key={l.seconds} value={l.seconds}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <ConfirmButton label="Remove" question={`Remove ${m.name} for ${STEAM_KICK_LENGTHS.find((l) => l.seconds === kickFor)?.label.toLowerCase()}?`} confirmLabel="Remove" danger onConfirm={() => void act('kick', { steamid: m.steamid, seconds: kickFor })} />
                  <ConfirmButton label="Ban" question={`Ban ${m.name}?`} confirmLabel="Ban" danger onConfirm={() => void act('ban', { steamid: m.steamid, banned: true }).then(() => store.toast('info', `Banned ${m.name}`))} />
                </>
              )}
            </div>
            {m.roles.length > 0 && (
              <div className="profile-roles">
                {m.roles.map((r) => (
                  <span key={r} className="profile-role small">
                    {roleName(r)}
                    {group.mayAssignRoles && !own && r !== group.defaultRole && (
                      <button type="button" className="steam-group-x" aria-label={`Take ${roleName(r)} from ${m.name}`} onClick={() => void act('takeRole', { steamid: m.steamid, roleId: r })}>
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {group.mayAssignRoles && group.roles.some((r) => r.id !== group.defaultRole && !m.roles.includes(r.id)) && (
              <select
                className="text-field small"
                value=""
                aria-label={`Give ${m.name} a role`}
                onChange={(e) => e.target.value && void act('giveRole', { steamid: m.steamid, roleId: e.target.value })}
              >
                <option value="">Give a role…</option>
                {group.roles
                  .filter((r) => r.id !== group.defaultRole && !m.roles.includes(r.id))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        )
      })}
      {group.mayModerate && (
        <>
          <span className="small muted">Banned</span>
          {bans === null ? (
            <button type="button" className="button subtle small" onClick={loadBans}>
              Show who is banned
            </button>
          ) : bans.length === 0 ? (
            <p className="small muted">Nobody.</p>
          ) : (
            bans.map((b) => (
              <div key={b.steamid} className="field-row steam-group-row">
                <span className="grow ellipsis">{b.name}</span>
                <button type="button" className="button subtle small" onClick={() => void act('ban', { steamid: b.steamid, banned: false }).then(loadBans)}>
                  Unban
                </button>
              </div>
            ))
          )}
        </>
      )}
    </>
  )
}

function Roles({ group, busy, act }: { group: SteamChatGroup; busy: boolean; act: Act }): JSX.Element {
  const [fresh, setFresh] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [perms, setPerms] = useState<Permissions | null>(null)
  const [name, setName] = useState('')
  const expand = (id: string, current: string): void => {
    if (open === id) {
      setOpen(null)
      return
    }
    setOpen(id)
    setPerms(null)
    setName(current)
    void act<Permissions>('roleActions', { roleId: id }).then((p) => p && setPerms(p))
  }
  return (
    <>
      {group.roles.map((r) => (
        <div key={r.id} className="steam-group-person">
          <div className="field-row steam-group-row">
            <Icon name="shield" size={16} />
            <span className="grow ellipsis">{r.name}</span>
            <button type="button" className="button subtle small" onClick={() => expand(r.id, r.name)}>
              {open === r.id ? 'Close' : 'Edit'}
            </button>
          </div>
          {open === r.id && (
            <div className="steam-group-perms">
              {group.mayChangeRoles && r.id !== group.defaultRole && (
                <div className="field-row">
                  <input className="text-field" value={name} onChange={(e) => setName(e.target.value)} />
                  <button type="button" className="button small" disabled={busy || !name.trim() || name === r.name} onClick={() => void act('renameRole', { roleId: r.id, name })}>
                    Rename
                  </button>
                  <ConfirmButton label="Delete" question={`Delete ${r.name}?`} confirmLabel="Delete" danger onConfirm={() => void act('deleteRole', { roleId: r.id }).then(() => setOpen(null))} />
                </div>
              )}
              {perms === null ? (
                <p className="small muted">
                  <span className="spinner" /> Asking Steam…
                </p>
              ) : (
                group.permissions.map((p) => (
                  <div key={p.key} className="switch-row">
                    <span className="switch-text">
                      <span>{p.label}</span>
                    </span>
                    <Switch
                      checked={!!perms[p.key]}
                      label={p.label}
                      disabled={!group.mayChangeRoles || busy}
                      onChange={(next) => {
                        const updated = { ...perms, [p.key]: next }
                        setPerms(updated)
                        void act('setRoleActions', { roleId: r.id, actions: updated })
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      ))}
      {group.mayChangeRoles && (
        <div className="field-row">
          <input className="text-field" placeholder="A new role" value={fresh} onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fresh.trim() && void act('createRole', { name: fresh }).then(() => setFresh(''))} />
          <button type="button" className="button" disabled={busy || !fresh.trim()} onClick={() => void act('createRole', { name: fresh }).then(() => setFresh(''))}>
            Add role
          </button>
        </div>
      )}
    </>
  )
}

function Invites({ group, act }: { group: SteamChatGroup; act: Act }): JSX.Element {
  const store = useStore()
  const [links, setLinks] = useState<Link[] | null>(null)
  const [seconds, setSeconds] = useState(86400)
  const load = useCallback(() => {
    void act<{ links: Link[] }>('links').then((r) => r && setLinks(r.links))
    // act reads the group again, which is not needed here but is harmless.
  }, [act])
  useEffect(() => {
    load()
    // Once per opening of the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const copy = (text: string): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => store.toast('info', 'Copied'))
      .catch(() => store.toast('error', 'Could not copy'))
  }
  return (
    <>
      {links === null && (
        <p className="small muted">
          <span className="spinner" /> Asking Steam…
        </p>
      )}
      {links?.length === 0 && <p className="small muted">No links. Make one to let people in.</p>}
      {links?.map((l) => (
        <div key={l.code} className="field-row steam-group-row">
          <span className="grow ellipsis" title={l.link}>
            {l.link}
          </span>
          {l.expires ? <span className="small muted">until {new Date(l.expires * 1000).toLocaleString()}</span> : null}
          <button type="button" className="button subtle small" onClick={() => copy(l.link)}>
            Copy
          </button>
          {group.mayInvite && (
            <button type="button" className="button subtle small" onClick={() => void act('revokeInvite', { code: l.code }).then(load)}>
              Revoke
            </button>
          )}
        </div>
      ))}
      {group.mayInvite && (
        <div className="field-row">
          <select className="text-field" value={seconds} aria-label="How long a link lasts" onChange={(e) => setSeconds(Number(e.target.value))}>
            {LINK_LIFETIMES.map((l) => (
              <option key={l.seconds} value={l.seconds}>
                {l.label}
              </option>
            ))}
          </select>
          <button type="button" className="button" onClick={() => void act('makeInvite', { seconds }).then(load)}>
            Make a link
          </button>
        </div>
      )}
    </>
  )
}
